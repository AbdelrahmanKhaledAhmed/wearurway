export interface DesignLayerForExport {
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

export interface DesignExportFile {
  fileName: string;
  dataUrl: string;
}

export interface DesignExportBlob {
  fileName: string;
  blob: Blob;
  contentType: string;
}

interface GenerateDesignExportFilesOptions {
  frontLayers: DesignLayerForExport[];
  backLayers: DesignLayerForExport[];
  mockupSize: number;
  clipW?: number;
  clipH?: number;
  frontMockupImage?: string;
  backMockupImage?: string;
}

const MIN_LAYER_SIZE = 10;
const CHECKOUT_EXPORT_DB = "wearurway-checkout-exports";
const CHECKOUT_EXPORT_STORE = "exports";
const CHECKOUT_EXPORT_KEY = "latest";

// ── Fixed export base — identical on every device (desktop, mobile, tablet).
// Layer coordinates are remapped from clipW/clipH space into this fixed space
// so output is always the same regardless of the screen the user designed on.
const EXPORT_BASE_W = 800;
const EXPORT_BASE_H = Math.round(EXPORT_BASE_W * (4 / 3)); // 1067

// design-front/back.png — maximum scale for DTF printing.
// 800 × 16 = 12,800px — far exceeds any print requirement.
const DESIGN_EXPORT_SCALE = 4;

// mockup-front/back.png — reference preview only, not sent to printer.
// 800 × 4 = 3,200px — sharp enough to review, reasonable file size.
const MOCKUP_EXPORT_SCALE = 2;

async function loadImg(src: string): Promise<HTMLImageElement | null> {
  try {
    const res = await fetch(src);
    if (!res.ok) return null;
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => { URL.revokeObjectURL(blobUrl); resolve(i); };
      i.onerror = () => { URL.revokeObjectURL(blobUrl); reject(); };
      i.src = blobUrl;
    });
  } catch {
    return null;
  }
}

function getLayerAspectRatio(layer: DesignLayerForExport) {
  const naturalRatio =
    (layer.naturalWidth ?? 0) > 0 && (layer.naturalHeight ?? 0) > 0
      ? (layer.naturalWidth ?? 0) / (layer.naturalHeight ?? 1)
      : 0;
  const displayRatio =
    layer.width > 0 && layer.height > 0
      ? layer.width / layer.height
      : 1;
  return Number.isFinite(naturalRatio) && naturalRatio > 0
    ? naturalRatio
    : displayRatio;
}

function getRatioLockedSize(layer: DesignLayerForExport, width: number) {
  const aspect = getLayerAspectRatio(layer);
  const nextW = Math.max(MIN_LAYER_SIZE, width);
  return {
    width: nextW,
    height: Math.max(MIN_LAYER_SIZE, nextW / aspect),
  };
}

function trimCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const ctx = src.getContext("2d");
  if (!ctx) return src;
  const { width, height } = src;
  const { data } = ctx.getImageData(0, 0, width, height);
  const idx = (x: number, y: number) => (y * width + x) * 4 + 3;

  let top = -1;
  for (let y = 0; y < height && top === -1; y++)
    for (let x = 0; x < width; x++)
      if (data[idx(x, y)] > 0) { top = y; break; }
  if (top === -1) return src;

  let bottom = top;
  for (let y = height - 1; y > bottom; y--)
    for (let x = 0; x < width; x++)
      if (data[idx(x, y)] > 0) { bottom = y; break; }

  let left = width - 1;
  for (let x = 0; x < left; x++)
    for (let y = top; y <= bottom; y++)
      if (data[idx(x, y)] > 0) { left = x; break; }

  let right = left;
  for (let x = width - 1; x > right; x--)
    for (let y = top; y <= bottom; y++)
      if (data[idx(x, y)] > 0) { right = x; break; }

  const trimW = right - left + 1;
  const trimH = bottom - top + 1;
  const trimmed = document.createElement("canvas");
  trimmed.width = trimW;
  trimmed.height = trimH;
  trimmed.getContext("2d")!.drawImage(src, left, top, trimW, trimH, 0, 0, trimW, trimH);
  return trimmed;
}

function drawContain(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  canvasW: number,
  canvasH: number,
) {
  const scale = Math.min(canvasW / img.naturalWidth, canvasH / img.naturalHeight);
  const dw = img.naturalWidth * scale;
  const dh = img.naturalHeight * scale;
  const dx = (canvasW - dw) / 2;
  const dy = (canvasH - dh) / 2;
  ctx.drawImage(img, dx, dy, dw, dh);
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise(resolve => {
    canvas.toBlob(blob => resolve(blob), "image/png");
  });
}

