import { useState, useCallback, useRef } from "react";

interface Props {
  onBrowse: () => void;
  onFile: (file: File) => void;
  onCancel: () => void;
}

export default function AddImageModal({ onBrowse, onFile, onCancel }: Props) {
  const [isDragging, setIsDragging] = useState(false);
  const dragDepthRef = useRef(0);

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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md bg-background border border-border p-8 relative"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onCancel}
          className="absolute top-4 right-4 text-muted-foreground hover:text-foreground text-xl leading-none"
          aria-label="Close"
        >
          ×
        </button>

        <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-1">
          Add Image
        </p>
        <p className="text-sm uppercase tracking-widest mb-6">
          Choose how to add your image
        </p>

        <button
          onClick={onBrowse}
          className="w-full flex items-center gap-3 border border-border px-4 py-4 hover:border-foreground hover:bg-muted/10 transition-colors mb-4"
        >
          <span className="text-lg leading-none">📁</span>
          <div className="text-left">
            <p className="text-xs font-bold uppercase tracking-widest">
              Browse Photo
            </p>
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground mt-1">
              Select from your device
            </p>
          </div>
        </button>

        <div
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`w-full border-2 border-dashed px-4 py-10 text-center transition-colors ${
            isDragging
              ? "border-foreground bg-muted/20"
              : "border-border hover:border-foreground/60"
          }`}
        >
          <p className="text-2xl mb-2 leading-none">⬆</p>
          <p className="text-xs font-bold uppercase tracking-widest">
            {isDragging ? "Drop Image Here" : "Drag & Drop"}
          </p>
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground mt-2">
            Drop an image file to upload
          </p>
        </div>
      </div>
    </div>
  );
}
