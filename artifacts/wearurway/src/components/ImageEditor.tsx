import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import FuzzySelectPanel from "./AIAssistPanel";
import { useGetOrderSettings } from "@workspace/api-client-react";

type BgPreview = "checker" | "white" | "black";
type ToolMode  = "select" | null;

export interface ImageEditResult {
  originalWidth: number; originalHeight: number;
  x: number; y: number; width: number; height: number;
}

interface Props {
  file: File;
  onConfirm: (blob: Blob, edit: ImageEditResult) => void;
  onCancel: () => void;
  qualityScale?: number;
}

interface CanvasSnapshot {
  width: number; height: number;
  data: ImageData; trim: ImageEditResult | null;
}

interface AlphaBounds { x: number; y: number; width: number; height: number }

// ─── Pixel helpers ──────────────────────────────────────────────────────────

function getColorAt(d: Uint8ClampedArray, x: number, y: number, w: number): [number,number,number,number] {
  const i=(y*w+x)*4; return [d[i],d[i+1],d[i+2],d[i+3]];
}

function perceptualDist(a: [number,number,number,number], b: [number,number,number,number]) {
  const dr=a[0]-b[0], dg=a[1]-b[1], db=a[2]-b[2];
  return Math.sqrt(0.299*dr*dr + 0.587*dg*dg + 0.114*db*db);
}

function computeGradientMag(d: Uint8ClampedArray, w: number, h: number): Float32Array {
  const mag=new Float32Array(w*h);
  for (let y=1;y<h-1;y++) for (let x=1;x<w-1;x++) {
    let gx=0,gy=0;
    for (let c=0;c<3;c++) {
      const p=(dy:number,dx:number)=>d[((y+dy)*w+(x+dx))*4+c];
      const gxc=-p(-1,-1)-2*p(0,-1)-p(1,-1)+p(-1,1)+2*p(0,1)+p(1,1);
      const gyc=-p(-1,-1)-2*p(-1,0)-p(-1,1)+p(1,-1)+2*p(1,0)+p(1,1);
      gx=Math.max(gx,Math.abs(gxc)); gy=Math.max(gy,Math.abs(gyc));
    }
    mag[y*w+x]=Math.sqrt(gx*gx+gy*gy);
  }
  return mag;
}

function fuzzySelectRegion(id: ImageData, sx: number, sy: number, colorTol: number, edgeTol: number): Uint8Array {
  const {data:d,width:w,height:h}=id;
  const mag=computeGradientMag(d,w,h);
  const seed=getColorAt(d,sx,sy,w);
  const mask=new Uint8Array(w*h);
  if (seed[3]===0) return mask;

  const processed=new Uint8Array(w*h);
  const queue: number[]=[];
  const parentColor=new Uint8Array(w*h*4);

  const startIdx=sy*w+sx;
  processed[startIdx]=1;
  queue.push(startIdx);
  parentColor[startIdx*4]=seed[0]; parentColor[startIdx*4+1]=seed[1];
  parentColor[startIdx*4+2]=seed[2]; parentColor[startIdx*4+3]=seed[3];

  const dirs=[1,0,-1,0,0,1,0,-1,1,1,-1,1,1,-1,-1,-1];

  while (queue.length) {
    const idx=queue.pop()!;
    const x=idx%w, y=Math.floor(idx/w);
    if (d[idx*4+3]===0) continue;
    const col=getColorAt(d,x,y,w);
    const pi=idx*4;
    const par:[number,number,number,number]=[parentColor[pi],parentColor[pi+1],parentColor[pi+2],parentColor[pi+3]];
    if (perceptualDist(col,seed)>colorTol && perceptualDist(col,par)>colorTol*0.55) continue;
    mask[idx]=1;
    for (let di=0;di<16;di+=2) {
      const nx=x+dirs[di], ny=y+dirs[di+1];
      if (nx<0||nx>=w||ny<0||ny>=h) continue;
      const ni=ny*w+nx; if (processed[ni]) continue;
      processed[ni]=1;
      const isDiag=(dirs[di]!==0&&dirs[di+1]!==0);
      if (mag[ni]>(isDiag?edgeTol*1.15:edgeTol)) continue;
      queue.push(ni);
      parentColor[ni*4]=col[0]; parentColor[ni*4+1]=col[1];
      parentColor[ni*4+2]=col[2]; parentColor[ni*4+3]=col[3];
    }
  }
  return mask;
}

function featherMask(mask: Uint8Array, w: number, h: number, passes: number): Float32Array {
  const f=new Float32Array(mask.length);
  for (let i=0;i<mask.length;i++) f[i]=mask[i];
  for (let p=0;p<passes;p++) {
    const tmp=new Float32Array(f);
    for (let y=1;y<h-1;y++) for (let x=1;x<w-1;x++) {
      const idx=y*w+x;
      const isFull=(f[idx]>0.99&&f[idx-1]>0.99&&f[idx+1]>0.99&&f[idx-w]>0.99&&f[idx+w]>0.99);
      const isEmpty=(f[idx]<0.01&&f[idx-1]<0.01&&f[idx+1]<0.01&&f[idx-w]<0.01&&f[idx+w]<0.01);
      if (isFull||isEmpty) continue;
      tmp[idx]=(f[idx]*2+f[idx-1]+f[idx+1]+f[idx-w]+f[idx+w])/6;
    }
    f.set(tmp);
  }
  return f;
}

function applyMaskDeletion(id: ImageData, mask: Uint8Array): ImageData {
  const out=new ImageData(new Uint8ClampedArray(id.data),id.width,id.height);
  const feathered=featherMask(mask,id.width,id.height,4);
  for (let i=0;i<feathered.length;i++) {
    if (feathered[i]>0) out.data[i*4+3]=Math.max(0,Math.round(out.data[i*4+3]*(1-feathered[i])));
  }
  return out;
}

