import { createContext, useContext, useState, ReactNode } from "react";
import { Product, Fit, Color, Size } from "@workspace/api-client-react";

interface CustomizerState {
  selectedProduct: Product | null;
  selectedFit: Fit | null;
  selectedColor: Color | null;
  selectedSize: Size | null;
  setProduct: (p: Product | null) => void;
  setFit: (f: Fit | null) => void;
  setColor: (c: Color | null) => void;
  setSize: (s: Size | null) => void;
  reset: () => void;
}

const CustomizerContext = createContext<CustomizerState | undefined>(undefined);

export function CustomizerProvider({ children }: { children: ReactNode }) {
  const [selectedProduct, setProduct] = useState<Product | null>(null);
  const [selectedFit, setFit] = useState<Fit | null>(null);
  const [selectedColor, setColor] = useState<Color | null>(null);
  const [selectedSize, setSize] = useState<Size | null>(null);

  const reset = () => {
    setProduct(null);
    setFit(null);
    setColor(null);
    setSize(null);
  };

  return (
    <CustomizerContext.Provider
      value={{
        selectedProduct,
        selectedFit,
        selectedColor,
        selectedSize,
        setProduct,
        setFit,
        setColor,
        setSize,
        reset,
      }}
    >
      {children}
    </CustomizerContext.Provider>
  );
}

export function useCustomizer() {
  const context = useContext(CustomizerContext);
  if (context === undefined) {
    throw new Error("useCustomizer must be used within a CustomizerProvider");
  }
  return context;
}
