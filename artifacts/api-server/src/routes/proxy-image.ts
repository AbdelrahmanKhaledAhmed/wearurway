import { Router, type IRouter } from "express";
import sharp from "sharp";

const router: IRouter = Router();

const MAX_SIZE = 40 * 1024 * 1024;

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  "Cache-Control": "no-cache",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
};

const IMAGE_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: "https://www.pinterest.com/",
};

async function fetchBuffer(url: string, headers: Record<string, string>, timeoutMs = 20000): Promise<{ buffer: Buffer; contentType: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const contentType = res.headers.get("content-type") ?? "";
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of res.body as AsyncIterable<Uint8Array>) {
      size += chunk.byteLength;
      if (size > MAX_SIZE) throw new Error("too_large");
      chunks.push(Buffer.from(chunk));
    }
    return { buffer: Buffer.concat(chunks), contentType };
  } finally {
    clearTimeout(timer);
  }
}

function isPinterestPinUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      (u.hostname === "www.pinterest.com" || u.hostname === "pinterest.com") &&
      /^\/pin\/\d+\/?$/.test(u.pathname)
    );
  } catch {
    return false;
  }
}

function isPinterestShortUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.hostname === "pin.it";
  } catch {
    return false;
  }
}

function extractOgImage(html: string): string | null {
  const match = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
    ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  return match?.[1] ?? null;
}

function upgradeToOriginals(imageUrl: string): string {
  return imageUrl
    .replace(/\/\d+x\//, "/originals/")
    .replace(/\/\d+x\d+\//, "/originals/");
}

async function resolvePinterestImage(pinUrl: string): Promise<Buffer> {
  const { buffer: html } = await fetchBuffer(pinUrl, BROWSER_HEADERS, 20000);
  const htmlStr = html.toString("utf-8");

  let imageUrl = extractOgImage(htmlStr);
  if (!imageUrl) throw new Error("Could not find image in Pinterest pin. Try copying the direct image URL instead.");

  imageUrl = upgradeToOriginals(imageUrl);

  const { buffer } = await fetchBuffer(imageUrl, IMAGE_HEADERS, 20000);
  return buffer;
}

async function resolveShortUrl(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: BROWSER_HEADERS,
    });
    clearTimeout(timer);
    return res.url;
  } finally {
    clearTimeout(timer);
  }
}

async function convertToPng(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer)
    .png({ quality: 100, compressionLevel: 1, adaptiveFiltering: false })
    .toBuffer();
}

router.post("/proxy-image", async (req, res) => {
  const { url } = req.body as { url?: string };

  if (!url || typeof url !== "string") {
    res.status(400).json({ error: "url is required" });
    return;
  }

  let targetUrl = url.trim();

  try {
    new URL(targetUrl);
  } catch {
    res.status(400).json({ error: "Invalid URL" });
    return;
  }

  if (!targetUrl.startsWith("http://") && !targetUrl.startsWith("https://")) {
    res.status(400).json({ error: "Only http/https URLs are allowed" });
    return;
  }

  try {
    // Resolve short URLs first
    if (isPinterestShortUrl(targetUrl)) {
      targetUrl = await resolveShortUrl(targetUrl);
    }

    let imageBuffer: Buffer;

    if (isPinterestPinUrl(targetUrl)) {
      imageBuffer = await resolvePinterestImage(targetUrl);
    } else {
      const { buffer, contentType } = await fetchBuffer(targetUrl, IMAGE_HEADERS);
      const mime = contentType.split(";")[0].trim().toLowerCase();
      if (!mime.startsWith("image/") && mime !== "application/octet-stream" && mime !== "") {
        res.status(415).json({ error: "URL does not point to an image. For Pinterest, paste the pin page URL (pinterest.com/pin/…) or the direct image URL." });
        return;
      }
      imageBuffer = buffer;
    }

    const pngBuffer = await convertToPng(imageBuffer);

    res.set("Content-Type", "image/png");
    res.set("Content-Length", String(pngBuffer.byteLength));
    res.set("Cache-Control", "no-store");
    res.send(pngBuffer);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("abort") || msg.includes("timed out")) {
      res.status(504).json({ error: "Request timed out fetching image." });
    } else if (msg.includes("too_large")) {
      res.status(413).json({ error: "Image is too large (max 40 MB)." });
    } else if (msg.includes("Could not find")) {
      res.status(422).json({ error: msg });
    } else {
      res.status(502).json({ error: "Failed to fetch image. Try uploading it directly instead." });
    }
  }
});

export default router;
