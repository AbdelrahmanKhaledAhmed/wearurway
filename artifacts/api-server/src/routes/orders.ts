import { Router, type IRouter, raw } from "express";
import { getStore, updateStore, type OrderRecord } from "../data/store.js";
import { deleteObject } from "../lib/objectStorage.js";
import { logger } from "../lib/logger.js";
import { isAdminAuthenticated } from "./admin.js";
import {
  enqueueUploads,
  enqueueNotification,
  type NotificationPayload,
} from "../services/orderOutbox.js";

const router: IRouter = Router();

const RAW_UPLOAD_LIMIT = "60mb";

interface CreateOrderSize {
  name?: string;
  realWidth?: number;
  realHeight?: number;
}

interface CreateOrderFile {
  fileName?: string;
  dataUrl?: string;
}

interface CreateOrderBody {
  name?: string;
  phone?: string;
  address?: string;
  product?: string;
  fit?: string;
  size?: CreateOrderSize;
  color?: string;
  paymentMethod?: "cod" | "instapay";
  productPrice?: number;
  shippingPrice?: number;
  total?: number;
  frontImage?: string;
  backImage?: string;
  paymentProof?: CreateOrderFile;
  exportFiles?: CreateOrderFile[];
}

interface UploadOrderDocumentsBody {
  exportFiles?: CreateOrderFile[];
}

function generateOrderId(): string {
  return `WW-${Math.floor(10000 + Math.random() * 90000)}`;
}

function parseDataUrl(dataUrl: string): { mimeType: string; buffer: Buffer } {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error("Invalid image data");
  const [, mimeType, base64] = match;
  return { mimeType, buffer: Buffer.from(base64, "base64") };
}

function safeFileName(name: string): string {
  const cleaned = name.trim().replace(/[^\w.-]/g, "-").replace(/-+/g, "-");
  return cleaned || "file.png";
}

function extensionForMime(mimeType: string): string {
  if (mimeType === "image/jpeg") return ".jpg";
  if (mimeType === "image/webp") return ".webp";
  if (mimeType === "image/png") return ".png";
  return ".bin";
}

function prepareFiles(files: CreateOrderFile[]): { fileName: string; contentType: string; buffer: Buffer }[] {
  return files
    .filter((f): f is { fileName: string; dataUrl: string } => Boolean(f.fileName && f.dataUrl))
    .map((file) => {
      const { mimeType, buffer } = parseDataUrl(file.dataUrl);
      const hasExtension = /\.[a-z0-9]+$/i.test(file.fileName);
      const fileName = safeFileName(
        hasExtension ? file.fileName : `${file.fileName}${extensionForMime(mimeType)}`,
      );
      return { fileName, contentType: mimeType, buffer };
    });
}

function registerOrderFolder(
  orderId: string,
  details: { customerName?: string; phone?: string },
) {
  const now = new Date().toISOString();
  updateStore((store) => {
    const existing = store.orderFiles[orderId];
    store.orderFiles[orderId] = {
      orderId,
      folderPath: `Cloudflare R2: orders/${orderId}/`,
      files: existing?.files ?? [],
      customerName: details.customerName ?? existing?.customerName,
      phone: details.phone ?? existing?.phone,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      pendingUploads: existing?.pendingUploads,
      pendingNotification: existing?.pendingNotification,
      notificationSentAt: existing?.notificationSentAt,
    };
  });
}

router.post("/create-order", (req, res) => {
  const body = req.body as CreateOrderBody;

  if (
    !body.name ||
    !body.phone ||
    !body.address ||
    !body.size?.name ||
    !body.color ||
    !body.paymentMethod ||
    body.total === undefined
  ) {
    res.status(400).json({ error: "Missing required order fields" });
    return;
  }

  if (body.paymentMethod === "instapay" && !body.paymentProof?.dataUrl) {
    res.status(400).json({ error: "Payment proof is required for InstaPay orders" });
    return;
  }

  const initialFiles: CreateOrderFile[] = [];
  if (body.paymentMethod === "instapay" && body.paymentProof?.dataUrl) {
    initialFiles.push({
      fileName: `payment-proof-${safeFileName(body.paymentProof.fileName ?? "screenshot.png")}`,
      dataUrl: body.paymentProof.dataUrl,
    });
  }
  if (Array.isArray(body.exportFiles)) initialFiles.push(...body.exportFiles);

  let prepared: { fileName: string; contentType: string; buffer: Buffer }[];
  try {
    prepared = prepareFiles(initialFiles);
  } catch (err) {
    logger.error({ err }, "Invalid file data in create-order");
    res.status(400).json({ error: "Invalid file data" });
    return;
  }

  const orderId = generateOrderId();

  const orderRecord: OrderRecord = {
    orderId,
    name: body.name,
    phone: body.phone,
    address: body.address,
    product: body.product,
    fit: body.fit,
    size: body.size,
    color: body.color,
    paymentMethod: body.paymentMethod,
    productPrice: body.productPrice,
    shippingPrice: body.shippingPrice,
    total: body.total,
    createdAt: new Date().toISOString(),
  };
  updateStore((store) => {
    store.orders[orderId] = orderRecord;
  });
  registerOrderFolder(orderId, { customerName: body.name, phone: body.phone });

  enqueueUploads(orderId, prepared);

  res.json({ orderId });
});

