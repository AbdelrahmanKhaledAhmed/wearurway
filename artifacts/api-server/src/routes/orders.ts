import { Router, type IRouter } from "express";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { getStore } from "../data/store.js";
import { UPLOADS_DIR } from "../lib/paths.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

interface CreateOrderSize {
  name?: string;
  realWidth?: number;
  realHeight?: number;
}

interface CreateOrderFile {
  fileName?: string;
  dataUrl?: string;
}

interface CreateOrderLayer {
  id?: string;
  name?: string;
  imageUrl?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
  visible?: boolean;
  naturalWidth?: number;
  naturalHeight?: number;
}

interface CreateOrderDesignJob {
  frontLayers?: CreateOrderLayer[];
  backLayers?: CreateOrderLayer[];
  mockupSize?: number;
  frontMockupImage?: string;
  backMockupImage?: string;
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
  designJob?: CreateOrderDesignJob;
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

function dataUrlToBlob(dataUrl: string): Blob {
  const { mimeType, buffer } = parseDataUrl(dataUrl);
  return new Blob([buffer], { type: mimeType });
}

function bufferToDataUrl(buffer: Buffer, mimeType = "image/png"): string {
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

function safeFileName(name: string): string {
  return name.replace(/[^\w.-]/g, "-");
}

async function telegramRequest(url: string, body: URLSearchParams | FormData) {
  const response = await fetch(url, { method: "POST", body });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) {
    const description = data?.description ? `: ${data.description}` : "";
    throw new Error(`Telegram request failed${description}`);
  }
}

async function readImageSource(src: string | undefined, baseUrl: string): Promise<Buffer | null> {
  if (!src) return null;
  if (src.startsWith("data:")) return parseDataUrl(src).buffer;

  if (src.startsWith("/api/uploads/")) {
    const relative = src.replace(/^\/api\/uploads\/?/, "");
    try {
      return await fs.readFile(path.join(UPLOADS_DIR, decodeURIComponent(relative)));
    } catch {
      return null;
    }
  }

  const url = src.startsWith("http://") || src.startsWith("https://")
    ? src
    : new URL(src, baseUrl).toString();
  const response = await fetch(url);
  if (!response.ok) return null;
  return Buffer.from(await response.arrayBuffer());
}

function getLayerAspectRatio(layer: CreateOrderLayer): number {
  const naturalRatio =
    (layer.naturalWidth ?? 0) > 0 && (layer.naturalHeight ?? 0) > 0
      ? (layer.naturalWidth ?? 0) / (layer.naturalHeight ?? 1)
      : 0;
  const displayRatio =
    (layer.width ?? 0) > 0 && (layer.height ?? 0) > 0
      ? (layer.width ?? 1) / (layer.height ?? 1)
      : 1;
  return Number.isFinite(naturalRatio) && naturalRatio > 0 ? naturalRatio : displayRatio;
}

function getRatioLockedSize(layer: CreateOrderLayer) {
  const width = Math.max(10, layer.width ?? 10);
  return { width, height: Math.max(10, width / getLayerAspectRatio(layer)) };
}

async function transparentCanvas(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  }).png().toBuffer();
}

