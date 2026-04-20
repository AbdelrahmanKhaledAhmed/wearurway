import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import FuzzySelectPanel from "./AIAssistPanel";

type BgPreview = "checker" | "white" | "black";
type ToolMode  = "select" | "restore" | "erase" | null;

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

function sharpenImageData(id: ImageData) {
  const src=id.data, dst=new Uint8ClampedArray(src), w=id.width, h=id.height;
  for (let y=1;y<h-1;y++) for (let x=1;x<w-1;x++) {
    const i=(y*w+x)*4; if (src[i+3]===0) continue;
    for (let c=0;c<3;c++) {
      const v=9*src[i+c]-src[((y-1)*w+(x-1))*4+c]-src[((y-1)*w+x)*4+c]-src[((y-1)*w+(x+1))*4+c]-src[(y*w+(x-1))*4+c]-src[(y*w+(x+1))*4+c]-src[((y+1)*w+(x-1))*4+c]-src[((y+1)*w+x)*4+c]-src[((y+1)*w+(x+1))*4+c];
      dst[i+c]=Math.max(0,Math.min(255,v));
    }
  }
  for (let i=3;i<dst.length;i+=4) dst[i]=Math.max(0,Math.min(255,Math.round(8*(src[i]-128)+128)));
  return new ImageData(dst,w,h);
}

