import { useEffect, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { motion } from "framer-motion";
import { useGetSizes, getGetSizesQueryKey } from "@workspace/api-client-react";
import { useCustomizer } from "@/hooks/use-customizer";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { trackEvent } from "@/lib/analytics";

export default function Sizes() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const fitId = params.get("fit");
  const colorId = params.get("color");

  const { data: sizes, isLoading } = useGetSizes(fitId || "", {
    query: { enabled: !!fitId, queryKey: getGetSizesQueryKey(fitId || "") }
  });
  
  const { setSize, selectedProduct, selectedFit, selectedColor, selectedSize } = useCustomizer();
  const [showConfirmation, setShowConfirmation] = useState(false);

  useEffect(() => {
    if (!fitId || !colorId) {
      setLocation("/colors");
    } else {
      trackEvent("view_sizes");
    }
  }, [fitId, colorId, setLocation]);

  const handleSelect = (size: any) => {
    if (size.available === false) return;
    setSize(size);
    setShowConfirmation(true);
  };

  if (showConfirmation) {
    return (
      <div className="min-h-screen pt-24 px-6 md:px-12 flex flex-col items-center justify-center">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="max-w-2xl w-full border border-border bg-card p-12 text-center"
        >
          <h2 className="text-3xl md:text-5xl font-bold tracking-tighter uppercase mb-8">
            You've configured your tee!
          </h2>
          
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-12 text-left">
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-widest mb-1">Product</p>
              <p className="font-bold text-lg uppercase">{selectedProduct?.name}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-widest mb-1">Fit</p>
              <p className="font-bold text-lg uppercase">{selectedFit?.name}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-widest mb-1">Color</p>
              <div className="flex items-center gap-3">
                <div className="w-6 h-6 border border-border" style={{ backgroundColor: selectedColor?.hex }} />
                <p className="font-bold text-lg uppercase">{selectedColor?.name}</p>
              </div>
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-widest mb-1">Size</p>
              <p className="font-bold text-lg uppercase">{selectedSize?.name}</p>
            </div>
          </div>
          
          <Button 
            size="lg" 
            className="rounded-none px-12 h-14 uppercase tracking-widest"
            onClick={() => setLocation("/design")}
          >
            Start Design
          </Button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen pt-24 px-6 md:px-12 lg:px-24 max-w-7xl mx-auto">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <h1 className="text-4xl md:text-6xl font-bold tracking-tighter mb-2 uppercase">Select Size</h1>
        <p className="text-muted-foreground text-lg mb-12">Perfect your fit.</p>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-32 w-full rounded-none" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {sizes?.map((size) => (
              <motion.div
                key={size.id}
                whileHover={size.available !== false ? { scale: 1.02 } : {}}
                whileTap={size.available !== false ? { scale: 0.98 } : {}}
                onClick={() => handleSelect(size)}
                className={`p-6 border border-border flex flex-col justify-center items-center text-center transition-colors ${
                  size.available !== false
                    ? "hover:border-foreground bg-card min-h-48 cursor-pointer"
                    : "opacity-50 cursor-not-allowed bg-muted/20 min-h-48"
                }`}
              >
                <h3 className="text-2xl font-bold uppercase tracking-tight mb-3">{size.name}</h3>

                <p className="text-sm font-mono text-foreground mb-3">
                  {size.realWidth} x {size.realHeight} CM
                </p>

                <div className="flex flex-col gap-1 text-xs text-muted-foreground">
                  <span>{size.heightMin} ~ {size.heightMax} cm tall</span>
                  <span>{size.weightMin} ~ {size.weightMax} kg</span>
                </div>

                {size.comingSoon && (
                  <span className="mt-4 inline-block px-3 py-1 bg-muted text-muted-foreground text-xs font-medium tracking-widest uppercase">
                    Coming Soon
                  </span>
                )}
              </motion.div>
            ))}
          </div>
        )}
      </motion.div>
    </div>
  );
}
