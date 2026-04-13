import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { useCustomizer } from "@/hooks/use-customizer";

export default function Checkout() {
  const [, setLocation] = useLocation();
  const { selectedProduct, selectedFit, selectedColor, selectedSize, reset } = useCustomizer();

  const handleNewOrder = () => {
    reset();
    setLocation("/products");
  };

  return (
    <div className="min-h-screen bg-[#0b0b0b] flex flex-col items-center justify-center px-6">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="w-full max-w-md text-center"
      >
        {/* Checkmark */}
        <motion.div
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.15, type: "spring", stiffness: 260, damping: 20 }}
          className="w-20 h-20 mx-auto mb-8 rounded-full flex items-center justify-center"
          style={{ backgroundColor: "#f5c842" }}
        >
          <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
            <path d="M8 18L15 25L28 11" stroke="#0d0d0d" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </motion.div>

        <p className="text-[10px] tracking-[0.3em] text-white/40 uppercase mb-3">Order Placed</p>
        <h1
          className="text-4xl font-black uppercase mb-4"
          style={{ fontFamily: "monospace", letterSpacing: "0.05em" }}
        >
          You're all set.
        </h1>
        <p className="text-sm text-white/50 leading-relaxed mb-10">
          Your custom order has been received. Our team will be in touch shortly to confirm the details and arrange delivery.
        </p>

        {/* Summary */}
        {selectedProduct && (
          <div className="border border-white/10 divide-y divide-white/10 mb-10 text-left">
            {[
              { label: "Product", value: selectedProduct?.name },
              { label: "Fit", value: selectedFit?.name },
              { label: "Color", value: selectedColor?.name },
              { label: "Size", value: selectedSize?.name },
            ].map(row => (
              <div key={row.label} className="flex justify-between items-center px-5 py-3">
                <span className="text-[10px] tracking-[0.2em] text-white/40 uppercase">{row.label}</span>
                <span className="text-xs font-bold uppercase tracking-widest">{row.value ?? "—"}</span>
              </div>
            ))}
          </div>
        )}

        <button
          onClick={handleNewOrder}
          className="w-full py-4 font-black uppercase tracking-[0.2em] text-sm transition-all active:scale-[0.98]"
          style={{ backgroundColor: "#f5c842", color: "#0d0d0d" }}
        >
          Start New Order
        </button>

        <button
          onClick={() => setLocation("/")}
          className="mt-4 w-full py-3 text-xs uppercase tracking-widest font-bold border border-white/10 text-white/50 hover:border-white/30 hover:text-white transition-colors"
        >
          Back to Home
        </button>
      </motion.div>
    </div>
  );
}
