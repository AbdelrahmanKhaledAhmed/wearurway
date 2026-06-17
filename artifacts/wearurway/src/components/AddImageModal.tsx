import { useState, useCallback, useRef, useEffect } from "react";

interface Props {
  onBrowse: () => void;
  onFile: (file: File) => void;
  onCancel: () => void;
}

export default function AddImageModal({ onBrowse, onFile, onCancel }: Props) {
  const [isDragging, setIsDragging] = useState(false);
  const dragDepthRef = useRef(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current += 1;
    if (e.dataTransfer.types.includes("Files")) {
      setIsDragging(true);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current -= 1;
    if (dragDepthRef.current <= 0) {
      dragDepthRef.current = 0;
      setIsDragging(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragDepthRef.current = 0;
      setIsDragging(false);
      const file = Array.from(e.dataTransfer.files).find((f) =>
        f.type.startsWith("image/"),
      );
      if (file) onFile(file);
    },
    [onFile],
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4 animate-in fade-in duration-150"
      onClick={onCancel}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div
        className={`w-full max-w-md bg-background border p-8 relative shadow-2xl transition-all ${
          isDragging
            ? "border-foreground ring-4 ring-foreground/20 scale-[1.01]"
            : "border-border"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {isDragging && (
          <div className="absolute inset-0 bg-foreground/5 pointer-events-none flex items-center justify-center z-10">
            <div className="text-center">
              <p className="text-4xl mb-3 leading-none">⬇</p>
              <p className="text-sm font-bold uppercase tracking-widest">
                Drop Image To Upload
              </p>
            </div>
          </div>
        )}

        <button
          onClick={onCancel}
          className="absolute top-4 right-4 text-muted-foreground hover:text-foreground text-2xl leading-none w-8 h-8 flex items-center justify-center"
          aria-label="Close"
        >
          ×
        </button>

        <div className="mb-8">
          <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-muted-foreground mb-2">
            Add Image
          </p>
          <h2 className="text-xl font-black uppercase tracking-wide leading-tight">
            Upload Your Artwork
          </h2>
          <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
            Choose a file from your device or drop it anywhere on this window.
          </p>
        </div>

        <button
          onClick={onBrowse}
          className="group w-full flex items-center gap-4 border border-border px-5 py-4 hover:border-foreground hover:bg-foreground hover:text-background transition-all mb-3"
        >
          <div className="text-left flex-1">
            <p className="text-xs font-bold uppercase tracking-widest">
              Browse Photo
            </p>
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground group-hover:text-background/70 mt-0.5">
              Select from your device
            </p>
          </div>
          <span className="text-lg leading-none opacity-40 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all">
            →
          </span>
        </button>

        <div className="flex items-center gap-3 my-5">
          <div className="flex-1 h-px bg-border" />
          <span className="text-[10px] font-bold uppercase tracking-[0.25em] text-muted-foreground">
            Or
          </span>
          <div className="flex-1 h-px bg-border" />
        </div>

        <div
          className={`w-full border-2 border-dashed px-4 py-10 text-center transition-colors ${
            isDragging
              ? "border-foreground bg-foreground/5"
              : "border-border"
          }`}
        >
          <p className="text-3xl mb-3 leading-none">⬆</p>
          <p className="text-xs font-bold uppercase tracking-widest mb-1">
            Drag & Drop
          </p>
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Drop an image anywhere on this window
          </p>
        </div>
      </div>
    </div>
  );
}