function applyMaskRecolor(id: ImageData, mask: Uint8Array, hexColor: string): ImageData {
  const out=new ImageData(new Uint8ClampedArray(id.data),id.width,id.height);
  const r=parseInt(hexColor.slice(1,3),16);
  const g=parseInt(hexColor.slice(3,5),16);
  const b=parseInt(hexColor.slice(5,7),16);
  for (let i=0;i<mask.length;i++) {
    if (mask[i]&&out.data[i*4+3]>0) { out.data[i*4]=r; out.data[i*4+1]=g; out.data[i*4+2]=b; }
  }
  return out;
}

function getAlphaBounds(src: HTMLCanvasElement): AlphaBounds|null {
  const ctx=src.getContext("2d"); if (!ctx) return null;
  const {width:W,height:H}=src;
  const data=ctx.getImageData(0,0,W,H).data;
  let mx=W,Mx=0,my=H,My=0;
  for (let y=0;y<H;y++) for (let x=0;x<W;x++) {
    if (data[(y*W+x)*4+3]>0) { mx=Math.min(mx,x);Mx=Math.max(Mx,x);my=Math.min(my,y);My=Math.max(My,y); }
  }
  if (mx>Mx||my>My) return null;
  return {x:mx,y:my,width:Mx-mx+1,height:My-my+1};
}

function trimTransparency(src: HTMLCanvasElement): {canvas:HTMLCanvasElement;bounds:AlphaBounds} {
  const bounds=getAlphaBounds(src)??{x:0,y:0,width:1,height:1};
  if (bounds.x===0&&bounds.y===0&&bounds.width===src.width&&bounds.height===src.height) return {canvas:src,bounds};
  const out=document.createElement("canvas");
  out.width=bounds.width; out.height=bounds.height;
  out.getContext("2d")?.drawImage(src,bounds.x,bounds.y,bounds.width,bounds.height,0,0,bounds.width,bounds.height);
  return {canvas:out,bounds};
}

// Separable horizontal/vertical Gaussian blur (sigma≈1.0) for unsharp mask.
// Kernel is small and runs only on RGB so transparent edges stay smooth.
function gaussianBlurRGB(src: Uint8ClampedArray, w: number, h: number): Uint8ClampedArray {
  // 5-tap kernel, sigma≈1.0 — matches the radius of a gentle unsharp mask.
  const K=[0.06136,0.24477,0.38774,0.24477,0.06136];
  const tmp=new Float32Array(w*h*4);
  const out=new Uint8ClampedArray(src.length);
  // Horizontal
  for (let y=0;y<h;y++) {
    for (let x=0;x<w;x++) {
      let r=0,g=0,b=0;
      for (let k=-2;k<=2;k++) {
        const sx=Math.min(w-1,Math.max(0,x+k));
        const i=(y*w+sx)*4, wt=K[k+2];
        r+=src[i]*wt; g+=src[i+1]*wt; b+=src[i+2]*wt;
      }
      const o=(y*w+x)*4;
      tmp[o]=r; tmp[o+1]=g; tmp[o+2]=b; tmp[o+3]=src[o+3];
    }
  }
  // Vertical
  for (let y=0;y<h;y++) {
    for (let x=0;x<w;x++) {
      let r=0,g=0,b=0;
      for (let k=-2;k<=2;k++) {
        const sy=Math.min(h-1,Math.max(0,y+k));
        const i=(sy*w+x)*4, wt=K[k+2];
        r+=tmp[i]*wt; g+=tmp[i+1]*wt; b+=tmp[i+2]*wt;
      }
      const o=(y*w+x)*4;
      out[o]=r; out[o+1]=g; out[o+2]=b; out[o+3]=src[o+3];
    }
  }
  return out;
}

// Gentle unsharp mask: out = src + amount * (src - blurred), thresholded.
// Only RGB is touched — alpha is preserved exactly so anti-aliased edges
// don't get crushed into hard "map contour" lines.
function unsharpMask(id: ImageData, amount=0.35, threshold=4): ImageData {
  const src=id.data, w=id.width, h=id.height;
  const blurred=gaussianBlurRGB(src,w,h);
  const dst=new Uint8ClampedArray(src);
  for (let i=0;i<src.length;i+=4) {
    if (src[i+3]===0) continue;
    for (let c=0;c<3;c++) {
      const diff=src[i+c]-blurred[i+c];
      if (Math.abs(diff)<threshold) continue;
      const v=src[i+c]+amount*diff;
      dst[i+c]=v<0?0:v>255?255:v;
    }
    // alpha intentionally left untouched
  }
  return new ImageData(dst,w,h);
}

// High-quality upscale using the browser's native resize (Lanczos-class in
// Chromium) via createImageBitmap. Falls back to a stepwise bilinear scale
// if createImageBitmap with resize options is unavailable.
async function highQualityUpscale(
  src: HTMLCanvasElement, targetW: number, targetH: number
): Promise<HTMLCanvasElement> {
  if (src.width===targetW && src.height===targetH) return src;
  try {
    const bitmap=await createImageBitmap(src,{
      resizeWidth:targetW,
      resizeHeight:targetH,
      resizeQuality:"high",
    });
    const out=document.createElement("canvas");
    out.width=targetW; out.height=targetH;
    const ctx=out.getContext("2d");
    if (!ctx) { bitmap.close(); return src; }
    ctx.drawImage(bitmap,0,0);
    bitmap.close();
    return out;
  } catch {
    // Fallback: stepwise doubling with high-quality smoothing.
    let cur=src;
    while (cur.width*2<=targetW && cur.height*2<=targetH) {
      const next=document.createElement("canvas");
      next.width=cur.width*2; next.height=cur.height*2;
      const nctx=next.getContext("2d"); if (!nctx) return cur;
      nctx.imageSmoothingEnabled=true; nctx.imageSmoothingQuality="high";
      nctx.drawImage(cur,0,0,next.width,next.height);
      cur=next;
    }
    if (cur.width!==targetW||cur.height!==targetH) {
      const final=document.createElement("canvas");
      final.width=targetW; final.height=targetH;
      const fctx=final.getContext("2d"); if (!fctx) return cur;
      fctx.imageSmoothingEnabled=true; fctx.imageSmoothingQuality="high";
      fctx.drawImage(cur,0,0,targetW,targetH);
      cur=final;
    }
    return cur;
  }
}

