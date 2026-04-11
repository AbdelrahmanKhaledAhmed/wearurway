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
  x: number;       // px relative to clip area
  y: number;
  width: number;   // px
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

// ─── Main Component ───────────────────────────────────────────────────────────

export default function Design() {
  const [, setLocation] = useLocation();
  const { selectedProduct, selectedFit, selectedColor, selectedSize, reset } = useCustomizer();
  const [side, setSide] = useState<"front" | "back">("front");

  // Design layers state
  const [layers, setLayers] = useState<DesignLayer[]>([]);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

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
        const defaultW = Math.round((clipRect?.width ?? 200) * 0.6);
        const defaultH = defaultW;
        const newLayer: DesignLayer = {
          id: crypto.randomUUID(),
          name: `Layer ${layers.length + 1}`,
          imageUrl: data.url,
          x: Math.round(((clipRect?.width ?? 200) - defaultW) / 2),
          y: Math.round(((clipRect?.height ?? 200) - defaultH) / 2),
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

  if (!selectedProduct || !selectedFit || !selectedColor || !selectedSize) return null;

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
        <button
          onClick={() => { reset(); setLocation("/"); }}
          className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors"
        >
          Start Over
        </button>
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

          {/* Mockup viewer — checkerboard shows transparent areas of the PNG */}
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
                  /* Mockup image — sits BELOW design layers so art appears on the shirt */
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

            {/* ── Design clip area — layers are confined here ── */}
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
                {/* Design layers — rendered bottom to top by array order */}
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
                        cursor: dragRef.current?.layerId === layer.id ? "grabbing" : "grab",
                        userSelect: "none",
                        outline: selectedLayerId === layer.id
                          ? "1px solid rgba(255,255,255,0.6)"
                          : "none",
                        outlineOffset: "1px",
                      }}
                    />
                  ) : null
                )}
              </div>
            )}

            {/* ── Bbox border overlay (on top of design layers, below mockup image) ── */}
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
          <div className="p-6 border-b border-border">
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-4">Tools</p>

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
                  {/* Layers listed top-to-bottom = highest z on top */}
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
                          {/* Layer thumbnail */}
                          <div className="w-8 h-8 border border-border overflow-hidden shrink-0 bg-muted/10">
                            <img src={layer.imageUrl} alt="" className="w-full h-full object-contain" />
                          </div>

                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-bold uppercase tracking-widest truncate">
                              {layer.name}
                            </p>
                          </div>

                          {/* Visibility toggle */}
                          <button
                            onClick={e => { e.stopPropagation(); toggleVisibility(layer.id); }}
                            className="text-muted-foreground hover:text-foreground transition-colors text-xs p-0.5"
                            title={layer.visible ? "Hide" : "Show"}
                          >
                            {layer.visible ? "👁" : "🙈"}
                          </button>
                        </div>

                        {/* Selected layer actions */}
                        {isSelected && (
                          <div className="px-3 pb-3 flex gap-1.5 border-t border-border pt-2">
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
