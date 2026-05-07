import { useEffect, useRef, useState, useCallback } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { useGetOrderSettings, useGetSizes, getGetSizesQueryKey } from "@workspace/api-client-react";
import { useCustomizer } from "@/hooks/use-customizer";
import {
  generateDesignExportFiles,
  saveCheckoutExportFiles,
  type DesignExportFile,
} from "@/lib/design-export";

interface BBox { x: number; y: number; width: number; height: number }

interface DesignLayer {
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

function getLayerDisplaySize(layer: DesignLayer): { width: number; height: number } {
  const naturalRatio =
    (layer.naturalWidth ?? 0) > 0 && (layer.naturalHeight ?? 0) > 0
      ? (layer.naturalWidth ?? 0) / (layer.naturalHeight ?? 1)
      : 0;
  const fallbackRatio =
    layer.width > 0 && layer.height > 0 ? layer.width / layer.height : 1;
  const ratio = Number.isFinite(naturalRatio) && naturalRatio > 0 ? naturalRatio : fallbackRatio;
  const w = Math.max(10, layer.width);
  return { width: w, height: Math.max(10, w / ratio) };
}

interface Mockup {
  front?: { image?: string };
  back?: { image?: string };
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  frontLayers: DesignLayer[];
  backLayers: DesignLayer[];
  localFrontBbox: BBox | null;
  localBackBbox: BBox | null;
  mockup: Mockup | null | undefined;
  mockupSize: number;
  selectedProduct: { name: string } | null;
  selectedFit: { id: string; name: string } | null;
  selectedColor: { name: string; hex: string } | null;
  selectedSize: { name: string } | null;
  viewZoom: number;
  clipW: number;
  clipH: number;
}

async function loadCanvasImage(src?: string): Promise<HTMLImageElement | null> {
  if (!src) return null;
  try {
    const res = await fetch(src);
    if (!res.ok) return null;
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(blobUrl); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(blobUrl); reject(); };
      img.src = blobUrl;
    });
  } catch {
    return null;
  }
}

