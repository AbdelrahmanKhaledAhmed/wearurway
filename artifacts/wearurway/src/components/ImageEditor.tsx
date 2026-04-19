import { useState, useRef, useEffect, useCallback } from "react";
import AIAssistPanel, { type ImageAdjustments } from "./AIAssistPanel";

type RefineMode = "erase" | "restore" | null;
type BgPreview  = "checker" | "white" | "black";

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

// ─── Pixel helpers ─────────────────────────────────────────────────────────────

function getColorAt(d: Uint8ClampedArray, x: number, y: number, w: number): [number,number,number,number] {
  const i=(y*w+x)*4; return [d[i],d[i+1],d[i+2],d[i+3]];
}
function colorDist(a: [number,number,number,number], b: [number,number,number,number]) {
  return Math.sqrt((a[0]-b[0])**2+(a[1]-b[1])**2+(a[2]-b[2])**2);
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
  const queue=[sy*w+sx]; processed[sy*w+sx]=1;
  while (queue.length) {
    const idx=queue.pop()!;
    const x=idx%w, y=Math.floor(idx/w);
    if (d[idx*4+3]===0) continue;
    if (colorDist(getColorAt(d,x,y,w),seed)>colorTol) continue;
    mask[idx]=1;
    for (const [nx,ny] of [[x+1,y],[x-1,y],[x,y+1],[x,y-1]] as [number,number][]) {
      if (nx<0||nx>=w||ny<0||ny>=h) continue;
      const ni=ny*w+nx; if (processed[ni]) continue; processed[ni]=1;
      if (mag[ni]>edgeTol) continue; queue.push(ni);
    }
  }
  return mask;
}

function mergeMasks(a: Uint8Array, b: Uint8Array, size: number): Uint8Array {
  const r=new Uint8Array(size);
  for (let i=0;i<size;i++) r[i]=a[i]||b[i]?1:0;
  return r;
}