router.post(
  "/orders/:orderId/documents/upload",
  raw({ type: "*/*", limit: RAW_UPLOAD_LIMIT }),
  (req, res) => {
    const orderId = req.params.orderId;
    const record = getStore().orderFiles[orderId];
    if (!record) {
      res.status(404).json({ error: "Order not found" });
      return;
    }

    const fileNameRaw = typeof req.query.fileName === "string" ? req.query.fileName : "";
    const fileName = fileNameRaw.trim();
    if (!fileName) {
      res.status(400).json({ error: "fileName query parameter is required" });
      return;
    }

    const contentType =
      (req.headers["content-type"] as string | undefined)?.split(";")[0].trim() ||
      "application/octet-stream";
    const body = req.body;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      res.status(400).json({ error: "Empty upload body" });
      return;
    }

    const hasExtension = /\.[a-z0-9]+$/i.test(fileName);
    const finalName = safeFileName(
      hasExtension ? fileName : `${fileName}${extensionForMime(contentType)}`,
    );

    enqueueUploads(orderId, [{ fileName: finalName, contentType, buffer: body }]);
    res.json({ orderId, fileName: finalName, queued: true });
  },
);

router.post("/orders/:orderId/documents", (req, res) => {
  const orderId = req.params.orderId;
  const body = req.body as UploadOrderDocumentsBody;
  const record = getStore().orderFiles[orderId];

  if (!record) {
    res.status(404).json({ error: "Order not found" });
    return;
  }

  const exportFiles = Array.isArray(body.exportFiles) ? body.exportFiles : [];
  if (exportFiles.length === 0) {
    res.status(400).json({ error: "No documents were provided" });
    return;
  }

  let prepared: { fileName: string; contentType: string; buffer: Buffer }[];
  try {
    prepared = prepareFiles(exportFiles);
  } catch (err) {
    logger.error({ err, orderId }, "Invalid file data in /orders/:orderId/documents");
    res.status(400).json({ error: "Invalid file data" });
    return;
  }

  enqueueUploads(orderId, prepared);
  res.json({
    orderId,
    folderPath: `Object Storage: orders/${orderId}/`,
    queuedFiles: prepared.map((p) => p.fileName),
  });
});

router.post("/orders/:orderId/complete", (req, res) => {
  const orderId = req.params.orderId;
  const store = getStore();
  const record = store.orderFiles[orderId];
  const order = store.orders[orderId];

  if (!record) {
    res.status(404).json({ error: "Order not found" });
    return;
  }

  const requestBody = (req.body ?? {}) as { feedback?: unknown };
  const feedback = typeof requestBody.feedback === "string" ? requestBody.feedback : undefined;

  const payload: NotificationPayload = order
    ? {
        name: order.name,
        phone: order.phone,
        address: order.address,
        product: order.product,
        fit: order.fit,
        size: order.size,
        color: order.color,
        paymentMethod: order.paymentMethod as NotificationPayload["paymentMethod"],
        productPrice: order.productPrice,
        shippingPrice: order.shippingPrice,
        total: order.total,
        feedback,
      }
    : { feedback };

  enqueueNotification(orderId, payload);

  res.json({ success: true, queued: true });
});

router.get("/admin/order-files", (req, res) => {
  if (!isAdminAuthenticated(req as Parameters<typeof isAdminAuthenticated>[0])) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const orderFiles = Object.values(getStore().orderFiles)
    .map((record) => ({
      ...record,
      pendingUploadCount: record.pendingUploads?.length ?? 0,
      notificationStatus: record.pendingNotification
        ? `pending (attempts: ${record.pendingNotification.attempts}${record.pendingNotification.lastError ? `, last error: ${record.pendingNotification.lastError}` : ""})`
        : record.notificationSentAt
          ? `sent at ${record.notificationSentAt}`
          : "not requested",
      // Don't ship the giant base64 blobs to the admin panel
      pendingUploads: (record.pendingUploads ?? []).map((u) => ({
        id: u.id,
        fileName: u.fileName,
        contentType: u.contentType,
        attempts: u.attempts,
        lastError: u.lastError,
        nextAttemptAt: u.nextAttemptAt,
      })),
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json(orderFiles);
});

router.delete("/admin/order-files/:orderId", async (req, res) => {
  if (!isAdminAuthenticated(req as Parameters<typeof isAdminAuthenticated>[0])) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const orderId = req.params.orderId;
  const record = getStore().orderFiles[orderId];

  if (record) {
    // Delete all order files from Object Storage
    const deletePromises = (record.files ?? []).map((f) =>
      deleteObject(`orders/${orderId}/${f}`).catch((err: unknown) =>
        logger.warn({ err, orderId, file: f }, "Failed to delete order file from Object Storage"),
      ),
    );
    await Promise.all(deletePromises);
  }

  updateStore((store) => {
    delete store.orderFiles[orderId];
  });

  res.json({ success: true });
});

export default router;