function enhanceCanvas(src: HTMLCanvasElement, qualityScale=1) {
  const maxSide=8192, scale=Math.min(Math.max(qualityScale,1),maxSide/src.width,maxSide/src.height);
  const out=document.createElement("canvas");
  out.width=Math.max(1,Math.round(src.width*scale)); out.height=Math.max(1,Math.round(src.height*scale));
  const ctx=out.getContext("2d"); if (!ctx) return src;
  ctx.imageSmoothingEnabled=true; ctx.imageSmoothingQuality="high";
  ctx.drawImage(src,0,0,out.width,out.height);
  const id=ctx.getImageData(0,0,out.width,out.height);
  ctx.putImageData(sharpenImageData(id),0,0);
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
  const canvasRef        = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef           = useRef<HTMLImageElement>(null);
  const areaRef          = useRef<HTMLDivElement>(null);

  // ── Pixel buffers ───────────────────────────────────────────────────────────
  // workingDataRef: live pixel buffer — always mirrors canvasRef, modified in-memory by brush
  const workingDataRef   = useRef<ImageData|null>(null);
  // trueOriginalRef: set ONCE at load, NEVER mutated — used by restore brush
  const trueOriginalRef  = useRef<ImageData|null>(null);

  // ── Painting state ──────────────────────────────────────────────────────────
  const isPainting       = useRef(false);
  const lastStrokePoint  = useRef<{imgX:number;imgY:number}|null>(null);
  const strokeDirty      = useRef(false);
  const rafFlushRef      = useRef<number|null>(null);

  // ── Pan / move state ────────────────────────────────────────────────────────
  const isMoving         = useRef(false);
  const moveStartRef     = useRef<{pointerX:number;pointerY:number;panX:number;panY:number}|null>(null);

  // ── History ─────────────────────────────────────────────────────────────────
  const undoRef          = useRef<CanvasSnapshot[]>([]);
  const redoRef          = useRef<CanvasSnapshot[]>([]);
  const trimRef          = useRef<ImageEditResult|null>(null);

  // ── Refs for values needed in callbacks without stale closures ──────────────
  const panRef           = useRef({x:0,y:0});
  const zoomRef          = useRef(1);
  const displayDimsRef   = useRef<{w:number;h:number}|null>(null);
  const brushSizeRef     = useRef(25);
  const selectionMaskRef = useRef<Uint8Array|null>(null);
  const toolModeRef      = useRef<ToolMode>(null);

  // ── Display / animation ─────────────────────────────────────────────────────
  const rafDisplayRef    = useRef<number|null>(null);
  const baseOverlayRef   = useRef<Uint8ClampedArray|null>(null);
  const borderPixelsRef  = useRef<{idx:number;x:number;y:number}[]>([]);
  const animFrameRef     = useRef<number|null>(null);

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
  const [brushSize,     setBrushSize]     = useState(25);
  const [availArea,     setAvailArea]     = useState<{w:number;h:number}|null>(null);
  // Cursor: track raw viewport position for the brush ring overlay
  const [cursorClient,  setCursorClient]  = useState<{x:number;y:number;visible:boolean}>({x:0,y:0,visible:false});
  void histSig;

  // Keep refs in sync with state
  useEffect(()=>{ panRef.current=pan; },[pan]);
  useEffect(()=>{ zoomRef.current=zoom; },[zoom]);
  useEffect(()=>{ brushSizeRef.current=brushSize; },[brushSize]);
  useEffect(()=>{ selectionMaskRef.current=selectionMask; },[selectionMask]);
  useEffect(()=>{ toolModeRef.current=toolMode; },[toolMode]);

  // Measure available area
  useEffect(()=>{
    const el=areaRef.current; if (!el) return;
    const ro=new ResizeObserver(entries=>{
      for (const e of entries) setAvailArea({w:e.contentRect.width,h:e.contentRect.height});
    });
    ro.observe(el);
    return ()=>ro.disconnect();
  },[]);

  // Compute display dimensions that fill available area while keeping aspect ratio
  const displayDims = useMemo(()=>{
    if (!availArea||!nativeSize) return null;
    const pad=0.92;
    const scale=Math.min((availArea.w*pad)/nativeSize.w,(availArea.h*pad)/nativeSize.h);
    return {w:Math.round(nativeSize.w*scale),h:Math.round(nativeSize.h*scale)};
  },[availArea,nativeSize]);
  useEffect(()=>{ displayDimsRef.current=displayDims; },[displayDims]);

  // ── Marching ants overlay ───────────────────────────────────────────────────

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

  // ── Display update ──────────────────────────────────────────────────────────

  const updateDisplay = useCallback(()=>{
    const c=canvasRef.current; if (!c) return;
    setDisplaySrc(c.toDataURL("image/png"));
  },[]);

  const scheduleDisplay = useCallback(()=>{
    if (rafDisplayRef.current) return;
    rafDisplayRef.current=requestAnimationFrame(()=>{
      rafDisplayRef.current=null;
      updateDisplay();
    });
  },[updateDisplay]);

  // ── Working buffer management ───────────────────────────────────────────────

  // Pull current canvas pixels into workingDataRef
  const syncBufferFromCanvas = useCallback(()=>{
    const c=canvasRef.current; if (!c) return;
    workingDataRef.current=c.getContext("2d")!.getImageData(0,0,c.width,c.height);
  },[]);

  // Push workingDataRef back to canvas and refresh display
  const flushBufferToCanvas = useCallback(()=>{
    const c=canvasRef.current;
    const wd=workingDataRef.current;
    if (!c||!wd) return;
    c.getContext("2d")!.putImageData(wd,0,0);
    strokeDirty.current=false;
    scheduleDisplay();
  },[scheduleDisplay]);

  // Schedule a flush via rAF — called after every brush stamp
  const scheduleBrushFlush = useCallback(()=>{
    if (rafFlushRef.current) return;
    rafFlushRef.current=requestAnimationFrame(()=>{
      rafFlushRef.current=null;
      flushBufferToCanvas();
    });
  },[flushBufferToCanvas]);

  // ── Load ────────────────────────────────────────────────────────────────────

  useEffect(()=>{
    const url=URL.createObjectURL(file);
    const img=new Image();
    img.onload=()=>{
      const c=canvasRef.current; if (!c) return;
      c.width=img.naturalWidth; c.height=img.naturalHeight;
      const ctx=c.getContext("2d")!;
      ctx.clearRect(0,0,c.width,c.height);
      ctx.drawImage(img,0,0);
      const imgData=ctx.getImageData(0,0,c.width,c.height);
      // trueOriginalRef: immutable, set once, never touched again
      trueOriginalRef.current=new ImageData(new Uint8ClampedArray(imgData.data),imgData.width,imgData.height);
      // workingDataRef: live copy, modified by brush
      workingDataRef.current=new ImageData(new Uint8ClampedArray(imgData.data),imgData.width,imgData.height);
      setNativeSize({w:c.width,h:c.height});
      setLoaded(true);
      updateDisplay();
    };
    img.src=url;
    return ()=>URL.revokeObjectURL(url);
  },[file,updateDisplay]);

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
    // Keep workingDataRef in sync after undo/redo
    workingDataRef.current=new ImageData(new Uint8ClampedArray(snap.data.data),snap.data.width,snap.data.height);
    setNativeSize({w:snap.width,h:snap.height});
    updateDisplay();
  },[updateDisplay]);

  const doUndo = useCallback(()=>{
    const snap=undoRef.current.pop(); if (!snap) return;
    const c=canvasRef.current; if (!c) return;
    redoRef.current=[...redoRef.current,{width:c.width,height:c.height,data:c.getContext("2d")!.getImageData(0,0,c.width,c.height),trim:trimRef.current}];
    restoreSnap(snap); setHistSig(h=>h+1);
    setSelectionMask(null);
  },[restoreSnap]);

  const doRedo = useCallback(()=>{
    const snap=redoRef.current.pop(); if (!snap) return;
    const c=canvasRef.current; if (!c) return;
    undoRef.current=[...undoRef.current,{width:c.width,height:c.height,data:c.getContext("2d")!.getImageData(0,0,c.width,c.height),trim:trimRef.current}];
    restoreSnap(snap); setHistSig(h=>h+1);
    setSelectionMask(null);
  },[restoreSnap]);

  useEffect(()=>{
    const h=(e: KeyboardEvent)=>{
      if ((e.ctrlKey||e.metaKey)&&e.key==="z") { e.preventDefault(); doUndo(); }
      if ((e.ctrlKey||e.metaKey)&&(e.key==="y"||(e.shiftKey&&e.key==="z"))) { e.preventDefault(); doRedo(); }
      if (e.key==="Escape") setSelectionMask(null);
    };
    window.addEventListener("keydown",h);
    return ()=>window.removeEventListener("keydown",h);
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

  // ── NEW BRUSH ENGINE — Coordinate system ────────────────────────────────────
  //
  // Single source of truth: imgRef.getBoundingClientRect()
  //   • getBoundingClientRect() always returns the ACTUAL on-screen pixel position
  //     and size of the element, including all parent CSS transforms (zoom, pan).
  //   • No manual reconstruction of (natLeft + pan + zoom) needed.
  //   • Works correctly at any zoom, pan, window resize, or selection state.
  //
  // getImageCoords(clientX, clientY) → {imgX, imgY} in native canvas pixels
  //   imgX = (clientX - rect.left) / rect.width  * nativeW
  //   imgY = (clientY - rect.top)  / rect.height * nativeH
  //
  // getBrushRadiusInImagePixels() → r
  //   brushSize is a radius in "screen pixels at zoom=1".
  //   At any zoom, screen-px radius = brushSize * zoom.
  //   rect.width = displayDims.w * zoom  (getBoundingClientRect includes transforms)
  //   r = (brushSize * zoom) * nativeW / rect.width
  //     = (brushSize * zoom) * nativeW / (displayDims.w * zoom)
  //     = brushSize * nativeW / displayDims.w   (zoom-invariant image-pixel radius)
  //
  // Cursor ring on screen:
  //   diameter = brushSize * 2 * zoom   (matches exactly what getImageCoords paints)
  // ────────────────────────────────────────────────────────────────────────────

  // Returns image pixel coordinates + brush radius for a viewport point.
  // Returns null if the image element is not mounted or has zero size.
  const getImageCoords = useCallback((clientX: number, clientY: number): {imgX:number;imgY:number;brushRadiusPx:number}|null => {
    if (!nativeSize||!imgRef.current) return null;
    const rect=imgRef.current.getBoundingClientRect();
    if (rect.width===0||rect.height===0) return null;

    // Map viewport → native canvas coordinates
    const imgX=(clientX-rect.left)/rect.width *nativeSize.w;
    const imgY=(clientY-rect.top) /rect.height*nativeSize.h;

    // brushSize (screen-px at zoom=1) → image pixels
    // rect.width already includes zoom, so dividing by rect.width * (nativeW / nativeW) collapses
    const brushRadiusPx=brushSizeRef.current*nativeSize.w/displayDimsRef.current!.w;

    return {imgX,imgY,brushRadiusPx};
  },[nativeSize]);

  // ── NEW BRUSH ENGINE — Core stamp ───────────────────────────────────────────
  //
  // Works ENTIRELY on workingDataRef (in-memory Uint8ClampedArray).
  // No getImageData / putImageData per stamp — only one putImageData per rAF.
  //
  // Brush shape: hard circular mask with a 1-pixel anti-aliased border
  //   dist ≤ r-0.5        → fully applied (alpha=1)
  //   r-0.5 < dist ≤ r+0.5 → anti-aliased edge (alpha = r+0.5-dist)
  //   dist > r+0.5        → not touched
  //
  // This gives a crisp, pixel-perfect circle with no soft bloat.
  // Selection mask is respected: pixels outside the selection are never touched.
  // ────────────────────────────────────────────────────────────────────────────

  const stampBrush = useCallback((imgX: number, imgY: number, brushRadiusPx: number, mode: "erase"|"restore")=>{
    const wd=workingDataRef.current;
    const orig=trueOriginalRef.current;
    if (!wd||!nativeSize) return;
    if (mode==="restore"&&!orig) return;

    const cw=nativeSize.w, ch=nativeSize.h;
    const mask=selectionMaskRef.current;
    const r=brushRadiusPx;
    const rOuter=r+0.5;

    // Bounding box of the stamp
    const x0=Math.max(0,Math.floor(imgX-rOuter));
    const y0=Math.max(0,Math.floor(imgY-rOuter));
    const x1=Math.min(cw-1,Math.ceil(imgX+rOuter));
    const y1=Math.min(ch-1,Math.ceil(imgY+rOuter));
    if (x1<x0||y1<y0) return;

    const data=wd.data;

    for (let py=y0;py<=y1;py++) {
      for (let px=x0;px<=x1;px++) {
        // 1. Selection boundary — never touch pixels outside active selection
        if (mask&&!mask[py*cw+px]) continue;

        // 2. Circular distance check with anti-aliased 1px border
        const dx=px-imgX, dy=py-imgY;
        const dist=Math.sqrt(dx*dx+dy*dy);
        if (dist>rOuter) continue;

        // Brush opacity: 1 inside (dist ≤ r-0.5), linear falloff in 1px border zone
        const alpha=Math.min(1,rOuter-dist);

        const i=(py*cw+px)*4;

        if (mode==="erase") {
          // Reduce alpha channel — blends with existing alpha for smooth repeated strokes
          const newA=Math.round(data[i+3]*(1-alpha));
          data[i+3]=Math.max(0,newA);
        } else {
          // Restore: blend toward true original pixel
          if (!orig) continue;
          const oi=(py*orig.width+px)*4;
          if (px>=orig.width||py>=orig.height) continue;
          data[i]  =Math.round(data[i]  +(orig.data[oi]  -data[i]  )*alpha);
          data[i+1]=Math.round(data[i+1]+(orig.data[oi+1]-data[i+1])*alpha);
          data[i+2]=Math.round(data[i+2]+(orig.data[oi+2]-data[i+2])*alpha);
          data[i+3]=Math.round(data[i+3]+(orig.data[oi+3]-data[i+3])*alpha);
        }
      }
    }

    strokeDirty.current=true;
    scheduleBrushFlush();
  },[nativeSize,scheduleBrushFlush]);

  // Interpolate strokes so fast drags have no gaps
  const interpolateStroke = useCallback((
    fromX: number, fromY: number,
    toX:   number, toY:   number,
    brushRadiusPx: number,
    mode: "erase"|"restore",
  )=>{
    const dx=toX-fromX, dy=toY-fromY;
    const dist=Math.sqrt(dx*dx+dy*dy);
    // Step spacing: 30% of brush radius (fine-grained fills without over-blending)
    const step=Math.max(1,brushRadiusPx*0.3);
    const steps=Math.ceil(dist/step);
    for (let i=1;i<=steps;i++) {
      const t=i/steps;
      stampBrush(fromX+dx*t,fromY+dy*t,brushRadiusPx,mode);
    }
  },[stampBrush]);

  // ── Fuzzy select ─────────────────────────────────────────────────────────────

  const handleFuzzySelect = useCallback((imgX: number, imgY: number)=>{
    const c=canvasRef.current; if (!c) return;
    const ctx=c.getContext("2d"); if (!ctx) return;
    setProcessing(true);
    setTimeout(()=>{
      const id=ctx.getImageData(0,0,c.width,c.height);
      const px=Math.floor(Math.max(0,Math.min(c.width-1,imgX)));
      const py=Math.floor(Math.max(0,Math.min(c.height-1,imgY)));
      const maskResult=fuzzySelectRegion(id,px,py,55,70);
      setSelectionMask(maskResult);
      setProcessing(false);
    },0);
  },[]);

  // ── Selection actions ────────────────────────────────────────────────────────

  const handleDelete = useCallback(()=>{
    if (!selectionMask) return;
    const c=canvasRef.current; if (!c) return;
    const ctx=c.getContext("2d"); if (!ctx) return;
    setProcessing(true);
    saveUndo();
    setTimeout(()=>{
      const id=ctx.getImageData(0,0,c.width,c.height);
      const result=applyMaskDeletion(id,selectionMask);
      ctx.putImageData(result,0,0);
      // Sync working buffer after external canvas modification
      workingDataRef.current=new ImageData(new Uint8ClampedArray(result.data),result.width,result.height);
      updateDisplay();
      setSelectionMask(null);
      setProcessing(false);
    },0);
  },[selectionMask,saveUndo,updateDisplay]);

  const handleChangeColor = useCallback((color: string)=>{
    if (!selectionMask) return;
    const c=canvasRef.current; if (!c) return;
    const ctx=c.getContext("2d"); if (!ctx) return;
    setProcessing(true);
    saveUndo();
    setTimeout(()=>{
      const id=ctx.getImageData(0,0,c.width,c.height);
      const result=applyMaskRecolor(id,selectionMask,color);
      ctx.putImageData(result,0,0);
      workingDataRef.current=new ImageData(new Uint8ClampedArray(result.data),result.width,result.height);
      updateDisplay();
      setSelectionMask(null);
      setProcessing(false);
    },0);
  },[selectionMask,saveUndo,updateDisplay]);

  const handleClearSelection = useCallback(()=>{ setSelectionMask(null); },[]);

  // ── Mouse events ────────────────────────────────────────────────────────────

  const onMouseDown = useCallback((e: React.MouseEvent<HTMLElement>)=>{
    if (!loaded||!nativeSize) return;
    const mode=toolModeRef.current;

    if (mode==="select") {
      const pt=getImageCoords(e.clientX,e.clientY);
      if (!pt) return;
      handleFuzzySelect(pt.imgX,pt.imgY);
      return;
    }

    if (mode==="restore"||mode==="erase") {
      const pt=getImageCoords(e.clientX,e.clientY);
      if (!pt) return;
      // Ensure working buffer is fresh before starting stroke
      syncBufferFromCanvas();
      saveUndo();
      isPainting.current=true;
      lastStrokePoint.current=null;
      stampBrush(pt.imgX,pt.imgY,pt.brushRadiusPx,mode);
      lastStrokePoint.current={imgX:pt.imgX,imgY:pt.imgY};
      return;
    }

    isMoving.current=true;
    moveStartRef.current={pointerX:e.clientX,pointerY:e.clientY,panX:panRef.current.x,panY:panRef.current.y};
  },[loaded,nativeSize,getImageCoords,handleFuzzySelect,syncBufferFromCanvas,saveUndo,stampBrush]);

  const onMouseMove = useCallback((e: React.MouseEvent<HTMLElement>)=>{
    const mode=toolModeRef.current;

    if (mode==="restore"||mode==="erase") {
      // Always update cursor ring position
      setCursorClient({x:e.clientX,y:e.clientY,visible:true});

      if (isPainting.current) {
        const pt=getImageCoords(e.clientX,e.clientY);
        if (!pt) return;
        const last=lastStrokePoint.current;
        if (last) {
          interpolateStroke(last.imgX,last.imgY,pt.imgX,pt.imgY,pt.brushRadiusPx,mode);
        } else {
          stampBrush(pt.imgX,pt.imgY,pt.brushRadiusPx,mode);
        }
        lastStrokePoint.current={imgX:pt.imgX,imgY:pt.imgY};
      }
      return;
    }

    setCursorClient(c=>({...c,visible:false}));

    if (isMoving.current&&moveStartRef.current) {
      const s=moveStartRef.current;
      setPan({x:s.panX+e.clientX-s.pointerX,y:s.panY+e.clientY-s.pointerY});
    }
  },[getImageCoords,interpolateStroke,stampBrush]);

  const onMouseUp = useCallback(()=>{
    if (isPainting.current&&strokeDirty.current) {
      // Cancel pending rAF flush and do it synchronously so the stroke is committed
      if (rafFlushRef.current) { cancelAnimationFrame(rafFlushRef.current); rafFlushRef.current=null; }
      flushBufferToCanvas();
    }
    isPainting.current=false;
    lastStrokePoint.current=null;
    isMoving.current=false;
    moveStartRef.current=null;
  },[flushBufferToCanvas]);

  const onMouseLeave = useCallback(()=>{
    setCursorClient(c=>({...c,visible:false}));
    onMouseUp();
  },[onMouseUp]);

  // ── Confirm ─────────────────────────────────────────────────────────────────

  const handleConfirm = useCallback(()=>{
    const c=canvasRef.current; if (!c) return;
    const bounds=getAlphaBounds(c);
    trimRef.current=bounds
      ?{originalWidth:c.width,originalHeight:c.height,x:bounds.x,y:bounds.y,width:bounds.width,height:bounds.height}
      :{originalWidth:c.width,originalHeight:c.height,x:0,y:0,width:c.width,height:c.height};
    const trimmed=trimTransparency(c).canvas;
    const enhanced=enhanceCanvas(trimmed,qualityScale);
    enhanced.toBlob(b=>{ if (b) onConfirm(b,trimRef.current!); },"image/png");
  },[qualityScale,onConfirm]);

  // ── Derived display values ───────────────────────────────────────────────────

  const canTransform=zoom!==1||pan.x!==0||pan.y!==0?`matrix(${zoom},0,0,${zoom},${pan.x},${pan.y})`:undefined;
  const canUndo=undoRef.current.length>0;
  const canRedo=redoRef.current.length>0;
  const bgStyle:React.CSSProperties=bgPreview==="checker"?CHECKER_STYLE:bgPreview==="white"?{backgroundColor:"#fff"}:{backgroundColor:"#111"};

  const canvasCursor=
    toolMode==="select"                       ?"crosshair":
    toolMode==="restore"||toolMode==="erase"  ?"none":
    selectionMask                             ?"default":"grab";

  // Brush ring diameter in screen pixels:
  //   brushSize (radius at zoom=1) * zoom * 2
  // This matches exactly what getImageCoords will paint — verified by algebra above.
  const brushRingDiameter=brushSize*2*zoom;
  const brushRingColor=toolMode==="erase"?"rgba(239,68,68,0.95)":"rgba(34,197,94,0.95)";

  const handleSetToolMode = useCallback((mode: ToolMode)=>{
    setToolMode(prev=>{
      if (prev===mode) { setSelectionMask(null); return null; }
      if (mode==="select") { setSelectionMask(null); }
      if (mode===null) { setSelectionMask(null); }
      return mode;
    });
    setCursorClient(c=>({...c,visible:false}));
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
            <button onClick={doRedo} disabled={!canRedo} title="Redo"
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

          {/* Tool hints */}
          {toolMode==="select" && !selectionMask && loaded && !processing && (
            <div className="absolute bottom-5 left-1/2 -translate-x-1/2 pointer-events-none">
              <div className="flex items-center gap-2 px-4 py-2 rounded-full text-[11px] font-bold"
                style={{backgroundColor:"rgba(0,0,0,0.7)",border:"1px solid rgba(168,85,247,0.4)",color:"rgba(196,140,255,0.9)",backdropFilter:"blur(8px)"}}>
                <span style={{color:"#a855f7"}}>✦</span> Click anywhere on your image to select
              </div>
            </div>
          )}
          {(toolMode==="restore"||toolMode==="erase") && loaded && !processing && (
            <div className="absolute bottom-5 left-1/2 -translate-x-1/2 pointer-events-none">
              <div className="flex items-center gap-2 px-4 py-2 rounded-full text-[11px] font-bold"
                style={{
                  backgroundColor:"rgba(0,0,0,0.7)",
                  border:`1px solid ${toolMode==="erase"?"rgba(239,68,68,0.4)":"rgba(34,197,94,0.4)"}`,
                  color:toolMode==="erase"?"rgba(252,165,165,0.9)":"rgba(134,239,172,0.9)",
                  backdropFilter:"blur(8px)",
                }}>
                {toolMode==="erase"?"✕ Click and drag to erase":"↩ Click and drag to restore"}
              </div>
            </div>
          )}

          {/*
            ── Brush cursor ring ──
            Positioned at the exact viewport location of the cursor (position:fixed).
            Diameter = brushSize * 2 * zoom, which matches the image pixels painted
            by getImageCoords exactly (see coordinate system comment above).
            A thin inner crosshair indicates the center for sub-pixel precision.
          */}
          {cursorClient.visible && (toolMode==="restore"||toolMode==="erase") && brushRingDiameter>0 && (
            <div
              style={{
                position:"fixed",
                left:cursorClient.x,
                top:cursorClient.y,
                width:brushRingDiameter,
                height:brushRingDiameter,
                transform:"translate(-50%,-50%)",
                borderRadius:"9999px",
                border:`1.5px solid ${brushRingColor}`,
                boxShadow:"0 0 0 1px rgba(0,0,0,0.7)",
                pointerEvents:"none",
                zIndex:9999,
              }}
            >
              {/* Center crosshair dot */}
              <div style={{
                position:"absolute",
                left:"50%",top:"50%",
                width:2,height:2,
                transform:"translate(-50%,-50%)",
                backgroundColor:brushRingColor,
                borderRadius:"9999px",
              }}/>
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
            onClearSelection={handleClearSelection}
            brushSize={brushSize}
            onBrushSize={setBrushSize}
          />
        </div>
      </div>
    </div>
  );
}
