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
  frontMockupImage?: string;
  backMockupImage?: string;
}

const MIN_LAYER_SIZE = 10;
const CHECKOUT_EXPORT_DB = "wearurway-checkout-exports";
const CHECKOUT_EXPORT_STORE = "exports";
const CHECKOUT_EXPORT_KEY = "latest";

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

export async function generateDesignExportFiles({
  frontLayers,
  backLayers,
  mockupSize,
  frontMockupImage,
  backMockupImage,
}: GenerateDesignExportFilesOptions): Promise<DesignExportFile[]> {
  const files: DesignExportFile[] = [];
  const frontVisible = frontLayers.filter(l => l.visible);
  const backVisible = backLayers.filter(l => l.visible);

  const exportComposite = async (
    visibleLayers: DesignLayerForExport[],
    shirtUrl: string | undefined,
    designFileName: string,
    mockupFileName: string,
  ) => {
    const shirtImg = shirtUrl ? await loadImg(shirtUrl) : null;
    if (visibleLayers.length === 0 && !shirtImg) return;
    const loaded = (
      await Promise.all(visibleLayers.map(async l => ({ l, img: await loadImg(l.imageUrl) })))
    ).filter((x): x is { l: DesignLayerForExport; img: HTMLImageElement } => x.img !== null);
    if (visibleLayers.length > 0 && loaded.length < visibleLayers.length) {
      console.warn(
        `[design-export] ${visibleLayers.length - loaded.length} of ${visibleLayers.length} ` +
          `layers failed to load for ${designFileName}`,
      );
    }

    // Render at exactly the mockup display size so the file matches what the
    // user sees on screen — no extra upscaling. The high-quality smoothing on
    // the canvas context handles any per-layer downscaling cleanly.
    const exportW = Math.round(mockupSize);
    const exportH = Math.round(mockupSize * (4 / 3));
    const makeCanvas = () => {
      const c = document.createElement("canvas");
      c.width = exportW;
      c.height = exportH;
      return c;
    };
    const setupCtx = (c: HTMLCanvasElement) => {
      const ctx = c.getContext("2d")!;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      return ctx;
    };

    const layerCanvas = makeCanvas();
    const layerCtx = setupCtx(layerCanvas);
    for (const { l: layer, img } of loaded) {
      const { width: displayW, height: displayH } = getRatioLockedSize(layer, layer.width);
      const cx = layer.x + displayW / 2;
      const cy = layer.y + displayH / 2;
      const angle = (layer.rotation * Math.PI) / 180;
      layerCtx.save();
      layerCtx.translate(cx, cy);
      layerCtx.rotate(angle);
      layerCtx.drawImage(img, -displayW / 2, -displayH / 2, displayW, displayH);
      layerCtx.restore();
    }

    if (shirtImg) {
      layerCtx.globalCompositeOperation = "destination-in";
      drawContain(layerCtx, shirtImg, exportW, exportH);
      layerCtx.globalCompositeOperation = "source-over";
    }

    if (loaded.length > 0) {
      const designDataUrl = await canvasToDataUrl(trimCanvas(layerCanvas));
      if (designDataUrl) files.push({ fileName: designFileName, dataUrl: designDataUrl });
    }

    if (shirtImg) {
      const finalCanvas = makeCanvas();
      const finalCtx = setupCtx(finalCanvas);
      drawContain(finalCtx, shirtImg, exportW, exportH);
      finalCtx.drawImage(layerCanvas, 0, 0);
      const mockupDataUrl = await canvasToDataUrl(trimCanvas(finalCanvas));
      if (mockupDataUrl) files.push({ fileName: mockupFileName, dataUrl: mockupDataUrl });
    }
  };

  await exportComposite(frontVisible, frontMockupImage, "design-front.png", "mockup-front.png");
  await exportComposite(backVisible, backMockupImage, "design-back.png", "mockup-back.png");
  return files;
}

export async function generateDesignExportBlobs({
  frontLayers,
  backLayers,
  mockupSize,
  frontMockupImage,
  backMockupImage,
}: GenerateDesignExportFilesOptions): Promise<DesignExportBlob[]> {
  const files: DesignExportBlob[] = [];
  const frontVisible = frontLayers.filter(l => l.visible);
  const backVisible = backLayers.filter(l => l.visible);

  const exportComposite = async (
    visibleLayers: DesignLayerForExport[],
    shirtUrl: string | undefined,
    designFileName: string,
    mockupFileName: string,
  ) => {
    const shirtImg = shirtUrl ? await loadImg(shirtUrl) : null;
    if (visibleLayers.length === 0 && !shirtImg) return;
    const loaded = (
      await Promise.all(visibleLayers.map(async l => ({ l, img: await loadImg(l.imageUrl) })))
    ).filter((x): x is { l: DesignLayerForExport; img: HTMLImageElement } => x.img !== null);
    if (visibleLayers.length > 0 && loaded.length < visibleLayers.length) {
      console.warn(
        `[design-export] ${visibleLayers.length - loaded.length} of ${visibleLayers.length} ` +
          `layers failed to load for ${designFileName}`,
      );
    }

    // Render at exactly the mockup display size so the file matches what the
    // user sees on screen — no extra upscaling.
    const exportW = Math.round(mockupSize);
    const exportH = Math.round(mockupSize * (4 / 3));
    const makeCanvas = () => {
      const c = document.createElement("canvas");
      c.width = exportW;
      c.height = exportH;
      return c;
    };
    const setupCtx = (c: HTMLCanvasElement) => {
      const ctx = c.getContext("2d")!;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      return ctx;
    };

    const layerCanvas = makeCanvas();
    const layerCtx = setupCtx(layerCanvas);
    for (const { l: layer, img } of loaded) {
      const { width: displayW, height: displayH } = getRatioLockedSize(layer, layer.width);
      const cx = layer.x + displayW / 2;
      const cy = layer.y + displayH / 2;
      const angle = (layer.rotation * Math.PI) / 180;
      layerCtx.save();
      layerCtx.translate(cx, cy);
      layerCtx.rotate(angle);
      layerCtx.drawImage(img, -displayW / 2, -displayH / 2, displayW, displayH);
      layerCtx.restore();
    }

    if (shirtImg) {
      layerCtx.globalCompositeOperation = "destination-in";
      drawContain(layerCtx, shirtImg, exportW, exportH);
      layerCtx.globalCompositeOperation = "source-over";
    }

    if (loaded.length > 0) {
      const designBlob = await canvasToBlob(trimCanvas(layerCanvas));
      if (designBlob) files.push({ fileName: designFileName, blob: designBlob, contentType: "image/png" });
    }

    if (shirtImg) {
      const finalCanvas = makeCanvas();
      const finalCtx = setupCtx(finalCanvas);
      drawContain(finalCtx, shirtImg, exportW, exportH);
      finalCtx.drawImage(layerCanvas, 0, 0);
      const mockupBlob = await canvasToBlob(trimCanvas(finalCanvas));
      if (mockupBlob) files.push({ fileName: mockupFileName, blob: mockupBlob, contentType: "image/png" });
    }
  };

  await exportComposite(frontVisible, frontMockupImage, "design-front.png", "mockup-front.png");
  await exportComposite(backVisible, backMockupImage, "design-back.png", "mockup-back.png");
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