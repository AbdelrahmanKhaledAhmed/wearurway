import { Link } from "wouter";
import { motion } from "framer-motion";
import { FaInstagram, FaTiktok } from "react-icons/fa";
import { Button } from "@/components/ui/button";

export default function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center relative overflow-hidden">
      <div className="absolute inset-0 z-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-accent/20 via-background to-background pointer-events-none" />
      
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: "easeOut" }}
        className="z-10 flex flex-col items-center text-center space-y-8 px-4"
      >
        <h1 className="text-6xl md:text-9xl font-bold tracking-tighter uppercase">
          wearurway
        </h1>
        <p className="text-lg md:text-2xl text-muted-foreground max-w-lg font-light">
          Premium streetwear. Your rules.
        </p>
        
        <div className="pt-8">
          <Link href="/products" className="inline-block">
            <Button size="lg" className="h-14 px-8 text-lg font-medium rounded-none uppercase tracking-widest bg-foreground text-background hover:bg-foreground/90 transition-all duration-300">
              Start Customize
            </Button>
          </Link>
        </div>

        <div className="flex items-center gap-6 pt-4">
          <a
            href="https://www.instagram.com/wearurway.store/"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Instagram"
            className="text-muted-foreground hover:text-foreground transition-colors duration-300"
            data-testid="link-instagram"
          >
            <FaInstagram className="w-7 h-7" />
          </a>
          <a
            href="https://www.tiktok.com/@wearurway"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="TikTok"
            className="text-muted-foreground hover:text-foreground transition-colors duration-300"
            data-testid="link-tiktok"
          >
            <FaTiktok className="w-7 h-7" />
          </a>
        </div>
      </motion.div>
    </div>
  );
}