function canvasToDataUrl(canvas: HTMLCanvasElement): Promise<string | null> {
  return new Promise(resolve => {
    canvas.toBlob(blob => {
      if (!blob) { resolve(null); return; }
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    }, "image/png");
  });
}

// ── Core composite renderer.
// clipW/clipH = the coordinate space layers were placed in (from getClipDims).
// Layers are remapped into EXPORT_BASE_W×EXPORT_BASE_H before scaling,
// so output is identical regardless of device.
async function renderComposite(
  visibleLayers: DesignLayerForExport[],
  shirtImg: HTMLImageElement | null,
  clipW: number,
  clipH: number,
  designScale: number,
  mockupScale: number,
): Promise<{ designCanvas: HTMLCanvasElement | null; mockupCanvas: HTMLCanvasElement | null }> {
  // Remap layer coords from clip space → fixed export base space
  const coordScaleX = EXPORT_BASE_W / clipW;
  const coordScaleY = EXPORT_BASE_H / clipH;

  const loaded = (
    await Promise.all(visibleLayers.map(async l => ({ l, img: await loadImg(l.imageUrl) })))
  ).filter((x): x is { l: DesignLayerForExport; img: HTMLImageElement } => x.img !== null);

  if (loaded.length < visibleLayers.length) {
    console.warn(
      `[design-export] ${visibleLayers.length - loaded.length} of ${visibleLayers.length} layers failed to load`,
    );
  }

  // ── Design canvas (high res, DTF print quality) ──
  let designCanvas: HTMLCanvasElement | null = null;
  if (loaded.length > 0) {
    const dW = EXPORT_BASE_W * designScale;
    const dH = EXPORT_BASE_H * designScale;
    const dc = document.createElement("canvas");
    dc.width = dW;
    dc.height = dH;
    const dctx = dc.getContext("2d")!;
    dctx.imageSmoothingEnabled = true;
    dctx.imageSmoothingQuality = "high";
    dctx.scale(designScale, designScale);

    for (const { l: layer, img } of loaded) {
      const { width: displayW, height: displayH } = getRatioLockedSize(layer, layer.width);
      // Remap position from clip space → export base space
      const exportW = displayW * coordScaleX;
      const exportH = displayH * coordScaleY;
      const cx = (layer.x + displayW / 2) * coordScaleX;
      const cy = (layer.y + displayH / 2) * coordScaleY;
      const angle = (layer.rotation * Math.PI) / 180;
      dctx.save();
      dctx.translate(cx, cy);
      dctx.rotate(angle);
      // Draw the image at its native resolution mapped to export space
      dctx.drawImage(img, -exportW / 2, -exportH / 2, exportW, exportH);
      dctx.restore();
    }

    // Clip to shirt shape
    if (shirtImg) {
      dctx.globalCompositeOperation = "destination-in";
      drawContain(dctx, shirtImg, EXPORT_BASE_W, EXPORT_BASE_H);
      dctx.globalCompositeOperation = "source-over";
    }

    designCanvas = trimCanvas(dc);
  }

  // ── Mockup canvas (lower res, reference preview) ──
  let mockupCanvas: HTMLCanvasElement | null = null;
  if (shirtImg) {
    const mW = EXPORT_BASE_W * mockupScale;
    const mH = EXPORT_BASE_H * mockupScale;
    const mc = document.createElement("canvas");
    mc.width = mW;
    mc.height = mH;
    const mctx = mc.getContext("2d")!;
    mctx.imageSmoothingEnabled = true;
    mctx.imageSmoothingQuality = "high";
    mctx.scale(mockupScale, mockupScale);

    // Draw shirt
    drawContain(mctx, shirtImg, EXPORT_BASE_W, EXPORT_BASE_H);

    // Draw layers on top at mockup scale
    if (loaded.length > 0) {
      for (const { l: layer, img } of loaded) {
        const { width: displayW, height: displayH } = getRatioLockedSize(layer, layer.width);
        const exportW = displayW * coordScaleX;
        const exportH = displayH * coordScaleY;
        const cx = (layer.x + displayW / 2) * coordScaleX;
        const cy = (layer.y + displayH / 2) * coordScaleY;
        const angle = (layer.rotation * Math.PI) / 180;
        mctx.save();
        mctx.translate(cx, cy);
        mctx.rotate(angle);
        mctx.drawImage(img, -exportW / 2, -exportH / 2, exportW, exportH);
        mctx.restore();
      }
      // Clip layers to shirt shape
      mctx.globalCompositeOperation = "destination-in";
      drawContain(mctx, shirtImg, EXPORT_BASE_W, EXPORT_BASE_H);
      mctx.globalCompositeOperation = "source-over";
    }

    mockupCanvas = trimCanvas(mc);
  }

  return { designCanvas, mockupCanvas };
}

