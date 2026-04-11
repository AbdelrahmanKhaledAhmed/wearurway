import { useState, useRef, useEffect, useCallback } from "react";

type Tool = "remove" | "recolor";

interface Props {
  file: File;
  onConfirm: (blob: Blob) => void;
  onCancel: () => void;
}

// ── Pixel helpers ──────────────────────────────────────────────────────────────

function getColorAt(data: Uint8ClampedArray, x: number, y: number, w: number): [number, number, number, number] {
  const i = (y * w + x) * 4;
  return [data[i], data[i + 1], data[i + 2], data[i + 3]];
}

function colorDist(a: [number, number, number, number], b: [number, number, number, number]): number {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
}

function hexToRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

// Iterative flood fill — makes clicked connected region transparent
function floodFill(imageData: ImageData, startX: number, startY: number, tol: number) {
  const { data, width, height } = imageData;
  const target = getColorAt(data, startX, startY, width);
  if (target[3] === 0) return;

  const visited = new Uint8Array(width * height);
  const stack: number[] = [startY * width + startX];

  while (stack.length > 0) {
    const idx = stack.pop()!;
    if (visited[idx]) continue;
    visited[idx] = 1;

    const x = idx % width;
    const y = Math.floor(idx / width);
    const c = getColorAt(data, x, y, width);
    if (colorDist(c, target) > tol) continue;

    data[idx * 4 + 3] = 0;

    if (x + 1 < width) stack.push(idx + 1);
    if (x - 1 >= 0) stack.push(idx - 1);
    if (y + 1 < height) stack.push(idx + width);
    if (y - 1 >= 0) stack.push(idx - width);
  }
}

// Erode the alpha channel by `radius` pixels — removes anti-aliased fringe
// left behind after a flood fill by making any opaque pixel that borders a
// transparent pixel also transparent.
function erodeAlpha(imageData: ImageData, radius = 1) {
  const { data, width, height } = imageData;
  const orig = new Uint8ClampedArray(data); // snapshot before erosion

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (orig[i + 3] === 0) continue; // already transparent — skip

      // If any neighbour within radius is transparent, erase this pixel too
      let kill = false;
      outer: for (let dy = -radius; dy <= radius && !kill; dy++) {
        for (let dx = -radius; dx <= radius && !kill; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) { kill = true; break outer; }
          if (orig[(ny * width + nx) * 4 + 3] === 0) { kill = true; break outer; }
        }
      }
      if (kill) data[i + 3] = 0;
    }
  }
}

