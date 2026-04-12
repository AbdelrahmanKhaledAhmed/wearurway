import { useState, useRef, useEffect, useCallback } from "react";

type Tool = "brush-erase" | "flood-fill" | "recolor";

interface Props {
  file: File;
  onConfirm: (blob: Blob) => void;
  onCancel: () => void;
}

// ── Pixel helpers ───────────────────────────────────────────────────────────────

function getColorAt(data: Uint8ClampedArray, x: number, y: number, w: number): [number,number,number,number] {
  const i = (y * w + x) * 4;
  return [data[i], data[i+1], data[i+2], data[i+3]];
}

function colorDist(a: [number,number,number,number], b: [number,number,number,number]): number {
  return Math.sqrt((a[0]-b[0])**2 + (a[1]-b[1])**2 + (a[2]-b[2])**2);
}

function hexToRgb(hex: string): [number,number,number] {
  return [parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16)];
}

function floodFill(imageData: ImageData, startX: number, startY: number, tol: number) {
  const { data, width, height } = imageData;
  const target = getColorAt(data, startX, startY, width);
  if (target[3] === 0) return;
  const visited = new Uint8Array(width * height);
  const stack = [startY * width + startX];
  while (stack.length) {
    const idx = stack.pop()!;
    if (visited[idx]) continue;
    visited[idx] = 1;
    const x = idx % width, y = Math.floor(idx / width);
    if (colorDist(getColorAt(data, x, y, width), target) > tol) continue;
    data[idx*4+3] = 0;
    if (x+1 < width)  stack.push(idx+1);
    if (x-1 >= 0)     stack.push(idx-1);
    if (y+1 < height) stack.push(idx+width);
    if (y-1 >= 0)     stack.push(idx-width);
  }
}

function erodeAlpha(imageData: ImageData, radius = 1) {
  const { data, width, height } = imageData;
  const orig = new Uint8ClampedArray(data);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y*width+x)*4;
      if (orig[i+3] === 0) continue;
      let kill = false;
      outer: for (let dy=-radius; dy<=radius && !kill; dy++) {
        for (let dx=-radius; dx<=radius && !kill; dx++) {
          const nx=x+dx, ny=y+dy;
          if (nx<0||nx>=width||ny<0||ny>=height) { kill=true; break outer; }
          if (orig[(ny*width+nx)*4+3]===0) { kill=true; break outer; }
        }
      }
      if (kill) data[i+3] = 0;
    }
  }
}

function globalRecolor(imageData: ImageData, startX: number, startY: number, newHex: string, tol: number) {
  const { data, width } = imageData;
  const target = getColorAt(data, startX, startY, width);
  const [nr,ng,nb] = hexToRgb(newHex);
  for (let i = 0; i < data.length; i += 4) {
    if (data[i+3] === 0) continue;
    if (colorDist([data[i],data[i+1],data[i+2],data[i+3]], target) <= tol) {
      data[i]=nr; data[i+1]=ng; data[i+2]=nb;
    }
  }
}

function trimTransparency(src: HTMLCanvasElement): HTMLCanvasElement {
  const ctx = src.getContext("2d");
  if (!ctx) return src;
  const { width, height } = src;
  const data = ctx.getImageData(0,0,width,height).data;
  let minX=width, maxX=0, minY=height, maxY=0;
  for (let y=0; y<height; y++) for (let x=0; x<width; x++) {
    if (data[(y*width+x)*4+3]>0) {
      if (x<minX) minX=x; if (x>maxX) maxX=x;
      if (y<minY) minY=y; if (y>maxY) maxY=y;
    }
  }
  if (minX>maxX||minY>maxY) return src;
  const tw=maxX-minX+1, th=maxY-minY+1;
  const out=document.createElement("canvas"); out.width=tw; out.height=th;
  const oc=out.getContext("2d"); if (!oc) return src;
  oc.drawImage(src,minX,minY,tw,th,0,0,tw,th);
  return out;
}

// ── Component ───────────────────────────────────────────────────────────────────

const CHECKER: React.CSSProperties = {
  backgroundImage: "linear-gradient(45deg,#2a2a2a 25%,transparent 25%),linear-gradient(-45deg,#2a2a2a 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#2a2a2a 75%),linear-gradient(-45deg,transparent 75%,#2a2a2a 75%)",
  backgroundSize: "24px 24px",
  backgroundPosition: "0 0,0 12px,12px -12px,-12px 0px",
  backgroundColor: "#1a1a1a",
};

