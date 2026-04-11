import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { useGetMockup, getGetMockupQueryKey } from "@workspace/api-client-react";
import { useCustomizer } from "@/hooks/use-customizer";
import { Button } from "@/components/ui/button";

export default function Design() {
  const [, setLocation] = useLocation();
  const { selectedProduct, selectedFit, selectedColor, selectedSize, reset } = useCustomizer();
  const [side, setSide] = useState<"front" | "back">("front");

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

  // Real-world dimensions from selected size (data only — never affects bounding box visually)
  const realWidth = selectedSize?.realWidth ?? 0;
  const realHeight = selectedSize?.realHeight ?? 0;

  if (!selectedProduct || !selectedFit || !selectedColor || !selectedSize) {
    return null;
  }

  return (
    <div className="min-h-screen pt-20 flex flex-col">
      {/* Top bar */}
      <div className="border-b border-border px-6 md:px-12 py-4 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <button onClick={() => setLocation("/sizes")} className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors">
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
        {/* Main canvas area */}
        <div className="flex-1 flex flex-col items-center justify-center p-8 bg-muted/5">
          {/* Front / Back toggle */}
          <div className="flex gap-0 mb-8 border border-border">
            <button
              onClick={() => setSide("front")}
              className={`px-6 py-2 text-xs uppercase tracking-widest font-medium transition-colors ${side === "front" ? "bg-foreground text-background" : "bg-transparent text-foreground hover:bg-muted/20"}`}
            >
              Front
            </button>
            <button
              onClick={() => setSide("back")}
              className={`px-6 py-2 text-xs uppercase tracking-widest font-medium transition-colors ${side === "back" ? "bg-foreground text-background" : "bg-transparent text-foreground hover:bg-muted/20"}`}
            >
              Back
            </button>
          </div>

          {/* Mockup viewer */}
          <div className="relative w-full max-w-lg aspect-[3/4] border border-border bg-card flex items-center justify-center overflow-hidden">
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
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center gap-3">
                    <div className="w-24 h-24 border-2 border-dashed border-border flex items-center justify-center">
                      <span className="text-3xl text-muted-foreground/30 font-bold uppercase">{side[0]}</span>
                    </div>
                    <p className="text-xs uppercase tracking-widest text-muted-foreground">
                      No mockup uploaded for {side} view
                    </p>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>

            {/* Design area bounding box — position is fixed per mockup, numbers reflect selected size */}
            {bbox && (
              <div
                data-design-area="true"
                data-real-width-cm={realWidth}
                data-real-height-cm={realHeight}
                style={{
                  position: "absolute",
                  left: `${bbox.x}%`,
                  top: `${bbox.y}%`,
                  width: `${bbox.width}%`,
                  height: `${bbox.height}%`,
                  border: "1px dashed rgba(255,255,255,0.25)",
                  pointerEvents: "none",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "2px",
                }}
              >
                {/* Real-world cm numbers — update on size change, box never moves */}
                {realWidth > 0 && realHeight > 0 ? (
                  <>
                    <p
                      style={{ fontSize: "clamp(10px, 2vw, 18px)", fontWeight: 900, fontFamily: "monospace", color: "rgba(255,255,255,0.55)", letterSpacing: "0.05em", lineHeight: 1 }}
                    >
                      {realWidth} × {realHeight}
                    </p>
                    <p
                      style={{ fontSize: "clamp(8px, 1.2vw, 11px)", color: "rgba(255,255,255,0.3)", letterSpacing: "0.12em", textTransform: "uppercase", fontFamily: "monospace" }}
                    >
                      cm
                    </p>
                  </>
                ) : (
                  <p style={{ fontSize: 10, color: "rgba(255,255,255,0.2)", letterSpacing: "0.1em", textTransform: "uppercase" }}>
                    Design Area
                  </p>
                )}
              </div>
            )}
          </div>

          {!bbox && currentSide?.image && (
            <p className="text-xs text-muted-foreground uppercase tracking-widest mt-4">
              No bounding box defined for this view — set it in the Admin Panel
            </p>
          )}
        </div>

        {/* Right sidebar — config summary */}
        <div className="w-72 border-l border-border p-8 flex flex-col gap-8 shrink-0">
          <div>
            <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-4">Your Configuration</h2>
            <div className="space-y-4">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-widest">Product</p>
                <p className="font-bold uppercase">{selectedProduct.name}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-widest">Fit</p>
                <p className="font-bold uppercase">{selectedFit.name}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-widest">Color</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <div className="w-5 h-5 border border-border shrink-0" style={{ backgroundColor: selectedColor.hex }} />
                  <p className="font-bold uppercase">{selectedColor.name}</p>
                </div>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-widest">Size</p>
                <p className="font-bold uppercase">{selectedSize.name}</p>
              </div>
            </div>
          </div>

          {/* Design area dimensions — numbers from selected size */}
          <div className="border border-border p-4">
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">Design Area</p>
            <p className="text-3xl font-black font-mono leading-none">
              {realWidth > 0 ? `${realWidth} × ${realHeight}` : "—"}
            </p>
            <p className="text-xs text-muted-foreground uppercase tracking-widest mt-2">cm (width × height)</p>
            <p className="text-xs text-muted-foreground mt-3 leading-relaxed">
              Updates per size. Box position on mockup never changes.
            </p>
          </div>

          <div className="mt-auto">
            <p className="text-xs text-muted-foreground uppercase tracking-widest text-center border border-dashed border-border p-4">
              Design tools coming soon
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
