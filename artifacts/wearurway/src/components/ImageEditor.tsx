import { useState, useRef, useEffect, useCallback } from "react";

type Tool = "move" | "brush-erase" | "flood-fill" | "recolor";

interface Props {
  file: File;
  onConfirm: (blob: Blob) => void;
  onCancel: () => void;
}

// ── Pixel helpers ───────────────────────────────────────────────────────────────

function getColorAt(d: Uint8ClampedArray, x: number, y: number, w: number): [number,number,number,number] {
  const i = (y*w+x)*4; return [d[i],d[i+1],d[i+2],d[i+3]];
}
function colorDist(a: [number,number,number,number], b: [number,number,number,number]) {
  return Math.sqrt((a[0]-b[0])**2+(a[1]-b[1])**2+(a[2]-b[2])**2);
}
function hexToRgb(h: string): [number,number,number] {
  return [parseInt(h.slice(1,3),16),parseInt(h.slice(3,5),16),parseInt(h.slice(5,7),16)];
}

function floodFill(id: ImageData, sx: number, sy: number, tol: number) {
  const {data:d,width:w,height:h} = id;
  const tgt = getColorAt(d,sx,sy,w); if (tgt[3]===0) return;
  const vis = new Uint8Array(w*h), stk = [sy*w+sx];
  while (stk.length) {
    const idx = stk.pop()!; if (vis[idx]) continue; vis[idx]=1;
    const x=idx%w, y=Math.floor(idx/w);
    if (colorDist(getColorAt(d,x,y,w),tgt)>tol) continue;
    d[idx*4+3]=0;
    if (x+1<w)  stk.push(idx+1);
    if (x-1>=0) stk.push(idx-1);
    if (y+1<h)  stk.push(idx+w);
    if (y-1>=0) stk.push(idx-w);
  }
}

function erodeAlpha(id: ImageData, r=1) {
  const {data:d,width:w,height:h} = id;
  const orig = new Uint8ClampedArray(d);
  for (let y=0;y<h;y++) for (let x=0;x<w;x++) {
    const i=(y*w+x)*4; if (orig[i+3]===0) continue;
    let kill=false;
    outer: for (let dy=-r;dy<=r&&!kill;dy++) for (let dx=-r;dx<=r&&!kill;dx++) {
      const nx=x+dx,ny=y+dy;
      if (nx<0||nx>=w||ny<0||ny>=h) { kill=true; break outer; }
      if (orig[(ny*w+nx)*4+3]===0)  { kill=true; break outer; }
    }
    if (kill) d[i+3]=0;
  }
}

function globalRecolor(id: ImageData, sx: number, sy: number, hex: string, tol: number) {
  const {data:d,width:w} = id;
  const tgt = getColorAt(d,sx,sy,w);
  const [nr,ng,nb] = hexToRgb(hex);
  for (let i=0;i<d.length;i+=4) {
    if (d[i+3]===0) continue;
    if (colorDist([d[i],d[i+1],d[i+2],d[i+3]],tgt)<=tol) { d[i]=nr;d[i+1]=ng;d[i+2]=nb; }
  }
}

function trimTransparency(src: HTMLCanvasElement): HTMLCanvasElement {
  const ctx=src.getContext("2d"); if (!ctx) return src;
  const {width:W,height:H}=src, data=ctx.getImageData(0,0,W,H).data;
  let mx=W,Mx=0,my=H,My=0;
  for (let y=0;y<H;y++) for (let x=0;x<W;x++) {
    if (data[(y*W+x)*4+3]>0) { mx=Math.min(mx,x);Mx=Math.max(Mx,x);my=Math.min(my,y);My=Math.max(My,y); }
  }
  if (mx>Mx||my>My) return src;
  const tw=Mx-mx+1,th=My-my+1,out=document.createElement("canvas");
  out.width=tw;out.height=th;
  out.getContext("2d")?.drawImage(src,mx,my,tw,th,0,0,tw,th);
  return out;
}

const CHECKER: React.CSSProperties = {
  backgroundImage:"linear-gradient(45deg,#2a2a2a 25%,transparent 25%),linear-gradient(-45deg,#2a2a2a 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#2a2a2a 75%),linear-gradient(-45deg,transparent 75%,#2a2a2a 75%)",
  backgroundSize:"24px 24px",backgroundPosition:"0 0,0 12px,12px -12px,-12px 0px",backgroundColor:"#1a1a1a",
};

// ── Component ───────────────────────────────────────────────────────────────────

