import sharp from "sharp";
import { downloadBuffer } from "./storageService.js";
import { logger } from "../lib/logger.js";

export interface DesignLayerInput {
  id: string;
  name?: string;
  imageUrl: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  visible: boolean;
  naturalWidth?: number;
  naturalHeight?: number;
}

export interface DesignJobInput {
  frontLayers: DesignLayerInput[];
  backLayers: DesignLayerInput[];
  mockupSize: number;
  frontMockupImage?: string;
  backMockupImage?: string;
}

export interface RenderedDesignFile {
  fileName: string;
  contentType: string;
  buffer: Buffer;
}

const MIN_LAYER_SIZE = 10;

interface LoadedImage {
  buffer: Buffer;
  width: number;
  height: number;
}

/**
 * Resolve a layer / mockup imageUrl to raw bytes. We bypass the HTTP layer
 * for our own R2-backed routes — those would otherwise force a server-to-self
 * round-trip — and only fall back to fetch() for absolute http(s) URLs and
 * data: URIs.
 */
async function fetchImage(rawUrl: string): Promise<LoadedImage | null> {
  if (!rawUrl) return null;

  try {
    const sharedLayerMatch = rawUrl.match(/\/api\/uploads\/shared-layers\/([^/?#]+)/);
    if (sharedLayerMatch) {
      const buf = await downloadBuffer(`uploads/shared-layers/${sharedLayerMatch[1]}`);
      return buf ? withMetadata(buf) : null;
    }

    const mockupMatch = rawUrl.match(/\/api\/uploads\/mockups\/([^/?#]+)/);
    if (mockupMatch) {
      const buf = await downloadBuffer(`uploads/mockups/${mockupMatch[1]}`);
      return buf ? withMetadata(buf) : null;
    }

    if (rawUrl.startsWith("data:")) {
      const idx = rawUrl.indexOf(",");
      if (idx === -1) return null;
      const meta = rawUrl.slice(5, idx);
      const isBase64 = meta.endsWith(";base64");
      const payload = rawUrl.slice(idx + 1);
      const buf = isBase64
        ? Buffer.from(payload, "base64")
        : Buffer.from(decodeURIComponent(payload), "utf8");
      return withMetadata(buf);
    }

    if (rawUrl.startsWith("http://") || rawUrl.startsWith("https://")) {
      const res = await fetch(rawUrl);
      if (!res.ok) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      return withMetadata(buf);
    }

    if (rawUrl.startsWith("blob:")) {
      logger.warn({ rawUrl }, "designRenderer: cannot fetch browser blob: URL");
      return null;
    }

    return null;
  } catch (err) {
    logger.warn({ err, rawUrl }, "designRenderer: failed to fetch layer image");
    return null;
  }
}

async function withMetadata(buffer: Buffer): Promise<LoadedImage | null> {
  try {
    const meta = await sharp(buffer).metadata();
    if (!meta.width || !meta.height) return null;
    return { buffer, width: meta.width, height: meta.height };
  } catch (err) {
    logger.warn({ err }, "designRenderer: invalid image buffer");
    return null;
  }
}

function getLayerAspectRatio(layer: DesignLayerInput, img: LoadedImage): number {
  const naturalRatio =
    layer.naturalWidth && layer.naturalHeight && layer.naturalHeight > 0
      ? layer.naturalWidth / layer.naturalHeight
      : 0;
  if (naturalRatio > 0 && Number.isFinite(naturalRatio)) return naturalRatio;
  const imgRatio = img.width / img.height;
  if (imgRatio > 0 && Number.isFinite(imgRatio)) return imgRatio;
  const displayRatio = layer.width > 0 && layer.height > 0 ? layer.width / layer.height : 1;
  return displayRatio;
}

function getRatioLockedSize(
  layer: DesignLayerInput,
  img: LoadedImage,
  width: number,
): { width: number; height: number } {
  const aspect = getLayerAspectRatio(layer, img);
  const w = Math.max(MIN_LAYER_SIZE, width);
  return { width: w, height: Math.max(MIN_LAYER_SIZE, w / aspect) };
}

async function makeContainedShirt(
  shirt: LoadedImage,
  exportW: number,
  exportH: number,
): Promise<{ buffer: Buffer; dx: number; dy: number; dw: number; dh: number }> {
  const scale = Math.min(exportW / shirt.width, exportH / shirt.height);
  const dw = Math.max(1, Math.round(shirt.width * scale));
  const dh = Math.max(1, Math.round(shirt.height * scale));
  const dx = Math.round((exportW - dw) / 2);
  const dy = Math.round((exportH - dh) / 2);
  const resized = await sharp(shirt.buffer)
    .resize(dw, dh, { fit: "fill" })
    .png()
    .toBuffer();
  return { buffer: resized, dx, dy, dw, dh };
}

async function renderSide(
  layers: DesignLayerInput[],
  shirtUrl: string | undefined,
  mockupSize: number,
  designFileName: string,
  mockupFileName: string,
  out: RenderedDesignFile[],
): Promise<void> {
  const visible = layers.filter((l) => l.visible);
  const shirt = shirtUrl ? await fetchImage(shirtUrl) : null;
  if (visible.length === 0 && !shirt) return;

  const loaded: { l: DesignLayerInput; img: LoadedImage }[] = [];
  for (const l of visible) {
    const img = await fetchImage(l.imageUrl);
    if (img) loaded.push({ l, img });
  }
  if (visible.length > 0 && loaded.length < visible.length) {
    logger.warn(
      {
        designFileName,
        loaded: loaded.length,
        total: visible.length,
      },
      "designRenderer: some layers failed to load",
    );
  }

  // Render at exactly the mockup display size so the cloud-stored files
  // match what the customer sees on screen — no extra upscaling.
  const exportW = Math.max(1, Math.round(mockupSize));
  const exportH = Math.max(1, Math.round(mockupSize * (4 / 3)));

  const layerComposites: sharp.OverlayOptions[] = [];
  for (const { l, img } of loaded) {
    const { width: displayW, height: displayH } = getRatioLockedSize(l, img, l.width);
    const exportLayerW = Math.max(1, Math.round(displayW));
    const exportLayerH = Math.max(1, Math.round(displayH));
    const cx = l.x + displayW / 2;
    const cy = l.y + displayH / 2;

    const resized = sharp(img.buffer).resize(exportLayerW, exportLayerH, { fit: "fill" });
    const angle = Number.isFinite(l.rotation) ? l.rotation : 0;
    const pipeline =
      Math.abs(angle % 360) > 0.001
        ? resized.rotate(angle, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
        : resized;
    const result = await pipeline.png().toBuffer({ resolveWithObject: true });

    const top = Math.round(cy - result.info.height / 2);
    const left = Math.round(cx - result.info.width / 2);
    layerComposites.push({ input: result.data, top, left });
  }

  const baseDesign = sharp({
    create: {
      width: exportW,
      height: exportH,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  });
  let designBuf =
    layerComposites.length > 0
      ? await baseDesign.composite(layerComposites).png().toBuffer()
      : await baseDesign.png().toBuffer();

  let containedShirt: { buffer: Buffer; dx: number; dy: number; dw: number; dh: number } | null =
    null;
  if (shirt) {
    containedShirt = await makeContainedShirt(shirt, exportW, exportH);
    // destination-in mask: keep design pixels only where the shirt has alpha.
    // Build a same-size canvas with the shirt placed where the client would
    // draw it, then mask the design with it.
    const shirtMaskCanvas = await sharp({
      create: {
        width: exportW,
        height: exportH,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([{ input: containedShirt.buffer, top: containedShirt.dy, left: containedShirt.dx }])
      .png()
      .toBuffer();
    designBuf = await sharp(designBuf)
      .composite([{ input: shirtMaskCanvas, blend: "dest-in" }])
      .png()
      .toBuffer();
  }

  if (loaded.length > 0) {
    let trimmed: Buffer;
    try {
      trimmed = await sharp(designBuf)
        .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 0 })
        .png()
        .toBuffer();
    } catch {
      trimmed = designBuf;
    }
    out.push({ fileName: designFileName, contentType: "image/png", buffer: trimmed });
  }

  if (containedShirt) {
    const finalBuf = await sharp({
      create: {
        width: exportW,
        height: exportH,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([
        { input: containedShirt.buffer, top: containedShirt.dy, left: containedShirt.dx },
        { input: designBuf, top: 0, left: 0 },
      ])
      .png()
      .toBuffer();

    let trimmed: Buffer;
    try {
      trimmed = await sharp(finalBuf)
        .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 0 })
        .png()
        .toBuffer();
    } catch {
      trimmed = finalBuf;
    }
    out.push({ fileName: mockupFileName, contentType: "image/png", buffer: trimmed });
  }
}

/**
 * Render a CreateOrderDesignJob into the same four PNGs the client used to
 * produce on-canvas: design-front.png, mockup-front.png, design-back.png,
 * mockup-back.png. Files only appear in the output if there's something to
 * render for that side.
 */
export async function renderDesignFiles(
  job: DesignJobInput,
): Promise<RenderedDesignFile[]> {
  const out: RenderedDesignFile[] = [];
  await renderSide(
    job.frontLayers ?? [],
    job.frontMockupImage,
    job.mockupSize,
    "design-front.png",
    "mockup-front.png",
    out,
  );
  await renderSide(
    job.backLayers ?? [],
    job.backMockupImage,
    job.mockupSize,
    "design-back.png",
    "mockup-back.png",
    out,
  );
  return out;
}
