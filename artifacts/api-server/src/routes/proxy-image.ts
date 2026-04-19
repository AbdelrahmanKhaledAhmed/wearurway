import { Router, type IRouter } from "express";

const router: IRouter = Router();

const ALLOWED_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"];
const MAX_SIZE = 20 * 1024 * 1024;

router.post("/proxy-image", async (req, res) => {
  const { url } = req.body as { url?: string };

  if (!url || typeof url !== "string") {
    res.status(400).json({ error: "url is required" });
    return;
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    res.status(400).json({ error: "Invalid URL" });
    return;
  }

  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    res.status(400).json({ error: "Only http/https URLs are allowed" });
    return;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const upstream = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; WearurWay/1.0)",
        Accept: "image/*,*/*",
      },
    });
    clearTimeout(timeout);

    if (!upstream.ok) {
      res.status(502).json({ error: `Upstream returned ${upstream.status}` });
      return;
    }

    const contentType = upstream.headers.get("content-type") ?? "";
    const mime = contentType.split(";")[0].trim().toLowerCase();

    if (!ALLOWED_CONTENT_TYPES.some(t => mime.startsWith(t.split("/")[0]) && mime.includes(t.split("/")[1]))) {
      res.status(415).json({ error: "URL does not point to a supported image type" });
      return;
    }

    const chunks: Buffer[] = [];
    let totalSize = 0;
    for await (const chunk of upstream.body as AsyncIterable<Uint8Array>) {
      totalSize += chunk.byteLength;
      if (totalSize > MAX_SIZE) {
        res.status(413).json({ error: "Image is too large (max 20 MB)" });
        return;
      }
      chunks.push(Buffer.from(chunk));
    }

    const buffer = Buffer.concat(chunks);
    res.set("Content-Type", mime || "application/octet-stream");
    res.set("Content-Length", String(buffer.byteLength));
    res.set("Cache-Control", "no-store");
    res.send(buffer);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("abort")) {
      res.status(504).json({ error: "Request timed out" });
    } else {
      res.status(502).json({ error: "Failed to fetch image" });
    }
  }
});

export default router;
