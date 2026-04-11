import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { useGetMockup, getGetMockupQueryKey } from "@workspace/api-client-react";
import { useCustomizer } from "@/hooks/use-customizer";

// ─── Types ────────────────────────────────────────────────────────────────────

interface DesignLayer {
  id: string;
  name: string;
  imageUrl: string;
  x: number;
  y: number;
  width: number;
  height: number;
  visible: boolean;
}

interface DragState {
  layerId: string;
  startMouseX: number;
  startMouseY: number;
  startLayerX: number;
  startLayerY: number;
}

const ZOOM_STEP = 0.12;

// ─── Main Component ───────────────────────────────────────────────────────────

export default function Design() {
  const [, setLocation] = useLocation();
  const { selectedProduct, selectedFit, selectedColor, selectedSize, reset } = useCustomizer();
  const [side, setSide] = useState<"front" | "back">("front");

  const [layers, setLayers] = useState<DesignLayer[]>([]);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [exporting, setExporting] = useState(false);

  const clipAreaRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);

  useEffect(() => {
    if (!selectedProduct || !selectedFit || !selectedColor || !selectedSize) {
      setLocation("/products");
    }
  }, [selectedProduct, selectedFit, selectedColor, selectedSize, setLocation]);

  const { data: mockup } = useGetMockup(
    {
      productId: selectedProduct?.id ?? "",
      fitId: selectedFit?.id ?? "",
      colorId: selectedColor?.id ?? "",
    },
    {
      query: {
        enabled: !!(selectedProduct && selectedFit && selectedColor),
        queryKey: getGetMockupQueryKey({
          productId: selectedProduct?.id ?? "",
          fitId: selectedFit?.id ?? "",
          colorId: selectedColor?.id ?? "",
        }),
      },
    }
  );

  const currentSide = side === "front" ? mockup?.front : mockup?.back;
  const bbox = currentSide?.boundingBox;
  const realWidth = selectedSize?.realWidth ?? 0;
  const realHeight = selectedSize?.realHeight ?? 0;

  // ── Drag handlers ──────────────────────────────────────────────────────────

  const onMouseMove = useCallback((e: MouseEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.startMouseX;
    const dy = e.clientY - drag.startMouseY;
    setLayers(prev =>
      prev.map(l =>
        l.id === drag.layerId
          ? { ...l, x: drag.startLayerX + dx, y: drag.startLayerY + dy }
          : l
      )
    );
  }, []);

  const onMouseUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  useEffect(() => {
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [onMouseMove, onMouseUp]);

  const startDrag = (e: React.MouseEvent, layer: DesignLayer) => {
    e.preventDefault();
    setSelectedLayerId(layer.id);
    dragRef.current = {
      layerId: layer.id,
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      startLayerX: layer.x,
      startLayerY: layer.y,
    };
  };

  // ── Scroll wheel zoom on clip area ─────────────────────────────────────────

  const onClipWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    setSelectedLayerId(prev => {
      if (!prev) return prev;
      setLayers(layers =>
        layers.map(l => {
          if (l.id !== prev) return l;
          const factor = e.deltaY < 0 ? 1 + ZOOM_STEP : 1 - ZOOM_STEP;
          const newW = Math.max(10, l.width * factor);
          const newH = Math.max(10, l.height * factor);
          // Keep centre fixed
          const cx = l.x + l.width / 2;
          const cy = l.y + l.height / 2;
          return { ...l, width: newW, height: newH, x: cx - newW / 2, y: cy - newH / 2 };
        })
      );
      return prev;
    });
  }, []);

  useEffect(() => {
    const el = clipAreaRef.current;
    if (!el) return;
    el.addEventListener("wheel", onClipWheel, { passive: false });
    return () => el.removeEventListener("wheel", onClipWheel);
  }, [onClipWheel]);

  // ── Zoom helpers ───────────────────────────────────────────────────────────

  const zoomSelected = useCallback((direction: "in" | "out") => {
    setLayers(prev =>
      prev.map(l => {
        if (l.id !== selectedLayerId) return l;
        const factor = direction === "in" ? 1 + ZOOM_STEP : 1 - ZOOM_STEP;
        const newW = Math.max(10, l.width * factor);
        const newH = Math.max(10, l.height * factor);
        const cx = l.x + l.width / 2;
        const cy = l.y + l.height / 2;
        return { ...l, width: newW, height: newH, x: cx - newW / 2, y: cy - newH / 2 };
      })
    );
  }, [selectedLayerId]);

  // ── Add Image ──────────────────────────────────────────────────────────────

  const handleAddImage = useCallback(async () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.click();
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      setUploading(true);
      try {
        const formData = new FormData();
        formData.append("file", file);
        const res = await fetch("/api/uploads", { method: "POST", body: formData });
        const data = await res.json();
        const clipRect = clipAreaRef.current?.getBoundingClientRect();
        const clipW = clipRect?.width ?? 200;
        const clipH = clipRect?.height ?? 200;

        // Resolve the image's natural dimensions to preserve its real aspect ratio
        const natural = await new Promise<{ w: number; h: number }>((resolve) => {
          const img = new Image();
          img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
          img.onerror = () => resolve({ w: 1, h: 1 });
          img.src = data.url;
        });

        // Fit inside 60% of the clip area, keeping natural aspect ratio intact
        const maxW = clipW * 0.6;
        const maxH = clipH * 0.6;
        const ratio = natural.w / natural.h;
        let defaultW: number, defaultH: number;
        if (ratio > maxW / maxH) {
          defaultW = maxW;
          defaultH = maxW / ratio;
        } else {
          defaultH = maxH;
          defaultW = maxH * ratio;
        }
        defaultW = Math.round(defaultW);
        defaultH = Math.round(defaultH);

        const newLayer: DesignLayer = {
          id: crypto.randomUUID(),
          name: `Layer ${layers.length + 1}`,
          imageUrl: data.url,
          x: Math.round((clipW - defaultW) / 2),
          y: Math.round((clipH - defaultH) / 2),
          width: defaultW,
          height: defaultH,
          visible: true,
        };
        setLayers(prev => [...prev, newLayer]);
        setSelectedLayerId(newLayer.id);
      } finally {
        setUploading(false);
      }
    };
  }, [layers.length]);

  const removeLayer = (id: string) => {
    setLayers(prev => prev.filter(l => l.id !== id));
    if (selectedLayerId === id) setSelectedLayerId(null);
  };

  const toggleVisibility = (id: string) => {
    setLayers(prev => prev.map(l => l.id === id ? { ...l, visible: !l.visible } : l));
  };

  const moveLayerUp = (id: string) => {
    setLayers(prev => {
      const idx = prev.findIndex(l => l.id === id);
      if (idx >= prev.length - 1) return prev;
      const next = [...prev];
      [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
      return next.map((l, i) => ({ ...l, name: `Layer ${i + 1}` }));
    });
  };

  const moveLayerDown = (id: string) => {
    setLayers(prev => {
      const idx = prev.findIndex(l => l.id === id);
      if (idx <= 0) return prev;
      const next = [...prev];
      [next[idx], next[idx - 1]] = [next[idx - 1], next[idx]];
      return next.map((l, i) => ({ ...l, name: `Layer ${i + 1}` }));
    });
  };

  // ── Export ─────────────────────────────────────────────────────────────────

  const handleExport = useCallback(async () => {
    const clipEl = clipAreaRef.current;
    if (!clipEl || !realWidth || !realHeight || !bbox) return;

    const visibleLayers = layers.filter(l => l.visible);
    if (visibleLayers.length === 0) return;

    setExporting(true);
    try {
      const clipRect = clipEl.getBoundingClientRect();
      const clipW = clipRect.width;
      const clipH = clipRect.height;

      // The bounding box % × real shirt size = actual physical print area
      const printW_cm = (bbox.width / 100) * realWidth;
      const printH_cm = (bbox.height / 100) * realHeight;

      // 300 DPI for DTF print quality: px = cm / 2.54 × 300
      const DPI = 300;
      const exportW = Math.round((printW_cm / 2.54) * DPI);
      const exportH = Math.round((printH_cm / 2.54) * DPI);

      // Scale layers from screen clip-space to export pixel-space
      const scaleX = exportW / clipW;
      const scaleY = exportH / clipH;

      const canvas = document.createElement("canvas");
      canvas.width = exportW;
      canvas.height = exportH;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";

      // Transparent background — no fill
      ctx.clearRect(0, 0, exportW, exportH);

      // Draw each visible layer in order (bottom to top)
      for (const layer of visibleLayers) {
        await new Promise<void>((resolve) => {
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.onload = () => {
            const dx = layer.x * scaleX;
            const dy = layer.y * scaleY;
            const dw = layer.width * scaleX;
            const dh = layer.height * scaleY;

            // Clip to bounding box — crop overflow
            ctx.save();
            ctx.beginPath();
            ctx.rect(0, 0, exportW, exportH);
            ctx.clip();
            ctx.drawImage(img, dx, dy, dw, dh);
            ctx.restore();
            resolve();
          };
          img.onerror = () => resolve();
          img.src = layer.imageUrl;
        });
      }

      // Filename: print area in cm + pixel dimensions for DTF
      const wCm = printW_cm.toFixed(1).replace(".", "_");
      const hCm = printH_cm.toFixed(1).replace(".", "_");
      const filename = `design-${side}-${wCm}x${hCm}cm-${exportW}x${exportH}px.png`;

      canvas.toBlob(blob => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
      }, "image/png");
    } finally {
      setExporting(false);
    }
  }, [layers, realWidth, realHeight, bbox, side]);

  if (!selectedProduct || !selectedFit || !selectedColor || !selectedSize) return null;

  const selectedLayer = layers.find(l => l.id === selectedLayerId) ?? null;

  return (
    <div className="min-h-screen pt-20 flex flex-col bg-background">
      {/* ── Top bar ── */}
      <div className="border-b border-border px-6 md:px-12 py-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-6">
          <button
            onClick={() => setLocation("/sizes")}
            className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors"
          >
            ← Back
          </button>
          <h1 className="text-sm font-bold uppercase tracking-widest">Design Mode</h1>
        </div>
        <div className="flex items-center gap-4">
          {/* Export button */}
          {layers.some(l => l.visible) && realWidth > 0 && (
            <button
              onClick={handleExport}
              disabled={exporting}
              className="text-xs uppercase tracking-widest font-bold px-5 py-2 bg-foreground text-background hover:opacity-80 transition-opacity disabled:opacity-40"
            >
              {exporting ? "Exporting…" : "Export Design"}
            </button>
          )}
          <button
            onClick={() => { reset(); setLocation("/"); }}
            className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors"
          >
            Start Over
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">

        {/* ── Main canvas ── */}
        <div className="flex-1 flex flex-col items-center justify-center p-8">

          {/* Front / Back toggle */}
          <div className="flex gap-0 mb-8 border border-border">
            {(["front", "back"] as const).map(s => (
              <button
                key={s}
                onClick={() => setSide(s)}
                className={`px-6 py-2 text-xs uppercase tracking-widest font-medium transition-colors ${side === s ? "bg-foreground text-background" : "bg-transparent text-foreground hover:bg-muted/20"}`}
              >
                {s}
              </button>
            ))}
          </div>

          {/* Mockup viewer */}
          <div
            className="relative w-full max-w-sm"
            style={{
              aspectRatio: "3/4",
              backgroundImage:
                "linear-gradient(45deg, #2a2a2a 25%, transparent 25%), linear-gradient(-45deg, #2a2a2a 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #2a2a2a 75%), linear-gradient(-45deg, transparent 75%, #2a2a2a 75%)",
              backgroundSize: "16px 16px",
              backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0px",
              backgroundColor: "#1a1a1a",
            }}
          >
            <AnimatePresence mode="wait">
              <motion.div
                key={side}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="absolute inset-0"
              >
                {currentSide?.image ? (
                  <img
                    src={currentSide.image}
                    alt={`${side} mockup`}
                    className="w-full h-full object-contain pointer-events-none"
                    style={{ position: "relative", zIndex: 1 }}
                  />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center gap-3 border border-dashed border-border">
                    <span className="text-5xl text-muted-foreground/20 font-black uppercase">{side[0]}</span>
                    <p className="text-xs uppercase tracking-widest text-muted-foreground/50">
                      No mockup for {side} view
                    </p>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>

            {/* ── Design clip area ── */}
            {bbox && (
              <div
                ref={clipAreaRef}
                style={{
                  position: "absolute",
                  left: `${bbox.x}%`,
                  top: `${bbox.y}%`,
                  width: `${bbox.width}%`,
                  height: `${bbox.height}%`,
                  overflow: "hidden",
                  zIndex: 5,
                }}
              >
                {layers.map((layer) =>
                  layer.visible ? (
                    <img
                      key={layer.id}
                      src={layer.imageUrl}
                      alt={layer.name}
                      draggable={false}
                      onMouseDown={e => startDrag(e, layer)}
                      style={{
                        position: "absolute",
                        left: layer.x,
                        top: layer.y,
                        width: layer.width,
                        height: layer.height,
                        minWidth: layer.width,
                        minHeight: layer.height,
                        maxWidth: "none",
                        maxHeight: "none",
                        cursor: dragRef.current?.layerId === layer.id ? "grabbing" : "grab",
                        userSelect: "none",
                        background: "none",
                        flexShrink: 0,
                      }}
                    />
                  ) : null
                )}
              </div>
            )}

            {/* ── Bbox border overlay ── */}
            {bbox && (
              <div
                style={{
                  position: "absolute",
                  left: `${bbox.x}%`,
                  top: `${bbox.y}%`,
                  width: `${bbox.width}%`,
                  height: `${bbox.height}%`,
                  border: layers.length === 0 ? "1px dashed rgba(255,255,255,0.18)" : "none",
                  zIndex: 6,
                  pointerEvents: "none",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 2,
                }}
              >
                {layers.length === 0 && realWidth > 0 && (
                  <>
                    <p style={{ fontSize: "clamp(10px, 2vw, 18px)", fontWeight: 900, fontFamily: "monospace", color: "rgba(255,255,255,0.4)", lineHeight: 1 }}>
                      {realWidth} × {realHeight}
                    </p>
                    <p style={{ fontSize: "clamp(8px, 1vw, 10px)", color: "rgba(255,255,255,0.25)", letterSpacing: "0.12em", textTransform: "uppercase", fontFamily: "monospace" }}>
                      cm
                    </p>
                  </>
                )}
              </div>
            )}
          </div>

          {!bbox && currentSide?.image && (
            <p className="text-xs text-muted-foreground uppercase tracking-widest mt-6">
              No bounding box set — configure it in the Admin Panel
            </p>
          )}
        </div>

        {/* ── Right sidebar ── */}
        <div className="w-72 border-l border-border flex flex-col shrink-0 overflow-hidden">

          {/* Config summary */}
          <div className="p-6 border-b border-border">
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">Configuration</p>
            <div className="space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground uppercase tracking-widest">Product</span>
                <span className="font-bold uppercase">{selectedProduct.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground uppercase tracking-widest">Fit</span>
                <span className="font-bold uppercase">{selectedFit.name}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground uppercase tracking-widest">Color</span>
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 border border-border" style={{ backgroundColor: selectedColor.hex }} />
                  <span className="font-bold uppercase">{selectedColor.name}</span>
                </div>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground uppercase tracking-widest">Size</span>
                <span className="font-bold uppercase">{selectedSize.name}</span>
              </div>
              {realWidth > 0 && (
                <div className="flex justify-between pt-1 border-t border-border mt-2">
                  <span className="text-muted-foreground uppercase tracking-widest">Design Area</span>
                  <span className="font-mono font-bold">{realWidth} × {realHeight} cm</span>
                </div>
              )}
            </div>
          </div>

          {/* ── Tools ── */}
          <div className="p-6 border-b border-border space-y-3">
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Tools</p>

            {/* Add Image */}
            <button
              onClick={handleAddImage}
              disabled={uploading || !bbox}
              className="w-full flex items-center gap-3 border border-border px-4 py-3 hover:border-foreground hover:bg-muted/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <span className="text-lg leading-none">🖼</span>
              <div className="text-left">
                <p className="text-xs font-bold uppercase tracking-widest">
                  {uploading ? "Uploading…" : "Add Image"}
                </p>
                {!bbox && (
                  <p className="text-xs text-muted-foreground mt-0.5">Set bbox in admin first</p>
                )}
              </div>
            </button>

            {/* Zoom controls — only when a layer is selected */}
            {selectedLayer && (
              <div className="flex items-center gap-2">
                <p className="text-xs uppercase tracking-widest text-muted-foreground flex-1">Zoom</p>
                <button
                  onClick={() => zoomSelected("out")}
                  className="w-9 h-9 border border-border flex items-center justify-center text-base font-bold hover:border-foreground hover:bg-muted/10 transition-colors"
                  title="Zoom Out"
                >
                  −
                </button>
                <button
                  onClick={() => zoomSelected("in")}
                  className="w-9 h-9 border border-border flex items-center justify-center text-base font-bold hover:border-foreground hover:bg-muted/10 transition-colors"
                  title="Zoom In"
                >
                  +
                </button>
              </div>
            )}
          </div>

          {/* ── Layers panel ── */}
          <div className="flex-1 overflow-y-auto">
            <div className="p-6">
              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-4">
                Layers {layers.length > 0 && `(${layers.length})`}
              </p>

              {layers.length === 0 ? (
                <p className="text-xs text-muted-foreground uppercase tracking-widest leading-relaxed">
                  No layers yet. Add an image to start designing.
                </p>
              ) : (
                <div className="space-y-2">
                  {[...layers].reverse().map((layer, reversedIdx) => {
                    const trueIdx = layers.length - 1 - reversedIdx;
                    const isSelected = selectedLayerId === layer.id;
                    return (
                      <motion.div
                        key={layer.id}
                        initial={{ opacity: 0, x: 8 }}
                        animate={{ opacity: 1, x: 0 }}
                        className={`border transition-colors ${isSelected ? "border-foreground bg-muted/10" : "border-border hover:border-muted-foreground/40"}`}
                      >
                        <div
                          className="flex items-center gap-2 px-3 py-2 cursor-pointer"
                          onClick={() => setSelectedLayerId(isSelected ? null : layer.id)}
                        >
                          {/* Thumbnail — transparent bg, no white frame */}
                          <div className="w-8 h-8 border border-border overflow-hidden shrink-0"
                            style={{
                              backgroundImage: "linear-gradient(45deg, #2a2a2a 25%, transparent 25%), linear-gradient(-45deg, #2a2a2a 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #2a2a2a 75%), linear-gradient(-45deg, transparent 75%, #2a2a2a 75%)",
                              backgroundSize: "6px 6px",
                              backgroundPosition: "0 0, 0 3px, 3px -3px, -3px 0px",
                              backgroundColor: "#1a1a1a",
                            }}
                          >
                            <img src={layer.imageUrl} alt="" className="w-full h-full object-contain" />
                          </div>

                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-bold uppercase tracking-widest truncate">
                              {layer.name}
                            </p>
                          </div>

                          <button
                            onClick={e => { e.stopPropagation(); toggleVisibility(layer.id); }}
                            className="text-muted-foreground hover:text-foreground transition-colors text-xs p-0.5"
                            title={layer.visible ? "Hide" : "Show"}
                          >
                            {layer.visible ? "👁" : "🙈"}
                          </button>
                        </div>

                        {isSelected && (
                          <div className="px-3 pb-3 space-y-2 border-t border-border pt-2">
                            {/* Zoom row */}
                            <div className="flex gap-1.5">
                              <button
                                onClick={() => zoomSelected("out")}
                                className="flex-1 text-xs py-1 border border-border hover:border-foreground transition-colors uppercase tracking-widest font-bold"
                                title="Zoom Out"
                              >
                                − Zoom
                              </button>
                              <button
                                onClick={() => zoomSelected("in")}
                                className="flex-1 text-xs py-1 border border-border hover:border-foreground transition-colors uppercase tracking-widest font-bold"
                                title="Zoom In"
                              >
                                + Zoom
                              </button>
                            </div>
                            {/* Order + delete row */}
                            <div className="flex gap-1.5">
                              <button
                                onClick={() => moveLayerUp(layer.id)}
                                disabled={trueIdx === layers.length - 1}
                                className="flex-1 text-xs py-1 border border-border hover:border-foreground transition-colors disabled:opacity-30 uppercase tracking-widest"
                                title="Move up"
                              >
                                ↑ Up
                              </button>
                              <button
                                onClick={() => moveLayerDown(layer.id)}
                                disabled={trueIdx === 0}
                                className="flex-1 text-xs py-1 border border-border hover:border-foreground transition-colors disabled:opacity-30 uppercase tracking-widest"
                                title="Move down"
                              >
                                ↓ Down
                              </button>
                              <button
                                onClick={() => removeLayer(layer.id)}
                                className="text-xs py-1 px-2 border border-destructive/40 text-destructive hover:bg-destructive/10 transition-colors uppercase tracking-widest"
                                title="Delete layer"
                              >
                                ✕
                              </button>
                            </div>
                          </div>
                        )}
                      </motion.div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
