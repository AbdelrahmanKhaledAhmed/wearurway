import { useState, useRef, useEffect, useCallback } from "react";
import { removeBackground } from "@imgly/background-removal";

type Tool = "auto-remove" | "erase" | "restore" | "magic-wand" | "move";
type BgPreview = "checker" | "white" | "black";

export interface ImageEditResult {
  originalWidth: number;
  originalHeight: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Props {
  file: File;
  onConfirm: (blob: Blob, edit: ImageEditResult) => void;
  onCancel: () => void;
  qualityScale?: number;
}

interface CanvasSnapshot {
  width: number;
  height: number;
  data: ImageData;
  trim: ImageEditResult | null;
}

interface AlphaBounds { x: number; y: number; width: number; height: number }

// ─── Pixel helpers ────────────────────────────────────────────────────────────

function getColorAt(d: Uint8ClampedArray, x: number, y: number, w: number): [number,number,number,number] {
  const i = (y*w+x)*4; return [d[i],d[i+1],d[i+2],d[i+3]];
}
function colorDist(a: [number,number,number,number], b: [number,number,number,number]) {
  return Math.sqrt((a[0]-b[0])**2+(a[1]-b[1])**2+(a[2]-b[2])**2);
}

function floodFill(id: ImageData, sx: number, sy: number, tol: number) {
  const {data:d,width:w,height:h} = id;
  const tgt = getColorAt(d,sx,sy,w);
  if (tgt[3]===0) return;
  const vis = new Uint8Array(w*h), stk = [sy*w+sx];
  while (stk.length) {
    const idx = stk.pop()!;
    if (vis[idx]) continue;
    vis[idx]=1;
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
      if (nx<0||nx>=w||ny<0||ny>=h||orig[(ny*w+nx)*4+3]===0) { kill=true; break outer; }
    }
    if (kill) d[i+3]=0;
  }
}

function computeGradientMag(d: Uint8ClampedArray, w: number, h: number): Float32Array {
  const mag = new Float32Array(w*h);
  for (let y=1;y<h-1;y++) for (let x=1;x<w-1;x++) {
    let gx=0,gy=0;
    for (let c=0;c<3;c++) {
      const p=(dy:number,dx:number) => d[((y+dy)*w+(x+dx))*4+c];
      const gxc = -p(-1,-1)-2*p(0,-1)-p(1,-1)+p(-1,1)+2*p(0,1)+p(1,1);
      const gyc = -p(-1,-1)-2*p(-1,0)-p(-1,1)+p(1,-1)+2*p(1,0)+p(1,1);
      gx=Math.max(gx,Math.abs(gxc)); gy=Math.max(gy,Math.abs(gyc));
    }
    mag[y*w+x]=Math.sqrt(gx*gx+gy*gy);
  }
  return mag;
}

function edgeAwareFloodFill(id: ImageData, sx: number, sy: number, colorTol: number, edgeTol: number) {
  const {data:d,width:w,height:h}=id;
  const mag=computeGradientMag(d,w,h);
  const seed=getColorAt(d,sx,sy,w);
  if (seed[3]===0) return;
  const processed=new Uint8Array(w*h);
  const queue=[sy*w+sx];
  processed[sy*w+sx]=1;
  while (queue.length) {
    const idx=queue.pop()!;
    const x=idx%w, y=Math.floor(idx/w);
    const i=idx*4;
    if (d[i+3]===0) continue;
    if (colorDist(getColorAt(d,x,y,w),seed)>colorTol) continue;
    d[i+3]=0;
    for (const [nx,ny] of [[x+1,y],[x-1,y],[x,y+1],[x,y-1]] as [number,number][]) {
      if (nx<0||nx>=w||ny<0||ny>=h) continue;
      const ni=ny*w+nx;
      if (processed[ni]) continue;
      processed[ni]=1;
      if (mag[ni]>edgeTol) continue;
      queue.push(ni);
    }
  }
  erodeAlpha(id,1);
}

function smartAutoRemove(id: ImageData, tol: number) {
  const { width: w, height: h } = id;
  const SAMPLE_EDGE = 3;
  const seeds: [number, number][] = [];
  for (let x = 0; x < w; x += Math.max(1, Math.floor(w / 120))) {
    for (let ey = 0; ey < SAMPLE_EDGE && ey < h; ey++) seeds.push([x, ey]);
    for (let ey = h - SAMPLE_EDGE; ey < h; ey++) if (ey >= 0) seeds.push([x, ey]);
  }
  for (let y = SAMPLE_EDGE; y < h - SAMPLE_EDGE; y += Math.max(1, Math.floor(h / 120))) {
    for (let ex = 0; ex < SAMPLE_EDGE && ex < w; ex++) seeds.push([ex, y]);
    for (let ex = w - SAMPLE_EDGE; ex < w; ex++) if (ex >= 0) seeds.push([ex, y]);
  }
  const done = new Set<number>();
  for (const [sx, sy] of seeds) {
    const key = sy * w + sx;
    if (done.has(key)) continue;
    const c = getColorAt(id.data, sx, sy, w);
    if (c[3] === 0) continue;
    floodFill(id, sx, sy, tol);
    done.add(key);
  }
  erodeAlpha(id, 2);
}

function getAlphaBounds(src: HTMLCanvasElement): AlphaBounds | null {
  const ctx = src.getContext("2d"); if (!ctx) return null;
  const {width:W,height:H} = src;
  const data = ctx.getImageData(0,0,W,H).data;
  let mx=W,Mx=0,my=H,My=0;
  for (let y=0;y<H;y++) for (let x=0;x<W;x++) {
    if (data[(y*W+x)*4+3]>0) { mx=Math.min(mx,x);Mx=Math.max(Mx,x);my=Math.min(my,y);My=Math.max(My,y); }
  }
  if (mx>Mx||my>My) return null;
  return { x:mx, y:my, width:Mx-mx+1, height:My-my+1 };
}

