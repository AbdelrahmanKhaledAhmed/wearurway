import { Router, type IRouter, raw } from "express";
import { getStore, updateStore, type OrderRecord } from "../data/store.js";
import { uploadBuffer, deleteObject } from "../lib/objectStorage.js";
import { logger } from "../lib/logger.js";
import { isAdminAuthenticated } from "./admin.js";

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

function gcsOrderPrefix(orderId: string): string {
  return `orders/${orderId}`;
}

async function telegramRequest(url: string, body: URLSearchParams) {
  const response = await fetch(url, { method: "POST", body });
  const data = (await response.json().catch(() => null)) as
    | { ok?: boolean; description?: string }
    | null;
  if (!response.ok || !data?.ok) {
    const description = data?.description ? `: ${data.description}` : "";
    throw new Error(`Telegram request failed${description}`);
  }
}

async function saveFilesToOrderFolder(orderId: string, files: CreateOrderFile[]): Promise<string[]> {
  const prepared = files
    .filter((f): f is { fileName: string; dataUrl: string } => Boolean(f.fileName && f.dataUrl))
    .map((file) => {
      const { mimeType, buffer } = parseDataUrl(file.dataUrl);
      const hasExtension = /\.[a-z0-9]+$/i.test(file.fileName);
      const fileName = safeFileName(hasExtension ? file.fileName : `${file.fileName}${extensionForMime(mimeType)}`);
      return { fileName, mimeType, buffer };
    });

  await Promise.all(
    prepared.map(({ fileName, mimeType, buffer }) =>
      uploadBuffer(`${gcsOrderPrefix(orderId)}/${fileName}`, buffer, mimeType)
    )
  );

  return prepared.map((p) => p.fileName);
}

async function uploadSingleRawFile(
  orderId: string,
  fileName: string,
  buffer: Buffer,
  contentType: string,
): Promise<string> {
  const hasExtension = /\.[a-z0-9]+$/i.test(fileName);
  const finalName = safeFileName(hasExtension ? fileName : `${fileName}${extensionForMime(contentType)}`);
  await uploadBuffer(`${gcsOrderPrefix(orderId)}/${finalName}`, buffer, contentType);
  return finalName;
}