async function enhanceCanvas(src: HTMLCanvasElement, qualityScale=1): Promise<HTMLCanvasElement> {
  // Auto-pick the most aggressive sensible scale.
  // Targets ~4096px on the long side (print-grade); never downscales; capped to
  // avoid runaway memory on already-large images.
  const TARGET_LONG=4096, MAX_SIDE=8192, MAX_AUTO_SCALE=8;
  const longSide=Math.max(src.width,src.height);
  const autoScale=Math.min(MAX_AUTO_SCALE,Math.max(1,TARGET_LONG/longSide));
  const scale=Math.min(
    Math.max(qualityScale,autoScale),
    MAX_SIDE/src.width,
    MAX_SIDE/src.height
  );
  const targetW=Math.max(1,Math.round(src.width*scale));
  const targetH=Math.max(1,Math.round(src.height*scale));

  const upscaled=scale>1?await highQualityUpscale(src,targetW,targetH):src;

  const out=document.createElement("canvas");
  out.width=upscaled.width; out.height=upscaled.height;
  const ctx=out.getContext("2d"); if (!ctx) return upscaled;
  ctx.drawImage(upscaled,0,0);

  // Single gentle unsharp mask pass for crispness without ringing or
  // contour-line artifacts. Alpha is preserved so soft edges stay soft.
  const id=ctx.getImageData(0,0,out.width,out.height);
  ctx.putImageData(unsharpMask(id,0.35,4),0,0);
  return out;
}

const CHECKER_STYLE: React.CSSProperties = {
  backgroundImage:"linear-gradient(45deg,#2a2a2a 25%,transparent 25%),linear-gradient(-45deg,#2a2a2a 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#2a2a2a 75%),linear-gradient(-45deg,transparent 75%,#2a2a2a 75%)",
  backgroundSize:"20px 20px", backgroundPosition:"0 0,0 10px,10px -10px,-10px 0px", backgroundColor:"#1c1c1c",
};

const UndoIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
    <path d="M3 7v6h6"/><path d="M3 13A9 9 0 1 0 6 6.7L3 13"/>
  </svg>
);
const RedoIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
    <path d="M21 7v6h-6"/><path d="M21 13A9 9 0 1 1 18 6.7L21 13"/>
  </svg>
);

// ─── Component ──────────────────────────────────────────────────────────────