function trimTransparency(src: HTMLCanvasElement): { canvas: HTMLCanvasElement; bounds: AlphaBounds } {
  const bounds = getAlphaBounds(src) ?? { x:0, y:0, width:1, height:1 };
  if (bounds.x===0&&bounds.y===0&&bounds.width===src.width&&bounds.height===src.height) return { canvas:src, bounds };
  const out = document.createElement("canvas");
  out.width = bounds.width; out.height = bounds.height;
  out.getContext("2d")?.drawImage(src, bounds.x, bounds.y, bounds.width, bounds.height, 0, 0, bounds.width, bounds.height);
  return { canvas:out, bounds };
}

function sharpenImageData(id: ImageData) {
  const src = id.data;
  const dst = new Uint8ClampedArray(src);
  const w = id.width, h = id.height;
  for (let y=1;y<h-1;y++) {
    for (let x=1;x<w-1;x++) {
      const i=(y*w+x)*4;
      if (src[i+3]===0) continue;
      for (let c=0;c<3;c++) {
        const v = 9*src[i+c]
          - src[((y-1)*w+(x-1))*4+c] - src[((y-1)*w+x)*4+c] - src[((y-1)*w+(x+1))*4+c]
          - src[(y*w+(x-1))*4+c]                              - src[(y*w+(x+1))*4+c]
          - src[((y+1)*w+(x-1))*4+c] - src[((y+1)*w+x)*4+c] - src[((y+1)*w+(x+1))*4+c];
        dst[i+c] = Math.max(0,Math.min(255,v));
      }
    }
  }
  for (let i=3;i<dst.length;i+=4) {
    dst[i] = Math.max(0,Math.min(255,Math.round(8*(src[i]-128)+128)));
  }
  return new ImageData(dst,w,h);
}

function enhanceCanvas(src: HTMLCanvasElement, qualityScale=1) {
  const maxSide=8192;
  const scale=Math.min(Math.max(qualityScale,1),maxSide/src.width,maxSide/src.height);
  const out=document.createElement("canvas");
  out.width=Math.max(1,Math.round(src.width*scale));
  out.height=Math.max(1,Math.round(src.height*scale));
  const ctx=out.getContext("2d"); if (!ctx) return src;
  ctx.imageSmoothingEnabled=true; ctx.imageSmoothingQuality="high";
  ctx.drawImage(src,0,0,out.width,out.height);
  const id=ctx.getImageData(0,0,out.width,out.height);
  ctx.putImageData(sharpenImageData(id),0,0);
  return out;
}

function getPageZoom() {
  const raw=getComputedStyle(document.documentElement).zoom;
  const z=Number(raw);
  return Number.isFinite(z)&&z>0?z:1;
}

// ─── Checker background ───────────────────────────────────────────────────────

const CHECKER_STYLE: React.CSSProperties = {
  backgroundImage: "linear-gradient(45deg,#2a2a2a 25%,transparent 25%),linear-gradient(-45deg,#2a2a2a 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#2a2a2a 75%),linear-gradient(-45deg,transparent 75%,#2a2a2a 75%)",
  backgroundSize: "20px 20px",
  backgroundPosition: "0 0,0 10px,10px -10px,-10px 0px",
  backgroundColor: "#1c1c1c",
};

// ─── Inline SVG icons ─────────────────────────────────────────────────────────