function drawImageContain(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number, y: number, w: number, h: number,
) {
  const ratio = Math.min(w / img.naturalWidth, h / img.naturalHeight);
  const dw = img.naturalWidth * ratio;
  const dh = img.naturalHeight * ratio;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

// ─── KEY FIX ──────────────────────────────────────────────────────────────────
// Layer x/y coordinates are stored relative to the clip-area's actual DOM size
// at the time the user placed them (via getClipDims() in Design.tsx).
//
// On desktop: clip area = mockupSize × (mockupSize * 4/3)  ✓ always correct
// On mobile:  clip area = min(viewport width, mockupSize) × proportional height
//             because the mockup element is mockupSize px wide in the DOM but
//             the viewport may be narrower, so only the visible portion is
//             interactive. getClipDims() in Design.tsx returns the offsetWidth
//             of the active clip area ref, which is the real rendered width.
//
// So the preview must scale from that same clip-area space → 600×800 canvas,
// not from mockupSize-space → 600×800.
async function generatePreview(
  sideLabel: "FRONT" | "BACK",
  mockupImage: string | undefined,
  _bbox: BBox | null,
  sideLayers: DesignLayer[],
  mockupSize: number,
  clipW: number,
  clipH: number,
): Promise<string | null> {
  const W = 600;
  const H = 800;

  // Scale from the space where layers were stored → preview canvas.
  const scaleX = W / clipW;
  const scaleY = H / clipH;

  const shirtImg = await loadCanvasImage(mockupImage);

  const designCanvas = document.createElement("canvas");
  designCanvas.width  = W;
  designCanvas.height = H;
  const dctx = designCanvas.getContext("2d");
  if (!dctx) return null;
  dctx.imageSmoothingEnabled = true;
  dctx.imageSmoothingQuality = "high";

  for (const layer of sideLayers.filter(l => l.visible)) {
    const img = await loadCanvasImage(layer.imageUrl);
    if (!img) continue;
    const { width: dispW, height: dispH } = getLayerDisplaySize(layer);
    const cx    = (layer.x + dispW / 2) * scaleX;
    const cy    = (layer.y + dispH / 2) * scaleY;
    const angle = (layer.rotation * Math.PI) / 180;
    dctx.save();
    dctx.translate(cx, cy);
    dctx.rotate(angle);
    dctx.drawImage(img, -dispW * scaleX / 2, -dispH * scaleY / 2, dispW * scaleX, dispH * scaleY);
    dctx.restore();
  }

  if (shirtImg) {
    dctx.globalCompositeOperation = "destination-in";
    drawImageContain(dctx, shirtImg, 0, 0, W, H);
    dctx.globalCompositeOperation = "source-over";
  }

  const canvas = document.createElement("canvas");
  canvas.width  = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = "#111111";
  ctx.fillRect(0, 0, W, H);
  if (shirtImg) drawImageContain(ctx, shirtImg, 0, 0, W, H);
  ctx.drawImage(designCanvas, 0, 0);

  return canvas.toDataURL("image/png");
}

// Mirrors getClipDims() from Design.tsx.
// Called once when the modal opens to capture the dimensions that were active
// while the user was placing layers.

export default function OrderReviewModal({
  isOpen, onClose,
  frontLayers, backLayers,
  localFrontBbox, localBackBbox,
  mockup, mockupSize,
  selectedProduct, selectedFit, selectedColor,
  viewZoom,
  clipW,
  clipH,
}: Props) {
  const [, setLocation] = useLocation();
  const { selectedSize, setSize } = useCustomizer();
  const { data: orderSettings } = useGetOrderSettings();
  const fitId = selectedFit?.id ?? "";
  const { data: sizes, isLoading: sizesLoading } = useGetSizes(fitId, {
    query: { enabled: !!fitId, queryKey: getGetSizesQueryKey(fitId) }
  });

  const [step, setStep]                         = useState<"size" | "review">("size");
  const [frontPreview, setFrontPreview]         = useState<string | null>(null);
  const [backPreview, setBackPreview]           = useState<string | null>(null);
  const [generatingPreviews, setGeneratingPreviews] = useState(false);
  const [prepareError, setPrepareError]         = useState("");
  const [confirming, setConfirming]             = useState(false);

  const generatedRef        = useRef(false);
  const exportFilesPromiseRef = useRef<Promise<DesignExportFile[]> | null>(null);

  // Capture clip dims once when the modal opens (mirrors what Design.tsx used).
  const clipDimsRef = useRef<{ clipW: number; clipH: number }>({
    clipW: mockupSize,
    clipH: Math.round(mockupSize * 4 / 3),
  });

  const hasFront = frontLayers.some(l => l.visible);
  const hasBack  = backLayers.some(l => l.visible);
  const price    = hasFront && hasBack
    ? (orderSettings?.frontBackPrice ?? 700)
    : (orderSettings?.frontOnlyPrice ?? 550);

  // Stable ref always holding the latest props — lets generatePreviews be stable.
  const previewParamsRef = useRef({
    mockup, localFrontBbox, localBackBbox, frontLayers, backLayers, mockupSize,
  });
  useEffect(() => {
    previewParamsRef.current = {
      mockup, localFrontBbox, localBackBbox, frontLayers, backLayers, mockupSize,
    };
  });

  // Stable — empty dep array intentional, reads live values from refs.
  const generatePreviews = useCallback(async () => {
    if (generatedRef.current) return;
    generatedRef.current = true;
    setGeneratingPreviews(true);

    const { mockup: m, localFrontBbox: fb, localBackBbox: bb, frontLayers: fl, backLayers: bl, mockupSize: ms } = previewParamsRef.current;
    const { clipW, clipH } = clipDimsRef.current;

    exportFilesPromiseRef.current = generateDesignExportFiles({
      frontLayers: fl, backLayers: bl, mockupSize: ms,
      clipW, clipH,
      frontMockupImage: m?.front?.image,
      backMockupImage:  m?.back?.image,
    }).catch(err => { console.warn("[order-review] export failed", err); return []; });

    try {
      const [fp, bp] = await Promise.all([
        generatePreview("FRONT", m?.front?.image, fb, fl, ms, clipW, clipH),
        generatePreview("BACK",  m?.back?.image,  bb, bl, ms, clipW, clipH),
      ]);
      setFrontPreview(fp);
      setBackPreview(bp);
    } finally {
      setGeneratingPreviews(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (isOpen) {
      // Capture clip dims right now, while the design canvas is still rendered.
      clipDimsRef.current = { clipW, clipH };
      setStep("size");
      generatedRef.current = false;
      setFrontPreview(null);
      setBackPreview(null);
      setPrepareError("");
      setConfirming(false);
      exportFilesPromiseRef.current = null;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  useEffect(() => {
    if (step === "review") generatePreviews();
  }, [step, generatePreviews]);

  const handleSizeSelect = (size: any) => {
    if (size.available === false) return;
    setSize(size);
    setStep("review");
  };

  const handleConfirm = async () => {
    setPrepareError("");
    setConfirming(true);
    const { mockup: m, frontLayers: fl, backLayers: bl, mockupSize: ms } = previewParamsRef.current;
    const designJob = {
      frontLayers: fl, backLayers: bl, mockupSize: ms,
      frontMockupImage: m?.front?.image,
      backMockupImage:  m?.back?.image,
    };
    try {
      const exportFiles = exportFilesPromiseRef.current ? await exportFilesPromiseRef.current : [];
      if (exportFiles.length > 0) {
        try { await saveCheckoutExportFiles(exportFiles); }
        catch (err) { console.warn("[order-review] could not persist export files", err); }
      }
      sessionStorage.setItem("ww_checkout_design_job", JSON.stringify(designJob));
      sessionStorage.setItem("ww_checkout_front",      frontPreview ?? "");
      sessionStorage.setItem("ww_checkout_back",       backPreview  ?? "");
      sessionStorage.setItem("ww_checkout_price",      String(price));
      setLocation("/checkout");
      onClose();
    } catch {
      setPrepareError("Could not open checkout. Please try again.");
    } finally {
      setConfirming(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm"
            onClick={onClose}
          />

          {/* ── Mobile: bottom sheet ── */}
          <motion.div
            initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 32, stiffness: 340 }}
            className="fixed inset-x-0 bottom-0 z-50 flex flex-col md:hidden pointer-events-auto bg-[#0d0d0d] border-t border-white/10"
            style={{ maxHeight: "90vh" }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex justify-center pt-3 pb-2 shrink-0 cursor-pointer" onClick={onClose}>
              <div className="w-10 h-1 bg-white/20 rounded-full" />
            </div>

            <div className="flex items-center justify-between px-5 py-3 border-b border-white/10 shrink-0">
              <div>
                <p className="text-[10px] tracking-[0.25em] text-white/40 uppercase mb-0.5">
                  {step === "size" ? "Step 1 of 2" : "Step 2 of 2"}
                </p>
                <h2 className="text-lg font-black uppercase tracking-[0.1em]" style={{ fontFamily: "monospace" }}>
                  {step === "size" ? "Select Size" : "Review Order"}
                </h2>
              </div>
              <button onClick={onClose} className="text-white/40 hover:text-white transition-colors text-2xl leading-none font-light w-10 h-10 flex items-center justify-center">×</button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto" style={{ WebkitOverflowScrolling: "touch" }}>
              {step === "size" && (
                <div className="px-4 py-5 pb-10">
                  <p className="text-[10px] tracking-[0.25em] text-white/40 uppercase mb-4">Perfect your fit</p>
                  {sizesLoading ? (
                    <div className="grid grid-cols-2 gap-3">
                      {[1,2,3,4].map(i => <div key={i} className="h-24 bg-white/5 animate-pulse border border-white/10" />)}
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-3">
                      {sizes?.map((size) => (
                        <motion.button
                          key={size.id}
                          whileTap={size.available !== false ? { scale: 0.97 } : {}}
                          onClick={() => handleSizeSelect(size)}
                          disabled={size.available === false}
                          className={`p-4 border flex flex-col items-center text-center transition-colors ${
                            size.available !== false
                              ? "border-white/20 active:border-[#f5c842] active:bg-[#f5c842]/5 cursor-pointer"
                              : "border-white/8 opacity-40 cursor-not-allowed"
                          }`}
                        >
                          <span className="text-xl font-black uppercase tracking-tight mb-1">{size.name}</span>
                          <span className="text-[11px] font-mono text-white/60 mb-1">{size.realWidth} × {size.realHeight} cm</span>
                          <div className="flex flex-col gap-0.5 text-[10px] text-white/40">
                            <span>{size.heightMin}–{size.heightMax} cm tall</span>
                            <span>{size.weightMin}–{size.weightMax} kg</span>
                          </div>
                          {size.comingSoon && (
                            <span className="mt-2 px-2 py-0.5 bg-white/10 text-white/50 text-[10px] tracking-widest uppercase">Coming Soon</span>
                          )}
                        </motion.button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {step === "review" && (
                <div className="pb-10">
                  <div className="px-4 pt-4 pb-2">
                    <button onClick={() => setStep("size")} className="text-[10px] tracking-[0.2em] text-white/40 hover:text-white uppercase transition-colors flex items-center gap-1.5">← Change Size</button>
                  </div>
                  <div className="px-4 pt-2">
                    <p className="text-[10px] tracking-[0.25em] text-white/40 uppercase mb-3">Design Preview</p>
                    <div className="flex gap-3">
                      {(["FRONT", "BACK"] as const).map((label) => {
                        const preview = label === "FRONT" ? frontPreview : backPreview;
                        return (
                          <div key={label} className="flex-1 flex flex-col gap-1.5">
                            <div className="aspect-[3/4] bg-[#161616] border border-white/10 overflow-hidden relative flex items-center justify-center">
                              {generatingPreviews && !preview ? (
                                <div className="flex flex-col items-center gap-2">
                                  <div className="w-5 h-5 border-2 border-white/20 border-t-white/70 rounded-full animate-spin" />
                                  <p className="text-[9px] text-white/30 uppercase tracking-widest">Rendering…</p>
                                </div>
                              ) : preview ? (
                                <img src={preview} alt={label} className="w-full h-full object-contain" />
                              ) : (
                                <p className="text-[9px] text-white/20 uppercase tracking-widest">No design</p>
                              )}
                            </div>
                            <p className="text-[10px] text-white/50 uppercase tracking-[0.2em] text-center font-bold">{label}</p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <div className="px-4 pt-5">
                    <p className="text-[10px] tracking-[0.25em] text-white/40 uppercase mb-3">Configuration</p>
                    <div className="border border-white/10 divide-y divide-white/10">
                      {[
                        { label: "Product", value: selectedProduct?.name },
                        { label: "Fit",     value: selectedFit?.name },
                        { label: "Color",   value: selectedColor?.name, extra: selectedColor?.hex ? <div className="w-3 h-3 border border-white/20 mr-2 shrink-0" style={{ backgroundColor: selectedColor.hex }} /> : null },
                        { label: "Size",    value: selectedSize?.name },
                      ].map(row => (
                        <div key={row.label} className="flex justify-between items-center px-4 py-3">
                          <span className="text-[10px] tracking-[0.2em] text-white/40 uppercase">{row.label}</span>
                          <div className="flex items-center">{row.extra}<span className="text-xs font-bold uppercase tracking-widest">{row.value ?? "—"}</span></div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="px-4 pt-5 flex items-end justify-between">
                    <p className="text-[10px] tracking-[0.25em] text-white/40 uppercase">Total</p>
                    <div className="flex items-baseline gap-2">
                      <span className="text-3xl font-black tracking-tight" style={{ fontFamily: "monospace", color: "#f5c842" }}>{price}</span>
                      <span className="text-sm font-bold text-white/50 tracking-widest uppercase">EGP</span>
                    </div>
                  </div>
                  <div className="px-4 pt-5">
                    <button
                      onClick={handleConfirm} disabled={confirming}
                      className="w-full py-4 font-black uppercase text-sm transition-all active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
                      style={{ backgroundColor: "#f5c842", color: "#0d0d0d", letterSpacing: "0.25em" }}
                    >
                      {confirming ? "Preparing…" : "Confirm Order"}
                    </button>
                    {prepareError && <p className="text-xs text-red-400 mt-3">{prepareError}</p>}
                  </div>
                </div>
              )}
            </div>
          </motion.div>

          {/* ── Desktop: centered modal ── */}
          <motion.div
            initial={{ opacity: 0, y: 40, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 30, scale: 0.97 }}
            transition={{ type: "spring", damping: 28, stiffness: 320 }}
            className="fixed inset-0 z-50 hidden md:flex items-center justify-center p-4 pointer-events-none"
          >
            <div
              className="pointer-events-auto w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-[#0d0d0d] border border-white/10 flex flex-col"
              style={{ scrollbarWidth: "none" }}
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-8 py-6 border-b border-white/10">
                <div>
                  <p className="text-[10px] tracking-[0.25em] text-white/40 uppercase mb-1">
                    {step === "size" ? "Step 1 of 2" : "Step 2 of 2"}
                  </p>
                  <h2 className="text-xl font-black uppercase tracking-[0.1em]" style={{ fontFamily: "monospace" }}>
                    {step === "size" ? "Select Size" : "Review Order"}
                  </h2>
                </div>
                <button onClick={onClose} className="text-white/40 hover:text-white transition-colors text-2xl leading-none font-light">×</button>
              </div>

              {step === "size" && (
                <div className="px-8 py-6">
                  <p className="text-[10px] tracking-[0.25em] text-white/40 uppercase mb-6">Perfect your fit</p>
                  {sizesLoading ? (
                    <div className="grid grid-cols-2 gap-4">
                      {[1,2,3,4].map(i => <div key={i} className="h-28 bg-white/5 animate-pulse border border-white/10" />)}
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-4">
                      {sizes?.map((size) => (
                        <motion.button
                          key={size.id}
                          whileHover={size.available !== false ? { scale: 1.02 } : {}}
                          whileTap={size.available !== false ? { scale: 0.97 } : {}}
                          onClick={() => handleSizeSelect(size)}
                          disabled={size.available === false}
                          className={`p-5 border flex flex-col items-center text-center transition-colors ${
                            size.available !== false
                              ? "border-white/20 hover:border-[#f5c842] hover:bg-[#f5c842]/5 cursor-pointer"
                              : "border-white/8 opacity-40 cursor-not-allowed"
                          }`}
                        >
                          <span className="text-xl font-black uppercase tracking-tight mb-2">{size.name}</span>
                          <span className="text-[11px] font-mono text-white/60 mb-2">{size.realWidth} × {size.realHeight} cm</span>
                          <div className="flex flex-col gap-0.5 text-[10px] text-white/40">
                            <span>{size.heightMin}–{size.heightMax} cm tall</span>
                            <span>{size.weightMin}–{size.weightMax} kg</span>
                          </div>
                          {size.comingSoon && (
                            <span className="mt-3 px-2 py-0.5 bg-white/10 text-white/50 text-[10px] tracking-widest uppercase">Coming Soon</span>
                          )}
                        </motion.button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {step === "review" && (
                <>
                  <div className="px-8 pt-5">
                    <button onClick={() => setStep("size")} className="text-[10px] tracking-[0.2em] text-white/40 hover:text-white uppercase transition-colors flex items-center gap-1.5">← Change Size</button>
                  </div>
                  <div className="px-8 pt-4">
                    <p className="text-[10px] tracking-[0.25em] text-white/40 uppercase mb-4">Design Preview</p>
                    <div className="grid grid-cols-2 gap-4">
                      {(["FRONT", "BACK"] as const).map((label) => {
                        const preview = label === "FRONT" ? frontPreview : backPreview;
                        return (
                          <div key={label} className="flex flex-col gap-2">
                            <div className="aspect-[3/4] bg-[#161616] border border-white/8 overflow-hidden relative flex items-center justify-center">
                              {generatingPreviews && !preview ? (
                                <div className="flex flex-col items-center gap-2">
                                  <div className="w-6 h-6 border-2 border-white/20 border-t-white/70 rounded-full animate-spin" />
                                  <p className="text-[10px] text-white/30 uppercase tracking-widest">Rendering…</p>
                                </div>
                              ) : preview ? (
                                <img src={preview} alt={label} className="w-full h-full object-cover" />
                              ) : (
                                <p className="text-[10px] text-white/20 uppercase tracking-widest">No mockup</p>
                              )}
                            </div>
                            <p className="text-[10px] text-white/50 uppercase tracking-[0.2em] text-center font-bold">{label}</p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <div className="px-8 pt-6">
                    <p className="text-[10px] tracking-[0.25em] text-white/40 uppercase mb-4">Configuration</p>
                    <div className="border border-white/10 divide-y divide-white/10">
                      {[
                        { label: "Product", value: selectedProduct?.name },
                        { label: "Fit",     value: selectedFit?.name },
                        { label: "Color",   value: selectedColor?.name, extra: selectedColor?.hex ? <div className="w-3.5 h-3.5 border border-white/20 mr-2" style={{ backgroundColor: selectedColor.hex }} /> : null },
                        { label: "Size",    value: selectedSize?.name },
                      ].map(row => (
                        <div key={row.label} className="flex justify-between items-center px-5 py-3.5">
                          <span className="text-[10px] tracking-[0.2em] text-white/40 uppercase">{row.label}</span>
                          <div className="flex items-center">{row.extra}<span className="text-xs font-bold uppercase tracking-widest">{row.value ?? "—"}</span></div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="px-8 pt-6 flex items-end justify-between">
                    <p className="text-[10px] tracking-[0.25em] text-white/40 uppercase">Total</p>
                    <div className="flex items-baseline gap-2">
                      <span className="text-4xl font-black tracking-tight" style={{ fontFamily: "monospace", color: "#f5c842" }}>{price}</span>
                      <span className="text-sm font-bold text-white/50 tracking-widest uppercase">EGP</span>
                    </div>
                  </div>
                  <div className="px-8 pt-6 pb-8">
                    <button
                      onClick={handleConfirm} disabled={confirming}
                      className="w-full py-4 font-black uppercase tracking-[0.2em] text-sm transition-all active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
                      style={{ backgroundColor: "#f5c842", color: "#0d0d0d", letterSpacing: "0.25em" }}
                    >
                      {confirming ? "Preparing…" : "Confirm Order"}
                    </button>
                    {prepareError && <p className="text-xs text-red-400 mt-3">{prepareError}</p>}
                  </div>
                </>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
