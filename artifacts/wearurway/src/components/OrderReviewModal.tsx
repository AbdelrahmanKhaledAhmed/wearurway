import { useEffect, useRef, useState, useCallback } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";

interface BBox { x: number; y: number; width: number; height: number }

interface DesignLayer {
  id: string;
  imageUrl: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  visible: boolean;
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
  selectedFit: { name: string } | null;
  selectedColor: { name: string; hex: string } | null;
  selectedSize: { name: string } | null;
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

async function generatePreview(
  sideLabel: "FRONT" | "BACK",
  mockupImage: string | undefined,
  _bbox: BBox | null,
  sideLayers: DesignLayer[],
  mockupSize: number,
): Promise<string | null> {
  const W = 600;
  const H = 800;

  // Scale from the on-screen mockup coordinate space to preview canvas size
  const scaleX = W / mockupSize;
  const scaleY = H / (mockupSize * (4 / 3));

  const shirtImg = await loadCanvasImage(mockupImage);

  // ── Off-screen canvas: design layers clipped to shirt silhouette ──────────
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
    const cx    = (layer.x + layer.width  / 2) * scaleX;
    const cy    = (layer.y + layer.height / 2) * scaleY;
    const angle = (layer.rotation * Math.PI) / 180;
    dctx.save();
    dctx.translate(cx, cy);
    dctx.rotate(angle);
    dctx.drawImage(img,
      -layer.width  * scaleX / 2,
      -layer.height * scaleY / 2,
       layer.width  * scaleX,
       layer.height * scaleY,
    );
    dctx.restore();
  }

  // Clip design to shirt alpha silhouette (same as CSS mask-image in designer)
  if (shirtImg) {
    dctx.globalCompositeOperation = "destination-in";
    drawImageContain(dctx, shirtImg, 0, 0, W, H);
    dctx.globalCompositeOperation = "source-over";
  }

  // ── Main canvas: dark background → shirt → design composite ──────────────
  const canvas = document.createElement("canvas");
  canvas.width  = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  // Background
  ctx.fillStyle = "#111111";
  ctx.fillRect(0, 0, W, H);

  // Shirt image
  if (shirtImg) drawImageContain(ctx, shirtImg, 0, 0, W, H);

  // Design clipped to shirt shape, on top
  ctx.drawImage(designCanvas, 0, 0);

  return canvas.toDataURL("image/png");
}

export default function OrderReviewModal({
  isOpen, onClose,
  frontLayers, backLayers,
  localFrontBbox, localBackBbox,
  mockup, mockupSize,
  selectedProduct, selectedFit, selectedColor, selectedSize,
}: Props) {
  const [, setLocation] = useLocation();
  const [frontPreview, setFrontPreview] = useState<string | null>(null);
  const [backPreview, setBackPreview] = useState<string | null>(null);
  const [generatingPreviews, setGeneratingPreviews] = useState(false);
  const generatedRef = useRef(false);

  const hasFront = frontLayers.some(l => l.visible);
  const hasBack = backLayers.some(l => l.visible);
  const price = hasFront && hasBack ? 700 : 550;

  const generatePreviews = useCallback(async () => {
    if (generatedRef.current) return;
    generatedRef.current = true;
    setGeneratingPreviews(true);
    try {
      const [fp, bp] = await Promise.all([
        generatePreview("FRONT", mockup?.front?.image, localFrontBbox, frontLayers, mockupSize),
        generatePreview("BACK", mockup?.back?.image, localBackBbox, backLayers, mockupSize),
      ]);
      setFrontPreview(fp);
      setBackPreview(bp);
    } finally {
      setGeneratingPreviews(false);
    }
  }, [mockup, localFrontBbox, localBackBbox, frontLayers, backLayers, mockupSize]);

  useEffect(() => {
    if (isOpen) {
      generatedRef.current = false;
      setFrontPreview(null);
      setBackPreview(null);
      generatePreviews();
    }
  }, [isOpen, generatePreviews]);

  const handleConfirm = () => {
    sessionStorage.setItem("ww_checkout_front", frontPreview ?? "");
    sessionStorage.setItem("ww_checkout_back", backPreview ?? "");
    sessionStorage.setItem("ww_checkout_price", String(price));
    setLocation("/checkout");
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, y: 40, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 30, scale: 0.97 }}
            transition={{ type: "spring", damping: 28, stiffness: 320 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none"
          >
            <div
              className="pointer-events-auto w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-[#0d0d0d] border border-white/10 flex flex-col"
              style={{ scrollbarWidth: "none" }}
              onClick={e => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-8 py-6 border-b border-white/10">
                <div>
                  <p className="text-[10px] tracking-[0.25em] text-white/40 uppercase mb-1">Review</p>
                  <h2 className="text-xl font-black uppercase tracking-[0.1em]" style={{ fontFamily: "monospace" }}>Your Order</h2>
                </div>
                <button
                  onClick={onClose}
                  className="text-white/40 hover:text-white transition-colors text-2xl leading-none font-light"
                >
                  ×
                </button>
              </div>

              {/* Design previews */}
              <div className="px-8 pt-6">
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

              {/* Configuration */}
              <div className="px-8 pt-6">
                <p className="text-[10px] tracking-[0.25em] text-white/40 uppercase mb-4">Configuration</p>
                <div className="border border-white/10 divide-y divide-white/10">
                  {[
                    { label: "Product", value: selectedProduct?.name },
                    { label: "Fit", value: selectedFit?.name },
                    {
                      label: "Color",
                      value: selectedColor?.name,
                      extra: selectedColor?.hex ? (
                        <div className="w-3.5 h-3.5 border border-white/20 mr-2" style={{ backgroundColor: selectedColor.hex }} />
                      ) : null,
                    },
                    { label: "Size", value: selectedSize?.name },
                  ].map(row => (
                    <div key={row.label} className="flex justify-between items-center px-5 py-3.5">
                      <span className="text-[10px] tracking-[0.2em] text-white/40 uppercase">{row.label}</span>
                      <div className="flex items-center">
                        {row.extra}
                        <span className="text-xs font-bold uppercase tracking-widest">{row.value ?? "—"}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Price */}
              <div className="px-8 pt-6 flex items-end justify-between">
                <p className="text-[10px] tracking-[0.25em] text-white/40 uppercase">Total</p>
                <div className="flex items-baseline gap-2">
                  <span
                    className="text-4xl font-black tracking-tight"
                    style={{ fontFamily: "monospace", color: "#f5c842" }}
                  >
                    {price}
                  </span>
                  <span className="text-sm font-bold text-white/50 tracking-widest uppercase">EGP</span>
                </div>
              </div>

              {/* Confirm button */}
              <div className="px-8 pt-6 pb-8">
                <button
                  onClick={handleConfirm}
                  className="w-full py-4 font-black uppercase tracking-[0.2em] text-sm transition-all active:scale-[0.98]"
                  style={{
                    backgroundColor: "#f5c842",
                    color: "#0d0d0d",
                    letterSpacing: "0.25em",
                  }}
                >
                  Confirm Order
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
