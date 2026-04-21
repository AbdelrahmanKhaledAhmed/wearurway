import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface Props {
  onImageReady: (file: File) => void;
  disabled?: boolean;
}

type Step = "intro" | "import" | "loading" | "done";

const PINTEREST_URL = "https://www.pinterest.com/WEARURWAY/t-shirt-designs/";

function isImageUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return ["http:", "https:"].includes(u.protocol);
  } catch {
    return false;
  }
}

async function convertToPng(blob: Blob): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) { URL.revokeObjectURL(objectUrl); reject(new Error("Canvas unavailable")); return; }
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(objectUrl);
      canvas.toBlob(png => {
        if (png) resolve(png);
        else reject(new Error("PNG conversion failed"));
      }, "image/png");
    };
    img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error("Image load failed")); };
    img.crossOrigin = "anonymous";
    img.src = objectUrl;
  });
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

export default function PinterestImportButton({ disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("intro");
  const [urlInput, setUrlInput] = useState("");
  const [urlError, setUrlError] = useState("");
  const [loadingMsg, setLoadingMsg] = useState("");

  const reset = () => {
    setStep("intro");
    setUrlInput("");
    setUrlError("");
    setLoadingMsg("");
  };

  const handleOpen = () => { reset(); setOpen(true); };
  const handleClose = () => { setOpen(false); setTimeout(reset, 300); };

  const handleOpenPinterest = () => {
    window.open(PINTEREST_URL, "_blank", "noopener,noreferrer");
    setStep("import");
  };

  const handleUrlSubmit = async () => {
    setUrlError("");
    const trimmed = urlInput.trim();
    if (!trimmed) { setUrlError("Please paste an image URL."); return; }
    if (!isImageUrl(trimmed)) { setUrlError("Please enter a valid http/https URL."); return; }

    setStep("loading");
    setLoadingMsg("Finding your image…");

    // Cycle through friendly loading messages while waiting
    const msgs = ["Finding your image…", "Downloading from Pinterest…", "Almost there…"];
    let mi = 0;
    const ticker = setInterval(() => { mi = (mi + 1) % msgs.length; setLoadingMsg(msgs[mi]); }, 2500);

    try {
      const res = await fetch("/api/proxy-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: trimmed }),
      });
      clearInterval(ticker);

      if (!res.ok) {
        setStep("import");
        setUrlError("Couldn't grab that image — try pasting the link again.");
        return;
      }

      const blob = await res.blob();
      setLoadingMsg("Converting to PNG…");
      const png = await convertToPng(blob);
      triggerDownload(png, "pinterest-design.png");
      setStep("done");
    } catch {
      clearInterval(ticker);
      setStep("import");
      setUrlError("Something went wrong. Please try again.");
    }
  };

  const handleUrlKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleUrlSubmit();
  };

  return (
    <>
      {/* Trigger button */}
      <motion.button
        onClick={handleOpen}
        disabled={disabled}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.97 }}
        className="fixed bottom-6 left-2 z-40 flex items-start gap-3 px-4 py-4 rounded-2xl shadow-2xl disabled:opacity-40 disabled:cursor-not-allowed transition-opacity max-w-[190px] text-left"
        style={{ backgroundColor: "#E60023", color: "#fff" }}
        title="I'll help you find or pick the perfect design"
      >
        <PinterestIcon className="w-4 h-4 flex-shrink-0 mt-0.5" />
        <span className="text-[11px] font-semibold leading-snug">
          Not sure which design fits your idea?{" "}
          <span className="font-black">I'll help you pick the perfect one.</span>
        </span>
      </motion.button>

      {/* Modal */}
      <AnimatePresence>
        {open && (
          <>
            <motion.div
              key="overlay"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm"
              onClick={handleClose}
            />

            <motion.div
              key="panel"
              initial={{ opacity: 0, y: 32, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.97 }}
              transition={{ type: "spring", damping: 26, stiffness: 340 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none"
            >
              <div
                className="pointer-events-auto w-full max-w-md bg-[#0d0d0d] border border-white/10 overflow-hidden"
                onClick={e => e.stopPropagation()}
              >
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-5 border-b border-white/10">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ backgroundColor: "#E60023" }}>
                      <PinterestIcon className="w-4 h-4 text-white" />
                    </div>
                    <div>
                      <p className="text-[10px] tracking-[0.25em] text-white/40 uppercase">Design Inspiration</p>
                      <h2 className="text-sm font-black uppercase tracking-widest">Find Your Design</h2>
                    </div>
                  </div>
                  <button onClick={handleClose} className="text-white/30 hover:text-white transition-colors text-xl leading-none font-light ml-4">×</button>
                </div>

                {/* Intro step */}
                {step === "intro" && (
                  <div className="px-6 py-6">
                    <p className="text-sm text-white/70 leading-relaxed mb-6">
                      Not sure how to choose a good image or design that fits your idea?{" "}
                      <span className="text-white font-semibold">I'll help you find or pick the perfect design.</span>
                      <br /><br />
                      Open our curated Pinterest board, pick a design you love, then come back and paste the link — it'll download instantly as a PNG ready to use.
                    </p>
                    <div className="flex flex-col gap-3">
                      <motion.button
                        whileTap={{ scale: 0.97 }}
                        onClick={handleOpenPinterest}
                        className="w-full flex items-center justify-center gap-2.5 py-3.5 font-black uppercase text-xs tracking-[0.2em] transition-opacity hover:opacity-90"
                        style={{ backgroundColor: "#E60023", color: "#fff" }}
                      >
                        <PinterestIcon className="w-4 h-4" />
                        Browse Pinterest Designs
                      </motion.button>
                      <button
                        onClick={() => setStep("import")}
                        className="w-full py-3.5 border border-white/15 font-bold uppercase text-xs tracking-[0.2em] text-white/50 hover:text-white hover:border-white/30 transition-colors"
                      >
                        I already have a link
                      </button>
                      <button onClick={handleClose} className="w-full py-2 text-[10px] text-white/25 hover:text-white/50 transition-colors uppercase tracking-widest">
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {/* Import step */}
                {step === "import" && (
                  <div className="px-6 py-6 space-y-5">
                    <p className="text-[11px] text-white/50 leading-relaxed">
                      Paste a Pinterest pin or direct image URL below. The image will be automatically converted to PNG and downloaded to your device.
                    </p>

                    {/* URL input */}
                    <div>
                      <p className="text-[10px] tracking-[0.2em] uppercase text-white/40 mb-2">Paste Pinterest pin or image URL</p>
                      <div className="flex gap-2">
                        <input
                          type="url"
                          value={urlInput}
                          onChange={e => { setUrlInput(e.target.value); setUrlError(""); }}
                          onKeyDown={handleUrlKeyDown}
                          placeholder="https://www.pinterest.com/pin/…"
                          className="flex-1 bg-white/5 border border-white/15 px-3 py-2.5 text-xs text-white placeholder:text-white/20 focus:outline-none focus:border-white/40 transition-colors"
                          autoFocus
                        />
                        <button
                          onClick={handleUrlSubmit}
                          disabled={!urlInput.trim()}
                          className="px-4 py-2.5 font-black uppercase text-xs tracking-widest transition-opacity hover:opacity-80 disabled:opacity-30 disabled:cursor-not-allowed"
                          style={{ backgroundColor: "#f5c842", color: "#0d0d0d" }}
                        >
                          Download
                        </button>
                      </div>
                      {urlError && <p className="text-[11px] text-red-400 mt-2">{urlError}</p>}
                    </div>

                    <button onClick={() => setStep("intro")} className="text-[10px] text-white/30 hover:text-white/60 transition-colors uppercase tracking-widest">
                      ← Back
                    </button>
                  </div>
                )}

                {/* Loading step */}
                {step === "loading" && (
                  <div className="px-6 py-10 flex flex-col items-center gap-4">
                    <div className="w-8 h-8 border-2 border-white/20 border-t-white/70 rounded-full animate-spin" />
                    <p className="text-xs text-white/50 uppercase tracking-widest">{loadingMsg || "Processing…"}</p>
                  </div>
                )}

                {/* Done step */}
                {step === "done" && (
                  <div className="px-6 py-10 flex flex-col items-center gap-5 text-center">
                    <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ backgroundColor: "#E60023" }}>
                      <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm font-black uppercase tracking-widest text-white mb-1">Downloaded!</p>
                      <p className="text-[11px] text-white/50 leading-relaxed">Your image was saved as a PNG.<br />You can now add it in the editor.</p>
                    </div>
                    <button
                      onClick={handleClose}
                      className="mt-2 px-6 py-2.5 font-black uppercase text-xs tracking-widest transition-opacity hover:opacity-80"
                      style={{ backgroundColor: "#f5c842", color: "#0d0d0d" }}
                    >
                      Done
                    </button>
                  </div>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

function PinterestIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M12 0C5.373 0 0 5.373 0 12c0 5.084 3.163 9.426 7.627 11.174-.105-.949-.2-2.405.042-3.441.218-.937 1.407-5.965 1.407-5.965s-.359-.719-.359-1.782c0-1.668.967-2.914 2.171-2.914 1.023 0 1.518.769 1.518 1.69 0 1.029-.655 2.568-.994 3.995-.283 1.194.599 2.169 1.777 2.169 2.133 0 3.772-2.249 3.772-5.495 0-2.873-2.064-4.882-5.012-4.882-3.414 0-5.418 2.561-5.418 5.207 0 1.031.397 2.138.893 2.738a.36.36 0 0 1 .083.345l-.333 1.36c-.053.22-.174.267-.402.161-1.499-.698-2.436-2.889-2.436-4.649 0-3.785 2.75-7.262 7.929-7.262 4.163 0 7.398 2.967 7.398 6.931 0 4.136-2.607 7.464-6.227 7.464-1.216 0-2.359-.632-2.75-1.378l-.748 2.853c-.271 1.043-1.002 2.35-1.492 3.146C9.57 23.812 10.763 24 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0z" />
    </svg>
  );
}