export default function ImageEditor({ file, onConfirm, onCancel }: Props) {
  // ── Refs ─────────────────────────────────────────────────────────────────────
  const canvasRef     = useRef<HTMLCanvasElement>(null);  // image canvas
  const cursorRef     = useRef<HTMLCanvasElement>(null);  // cursor overlay (same coords as image canvas)
  const areaRef       = useRef<HTMLDivElement>(null);     // outer container for zoom wheel
  const wrapperRef    = useRef<HTMLDivElement>(null);     // inner div — receives CSS transform
  const isDrawing     = useRef(false);
  const isMoving      = useRef(false);
  const lastBrushPoint = useRef<{ x: number; y: number } | null>(null);
  const moveStartRef  = useRef<{ pointerX: number; pointerY: number; panX: number; panY: number } | null>(null);
  const undoRef       = useRef<ImageData[]>([]);
  const redoRef       = useRef<ImageData[]>([]);

  // ── State ────────────────────────────────────────────────────────────────────
  const [tool,       setTool]       = useState<Tool>("brush-erase");
  const [brushSize,  setBrushSize]  = useState(20);
  const [tolerance,  setTolerance]  = useState(35);
  const [recolor,    setRecolor]    = useState("#ff0000");
  const [processing, setProcessing] = useState(false);
  const [loaded,     setLoaded]     = useState(false);
  const [zoom,       setZoom]       = useState(1);
  const [pan,        setPan]        = useState({ x: 0, y: 0 });
  const [histSig,    setHistSig]    = useState(0);

  // ── Stable refs for values used inside event handlers ───────────────────────
  const brushRef    = useRef(brushSize);
  const tolRef      = useRef(tolerance);
  const recolorRef  = useRef(recolor);
  const toolRef     = useRef<Tool>("brush-erase");
  const zoomRef     = useRef(1);
  const panRef      = useRef({ x: 0, y: 0 });
  useEffect(() => { brushRef.current   = brushSize;  }, [brushSize]);
  useEffect(() => { tolRef.current     = tolerance;  }, [tolerance]);
  useEffect(() => { recolorRef.current = recolor;    }, [recolor]);
  useEffect(() => { toolRef.current    = tool;       }, [tool]);
  useEffect(() => { zoomRef.current    = zoom;       }, [zoom]);
  useEffect(() => { panRef.current     = pan;        }, [pan]);

  // ── Display size (computed once after load, used for both canvases) ──────────
  // Both image canvas and cursor canvas share the same CSS + pixel dimensions,
  // so offsetX/offsetY from mouse events directly index into both pixel grids.
  const [dispSize, setDispSize] = useState<{w:number;h:number}|null>(null);

  // ── Load image ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const c = canvasRef.current; if (!c) return;
      c.width  = img.naturalWidth;
      c.height = img.naturalHeight;
      c.getContext("2d")?.drawImage(img, 0, 0);
      setLoaded(true);
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }, [file]);

  // Once canvas is loaded, compute the display size that fits the container
  useEffect(() => {
    if (!loaded) return;
    requestAnimationFrame(() => {
      const c = canvasRef.current;
      const a = areaRef.current;
      if (!c || !a) return;
      const pad = 64;
      const aw = a.clientWidth  - pad;
      const ah = a.clientHeight - pad;
      const scale = Math.min(1, aw / c.width, ah / c.height);
      const ds = { w: Math.round(c.width * scale), h: Math.round(c.height * scale) };
      setDispSize(ds);

      // Initialise cursor canvas pixel dimensions = display dimensions (1:1 CSS px)
      const cc = cursorRef.current;
      if (cc) { cc.width = ds.w; cc.height = ds.h; }
    });
  }, [loaded]);

  // Keep cursor canvas synced when dispSize changes
  useEffect(() => {
    if (!dispSize) return;
    const cc = cursorRef.current;
    if (cc) { cc.width = dispSize.w; cc.height = dispSize.h; }
  }, [dispSize]);

  // ── Undo / Redo ──────────────────────────────────────────────────────────────
  const saveUndo = useCallback(() => {
    const c = canvasRef.current; if (!c) return;
    const ctx = c.getContext("2d"); if (!ctx) return;
    undoRef.current = [...undoRef.current.slice(-19), ctx.getImageData(0,0,c.width,c.height)];
    redoRef.current = [];
    setHistSig(s => s+1);
  }, []);

  const doUndo = useCallback(() => {
    const c = canvasRef.current; if (!c || !undoRef.current.length) return;
    const ctx = c.getContext("2d"); if (!ctx) return;
    redoRef.current = [...redoRef.current.slice(-19), ctx.getImageData(0,0,c.width,c.height)];
    ctx.putImageData(undoRef.current.at(-1)!, 0, 0);
    undoRef.current = undoRef.current.slice(0,-1);
    setHistSig(s => s+1);
  }, []);

  const doRedo = useCallback(() => {
    const c = canvasRef.current; if (!c || !redoRef.current.length) return;
    const ctx = c.getContext("2d"); if (!ctx) return;
    undoRef.current = [...undoRef.current.slice(-19), ctx.getImageData(0,0,c.width,c.height)];
    ctx.putImageData(redoRef.current.at(-1)!, 0, 0);
    redoRef.current = redoRef.current.slice(0,-1);
    setHistSig(s => s+1);
  }, []);

  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (!(e.ctrlKey||e.metaKey)) return;
      if (e.key==="z") { e.preventDefault(); doUndo(); }
      if (e.key==="y") { e.preventDefault(); doRedo(); }
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [doUndo, doRedo]);

  useEffect(() => {
    const fn = () => {
      isDrawing.current = false;
      isMoving.current = false;
      lastBrushPoint.current = null;
      moveStartRef.current = null;
    };
    window.addEventListener("mouseup", fn);
    return () => window.removeEventListener("mouseup", fn);
  }, []);

  const clampPan = useCallback((nextPan: { x: number; y: number }, nextZoom = zoomRef.current) => {
    const area = areaRef.current;
    if (!area || !dispSize) return nextPan;
    const scaledW = dispSize.w * nextZoom;
    const scaledH = dispSize.h * nextZoom;
    const maxX = Math.max(0, (scaledW - area.clientWidth) / 2 + 48);
    const maxY = Math.max(0, (scaledH - area.clientHeight) / 2 + 48);
    return {
      x: Math.min(maxX, Math.max(-maxX, nextPan.x)),
      y: Math.min(maxY, Math.max(-maxY, nextPan.y)),
    };
  }, [dispSize]);

  // ── Zoom (CSS transform on wrapper div) ──────────────────────────────────────
  // Keeps the exact image point under the cursor stationary while zooming.
  const applyZoom = useCallback((factor: number, cx?: number, cy?: number) => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const rect = wrapper.getBoundingClientRect();
    const ancX = cx ?? rect.left + rect.width / 2;
    const ancY = cy ?? rect.top + rect.height / 2;
    const prevZ = zoomRef.current;
    const nextZ = Math.max(1, Math.min(40, prevZ * factor));
    if (nextZ === prevZ) return;
    const localX = (ancX - rect.left) / prevZ;
    const localY = (ancY - rect.top) / prevZ;
    const nextPan = nextZ === 1
      ? { x: 0, y: 0 }
      : clampPan({
          x: panRef.current.x + localX * (prevZ - nextZ),
          y: panRef.current.y + localY * (prevZ - nextZ),
        }, nextZ);
    setZoom(nextZ);
    setPan(nextPan);
  }, [clampPan]);

  useEffect(() => {
    const el = areaRef.current; if (!el) return;
    const fn = (e: WheelEvent) => {
      e.preventDefault();
      applyZoom(e.deltaY < 0 ? 1.2 : 1/1.2, e.clientX, e.clientY);
    };
    el.addEventListener("wheel", fn, { passive: false });
    return () => el.removeEventListener("wheel", fn);
  }, [applyZoom]);

  // ── Brush cursor — drawn on cursor canvas using same offsetX/Y as the erase ──
  // Since both cursor canvas and image canvas share identical pixel dimensions AND
  // identical CSS layout size, offsetX/offsetY from the image canvas events index
  // into the cursor canvas at exactly the same screen position — guaranteed alignment.
  const pointFromEvent = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const c = canvasRef.current;
    const rect = c?.getBoundingClientRect();
    if (!c || !rect || !dispSize) return null;
    const displayX = ((e.clientX - rect.left) / rect.width) * dispSize.w;
    const displayY = ((e.clientY - rect.top) / rect.height) * dispSize.h;
    return {
      displayX,
      displayY,
      imageX: displayX * (c.width / dispSize.w),
      imageY: displayY * (c.height / dispSize.h),
    };
  };

  const drawCursor = (ox: number, oy: number) => {
    const cc = cursorRef.current;
    const c  = canvasRef.current;
    if (!cc || !c || !dispSize) return;
    const ctx = cc.getContext("2d"); if (!ctx) return;
    ctx.clearRect(0, 0, cc.width, cc.height);
    if (toolRef.current !== "brush-erase") return;
    // Cursor radius in cursor-canvas pixels (same as display CSS pixels since 1:1)
    const r = (brushRef.current / 2) * (dispSize.w / c.width);
    ctx.beginPath();
    ctx.arc(ox, oy, Math.max(1, r), 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth   = 1.5;
    ctx.stroke();
  };

  const clearCursor = () => {
    const cc = cursorRef.current; if (!cc) return;
    cc.getContext("2d")?.clearRect(0, 0, cc.width, cc.height);
  };

  // ── Brush erase — uses same offsetX/Y so guaranteed same position as cursor ──
  const applyBrush = (imgX: number, imgY: number) => {
    const c = canvasRef.current; if (!c || !dispSize) return;
    const ctx = c.getContext("2d"); if (!ctx) return;
    const radius = brushRef.current / 2;
    const last = lastBrushPoint.current;
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    ctx.imageSmoothingEnabled = false;
    if (last) {
      ctx.lineWidth = brushRef.current;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(imgX, imgY);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(imgX, imgY, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    lastBrushPoint.current = { x: imgX, y: imgY };
  };

  // ── Canvas mouse events ──────────────────────────────────────────────────────
  const onMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!loaded || !dispSize) return;
    const point = pointFromEvent(e);
    if (!point) return;
    const { displayX, displayY, imageX, imageY } = point;
    if (toolRef.current === "move") {
      isMoving.current = true;
      moveStartRef.current = {
        pointerX: e.clientX,
        pointerY: e.clientY,
        panX: panRef.current.x,
        panY: panRef.current.y,
      };
      return;
    }
    if (toolRef.current === "brush-erase") {
      isDrawing.current = true;
      lastBrushPoint.current = null;
      saveUndo();
      applyBrush(imageX, imageY);
      drawCursor(displayX, displayY);
    } else {
      const c = canvasRef.current; if (!c) return;
      const ctx = c.getContext("2d"); if (!ctx) return;
      const imgX = Math.floor(imageX);
      const imgY = Math.floor(imageY);
      saveUndo();
      setProcessing(true);
      setTimeout(() => {
        const id = ctx.getImageData(0,0,c.width,c.height);
        if (toolRef.current === "flood-fill") { floodFill(id,imgX,imgY,tolRef.current); erodeAlpha(id,2); }
        else { globalRecolor(id,imgX,imgY,recolorRef.current,tolRef.current); }
        ctx.putImageData(id,0,0);
        setProcessing(false);
      }, 0);
    }
  };

  const onMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (toolRef.current === "move" && isMoving.current && moveStartRef.current) {
      const start = moveStartRef.current;
      setPan(clampPan({
        x: start.panX + e.clientX - start.pointerX,
        y: start.panY + e.clientY - start.pointerY,
      }));
      return;
    }
    const point = pointFromEvent(e);
    if (!point) return;
    drawCursor(point.displayX, point.displayY);
    if (toolRef.current === "brush-erase" && isDrawing.current) applyBrush(point.imageX, point.imageY);
  };

  const onMouseUp = () => {
    isDrawing.current = false;
    isMoving.current = false;
    lastBrushPoint.current = null;
    moveStartRef.current = null;
  };
  const onMouseLeave = () => {
    isDrawing.current = false;
    isMoving.current = false;
    lastBrushPoint.current = null;
    moveStartRef.current = null;
    clearCursor();
  };

  // ── Confirm ──────────────────────────────────────────────────────────────────
  const handleConfirm = () => {
    const c = canvasRef.current; if (!c) return;
    trimTransparency(c).toBlob(b => { if (b) onConfirm(b); }, "image/png");
  };

  // ── Derived ──────────────────────────────────────────────────────────────────
  const canTransform = zoom!==1||pan.x!==0||pan.y!==0
    ? `translate(${pan.x}px,${pan.y}px) scale(${zoom})`
    : undefined;

  const canUndo = undoRef.current.length > 0;
  const canRedo = redoRef.current.length > 0;
  void histSig;

  const toolHint: Record<Tool, string> = {
    "move":        "Click and drag to move around the zoomed image.",
    "brush-erase": "Paint to erase. Hold & drag for smooth strokes.",
    "flood-fill":  "Click on a color to erase all connected similar pixels.",
    "recolor":     "Click on any color to replace all similar colors.",
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black flex flex-col">

      {/* ── Header ── */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-6">
          <h2 className="text-sm font-bold uppercase tracking-widest">Edit Image</h2>
          <span className="text-xs text-muted-foreground uppercase tracking-widest hidden md:block">{toolHint[tool]}</span>
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
          {/* Tool */}
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">Tool</p>
            <div className="flex flex-col gap-2">
              {([
                { id:"move",        label:"✋ Move" },
                { id:"brush-erase", label:"✏ Brush Erase" },
                { id:"flood-fill",  label:"✂ Fill Remove"  },
                { id:"recolor",     label:"🎨 Change Color" },
              ] as const).map(t => (
                <button key={t.id} onClick={() => setTool(t.id)}
                  className={`text-xs px-3 py-2.5 border uppercase tracking-widest font-bold transition-colors text-left ${
                    tool===t.id ? "border-foreground bg-foreground text-background" : "border-border hover:border-foreground"
                  }`}>{t.label}</button>
              ))}
            </div>
          </div>

          {/* Brush size */}
          {tool==="brush-erase" && (
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
          {(tool==="flood-fill"||tool==="recolor") && (
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

          {/* Color */}
          {tool==="recolor" && (
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
              <span className="text-xs font-mono font-bold">{Math.round(zoom*100)}%</span>
            </div>
            <div className="flex gap-2">
              <button onClick={() => applyZoom(1/1.2)}
                className="flex-1 py-1.5 text-sm font-bold border border-border hover:border-foreground transition-colors">−</button>
              <button onClick={() => { setZoom(1); setPan({x:0,y:0}); }}
                className="text-xs px-2 py-1.5 border border-border hover:border-foreground transition-colors uppercase tracking-widest">Fit</button>
              <button onClick={() => applyZoom(1.2)}
                className="flex-1 py-1.5 text-sm font-bold border border-border hover:border-foreground transition-colors">+</button>
            </div>
            <p className="text-xs text-muted-foreground mt-2">Scroll on image to zoom toward the cursor. Use Move to pan when zoomed in.</p>
          </div>

          {/* Tip */}
          <div className="mt-auto p-3 border border-border/50">
            <p className="text-xs text-muted-foreground leading-relaxed">{toolHint[tool]}</p>
            <p className="text-xs text-muted-foreground leading-relaxed mt-2 opacity-60">Ctrl+Z undo · Ctrl+Y redo</p>
          </div>
        </div>

        {/* ── Canvas area ── */}
        <div ref={areaRef} className="flex-1 overflow-hidden flex items-center justify-center" style={CHECKER}>

          {!loaded && <p className="text-xs uppercase tracking-widest text-muted-foreground animate-pulse">Loading image…</p>}
          {processing && (
            <div className="fixed inset-0 flex items-center justify-center z-10 pointer-events-none">
              <p className="text-xs uppercase tracking-widest text-foreground bg-background/80 px-4 py-2 border border-border">Processing…</p>
            </div>
          )}

          {/* Wrapper receives the zoom/pan CSS transform.
              Both canvases inside share the same coordinate system. */}
          <div
            ref={wrapperRef}
            style={{
              position:        "relative",
              display:         loaded && dispSize ? "block" : "none",
              width:           dispSize ? `${dispSize.w}px` : 0,
              height:          dispSize ? `${dispSize.h}px` : 0,
              transformOrigin: "0 0",
              transform:       canTransform,
              transition:       isMoving.current || isDrawing.current ? "none" : "transform 120ms ease-out",
              boxShadow:       "0 0 0 1px rgba(255,255,255,0.08)",
            }}
          >
            {/* Image canvas */}
            <canvas
              ref={canvasRef}
              onMouseDown={onMouseDown}
              onMouseMove={onMouseMove}
              onMouseUp={onMouseUp}
              onMouseLeave={onMouseLeave}
              style={{
                display:  "block",
                width:    dispSize ? `${dispSize.w}px` : "auto",
                height:   dispSize ? `${dispSize.h}px` : "auto",
                cursor:   processing ? "wait" : tool === "brush-erase" ? "none" : tool === "move" ? (isMoving.current ? "grabbing" : "grab") : "crosshair",
                imageRendering: zoom >= 6 ? "pixelated" : "auto",
              }}
            />
            {/* Cursor canvas — absolute overlay, IDENTICAL pixel dimensions to image canvas.
                Drawing at (offsetX, offsetY) on this canvas lands at the EXACT same screen
                pixel as drawing at the equivalent image coord on the image canvas. */}
            <canvas
              ref={cursorRef}
              style={{
                position:      "absolute",
                top:           0,
                left:          0,
                width:         "100%",
                height:        "100%",
                pointerEvents: "none",
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
