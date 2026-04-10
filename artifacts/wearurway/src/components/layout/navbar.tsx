import { Link, useLocation } from "wouter";
import { ChevronRight } from "lucide-react";
import { useCustomizer } from "@/hooks/use-customizer";

export function Navbar() {
  const [location] = useLocation();
  const { selectedProduct, selectedFit, selectedColor } = useCustomizer();

  if (location === "/" || location.startsWith("/admin")) {
    return null;
  }

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 py-4 bg-background/80 backdrop-blur-md border-b border-border">
      <Link href="/" className="text-xl font-bold tracking-tighter uppercase">
        wearurway
      </Link>
      
      <div className="hidden md:flex items-center space-x-2 text-xs uppercase tracking-widest text-muted-foreground">
        <Link href="/products" className={`hover:text-foreground transition-colors ${location === '/products' ? 'text-foreground font-bold' : ''}`}>
          Products
        </Link>
        
        {(selectedProduct || location === '/fits' || location === '/colors' || location === '/sizes') && (
          <>
            <ChevronRight className="w-3 h-3" />
            <Link href={`/fits${selectedProduct ? `?product=${selectedProduct.id}` : ''}`} className={`hover:text-foreground transition-colors ${location === '/fits' ? 'text-foreground font-bold' : ''}`}>
              Fits
            </Link>
          </>
        )}
        
        {(selectedFit || location === '/colors' || location === '/sizes') && (
          <>
            <ChevronRight className="w-3 h-3" />
            <Link href={`/colors${selectedFit ? `?fit=${selectedFit.id}` : ''}`} className={`hover:text-foreground transition-colors ${location === '/colors' ? 'text-foreground font-bold' : ''}`}>
              Colors
            </Link>
          </>
        )}
        
        {(selectedColor || location === '/sizes') && (
          <>
            <ChevronRight className="w-3 h-3" />
            <span className={`${location === '/sizes' ? 'text-foreground font-bold' : ''}`}>
              Sizes
            </span>
          </>
        )}
      </div>
    </nav>
  );
}