function applyMaskDeletion(id: ImageData, mask: Uint8Array): ImageData {
  const out=new ImageData(new Uint8ClampedArray(id.data),id.width,id.height);
  const w=id.width, h=id.height;
  const eroded=new Uint8Array(mask.length);
  for (let y=0;y<h;y++) for (let x=0;x<w;x++) {
    const idx=y*w+x; if (!mask[idx]) continue;
    let interior=true;
    for (const [dx,dy] of [[-1,0],[1,0],[0,-1],[0,1]]) {
      const nx=x+dx, ny=y+dy;
      if (nx<0||nx>=w||ny<0||ny>=h||!mask[ny*w+nx]) { interior=false; break; }
    }
    eroded[idx]=interior?1:0;
  }
  for (let i=0;i<mask.length;i++) {
    if (eroded[i]) out.data[i*4+3]=0;
    else if (mask[i]) out.data[i*4+3]=Math.floor(out.data[i*4+3]*0.25);
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

function applyImageAdjustments(id: ImageData, adj: ImageAdjustments): ImageData {
  const src = id.data;
  const dst = new Uint8ClampedArray(src);
  const { brightness = 0, contrast = 0, saturation = 0, sharpen = false } = adj;
  const contrastFactor = contrast !== 0 ? (259 * (contrast + 255)) / (255 * (259 - contrast)) : 1;

  for (let i = 0; i < src.length; i += 4) {
    if (src[i + 3] === 0) { dst[i]=src[i]; dst[i+1]=src[i+1]; dst[i+2]=src[i+2]; dst[i+3]=0; continue; }
    let r = src[i], g = src[i+1], b = src[i+2];

    if (brightness !== 0) {
      const delta = brightness * 2.55;
      r = Math.max(0, Math.min(255, r + delta));
      g = Math.max(0, Math.min(255, g + delta));
      b = Math.max(0, Math.min(255, b + delta));
    }

    if (contrast !== 0) {
      r = Math.max(0, Math.min(255, contrastFactor * (r - 128) + 128));
      g = Math.max(0, Math.min(255, contrastFactor * (g - 128) + 128));
      b = Math.max(0, Math.min(255, contrastFactor * (b - 128) + 128));
    }

    if (saturation !== 0) {
      const gray = 0.299 * r + 0.587 * g + 0.114 * b;
      const sat = 1 + saturation / 100;
      r = Math.max(0, Math.min(255, gray + sat * (r - gray)));
      g = Math.max(0, Math.min(255, gray + sat * (g - gray)));
      b = Math.max(0, Math.min(255, gray + sat * (b - gray)));
    }

    dst[i] = r; dst[i+1] = g; dst[i+2] = b; dst[i+3] = src[i+3];
  }

  let result = new ImageData(dst, id.width, id.height);
  if (sharpen) result = sharpenImageData(result);
  return result;
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

function getPageZoom() {
  const raw=getComputedStyle(document.documentElement).zoom, z=Number(raw);
  return Number.isFinite(z)&&z>0?z:1;
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

// ─── Component ─────────────────────────────────────────────────────────────────

export default function ImageEditor({ file, onConfirm, onCancel, qualityScale=1 }: Props) {
  const canvasRef       = useRef<HTMLCanvasElement>(null);
  const imgRef          = useRef<HTMLImageElement>(null);
  const areaRef         = useRef<HTMLDivElement>(null);
  const originalDataRef = useRef<ImageData|null>(null);
  const isDrawing       = useRef(false);
  const isMoving        = useRef(false);
  const lastBrushPoint  = useRef<{x:number;y:number}|null>(null);
  const moveStartRef    = useRef<{pointerX:number;pointerY:number;panX:number;panY:number}|null>(null);
  const undoRef         = useRef<CanvasSnapshot[]>([]);
  const redoRef         = useRef<CanvasSnapshot[]>([]);
  const trimRef         = useRef<ImageEditResult|null>(null);
  const brushRef        = useRef(28);
  const brushHardRef    = useRef(0.7);
  const panRef          = useRef({x:0,y:0});
  const zoomRef         = useRef(1);
  const rafRef          = useRef<number|null>(null);

  const [bgPreview,  setBgPreview]  = useState<BgPreview>("checker");
  const [processing, setProcessing] = useState(false);
  const [loaded,     setLoaded]     = useState(false);
  const [zoom,       setZoom]       = useState(1);
  const [pan,        setPan]        = useState({x:0,y:0});
  const [dispSize,   setDispSize]   = useState<{w:number;h:number}|null>(null);
  const [brushSize,  setBrushSize]  = useState(28);
  const [brushHard,  setBrushHard]  = useState(0.7);
  const [refineMode, setRefineMode] = useState<RefineMode>(null);
  const [cursor,     setCursor]     = useState<{x:number;y:number;size:number;visible:boolean}>({x:0,y:0,size:0,visible:false});
  const [histSig,    setHistSig]    = useState(0);
  const [displaySrc, setDisplaySrc] = useState("");
  void histSig;

  useEffect(()=>{ brushRef.current=brushSize; },[brushSize]);
  useEffect(()=>{ brushHardRef.current=brushHard; },[brushHard]);
  useEffect(()=>{ panRef.current=pan; },[pan]);
  useEffect(()=>{ zoomRef.current=zoom; },[zoom]);

  // ── Load ────────────────────────────────────────────────────────────────────

  const updateDisplay = useCallback(() => {
    const c=canvasRef.current; if (!c) return;
    setDisplaySrc(c.toDataURL("image/png"));
  }, []);

  const scheduleRefresh = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current=requestAnimationFrame(updateDisplay);
  }, [updateDisplay]);

  useEffect(() => {
    const url=URL.createObjectURL(file);
    const img=new Image();
    img.onload=()=>{
      const c=canvasRef.current; if (!c) return;
      c.width=img.naturalWidth; c.height=img.naturalHeight;
      const ctx=c.getContext("2d")!;
      ctx.clearRect(0,0,c.width,c.height);
      ctx.drawImage(img,0,0);
      originalDataRef.current=ctx.getImageData(0,0,c.width,c.height);
      setDispSize({w:c.width,h:c.height});
      setLoaded(true);
      updateDisplay();
    };
    img.src=url;
    return ()=>URL.revokeObjectURL(url);
  }, [file, updateDisplay]);

  // ── Undo / Redo ─────────────────────────────────────────────────────────────

  const saveUndo = useCallback(() => {
    const c=canvasRef.current; if (!c) return;
    undoRef.current=[...undoRef.current.slice(-19), {
      width:c.width, height:c.height,
      data:c.getContext("2d")!.getImageData(0,0,c.width,c.height),
      trim:trimRef.current,
    }];
    redoRef.current=[];
    setHistSig(h=>h+1);
  }, []);

  const restoreSnap = useCallback((snap: CanvasSnapshot) => {
    const c=canvasRef.current; if (!c) return;
    c.width=snap.width; c.height=snap.height;
    c.getContext("2d")!.putImageData(snap.data,0,0);
    trimRef.current=snap.trim;
    setDispSize({w:snap.width,h:snap.height});
    updateDisplay();
  }, [updateDisplay]);

  const doUndo = useCallback(() => {
    const snap=undoRef.current.pop(); if (!snap) return;
    const c=canvasRef.current; if (!c) return;
    redoRef.current=[...redoRef.current, {width:c.width,height:c.height,data:c.getContext("2d")!.getImageData(0,0,c.width,c.height),trim:trimRef.current}];
    restoreSnap(snap); setHistSig(h=>h+1);
  }, [restoreSnap]);

  const doRedo = useCallback(() => {
    const snap=redoRef.current.pop(); if (!snap) return;
    const c=canvasRef.current; if (!c) return;
    undoRef.current=[...undoRef.current, {width:c.width,height:c.height,data:c.getContext("2d")!.getImageData(0,0,c.width,c.height),trim:trimRef.current}];
    restoreSnap(snap); setHistSig(h=>h+1);
  }, [restoreSnap]);

  useEffect(() => {
    const h=(e: KeyboardEvent)=>{
      if ((e.ctrlKey||e.metaKey)&&e.key==="z") { e.preventDefault(); doUndo(); }
      if ((e.ctrlKey||e.metaKey)&&(e.key==="y"||(e.shiftKey&&e.key==="z"))) { e.preventDefault(); doRedo(); }
    };
    window.addEventListener("keydown",h);
    return ()=>window.removeEventListener("keydown",h);
  }, [doUndo, doRedo]);

  // ── Zoom ────────────────────────────────────────────────────────────────────

  const applyZoom = useCallback((newZ: number, fx=0.5, fy=0.5) => {
    const el=areaRef.current; if (!el) return;
    const rect=el.getBoundingClientRect();
    const cx=rect.left+rect.width*fx, cy=rect.top+rect.height*fy;
    const clamped=Math.max(0.1,Math.min(10,newZ));
    const scale=clamped/zoomRef.current;
    setPan(p=>({x:cx+(p.x-cx)*scale, y:cy+(p.y-cy)*scale}));
    setZoom(clamped);
  }, []);

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const el=areaRef.current; if (!el) return;
    const rect=el.getBoundingClientRect();
    applyZoom(zoomRef.current*(e.deltaY<0?1.12:1/1.12),
      (e.clientX-rect.left)/rect.width, (e.clientY-rect.top)/rect.height);
  }, [applyZoom]);

  // ── Geometry ────────────────────────────────────────────────────────────────

  const pointFromEvent = useCallback((e: React.MouseEvent) => {
    const el=imgRef.current; if (!el||!dispSize) return null;
    const pz=getPageZoom(), rect=el.getBoundingClientRect();
    const cx=(e.clientX/pz-rect.left/pz)/(rect.width/pz)*dispSize.w;
    const cy=(e.clientY/pz-rect.top/pz)/(rect.height/pz)*dispSize.h;
    const imageRadius=brushRef.current*(dispSize.w/(rect.width/pz));
    return {imageX:cx, imageY:cy, imageRadius};
  }, [dispSize]);

  // ── AI direct apply ─────────────────────────────────────────────────────────

  const handleAIApply = useCallback((seedPoints: {x:number;y:number}[], tol: number, edgeTol: number) => {
    const c=canvasRef.current; if (!c) return;
    const ctx=c.getContext("2d"); if (!ctx) return;
    setProcessing(true);
    saveUndo();
    setTimeout(()=>{
      const id=ctx.getImageData(0,0,c.width,c.height);
      let combined=new Uint8Array(c.width*c.height) as Uint8Array<ArrayBuffer>;
      for (const pt of seedPoints) {
        const imgX=Math.floor(Math.max(0,Math.min(c.width-1,pt.x*c.width)));
        const imgY=Math.floor(Math.max(0,Math.min(c.height-1,pt.y*c.height)));
        const region=fuzzySelectRegion(id,imgX,imgY,tol,edgeTol);
        combined=mergeMasks(combined,region,c.width*c.height) as Uint8Array<ArrayBuffer>;
      }
      const result=applyMaskDeletion(id,combined);
      ctx.putImageData(result,0,0);
      originalDataRef.current=ctx.getImageData(0,0,c.width,c.height);
      updateDisplay();
      setProcessing(false);
    },0);
  }, [saveUndo, updateDisplay]);

  const handleAIAdjust = useCallback((adjustments: ImageAdjustments) => {
    const c=canvasRef.current; if (!c) return;
    const ctx=c.getContext("2d"); if (!ctx) return;
    setProcessing(true);
    saveUndo();
    setTimeout(()=>{
      const id=ctx.getImageData(0,0,c.width,c.height);
      const result=applyImageAdjustments(id,adjustments);
      ctx.putImageData(result,0,0);
      originalDataRef.current=ctx.getImageData(0,0,c.width,c.height);
      updateDisplay();
      setProcessing(false);
    },0);
  }, [saveUndo, updateDisplay]);

  // ── Refine brush ────────────────────────────────────────────────────────────

  const applyEraseBrush = useCallback((imgX: number, imgY: number, radius: number) => {
    const c=canvasRef.current; if (!c||!dispSize) return;
    const ctx=c.getContext("2d")!;
    const r=Math.ceil(radius);
    const x0=Math.max(0,Math.floor(imgX-r)), y0=Math.max(0,Math.floor(imgY-r));
    const x1=Math.min(c.width-1,Math.ceil(imgX+r)), y1=Math.min(c.height-1,Math.ceil(imgY+r));
    const cur=ctx.getImageData(x0,y0,x1-x0+1,y1-y0+1);
    const hard=Math.max(0.05,Math.min(1,brushHardRef.current));
    for (let py=y0;py<=y1;py++) for (let px=x0;px<=x1;px++) {
      const dist=Math.hypot(px-imgX,py-imgY); if (dist>radius) continue;
      const falloff=dist<=radius*hard*0.5?1:1-(dist-radius*hard*0.5)/Math.max(0.1,radius*(1-hard*0.5));
      const strength=Math.max(0,Math.min(1,falloff)); if (strength<=0) continue;
      const ci=((py-y0)*(x1-x0+1)+(px-x0))*4;
      cur.data[ci+3]=Math.max(0,cur.data[ci+3]-Math.round(255*strength));
    }
    ctx.putImageData(cur,x0,y0);
    scheduleRefresh();
  }, [dispSize, scheduleRefresh]);

  const applyRestoreBrush = useCallback((imgX: number, imgY: number, radius: number) => {
    const c=canvasRef.current; if (!c||!dispSize||!originalDataRef.current) return;
    const ctx=c.getContext("2d")!;
    const orig=originalDataRef.current, cw=c.width, ch=c.height;
    const r=Math.ceil(radius);
    const x0=Math.max(0,Math.floor(imgX-r)), y0=Math.max(0,Math.floor(imgY-r));
    const x1=Math.min(cw-1,Math.ceil(imgX+r)), y1=Math.min(ch-1,Math.ceil(imgY+r));
    const cur=ctx.getImageData(x0,y0,x1-x0+1,y1-y0+1);
    const hard=Math.max(0.05,Math.min(1,brushHardRef.current));
    for (let py=y0;py<=y1;py++) for (let px=x0;px<=x1;px++) {
      const dist=Math.hypot(px-imgX,py-imgY); if (dist>radius) continue;
      const falloff=dist<=radius*hard*0.5?1:1-(dist-radius*hard*0.5)/Math.max(0.1,radius*(1-hard*0.5));
      const strength=Math.max(0,Math.min(1,falloff)); if (strength<=0) continue;
      const ci=((py-y0)*(x1-x0+1)+(px-x0))*4, oi=(py*orig.width+px)*4;
      if (px>=orig.width||py>=orig.height) continue;
      cur.data[ci]  =cur.data[ci]  +(orig.data[oi]  -cur.data[ci])*strength;
      cur.data[ci+1]=cur.data[ci+1]+(orig.data[oi+1]-cur.data[ci+1])*strength;
      cur.data[ci+2]=cur.data[ci+2]+(orig.data[oi+2]-cur.data[ci+2])*strength;
      cur.data[ci+3]=cur.data[ci+3]+(orig.data[oi+3]-cur.data[ci+3])*strength;
    }
    ctx.putImageData(cur,x0,y0);
    scheduleRefresh();
  }, [dispSize, scheduleRefresh]);

  // ── Mouse events ────────────────────────────────────────────────────────────

  const drawCursor = (clientX: number, clientY: number) => {
    const el=imgRef.current; if (!el||!dispSize) return;
    const rect=el.getBoundingClientRect(), pz=getPageZoom();
    setCursor({x:clientX/pz,y:clientY/pz,size:Math.max(4,brushRef.current*(rect.width/pz/dispSize.w)),visible:true});
  };

  const onMouseDown = useCallback((e: React.MouseEvent<HTMLElement>) => {
    if (!loaded||!dispSize) return;
    if (!refineMode) {
      isMoving.current=true;
      moveStartRef.current={pointerX:e.clientX,pointerY:e.clientY,panX:panRef.current.x,panY:panRef.current.y};
      return;
    }
    const pt=pointFromEvent(e); if (!pt) return;
    isDrawing.current=true; lastBrushPoint.current=null; saveUndo();
    if (refineMode==="erase") applyEraseBrush(pt.imageX,pt.imageY,pt.imageRadius);
    else applyRestoreBrush(pt.imageX,pt.imageY,pt.imageRadius);
    drawCursor(e.clientX,e.clientY);
  }, [loaded,dispSize,refineMode,pointFromEvent,saveUndo,applyEraseBrush,applyRestoreBrush]);

  const onMouseMove = useCallback((e: React.MouseEvent<HTMLElement>) => {
    if (isMoving.current&&moveStartRef.current) {
      const s=moveStartRef.current;
      setPan({x:s.panX+e.clientX-s.pointerX,y:s.panY+e.clientY-s.pointerY}); return;
    }
    const pt=pointFromEvent(e); if (!pt) return;
    if (refineMode) drawCursor(e.clientX,e.clientY);
    if (!isDrawing.current) return;
    const last=lastBrushPoint.current;
    if (last) {
      const dx=pt.imageX-last.x, dy=pt.imageY-last.y;
      const steps=Math.max(1,Math.ceil(Math.hypot(dx,dy)/Math.max(1,pt.imageRadius/2)));
      for (let i=1;i<=steps;i++) {
        const t=i/steps;
        if (refineMode==="erase") applyEraseBrush(last.x+dx*t,last.y+dy*t,pt.imageRadius);
        else applyRestoreBrush(last.x+dx*t,last.y+dy*t,pt.imageRadius);
      }
    } else {
      if (refineMode==="erase") applyEraseBrush(pt.imageX,pt.imageY,pt.imageRadius);
      else applyRestoreBrush(pt.imageX,pt.imageY,pt.imageRadius);
    }
    lastBrushPoint.current={x:pt.imageX,y:pt.imageY};
  }, [refineMode,pointFromEvent,applyEraseBrush,applyRestoreBrush]);

  const onMouseUp = useCallback(() => {
    isDrawing.current=false; isMoving.current=false;
    lastBrushPoint.current=null; moveStartRef.current=null;
  }, []);

  const onMouseLeave = useCallback(() => {
    setCursor(c=>({...c,visible:false})); onMouseUp();
  }, [onMouseUp]);

  // ── Confirm ─────────────────────────────────────────────────────────────────

  const handleConfirm = useCallback(() => {
    const c=canvasRef.current; if (!c) return;
    const bounds=getAlphaBounds(c);
    trimRef.current=bounds
      ? {originalWidth:c.width,originalHeight:c.height,x:bounds.x,y:bounds.y,width:bounds.width,height:bounds.height}
      : {originalWidth:c.width,originalHeight:c.height,x:0,y:0,width:c.width,height:c.height};
    const trimmed=trimTransparency(c).canvas;
    const enhanced=enhanceCanvas(trimmed,qualityScale);
    enhanced.toBlob(b=>{ if (b) onConfirm(b,trimRef.current!); },"image/png");
  }, [qualityScale, onConfirm]);

  // ── Render ──────────────────────────────────────────────────────────────────

  const canTransform=zoom!==1||pan.x!==0||pan.y!==0?`matrix(${zoom},0,0,${zoom},${pan.x},${pan.y})`:undefined;
  const canUndo=undoRef.current.length>0;
  const canRedo=redoRef.current.length>0;
  const bgStyle:React.CSSProperties=bgPreview==="checker"?CHECKER_STYLE:bgPreview==="white"?{backgroundColor:"#fff"}:{backgroundColor:"#111"};

  return (
    <div className="fixed inset-0 z-[100] flex flex-col" style={{backgroundColor:"#141414"}}>

      {/* ── Top bar ── */}
      <div className="flex items-center justify-between px-5 h-14 border-b shrink-0" style={{borderColor:"rgba(255,255,255,0.08)"}}>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{backgroundColor:"#a855f7"}}/>
            <span className="text-[11px] font-black uppercase tracking-[0.25em] text-white">AI Editor</span>
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
            className="px-4 py-2 text-[11px] font-bold uppercase tracking-widest border border-white/15 text-white/50 hover:text-white hover:border-white/30 transition-all rounded">
            Cancel
          </button>
          <button onClick={handleConfirm}
            className="px-5 py-2 text-[11px] font-black uppercase tracking-widest rounded transition-all hover:opacity-90"
            style={{backgroundColor:"#f5c842",color:"#0d0d0d"}}>
            Use Image
          </button>
        </div>
      </div>

      {/* ── Main layout ── */}
      <div className="flex flex-1 min-h-0">

        {/* ── Canvas area ── */}
        <div
          ref={areaRef}
          className="flex-1 flex items-center justify-center relative overflow-hidden select-none"
          style={{...bgStyle, cursor:refineMode?"crosshair":"grab"}}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseLeave}
          onWheel={onWheel}
        >
          {displaySrc && (
            <img
              ref={imgRef}
              src={displaySrc}
              alt="editing"
              draggable={false}
              style={{maxWidth:"90%",maxHeight:"90%",objectFit:"contain",
                transform:canTransform,transformOrigin:"0 0",
                imageRendering:"pixelated",userSelect:"none"}}
            />
          )}
          {!loaded && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-white/30 text-[11px] uppercase tracking-widest animate-pulse">Loading…</div>
            </div>
          )}
          {processing && (
            <div className="absolute inset-0 flex items-center justify-center" style={{backgroundColor:"rgba(0,0,0,0.6)"}}>
              <div className="flex flex-col items-center gap-4">
                <div className="flex gap-1.5">
                  {[0,1,2].map(i=>(
                    <div key={i} className="w-2.5 h-2.5 rounded-full animate-bounce"
                      style={{backgroundColor:"#a855f7",animationDelay:`${i*0.15}s`}}/>
                  ))}
                </div>
                <span className="text-[12px] font-bold uppercase tracking-[0.2em]"
                  style={{color:"rgba(196,140,255,0.9)"}}>AI is editing…</span>
                <span className="text-[10px] text-white/30">Analyzing and applying changes</span>
              </div>
            </div>
          )}
          {cursor.visible && refineMode && (
            <div style={{position:"fixed",left:cursor.x,top:cursor.y,
              width:cursor.size,height:cursor.size,boxSizing:"border-box",
              transform:"translate(-50%,-50%)",borderRadius:"9999px",
              border:`2px solid ${refineMode==="restore"?"rgba(80,220,120,0.95)":"rgba(255,255,255,0.95)"}`,
              boxShadow:"0 0 0 1px rgba(0,0,0,0.8)",pointerEvents:"none",zIndex:30}}/>
          )}
          <canvas ref={canvasRef} style={{display:"none"}}/>
        </div>

        {/* ── AI panel ── */}
        <div className="w-80 border-l flex flex-col shrink-0" style={{borderColor:"rgba(168,85,247,0.2)"}}>
          <AIAssistPanel
            canvasRef={canvasRef}
            onApplyResult={handleAIApply}
            onApplyAdjustments={handleAIAdjust}
            refineMode={refineMode}
            onRefineMode={setRefineMode}
            brushSize={brushSize}
            brushHard={brushHard}
            onBrushSize={setBrushSize}
            onBrushHard={setBrushHard}
          />
        </div>
      </div>
    </div>
  );
}