async function containImage(buffer: Buffer, width: number, height: number): Promise<Buffer> {
  return sharp(buffer)
    .resize(width, height, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .ensureAlpha()
    .png()
    .toBuffer();
}

async function renderDesignSide(
  layers: CreateOrderLayer[],
  mockupImage: string | undefined,
  mockupSize: number,
  baseUrl: string,
): Promise<Buffer | null> {
  const visible = layers.filter((layer) => layer.visible && layer.imageUrl);
  if (visible.length === 0) return null;

  const shirtBuffer = await readImageSource(mockupImage, baseUrl);
  const maxCanvasPx = 4096;
  const scaleForMinimum = 2400 / mockupSize;
  let scale = Math.max(1, scaleForMinimum);

  if (shirtBuffer) {
    const metadata = await sharp(shirtBuffer).metadata();
    if (metadata.width) scale = Math.max(scale, metadata.width / mockupSize);
  }

  for (const layer of visible) {
    const imageBuffer = await readImageSource(layer.imageUrl, baseUrl);
    if (!imageBuffer) continue;
    const metadata = await sharp(imageBuffer).metadata();
    const { width } = getRatioLockedSize(layer);
    if (metadata.width) scale = Math.max(scale, metadata.width / width);
  }

  if (mockupSize * scale > maxCanvasPx || mockupSize * (4 / 3) * scale > maxCanvasPx) {
    scale = Math.min(maxCanvasPx / mockupSize, maxCanvasPx / (mockupSize * (4 / 3)));
  }

  const canvasWidth = Math.round(mockupSize * scale);
  const canvasHeight = Math.round(mockupSize * (4 / 3) * scale);
  const composites: sharp.OverlayOptions[] = [];

  for (const layer of visible) {
    const imageBuffer = await readImageSource(layer.imageUrl, baseUrl);
    if (!imageBuffer) continue;
    const display = getRatioLockedSize(layer);
    const layerWidth = Math.max(1, Math.round(display.width * scale));
    const layerHeight = Math.max(1, Math.round(display.height * scale));
    const rotated = await sharp(imageBuffer)
      .resize(layerWidth, layerHeight, { fit: "fill" })
      .rotate(layer.rotation ?? 0, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    const metadata = await sharp(rotated).metadata();
    const cx = ((layer.x ?? 0) + display.width / 2) * scale;
    const cy = ((layer.y ?? 0) + display.height / 2) * scale;
    composites.push({
      input: rotated,
      left: Math.round(cx - (metadata.width ?? layerWidth) / 2),
      top: Math.round(cy - (metadata.height ?? layerHeight) / 2),
    });
  }

  let design = await sharp(await transparentCanvas(canvasWidth, canvasHeight)).composite(composites).png().toBuffer();

  if (shirtBuffer) {
    const mask = await containImage(shirtBuffer, canvasWidth, canvasHeight);
    design = await sharp(design).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
  }

  return design;
}

async function renderMockupSide(design: Buffer, mockupImage: string | undefined, baseUrl: string): Promise<Buffer | null> {
  const designMeta = await sharp(design).metadata();
  const width = designMeta.width;
  const height = designMeta.height;
  if (!width || !height) return null;
  const shirtBuffer = await readImageSource(mockupImage, baseUrl);
  if (!shirtBuffer) return design;
  const shirt = await containImage(shirtBuffer, width, height);
  return sharp(await transparentCanvas(width, height)).composite([{ input: shirt }, { input: design }]).png().toBuffer();
}

async function generateServerExportFiles(designJob: CreateOrderDesignJob | undefined, baseUrl: string): Promise<CreateOrderFile[]> {
  if (!designJob?.mockupSize) return [];
  const files: CreateOrderFile[] = [];
  const sides = [
    { name: "front", layers: designJob.frontLayers ?? [], mockupImage: designJob.frontMockupImage },
    { name: "back", layers: designJob.backLayers ?? [], mockupImage: designJob.backMockupImage },
  ];

  for (const side of sides) {
    const design = await renderDesignSide(side.layers, side.mockupImage, designJob.mockupSize, baseUrl);
    if (!design) continue;
    files.push({ fileName: `design-${side.name}.png`, dataUrl: bufferToDataUrl(design) });
    const mockup = await renderMockupSide(design, side.mockupImage, baseUrl);
    if (mockup) files.push({ fileName: `mockup-${side.name}.png`, dataUrl: bufferToDataUrl(mockup) });
  }

  return files;
}

function formatMoney(value: number | undefined): string {
  return `${Number(value ?? 0)} EGP`;
}

async function processOrder(orderId: string, body: CreateOrderBody, baseUrl: string) {
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
  ].join("\n");

  const telegramBaseUrl = `https://api.telegram.org/bot${botToken}`;

  await telegramRequest(
    `${telegramBaseUrl}/sendMessage`,
    new URLSearchParams({ chat_id: chatId, text: message }),
  );

  if (body.paymentMethod === "instapay" && body.paymentProof?.dataUrl) {
    const formData = new FormData();
    formData.append("chat_id", chatId);
    formData.append("caption", `${orderId} payment proof`);
    formData.append("document", dataUrlToBlob(body.paymentProof.dataUrl), `${orderId}-${safeFileName(body.paymentProof.fileName ?? "payment-proof.png")}`);
    await telegramRequest(`${telegramBaseUrl}/sendDocument`, formData);
  }

  const hasExportFilesPayload = Array.isArray(body.exportFiles) && body.exportFiles.length > 0;
  const exportDocuments = (hasExportFilesPayload ? body.exportFiles ?? [] : await generateServerExportFiles(body.designJob, baseUrl))
    .filter((file): file is { fileName: string; dataUrl: string } => Boolean(file.fileName && file.dataUrl))
    .map(file => ({
      label: file.fileName.replace(/\.png$/i, ""),
      fileName: safeFileName(file.fileName),
      dataUrl: file.dataUrl,
    }));

  const documents = exportDocuments.length > 0
    ? exportDocuments
    : [
        { label: "front", fileName: `${orderId}-front.png`, dataUrl: body.frontImage },
        { label: "back", fileName: `${orderId}-back.png`, dataUrl: body.backImage },
      ].filter((file): file is { label: string; fileName: string; dataUrl: string } => Boolean(file.dataUrl));

  for (const file of documents) {
    const formData = new FormData();
    formData.append("chat_id", chatId);
    formData.append("caption", `${orderId} ${file.label}`);
    formData.append("document", dataUrlToBlob(file.dataUrl), `${orderId}-${file.fileName}`);
    await telegramRequest(`${telegramBaseUrl}/sendDocument`, formData);
  }
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
  const baseUrl = `${req.protocol}://${req.get("host")}`;

  res.json({ orderId });

  void processOrder(orderId, body, baseUrl).catch((error) => {
    logger.error({ err: error, orderId }, "Failed to process order asynchronously");
  });
});

export default router;