// Replace all pixels similar to clicked pixel with new color
function globalRecolor(imageData: ImageData, startX: number, startY: number, newHex: string, tol: number) {
  const { data, width } = imageData;
  const target = getColorAt(data, startX, startY, width);
  const [nr, ng, nb] = hexToRgb(newHex);

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const c: [number, number, number, number] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
    if (colorDist(c, target) <= tol) {
      data[i] = nr;
      data[i + 1] = ng;
      data[i + 2] = nb;
    }
  }
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function ImageEditor({ file, onConfirm, onCancel }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tool, setTool] = useState<Tool>("remove");
  const [tolerance, setTolerance] = useState(35);
  const [recolor, setRecolor] = useState("#ff0000");
  const [undoStack, setUndoStack] = useState<ImageData[]>([]);
  const [processing, setProcessing] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Load image onto canvas
  useEffect(() => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(img, 0, 0);
      setLoaded(true);
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }, [file]);

  const saveUndo = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const snap = ctx.getImageData(0, 0, canvas.width, canvas.height);
    setUndoStack(prev => [...prev.slice(-9), snap]);
  }, []);

  const handleUndo = useCallback(() => {
    if (undoStack.length === 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.putImageData(undoStack[undoStack.length - 1], 0, 0);
    setUndoStack(s => s.slice(0, -1));
  }, [undoStack]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "z") {
        e.preventDefault();
        handleUndo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleUndo]);

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !loaded) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = Math.max(0, Math.min(canvas.width - 1, Math.floor((e.clientX - rect.left) * scaleX)));
    const y = Math.max(0, Math.min(canvas.height - 1, Math.floor((e.clientY - rect.top) * scaleY)));

    saveUndo();
    setProcessing(true);

    // Run in next tick so the UI can update first
    setTimeout(() => {
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      if (tool === "remove") {
        floodFill(imageData, x, y, tolerance);
        erodeAlpha(imageData, 2);
      } else {
        globalRecolor(imageData, x, y, recolor, tolerance);
      }
      ctx.putImageData(imageData, 0, 0);
      setProcessing(false);
    }, 0);
  };

  const handleConfirm = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob(blob => {
      if (blob) onConfirm(blob);
    }, "image/png");
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black flex flex-col" style={{ backdropFilter: "blur(8px)" }}>

      {/* ── Header ── */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-6">
          <h2 className="text-sm font-bold uppercase tracking-widest">Edit Image</h2>
          <span className="text-xs text-muted-foreground uppercase tracking-widest">
            {tool === "remove" ? "Click on a color area to erase it" : "Click on a color area to recolor it"}
          </span>
        </div>
        <div className="flex items-center gap-4">
          <button
            onClick={handleUndo}
            disabled={undoStack.length === 0}
            className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
          >
            ↩ Undo
          </button>
          <button
            onClick={handleConfirm}
            className="text-xs uppercase tracking-widest font-bold px-5 py-2 bg-foreground text-background hover:opacity-80 transition-opacity"
          >
            Add to Design
          </button>
          <button
            onClick={onCancel}
            className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">

        {/* ── Left toolbar ── */}
        <div className="w-56 border-r border-border p-5 flex flex-col gap-5 shrink-0 overflow-y-auto">

          {/* Tool selector */}
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">Tool</p>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => setTool("remove")}
                className={`text-xs px-3 py-2.5 border uppercase tracking-widest font-bold transition-colors text-left ${
                  tool === "remove" ? "border-foreground bg-foreground text-background" : "border-border hover:border-foreground"
                }`}
              >
                ✂ Remove BG
              </button>
              <button
                onClick={() => setTool("recolor")}
                className={`text-xs px-3 py-2.5 border uppercase tracking-widest font-bold transition-colors text-left ${
                  tool === "recolor" ? "border-foreground bg-foreground text-background" : "border-border hover:border-foreground"
                }`}
              >
                🎨 Change Color
              </button>
            </div>
          </div>

          {/* Tolerance */}
          <div>
            <div className="flex justify-between mb-2">
              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Tolerance</p>
              <span className="text-xs font-mono font-bold">{tolerance}</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={tolerance}
              onChange={e => setTolerance(Number(e.target.value))}
              className="w-full accent-foreground"
            />
            <div className="flex justify-between mt-1">
              <span className="text-xs text-muted-foreground">Precise</span>
              <span className="text-xs text-muted-foreground">Broad</span>
            </div>
          </div>

          {/* Color picker — recolor only */}
          {tool === "recolor" && (
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">New Color</p>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={recolor}
                  onChange={e => setRecolor(e.target.value)}
                  className="w-10 h-10 cursor-pointer border border-border bg-transparent p-0.5 rounded-none"
                />
                <span className="text-xs font-mono font-bold uppercase">{recolor}</span>
              </div>
            </div>
          )}

          {/* Tip box */}
          <div className="mt-auto p-3 border border-border/50">
            <p className="text-xs text-muted-foreground leading-relaxed">
              {tool === "remove"
                ? "Click on the background or any area to erase similar connected colors. Raise tolerance to remove more."
                : "Click on any color in the image to replace all similar colors with the chosen new color."}
            </p>
          </div>
        </div>

        {/* ── Canvas area ── */}
        <div
          className="flex-1 overflow-auto flex items-center justify-center p-8"
          style={{
            backgroundImage:
              "linear-gradient(45deg, #2a2a2a 25%, transparent 25%), linear-gradient(-45deg, #2a2a2a 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #2a2a2a 75%), linear-gradient(-45deg, transparent 75%, #2a2a2a 75%)",
            backgroundSize: "24px 24px",
            backgroundPosition: "0 0, 0 12px, 12px -12px, -12px 0px",
            backgroundColor: "#1a1a1a",
          }}
        >
          {!loaded && (
            <p className="text-xs uppercase tracking-widest text-muted-foreground animate-pulse">Loading image…</p>
          )}
          {processing && (
            <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
              <p className="text-xs uppercase tracking-widest text-foreground bg-background/80 px-4 py-2 border border-border">Processing…</p>
            </div>
          )}
          <canvas
            ref={canvasRef}
            onClick={handleCanvasClick}
            style={{
              maxWidth: "100%",
              maxHeight: "100%",
              cursor: processing ? "wait" : tool === "remove" ? "crosshair" : "cell",
              display: loaded ? "block" : "none",
              boxShadow: "0 0 0 1px rgba(255,255,255,0.08)",
            }}
          />
        </div>
      </div>
    </div>
  );
}
