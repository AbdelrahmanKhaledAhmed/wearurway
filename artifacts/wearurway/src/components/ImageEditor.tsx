import { useState, useRef, useEffect, useCallback, useMemo } from "react";

type Tool = "brush-erase" | "flood-fill" | "recolor";

interface Props {
  file: File;
  onConfirm: (blob: Blob) => void;
  onCancel: () => void;
}

// ── Pixel helpers ───────────────────────────────────────────────────────────────

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

    if (x + 1 < width)  stack.push(idx + 1);
    if (x - 1 >= 0)     stack.push(idx - 1);
    if (y + 1 < height) stack.push(idx + width);
    if (y - 1 >= 0)     stack.push(idx - width);
  }
}

function erodeAlpha(imageData: ImageData, radius = 1) {
  const { data, width, height } = imageData;
  const orig = new Uint8ClampedArray(data);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (orig[i + 3] === 0) continue;

      let kill = false;
      outer: for (let dy = -radius; dy <= radius && !kill; dy++) {
        for (let dx = -radius; dx <= radius && !kill; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) { kill = true; break outer; }
          if (orig[(ny * width + nx) * 4 + 3] === 0) { kill = true; break outer; }
        }
      }
      if (kill) data[i + 3] = 0;
    }
  }
}

function globalRecolor(imageData: ImageData, startX: number, startY: number, newHex: string, tol: number) {
  const { data, width } = imageData;
  const target = getColorAt(data, startX, startY, width);
  const [nr, ng, nb] = hexToRgb(newHex);

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const c: [number, number, number, number] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
    if (colorDist(c, target) <= tol) {
      data[i] = nr; data[i + 1] = ng; data[i + 2] = nb;
    }
  }
}

function trimTransparency(src: HTMLCanvasElement): HTMLCanvasElement {
  const ctx = src.getContext("2d");
  if (!ctx) return src;
  const { width, height } = src;
  const data = ctx.getImageData(0, 0, width, height).data;

  let minX = width, maxX = 0, minY = height, maxY = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 0) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }

  if (minX > maxX || minY > maxY) return src;
  const trimW = maxX - minX + 1, trimH = maxY - minY + 1;
  const out = document.createElement("canvas");
  out.width = trimW; out.height = trimH;
  const outCtx = out.getContext("2d");
  if (!outCtx) return src;
  outCtx.drawImage(src, minX, minY, trimW, trimH, 0, 0, trimW, trimH);
  return out;
}

// ── Component ───────────────────────────────────────────────────────────────────

const CHECKERBOARD: React.CSSProperties = {
  backgroundImage:
    "linear-gradient(45deg,#2a2a2a 25%,transparent 25%),linear-gradient(-45deg,#2a2a2a 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#2a2a2a 75%),linear-gradient(-45deg,transparent 75%,#2a2a2a 75%)",
  backgroundSize: "24px 24px",
  backgroundPosition: "0 0,0 12px,12px -12px,-12px 0px",
  backgroundColor: "#1a1a1a",
};

