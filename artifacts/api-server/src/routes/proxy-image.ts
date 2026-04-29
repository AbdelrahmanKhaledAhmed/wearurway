import { Router, type IRouter } from "express";
import sharp from "sharp";

const router: IRouter = Router();
const MAX_SIZE = 40 * 1024 * 1024;

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

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
    if (!res.ok) throw new Error(`HTTP_${res.status}`);
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

// ── URL helpers ───────────────────────────────────────────────────────────────

function getPinId(url: string): string | null {
  try {
    const match = new URL(url).pathname.match(/\/pin\/(\d+)/);
    return match?.[1] ?? null;
  } catch { return null; }
}

function isPinImageCdn(url: string): boolean {
  try { return new URL(url).hostname === "i.pinimg.com"; } catch { return false; }
}

function isShortUrl(url: string): boolean {
  try { return new URL(url).hostname === "pin.it"; } catch { return false; }
}

function upgradeToOriginals(u: string): string {
  return u.replace(/\/\d+x[^/]*\//, "/originals/");
}

// ── Extract i.pinimg.com image URLs from Pinterest HTML ───────────────────────
// Pinterest embeds a Redux state JSON in the page with plain (un-escaped)
// https://i.pinimg.com/... URLs. We extract all of them and prefer originals.

function extractPinImgUrls(html: string): string[] {
  // Match plain https://i.pinimg.com/... URLs (not JSON-escaped — Pinterest
  // SSR embeds them as raw JSON strings terminated by a quote character).
  const re = /https:\/\/i\.pinimg\.com\/[^"' \t\r\n<>\\]+/g;
  const seen = new Set<string>();
  const originals: string[] = [];
  const x736: string[] = [];
  const x474: string[] = [];
  const rest: string[] = [];

  for (const match of html.matchAll(re)) {
    const u = match[0];
    // Skip script/style assets and tiny profile/avatar thumbnails
    if (/\.(css|js|svg|ico|woff|ttf)(\?|$)/i.test(u)) continue;
    if (/_RS\/|\/\d{1,2}x\d{1,2}\/|\/30x|\/60x|\/75x|\/140x/.test(u)) continue;
    if (seen.has(u)) continue;
    seen.add(u);

    if (/\/originals\//i.test(u)) originals.push(u);
    else if (/\/736x\//i.test(u)) x736.push(u);
    else if (/\/474x\//i.test(u)) x474.push(u);
    else rest.push(u);
  }

  return [...originals, ...x736, ...x474, ...rest];
}

// ── Fetch via wsrv.nl image-proxy CDN ────────────────────────────────────────
// i.pinimg.com returns 403 for direct fetches from Replit IPs.
// wsrv.nl is a public image-proxy CDN that Pinterest doesn't block.
// Confirmed working: wsrv.nl returns 200 for originals-sized pinimg URLs.
//
// IMPORTANT: the url param must be host+path WITHOUT protocol prefix and
// WITHOUT percent-encoding the slashes — wsrv.nl requires raw forward slashes.

async function fetchViaWsrv(imageUrl: string): Promise<Buffer> {
  const bare = imageUrl.replace(/^https?:\/\//, "");

  // Try wsrv.nl first — public proxy that bypasses Pinterest's IP blocks
  try {
    const wsrvUrl = `https://wsrv.nl/?url=${bare}&output=png&n=-1`;
    const { buffer } = await fetchBuffer(wsrvUrl, {
      "User-Agent": BROWSER_UA,
      Accept: "image/*,*/*;q=0.8",
    }, 30000);
    return buffer;
  } catch { /* fall through to alternatives */ }

  // Fallback: try 736x size if originals failed (smaller but widely available)
  const fallbackUrl = imageUrl.replace(/\/originals\//, "/736x/");
  if (fallbackUrl !== imageUrl) {
    try {
      const bareFallback = fallbackUrl.replace(/^https?:\/\//, "");
      const wsrvFallback = `https://wsrv.nl/?url=${bareFallback}&output=png&n=-1`;
      const { buffer } = await fetchBuffer(wsrvFallback, {
        "User-Agent": BROWSER_UA,
        Accept: "image/*,*/*;q=0.8",
      }, 25000);
      return buffer;
    } catch { /* fall through */ }
  }

  // Last resort: direct fetch (works for some pinimg.com images)
  const { buffer } = await fetchBuffer(imageUrl, {
    "User-Agent": BROWSER_UA,
    Accept: "image/*,*/*;q=0.8",
    Referer: "https://www.pinterest.com/",
    "sec-fetch-dest": "image",
    "sec-fetch-mode": "no-cors",
    "sec-fetch-site": "cross-site",
  }, 25000);
  return buffer;
}

// ── Pinterest oEmbed API ──────────────────────────────────────────────────────
// Most reliable: Pinterest exposes a public oEmbed endpoint that returns
// structured JSON including a thumbnail_url pointing to i.pinimg.com.

async function fetchViaOEmbed(pinUrl: string): Promise<string | null> {
  try {
    const endpoint = `https://www.pinterest.com/oembed.json?url=${encodeURIComponent(pinUrl)}`;
    const { buffer } = await fetchBuffer(endpoint, {
      "User-Agent": BROWSER_UA,
      Accept: "application/json",
      "Accept-Language": "en-US,en;q=0.9",
    }, 12000);
    const json = JSON.parse(buffer.toString("utf-8")) as Record<string, unknown>;
    const thumb = typeof json.thumbnail_url === "string" ? json.thumbnail_url : null;
    if (thumb && thumb.includes("pinimg.com")) return upgradeToOriginals(thumb);
  } catch { /* fall through */ }
  return null;
}

// ── Pinterest pin page scrape ─────────────────────────────────────────────────

async function scrapePinPage(pinUrl: string): Promise<string | null> {
  // Strategy 1: oEmbed API — most reliable, works even when HTML is JS-rendered
  const oembed = await fetchViaOEmbed(pinUrl);
  if (oembed) return oembed;

  // Strategy 2: AMP page — much simpler HTML, more likely to contain image data
  try {
    const ampUrl = pinUrl.replace(/\/?$/, "?amp=1");
    const { buffer: ampBuf } = await fetchBuffer(ampUrl, {
      "User-Agent": BROWSER_UA,
      Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    }, 12000);
    const ampHtml = ampBuf.toString("utf-8");
    const ampUrls = extractPinImgUrls(ampHtml);
    if (ampUrls.length > 0) return ampUrls[0];
    const ogAmp =
      ampHtml.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1] ??
      ampHtml.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)?.[1];
    if (ogAmp) return upgradeToOriginals(ogAmp);
  } catch { /* fall through */ }

  // Strategy 3: Full HTML scrape fallback
  try {
    const { buffer } = await fetchBuffer(pinUrl, {
      "User-Agent": BROWSER_UA,
      Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "no-cache",
    }, 18000);
    const html = buffer.toString("utf-8");
    const urls = extractPinImgUrls(html);
    if (urls.length > 0) return urls[0];
    const og =
      html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1] ??
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)?.[1];
    if (og) return upgradeToOriginals(og);
  } catch { /* fall through */ }

  return null;
}

// ── Short URL resolution ──────────────────────────────────────────────────────

// Reduce a resolved Pinterest URL to its canonical `/pin/<id>/` form.
// pin.it redirects often land on `/pin/<id>/sent/?invite_code=…&sender_id=…`,
// which can confuse Pinterest's oEmbed and the HTML scraper. Stripping the
// trailing path segments and query string lets the rest of the pipeline
// behave the same as if the user had pasted the canonical pin URL.
function canonicalizePinUrl(resolved: string): string {
  try {
    const u = new URL(resolved);
    const m = u.pathname.match(/\/pin\/(\d+)/);
    if (!m) return resolved;
    return `${u.protocol}//${u.host}/pin/${m[1]}/`;
  } catch { return resolved; }
}

async function resolveShortUrl(url: string): Promise<string> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(url, {
      redirect: "follow", signal: controller.signal,
      headers: {
        "User-Agent": BROWSER_UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    clearTimeout(t);
    return res.url;
  } finally { clearTimeout(t); }
}

// ── PNG conversion ────────────────────────────────────────────────────────────

async function convertToPng(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer)
    .png({ quality: 100, compressionLevel: 1, adaptiveFiltering: false })
    .toBuffer();
}

// ── Main resolver ─────────────────────────────────────────────────────────────

async function resolveAndFetch(rawUrl: string): Promise<Buffer> {
  let targetUrl = rawUrl;

  // 1. Resolve pin.it short links (re-resolve a couple of times in case the
  // first hop lands on another shortener) and canonicalize to the clean
  // /pin/<id>/ form so oEmbed and scraping work reliably.
  for (let i = 0; i < 3 && isShortUrl(targetUrl); i++) {
    targetUrl = await resolveShortUrl(targetUrl);
  }
  if (getPinId(targetUrl) !== null) {
    targetUrl = canonicalizePinUrl(targetUrl);
  }

  // 2. Direct i.pinimg.com CDN URL → upgrade to originals, fetch via wsrv.nl
  if (isPinImageCdn(targetUrl)) {
    return fetchViaWsrv(upgradeToOriginals(targetUrl));
  }

  // 3. Pinterest pin page URL → scrape HTML for CDN URL, then wsrv.nl
  if (getPinId(targetUrl) !== null) {
    const cdnUrl = await scrapePinPage(targetUrl);
    if (cdnUrl) return fetchViaWsrv(cdnUrl);
    throw new Error("pin_not_found");
  }

  // 4. Any other URL — fetch directly (non-Pinterest)
  const { buffer, contentType } = await fetchBuffer(targetUrl, {
    "User-Agent": BROWSER_UA,
    Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
  }, 20000);
  const mime = contentType.split(";")[0].trim().toLowerCase();
  if (mime && mime !== "application/octet-stream" && !mime.startsWith("image/")) {
    throw new Error("not_image");
  }
  return buffer;
}

// ── Route ─────────────────────────────────────────────────────────────────────

router.post("/proxy-image", async (req, res) => {
  const { url } = req.body as { url?: string };
  if (!url || typeof url !== "string") { res.status(400).json({ error: "url is required" }); return; }

  const targetUrl = url.trim();
  try { new URL(targetUrl); } catch { res.status(400).json({ error: "Invalid URL" }); return; }
  if (!targetUrl.startsWith("http://") && !targetUrl.startsWith("https://")) {
    res.status(400).json({ error: "Only http/https URLs are allowed" }); return;
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
      res.status(504).json({ error: "Timed out." });
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