function registerOrderFolder(orderId: string, details: { customerName?: string; phone?: string; files?: string[] }) {
  const now = new Date().toISOString();
  updateStore((store) => {
    const existing = store.orderFiles[orderId];
    const existingFiles = existing?.files ?? [];
    const nextFiles = Array.from(new Set([...existingFiles, ...(details.files ?? [])]));
    store.orderFiles[orderId] = {
      orderId,
      folderPath: `Cloudflare R2: orders/${orderId}/`,
      files: nextFiles,
      customerName: details.customerName ?? existing?.customerName,
      phone: details.phone ?? existing?.phone,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
  });
}

async function saveOrderDocuments(orderId: string, files: CreateOrderFile[], details: { customerName?: string; phone?: string } = {}) {
  if (files.length === 0) {
    registerOrderFolder(orderId, { ...details, files: [] });
    return [];
  }

  const saved = await saveFilesToOrderFolder(orderId, files);
  registerOrderFolder(orderId, { ...details, files: saved });
  return saved;
}

function formatMoney(value: number | undefined): string {
  return `${Number(value ?? 0)} EGP`;
}

async function sendOrderMessage(orderId: string, body: CreateOrderBody, feedback?: string) {
  const settings = getStore().orderSettings;
  const botToken = settings.telegramBotToken;
  const chatId = settings.telegramChatId;

  if (!botToken || !chatId) {
    logger.error({ orderId }, "Telegram bot token or chat ID is not configured");
    return;
  }

  const paymentMethod = body.paymentMethod === "instapay" ? "InstaPay 💳" : "Cash on Delivery 💵";
  const productPrice = body.productPrice ?? Math.max(0, (body.total ?? 0) - (body.shippingPrice ?? 0));
  const shippingPrice = body.shippingPrice ?? Math.max(0, (body.total ?? 0) - productPrice);
  const sizeDetails = `${body.size?.name ?? "-"} (${body.size?.realWidth ?? "-"} × ${body.size?.realHeight ?? "-"} cm)`;
  const line = "━━━━━━━━━━━━━━━━━━━━";
  const trimmedFeedback = feedback?.trim();
  const message = [
    line,
    "🛍  NEW ORDER",
    line,
    "",
    `🆔  Order ID: ${orderId}`,
    "",
    "👤  CUSTOMER INFO",
    `   Name:     ${body.name ?? "-"}`,
    `   Phone:    ${body.phone ?? "-"}`,
    `   Address:  ${body.address ?? "-"}`,
    "",
    "👕  PRODUCT DETAILS",
    `   Product:  ${body.product ?? "-"}`,
    `   Fit:      ${body.fit ?? "-"}`,
    `   Color:    ${body.color ?? "-"}`,
    `   Size:     ${sizeDetails}`,
    "",
    "💰  PRICING",
    `   T-shirt:  ${formatMoney(productPrice)}`,
    `   Shipping: ${formatMoney(shippingPrice)}`,
    `   Total:    ${formatMoney(body.total)}`,
    "",
    `💳  Payment:  ${paymentMethod}`,
    "",
    "📁  DOCUMENTS",
    "   Stored on Cloudflare R2 ☁️",
    `   Folder: orders/${orderId}/`,
    "   Admin Panel → Order Files",
    "",
    ...(trimmedFeedback
      ? ["💬  CUSTOMER FEEDBACK", trimmedFeedback, ""]
      : []),
    line,
  ].join("\n");

  await telegramRequest(
    `https://api.telegram.org/bot${botToken}/sendMessage`,
    new URLSearchParams({ chat_id: chatId, text: message }),
  );
}

router.post("/create-order", (req, res) => {
  const body = req.body as CreateOrderBody;

  if (!body.name || !body.phone || !body.address || !body.size?.name || !body.color || !body.paymentMethod || body.total === undefined) {
    res.status(400).json({ error: "Missing required order fields" });
    return;
  }

  if (body.paymentMethod === "instapay" && !body.paymentProof?.dataUrl) {
    res.status(400).json({ error: "Payment proof is required for InstaPay orders" });
    return;
  }

  const orderId = generateOrderId();
  registerOrderFolder(orderId, { customerName: body.name, phone: body.phone, files: [] });

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

  res.json({ orderId });

  const initialFiles: CreateOrderFile[] = [];
  if (body.paymentMethod === "instapay" && body.paymentProof?.dataUrl) {
    initialFiles.push({
      fileName: `payment-proof-${safeFileName(body.paymentProof.fileName ?? "screenshot.png")}`,
      dataUrl: body.paymentProof.dataUrl,
    });
  }
  if (Array.isArray(body.exportFiles)) initialFiles.push(...body.exportFiles);

  void saveOrderDocuments(orderId, initialFiles, { customerName: body.name, phone: body.phone })
    .catch((error) => logger.error({ err: error, orderId }, "Failed to save order documents"));
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

    const contentType = (req.headers["content-type"] as string | undefined)?.split(";")[0].trim() || "application/octet-stream";
    const body = req.body;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      res.status(400).json({ error: "Empty upload body" });
      return;
    }

    void uploadSingleRawFile(orderId, fileName, body, contentType)
      .then((savedName) => {
        registerOrderFolder(orderId, { files: [savedName] });
        res.json({ orderId, fileName: savedName });
      })
      .catch((error) => {
        logger.error({ err: error, orderId, fileName }, "Failed to upload single order file");
        res.status(500).json({ error: "Failed to save order file" });
      });
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

  void saveOrderDocuments(orderId, exportFiles)
    .then((files) => res.json({ orderId, folderPath: `Object Storage: orders/${orderId}/`, files }))
    .catch((error) => {
      logger.error({ err: error, orderId }, "Failed to upload order documents");
      res.status(500).json({ error: "Failed to save order documents" });
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

  res.json({ success: true });

  const body: CreateOrderBody = order
    ? {
        name: order.name,
        phone: order.phone,
        address: order.address,
        product: order.product,
        fit: order.fit,
        size: order.size,
        color: order.color,
        paymentMethod: order.paymentMethod as CreateOrderBody["paymentMethod"],
        productPrice: order.productPrice,
        shippingPrice: order.shippingPrice,
        total: order.total,
      }
    : {};
  void sendOrderMessage(orderId, body, feedback)
    .catch((error) => logger.error({ err: error, orderId }, "Failed to send order Telegram message"));
});

router.get("/admin/order-files", (req, res) => {
  if (!isAdminAuthenticated(req as Parameters<typeof isAdminAuthenticated>[0])) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const orderFiles = Object.values(getStore().orderFiles).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
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
        logger.warn({ err, orderId, file: f }, "Failed to delete order file from Object Storage")
      )
    );
    await Promise.all(deletePromises);
  }

  updateStore((store) => {
    delete store.orderFiles[orderId];
  });

  res.json({ success: true });
});

export default router;