export default function ImageEditor({ file, onConfirm, onCancel }: Props) {
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const areaRef     = useRef<HTMLDivElement>(null);       // canvas area (overflow:hidden)
  const cursorElRef = useRef<HTMLDivElement>(null);        // brush cursor overlay (DOM-driven, no lag)
  const isDrawing   = useRef(false);

  // ── Undo / Redo stored in refs so keyboard handler never goes stale ──────────
  const undoRef = useRef<ImageData[]>([]);
  const redoRef = useRef<ImageData[]>([]);
  const [histSig, setHistSig] = useState(0); // just triggers re-render for button state

  // ── Tool state ───────────────────────────────────────────────────────────────
  const [tool, setTool]           = useState<Tool>("brush-erase");
  const [brushSize, setBrushSize] = useState(20);
  const brushSizeRef              = useRef(20);
  const [tolerance, setTolerance] = useState(35);
  const toleranceRef              = useRef(35);
  const [recolor, setRecolor]     = useState("#ff0000");
  const recolorRef                = useRef("#ff0000");
  const toolRef                   = useRef<Tool>("brush-erase");
  const [processing, setProcessing] = useState(false);
  const [loaded, setLoaded]         = useState(false);

  // Keep refs in sync
  useEffect(() => { brushSizeRef.current  = brushSize; },  [brushSize]);
  useEffect(() => { toleranceRef.current  = tolerance; }, [tolerance]);
  useEffect(() => { recolorRef.current    = recolor;   }, [recolor]);
  useEffect(() => { toolRef.current       = tool;      }, [tool]);

  // ── Zoom / Pan (CSS transform on canvas, no scroll) ─────────────────────────
  const [zoom, setZoom] = useState(1);
  const [pan,  setPan]  = useState({ x: 0, y: 0 });
  const zoomRef         = useRef(1);
  const panRef          = useRef({ x: 0, y: 0 });
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { panRef.current  = pan;  }, [pan]);

  // ── Load image ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const c = canvasRef.current; if (!c) return;
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      c.getContext("2d")?.drawImage(img, 0, 0);
      setLoaded(true);
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }, [file]);

  // ── Undo / Redo ──────────────────────────────────────────────────────────────
  const saveUndo = useCallback(() => {
    const c = canvasRef.current; if (!c) return;
    const ctx = c.getContext("2d"); if (!ctx) return;
    undoRef.current = [...undoRef.current.slice(-19), ctx.getImageData(0, 0, c.width, c.height)];
    redoRef.current = [];
    setHistSig(s => s + 1);
  }, []);

  const doUndo = useCallback(() => {
    const c = canvasRef.current; if (!c || !undoRef.current.length) return;
    const ctx = c.getContext("2d"); if (!ctx) return;
    redoRef.current = [...redoRef.current.slice(-19), ctx.getImageData(0, 0, c.width, c.height)];
    ctx.putImageData(undoRef.current.at(-1)!, 0, 0);
    undoRef.current = undoRef.current.slice(0, -1);
    setHistSig(s => s + 1);
  }, []);

  const doRedo = useCallback(() => {
    const c = canvasRef.current; if (!c || !redoRef.current.length) return;
    const ctx = c.getContext("2d"); if (!ctx) return;
    undoRef.current = [...undoRef.current.slice(-19), ctx.getImageData(0, 0, c.width, c.height)];
    ctx.putImageData(redoRef.current.at(-1)!, 0, 0);
    redoRef.current = redoRef.current.slice(0, -1);
    setHistSig(s => s + 1);
  }, []);

  // Keyboard shortcuts — stable because doUndo/doRedo use refs internally
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === "z") { e.preventDefault(); doUndo(); }
      if (e.key === "y") { e.preventDefault(); doRedo(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doUndo, doRedo]);

  // Stop brush stroke when mouse released anywhere
  useEffect(() => {
    const stop = () => { isDrawing.current = false; };
    window.addEventListener("mouseup", stop);
    return () => window.removeEventListener("mouseup", stop);
  }, []);

  // ── Zoom helpers ─────────────────────────────────────────────────────────────
  // Zoom centred on (cx,cy) in viewport coords.
  // Formula derivation (transform-origin: 0 0):
  //   viewport_x = layout_left + pan.x + lx * zoom
  //   keeping lx fixed: pan_new.x = pan.x + (cx - rect.left) * (1 - nextZoom/prevZoom)
  const applyZoom = useCallback((factor: number, cx?: number, cy?: number) => {
    const canvas = canvasRef.current; if (!canvas) return;
    const rect = canvas.getBoundingClientRect(); // captures current visual rect
    const prevZoom = zoomRef.current;
    const nextZoom = Math.max(1, Math.min(10, prevZoom * factor));

    // Default anchor = canvas visual center
    const anchorX = cx ?? (rect.left + rect.width  / 2);
    const anchorY = cy ?? (rect.top  + rect.height / 2);

    setZoom(nextZoom);
    if (nextZoom === 1) {
      setPan({ x: 0, y: 0 });
    } else {
      setPan(p => ({
        x: p.x + (anchorX - rect.left) * (1 - nextZoom / prevZoom),
        y: p.y + (anchorY - rect.top)  * (1 - nextZoom / prevZoom),
      }));
    }
  }, []);

  // Wheel zoom — non-passive so we can preventDefault
  useEffect(() => {
    const el = areaRef.current; if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      applyZoom(e.deltaY < 0 ? 1.2 : 1/1.2, e.clientX, e.clientY);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [applyZoom]);

  // ── Brush cursor (updated via DOM ref — zero lag, perfectly accurate) ────────
  const updateCursor = useCallback((clientX: number, clientY: number) => {
    const el = cursorElRef.current; const canvas = canvasRef.current;
    if (!el || !canvas || toolRef.current !== "brush-erase") return;
    const rect = canvas.getBoundingClientRect();
    const r = brushSizeRef.current * (rect.width / canvas.width);
    el.style.display = "block";
    el.style.left    = `${clientX - r}px`;
    el.style.top     = `${clientY - r}px`;
    el.style.width   = `${r * 2}px`;
    el.style.height  = `${r * 2}px`;
  }, []);

  const hideCursor = useCallback(() => {
    const el = cursorElRef.current; if (el) el.style.display = "none";
  }, []);

  // ── Coordinate mapping ───────────────────────────────────────────────────────
  // getBoundingClientRect() accounts for CSS transforms, so dividing by rect
  // dimensions correctly maps viewport → image pixel space at any zoom level.
  const getImgCoords = useCallback((clientX: number, clientY: number) => {
    const c = canvasRef.current; if (!c) return null;
    const rect = c.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(c.width-1,  (clientX - rect.left) * (c.width  / rect.width))),
      y: Math.max(0, Math.min(c.height-1, (clientY - rect.top)  * (c.height / rect.height))),
    };
  }, []);

  // ── Brush erase ──────────────────────────────────────────────────────────────
  const applyBrush = useCallback((clientX: number, clientY: number) => {
    const c = canvasRef.current; if (!c) return;
    const ctx = c.getContext("2d"); if (!ctx) return;
    const coords = getImgCoords(clientX, clientY); if (!coords) return;
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath();
    ctx.arc(coords.x, coords.y, brushSizeRef.current, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }, [getImgCoords]);

  // ── Canvas mouse handlers ────────────────────────────────────────────────────
  const onMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!loaded) return;
    if (toolRef.current === "brush-erase") {
      isDrawing.current = true;
      saveUndo();
      applyBrush(e.clientX, e.clientY);
    } else {
      const c = canvasRef.current; if (!c) return;
      const ctx = c.getContext("2d"); if (!ctx) return;
      const coords = getImgCoords(e.clientX, e.clientY); if (!coords) return;
      saveUndo();
      setProcessing(true);
      setTimeout(() => {
        const id = ctx.getImageData(0, 0, c.width, c.height);
        if (toolRef.current === "flood-fill") {
          floodFill(id, Math.floor(coords.x), Math.floor(coords.y), toleranceRef.current);
          erodeAlpha(id, 2);
        } else {
          globalRecolor(id, Math.floor(coords.x), Math.floor(coords.y), recolorRef.current, toleranceRef.current);
        }
        ctx.putImageData(id, 0, 0);
        setProcessing(false);
      }, 0);
    }
  }, [loaded, saveUndo, applyBrush, getImgCoords]);

  const onMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    // Update cursor element directly — no React re-render = zero lag
    updateCursor(e.clientX, e.clientY);
    if (toolRef.current === "brush-erase" && isDrawing.current) {
      applyBrush(e.clientX, e.clientY);
    }
  }, [updateCursor, applyBrush]);

  const onMouseUp   = useCallback(() => { isDrawing.current = false; }, []);
  const onMouseLeave= useCallback(() => { isDrawing.current = false; hideCursor(); }, [hideCursor]);

  // ── Confirm ──────────────────────────────────────────────────────────────────
  const handleConfirm = () => {
    const c = canvasRef.current; if (!c) return;
    trimTransparency(c).toBlob(b => { if (b) onConfirm(b); }, "image/png");
  };

  // ── Canvas CSS transform (zoom without scroll) ───────────────────────────────
  const canvasTransform = zoom !== 1 || pan.x !== 0 || pan.y !== 0
    ? `translate(${pan.x}px,${pan.y}px) scale(${zoom})`
    : undefined;

  const toolHint: Record<Tool, string> = {
    "brush-erase": "Paint to erase. Hold & drag for smooth strokes.",
    "flood-fill":  "Click on a color area to erase similar connected pixels.",
    "recolor":     "Click on any color to replace all similar colors.",
  };

  const canUndo = undoRef.current.length > 0;
  const canRedo = redoRef.current.length > 0;
  void histSig; // consumed only to trigger re-render

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
          <button onClick={doUndo} disabled={!canUndo}
            className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors">
            ↩ Undo
          </button>
          <button onClick={doRedo} disabled={!canRedo}
            className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors">
            Redo ↪
          </button>
          <button onClick={handleConfirm}
            className="text-xs uppercase tracking-widest font-bold px-5 py-2 bg-foreground text-background hover:opacity-80 transition-opacity">
            Add to Design
          </button>
          <button onClick={onCancel}
            className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors">
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
              {([
                { id: "brush-erase", label: "✏ Brush Erase" },
                { id: "flood-fill",  label: "✂ Fill Remove"  },
                { id: "recolor",     label: "🎨 Change Color" },
              ] as const).map(t => (
                <button key={t.id} onClick={() => setTool(t.id)}
                  className={`text-xs px-3 py-2.5 border uppercase tracking-widest font-bold transition-colors text-left ${
                    tool === t.id ? "border-foreground bg-foreground text-background" : "border-border hover:border-foreground"
                  }`}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Brush size */}
          {tool === "brush-erase" && (
            <div>
              <div className="flex justify-between mb-2">
                <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Brush Size</p>
                <span className="text-xs font-mono font-bold">{brushSize}px</span>
              </div>
              <input type="range" min={2} max={150} value={brushSize}
                onChange={e => setBrushSize(Number(e.target.value))}
                className="w-full accent-foreground" />
              <div className="flex justify-between mt-1">
                <span className="text-xs text-muted-foreground">Fine</span>
                <span className="text-xs text-muted-foreground">Large</span>
              </div>
            </div>
          )}

          {/* Tolerance */}
          {(tool === "flood-fill" || tool === "recolor") && (
            <div>
              <div className="flex justify-between mb-2">
                <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Tolerance</p>
                <span className="text-xs font-mono font-bold">{tolerance}</span>
              </div>
              <input type="range" min={0} max={100} value={tolerance}
                onChange={e => setTolerance(Number(e.target.value))}
                className="w-full accent-foreground" />
              <div className="flex justify-between mt-1">
                <span className="text-xs text-muted-foreground">Precise</span>
                <span className="text-xs text-muted-foreground">Broad</span>
              </div>
            </div>
          )}

          {/* Color picker */}
          {tool === "recolor" && (
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">New Color</p>
              <div className="flex items-center gap-2">
                <input type="color" value={recolor} onChange={e => setRecolor(e.target.value)}
                  className="w-10 h-10 cursor-pointer border border-border bg-transparent p-0.5 rounded-none" />
                <span className="text-xs font-mono font-bold uppercase">{recolor}</span>
              </div>
            </div>
          )}

          {/* Zoom */}
          <div>
            <div className="flex justify-between mb-2">
              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Zoom</p>
              <span className="text-xs font-mono font-bold">{Math.round(zoom * 100)}%</span>
            </div>
            <div className="flex gap-2">
              <button onClick={() => applyZoom(1/1.2)}
                className="flex-1 py-1.5 text-sm font-bold border border-border hover:border-foreground transition-colors">−</button>
              <button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}
                className="text-xs px-2 py-1.5 border border-border hover:border-foreground transition-colors uppercase tracking-widest">Fit</button>
              <button onClick={() => applyZoom(1.2)}
                className="flex-1 py-1.5 text-sm font-bold border border-border hover:border-foreground transition-colors">+</button>
            </div>
            <p className="text-xs text-muted-foreground mt-2">Scroll on image to zoom</p>
          </div>

          {/* Tip */}
          <div className="mt-auto p-3 border border-border/50">
            <p className="text-xs text-muted-foreground leading-relaxed">{toolHint[tool]}</p>
            <p className="text-xs text-muted-foreground leading-relaxed mt-2 opacity-60">
              Ctrl+Z undo · Ctrl+Y redo
            </p>
          </div>
        </div>

        {/* ── Canvas area — overflow:hidden so zoom never creates a scrollbar ── */}
        <div ref={areaRef} className="flex-1 overflow-hidden flex items-center justify-center" style={CHECKER}>
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
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseLeave}
            style={{
              display:         loaded ? "block" : "none",
              maxWidth:        "100%",
              maxHeight:       "100%",
              cursor:          tool === "brush-erase" ? "none" : processing ? "wait" : "crosshair",
              boxShadow:       "0 0 0 1px rgba(255,255,255,0.08)",
              transformOrigin: "0 0",          // needed for pan+scale formula
              transform:       canvasTransform,
            }}
          />
        </div>
      </div>

      {/* ── Brush cursor overlay — updated via DOM ref, not React state ── */}
      <div
        ref={cursorElRef}
        style={{
          display:       "none",
          position:      "fixed",
          pointerEvents: "none",
          borderRadius:  "50%",
          border:        "1.5px solid white",
          mixBlendMode:  "difference",
          zIndex:        200,
        }}
      />
    </div>
  );
}
