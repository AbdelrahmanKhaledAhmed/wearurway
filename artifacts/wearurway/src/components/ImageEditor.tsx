import { useState, useRef, useEffect, useCallback, useMemo } from "react";
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
  showBgHint?: boolean;
}

interface CanvasSnapshot {
  width: number; height: number;
  data: ImageData; trim: ImageEditResult | null;
}

interface AlphaBounds { x: number; y: number; width: number; height: number }

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

function gaussianBlurRGB(src: Uint8ClampedArray, w: number, h: number): Uint8ClampedArray {
  const K=[0.06136,0.24477,0.38774,0.24477,0.06136];
  const tmp=new Float32Array(w*h*4);
  const out=new Uint8ClampedArray(src.length);
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
  }
  return new ImageData(dst,w,h);
}

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
  const TARGET_LONG=4096, MAX_SIDE=4096, MAX_AUTO_SCALE=8;
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

export default function ImageEditor({ file, onConfirm, onCancel, qualityScale=1, showBgHint=false }: Props) {
  const [currentFile, setCurrentFile] = useState<File>(file);
  useEffect(()=>{ setCurrentFile(file); },[file]);
  const [showHelpWizard, setShowHelpWizard] = useState(false);
  const [showBgOnboarding, setShowBgOnboarding] = useState(showBgHint);
  const { data: orderSettings } = useGetOrderSettings();
  const contactWhatsappHref = `https://wa.me/20${(orderSettings?.contactPhone || orderSettings?.instaPayPhone || "01069383482").replace(/^0/, "")}`;
  const canvasRef        = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef           = useRef<HTMLImageElement>(null);
  const areaRef          = useRef<HTMLDivElement>(null);

  const isMoving         = useRef(false);
  const moveStartRef     = useRef<{pointerX:number;pointerY:number;panX:number;panY:number}|null>(null);
  const pinchEditorRef   = useRef<{dist:number;midX:number;midY:number}|null>(null);

  const undoRef          = useRef<CanvasSnapshot[]>([]);
  const redoRef          = useRef<CanvasSnapshot[]>([]);
  const trimRef          = useRef<ImageEditResult|null>(null);
  const recolorBaseRef   = useRef<ImageData|null>(null);
  const panRef           = useRef({x:0,y:0});
  const zoomRef          = useRef(1);
  const displayDimsRef   = useRef<{w:number;h:number}|null>(null);
  const rafDisplayRef    = useRef<number|null>(null);
  const baseOverlayRef   = useRef<Uint8ClampedArray|null>(null);
  const borderPixelsRef  = useRef<{idx:number;x:number;y:number}[]>([]);
  const animFrameRef     = useRef<number|null>(null);
  const lastSelectPointRef  = useRef<{px:number;py:number}|null>(null);
  const selectDebounceRef   = useRef<ReturnType<typeof setTimeout>|null>(null);

  // ── Touch gesture refs ───────────────────────────────────────────────────────
  // gestureSessionRef tracks the state of the current touch session:
  //   "idle"   — no fingers down, ready for a clean tap
  //   "tap"    — exactly one finger down, no pinch yet
  //   "pinch"  — two or more fingers were involved; block select for entire session
  const gestureSessionRef  = useRef<"idle"|"tap"|"pinch">("idle");
  const tapStartPosRef     = useRef<{x:number;y:number}|null>(null);
  const pinchHappenedRef   = useRef(false);
  const lastPinchEndTimeRef = useRef<number>(0);
  const lastTouchTimeRef = useRef<number>(0);

  const [bgPreview,     setBgPreview]     = useState<BgPreview>("checker");
  const [processing,    setProcessing]    = useState(false);
  const [loaded,        setLoaded]        = useState(false);
  const [zoom,          setZoom]          = useState(1);
  const [pan,           setPan]           = useState({x:0,y:0});
  const [nativeSize,    setNativeSize]    = useState<{w:number;h:number}|null>(null);
  const [histSig,       setHistSig]       = useState(0);
  const [displaySrc,    setDisplaySrc]    = useState("");
  const [toolMode,      setToolMode]      = useState<ToolMode>("select");
  const [selectionMask, setSelectionMask] = useState<Uint8Array|null>(null);
  const [availArea,     setAvailArea]     = useState<{w:number;h:number}|null>(null);
  const [sensitivity,   setSensitivity]   = useState(40);
  void histSig;

  useEffect(()=>{ panRef.current=pan; },[pan]);
  useEffect(()=>{ zoomRef.current=zoom; },[zoom]);

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

  const updateDisplay = useCallback(()=>{
    const c=canvasRef.current; if (!c) return;
    setDisplaySrc(c.toDataURL("image/png"));
  },[]);

  const scheduleDisplay = useCallback(()=>{
    if (rafDisplayRef.current) return;
    rafDisplayRef.current=requestAnimationFrame(()=>{ rafDisplayRef.current=null; updateDisplay(); });
  },[updateDisplay]);
  void scheduleDisplay;

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

  useEffect(()=>{
    const h=(e: KeyboardEvent)=>{
      const key=e.key.toLowerCase();
      if ((e.ctrlKey||e.metaKey)&&!e.shiftKey&&key==="z") {
        e.preventDefault(); e.stopPropagation(); doUndo(); return;
      }
      if ((e.ctrlKey||e.metaKey)&&!e.shiftKey&&key==="y") {
        e.preventDefault(); e.stopPropagation(); doRedo(); return;
      }
      if ((e.ctrlKey||e.metaKey)&&e.shiftKey&&key==="z") {
        e.preventDefault(); e.stopPropagation(); doRedo(); return;
      }
      if (e.key==="Escape") setSelectionMask(null);
    };
    window.addEventListener("keydown",h,{capture:true});
    return ()=>window.removeEventListener("keydown",h,{capture:true});
  },[doUndo,doRedo]);

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

  const getImageCoords = useCallback((clientX: number, clientY: number): {imgX:number;imgY:number}|null=>{
    if (!nativeSize||!imgRef.current) return null;
    const rect=imgRef.current.getBoundingClientRect();
    if (rect.width===0||rect.height===0) return null;
    return {
      imgX:(clientX-rect.left)/rect.width *nativeSize.w,
      imgY:(clientY-rect.top) /rect.height*nativeSize.h,
    };
  },[nativeSize]);

  const tolerancesFromSensitivity = useCallback((s: number)=>{
    const t=s/100;
    return {colorTol:Math.round(5+t*125), edgeTol:Math.round(15+t*155)};
  },[]);

  const runFuzzySelect = useCallback((px: number, py: number, sens: number)=>{
    const c=canvasRef.current; if (!c) return;
    const ctx=c.getContext("2d"); if (!ctx) return;
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
      saveUndo();
      const deleted=applyMaskDeletion(id,maskResult);
      ctx.putImageData(deleted,0,0);
      updateDisplay();
      setSelectionMask(null);
      lastSelectPointRef.current=null;
      setProcessing(false);
    },0);
  },[tolerancesFromSensitivity,saveUndo,updateDisplay]);

  const handleFuzzySelect = useCallback((imgX: number, imgY: number)=>{
    const c=canvasRef.current; if (!c) return;
    const px=Math.floor(Math.max(0,Math.min(c.width-1,imgX)));
    const py=Math.floor(Math.max(0,Math.min(c.height-1,imgY)));
    lastSelectPointRef.current={px,py};
    runFuzzySelect(px,py,sensitivity);
  },[sensitivity,runFuzzySelect]);

  useEffect(()=>{
    const pt=lastSelectPointRef.current;
    if (!pt) return;
    if (selectDebounceRef.current) clearTimeout(selectDebounceRef.current);
    selectDebounceRef.current=setTimeout(()=>{
      selectDebounceRef.current=null;
      runFuzzySelect(pt.px,pt.py,sensitivity);
    },60);
    return ()=>{ if (selectDebounceRef.current) clearTimeout(selectDebounceRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[sensitivity]);

  const handleDelete = useCallback(()=>{
    if (!selectionMask) return;
    const c=canvasRef.current; if (!c) return;
    const ctx=c.getContext("2d"); if (!ctx) return;
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
    const baseSnapshot=recolorBaseRef.current ?? ctx.getImageData(0,0,c.width,c.height);
    undoRef.current=[...undoRef.current.slice(-19),{
      width:c.width,height:c.height,data:baseSnapshot,trim:trimRef.current,
    }];
    redoRef.current=[];
    setHistSig(h=>h+1);
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

  const onMouseDown = useCallback((e: React.MouseEvent<HTMLElement>)=>{
    if (Date.now() - lastTouchTimeRef.current < 500) return;
    if (!loaded||!nativeSize) return;
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

  const onContextMenu = useCallback((e: React.MouseEvent<HTMLElement>)=>{
    e.preventDefault();
  },[]);

  // ── Touch events ────────────────────────────────────────────────────────────
  // Uses a gesture session state machine:
  //   "idle"  → no fingers on screen
  //   "tap"   → exactly 1 finger, no pinch yet this session
  //   "pinch" → 2+ fingers touched at any point this session; select is BLOCKED
  //
  // The session only resets to "idle" when ALL fingers leave the screen.
  // This prevents the first-finger-down after a pinch from being recorded
  // as a new tap start before the session fully ends.

  const onTouchStartEditor = useCallback((e: React.TouchEvent<HTMLElement>)=>{
    if (!loaded||!nativeSize) return;

    if (e.touches.length>=2) {
      // Two or more fingers — mark this entire session as a pinch
      gestureSessionRef.current="pinch";
      tapStartPosRef.current=null;
      isMoving.current=false;
      moveStartRef.current=null;
      const dx=e.touches[0].clientX-e.touches[1].clientX;
      const dy=e.touches[0].clientY-e.touches[1].clientY;
      const midX=(e.touches[0].clientX+e.touches[1].clientX)/2;
      const midY=(e.touches[0].clientY+e.touches[1].clientY)/2;
      pinchEditorRef.current={dist:Math.sqrt(dx*dx+dy*dy),midX,midY};
      pinchHappenedRef.current=true;
      return;
    }

    if (e.touches.length===1) {
      // Only register a tap-start if session is truly idle (no pinch contamination)
      if (gestureSessionRef.current==="pinch") {
        return;
      }
      const touch=e.touches[0];
      gestureSessionRef.current="tap";
      const inPinchCooldown = Date.now() - lastPinchEndTimeRef.current < 350;
      if (toolMode==="select" && !inPinchCooldown) {
        tapStartPosRef.current={x:touch.clientX,y:touch.clientY};
      }
      isMoving.current=true;
      moveStartRef.current={pointerX:touch.clientX,pointerY:touch.clientY,panX:panRef.current.x,panY:panRef.current.y};
    }
  },[loaded,nativeSize,toolMode]);

  const onTouchMoveEditor = useCallback((e: React.TouchEvent<HTMLElement>)=>{
    e.preventDefault();
    
    // If we suddenly have 2+ touches and were in "tap" mode, transition to "pinch"
    // (some browsers don't fire touchstart when the 2nd finger is added during a move)
    if (e.touches.length>=2 && gestureSessionRef.current==="tap") {
      gestureSessionRef.current="pinch";
      tapStartPosRef.current=null;
      pinchEditorRef.current=null;
      pinchHappenedRef.current=true;
      const dx=e.touches[0].clientX-e.touches[1].clientX;
      const dy=e.touches[0].clientY-e.touches[1].clientY;
      const midX=(e.touches[0].clientX+e.touches[1].clientX)/2;
      const midY=(e.touches[0].clientY+e.touches[1].clientY)/2;
      pinchEditorRef.current={dist:Math.sqrt(dx*dx+dy*dy),midX,midY};
      isMoving.current=false;
      moveStartRef.current=null;
    }
    
    if (e.touches.length===1 && isMoving.current && moveStartRef.current) {
      const touch=e.touches[0];
      const s=moveStartRef.current;
      setPan({x:s.panX+touch.clientX-s.pointerX,y:s.panY+touch.clientY-s.pointerY});
    } else if (e.touches.length===2 && pinchEditorRef.current!==null) {
      const dx=e.touches[0].clientX-e.touches[1].clientX;
      const dy=e.touches[0].clientY-e.touches[1].clientY;
      const newDist=Math.sqrt(dx*dx+dy*dy);
      const scale=newDist/pinchEditorRef.current.dist;
      const cx=(e.touches[0].clientX+e.touches[1].clientX)/2;
      const cy=(e.touches[0].clientY+e.touches[1].clientY)/2;
      const mdx=cx-pinchEditorRef.current.midX;
      const mdy=cy-pinchEditorRef.current.midY;
      pinchEditorRef.current={dist:newDist,midX:cx,midY:cy};
      setPan(p=>({x:p.x+mdx,y:p.y+mdy}));
      const el=areaRef.current;
      if (el) {
        const rect=el.getBoundingClientRect();
        applyZoom(zoomRef.current*scale,(cx-rect.left)/rect.width,(cy-rect.top)/rect.height);
      } else {
        applyZoom(zoomRef.current*scale);
      }
    }
  },[applyZoom]);

  const onTouchEndEditor = useCallback((e: React.TouchEvent<HTMLElement>)=>{
    // 2→1 finger: one finger lifted during a pinch — hand off to single-finger pan immediately
    if (e.touches.length === 1 && gestureSessionRef.current === "pinch") {
      const touch = e.touches[0];
      pinchEditorRef.current = null;
      isMoving.current = true;
      moveStartRef.current = {
        pointerX: touch.clientX,
        pointerY: touch.clientY,
        panX: panRef.current.x,
        panY: panRef.current.y,
      };
      return;
    }
    // Only act when ALL fingers are fully off the screen
    if (e.touches.length===0) {
      // Fire select only if this was a clean single-finger tap session
      if (
        gestureSessionRef.current==="tap" &&
        !pinchHappenedRef.current &&
        toolMode==="select" &&
        tapStartPosRef.current &&
        e.changedTouches.length===1
      ) {
        const touch=e.changedTouches[0];
        const dx=touch.clientX-tapStartPosRef.current.x;
        const dy=touch.clientY-tapStartPosRef.current.y;
        const dist=Math.sqrt(dx*dx+dy*dy);
        if (dist<12) {
          const pt=getImageCoords(touch.clientX,touch.clientY);
          if (pt) handleFuzzySelect(pt.imgX,pt.imgY);
        }
      }
      // Reset everything — session is fully over
      if (pinchHappenedRef.current) {
        lastPinchEndTimeRef.current = Date.now();
      }
      lastTouchTimeRef.current = Date.now();
      gestureSessionRef.current="idle";
      tapStartPosRef.current=null;
      isMoving.current=false;
      moveStartRef.current=null;
      pinchEditorRef.current=null;
      pinchHappenedRef.current=false;
    }
  },[toolMode,getImageCoords,handleFuzzySelect]);

  const handleConfirm = useCallback(()=>{
    const c=canvasRef.current; if (!c) return;
    const bounds=getAlphaBounds(c);
    trimRef.current=bounds
      ?{originalWidth:c.width,originalHeight:c.height,x:bounds.x,y:bounds.y,width:bounds.width,height:bounds.height}
      :{originalWidth:c.width,originalHeight:c.height,x:0,y:0,width:c.width,height:c.height};
    setProcessing(true);
    setTimeout(async ()=>{
      try {
        const trimmed=trimTransparency(c).canvas;
        const enhanced=await enhanceCanvas(trimmed,qualityScale);
        enhanced.toBlob(b=>{
          if (b) {
            setProcessing(false);
            onConfirm(b,trimRef.current!);
          } else {
            trimmed.toBlob(b2=>{
              setProcessing(false);
              if (b2) onConfirm(b2,trimRef.current!);
            },"image/png");
          }
        },"image/png");
      } catch {
        setProcessing(false);
        c.toBlob(b=>{
          if (b) onConfirm(b,trimRef.current!);
        },"image/png");
      }
    },30);
  },[qualityScale,onConfirm]);

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

  return (
    <div className="fixed inset-0 z-[100] flex flex-col" style={{backgroundColor:"#141414"}}>

      <div className="flex items-center justify-between px-3 md:px-5 h-14 border-b shrink-0" style={{borderColor:"rgba(255,255,255,0.08)"}}>
        <div className="flex items-center gap-2 md:gap-4">
          <div className="hidden md:flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full" style={{backgroundColor:"#a855f7"}}/>
            <span className="text-[11px] font-black uppercase tracking-[0.25em] text-white">Image Editor</span>
          </div>
          <div className="flex items-center gap-0.5 md:gap-1">
            <button onClick={doUndo} disabled={!canUndo} title="Undo (Ctrl+Z)"
              className="flex items-center gap-1 md:gap-1.5 px-2 md:px-3 py-1.5 rounded text-white/50 hover:text-white hover:bg-white/8 disabled:opacity-25 transition-all text-[11px] font-bold uppercase tracking-widest">
              <UndoIcon/> <span className="hidden md:inline">Undo</span>
            </button>
            <button onClick={doRedo} disabled={!canRedo} title="Redo (Ctrl+Y)"
              className="flex items-center gap-1 md:gap-1.5 px-2 md:px-3 py-1.5 rounded text-white/50 hover:text-white hover:bg-white/8 disabled:opacity-25 transition-all text-[11px] font-bold uppercase tracking-widest">
              <span className="hidden md:inline">Redo</span> <RedoIcon/>
            </button>
          </div>
        </div>
        <div className="flex items-center gap-1.5 md:gap-2">
          <div className="hidden md:flex items-center gap-1 mr-2">
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
          {selectionMask && (
            <div className="md:hidden flex items-center gap-1">
              <button
                onClick={handleDelete}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wide active:scale-95 transition-all"
                style={{background:"linear-gradient(135deg,#ef4444,#dc2626)",color:"#fff"}}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{width:11,height:11}}>
                  <path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>
                  <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
                </svg>
                Remove
              </button>
              <button
                onClick={handleClearSelection}
                className="px-2 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wide active:scale-95 transition-all"
                style={{backgroundColor:"rgba(255,255,255,0.08)",border:"1px solid rgba(255,255,255,0.15)",color:"rgba(255,255,255,0.55)"}}>
                ×&nbsp;Clear
              </button>
            </div>
          )}
          <button onClick={onCancel}
            className="px-3 md:px-4 py-2 rounded-lg text-[11px] font-bold uppercase tracking-widest text-white/40 hover:text-white/70 hover:bg-white/8 transition-all">
            Cancel
          </button>
          <button onClick={handleConfirm}
            className="px-4 md:px-5 py-2 rounded-lg text-[11px] font-black uppercase tracking-widest transition-all hover:scale-105 active:scale-95"
            style={{background:"linear-gradient(135deg,#a855f7,#7c3aed)",color:"#fff"}}>
            Apply →
          </button>
        </div>
      </div>

      <div className="flex flex-1 min-h-0 flex-col md:flex-row">

        <div
          ref={areaRef}
          className="flex-1 flex items-center justify-center relative overflow-hidden select-none min-h-0"
          style={{...bgStyle,cursor:canvasCursor,touchAction:"none"}}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseLeave}
          onContextMenu={onContextMenu}
          onWheel={onWheel}
          onTouchStart={onTouchStartEditor}
          onTouchMove={onTouchMoveEditor}
          onTouchEnd={onTouchEndEditor}
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


          <canvas ref={canvasRef} style={{display:"none"}}/>
        </div>

        <div
  className="flex md:flex w-full md:w-72 border-t md:border-t-0 md:border-l flex-col shrink-0"
  style={{ borderColor: "rgba(168,85,247,0.2)", backgroundColor: "#141414" }}
>
  {/* Need Help button */}
  <button
    onClick={() => setShowHelpWizard(true)}
    className="flex items-center gap-3 px-4 py-3 w-full text-left transition-opacity hover:opacity-90 active:opacity-75"
    style={{ backgroundColor: "#a855f7", color: "#fff" }}
  >
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 flex-shrink-0">
      <path d="M12 0C5.373 0 0 5.373 0 12c0 5.084 3.163 9.426 7.627 11.174-.105-.949-.2-2.405.042-3.441.218-.937 1.407-5.965 1.407-5.965s-.359-.719-.359-1.782c0-1.668.967-2.914 2.171-2.914 1.023 0 1.518.769 1.518 1.69 0 1.029-.655 2.568-.994 3.995-.283 1.194.599 2.169 1.777 2.169 2.133 0 3.772-2.249 3.772-5.495 0-2.873-2.064-4.882-5.012-4.882-3.414 0-5.418 2.561-5.418 5.207 0 1.031.397 2.138.893 2.738a.36.36 0 0 1 .083.345l-.333 1.36c-.053.22-.174.267-.402.161-1.499-.698-2.436-2.889-2.436-4.649 0-3.785 2.75-7.262 7.929-7.262 4.163 0 7.398 2.967 7.398 6.931 0 4.136-2.607 7.464-6.227 7.464-1.216 0-2.359-.632-2.75-1.378l-.748 2.853c-.271 1.043-1.002 2.35-1.492 3.146C9.57 23.812 10.763 24 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0z" />
    </svg>
    <span className="text-[11px] font-semibold leading-snug">
      Need help?{" "}
      <span className="font-black">We'll turn your photo into exactly what you imagine.</span>
    </span>
  </button>

  {/* Sensitivity slider */}
  <div className="flex flex-col gap-3 px-5 py-5">
    <span className="text-[10px] font-black uppercase tracking-[0.25em]" style={{ color: "rgba(255,255,255,0.35)" }}>
      How much to remove
    </span>
    <input
      type="range"
      min={0}
      max={100}
      value={sensitivity}
      onChange={e => setSensitivity(Number(e.target.value))}
      className="w-full accent-purple-500"
      style={{ accentColor: "#a855f7" }}
    />
    <div className="flex justify-between text-[10px] font-bold uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.35)" }}>
      <span>A little</span>
      <span>Normal</span>
      <span>A lot</span>
    </div>
  </div>
</div>
      </div>  {/* ← closes "flex flex-1 min-h-0 flex-col md:flex-row" */}

      {showBgOnboarding && (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center p-4"
          style={{ backgroundColor: "rgba(0,0,0,0.82)", backdropFilter: "blur(8px)" }}
        >
          <div
            className="w-full max-w-sm rounded-3xl p-7 text-center"
            style={{
              background: "linear-gradient(135deg,rgba(20,10,40,0.99),rgba(10,5,25,0.99))",
              border: "1px solid rgba(168,85,247,0.5)",
              boxShadow: "0 24px 64px rgba(124,58,237,0.5)",
            }}
          >
            <h2 className="text-[20px] font-black text-white mb-3">
              Tap the background to remove it
            </h2>
            <p className="text-[12px] mb-6" style={{ color: "rgba(255,255,255,0.5)" }}>
              Tap multiple times to remove more areas. Use Undo to go back.
            </p>
            <button
              onClick={() => setShowBgOnboarding(false)}
              className="w-full py-4 rounded-2xl text-[13px] font-black uppercase tracking-widest transition-all hover:scale-[1.02] active:scale-[0.98]"
              style={{ background: "linear-gradient(135deg,#a855f7,#7c3aed)", color: "#fff" }}
            >
              Got it
            </button>
          </div>
        </div>
      )}

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