const Icons = {
  AutoRemove: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <path d="M3 6l3 1m0 0l-3 9a5 5 0 0 0 6.027 6.947M6 7l3-2M6 7l-1.5 3M18 6l3 1M18 6l-1.5 3m1.5-3l-3 9a5 5 0 0 1-6.027 6.947m8.027-6.947L18 6m3 1l-3-2" />
      <line x1="2" y1="2" x2="22" y2="22" />
    </svg>
  ),
  Erase: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <path d="M20 20H7L3 16a1 1 0 0 1 0-1.41l9.59-9.59a2 2 0 0 1 2.82 0l4.59 4.59a2 2 0 0 1 0 2.82z"/>
      <line x1="6" y1="17" x2="17" y2="6" />
    </svg>
  ),
  Restore: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z"/>
      <path d="M15 5l3 3"/>
    </svg>
  ),
  Wand: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <path d="m15 4-1 1 5 5 1-1z"/><path d="m2 20 10.5-10.5"/><path d="m13.5 6.5 1 1"/><path d="M18 2l4 4"/><path d="M4 20l16-16"/>
    </svg>
  ),
  Move: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <polyline points="5 9 2 12 5 15"/><polyline points="9 5 12 2 15 5"/>
      <polyline points="15 19 12 22 9 19"/><polyline points="19 9 22 12 19 15"/>
      <line x1="2" y1="12" x2="22" y2="12"/><line x1="12" y1="2" x2="12" y2="22"/>
    </svg>
  ),
  Undo: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <path d="M3 7v6h6"/><path d="M3 13A9 9 0 1 0 6 6.7L3 13"/>
    </svg>
  ),
  Redo: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <path d="M21 7v6h-6"/><path d="M21 13A9 9 0 1 1 18 6.7L21 13"/>
    </svg>
  ),
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function ImageEditor({ file, onConfirm, onCancel, qualityScale=1 }: Props) {
  const canvasRef      = useRef<HTMLCanvasElement>(null);
  const imgRef         = useRef<HTMLImageElement>(null);
  const areaRef        = useRef<HTMLDivElement>(null);
  const wrapperRef     = useRef<HTMLDivElement>(null);
  const originalDataRef = useRef<ImageData | null>(null);

  const isDrawing      = useRef(false);
  const isMoving       = useRef(false);
  const lastBrushPoint = useRef<{ x:number; y:number }|null>(null);
  const moveStartRef   = useRef<{ pointerX:number; pointerY:number; panX:number; panY:number }|null>(null);
  const undoRef        = useRef<CanvasSnapshot[]>([]);
  const redoRef        = useRef<CanvasSnapshot[]>([]);
  const trimRef        = useRef<ImageEditResult|null>(null);

  const [tool,       setTool]       = useState<Tool>("erase");
  const [brushSize,  setBrushSize]  = useState(28);
  const [brushHard,  setBrushHard]  = useState(0.7);
  const [tolerance,  setTolerance]  = useState(35);
  const [edgeTol,    setEdgeTol]    = useState(40);
  const [bgPreview,  setBgPreview]  = useState<BgPreview>("checker");
  const [processing, setProcessing] = useState(false);
  const [aiProgress, setAiProgress] = useState(0);
  const [loaded,     setLoaded]     = useState(false);
  const [zoom,       setZoom]       = useState(1);
  const [pan,        setPan]        = useState({ x:0, y:0 });
  const [cursor,     setCursor]     = useState<{ x:number; y:number; size:number; visible:boolean }>({ x:0,y:0,size:0,visible:false });
  const [histSig,    setHistSig]    = useState(0);
  const [displaySrc, setDisplaySrc] = useState("");
  const [dispSize,   setDispSize]   = useState<{w:number;h:number}|null>(null);

  const brushRef    = useRef(brushSize);
  const brushHardRef = useRef(brushHard);
  const tolRef      = useRef(tolerance);
  const edgeTolRef  = useRef(edgeTol);
  const toolRef     = useRef<Tool>("erase");
  const zoomRef    = useRef(1);
  const panRef     = useRef({ x:0, y:0 });
  useEffect(() => { brushRef.current    = brushSize;  }, [brushSize]);
  useEffect(() => { brushHardRef.current = brushHard; }, [brushHard]);
  useEffect(() => { tolRef.current      = tolerance;  }, [tolerance]);
  useEffect(() => { edgeTolRef.current  = edgeTol;    }, [edgeTol]);
  useEffect(() => { toolRef.current     = tool;       }, [tool]);
  useEffect(() => { zoomRef.current     = zoom;       }, [zoom]);
  useEffect(() => { panRef.current      = pan;        }, [pan]);

  // ── Load ──────────────────────────────────────────────────────────────────────

  const updateDisplaySize = useCallback(() => {
    const c=canvasRef.current, a=areaRef.current; if (!c||!a) return;
    const pad=48, aw=a.clientWidth-pad, ah=a.clientHeight-pad;
    const scale=Math.min(1,aw/c.width,ah/c.height);
    setDispSize({ w:Math.max(1,Math.round(c.width*scale)), h:Math.max(1,Math.round(c.height*scale)) });
  }, []);

  useEffect(() => {
    let cancelled=false;
    const drawBitmap = (bmp: ImageBitmap) => {
      if (cancelled) return;
      const c=canvasRef.current; if (!c) { setLoaded(true); return; }
      try {
        c.width=bmp.width; c.height=bmp.height;
        const ctx=c.getContext("2d"); if (!ctx) { setLoaded(true); return; }
        ctx.drawImage(bmp,0,0);
        try {
          const trimmed=trimTransparency(c);
          if (trimmed.bounds.x!==0||trimmed.bounds.y!==0||trimmed.bounds.width!==bmp.width||trimmed.bounds.height!==bmp.height) {
            c.width=trimmed.canvas.width; c.height=trimmed.canvas.height;
            ctx.clearRect(0,0,c.width,c.height);
            ctx.drawImage(trimmed.canvas,0,0);
          }
          trimRef.current={ originalWidth:bmp.width, originalHeight:bmp.height, x:trimmed.bounds.x, y:trimmed.bounds.y, width:trimmed.bounds.width, height:trimmed.bounds.height };
        } catch {
          trimRef.current={ originalWidth:bmp.width, originalHeight:bmp.height, x:0, y:0, width:bmp.width, height:bmp.height };
        }
        originalDataRef.current = ctx.getImageData(0,0,c.width,c.height);
      } finally {
        bmp.close();
        setLoaded(true);
      }
    };
    createImageBitmap(file).then(b => { if (!cancelled) drawBitmap(b); else b.close(); })
      .catch(() => {
        if (cancelled) return;
        const reader=new FileReader();
        reader.onload = e => {
          if (cancelled) return;
          const dataUrl=e.target?.result as string; if (!dataUrl) { setLoaded(true); return; }
          const img=new Image();
          img.onload=()=>{ if (!cancelled) createImageBitmap(img).then(b=>{ if (!cancelled) drawBitmap(b); else b.close(); }).catch(()=>{ const c=canvasRef.current; if (!c) { setLoaded(true); return; } c.width=img.naturalWidth; c.height=img.naturalHeight; c.getContext("2d")?.drawImage(img,0,0); setLoaded(true); }); };
          img.onerror=()=>{ if (!cancelled) setLoaded(true); };
          img.src=dataUrl;
        };
        reader.onerror=()=>{ if (!cancelled) setLoaded(true); };
        reader.readAsDataURL(file);
      });
    return () => { cancelled=true; };
  }, [file]);

  useEffect(() => { if (loaded) requestAnimationFrame(updateDisplaySize); }, [loaded, updateDisplaySize]);

  const refreshDisplay = useCallback(() => {
    const c=canvasRef.current; if (!c) return;
    try { setDisplaySrc(c.toDataURL("image/png")); }
    catch { setDisplaySrc(URL.createObjectURL(file)); }
  }, [file]);

  useEffect(() => { if (loaded) refreshDisplay(); }, [histSig, loaded, refreshDisplay]);

  // ── Undo/Redo ─────────────────────────────────────────────────────────────────

  const saveUndo = useCallback(() => {
    const c=canvasRef.current; if (!c) return;
    const ctx=c.getContext("2d"); if (!ctx) return;
    undoRef.current=[...undoRef.current.slice(-19),{ width:c.width,height:c.height,data:ctx.getImageData(0,0,c.width,c.height),trim:trimRef.current?{...trimRef.current}:null }];
    redoRef.current=[]; setHistSig(s=>s+1);
  }, []);

  const restoreSnapshot = useCallback((s: CanvasSnapshot) => {
    const c=canvasRef.current; if (!c) return;
    const ctx=c.getContext("2d"); if (!ctx) return;
    c.width=s.width; c.height=s.height;
    ctx.putImageData(s.data,0,0);
    trimRef.current=s.trim?{...s.trim}:null;
    updateDisplaySize();
  }, [updateDisplaySize]);

  const doUndo = useCallback(() => {
    const c=canvasRef.current; if (!c||!undoRef.current.length) return;
    const ctx=c.getContext("2d"); if (!ctx) return;
    redoRef.current=[...redoRef.current.slice(-19),{ width:c.width,height:c.height,data:ctx.getImageData(0,0,c.width,c.height),trim:trimRef.current?{...trimRef.current}:null }];
    restoreSnapshot(undoRef.current.at(-1)!);
    undoRef.current=undoRef.current.slice(0,-1);
    setHistSig(s=>s+1);
  }, [restoreSnapshot]);

  const doRedo = useCallback(() => {
    const c=canvasRef.current; if (!c||!redoRef.current.length) return;
    const ctx=c.getContext("2d"); if (!ctx) return;
    undoRef.current=[...undoRef.current.slice(-19),{ width:c.width,height:c.height,data:ctx.getImageData(0,0,c.width,c.height),trim:trimRef.current?{...trimRef.current}:null }];
    restoreSnapshot(redoRef.current.at(-1)!);
    redoRef.current=redoRef.current.slice(0,-1);
    setHistSig(s=>s+1);
  }, [restoreSnapshot]);

  const trimCanvasToVisible = useCallback(() => {
    const c=canvasRef.current; if (!c) return false;
    const bW=c.width, bH=c.height;
    let result: ReturnType<typeof trimTransparency>;
    try { result=trimTransparency(c); } catch { return false; }
    if (result.bounds.x===0&&result.bounds.y===0&&result.bounds.width===bW&&result.bounds.height===bH) return false;
    const ctx=c.getContext("2d"); if (!ctx) return false;
    c.width=result.canvas.width; c.height=result.canvas.height;
    ctx.clearRect(0,0,c.width,c.height); ctx.drawImage(result.canvas,0,0);
    const cur=trimRef.current ?? { originalWidth:bW, originalHeight:bH, x:0, y:0, width:bW, height:bH };
    trimRef.current={ ...cur, x:cur.x+result.bounds.x, y:cur.y+result.bounds.y, width:result.bounds.width, height:result.bounds.height };
    updateDisplaySize(); setHistSig(s=>s+1);
    return true;
  }, [updateDisplaySize]);

  useEffect(() => {
    const fn=(e: KeyboardEvent)=>{
      if (!(e.ctrlKey||e.metaKey)) return;
      const key=e.key.toLowerCase();
      if (key==="z"&&e.shiftKey) { e.preventDefault(); doRedo(); }
      else if (key==="z") { e.preventDefault(); doUndo(); }
      else if (key==="y") { e.preventDefault(); doRedo(); }
    };
    window.addEventListener("keydown",fn,true);
    return ()=>window.removeEventListener("keydown",fn,true);
  }, [doUndo, doRedo]);

  useEffect(() => {
    const fn=()=>{ const was=isDrawing.current; isDrawing.current=false; isMoving.current=false; lastBrushPoint.current=null; moveStartRef.current=null; if (was) trimCanvasToVisible(); };
    window.addEventListener("mouseup",fn);
    return ()=>window.removeEventListener("mouseup",fn);
  }, [trimCanvasToVisible]);

  // ── Zoom & Pan ────────────────────────────────────────────────────────────────

  const applyZoom = useCallback((factor: number, cx?: number, cy?: number) => {
    const area=areaRef.current; if (!area||!dispSize) return;
    const areaRect=area.getBoundingClientRect();
    const ancX=cx!==undefined?cx-areaRect.left:area.clientWidth/2;
    const ancY=cy!==undefined?cy-areaRect.top:area.clientHeight/2;
    const layoutLeft=(area.clientWidth-dispSize.w)/2;
    const layoutTop=(area.clientHeight-dispSize.h)/2;
    const prevZ=zoomRef.current;
    const nextZ=Math.max(1,Math.min(40,prevZ*factor));
    if (nextZ===prevZ) return;
    const localX=(ancX-layoutLeft-panRef.current.x)/prevZ;
    const localY=(ancY-layoutTop-panRef.current.y)/prevZ;
    const nextPan=nextZ===1?{x:0,y:0}:{ x:ancX-layoutLeft-localX*nextZ, y:ancY-layoutTop-localY*nextZ };
    setZoom(nextZ); setPan(nextPan);
  }, [dispSize]);

  useEffect(() => {
    const el=areaRef.current; if (!el) return;
    const fn=(e: WheelEvent)=>{ e.preventDefault(); applyZoom(e.deltaY<0?1.18:1/1.18,e.clientX,e.clientY); };
    el.addEventListener("wheel",fn,{passive:false});
    return ()=>el.removeEventListener("wheel",fn);
  }, [applyZoom]);

  useEffect(() => {
    const fn=(e: MouseEvent)=>{ if (toolRef.current!=="move"||!isMoving.current||!moveStartRef.current) return; const s=moveStartRef.current; setPan({ x:s.panX+e.clientX-s.pointerX, y:s.panY+e.clientY-s.pointerY }); };
    window.addEventListener("mousemove",fn);
    return ()=>window.removeEventListener("mousemove",fn);
  }, []);

  // ── Brush helpers ─────────────────────────────────────────────────────────────

  const pointFromEvent = (e: React.MouseEvent<HTMLElement>) => {
    const c=canvasRef.current; const rect=(e.currentTarget as HTMLElement).getBoundingClientRect();
    if (!c||!dispSize) return null;
    const dX=((e.clientX-rect.left)/rect.width)*dispSize.w;
    const dY=((e.clientY-rect.top)/rect.height)*dispSize.h;
    return { displayX:dX, displayY:dY, imageX:dX*(c.width/dispSize.w), imageY:dY*(c.height/dispSize.h), imageRadius:Math.max(0.5,(brushRef.current/2)-(2*c.width/rect.width)) };
  };

  const rafRef = useRef<number|null>(null);
  const scheduleRefresh = useCallback(() => {
    if (rafRef.current!==null) return;
    rafRef.current=requestAnimationFrame(()=>{ rafRef.current=null; refreshDisplay(); });
  }, [refreshDisplay]);

  const applyEraseBrush = (imgX: number, imgY: number, radius: number) => {
    const c=canvasRef.current; if (!c||!dispSize) return;
    const ctx=c.getContext("2d"); if (!ctx) return;
    const last=lastBrushPoint.current;
    const stamp=(x: number, y: number)=>{
      const hardness=Math.max(0.05,Math.min(1,brushHardRef.current));
      const grad=ctx.createRadialGradient(x,y,radius*hardness*0.5,x,y,radius);
      grad.addColorStop(0,"rgba(0,0,0,1)");
      grad.addColorStop(1,"rgba(0,0,0,0)");
      ctx.save();
      ctx.globalCompositeOperation="destination-out";
      ctx.fillStyle=grad;
      ctx.beginPath(); ctx.arc(x,y,radius,0,Math.PI*2); ctx.fill();
      ctx.restore();
    };
    if (last) {
      const dx=imgX-last.x, dy=imgY-last.y;
      const dist=Math.hypot(dx,dy);
      const steps=Math.max(1,Math.ceil(dist/Math.max(1,radius/2)));
      for (let i=1;i<=steps;i++) { const t=i/steps; stamp(last.x+dx*t,last.y+dy*t); }
    } else { stamp(imgX,imgY); }
    lastBrushPoint.current={ x:imgX, y:imgY };
    scheduleRefresh();
  };

  const applyRestoreBrush = (imgX: number, imgY: number, radius: number) => {
    const c=canvasRef.current; if (!c||!dispSize||!originalDataRef.current) return;
    const ctx=c.getContext("2d"); if (!ctx) return;
    const orig=originalDataRef.current;
    const cw=c.width, ch=c.height;
    const r=Math.ceil(radius);
    const x0=Math.max(0,Math.floor(imgX-r)), y0=Math.max(0,Math.floor(imgY-r));
    const x1=Math.min(cw-1,Math.ceil(imgX+r)),  y1=Math.min(ch-1,Math.ceil(imgY+r));
    const cur=ctx.getImageData(x0,y0,x1-x0+1,y1-y0+1);
    const hardness=Math.max(0.05,Math.min(1,brushHardRef.current));
    for (let py=y0;py<=y1;py++) for (let px=x0;px<=x1;px++) {
      const dist=Math.hypot(px-imgX,py-imgY);
      if (dist>radius) continue;
      const falloff=dist<=radius*hardness*0.5?1:1-(dist-radius*hardness*0.5)/Math.max(0.1,radius*(1-hardness*0.5));
      const strength=Math.max(0,Math.min(1,falloff));
      if (strength<=0) continue;
      const ci=((py-y0)*(x1-x0+1)+(px-x0))*4;
      const oi=(py*orig.width+px)*4;
      const oob=px>=orig.width||py>=orig.height;
      if (oob) continue;
      cur.data[ci]   =cur.data[ci]   +(orig.data[oi]   -cur.data[ci])*strength;
      cur.data[ci+1] =cur.data[ci+1] +(orig.data[oi+1] -cur.data[ci+1])*strength;
      cur.data[ci+2] =cur.data[ci+2] +(orig.data[oi+2] -cur.data[ci+2])*strength;
      cur.data[ci+3] =cur.data[ci+3] +(orig.data[oi+3] -cur.data[ci+3])*strength;
    }
    ctx.putImageData(cur,x0,y0);
    lastBrushPoint.current={ x:imgX, y:imgY };
    scheduleRefresh();
  };

  // ── Mouse events ──────────────────────────────────────────────────────────────

  const drawCursorOverlay = (clientX: number, clientY: number) => {
    const c=canvasRef.current; const el=imgRef.current;
    if (!c||!el) return;
    const rect=el.getBoundingClientRect();
    const pz=getPageZoom();
    setCursor({ x:clientX/pz, y:clientY/pz, size:Math.max(4,brushRef.current*(rect.width/c.width)), visible:true });
  };

  const onMouseDown = (e: React.MouseEvent<HTMLElement>) => {
    if (!loaded||!dispSize) return;
    const point=pointFromEvent(e); if (!point) return;
    const { imageX, imageY } = point;
    if (toolRef.current==="move") {
      isMoving.current=true;
      moveStartRef.current={ pointerX:e.clientX, pointerY:e.clientY, panX:panRef.current.x, panY:panRef.current.y };
      return;
    }
    if (toolRef.current==="erase"||toolRef.current==="restore") {
      isDrawing.current=true;
      lastBrushPoint.current=null;
      saveUndo();
      if (toolRef.current==="erase") applyEraseBrush(imageX,imageY,point.imageRadius);
      else applyRestoreBrush(imageX,imageY,point.imageRadius);
      drawCursorOverlay(e.clientX,e.clientY);
    } else if (toolRef.current==="magic-wand") {
      const c=canvasRef.current; if (!c) return;
      const ctx=c.getContext("2d"); if (!ctx) return;
      saveUndo(); setProcessing(true);
      setTimeout(()=>{
        const id=ctx.getImageData(0,0,c.width,c.height);
        edgeAwareFloodFill(id,Math.floor(imageX),Math.floor(imageY),tolRef.current,edgeTolRef.current);
        ctx.putImageData(id,0,0);
        trimCanvasToVisible();
        setProcessing(false);
      },0);
    }
  };

  const onMouseMove = (e: React.MouseEvent<HTMLElement>) => {
    if (toolRef.current==="move"&&isMoving.current&&moveStartRef.current) {
      const s=moveStartRef.current; setPan({ x:s.panX+e.clientX-s.pointerX, y:s.panY+e.clientY-s.pointerY }); return;
    }
    const point=pointFromEvent(e); if (!point) return;
    if (toolRef.current==="erase"||toolRef.current==="restore") drawCursorOverlay(e.clientX,e.clientY);
    if (isDrawing.current) {
      if (toolRef.current==="erase") applyEraseBrush(point.imageX,point.imageY,point.imageRadius);
      else if (toolRef.current==="restore") applyRestoreBrush(point.imageX,point.imageY,point.imageRadius);
    }
  };

  const onMouseUp = () => {
    const was=isDrawing.current;
    isDrawing.current=false; isMoving.current=false; lastBrushPoint.current=null; moveStartRef.current=null;
    if (was) trimCanvasToVisible();
  };

  const onMouseLeave = () => {
    const was=isDrawing.current;
    if (!isMoving.current) isDrawing.current=false;
    lastBrushPoint.current=null;
    setCursor(p=>({...p,visible:false}));
    if (was) trimCanvasToVisible();
  };

  // ── Auto remove BG (AI) ───────────────────────────────────────────────────────

  const handleAutoRemove = async () => {
    const c=canvasRef.current; if (!c) return;
    const ctx=c.getContext("2d"); if (!ctx) return;
    saveUndo();
    setProcessing(true);
    setAiProgress(0);
    try {
      const resultBlob = await removeBackground(file, {
        progress: (_key: string, current: number, total: number) => {
          if (total > 0) setAiProgress(Math.round((current / total) * 100));
        },
        output: { format: "image/png" as const, quality: 1 },
      });
      const bmp = await createImageBitmap(resultBlob);
      c.width = bmp.width;
      c.height = bmp.height;
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.drawImage(bmp, 0, 0);
      bmp.close();
      updateDisplaySize();
      trimCanvasToVisible();
    } catch (err) {
      console.error("AI background removal failed:", err);
    } finally {
      setProcessing(false);
      setAiProgress(0);
    }
  };

  // ── Confirm ───────────────────────────────────────────────────────────────────

  const handleConfirm = () => {
    const c=canvasRef.current; if (!c) return;
    trimCanvasToVisible();
    const edit=trimRef.current??{ originalWidth:c.width, originalHeight:c.height, x:0, y:0, width:c.width, height:c.height };
    const trimmed=trimTransparency(c).canvas;
    const enhanced=enhanceCanvas(trimmed,qualityScale);
    enhanced.toBlob(b=>{ if (b) onConfirm(b,edit); },"image/png");
  };

  // ── Derived ───────────────────────────────────────────────────────────────────

  const canTransform=zoom!==1||pan.x!==0||pan.y!==0?`matrix(${zoom},0,0,${zoom},${pan.x},${pan.y})`:undefined;
  const canUndo=undoRef.current.length>0;
  const canRedo=redoRef.current.length>0;
  void histSig;

  const isBrushTool=tool==="erase"||tool==="restore";
  const isPointTool=tool==="magic-wand";

  const bgStyle: React.CSSProperties = bgPreview==="checker" ? CHECKER_STYLE : bgPreview==="white" ? { backgroundColor:"#fff" } : { backgroundColor:"#111" };

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-[100] flex flex-col" style={{ backgroundColor:"#141414" }}>

      {/* ── Top bar ── */}
      <div className="flex items-center justify-between px-5 h-14 border-b shrink-0" style={{ borderColor:"rgba(255,255,255,0.08)" }}>
        <div className="flex items-center gap-4">
          <span className="text-[11px] font-black uppercase tracking-[0.25em] text-white">Edit Image</span>
          <div className="flex items-center gap-1">
            <button onClick={doUndo} disabled={!canUndo} title="Undo (Ctrl+Z)"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-white/50 hover:text-white hover:bg-white/8 disabled:opacity-25 transition-all text-[11px] font-bold uppercase tracking-widest">
              <Icons.Undo /> Undo
            </button>
            <button onClick={doRedo} disabled={!canRedo} title="Redo (Ctrl+Y)"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-white/50 hover:text-white hover:bg-white/8 disabled:opacity-25 transition-all text-[11px] font-bold uppercase tracking-widest">
              Redo <Icons.Redo />
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 mr-2">
            {(["checker","white","black"] as BgPreview[]).map(b=>(
              <button key={b} onClick={()=>setBgPreview(b)} title={`${b} background`}
                className={`w-6 h-6 rounded border transition-all ${bgPreview===b?"border-[#f5c842] scale-110":"border-white/20 hover:border-white/50"}`}
                style={{ backgroundColor: b==="checker"?"#555":b==="white"?"#fff":"#111",
                  backgroundImage: b==="checker"?"linear-gradient(45deg,#888 25%,transparent 25%),linear-gradient(-45deg,#888 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#888 75%),linear-gradient(-45deg,transparent 75%,#888 75%)":undefined,
                  backgroundSize: b==="checker"?"6px 6px":undefined,
                  backgroundPosition: b==="checker"?"0 0,0 3px,3px -3px,-3px 0":undefined }} />
            ))}
            <span className="text-[10px] text-white/30 ml-1 uppercase tracking-widest">BG</span>
          </div>

          <button onClick={onCancel}
            className="px-4 py-2 text-[11px] font-bold uppercase tracking-widest border border-white/15 text-white/50 hover:text-white hover:border-white/30 transition-all rounded">
            Cancel
          </button>
          <button onClick={handleConfirm}
            className="px-5 py-2 text-[11px] font-black uppercase tracking-widest rounded transition-all hover:opacity-90"
            style={{ backgroundColor:"#f5c842", color:"#0d0d0d" }}>
            Use Image
          </button>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── Left: Tool icons ── */}
        <div className="w-16 flex flex-col items-center py-4 gap-1 border-r shrink-0" style={{ borderColor:"rgba(255,255,255,0.08)" }}>
          {([
            { id:"erase",      Icon:Icons.Erase,   label:"Erase"   },
            { id:"restore",    Icon:Icons.Restore,  label:"Restore" },
            { id:"magic-wand", Icon:Icons.Wand,     label:"Click Remove" },
            { id:"move",       Icon:Icons.Move,     label:"Move"    },
          ] as const).map(({ id, Icon, label }) => (
            <button key={id} onClick={()=>setTool(id)} title={label}
              className={`w-10 h-10 flex items-center justify-center rounded transition-all ${tool===id?"text-[#0d0d0d]":"text-white/40 hover:text-white hover:bg-white/8"}`}
              style={tool===id?{ backgroundColor:"#f5c842" }:{}}>
              <Icon />
            </button>
          ))}
        </div>

        {/* ── Center: Canvas ── */}
        <div ref={areaRef} className="flex-1 overflow-hidden flex items-center justify-center relative" style={bgStyle}>

          {!loaded && (
            <div className="flex flex-col items-center gap-3">
              <div className="w-8 h-8 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
              <p className="text-[11px] uppercase tracking-widest text-white/40">Loading…</p>
            </div>
          )}

          {processing && (
            <div className="absolute inset-0 flex items-center justify-center z-20 bg-black/40 backdrop-blur-sm">
              <div className="flex flex-col items-center gap-4 px-8 py-6 rounded-xl" style={{ backgroundColor:"rgba(13,13,13,0.96)", border:"1px solid rgba(255,255,255,0.1)" }}>
                <div className="w-8 h-8 border-2 border-white/15 border-t-[#f5c842] rounded-full animate-spin" />
                <div className="text-center space-y-2">
                  <p className="text-[11px] uppercase tracking-widest font-bold text-white/80">
                    {aiProgress < 5 ? "Loading AI model…" : aiProgress < 85 ? `Analyzing image…` : "Finishing up…"}
                  </p>
                  {aiProgress > 0 && (
                    <>
                      <div className="w-52 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor:"rgba(255,255,255,0.08)" }}>
                        <div className="h-full rounded-full transition-all duration-200" style={{ width:`${aiProgress}%`, backgroundColor:"#f5c842" }} />
                      </div>
                      <p className="text-[10px] font-mono text-white/30">{aiProgress}%</p>
                    </>
                  )}
                </div>
                <p className="text-[10px] text-white/20 text-center max-w-[200px] leading-relaxed">First use downloads the AI model — subsequent uses are instant</p>
              </div>
            </div>
          )}

          {/* Zoom controls */}
          <div className="absolute bottom-4 right-4 flex items-center gap-1 z-10 rounded overflow-hidden" style={{ backgroundColor:"rgba(13,13,13,0.85)", border:"1px solid rgba(255,255,255,0.1)" }}>
            <button onClick={()=>applyZoom(1/1.2)} className="px-2.5 py-1.5 text-white/50 hover:text-white transition-colors text-lg font-light leading-none">−</button>
            <span className="text-[10px] font-mono text-white/40 px-1 min-w-[3.5rem] text-center">{Math.round(zoom*100)}%</span>
            <button onClick={()=>applyZoom(1.2)} className="px-2.5 py-1.5 text-white/50 hover:text-white transition-colors text-lg font-light leading-none">+</button>
            <button onClick={()=>{ setZoom(1); setPan({x:0,y:0}); }} className="px-2.5 py-1.5 text-[10px] text-white/40 hover:text-white transition-colors font-bold uppercase tracking-widest border-l" style={{ borderColor:"rgba(255,255,255,0.08)" }}>Fit</button>
          </div>

          <div
            ref={wrapperRef}
            style={{ position:"relative", display:loaded&&dispSize&&displaySrc?"block":"none", width:dispSize?`${dispSize.w}px`:0, height:dispSize?`${dispSize.h}px`:0, transformOrigin:"0 0", transform:canTransform, boxShadow:"0 0 0 1px rgba(255,255,255,0.06), 0 8px 40px rgba(0,0,0,0.6)" }}
          >
            <canvas ref={canvasRef} style={{ display:"none" }} />
            <img
              ref={imgRef}
              src={displaySrc}
              alt="editing"
              draggable={false}
              onMouseDown={onMouseDown}
              onMouseMove={onMouseMove}
              onMouseUp={onMouseUp}
              onMouseLeave={onMouseLeave}
              style={{ display:"block", width:dispSize?`${dispSize.w}px`:"auto", height:dispSize?`${dispSize.h}px`:"auto", cursor:processing?"wait":isBrushTool?"none":tool==="move"?(isMoving.current?"grabbing":"grab"):"crosshair", imageRendering:zoom>=6?"pixelated":"auto", userSelect:"none" }}
            />
          </div>

          {cursor.visible && isBrushTool && (
            <div style={{ position:"fixed", left:cursor.x, top:cursor.y, width:cursor.size, height:cursor.size, boxSizing:"border-box", transform:"translate(-50%,-50%)", borderRadius:"9999px", border:`2px solid ${tool==="restore"?"rgba(80,220,120,0.95)":"rgba(255,255,255,0.95)"}`, boxShadow:"0 0 0 1px rgba(0,0,0,0.8), 0 0 10px rgba(0,0,0,0.4)", pointerEvents:"none", zIndex:30 }} />
          )}
        </div>

        {/* ── Right: Tool settings ── */}
        <div className="w-64 border-l flex flex-col shrink-0 overflow-y-auto" style={{ borderColor:"rgba(255,255,255,0.08)", scrollbarWidth:"none" }}>

          {/* Auto Remove BG — always visible at top */}
          <div className="p-5 border-b" style={{ borderColor:"rgba(255,255,255,0.08)" }}>
            <p className="text-[10px] uppercase tracking-[0.2em] text-white/30 mb-3">AI Background Removal</p>
            <button onClick={handleAutoRemove} disabled={processing||!loaded}
              className="w-full flex items-center justify-center gap-2 py-3 rounded font-black uppercase text-xs tracking-widest transition-all hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed"
              style={{ backgroundColor:"#f5c842", color:"#0d0d0d" }}>
              <Icons.AutoRemove />
              Remove Background
            </button>
            <p className="text-[10px] text-white/25 mt-2 leading-relaxed">AI detects and isolates the main subject. Use Erase/Restore brushes to refine edges.</p>
          </div>

          {/* Brush settings — only for brush tools */}
          {isBrushTool && (
            <div className="p-5 space-y-5">
              <div>
                <div className="flex justify-between items-center mb-3">
                  <p className="text-[10px] uppercase tracking-[0.2em] text-white/30">Brush Size</p>
                  <span className="text-[11px] font-mono font-bold text-white/60">{brushSize}px</span>
                </div>
                <input type="range" min={2} max={200} value={brushSize} onChange={e=>setBrushSize(Number(e.target.value))} className="w-full accent-[#f5c842]" />
                <div className="flex justify-between mt-1">
                  <span className="text-[10px] text-white/20">Fine</span>
                  <span className="text-[10px] text-white/20">Large</span>
                </div>
              </div>
              <div>
                <div className="flex justify-between items-center mb-3">
                  <p className="text-[10px] uppercase tracking-[0.2em] text-white/30">Edge Softness</p>
                  <span className="text-[11px] font-mono font-bold text-white/60">{Math.round((1-brushHard)*100)}%</span>
                </div>
                <input type="range" min={0} max={100} value={Math.round((1-brushHard)*100)} onChange={e=>setBrushHard(1-Number(e.target.value)/100)} className="w-full accent-[#f5c842]" />
                <div className="flex justify-between mt-1">
                  <span className="text-[10px] text-white/20">Hard edge</span>
                  <span className="text-[10px] text-white/20">Feathered</span>
                </div>
              </div>
            </div>
          )}

          {/* Click Remove settings */}
          {isPointTool && (
            <div className="p-5 space-y-5">
              <p className="text-[10px] text-white/40 leading-relaxed">Click anywhere on the background to remove it. Edges of the subject are automatically preserved.</p>
              <div>
                <div className="flex justify-between items-center mb-3">
                  <p className="text-[10px] uppercase tracking-[0.2em] text-white/30">Color Spread</p>
                  <span className="text-[11px] font-mono font-bold text-white/60">{tolerance}</span>
                </div>
                <input type="range" min={5} max={120} value={tolerance} onChange={e=>setTolerance(Number(e.target.value))} className="w-full accent-[#f5c842]" />
                <div className="flex justify-between mt-1">
                  <span className="text-[10px] text-white/20">Tight</span>
                  <span className="text-[10px] text-white/20">Wide</span>
                </div>
              </div>
              <div>
                <div className="flex justify-between items-center mb-3">
                  <p className="text-[10px] uppercase tracking-[0.2em] text-white/30">Edge Protection</p>
                  <span className="text-[11px] font-mono font-bold text-white/60">{edgeTol}</span>
                </div>
                <input type="range" min={10} max={200} value={edgeTol} onChange={e=>setEdgeTol(Number(e.target.value))} className="w-full accent-[#f5c842]" />
                <div className="flex justify-between mt-1">
                  <span className="text-[10px] text-white/20">Strict</span>
                  <span className="text-[10px] text-white/20">Relaxed</span>
                </div>
              </div>
              <p className="text-[10px] text-white/25 leading-relaxed">Lower Edge Protection = more precise. Higher = allows crossing softer edges.</p>
            </div>
          )}

          {/* Move info */}
          {tool==="move" && (
            <div className="p-5">
              <p className="text-[10px] text-white/30 leading-relaxed">Click and drag to pan while zoomed in. Use scroll wheel to zoom toward your cursor.</p>
            </div>
          )}

          {/* Keyboard shortcuts */}
          <div className="mt-auto p-5 border-t" style={{ borderColor:"rgba(255,255,255,0.06)" }}>
            <p className="text-[10px] uppercase tracking-[0.2em] text-white/20 mb-3">Shortcuts</p>
            <div className="space-y-1.5">
              {[["Ctrl+Z","Undo"],["Ctrl+Y","Redo"],["Scroll","Zoom"]].map(([k,v])=>(
                <div key={k} className="flex justify-between">
                  <span className="text-[10px] font-mono text-white/30">{k}</span>
                  <span className="text-[10px] text-white/20">{v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