export default function ImageEditor({ file, onConfirm, onCancel }: Props) {
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDrawingRef = useRef(false);
  const lastUndoSavedRef = useRef(false);

  const [tool, setTool]           = useState<Tool>("brush-erase");
  const [brushSize, setBrushSize] = useState(20);
  const [tolerance, setTolerance] = useState(35);
  const [recolor, setRecolor]     = useState("#ff0000");
  const [undoStack, setUndoStack] = useState<ImageData[]>([]);
  const [processing, setProcessing] = useState(false);
  const [loaded, setLoaded]         = useState(false);
  const [zoom, setZoom]             = useState(1);
  const [baseDisplay, setBaseDisplay] = useState<{ w: number; h: number } | null>(null);
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null);
  const [brushDisplayR, setBrushDisplayR] = useState(0);

  // ── Load image ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width  = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(img, 0, 0);
      setLoaded(true);
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }, [file]);

  // Capture base display size once loaded (used for zoom scaling)
  useEffect(() => {
    if (!loaded) return;
    requestAnimationFrame(() => {
      const canvas = canvasRef.current;
      if (canvas) setBaseDisplay({ w: canvas.offsetWidth, h: canvas.offsetHeight });
    });
  }, [loaded]);

  // ── Zoom via scroll ─────────────────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.2 : 1 / 1.2;
      setZoom(prev => {
        const next = Math.max(1, Math.min(10, prev * factor));
        // Keep cursor point stable in the scroll container
        const rect = el.getBoundingClientRect();
        const mouseX = el.scrollLeft + (e.clientX - rect.left);
        const mouseY = el.scrollTop  + (e.clientY - rect.top);
        const ratio  = next / prev;
        requestAnimationFrame(() => {
          el.scrollLeft = mouseX * ratio - (e.clientX - rect.left);
          el.scrollTop  = mouseY * ratio - (e.clientY - rect.top);
        });
        return next;
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [loaded]);

  // ── Undo ───────────────────────────────────────────────────────────────────
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
      if ((e.ctrlKey || e.metaKey) && e.key === "z") { e.preventDefault(); handleUndo(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleUndo]);

  // Stop drawing if mouse leaves window
  useEffect(() => {
    const stop = () => { isDrawingRef.current = false; };
    window.addEventListener("mouseup", stop);
    return () => window.removeEventListener("mouseup", stop);
  }, []);

  // ── Coordinate helper ───────────────────────────────────────────────────────
  const getImgCoords = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(canvas.width  - 1, (clientX - rect.left) * (canvas.width  / rect.width))),
      y: Math.max(0, Math.min(canvas.height - 1, (clientY - rect.top)  * (canvas.height / rect.height))),
    };
  }, []);

  // ── Brush erase ─────────────────────────────────────────────────────────────
  const applyBrush = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas || !loaded) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const coords = getImgCoords(clientX, clientY);
    if (!coords) return;

    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath();
    ctx.arc(coords.x, coords.y, brushSize, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }, [loaded, brushSize, getImgCoords]);

  // ── Canvas events ───────────────────────────────────────────────────────────
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!loaded) return;
    if (tool === "brush-erase") {
      isDrawingRef.current = true;
      lastUndoSavedRef.current = false;
      saveUndo();
      lastUndoSavedRef.current = true;
      applyBrush(e.clientX, e.clientY);
    } else {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const coords = getImgCoords(e.clientX, e.clientY);
      if (!coords) return;
      saveUndo();
      setProcessing(true);
      setTimeout(() => {
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        if (tool === "flood-fill") {
          floodFill(imageData, Math.floor(coords.x), Math.floor(coords.y), tolerance);
          erodeAlpha(imageData, 2);
        } else {
          globalRecolor(imageData, Math.floor(coords.x), Math.floor(coords.y), recolor, tolerance);
        }
        ctx.putImageData(imageData, 0, 0);
        setProcessing(false);
      }, 0);
    }
  }, [loaded, tool, saveUndo, applyBrush, getImgCoords, tolerance, recolor]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    setCursorPos({ x: e.clientX, y: e.clientY });
    // Update brush display radius
    const canvas = canvasRef.current;
    if (canvas) {
      const rect = canvas.getBoundingClientRect();
      setBrushDisplayR(brushSize * (rect.width / canvas.width));
    }
    if (tool === "brush-erase" && isDrawingRef.current) {
      applyBrush(e.clientX, e.clientY);
    }
  }, [tool, brushSize, applyBrush]);

  const handleMouseUp = useCallback(() => {
    isDrawingRef.current = false;
  }, []);

  const handleMouseLeave = useCallback(() => {
    setCursorPos(null);
    isDrawingRef.current = false;
  }, []);

  // ── Confirm ─────────────────────────────────────────────────────────────────
  const handleConfirm = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const trimmed = trimTransparency(canvas);
    trimmed.toBlob(blob => { if (blob) onConfirm(blob); }, "image/png");
  };

  // ── Canvas display size ─────────────────────────────────────────────────────
  const canvasStyle = useMemo((): React.CSSProperties => {
    if (!loaded) return { display: "none" };
    if (baseDisplay && zoom > 1) {
      return {
        display: "block",
        width:  `${baseDisplay.w * zoom}px`,
        height: `${baseDisplay.h * zoom}px`,
        cursor: tool === "brush-erase" ? "none" : processing ? "wait" : "crosshair",
        boxShadow: "0 0 0 1px rgba(255,255,255,0.08)",
      };
    }
    return {
      display: "block",
      maxWidth: "100%",
      maxHeight: "100%",
      cursor: tool === "brush-erase" ? "none" : processing ? "wait" : "crosshair",
      boxShadow: "0 0 0 1px rgba(255,255,255,0.08)",
    };
  }, [loaded, baseDisplay, zoom, tool, processing]);

  const toolHint: Record<Tool, string> = {
    "brush-erase": "Paint over areas to erase. Hold mouse and drag for smooth strokes.",
    "flood-fill":  "Click on a color area to erase all connected similar pixels.",
    "recolor":     "Click on any color to replace all similar colors with the chosen new color.",
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black flex flex-col">

      {/* ── Header ── */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-6">
          <h2 className="text-sm font-bold uppercase tracking-widest">Edit Image</h2>
          <span className="text-xs text-muted-foreground uppercase tracking-widest hidden md:block">
            {toolHint[tool]}
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
              {(
                [
                  { id: "brush-erase", label: "✏ Brush Erase" },
                  { id: "flood-fill",  label: "✂ Fill Remove" },
                  { id: "recolor",     label: "🎨 Change Color" },
                ] as const
              ).map(t => (
                <button
                  key={t.id}
                  onClick={() => setTool(t.id)}
                  className={`text-xs px-3 py-2.5 border uppercase tracking-widest font-bold transition-colors text-left ${
                    tool === t.id
                      ? "border-foreground bg-foreground text-background"
                      : "border-border hover:border-foreground"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Brush size — brush-erase only */}
          {tool === "brush-erase" && (
            <div>
              <div className="flex justify-between mb-2">
                <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Brush Size</p>
                <span className="text-xs font-mono font-bold">{brushSize}px</span>
              </div>
              <input
                type="range"
                min={2}
                max={150}
                value={brushSize}
                onChange={e => setBrushSize(Number(e.target.value))}
                className="w-full accent-foreground"
              />
              <div className="flex justify-between mt-1">
                <span className="text-xs text-muted-foreground">Fine</span>
                <span className="text-xs text-muted-foreground">Large</span>
              </div>
            </div>
          )}

          {/* Tolerance — flood-fill and recolor */}
          {(tool === "flood-fill" || tool === "recolor") && (
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
          )}

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

          {/* Zoom controls */}
          <div>
            <div className="flex justify-between mb-2">
              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Zoom</p>
              <span className="text-xs font-mono font-bold">{Math.round(zoom * 100)}%</span>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setZoom(prev => Math.max(1, prev / 1.2))}
                className="flex-1 py-1.5 text-sm font-bold border border-border hover:border-foreground transition-colors"
              >
                −
              </button>
              <button
                onClick={() => setZoom(1)}
                className="text-xs px-2 py-1.5 border border-border hover:border-foreground transition-colors uppercase tracking-widest"
              >
                Fit
              </button>
              <button
                onClick={() => setZoom(prev => Math.min(10, prev * 1.2))}
                className="flex-1 py-1.5 text-sm font-bold border border-border hover:border-foreground transition-colors"
              >
                +
              </button>
            </div>
            <p className="text-xs text-muted-foreground mt-2">Scroll on image to zoom</p>
          </div>

          {/* Tip */}
          <div className="mt-auto p-3 border border-border/50">
            <p className="text-xs text-muted-foreground leading-relaxed">
              {toolHint[tool]}
            </p>
          </div>
        </div>

        {/* ── Canvas area ── */}
        <div
          ref={containerRef}
          className="flex-1 overflow-auto"
          style={CHECKERBOARD}
        >
          <div
            className="flex items-center justify-center p-8"
            style={{ minWidth: "100%", minHeight: "100%" }}
          >
            {!loaded && (
              <p className="text-xs uppercase tracking-widest text-muted-foreground animate-pulse">Loading image…</p>
            )}
            {processing && (
              <div className="fixed inset-0 flex items-center justify-center z-10 pointer-events-none">
                <p className="text-xs uppercase tracking-widest text-foreground bg-background/80 px-4 py-2 border border-border">Processing…</p>
              </div>
            )}
            <canvas
              ref={canvasRef}
              style={canvasStyle}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseLeave}
            />
          </div>
        </div>
      </div>

      {/* ── Brush cursor overlay ── */}
      {tool === "brush-erase" && cursorPos && brushDisplayR > 0 && (
        <div
          className="fixed pointer-events-none rounded-full border-2 border-white"
          style={{
            left:  cursorPos.x - brushDisplayR,
            top:   cursorPos.y - brushDisplayR,
            width:  brushDisplayR * 2,
            height: brushDisplayR * 2,
            zIndex: 200,
            mixBlendMode: "difference",
          }}
        />
      )}
    </div>
  );
}
