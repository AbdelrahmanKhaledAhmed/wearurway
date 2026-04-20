import { Router, type IRouter } from "express";
import sharp from "sharp";

const router: IRouter = Router();
const MAX_SIZE = 40 * 1024 * 1024;

// ── Fetch helpers ─────────────────────────────────────────────────────────────

async function fetchBuffer(
  url: string,
  headers: Record<string, string>,
  timeoutMs = 20000,
): Promise<{ buffer: Buffer; contentType: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers, redirect: "follow" });
    clearTimeout(timer);
    const contentType = res.headers.get("content-type") ?? "";
    if (!res.ok) throw new Error(`HTTP_${res.status}`);
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

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const BASE_HEADERS: Record<string, string> = {
  "User-Agent": BROWSER_UA,
  "Accept-Language": "en-US,en;q=0.9",
};

// ── URL classifiers ───────────────────────────────────────────────────────────

function getPinId(url: string): string | null {
  try {
    const match = new URL(url).pathname.match(/\/pin\/(\d+)/);
    return match?.[1] ?? null;
  } catch { return null; }
}

function isPinterestDomain(url: string): boolean {
  try {
    const h = new URL(url).hostname;
    return h === "pinterest.com" || h === "www.pinterest.com" || h === "pin.it";
  } catch { return false; }
}

function isPinImageCdn(url: string): boolean {
  try { return new URL(url).hostname === "i.pinimg.com"; } catch { return false; }
}

function upgradeToOriginals(u: string): string {
  return u.replace(/\/\d+x\//, "/originals/").replace(/\/\d+x\d+\//, "/originals/");
}

// ── Image resolution strategies ───────────────────────────────────────────────

/**
 * Pinterest Widget API — used to power pin embeds on external sites.
 * Does not require authentication and is less bot-restricted than the main site.
 */
async function resolveViaWidgetApi(pinId: string): Promise<string | null> {
  try {
    const url = `https://widgets.pinterest.com/v3/pidgets/pins/info/?pin_ids=${pinId}`;
    const { buffer } = await fetchBuffer(url, {
      ...BASE_HEADERS,
      Accept: "application/json, */*",
      Referer: "https://www.pinterest.com/",
    }, 12000);
    const json = JSON.parse(buffer.toString("utf-8")) as {
      data?: Array<{ images?: { orig?: { url?: string }; "736x"?: { url?: string } } }>;
    };
    const pin = json?.data?.[0];
    const imageUrl =
      pin?.images?.orig?.url ??
      pin?.images?.["736x"]?.url ??
      null;
    if (imageUrl) return upgradeToOriginals(imageUrl);
  } catch { /* fall through */ }
  return null;
}

/** Pinterest oembed — public endpoint, returns thumbnail_url */
async function resolveViaOembed(pinUrl: string): Promise<string | null> {
  try {
    const url = `https://www.pinterest.com/oembed.json?url=${encodeURIComponent(pinUrl)}`;
    const { buffer } = await fetchBuffer(url, {
      ...BASE_HEADERS,
      Accept: "application/json, */*",
      Referer: "https://www.pinterest.com/",
    }, 12000);
    const json = JSON.parse(buffer.toString("utf-8")) as { thumbnail_url?: string };
    if (json?.thumbnail_url) return upgradeToOriginals(json.thumbnail_url);
  } catch { /* fall through */ }
  return null;
}

/** Pinterest HTML og:image scrape — last resort */
async function resolveViaHtmlScrape(pinUrl: string): Promise<string | null> {
  try {
    const { buffer } = await fetchBuffer(pinUrl, {
      ...BASE_HEADERS,
      Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
      "Cache-Control": "no-cache",
    }, 18000);
    const html = buffer.toString("utf-8");
    const match =
      html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ??
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    if (match?.[1]) return upgradeToOriginals(match[1]);
  } catch { /* fall through */ }
  return null;
}

/**
 * Resolve short URL (pin.it/…) via redirect follow.
 */
async function resolveShortUrl(url: string): Promise<string> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(url, { redirect: "follow", signal: controller.signal, headers: BASE_HEADERS });
    clearTimeout(t);
    return res.url;
  } finally { clearTimeout(t); }
}

/**
 * Fetch an image URL through wsrv.nl — a public image-proxy CDN that
 * fetches on our behalf, bypassing Pinterest CDN IP restrictions.
 */
