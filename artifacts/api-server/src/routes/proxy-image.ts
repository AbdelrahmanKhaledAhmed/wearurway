import { Router, type IRouter } from "express";
import sharp from "sharp";

const router: IRouter = Router();

const MAX_SIZE = 40 * 1024 * 1024;

// Mimics a real Chrome browser navigating to a page
const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "no-cache",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Ch-Ua": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
  "Sec-Ch-Ua-Mobile": "?0",
  "Sec-Ch-Ua-Platform": '"Windows"',
};

// Headers for fetching images directly from i.pinimg.com / other CDNs
const IMAGE_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: "https://www.pinterest.com/",
  "Sec-Fetch-Dest": "image",
  "Sec-Fetch-Mode": "no-cors",
  "Sec-Fetch-Site": "cross-site",
};

async function fetchBuffer(
  url: string,
  headers: Record<string, string>,
  timeoutMs = 20000,
): Promise<{ buffer: Buffer; contentType: string; status: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers, redirect: "follow" });
    clearTimeout(timer);
    const contentType = res.headers.get("content-type") ?? "";
    const status = res.status;
    if (!res.ok) throw new Error(`HTTP_${status}`);
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of res.body as AsyncIterable<Uint8Array>) {
      size += chunk.byteLength;
      if (size > MAX_SIZE) throw new Error("too_large");
      chunks.push(Buffer.from(chunk));
    }
    return { buffer: Buffer.concat(chunks), contentType, status };
  } finally {
    clearTimeout(timer);
  }
}

// ── URL helpers ──────────────────────────────────────────────────────────────

function isPinterestPinUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      (u.hostname === "www.pinterest.com" || u.hostname === "pinterest.com") &&
      /^\/pin\/\d+\/?/.test(u.pathname)
    );
  } catch { return false; }
}

function isPinterestShortUrl(url: string): boolean {
  try { return new URL(url).hostname === "pin.it"; } catch { return false; }
}

function isPinterestImageCdn(url: string): boolean {
  try {
    const h = new URL(url).hostname;
    return h === "i.pinimg.com" || h === "pinimg.com";
  } catch { return false; }
}

/** Upgrade thumbnail-size CDN paths to full originals */
function upgradeToOriginals(imageUrl: string): string {
  return imageUrl
    .replace(/\/\d+x\//, "/originals/")
    .replace(/\/\d+x\d+\//, "/originals/");
}

function extractOgImage(html: string): string | null {
  return (
    html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1] ??
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)?.[1] ??
    null
  );
}

// ── Pinterest oembed (public, no auth required) ───────────────────────────────
// Returns a direct i.pinimg.com URL from Pinterest's official oembed endpoint.

async function resolveViaOembed(pinUrl: string): Promise<string | null> {
  try {
    const oembedEndpoint = `https://www.pinterest.com/oembed.json?url=${encodeURIComponent(pinUrl)}`;
    const { buffer } = await fetchBuffer(oembedEndpoint, {
      ...BROWSER_HEADERS,
      Accept: "application/json, */*",
      Referer: "https://www.pinterest.com/",
    }, 12000);
    const json = JSON.parse(buffer.toString("utf-8")) as { thumbnail_url?: string };
    if (json.thumbnail_url) return upgradeToOriginals(json.thumbnail_url);
  } catch { /* fall through */ }
  return null;
}

// ── Pinterest HTML scrape (fallback) ─────────────────────────────────────────

async function resolveViaHtmlScrape(pinUrl: string): Promise<string | null> {
  try {
    const { buffer } = await fetchBuffer(pinUrl, BROWSER_HEADERS, 18000);
    const html = buffer.toString("utf-8");
    const imageUrl = extractOgImage(html);
    if (imageUrl) return upgradeToOriginals(imageUrl);
  } catch { /* fall through */ }
  return null;
}

// ── Main Pinterest resolver ───────────────────────────────────────────────────

async function resolvePinterestImage(pinUrl: string): Promise<Buffer> {
  // Strategy 1: oembed API (fastest, most reliable)
  const oembedUrl = await resolveViaOembed(pinUrl);
  if (oembedUrl) {
    try {
      const { buffer } = await fetchBuffer(oembedUrl, IMAGE_HEADERS, 20000);
      return buffer;
    } catch { /* try next */ }
  }

  // Strategy 2: HTML scrape for og:image
  const scrapedUrl = await resolveViaHtmlScrape(pinUrl);
  if (scrapedUrl) {
    try {
      const { buffer } = await fetchBuffer(scrapedUrl, IMAGE_HEADERS, 20000);
      return buffer;
    } catch { /* fail below */ }
  }

  throw new Error(
    "Could not retrieve the image from this Pinterest pin. " +
    "Try right-clicking the image on Pinterest, choosing 'Open image in new tab', " +
    "then paste that URL here instead.",
  );
}

async function resolveShortUrl(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(url, { redirect: "follow", signal: controller.signal, headers: BROWSER_HEADERS });
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

// ── Route ─────────────────────────────────────────────────────────────────────

router.post("/proxy-image", async (req, res) => {
  const { url } = req.body as { url?: string };

  if (!url || typeof url !== "string") {
    res.status(400).json({ error: "url is required" });
    return;
  }

  let targetUrl = url.trim();

  try { new URL(targetUrl); } catch {
    res.status(400).json({ error: "Invalid URL" });
    return;
  }

  if (!targetUrl.startsWith("http://") && !targetUrl.startsWith("https://")) {
    res.status(400).json({ error: "Only http/https URLs are allowed" });
    return;
  }

  try {
    // Resolve short URLs (pin.it/…)
    if (isPinterestShortUrl(targetUrl)) {
      targetUrl = await resolveShortUrl(targetUrl);
    }

    let imageBuffer: Buffer;

    if (isPinterestPinUrl(targetUrl)) {
      // Pin page URL — extract actual image via oembed + fallback scrape
      imageBuffer = await resolvePinterestImage(targetUrl);
    } else if (isPinterestImageCdn(targetUrl)) {
      // Direct CDN URL — upgrade to originals and fetch
      const upgraded = upgradeToOriginals(targetUrl);
      const { buffer } = await fetchBuffer(upgraded, IMAGE_HEADERS, 20000);
      imageBuffer = buffer;
    } else {
      // Any other URL (e.g. direct image URL from another site)
      const { buffer, contentType } = await fetchBuffer(targetUrl, IMAGE_HEADERS, 20000);
      const mime = contentType.split(";")[0].trim().toLowerCase();
      if (
        mime !== "" &&
        mime !== "application/octet-stream" &&
        !mime.startsWith("image/")
      ) {
        res.status(415).json({
          error:
            "That URL doesn't appear to point to an image. For Pinterest, paste the pin URL (pinterest.com/pin/…) or right-click the image on Pinterest and paste the direct image address.",
        });
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
      res.status(504).json({ error: "Pinterest took too long to respond. Please try again." });
    } else if (msg.includes("too_large")) {
      res.status(413).json({ error: "Image is too large (max 40 MB)." });
    } else if (msg.includes("Could not retrieve")) {
      res.status(422).json({ error: msg });
    } else {
      res.status(502).json({
        error:
          "Could not download the image from this URL. Try right-clicking the image on Pinterest, " +
          "selecting 'Open image in new tab', and pasting that URL here instead.",
      });
    }
  }
});

export default router;
