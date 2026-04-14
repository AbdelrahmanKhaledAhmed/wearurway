import { Router, type IRouter } from "express";
import { getStore } from "../data/store.js";

const router: IRouter = Router();

interface CreateOrderBody {
  name?: string;
  phone?: string;
  address?: string;
  size?: {
    name?: string;
    realWidth?: number;
    realHeight?: number;
  };
  color?: string;
  total?: number;
  frontImage?: string;
  backImage?: string;
}

function generateOrderId(): string {
  return `WW-${Math.floor(10000 + Math.random() * 90000)}`;
}

function dataUrlToBlob(dataUrl: string): Blob {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error("Invalid image data");
  const [, mimeType, base64] = match;
  return new Blob([Buffer.from(base64, "base64")], { type: mimeType });
}

async function telegramRequest(url: string, body: URLSearchParams | FormData) {
  const response = await fetch(url, { method: "POST", body });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) {
    const description = data?.description ? `: ${data.description}` : "";
    throw new Error(`Telegram request failed${description}`);
  }
}

router.post("/create-order", async (req, res) => {
  const body = req.body as CreateOrderBody;
  const settings = getStore().orderSettings;
  const botToken = settings.telegramBotToken || process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
  const chatId = settings.telegramChatId || process.env.CHAT_ID || process.env.TELEGRAM_CHAT_ID;

  if (!botToken || !chatId) {
    res.status(500).json({ error: "Telegram bot token or chat ID is not configured" });
    return;
  }

  if (!body.name || !body.phone || !body.address || !body.size?.name || !body.color || body.total === undefined) {
    res.status(400).json({ error: "Missing required order fields" });
    return;
  }

  const orderId = generateOrderId();
  const sizeDetails = `${body.size.name} (${body.size.realWidth ?? "-"}x${body.size.realHeight ?? "-"} cm)`;
  const message = [
    `Order ID: ${orderId}`,
    "New Order:",
    `Name: ${body.name}`,
    `Phone: ${body.phone}`,
    `Address: ${body.address}`,
    `Size: ${sizeDetails}`,
    `Color: ${body.color}`,
    `Total: ${body.total}`,
  ].join("\n");

  const baseUrl = `https://api.telegram.org/bot${botToken}`;

  try {
    await telegramRequest(
      `${baseUrl}/sendMessage`,
      new URLSearchParams({
        chat_id: chatId,
        text: message,
      }),
    );

    const documents = [
      { label: "front", dataUrl: body.frontImage },
      { label: "back", dataUrl: body.backImage },
    ].filter((file): file is { label: string; dataUrl: string } => Boolean(file.dataUrl));

    for (const file of documents) {
      const formData = new FormData();
      formData.append("chat_id", chatId);
      formData.append("caption", `${orderId} ${file.label}`);
      formData.append("document", dataUrlToBlob(file.dataUrl), `${orderId}-${file.label}.png`);
      await telegramRequest(`${baseUrl}/sendDocument`, formData);
    }

    res.json({ orderId });
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : "Failed to submit order" });
  }
});

export default router;