export default function ImageEditor({ file, onConfirm, onCancel, qualityScale=1 }: Props) {
  const [currentFile, setCurrentFile] = useState<File>(file);
  useEffect(()=>{ setCurrentFile(file); },[file]);
  const [showHelpWizard, setShowHelpWizard] = useState(false);
  const { data: orderSettings } = useGetOrderSettings();
  const contactWhatsappHref = `https://wa.me/20${(orderSettings?.contactPhone || orderSettings?.instaPayPhone || "01069383482").replace(/^0/, "")}`;
  const canvasRef        = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef           = useRef<HTMLImageElement>(null);
  const areaRef          = useRef<HTMLDivElement>(null);

  // ── Pan state ───────────────────────────────────────────────────────────────
  const isMoving         = useRef(false);
  const moveStartRef     = useRef<{pointerX:number;pointerY:number;panX:number;panY:number}|null>(null);

  // ── History ─────────────────────────────────────────────────────────────────
  const undoRef          = useRef<CanvasSnapshot[]>([]);
  const redoRef          = useRef<CanvasSnapshot[]>([]);
  const trimRef          = useRef<ImageEditResult|null>(null);

  // ── Live recolor preview state ──────────────────────────────────────────────
  // Snapshot of the canvas pixels taken on the first preview, so each color
  // tweak can restore-then-recolor without stacking edits or undo entries.
  const recolorBaseRef   = useRef<ImageData|null>(null);

  // ── Refs for stale-closure-safe reads ───────────────────────────────────────
  const panRef           = useRef({x:0,y:0});
  const zoomRef          = useRef(1);
  const displayDimsRef   = useRef<{w:number;h:number}|null>(null);

  // ── Marching ants ───────────────────────────────────────────────────────────
  const rafDisplayRef    = useRef<number|null>(null);
  const baseOverlayRef   = useRef<Uint8ClampedArray|null>(null);
  const borderPixelsRef  = useRef<{idx:number;x:number;y:number}[]>([]);
  const animFrameRef     = useRef<number|null>(null);

  // ── Sensitivity / last click (for live re-selection on slider drag) ─────────
  // Stores the last image-pixel coordinate the user clicked for fuzzy select,
  // so we can re-run the selection whenever the sensitivity slider changes.
  const lastSelectPointRef  = useRef<{px:number;py:number}|null>(null);
  const selectDebounceRef   = useRef<ReturnType<typeof setTimeout>|null>(null);

  // ── React state ─────────────────────────────────────────────────────────────
  const [bgPreview,     setBgPreview]     = useState<BgPreview>("checker");
  const [processing,    setProcessing]    = useState(false);
  const [loaded,        setLoaded]        = useState(false);
  const [zoom,          setZoom]          = useState(1);
  const [pan,           setPan]           = useState({x:0,y:0});
  const [nativeSize,    setNativeSize]    = useState<{w:number;h:number}|null>(null);
  const [histSig,       setHistSig]       = useState(0);
  const [displaySrc,    setDisplaySrc]    = useState("");
  const [toolMode,      setToolMode]      = useState<ToolMode>(null);
  const [selectionMask, setSelectionMask] = useState<Uint8Array|null>(null);
  const [availArea,     setAvailArea]     = useState<{w:number;h:number}|null>(null);
  // sensitivity: 1 (very precise) → 100 (very wide). Default ≈ 40 matches old hardcoded values.
  const [sensitivity,   setSensitivity]   = useState(40);
  void histSig;

  useEffect(()=>{ panRef.current=pan; },[pan]);
  useEffect(()=>{ zoomRef.current=zoom; },[zoom]);

  // ── Measure available area ──────────────────────────────────────────────────

  useEffect(()=>{
    const el=areaRef.current; if (!el) return;
    const ro=new ResizeObserver(entries=>{
      for (const e of entries) setAvailArea({w:e.contentRect.width,h:e.contentRect.height});
    });
    ro.observe(el);
    return ()=>ro.disconnect();
  },[]);

  const displayDims = useMemo(()=>{
    if (!availArea||!nativeSize) return null;
    const pad=0.92;
    const scale=Math.min((availArea.w*pad)/nativeSize.w,(availArea.h*pad)/nativeSize.h);
    return {w:Math.round(nativeSize.w*scale),h:Math.round(nativeSize.h*scale)};
  },[availArea,nativeSize]);
  useEffect(()=>{ displayDimsRef.current=displayDims; },[displayDims]);

  // ── Marching ants ───────────────────────────────────────────────────────────

  useEffect(()=>{
    if (animFrameRef.current) { cancelAnimationFrame(animFrameRef.current); animFrameRef.current=null; }
    const oc=overlayCanvasRef.current, mc=canvasRef.current;
    if (!oc||!mc) return;
    if (!selectionMask) {
      baseOverlayRef.current=null; borderPixelsRef.current=[];
      oc.width=mc.width; oc.height=mc.height;
      oc.getContext("2d")?.clearRect(0,0,oc.width,oc.height);
      return;
    }
    const w=mc.width,h=mc.height;
    oc.width=w; oc.height=h;
    const base=new Uint8ClampedArray(w*h*4);
    const borders:{idx:number;x:number;y:number}[]=[];
    for (let y=0;y<h;y++) for (let x=0;x<w;x++) {
      const idx=y*w+x;
      if (!selectionMask[idx]) continue;
      const isBorder=(x===0||!selectionMask[idx-1]||x===w-1||!selectionMask[idx+1]||y===0||!selectionMask[idx-w]||y===h-1||!selectionMask[idx+w]);
      if (isBorder) borders.push({idx,x,y});
      else { base[idx*4]=100; base[idx*4+1]=160; base[idx*4+2]=255; base[idx*4+3]=25; }
    }
    baseOverlayRef.current=base;
    borderPixelsRef.current=borders;
  },[selectionMask]);

  useEffect(()=>{
    if (!selectionMask) return;
    let offset=0,lastTime=0;
    const tick=(now:number)=>{
      animFrameRef.current=requestAnimationFrame(tick);
      if (now-lastTime<50) return;
      lastTime=now;
      const oc=overlayCanvasRef.current,mc=canvasRef.current;
      const base=baseOverlayRef.current,borders=borderPixelsRef.current;
      if (!oc||!mc||!base) return;
      const buf=new Uint8ClampedArray(base);
      for (const {idx,x,y} of borders) {
        const phase=Math.floor((x+y+offset)/4)%2;
        buf[idx*4]=phase?255:0; buf[idx*4+1]=phase?255:0; buf[idx*4+2]=phase?255:0; buf[idx*4+3]=255;
      }
      const ctx=oc.getContext("2d");
      if (ctx) ctx.putImageData(new ImageData(buf,mc.width,mc.height),0,0);
      offset=(offset+1)%32;
    };
    animFrameRef.current=requestAnimationFrame(tick);
    return ()=>{ if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current); };
  },[selectionMask]);

  // ── Display ─────────────────────────────────────────────────────────────────

  const updateDisplay = useCallback(()=>{
    const c=canvasRef.current; if (!c) return;
    setDisplaySrc(c.toDataURL("image/png"));
  },[]);

  const scheduleDisplay = useCallback(()=>{
    if (rafDisplayRef.current) return;
    rafDisplayRef.current=requestAnimationFrame(()=>{ rafDisplayRef.current=null; updateDisplay(); });
  },[updateDisplay]);
  void scheduleDisplay;

  // ── Load ────────────────────────────────────────────────────────────────────

  useEffect(()=>{
    const url=URL.createObjectURL(currentFile);
    const img=new Image();
    img.onload=()=>{
      const c=canvasRef.current; if (!c) return;
      c.width=img.naturalWidth; c.height=img.naturalHeight;
      const ctx=c.getContext("2d")!;
      ctx.clearRect(0,0,c.width,c.height);
      ctx.drawImage(img,0,0);
      setNativeSize({w:c.width,h:c.height});
      setLoaded(true);
      updateDisplay();
    };
    img.src=url;
    return ()=>URL.revokeObjectURL(url);
  },[currentFile,updateDisplay]);

  // ── Undo / Redo ─────────────────────────────────────────────────────────────

  const saveUndo = useCallback(()=>{
    const c=canvasRef.current; if (!c) return;
    undoRef.current=[...undoRef.current.slice(-19),{
      width:c.width,height:c.height,
      data:c.getContext("2d")!.getImageData(0,0,c.width,c.height),
      trim:trimRef.current,
    }];
    redoRef.current=[];
    setHistSig(h=>h+1);
  },[]);

  const restoreSnap = useCallback((snap: CanvasSnapshot)=>{
    const c=canvasRef.current; if (!c) return;
    c.width=snap.width; c.height=snap.height;
    c.getContext("2d")!.putImageData(snap.data,0,0);
    trimRef.current=snap.trim;
    setNativeSize({w:snap.width,h:snap.height});
    updateDisplay();
  },[updateDisplay]);

  const doUndo = useCallback(()=>{
    const snap=undoRef.current.pop(); if (!snap) return;
    const c=canvasRef.current; if (!c) return;
    // Discard any pending recolor preview without restoring (the snap will
    // overwrite the canvas anyway).
    recolorBaseRef.current=null;
    redoRef.current=[...redoRef.current,{width:c.width,height:c.height,data:c.getContext("2d")!.getImageData(0,0,c.width,c.height),trim:trimRef.current}];
    restoreSnap(snap); setHistSig(h=>h+1);
    setSelectionMask(null);
  },[restoreSnap]);

  const doRedo = useCallback(()=>{
    const snap=redoRef.current.pop(); if (!snap) return;
    const c=canvasRef.current; if (!c) return;
    recolorBaseRef.current=null;
    undoRef.current=[...undoRef.current,{width:c.width,height:c.height,data:c.getContext("2d")!.getImageData(0,0,c.width,c.height),trim:trimRef.current}];
    restoreSnap(snap); setHistSig(h=>h+1);
    setSelectionMask(null);
  },[restoreSnap]);

  // ── Global keyboard shortcuts ───────────────────────────────────────────────
  // Registered in CAPTURE phase ({capture:true}) so the handler fires before
  // any focused element (slider, button, input) can swallow the event.
  // e.key is normalised to lowercase for layout-independence.

  useEffect(()=>{
    const h=(e: KeyboardEvent)=>{
      const key=e.key.toLowerCase();
      // Ctrl+Z → undo
      if ((e.ctrlKey||e.metaKey)&&!e.shiftKey&&key==="z") {
        e.preventDefault();
        e.stopPropagation();
        doUndo();
        return;
      }
      // Ctrl+Y → redo
      if ((e.ctrlKey||e.metaKey)&&!e.shiftKey&&key==="y") {
        e.preventDefault();
        e.stopPropagation();
        doRedo();
        return;
      }
      // Ctrl+Shift+Z → redo (alternate)
      if ((e.ctrlKey||e.metaKey)&&e.shiftKey&&key==="z") {
        e.preventDefault();
        e.stopPropagation();
        doRedo();
        return;
      }
      if (e.key==="Escape") setSelectionMask(null);
    };
    window.addEventListener("keydown",h,{capture:true});
    return ()=>window.removeEventListener("keydown",h,{capture:true});
  },[doUndo,doRedo]);

  // ── Zoom ────────────────────────────────────────────────────────────────────

  const applyZoom = useCallback((newZ: number, fx=0.5, fy=0.5)=>{
    const el=areaRef.current; if (!el) return;
    const rect=el.getBoundingClientRect();
    const dims=displayDimsRef.current;
    const clamped=Math.max(0.1,Math.min(10,newZ));
    const scale=clamped/zoomRef.current;
    const natLeft=dims?(rect.width -dims.w)/2:0;
    const natTop =dims?(rect.height-dims.h)/2:0;
    const qx=rect.width*fx-natLeft;
    const qy=rect.height*fy-natTop;
    setPan(p=>({x:qx+(p.x-qx)*scale,y:qy+(p.y-qy)*scale}));
    setZoom(clamped);
  },[]);

  const onWheel = useCallback((e: React.WheelEvent)=>{
    e.preventDefault();
    const el=areaRef.current; if (!el) return;
    const rect=el.getBoundingClientRect();
    applyZoom(zoomRef.current*(e.deltaY<0?1.12:1/1.12),
      (e.clientX-rect.left)/rect.width,(e.clientY-rect.top)/rect.height);
  },[applyZoom]);

  // ── Coordinate mapping (for fuzzy select) ───────────────────────────────────

  const getImageCoords = useCallback((clientX: number, clientY: number): {imgX:number;imgY:number}|null=>{
    if (!nativeSize||!imgRef.current) return null;
    const rect=imgRef.current.getBoundingClientRect();
    if (rect.width===0||rect.height===0) return null;
    return {
      imgX:(clientX-rect.left)/rect.width *nativeSize.w,
      imgY:(clientY-rect.top) /rect.height*nativeSize.h,
    };
  },[nativeSize]);

  // ── Sensitivity → tolerance mapping ────────────────────────────────────────
  // sensitivity 1  → colorTol≈6,  edgeTol≈17  (very tight)
  // sensitivity 40 → colorTol≈55, edgeTol≈77  (matches old hardcoded values)
  // sensitivity 100→ colorTol≈130, edgeTol≈170 (very wide)
  const tolerancesFromSensitivity = useCallback((s: number)=>{
    const t=s/100;
    return {colorTol:Math.round(5+t*125), edgeTol:Math.round(15+t*155)};
  },[]);

  // ── Fuzzy select ─────────────────────────────────────────────────────────────

  const runFuzzySelect = useCallback((px: number, py: number, sens: number)=>{
    const c=canvasRef.current; if (!c) return;
    const ctx=c.getContext("2d"); if (!ctx) return;
    // If there is a pending recolor preview, COMMIT it before making a new
    // selection so the user doesn't lose their work by clicking the canvas.
    // The previewed pixels stay applied and a single undo entry is saved.
    if (recolorBaseRef.current) {
      undoRef.current=[...undoRef.current.slice(-19),{
        width:c.width,height:c.height,data:recolorBaseRef.current,trim:trimRef.current,
      }];
      redoRef.current=[];
      setHistSig(h=>h+1);
      recolorBaseRef.current=null;
    }
    setProcessing(true);
    setTimeout(()=>{
      const id=ctx.getImageData(0,0,c.width,c.height);
      const {colorTol,edgeTol}=tolerancesFromSensitivity(sens);
      const maskResult=fuzzySelectRegion(id,px,py,colorTol,edgeTol);
      setSelectionMask(maskResult);
      setProcessing(false);
    },0);
  },[tolerancesFromSensitivity]);

  const handleFuzzySelect = useCallback((imgX: number, imgY: number)=>{
    const c=canvasRef.current; if (!c) return;
    const px=Math.floor(Math.max(0,Math.min(c.width-1,imgX)));
    const py=Math.floor(Math.max(0,Math.min(c.height-1,imgY)));
    lastSelectPointRef.current={px,py};
    runFuzzySelect(px,py,sensitivity);
  },[sensitivity,runFuzzySelect]);

  // Re-run selection live whenever sensitivity changes, as long as the user
  // has already clicked (i.e. there is a stored last-click point).
  useEffect(()=>{
    const pt=lastSelectPointRef.current;
    if (!pt) return;
    // Debounce so rapid slider drags don't flood the pixel loop
    if (selectDebounceRef.current) clearTimeout(selectDebounceRef.current);
    selectDebounceRef.current=setTimeout(()=>{
      selectDebounceRef.current=null;
      runFuzzySelect(pt.px,pt.py,sensitivity);
    },60);
    return ()=>{ if (selectDebounceRef.current) clearTimeout(selectDebounceRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[sensitivity]);

  // ── Selection actions ────────────────────────────────────────────────────────

  const handleDelete = useCallback(()=>{
    if (!selectionMask) return;
    const c=canvasRef.current; if (!c) return;
    const ctx=c.getContext("2d"); if (!ctx) return;
    // Drop any in-progress recolor preview before deleting pixels.
    if (recolorBaseRef.current) {
      ctx.putImageData(recolorBaseRef.current,0,0);
      recolorBaseRef.current=null;
    }
    setProcessing(true);
    saveUndo();
    setTimeout(()=>{
      const id=ctx.getImageData(0,0,c.width,c.height);
      const result=applyMaskDeletion(id,selectionMask);
      ctx.putImageData(result,0,0);
      updateDisplay();
      setSelectionMask(null);
      setProcessing(false);
    },0);
  },[selectionMask,saveUndo,updateDisplay]);

  // Live recolor preview — restores from the original snapshot and re-applies
  // the recolor with each new color, so dragging the picker updates the canvas
  // in real time without piling on undo entries.
  const handlePreviewColor = useCallback((color: string)=>{
    if (!selectionMask) return;
    const c=canvasRef.current; if (!c) return;
    const ctx=c.getContext("2d"); if (!ctx) return;
    if (!recolorBaseRef.current) {
      recolorBaseRef.current=ctx.getImageData(0,0,c.width,c.height);
    }
    const base=recolorBaseRef.current;
    const result=applyMaskRecolor(base,selectionMask,color);
    ctx.putImageData(result,0,0);
    updateDisplay();
  },[selectionMask,updateDisplay]);

  // Cancel any pending preview by restoring the snapshot taken before the
  // first preview color was applied.
  const cancelColorPreview = useCallback(()=>{
    if (!recolorBaseRef.current) return;
    const c=canvasRef.current; if (!c) return;
    const ctx=c.getContext("2d"); if (!ctx) return;
    ctx.putImageData(recolorBaseRef.current,0,0);
    recolorBaseRef.current=null;
    updateDisplay();
  },[updateDisplay]);

  const handleChangeColor = useCallback((color: string)=>{
    if (!selectionMask) return;
    const c=canvasRef.current; if (!c) return;
    const ctx=c.getContext("2d"); if (!ctx) return;
    // Snapshot the pre-preview pixels so undo can restore the original.
    const baseSnapshot=recolorBaseRef.current
      ?? ctx.getImageData(0,0,c.width,c.height);
    // Push the original to the undo stack (so Ctrl+Z reverts the recolor).
    undoRef.current=[...undoRef.current.slice(-19),{
      width:c.width,height:c.height,data:baseSnapshot,trim:trimRef.current,
    }];
    redoRef.current=[];
    setHistSig(h=>h+1);
    // Apply the final color from the original baseline.
    const result=applyMaskRecolor(baseSnapshot,selectionMask,color);
    ctx.putImageData(result,0,0);
    recolorBaseRef.current=null;
    updateDisplay();
    setSelectionMask(null);
  },[selectionMask,updateDisplay]);

  const handleClearSelection = useCallback(()=>{
    cancelColorPreview();
    setSelectionMask(null);
    lastSelectPointRef.current=null;
  },[cancelColorPreview]);

  // ── Mouse events ────────────────────────────────────────────────────────────

  const onMouseDown = useCallback((e: React.MouseEvent<HTMLElement>)=>{
    if (!loaded||!nativeSize) return;

    // Right-click (button 2) always pans, regardless of the active tool — lets
    // the user hold right-click to move while in Magic Select etc.
    if (e.button===2) {
      e.preventDefault();
      isMoving.current=true;
      moveStartRef.current={pointerX:e.clientX,pointerY:e.clientY,panX:panRef.current.x,panY:panRef.current.y};
      return;
    }

    if (toolMode==="select") {
      const pt=getImageCoords(e.clientX,e.clientY);
      if (pt) handleFuzzySelect(pt.imgX,pt.imgY);
      return;
    }

    // Default: left-click also pans
    isMoving.current=true;
    moveStartRef.current={pointerX:e.clientX,pointerY:e.clientY,panX:panRef.current.x,panY:panRef.current.y};
  },[loaded,nativeSize,toolMode,getImageCoords,handleFuzzySelect]);

  const onMouseMove = useCallback((e: React.MouseEvent<HTMLElement>)=>{
    if (isMoving.current&&moveStartRef.current) {
      const s=moveStartRef.current;
      setPan({x:s.panX+e.clientX-s.pointerX,y:s.panY+e.clientY-s.pointerY});
    }
  },[]);

  const onMouseUp = useCallback(()=>{
    isMoving.current=false;
    moveStartRef.current=null;
  },[]);

  const onMouseLeave = useCallback(()=>{ onMouseUp(); },[onMouseUp]);

  // Suppress the browser context menu on the canvas area so right-click is
  // free to be used as a pan gesture.
  const onContextMenu = useCallback((e: React.MouseEvent<HTMLElement>)=>{
    e.preventDefault();
  },[]);

  // ── Confirm ─────────────────────────────────────────────────────────────────

  const handleConfirm = useCallback(()=>{
    const c=canvasRef.current; if (!c) return;
    const bounds=getAlphaBounds(c);
    trimRef.current=bounds
      ?{originalWidth:c.width,originalHeight:c.height,x:bounds.x,y:bounds.y,width:bounds.width,height:bounds.height}
      :{originalWidth:c.width,originalHeight:c.height,x:0,y:0,width:c.width,height:c.height};
    setProcessing(true);
    // Yield to the browser so the "Applying…" overlay paints before the
    // CPU-heavy upscale + sharpen passes lock the main thread.
    setTimeout(async ()=>{
      try {
        const trimmed=trimTransparency(c).canvas;
        const enhanced=await enhanceCanvas(trimmed,qualityScale);
        enhanced.toBlob(b=>{
          setProcessing(false);
          if (b) onConfirm(b,trimRef.current!);
        },"image/png");
      } catch {
        setProcessing(false);
      }
    },30);
  },[qualityScale,onConfirm]);

  // ── Derived display values ───────────────────────────────────────────────────

  const canTransform=zoom!==1||pan.x!==0||pan.y!==0?`matrix(${zoom},0,0,${zoom},${pan.x},${pan.y})`:undefined;
  const canUndo=undoRef.current.length>0;
  const canRedo=redoRef.current.length>0;
  const bgStyle:React.CSSProperties=bgPreview==="checker"?CHECKER_STYLE:bgPreview==="white"?{backgroundColor:"#fff"}:{backgroundColor:"#111"};
  const canvasCursor=toolMode==="select"?"crosshair":selectionMask?"default":"grab";

  const handleSetToolMode = useCallback((mode: ToolMode)=>{
    setToolMode(prev=>{
      if (prev===mode) {
        setSelectionMask(null);
        lastSelectPointRef.current=null;
        return null;
      }
      if (mode==="select") { setSelectionMask(null); lastSelectPointRef.current=null; }
      if (mode===null) { setSelectionMask(null); lastSelectPointRef.current=null; }
      return mode;
    });
  },[]);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-[100] flex flex-col" style={{backgroundColor:"#141414"}}>

      {/* ── Top bar ── */}
      <div className="flex items-center justify-between px-5 h-14 border-b shrink-0" style={{borderColor:"rgba(255,255,255,0.08)"}}>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full" style={{backgroundColor:"#a855f7"}}/>
            <span className="text-[11px] font-black uppercase tracking-[0.25em] text-white">Image Editor</span>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={doUndo} disabled={!canUndo} title="Undo (Ctrl+Z)"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-white/50 hover:text-white hover:bg-white/8 disabled:opacity-25 transition-all text-[11px] font-bold uppercase tracking-widest">
              <UndoIcon/> Undo
            </button>
            <button onClick={doRedo} disabled={!canRedo} title="Redo (Ctrl+Y)"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-white/50 hover:text-white hover:bg-white/8 disabled:opacity-25 transition-all text-[11px] font-bold uppercase tracking-widest">
              Redo <RedoIcon/>
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 mr-2">
            {(["checker","white","black"] as BgPreview[]).map(b=>(
              <button key={b} onClick={()=>setBgPreview(b)} title={`${b} background`}
                className={`w-6 h-6 rounded border transition-all ${bgPreview===b?"border-[#f5c842] scale-110":"border-white/20 hover:border-white/50"}`}
                style={{backgroundColor:b==="checker"?"#555":b==="white"?"#fff":"#111",
                  backgroundImage:b==="checker"?"linear-gradient(45deg,#888 25%,transparent 25%),linear-gradient(-45deg,#888 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#888 75%),linear-gradient(-45deg,transparent 75%,#888 75%)":undefined,
                  backgroundSize:b==="checker"?"6px 6px":undefined,
                  backgroundPosition:b==="checker"?"0 0,0 3px,3px -3px,-3px 0":undefined}} />
            ))}
            <span className="text-[10px] text-white/30 ml-1 uppercase tracking-widest">BG</span>
          </div>
          <button onClick={onCancel}
            className="px-4 py-2 rounded-lg text-[11px] font-bold uppercase tracking-widest text-white/40 hover:text-white/70 hover:bg-white/8 transition-all">
            Cancel
          </button>
          <button onClick={handleConfirm}
            className="px-5 py-2 rounded-lg text-[11px] font-black uppercase tracking-widest transition-all hover:scale-105 active:scale-95"
            style={{background:"linear-gradient(135deg,#a855f7,#7c3aed)",color:"#fff"}}>
            Apply →
          </button>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="flex flex-1 min-h-0">

        {/* ── Canvas area ── */}
        <div
          ref={areaRef}
          className="flex-1 flex items-center justify-center relative overflow-hidden select-none"
          style={{...bgStyle,cursor:canvasCursor}}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseLeave}
          onContextMenu={onContextMenu}
          onWheel={onWheel}
        >
          {displaySrc && displayDims && (
            <div
              style={{
                position:"relative",
                width:displayDims.w,
                height:displayDims.h,
                transform:canTransform,
                transformOrigin:"0 0",
                flexShrink:0,
              }}
            >
              <img
                ref={imgRef}
                src={displaySrc}
                alt="editing"
                draggable={false}
                style={{
                  display:"block",
                  width:displayDims.w,
                  height:displayDims.h,
                  userSelect:"none",
                  imageRendering:"auto",
                }}
              />
              <canvas
                ref={overlayCanvasRef}
                style={{
                  position:"absolute",
                  top:0,left:0,
                  width:displayDims.w,
                  height:displayDims.h,
                  pointerEvents:"none",
                  imageRendering:"pixelated",
                }}
              />
            </div>
          )}

          {!loaded && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-white/30 text-[11px] uppercase tracking-widest animate-pulse">Loading…</div>
            </div>
          )}

          {processing && (
            <div className="absolute inset-0 flex items-center justify-center" style={{backgroundColor:"rgba(0,0,0,0.55)"}}>
              <div className="flex flex-col items-center gap-3">
                <div className="flex gap-1.5">
                  {[0,1,2].map(i=>(
                    <div key={i} className="w-2.5 h-2.5 rounded-full animate-bounce"
                      style={{backgroundColor:"#a855f7",animationDelay:`${i*0.15}s`}}/>
                  ))}
                </div>
                <span className="text-[11px] font-bold uppercase tracking-[0.2em]"
                  style={{color:"rgba(196,140,255,0.9)"}}>Applying…</span>
              </div>
            </div>
          )}

          {loaded && !processing && (
            <button
              onClick={(e)=>{ e.stopPropagation(); setShowHelpWizard(true); }}
              onMouseDown={(e)=>e.stopPropagation()}
              onMouseUp={(e)=>e.stopPropagation()}
              onMouseMove={(e)=>e.stopPropagation()}
              className="absolute bottom-5 left-5 z-20 max-w-[260px] text-left px-4 py-3 rounded-2xl transition-all hover:scale-[1.02] active:scale-[0.99]"
              style={{
                background:"linear-gradient(135deg,rgba(168,85,247,0.85),rgba(124,58,237,0.85))",
                border:"1px solid rgba(196,140,255,0.6)",
                backdropFilter:"blur(8px)",
                color:"#fff",
                boxShadow:"0 8px 24px rgba(124,58,237,0.35)"
              }}
            >
              <p className="text-[10px] font-black uppercase tracking-[0.2em] mb-1" style={{color:"#fff"}}>
                Need Help?
              </p>
              <p className="text-[11px] leading-snug" style={{color:"rgba(255,255,255,0.95)"}}>
                Can't achieve what you have in mind using these tools?
              </p>
            </button>
          )}

          {toolMode==="select" && !selectionMask && loaded && !processing && (
            <div className="absolute bottom-5 left-1/2 -translate-x-1/2 pointer-events-none">
              <div className="flex items-center gap-2 px-4 py-2 rounded-full text-[11px] font-bold"
                style={{backgroundColor:"rgba(0,0,0,0.7)",border:"1px solid rgba(168,85,247,0.4)",color:"rgba(196,140,255,0.9)",backdropFilter:"blur(8px)"}}>
                <span style={{color:"#a855f7"}}>✦</span> Click anywhere on your image to select
              </div>
            </div>
          )}

          <canvas ref={canvasRef} style={{display:"none"}}/>
        </div>

        {/* ── Tool panel ── */}
        <div className="w-80 border-l flex flex-col shrink-0" style={{borderColor:"rgba(168,85,247,0.2)"}}>
          <FuzzySelectPanel
            toolMode={toolMode}
            hasSelection={!!selectionMask}
            onSetToolMode={handleSetToolMode}
            onDelete={handleDelete}
            onChangeColor={handleChangeColor}
            onPreviewColor={handlePreviewColor}
            onCancelColorPreview={cancelColorPreview}
            onClearSelection={handleClearSelection}
            sensitivity={sensitivity}
            onSensitivity={setSensitivity}
            onReimportFile={(f)=>setCurrentFile(f)}
          />
        </div>
      </div>

      {showHelpWizard && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          style={{ backgroundColor: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)" }}
          onClick={() => setShowHelpWizard(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl p-6 text-center"
            style={{
              background: "linear-gradient(135deg,rgba(30,15,50,0.98),rgba(15,5,30,0.98))",
              border: "1px solid rgba(168,85,247,0.4)",
              boxShadow: "0 20px 60px rgba(124,58,237,0.4)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-[10px] font-black uppercase tracking-[0.3em] mb-3" style={{ color: "#c48cff" }}>
              Need Help?
            </p>
            <p className="text-[15px] leading-relaxed mb-6" style={{ color: "rgba(255,255,255,0.95)" }}>
              No stress at all, we can turn your photo into exactly what you imagine. Just contact us, and we'll reply within minutes
            </p>
            <a
              href={contactWhatsappHref}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setShowHelpWizard(false)}
              className="inline-block w-full px-6 py-3 rounded-xl font-bold text-sm tracking-[0.15em] uppercase transition-all hover:scale-[1.02] active:scale-[0.99]"
              style={{
                background: "linear-gradient(135deg,rgba(168,85,247,1),rgba(124,58,237,1))",
                color: "#fff",
                boxShadow: "0 8px 24px rgba(124,58,237,0.5)",
              }}
            >
              Contact Us
            </a>
            <button
              onClick={() => setShowHelpWizard(false)}
              className="mt-4 text-[11px] tracking-[0.2em] uppercase text-white/40 hover:text-white underline underline-offset-4 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