export async function generateDesignExportFiles({
  frontLayers,
  backLayers,
  mockupSize,
  clipW,
  clipH,
  frontMockupImage,
  backMockupImage,
}: GenerateDesignExportFilesOptions): Promise<DesignExportFile[]> {
  const files: DesignExportFile[] = [];
  const frontVisible = frontLayers.filter(l => l.visible);
  const backVisible = backLayers.filter(l => l.visible);
  const resolvedClipW = clipW ?? mockupSize;
  const resolvedClipH = clipH ?? Math.round(mockupSize * (4 / 3));

  const exportSide = async (
    visibleLayers: DesignLayerForExport[],
    shirtUrl: string | undefined,
    designFileName: string,
    mockupFileName: string,
  ) => {
    const shirtImg = shirtUrl ? await loadImg(shirtUrl) : null;
    if (visibleLayers.length === 0 && !shirtImg) return;

    const { designCanvas, mockupCanvas } = await renderComposite(
      visibleLayers, shirtImg, resolvedClipW, resolvedClipH,
      DESIGN_EXPORT_SCALE, MOCKUP_EXPORT_SCALE,
    );

    if (designCanvas) {
      const dataUrl = await canvasToDataUrl(designCanvas);
      if (dataUrl) files.push({ fileName: designFileName, dataUrl });
    }
    if (mockupCanvas) {
      const dataUrl = await canvasToDataUrl(mockupCanvas);
      if (dataUrl) files.push({ fileName: mockupFileName, dataUrl });
    }
  };

  await exportSide(frontVisible, frontMockupImage, "design-front.png", "mockup-front.png");
  await exportSide(backVisible, backMockupImage, "design-back.png", "mockup-back.png");
  return files;
}

export async function generateDesignExportBlobs({
  frontLayers,
  backLayers,
  mockupSize,
  clipW,
  clipH,
  frontMockupImage,
  backMockupImage,
}: GenerateDesignExportFilesOptions): Promise<DesignExportBlob[]> {
  const files: DesignExportBlob[] = [];
  const frontVisible = frontLayers.filter(l => l.visible);
  const backVisible = backLayers.filter(l => l.visible);
  const resolvedClipW = clipW ?? mockupSize;
  const resolvedClipH = clipH ?? Math.round(mockupSize * (4 / 3));

  const exportSide = async (
    visibleLayers: DesignLayerForExport[],
    shirtUrl: string | undefined,
    designFileName: string,
    mockupFileName: string,
  ) => {
    const shirtImg = shirtUrl ? await loadImg(shirtUrl) : null;
    if (visibleLayers.length === 0 && !shirtImg) return;

    const { designCanvas, mockupCanvas } = await renderComposite(
      visibleLayers, shirtImg, resolvedClipW, resolvedClipH,
      DESIGN_EXPORT_SCALE, MOCKUP_EXPORT_SCALE,
    );

    if (designCanvas) {
      const blob = await canvasToBlob(designCanvas);
      if (blob) files.push({ fileName: designFileName, blob, contentType: "image/png" });
    }
    if (mockupCanvas) {
      const blob = await canvasToBlob(mockupCanvas);
      if (blob) files.push({ fileName: mockupFileName, blob, contentType: "image/png" });
    }
  };

  await exportSide(frontVisible, frontMockupImage, "design-front.png", "mockup-front.png");
  await exportSide(backVisible, backMockupImage, "design-back.png", "mockup-back.png");
  return files;
}

function openCheckoutExportDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(CHECKOUT_EXPORT_DB, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(CHECKOUT_EXPORT_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveCheckoutExportFiles(files: DesignExportFile[]) {
  const db = await openCheckoutExportDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(CHECKOUT_EXPORT_STORE, "readwrite");
    tx.objectStore(CHECKOUT_EXPORT_STORE).put(files, CHECKOUT_EXPORT_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function loadCheckoutExportFiles(): Promise<DesignExportFile[]> {
  const db = await openCheckoutExportDb();
  const files = await new Promise<DesignExportFile[]>((resolve, reject) => {
    const tx = db.transaction(CHECKOUT_EXPORT_STORE, "readonly");
    const request = tx.objectStore(CHECKOUT_EXPORT_STORE).get(CHECKOUT_EXPORT_KEY);
    request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result : []);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return files;
}

export async function clearCheckoutExportFiles() {
  const db = await openCheckoutExportDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(CHECKOUT_EXPORT_STORE, "readwrite");
    tx.objectStore(CHECKOUT_EXPORT_STORE).delete(CHECKOUT_EXPORT_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}
