import { Router, type IRouter } from "express";
import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { unzipSync } from "fflate";
import { getStore, updateStore, type OrderRecord } from "../data/store.js";
import { UPLOADS_DIR } from "../lib/paths.js";
import { logger } from "../lib/logger.js";
import { isAdminAuthenticated } from "./admin.js";

const router: IRouter = Router();
const ORDER_FILES_ROOT = path.join(UPLOADS_DIR, "orders");
const DISPLAY_ORDER_FILES_ROOT = "artifacts/api-server/uploads/orders";

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

function folderPathForOrder(orderId: string): string {
  return path.join(ORDER_FILES_ROOT, orderId);
}

function displayFolderPathForOrder(orderId: string): string {
  return `${DISPLAY_ORDER_FILES_ROOT}/${orderId}`;
}

async function telegramRequest(url: string, body: URLSearchParams) {
  const response = await fetch(url, { method: "POST", body });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) {
    const description = data?.description ? `: ${data.description}` : "";
    throw new Error(`Telegram request failed${description}`);
  }
}

async function saveFilesToOrderFolder(orderId: string, files: CreateOrderFile[]): Promise<string[]> {
  const folderPath = folderPathForOrder(orderId);
  await fs.mkdir(folderPath, { recursive: true });
  const saved: string[] = [];

  for (const file of files) {
    if (!file.fileName || !file.dataUrl) continue;
    const { mimeType, buffer } = parseDataUrl(file.dataUrl);
    const hasExtension = /\.[a-z0-9]+$/i.test(file.fileName);
    const fileName = safeFileName(hasExtension ? file.fileName : `${file.fileName}${extensionForMime(mimeType)}`);
    await fs.writeFile(path.join(folderPath, fileName), buffer);
    saved.push(fileName);
  }

  return saved;
}

function registerOrderFolder(orderId: string, details: { customerName?: string; phone?: string; files?: string[] }) {
  const now = new Date().toISOString();
  updateStore((store) => {
    const existing = store.orderFiles[orderId];
    const existingFiles = existing?.files ?? [];
    const nextFiles = Array.from(new Set([...existingFiles, ...(details.files ?? [])]));
    store.orderFiles[orderId] = {
      orderId,
      folderPath: displayFolderPathForOrder(orderId),
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

async function sendOrderMessage(orderId: string, body: CreateOrderBody) {
  const settings = getStore().orderSettings;
  const botToken = settings.telegramBotToken || process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
  const chatId = settings.telegramChatId || process.env.CHAT_ID || process.env.TELEGRAM_CHAT_ID;

  if (!botToken || !chatId) {
    logger.error({ orderId }, "Telegram bot token or chat ID is not configured");
    return;
  }

  const paymentMethod = body.paymentMethod === "instapay" ? "InstaPay" : "Cash on Delivery";
  const productPrice = body.productPrice ?? Math.max(0, (body.total ?? 0) - (body.shippingPrice ?? 0));
  const shippingPrice = body.shippingPrice ?? Math.max(0, (body.total ?? 0) - productPrice);
  const sizeDetails = `${body.size?.name ?? "-"} (${body.size?.realWidth ?? "-"}x${body.size?.realHeight ?? "-"} cm)`;
  const message = [
    `Order ID: ${orderId}`,
    "New Order:",
    `Name: ${body.name}`,
    `Phone: ${body.phone}`,
    `Address: ${body.address}`,
    `Size: ${sizeDetails}`,
    `Color: ${body.color}`,
    `Payment Method: ${paymentMethod}`,
    `T-shirt Price: ${formatMoney(productPrice)}`,
    `Shipping: ${formatMoney(shippingPrice)}`,
    `Total: ${formatMoney(body.total)} (${formatMoney(productPrice)} T-shirt + ${formatMoney(shippingPrice)} Shipping)`,
    `Documents Folder: ${displayFolderPathForOrder(orderId)}`,
    "Open Admin Panel > Order Files to copy/delete the documents.",
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

async function saveZipToOrderFolder(orderId: string, zipBuffer: Buffer): Promise<string[]> {
  const folderPath = folderPathForOrder(orderId);
  await fs.mkdir(folderPath, { recursive: true });
  const extracted = unzipSync(new Uint8Array(zipBuffer));
  const saved: string[] = [];
  for (const [name, data] of Object.entries(extracted)) {
    const fileName = safeFileName(name);
    await fs.writeFile(path.join(folderPath, fileName), Buffer.from(data));
    saved.push(fileName);
  }
  return saved;
}

router.post(
  "/orders/:orderId/documents",
  express.raw({ type: "application/zip", limit: "200mb" }),
  (req, res) => {
    const orderId = req.params.orderId;
    const record = getStore().orderFiles[orderId];

    if (!record) {
      res.status(404).json({ error: "Order not found" });
      return;
    }

    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      res.status(400).json({ error: "No documents were provided" });
      return;
    }

    void saveZipToOrderFolder(orderId, req.body)
      .then((files) => {
        registerOrderFolder(orderId, { files });
        res.json({ orderId, folderPath: displayFolderPathForOrder(orderId), files });
      })
      .catch((error) => {
        logger.error({ err: error, orderId }, "Failed to upload order documents");
        res.status(500).json({ error: "Failed to save order documents" });
      });
  },
);

router.post("/orders/:orderId/complete", (req, res) => {
  const orderId = req.params.orderId;
  const store = getStore();
  const record = store.orderFiles[orderId];
  const order = store.orders[orderId];

  if (!record) {
    res.status(404).json({ error: "Order not found" });
    return;
  }

  res.json({ success: true });

  const body: CreateOrderBody = order
    ? {
        name: order.name,
        phone: order.phone,
        address: order.address,
        size: order.size,
        color: order.color,
        paymentMethod: order.paymentMethod as CreateOrderBody["paymentMethod"],
        productPrice: order.productPrice,
        shippingPrice: order.shippingPrice,
        total: order.total,
      }
    : {};
  void sendOrderMessage(orderId, body)
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

router.delete("/admin/order-files/:orderId", (req, res) => {
  if (!isAdminAuthenticated(req as Parameters<typeof isAdminAuthenticated>[0])) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const orderId = req.params.orderId;
  void fs.rm(folderPathForOrder(orderId), { recursive: true, force: true })
    .then(() => {
      updateStore((store) => {
        delete store.orderFiles[orderId];
      });
      res.json({ success: true });
    })
    .catch((error) => {
      logger.error({ err: error, orderId }, "Failed to delete order files");
      res.status(500).json({ error: "Failed to delete order files" });
    });
});

export default router;