async function fetchViaWsrv(imageUrl: string): Promise<Buffer> {
  // wsrv.nl accepts URL without protocol prefix
  const bare = imageUrl.replace(/^https?:\/\//, "");
  const wsrvUrl = `https://wsrv.nl/?url=${encodeURIComponent(bare)}&output=jpg&q=95&maxage=1d`;
  const { buffer } = await fetchBuffer(wsrvUrl, {
    ...BASE_HEADERS,
    Accept: "image/*,*/*;q=0.8",
  }, 30000);
  return buffer;
}

/** Try to fetch an i.pinimg.com URL directly, then fall back to wsrv.nl proxy. */
async function fetchPinImage(imageUrl: string): Promise<Buffer> {
  // First: direct fetch (fast, no third-party)
  try {
    const { buffer } = await fetchBuffer(imageUrl, {
      ...BASE_HEADERS,
      Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      Referer: "https://www.pinterest.com/",
    }, 20000);
    return buffer;
  } catch { /* fall through to proxy */ }

  // Second: route through wsrv.nl proxy
  return fetchViaWsrv(imageUrl);
}

async function convertToPng(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer)
    .png({ quality: 100, compressionLevel: 1, adaptiveFiltering: false })
    .toBuffer();
}

// ── Main resolver ─────────────────────────────────────────────────────────────

async function resolveAndFetch(rawUrl: string): Promise<Buffer> {
  let targetUrl = rawUrl;

  // Resolve short URLs first
  if (new URL(targetUrl).hostname === "pin.it") {
    targetUrl = await resolveShortUrl(targetUrl);
  }

  // Direct CDN URL — fetch it
  if (isPinImageCdn(targetUrl)) {
    return fetchPinImage(upgradeToOriginals(targetUrl));
  }

  // Pin page URL — extract image URL through multiple strategies
  const pinId = getPinId(targetUrl);

  if (pinId) {
    // Strategy 1: Widget API (returns direct CDN URL, low bot detection)
    const widgetUrl = await resolveViaWidgetApi(pinId);
    if (widgetUrl) return fetchPinImage(widgetUrl);

    // Strategy 2: oembed
    const oembedUrl = await resolveViaOembed(targetUrl);
    if (oembedUrl) return fetchPinImage(oembedUrl);

    // Strategy 3: HTML scrape
    const scrapedUrl = await resolveViaHtmlScrape(targetUrl);
    if (scrapedUrl) return fetchPinImage(scrapedUrl);

    // Strategy 4: Construct likely CDN URL from pin ID and proxy it
    // Pinterest CDN path format: /originals/<xx>/<yy>/<zz>/<filename>
    // We can't guess the path but we can try wsrv.nl with the pin page URL itself
    // which sometimes resolves for image-type responses
    try {
      return await fetchViaWsrv(targetUrl);
    } catch { /* fall through */ }
  }

  // Non-Pinterest URL — fetch directly
  if (!isPinterestDomain(targetUrl)) {
    const { buffer, contentType } = await fetchBuffer(targetUrl, {
      ...BASE_HEADERS,
      Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    }, 20000);
    const mime = contentType.split(";")[0].trim().toLowerCase();
    if (mime && mime !== "application/octet-stream" && !mime.startsWith("image/")) {
      throw new Error("not_image");
    }
    return buffer;
  }

  throw new Error("unresolvable");
}

// ── Route ─────────────────────────────────────────────────────────────────────

router.post("/proxy-image", async (req, res) => {
  const { url } = req.body as { url?: string };

  if (!url || typeof url !== "string") {
    res.status(400).json({ error: "url is required" });
    return;
  }

  const targetUrl = url.trim();

  try { new URL(targetUrl); } catch {
    res.status(400).json({ error: "Invalid URL" });
    return;
  }

  if (!targetUrl.startsWith("http://") && !targetUrl.startsWith("https://")) {
    res.status(400).json({ error: "Only http/https URLs are allowed" });
    return;
  }

  try {
    const imageBuffer = await resolveAndFetch(targetUrl);
    const pngBuffer = await convertToPng(imageBuffer);

    res.set("Content-Type", "image/png");
    res.set("Content-Length", String(pngBuffer.byteLength));
    res.set("Cache-Control", "no-store");
    res.send(pngBuffer);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("abort") || msg.includes("timed out")) {
      res.status(504).json({ error: "Timed out fetching image." });
    } else if (msg.includes("too_large")) {
      res.status(413).json({ error: "Image too large (max 40 MB)." });
    } else if (msg.includes("not_image")) {
      res.status(415).json({ error: "URL does not point to an image." });
    } else {
      res.status(502).json({ error: "Could not fetch image." });
    }
  }
});

export default router;
