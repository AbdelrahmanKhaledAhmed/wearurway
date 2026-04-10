import { useEffect } from "react";
import { useLocation, useSearch } from "wouter";
import { motion } from "framer-motion";
import { useGetColors, getGetColorsQueryKey } from "@workspace/api-client-react";
import { useCustomizer } from "@/hooks/use-customizer";
import { Skeleton } from "@/components/ui/skeleton";

export default function Colors() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const fitId = params.get("fit");

  const { data: colors, isLoading } = useGetColors(fitId || "", {
    query: { enabled: !!fitId, queryKey: getGetColorsQueryKey(fitId || "") }
  });
  const { setColor, selectedFit } = useCustomizer();

  useEffect(() => {
    if (!fitId && !selectedFit) {
      setLocation("/fits");
    }
  }, [fitId, selectedFit, setLocation]);

  const handleSelect = (color: any) => {
    setColor(color);
    setLocation(`/sizes?fit=${fitId}&color=${color.id}`);
  };

  return (
    <div className="min-h-screen pt-24 px-6 md:px-12 lg:px-24 max-w-7xl mx-auto">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <h1 className="text-4xl md:text-6xl font-bold tracking-tighter mb-2 uppercase">Select Color</h1>
        <p className="text-muted-foreground text-lg mb-12">Set the tone.</p>

        {isLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-6">
            {[1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="aspect-square w-full rounded-none" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-6">
            {colors?.map((color) => (
              <motion.div
                key={color.id}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => handleSelect(color)}
                className="group cursor-pointer flex flex-col"
              >
                <div 
                  className="aspect-square w-full border border-border shadow-sm mb-4 transition-all group-hover:shadow-md"
                  style={{ backgroundColor: color.hex }}
                />
                <h3 className="text-sm font-medium uppercase tracking-widest text-center">{color.name}</h3>
              </motion.div>
            ))}
          </div>
        )}
      </motion.div>
    </div>
  );
}
