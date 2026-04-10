import { useEffect, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { motion } from "framer-motion";
import { useGetSizes, getGetSizesQueryKey } from "@workspace/api-client-react";
import { useCustomizer } from "@/hooks/use-customizer";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";

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
    }
  }, [fitId, colorId, setLocation]);

  const handleSelect = (size: any) => {
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
            onClick={() => setLocation("/")}
          >
            Start Over
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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-80 w-full rounded-none" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {sizes?.map((size) => (
              <motion.div
                key={size.id}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => handleSelect(size)}
                className="group cursor-pointer border border-border bg-card p-6 flex flex-col items-center hover:border-foreground transition-colors"
              >
                <div className="h-40 w-full mb-6 bg-muted/30 flex items-center justify-center relative overflow-hidden">
                  {size.image ? (
                    <img src={size.image} alt={size.name} className="object-contain h-full w-full" />
                  ) : (
                    <span className="text-muted-foreground uppercase text-xs tracking-widest">No Image</span>
                  )}
                </div>
                <h3 className="text-3xl font-bold uppercase tracking-tight mb-2">{size.name}</h3>
                <p className="text-sm text-muted-foreground font-mono">
                  {size.realWidth} x {size.realHeight} CM
                </p>
              </motion.div>
            ))}
          </div>
        )}
      </motion.div>
    </div>
  );
}
