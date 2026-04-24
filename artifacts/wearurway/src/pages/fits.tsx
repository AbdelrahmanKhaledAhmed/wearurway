import { useEffect } from "react";
import { useLocation, useSearch } from "wouter";
import { motion } from "framer-motion";
import { useGetFits } from "@workspace/api-client-react";
import { useCustomizer } from "@/hooks/use-customizer";
import { Skeleton } from "@/components/ui/skeleton";
import { trackEvent } from "@/lib/analytics";

export default function Fits() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const productId = params.get("product");

  const { data: fits, isLoading } = useGetFits();
  const { setFit, selectedProduct } = useCustomizer();

  useEffect(() => {
    if (!productId && !selectedProduct) {
      setLocation("/products");
    } else {
      trackEvent("view_fits");
    }
  }, [productId, selectedProduct, setLocation]);

  const productFits = fits?.filter(f => f.productId === productId);

  const handleSelect = (fit: any) => {
    if (!fit.available) return;
    setFit(fit);
    setLocation(`/colors?fit=${fit.id}`);
  };

  return (
    <div className="min-h-screen pt-24 px-6 md:px-12 lg:px-24 max-w-7xl mx-auto">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <h1 className="text-4xl md:text-6xl font-bold tracking-tighter mb-2 uppercase">Which fit do you prefer?</h1>
        <p className="text-muted-foreground text-lg mb-12">Define the silhouette.</p>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-32 w-full rounded-none" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {productFits?.map((fit) => (
              <motion.div
                key={fit.id}
                whileHover={fit.available ? { scale: 1.02 } : {}}
                whileTap={fit.available ? { scale: 0.98 } : {}}
                onClick={() => handleSelect(fit)}
                className={`p-6 border border-border flex flex-col justify-center items-center text-center cursor-pointer transition-colors ${
                  fit.available 
                    ? "hover:border-foreground bg-card min-h-48" 
                    : "opacity-50 cursor-not-allowed bg-muted/20 min-h-48"
                }`}
              >
                <h3 className="text-2xl font-bold uppercase tracking-tight mb-4">{fit.name}</h3>
                {!fit.available && (
                  <span className="inline-block px-3 py-1 bg-muted text-muted-foreground text-xs font-medium tracking-widest uppercase">
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
