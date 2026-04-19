import { useState, useRef, useEffect, useCallback } from "react";

type Tool = "fuzzy-select" | "lasso" | "erase" | "restore" | "move";
type BgPreview = "checker" | "white" | "black";
type SelectMode = "new" | "add" | "subtract";

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

function computeGradientMag(d: Uint8ClampedArray, w: number, h: number): Float32Array {
  const mag = new Float32Array(w*h);
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

// Fuzzy select: returns mask of connected similar pixels
function fuzzySelectRegion(id: ImageData, sx: number, sy: number, colorTol: number, edgeTol: number): Uint8Array {
  const {data:d,width:w,height:h}=id;
  const mag=computeGradientMag(d,w,h);
  const seed=getColorAt(d,sx,sy,w);
  const mask=new Uint8Array(w*h);
  if (seed[3]===0) return mask;
  const processed=new Uint8Array(w*h);
  const queue=[sy*w+sx];
  processed[sy*w+sx]=1;
  while (queue.length) {
    const idx=queue.pop()!;
    const x=idx%w, y=Math.floor(idx/w);
    if (d[idx*4+3]===0) continue;
    if (colorDist(getColorAt(d,x,y,w),seed)>colorTol) continue;
    mask[idx]=1;
    for (const [nx,ny] of [[x+1,y],[x-1,y],[x,y+1],[x,y-1]] as [number,number][]) {
      if (nx<0||nx>=w||ny<0||ny>=h) continue;
      const ni=ny*w+nx;
      if (processed[ni]) continue;
      processed[ni]=1;
      if (mag[ni]>edgeTol) continue;
      queue.push(ni);
    }
  }
  return mask;
}

// Rasterize a polygon path into a mask using ray casting
function rasterizePolygon(pts: {x:number;y:number}[], w: number, h: number): Uint8Array {
  const mask = new Uint8Array(w*h);
  if (pts.length < 3) return mask;
  const minY = Math.max(0, Math.floor(Math.min(...pts.map(p=>p.y))));
  const maxY = Math.min(h-1, Math.ceil(Math.max(...pts.map(p=>p.y))));
  for (let y=minY; y<=maxY; y++) {
    const intersections: number[] = [];
    for (let i=0; i<pts.length; i++) {
      const a=pts[i], b=pts[(i+1)%pts.length];
      if ((a.y<=y && b.y>y)||(b.y<=y && a.y>y)) {
        const t=(y-a.y)/(b.y-a.y);
        intersections.push(a.x+t*(b.x-a.x));
      }
    }
    intersections.sort((a,b)=>a-b);
    for (let i=0; i<intersections.length-1; i+=2) {
      const x0=Math.max(0,Math.floor(intersections[i]));
      const x1=Math.min(w-1,Math.ceil(intersections[i+1]));
      for (let x=x0; x<=x1; x++) mask[y*w+x]=1;
    }
  }
  return mask;
}

// Merge two masks based on select mode
function mergeMasks(existing: Uint8Array|null, incoming: Uint8Array, mode: SelectMode, size: number): Uint8Array {
  if (!existing || mode==="new") return incoming;
  const result = new Uint8Array(size);
  for (let i=0; i<size; i++) {
    if (mode==="add") result[i] = existing[i]||incoming[i] ? 1 : 0;
    else if (mode==="subtract") result[i] = existing[i]&&!incoming[i] ? 1 : 0;
    else result[i] = incoming[i];
  }
  return result;
}

// Apply mask deletion with edge smoothing
function applyMaskDeletion(id: ImageData, mask: Uint8Array): ImageData {
  const out = new ImageData(new Uint8ClampedArray(id.data), id.width, id.height);
  const w=id.width, h=id.height;
  // Erode by 1px for smooth edges
  const eroded = new Uint8Array(mask.length);
  for (let y=0;y<h;y++) for (let x=0;x<w;x++) {
    const idx=y*w+x;
    if (!mask[idx]) continue;
    let interior=true;
    for (const [dx,dy] of [[-1,0],[1,0],[0,-1],[0,1]]) {
      const nx=x+dx, ny=y+dy;
      if (nx<0||nx>=w||ny<0||ny>=h||!mask[ny*w+nx]) { interior=false; break; }
    }
    eroded[idx]=interior?1:0;
  }
  // Feather border pixels (50% alpha)
  for (let i=0; i<mask.length; i++) {
    if (eroded[i]) {
      out.data[i*4+3]=0;
    } else if (mask[i]) {
      out.data[i*4+3]=Math.floor(out.data[i*4+3]*0.3);
    }
  }
  return out;
}

function getAlphaBounds(src: HTMLCanvasElement): AlphaBounds | null {
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
    const i=(y*w+x)*4;
    if (src[i+3]===0) continue;
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

function getPageZoom() {
  const raw=getComputedStyle(document.documentElement).zoom, z=Number(raw);
  return Number.isFinite(z)&&z>0?z:1;
}

const CHECKER_STYLE: React.CSSProperties = {
  backgroundImage:"linear-gradient(45deg,#2a2a2a 25%,transparent 25%),linear-gradient(-45deg,#2a2a2a 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#2a2a2a 75%),linear-gradient(-45deg,transparent 75%,#2a2a2a 75%)",
  backgroundSize:"20px 20px", backgroundPosition:"0 0,0 10px,10px -10px,-10px 0px", backgroundColor:"#1c1c1c",
};

// ─── Icons ────────────────────────────────────────────────────────────────────
const Icons = {
  FuzzySelect: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <path d="M5 3a2 2 0 0 0-2 2" /><path d="M19 3a2 2 0 0 1 2 2" /><path d="M21 19a2 2 0 0 1-2 2" /><path d="M5 21a2 2 0 0 1-2-2" />
      <path d="M9 3h1" /><path d="M9 21h1" /><path d="M14 3h1" /><path d="M14 21h1" /><path d="M3 9v1" /><path d="M21 9v1" /><path d="M3 14v1" /><path d="M21 14v1" />
      <circle cx="12" cy="12" r="3" /><path d="m16 16 2 2" />
    </svg>
  ),
  Lasso: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <path d="M12 3C7 3 3 7 3 12c0 3 1.5 5.5 4 7" strokeDasharray="2 1.5"/>
      <path d="M7 19c1.5 1.2 3.3 2 5 2 5 0 9-4 9-9 0-3-1.5-5.5-4-7" strokeDasharray="2 1.5"/>
      <path d="M9 20l2 1 2-1"/>
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
      <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z"/><path d="M15 5l3 3"/>
    </svg>
  ),
  Move: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <polyline points="5 9 2 12 5 15"/><polyline points="9 5 12 2 15 5"/><polyline points="15 19 12 22 9 19"/><polyline points="19 9 22 12 19 15"/>
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
  Invert: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <circle cx="12" cy="12" r="9"/><path d="M12 3v18" /><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" fillOpacity="0.4"/>
    </svg>
  ),
  Add: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="w-3 h-3">
      <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
    </svg>
  ),
  Subtract: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="w-3 h-3">
      <line x1="5" y1="12" x2="19" y2="12"/>
    </svg>
  ),
  New: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3">
      <rect x="3" y="3" width="18" height="18" rx="2"/>
    </svg>
  ),
  Trash: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
    </svg>
  ),
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function ImageEditor({ file, onConfirm, onCancel, qualityScale=1 }: Props) {
  const canvasRef        = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const lassoCanvasRef   = useRef<HTMLCanvasElement>(null);
  const imgRef           = useRef<HTMLImageElement>(null);
  const areaRef          = useRef<HTMLDivElement>(null);
  const wrapperRef       = useRef<HTMLDivElement>(null);
  const originalDataRef  = useRef<ImageData|null>(null);

  const isDrawing      = useRef(false);
  const isMoving       = useRef(false);
  const lastBrushPoint = useRef<{x:number;y:number}|null>(null);
  const moveStartRef   = useRef<{pointerX:number;pointerY:number;panX:number;panY:number}|null>(null);
  const undoRef        = useRef<CanvasSnapshot[]>([]);
  const redoRef        = useRef<CanvasSnapshot[]>([]);
  const trimRef        = useRef<ImageEditResult|null>(null);
  const selMaskRef     = useRef<Uint8Array|null>(null);
  const selSizeRef     = useRef<{w:number;h:number}|null>(null);
  const antOffsetRef   = useRef(0);
  const antRafRef      = useRef<number|null>(null);
  const lassoPathRef   = useRef<{x:number;y:number}[]>([]);
  const isLassoing     = useRef(false);

  const [tool,         setTool]         = useState<Tool>("fuzzy-select");
  const [selectMode,   setSelectMode]   = useState<SelectMode>("new");
  const [brushSize,    setBrushSize]    = useState(28);
  const [brushHard,    setBrushHard]    = useState(0.7);
  const [tolerance,    setTolerance]    = useState(35);
  const [edgeTol,      setEdgeTol]      = useState(40);
  const [bgPreview,    setBgPreview]    = useState<BgPreview>("checker");
  const [processing,   setProcessing]   = useState(false);
  const [loaded,       setLoaded]       = useState(false);
  const [zoom,         setZoom]         = useState(1);
  const [pan,          setPan]          = useState({x:0,y:0});
  const [cursor,       setCursor]       = useState<{x:number;y:number;size:number;visible:boolean}>({x:0,y:0,size:0,visible:false});
  const [histSig,      setHistSig]      = useState(0);
  const [displaySrc,   setDisplaySrc]   = useState("");
  const [dispSize,     setDispSize]     = useState<{w:number;h:number}|null>(null);
  const [hasSelection, setHasSelection] = useState(false);
  const [selPixelCount,setSelPixelCount]= useState(0);

  const brushRef     = useRef(brushSize);
  const brushHardRef = useRef(brushHard);
  const tolRef       = useRef(tolerance);
  const edgeTolRef   = useRef(edgeTol);
  const toolRef      = useRef<Tool>("fuzzy-select");
  const selModeRef   = useRef<SelectMode>("new");
  const zoomRef      = useRef(1);
  const panRef       = useRef({x:0,y:0});
  useEffect(()=>{brushRef.current=brushSize;},[brushSize]);
  useEffect(()=>{brushHardRef.current=brushHard;},[brushHard]);
  useEffect(()=>{tolRef.current=tolerance;},[tolerance]);
  useEffect(()=>{edgeTolRef.current=edgeTol;},[edgeTol]);
  useEffect(()=>{toolRef.current=tool;},[tool]);
  useEffect(()=>{selModeRef.current=selectMode;},[selectMode]);
  useEffect(()=>{zoomRef.current=zoom;},[zoom]);
  useEffect(()=>{panRef.current=pan;},[pan]);

  // ── Load ──────────────────────────────────────────────────────────────────────

  const updateDisplaySize = useCallback(()=>{
    const c=canvasRef.current, a=areaRef.current; if (!c||!a) return;
    const pad=48, aw=a.clientWidth-pad, ah=a.clientHeight-pad;
    const scale=Math.min(1,aw/c.width,ah/c.height);
    setDispSize({w:Math.max(1,Math.round(c.width*scale)),h:Math.max(1,Math.round(c.height*scale))});
  },[]);

  useEffect(()=>{
    let cancelled=false;
    const drawBitmap=(bmp:ImageBitmap)=>{
      if (cancelled) return;
      const c=canvasRef.current; if (!c){setLoaded(true);return;}
      try {
        c.width=bmp.width; c.height=bmp.height;
        const ctx=c.getContext("2d"); if (!ctx){setLoaded(true);return;}
        ctx.drawImage(bmp,0,0);
        try {
          const trimmed=trimTransparency(c);
          if (trimmed.bounds.x!==0||trimmed.bounds.y!==0||trimmed.bounds.width!==bmp.width||trimmed.bounds.height!==bmp.height) {
            c.width=trimmed.canvas.width; c.height=trimmed.canvas.height;
            ctx.clearRect(0,0,c.width,c.height); ctx.drawImage(trimmed.canvas,0,0);
          }
          trimRef.current={originalWidth:bmp.width,originalHeight:bmp.height,x:trimmed.bounds.x,y:trimmed.bounds.y,width:trimmed.bounds.width,height:trimmed.bounds.height};
        } catch {
          trimRef.current={originalWidth:bmp.width,originalHeight:bmp.height,x:0,y:0,width:bmp.width,height:bmp.height};
        }
        originalDataRef.current=ctx.getImageData(0,0,c.width,c.height);
      } finally { bmp.close(); setLoaded(true); }
    };
    createImageBitmap(file).then(b=>{if (!cancelled) drawBitmap(b); else b.close();})
      .catch(()=>{
        if (cancelled) return;
        const reader=new FileReader();
        reader.onload=e=>{
          if (cancelled) return;
          const dataUrl=e.target?.result as string; if (!dataUrl){setLoaded(true);return;}
          const img=new Image();
          img.onload=()=>{if (!cancelled) createImageBitmap(img).then(b=>{if (!cancelled) drawBitmap(b); else b.close();}).catch(()=>{const c=canvasRef.current;if (!c){setLoaded(true);return;}c.width=img.naturalWidth;c.height=img.naturalHeight;c.getContext("2d")?.drawImage(img,0,0);setLoaded(true);});};
          img.onerror=()=>{if (!cancelled) setLoaded(true);};
          img.src=dataUrl;
        };
        reader.onerror=()=>{if (!cancelled) setLoaded(true);};
        reader.readAsDataURL(file);
      });
    return ()=>{cancelled=true;};
  },[file]);

  useEffect(()=>{if (loaded) requestAnimationFrame(updateDisplaySize);},[loaded,updateDisplaySize]);

  const refreshDisplay=useCallback(()=>{
    const c=canvasRef.current; if (!c) return;
    try {setDisplaySrc(c.toDataURL("image/png"));}
    catch {setDisplaySrc(URL.createObjectURL(file));}
  },[file]);

  useEffect(()=>{if (loaded) refreshDisplay();},[histSig,loaded,refreshDisplay]);

  // ── Selection overlay ─────────────────────────────────────────────────────────

  const drawSelectionOverlay = useCallback(()=>{
    const oc=overlayCanvasRef.current;
    const mask=selMaskRef.current;
    const sz=selSizeRef.current;
    if (!oc||!dispSize||!mask||!sz) return;
    oc.width=dispSize.w; oc.height=dispSize.h;
    const ctx=oc.getContext("2d"); if (!ctx) return;
    ctx.clearRect(0,0,oc.width,oc.height);

    const scaleX=dispSize.w/sz.w, scaleY=dispSize.h/sz.h;
    const w=sz.w, h=sz.h;

    // Build fill image
    const fillId=ctx.createImageData(dispSize.w,dispSize.h);
    for (let sy=0;sy<h;sy++) {
      for (let sx=0;sx<w;sx++) {
        if (!mask[sy*w+sx]) continue;
        const dx=Math.round(sx*scaleX), dy=Math.round(sy*scaleY);
        const dw=Math.max(1,Math.round(scaleX)), dh=Math.max(1,Math.round(scaleY));
        for (let py=dy;py<Math.min(dispSize.h,dy+dh);py++) {
          for (let px=dx;px<Math.min(dispSize.w,dx+dw);px++) {
            const i=(py*dispSize.w+px)*4;
            fillId.data[i]=30; fillId.data[i+1]=144; fillId.data[i+2]=255; fillId.data[i+3]=100;
          }
        }
      }
    }
    ctx.putImageData(fillId,0,0);

    // Marching ants border
    const offset=antOffsetRef.current;
    const dashLen=Math.max(3,Math.round(Math.min(scaleX,scaleY)*3));
    ctx.save();
    ctx.lineWidth=Math.max(1,Math.min(scaleX,scaleY)*0.8);

    for (let y=0;y<h;y++) {
      for (let x=0;x<w;x++) {
        if (!mask[y*w+x]) continue;
        const px=(x+0.5)*scaleX, py=(y+0.5)*scaleY;
        const hw=scaleX*0.5, hh=scaleY*0.5;
        for (const [dx,dy,isH] of [[-1,0,false],[1,0,false],[0,-1,true],[0,1,true]] as [number,number,boolean][]) {
          const nx=x+dx, ny=y+dy;
          if (nx>=0&&nx<w&&ny>=0&&ny<h&&mask[ny*w+nx]) continue;
          ctx.beginPath();
          ctx.setLineDash([dashLen,dashLen]);
          ctx.lineDashOffset=-(offset%(dashLen*2));
          ctx.strokeStyle="rgba(0,0,0,0.85)";
          if (isH) { ctx.moveTo(px-hw,py+(dy===1?hh:-hh)); ctx.lineTo(px+hw,py+(dy===1?hh:-hh)); }
          else { ctx.moveTo(px+(dx===1?hw:-hw),py-hh); ctx.lineTo(px+(dx===1?hw:-hw),py+hh); }
          ctx.stroke();
          ctx.setLineDash([dashLen,dashLen]);
          ctx.lineDashOffset=-(offset%(dashLen*2))+dashLen;
          ctx.strokeStyle="rgba(255,255,255,0.95)";
          ctx.stroke();
        }
      }
    }
    ctx.restore();
  },[dispSize]);

  // Animate marching ants
  useEffect(()=>{
    if (!hasSelection) {
      if (antRafRef.current) {cancelAnimationFrame(antRafRef.current);antRafRef.current=null;}
      const oc=overlayCanvasRef.current;
      if (oc){const ctx=oc.getContext("2d");ctx?.clearRect(0,0,oc.width,oc.height);}
      return;
    }
    let last=0;
    const animate=(ts:number)=>{
      if (ts-last>60){antOffsetRef.current=(antOffsetRef.current+1)%100;drawSelectionOverlay();last=ts;}
      antRafRef.current=requestAnimationFrame(animate);
    };
    antRafRef.current=requestAnimationFrame(animate);
    return ()=>{if (antRafRef.current) cancelAnimationFrame(antRafRef.current);};
  },[hasSelection,drawSelectionOverlay]);

  useEffect(()=>{if (hasSelection) drawSelectionOverlay();},[dispSize,hasSelection,drawSelectionOverlay]);

  // ── Draw lasso path preview ───────────────────────────────────────────────────

  const drawLassoPreview = useCallback(()=>{
    const lc=lassoCanvasRef.current;
    if (!lc||!dispSize) return;
    lc.width=dispSize.w; lc.height=dispSize.h;
    const ctx=lc.getContext("2d"); if (!ctx) return;
    ctx.clearRect(0,0,lc.width,lc.height);
    const path=lassoPathRef.current;
    if (path.length<2) return;
    ctx.save();
    ctx.strokeStyle="rgba(255,255,255,0.9)";
    ctx.lineWidth=1.5;
    ctx.setLineDash([5,3]);
    ctx.beginPath();
    ctx.moveTo(path[0].x,path[0].y);
    for (let i=1;i<path.length;i++) ctx.lineTo(path[i].x,path[i].y);
    ctx.stroke();
    // Close line indicator
    if (path.length>2) {
      ctx.setLineDash([3,3]);
      ctx.strokeStyle="rgba(30,144,255,0.7)";
      ctx.beginPath();
      ctx.moveTo(path[path.length-1].x,path[path.length-1].y);
      ctx.lineTo(path[0].x,path[0].y);
      ctx.stroke();
    }
    ctx.restore();
  },[dispSize]);

  // ── Undo/Redo ─────────────────────────────────────────────────────────────────

  const saveUndo=useCallback(()=>{
    const c=canvasRef.current; if (!c) return;
    const ctx=c.getContext("2d"); if (!ctx) return;
    undoRef.current=[...undoRef.current.slice(-19),{width:c.width,height:c.height,data:ctx.getImageData(0,0,c.width,c.height),trim:trimRef.current?{...trimRef.current}:null}];
    redoRef.current=[]; setHistSig(s=>s+1);
  },[]);

  const restoreSnapshot=useCallback((s:CanvasSnapshot)=>{
    const c=canvasRef.current; if (!c) return;
    const ctx=c.getContext("2d"); if (!ctx) return;
    c.width=s.width; c.height=s.height; ctx.putImageData(s.data,0,0);
    trimRef.current=s.trim?{...s.trim}:null; updateDisplaySize();
  },[updateDisplaySize]);

  const doUndo=useCallback(()=>{
    if (!undoRef.current.length) return;
    const c=canvasRef.current; if (!c) return;
    const ctx=c.getContext("2d"); if (!ctx) return;
    redoRef.current=[...redoRef.current.slice(-19),{width:c.width,height:c.height,data:ctx.getImageData(0,0,c.width,c.height),trim:trimRef.current?{...trimRef.current}:null}];
    restoreSnapshot(undoRef.current.at(-1)!); undoRef.current=undoRef.current.slice(0,-1); setHistSig(s=>s+1);
  },[restoreSnapshot]);

  const doRedo=useCallback(()=>{
    if (!redoRef.current.length) return;
    const c=canvasRef.current; if (!c) return;
    const ctx=c.getContext("2d"); if (!ctx) return;
    undoRef.current=[...undoRef.current.slice(-19),{width:c.width,height:c.height,data:ctx.getImageData(0,0,c.width,c.height),trim:trimRef.current?{...trimRef.current}:null}];
    restoreSnapshot(redoRef.current.at(-1)!); redoRef.current=redoRef.current.slice(0,-1); setHistSig(s=>s+1);
  },[restoreSnapshot]);

  const clearSelection=useCallback(()=>{
    selMaskRef.current=null; selSizeRef.current=null; setHasSelection(false); setSelPixelCount(0);
  },[]);

  const commitSelection=useCallback((mask:Uint8Array,mode:SelectMode,w:number,h:number)=>{
    const merged=mergeMasks(selMaskRef.current,mask,mode,w*h);
    selMaskRef.current=merged; selSizeRef.current={w,h};
    const count=merged.reduce((a,v)=>a+v,0);
    setHasSelection(count>0); setSelPixelCount(count);
  },[]);

  const invertSelection=useCallback(()=>{
    const c=canvasRef.current; if (!c) return;
    const ctx=c.getContext("2d"); if (!ctx) return;
    const id=ctx.getImageData(0,0,c.width,c.height);
    const w=c.width, h=c.height, size=w*h;
    const cur=selMaskRef.current;
    const inv=new Uint8Array(size);
    for (let i=0;i<size;i++) {
      if (id.data[i*4+3]>0) inv[i]=cur?1-cur[i]:1;
    }
    selMaskRef.current=inv; selSizeRef.current={w,h};
    const count=inv.reduce((a,v)=>a+v,0);
    setHasSelection(count>0); setSelPixelCount(count);
  },[]);

  const trimCanvasToVisible=useCallback(()=>{
    const c=canvasRef.current; if (!c) return false;
    const bW=c.width, bH=c.height;
    let result:ReturnType<typeof trimTransparency>;
    try {result=trimTransparency(c);} catch {return false;}
    if (result.bounds.x===0&&result.bounds.y===0&&result.bounds.width===bW&&result.bounds.height===bH) return false;
    const ctx=c.getContext("2d"); if (!ctx) return false;
    c.width=result.canvas.width; c.height=result.canvas.height;
    ctx.clearRect(0,0,c.width,c.height); ctx.drawImage(result.canvas,0,0);
    const cur=trimRef.current??{originalWidth:bW,originalHeight:bH,x:0,y:0,width:bW,height:bH};
    trimRef.current={...cur,x:cur.x+result.bounds.x,y:cur.y+result.bounds.y,width:result.bounds.width,height:result.bounds.height};
    updateDisplaySize(); setHistSig(s=>s+1);
    return true;
  },[updateDisplaySize]);

  // ── Apply deletion ────────────────────────────────────────────────────────────

  const applySelectionDelete=useCallback(()=>{
    const mask=selMaskRef.current, c=canvasRef.current, sz=selSizeRef.current;
    if (!mask||!c||!sz) return;
    const ctx=c.getContext("2d"); if (!ctx) return;
    saveUndo();
    const id=ctx.getImageData(0,0,c.width,c.height);
    const result=applyMaskDeletion(id,mask);
    ctx.putImageData(result,0,0);
    clearSelection();
    trimCanvasToVisible();
    refreshDisplay();
  },[saveUndo,clearSelection,trimCanvasToVisible,refreshDisplay]);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────────

  useEffect(()=>{
    const fn=(e:KeyboardEvent)=>{
      if (e.key==="Delete"||e.key==="Backspace") {
        if (selMaskRef.current){e.preventDefault();applySelectionDelete();return;}
      }
      if (e.key==="Escape"){if (selMaskRef.current){e.preventDefault();clearSelection();return;}}
      if (e.key==="i"||e.key==="I"){if (selMaskRef.current){e.preventDefault();invertSelection();return;}}
      if (!(e.ctrlKey||e.metaKey)) return;
      const key=e.key.toLowerCase();
      if (key==="z"&&e.shiftKey){e.preventDefault();doRedo();}
      else if (key==="z"){e.preventDefault();doUndo();}
      else if (key==="y"){e.preventDefault();doRedo();}
      else if (key==="a"){e.preventDefault();
        const c=canvasRef.current; if (!c) return;
        const ctx=c.getContext("2d"); if (!ctx) return;
        const id=ctx.getImageData(0,0,c.width,c.height);
        const all=new Uint8Array(c.width*c.height);
        for (let i=0;i<all.length;i++) if (id.data[i*4+3]>0) all[i]=1;
        commitSelection(all,"new",c.width,c.height);
      }
    };
    window.addEventListener("keydown",fn,true);
    return ()=>window.removeEventListener("keydown",fn,true);
  },[doUndo,doRedo,applySelectionDelete,clearSelection,invertSelection,commitSelection]);

  useEffect(()=>{
    const fn=()=>{
      const was=isDrawing.current;
      isDrawing.current=false; isMoving.current=false; lastBrushPoint.current=null; moveStartRef.current=null;
      if (was) trimCanvasToVisible();
    };
    window.addEventListener("mouseup",fn);
    return ()=>window.removeEventListener("mouseup",fn);
  },[trimCanvasToVisible]);

  useEffect(()=>{
    if (tool!=="fuzzy-select"&&tool!=="lasso") clearSelection();
  },[tool,clearSelection]);

  // ── Zoom & Pan ────────────────────────────────────────────────────────────────

  const applyZoom=useCallback((factor:number,cx?:number,cy?:number)=>{
    const area=areaRef.current; if (!area||!dispSize) return;
    const areaRect=area.getBoundingClientRect();
    const ancX=cx!==undefined?cx-areaRect.left:area.clientWidth/2;
    const ancY=cy!==undefined?cy-areaRect.top:area.clientHeight/2;
    const layoutLeft=(area.clientWidth-dispSize.w)/2;
    const layoutTop=(area.clientHeight-dispSize.h)/2;
    const prevZ=zoomRef.current, nextZ=Math.max(1,Math.min(40,prevZ*factor));
    if (nextZ===prevZ) return;
    const localX=(ancX-layoutLeft-panRef.current.x)/prevZ;
    const localY=(ancY-layoutTop-panRef.current.y)/prevZ;
    const nextPan=nextZ===1?{x:0,y:0}:{x:ancX-layoutLeft-localX*nextZ,y:ancY-layoutTop-localY*nextZ};
    setZoom(nextZ); setPan(nextPan);
  },[dispSize]);

  useEffect(()=>{
    const el=areaRef.current; if (!el) return;
    const fn=(e:WheelEvent)=>{e.preventDefault();applyZoom(e.deltaY<0?1.18:1/1.18,e.clientX,e.clientY);};
    el.addEventListener("wheel",fn,{passive:false});
    return ()=>el.removeEventListener("wheel",fn);
  },[applyZoom]);

  useEffect(()=>{
    const fn=(e:MouseEvent)=>{
      if (toolRef.current==="move"&&isMoving.current&&moveStartRef.current) {
        const s=moveStartRef.current; setPan({x:s.panX+e.clientX-s.pointerX,y:s.panY+e.clientY-s.pointerY});
      }
      if (toolRef.current==="lasso"&&isLassoing.current&&dispSize) {
        // handled in onMouseMove
      }
    };
    window.addEventListener("mousemove",fn);
    return ()=>window.removeEventListener("mousemove",fn);
  },[dispSize]);

  // ── Brush helpers ─────────────────────────────────────────────────────────────

  const pointFromEvent=(e:React.MouseEvent<HTMLElement>)=>{
    const c=canvasRef.current, rect=(e.currentTarget as HTMLElement).getBoundingClientRect();
    if (!c||!dispSize) return null;
    const dX=((e.clientX-rect.left)/rect.width)*dispSize.w;
    const dY=((e.clientY-rect.top)/rect.height)*dispSize.h;
    return {displayX:dX,displayY:dY,imageX:dX*(c.width/dispSize.w),imageY:dY*(c.height/dispSize.h),imageRadius:Math.max(0.5,(brushRef.current/2)-(2*c.width/rect.width))};
  };

  const rafRef=useRef<number|null>(null);
  const scheduleRefresh=useCallback(()=>{
    if (rafRef.current!==null) return;
    rafRef.current=requestAnimationFrame(()=>{rafRef.current=null;refreshDisplay();});
  },[refreshDisplay]);

  const applyEraseBrush=(imgX:number,imgY:number,radius:number)=>{
    const c=canvasRef.current; if (!c||!dispSize) return;
    const ctx=c.getContext("2d"); if (!ctx) return;
    const last=lastBrushPoint.current;
    const stamp=(x:number,y:number)=>{
      const hardness=Math.max(0.05,Math.min(1,brushHardRef.current));
      const grad=ctx.createRadialGradient(x,y,radius*hardness*0.5,x,y,radius);
      grad.addColorStop(0,"rgba(0,0,0,1)"); grad.addColorStop(1,"rgba(0,0,0,0)");
      ctx.save(); ctx.globalCompositeOperation="destination-out"; ctx.fillStyle=grad;
      ctx.beginPath(); ctx.arc(x,y,radius,0,Math.PI*2); ctx.fill(); ctx.restore();
    };
    if (last) {
      const dx=imgX-last.x, dy=imgY-last.y, dist=Math.hypot(dx,dy);
      const steps=Math.max(1,Math.ceil(dist/Math.max(1,radius/2)));
      for (let i=1;i<=steps;i++){const t=i/steps;stamp(last.x+dx*t,last.y+dy*t);}
    } else stamp(imgX,imgY);
    lastBrushPoint.current={x:imgX,y:imgY};
    scheduleRefresh();
  };

  const applyRestoreBrush=(imgX:number,imgY:number,radius:number)=>{
    const c=canvasRef.current; if (!c||!dispSize||!originalDataRef.current) return;
    const ctx=c.getContext("2d"); if (!ctx) return;
    const orig=originalDataRef.current, cw=c.width, ch=c.height;
    const r=Math.ceil(radius);
    const x0=Math.max(0,Math.floor(imgX-r)), y0=Math.max(0,Math.floor(imgY-r));
    const x1=Math.min(cw-1,Math.ceil(imgX+r)), y1=Math.min(ch-1,Math.ceil(imgY+r));
    const cur=ctx.getImageData(x0,y0,x1-x0+1,y1-y0+1);
    const hardness=Math.max(0.05,Math.min(1,brushHardRef.current));
    for (let py=y0;py<=y1;py++) for (let px=x0;px<=x1;px++) {
      const dist=Math.hypot(px-imgX,py-imgY); if (dist>radius) continue;
      const falloff=dist<=radius*hardness*0.5?1:1-(dist-radius*hardness*0.5)/Math.max(0.1,radius*(1-hardness*0.5));
      const strength=Math.max(0,Math.min(1,falloff)); if (strength<=0) continue;
      const ci=((py-y0)*(x1-x0+1)+(px-x0))*4, oi=(py*orig.width+px)*4;
      if (px>=orig.width||py>=orig.height) continue;
      cur.data[ci]  =cur.data[ci]  +(orig.data[oi]  -cur.data[ci])*strength;
      cur.data[ci+1]=cur.data[ci+1]+(orig.data[oi+1]-cur.data[ci+1])*strength;
      cur.data[ci+2]=cur.data[ci+2]+(orig.data[oi+2]-cur.data[ci+2])*strength;
      cur.data[ci+3]=cur.data[ci+3]+(orig.data[oi+3]-cur.data[ci+3])*strength;
    }
    ctx.putImageData(cur,x0,y0);
    lastBrushPoint.current={x:imgX,y:imgY};
    scheduleRefresh();
  };

  // ── Mouse events ──────────────────────────────────────────────────────────────

  const drawCursorOverlay=(clientX:number,clientY:number)=>{
    const c=canvasRef.current, el=imgRef.current;
    if (!c||!el) return;
    const rect=el.getBoundingClientRect(), pz=getPageZoom();
    setCursor({x:clientX/pz,y:clientY/pz,size:Math.max(4,brushRef.current*(rect.width/c.width)),visible:true});
  };

  const detectSelectMode=(e:React.MouseEvent):SelectMode=>{
    if (e.shiftKey) return "add";
    if (e.altKey||e.ctrlKey) return "subtract";
    return selModeRef.current;
  };

  const onMouseDown=(e:React.MouseEvent<HTMLElement>)=>{
    if (!loaded||!dispSize) return;
    const point=pointFromEvent(e); if (!point) return;
    const {imageX,imageY,displayX,displayY}=point;

    if (toolRef.current==="move") {
      isMoving.current=true;
      moveStartRef.current={pointerX:e.clientX,pointerY:e.clientY,panX:panRef.current.x,panY:panRef.current.y};
      return;
    }

    if (toolRef.current==="erase"||toolRef.current==="restore") {
      clearSelection();
      isDrawing.current=true; lastBrushPoint.current=null; saveUndo();
      if (toolRef.current==="erase") applyEraseBrush(imageX,imageY,point.imageRadius);
      else applyRestoreBrush(imageX,imageY,point.imageRadius);
      drawCursorOverlay(e.clientX,e.clientY);
      return;
    }

    if (toolRef.current==="fuzzy-select") {
      const c=canvasRef.current; if (!c) return;
      const ctx=c.getContext("2d"); if (!ctx) return;
      const mode=detectSelectMode(e);
      setProcessing(true);
      setTimeout(()=>{
        const id=ctx.getImageData(0,0,c.width,c.height);
        const mask=fuzzySelectRegion(id,Math.floor(imageX),Math.floor(imageY),tolRef.current,edgeTolRef.current);
        commitSelection(mask,mode,c.width,c.height);
        setProcessing(false);
      },0);
      return;
    }

    if (toolRef.current==="lasso") {
      isLassoing.current=true;
      lassoPathRef.current=[{x:displayX,y:displayY}];
      drawLassoPreview();
    }
  };

  const onMouseMove=(e:React.MouseEvent<HTMLElement>)=>{
    if (toolRef.current==="move"&&isMoving.current&&moveStartRef.current) {
      const s=moveStartRef.current; setPan({x:s.panX+e.clientX-s.pointerX,y:s.panY+e.clientY-s.pointerY}); return;
    }
    const point=pointFromEvent(e); if (!point) return;
    const {imageX,imageY,displayX,displayY}=point;

    if (toolRef.current==="erase"||toolRef.current==="restore") drawCursorOverlay(e.clientX,e.clientY);
    if (isDrawing.current) {
      if (toolRef.current==="erase") applyEraseBrush(imageX,imageY,point.imageRadius);
      else if (toolRef.current==="restore") applyRestoreBrush(imageX,imageY,point.imageRadius);
    }

    if (toolRef.current==="lasso"&&isLassoing.current) {
      lassoPathRef.current.push({x:displayX,y:displayY});
      drawLassoPreview();
    }
  };

  const onMouseUp=(e:React.MouseEvent<HTMLElement>)=>{
    const was=isDrawing.current;
    isDrawing.current=false; isMoving.current=false; lastBrushPoint.current=null; moveStartRef.current=null;
    if (was) trimCanvasToVisible();

    if (toolRef.current==="lasso"&&isLassoing.current&&dispSize) {
      isLassoing.current=false;
      const c=canvasRef.current; if (!c) return;
      const path=lassoPathRef.current;
      // Clear lasso preview
      const lc=lassoCanvasRef.current;
      if (lc){const ctx=lc.getContext("2d");ctx?.clearRect(0,0,lc.width,lc.height);}
      lassoPathRef.current=[];
      if (path.length<3) return;
      // Convert display coords to image coords
      const scaleX=c.width/dispSize.w, scaleY=c.height/dispSize.h;
      const imgPath=path.map(p=>({x:p.x*scaleX,y:p.y*scaleY}));
      const mode=e.shiftKey?"add":e.altKey||e.ctrlKey?"subtract":selModeRef.current;
      const mask=rasterizePolygon(imgPath,c.width,c.height);
      commitSelection(mask,mode,c.width,c.height);
    }
  };

  const onMouseLeave=(e:React.MouseEvent<HTMLElement>)=>{
    const was=isDrawing.current;
    if (!isMoving.current) isDrawing.current=false;
    lastBrushPoint.current=null;
    setCursor(p=>({...p,visible:false}));
    if (was) trimCanvasToVisible();
    // Finalize lasso on leave
    if (toolRef.current==="lasso"&&isLassoing.current) {
      onMouseUp(e);
    }
  };

  // ── Confirm ───────────────────────────────────────────────────────────────────

  const handleConfirm=()=>{
    clearSelection();
    const c=canvasRef.current; if (!c) return;
    trimCanvasToVisible();
    const edit=trimRef.current??{originalWidth:c.width,originalHeight:c.height,x:0,y:0,width:c.width,height:c.height};
    const trimmed=trimTransparency(c).canvas;
    const enhanced=enhanceCanvas(trimmed,qualityScale);
    enhanced.toBlob(b=>{if (b) onConfirm(b,edit);},"image/png");
  };

  // ── Derived ───────────────────────────────────────────────────────────────────

  const canTransform=zoom!==1||pan.x!==0||pan.y!==0?`matrix(${zoom},0,0,${zoom},${pan.x},${pan.y})`:undefined;
  const canUndo=undoRef.current.length>0;
  const canRedo=redoRef.current.length>0;
  void histSig;
  const isBrushTool=tool==="erase"||tool==="restore";
  const isSelectionTool=tool==="fuzzy-select"||tool==="lasso";
  const bgStyle:React.CSSProperties=bgPreview==="checker"?CHECKER_STYLE:bgPreview==="white"?{backgroundColor:"#fff"}:{backgroundColor:"#111"};

  const selModeBtn=(mode:SelectMode,Icon:()=>JSX.Element,label:string)=>(
    <button onClick={()=>setSelectMode(mode)} title={label}
      className={`flex items-center gap-1 px-2.5 py-1.5 rounded text-[10px] font-bold uppercase tracking-widest transition-all ${selectMode===mode?"text-[#0d0d0d]":"text-white/40 hover:text-white/70 hover:bg-white/8"}`}
      style={selectMode===mode?{backgroundColor:"#1e90ff"}:{}}>
      <Icon/> {label}
    </button>
  );

  return (
    <div className="fixed inset-0 z-[100] flex flex-col" style={{backgroundColor:"#141414"}}>

      {/* ── Top bar ── */}
      <div className="flex items-center justify-between px-5 h-14 border-b shrink-0" style={{borderColor:"rgba(255,255,255,0.08)"}}>
        <div className="flex items-center gap-4">
          <span className="text-[11px] font-black uppercase tracking-[0.25em] text-white">Edit Image</span>
          <div className="flex items-center gap-1">
            <button onClick={doUndo} disabled={!canUndo} title="Undo (Ctrl+Z)"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-white/50 hover:text-white hover:bg-white/8 disabled:opacity-25 transition-all text-[11px] font-bold uppercase tracking-widest">
              <Icons.Undo/> Undo
            </button>
            <button onClick={doRedo} disabled={!canRedo} title="Redo (Ctrl+Y)"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-white/50 hover:text-white hover:bg-white/8 disabled:opacity-25 transition-all text-[11px] font-bold uppercase tracking-widest">
              Redo <Icons.Redo/>
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

      {/* ── Selection action bar ── */}
      {hasSelection && (
        <div className="flex items-center gap-3 px-5 py-2 shrink-0" style={{backgroundColor:"rgba(30,144,255,0.12)",borderBottom:"1px solid rgba(30,144,255,0.25)"}}>
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{backgroundColor:"#1e90ff"}} />
            <span className="text-[10px] font-bold uppercase tracking-widest" style={{color:"#1e90ff"}}>
              {selPixelCount.toLocaleString()} px selected
            </span>
          </div>
          <div className="w-px h-4 bg-white/10" />
          <button onClick={applySelectionDelete}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded font-black uppercase text-[10px] tracking-widest transition-all hover:opacity-90"
            style={{backgroundColor:"#1e90ff",color:"#fff"}}>
            <Icons.Trash/> Delete (Del)
          </button>
          <button onClick={invertSelection}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded font-bold uppercase text-[10px] tracking-widest transition-all hover:bg-white/10 text-white/60 hover:text-white border border-white/15">
            <Icons.Invert/> Invert (I)
          </button>
          <button onClick={clearSelection}
            className="px-3 py-1.5 rounded font-bold uppercase text-[10px] tracking-widest transition-all hover:bg-white/8 text-white/30 hover:text-white/60">
            Deselect (Esc)
          </button>
        </div>
      )}

      {/* ── Body ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── Left toolbar ── */}
        <div className="w-16 flex flex-col items-center py-4 gap-1 border-r shrink-0" style={{borderColor:"rgba(255,255,255,0.08)"}}>
          {([
            {id:"fuzzy-select",Icon:Icons.FuzzySelect,label:"Fuzzy Select"},
            {id:"lasso",       Icon:Icons.Lasso,       label:"Lasso Select"},
            {id:"erase",       Icon:Icons.Erase,       label:"Erase Brush"},
            {id:"restore",     Icon:Icons.Restore,     label:"Restore Brush"},
            {id:"move",        Icon:Icons.Move,        label:"Pan / Move"},
          ] as const).map(({id,Icon,label})=>(
            <button key={id} onClick={()=>setTool(id)} title={label}
              className={`w-10 h-10 flex items-center justify-center rounded transition-all ${tool===id?"text-[#0d0d0d]":"text-white/40 hover:text-white hover:bg-white/8"}`}
              style={tool===id?{backgroundColor:"#f5c842"}:{}}>
              <Icon/>
            </button>
          ))}
        </div>

        {/* ── Center canvas ── */}
        <div ref={areaRef} className="flex-1 overflow-hidden flex items-center justify-center relative" style={bgStyle}>

          {!loaded && (
            <div className="flex flex-col items-center gap-3">
              <div className="w-8 h-8 border-2 border-white/20 border-t-white/60 rounded-full animate-spin"/>
              <p className="text-[11px] uppercase tracking-widest text-white/40">Loading…</p>
            </div>
          )}

          {processing && (
            <div className="absolute inset-0 flex items-center justify-center z-20 bg-black/30 backdrop-blur-sm">
              <div className="flex flex-col items-center gap-3 px-8 py-5 rounded-xl" style={{backgroundColor:"rgba(13,13,13,0.96)",border:"1px solid rgba(255,255,255,0.1)"}}>
                <div className="w-7 h-7 border-2 border-white/15 border-t-[#1e90ff] rounded-full animate-spin"/>
                <p className="text-[11px] uppercase tracking-widest font-bold text-white/70">Analyzing region…</p>
              </div>
            </div>
          )}

          {/* Zoom controls */}
          <div className="absolute bottom-4 right-4 flex items-center gap-1 z-10 rounded overflow-hidden" style={{backgroundColor:"rgba(13,13,13,0.85)",border:"1px solid rgba(255,255,255,0.1)"}}>
            <button onClick={()=>applyZoom(1/1.2)} className="px-2.5 py-1.5 text-white/50 hover:text-white transition-colors text-lg font-light leading-none">−</button>
            <span className="text-[10px] font-mono text-white/40 px-1 min-w-[3.5rem] text-center">{Math.round(zoom*100)}%</span>
            <button onClick={()=>applyZoom(1.2)} className="px-2.5 py-1.5 text-white/50 hover:text-white transition-colors text-lg font-light leading-none">+</button>
            <button onClick={()=>{setZoom(1);setPan({x:0,y:0});}} className="px-2.5 py-1.5 text-[10px] text-white/40 hover:text-white transition-colors font-bold uppercase tracking-widest border-l" style={{borderColor:"rgba(255,255,255,0.08)"}}>Fit</button>
          </div>

          <div ref={wrapperRef}
            style={{position:"relative",display:loaded&&dispSize&&displaySrc?"block":"none",width:dispSize?`${dispSize.w}px`:0,height:dispSize?`${dispSize.h}px`:0,transformOrigin:"0 0",transform:canTransform,boxShadow:"0 0 0 1px rgba(255,255,255,0.06), 0 8px 40px rgba(0,0,0,0.6)"}}>
            <canvas ref={canvasRef} style={{display:"none"}}/>
            <img
              ref={imgRef}
              src={displaySrc}
              alt="editing"
              draggable={false}
              onMouseDown={onMouseDown}
              onMouseMove={onMouseMove}
              onMouseUp={onMouseUp}
              onMouseLeave={onMouseLeave}
              style={{display:"block",width:dispSize?`${dispSize.w}px`:"auto",height:dispSize?`${dispSize.h}px`:"auto",cursor:processing?"wait":isBrushTool?"none":tool==="move"?(isMoving.current?"grabbing":"grab"):"crosshair",imageRendering:zoom>=6?"pixelated":"auto",userSelect:"none"}}
            />
            {/* Selection overlay */}
            <canvas ref={overlayCanvasRef} style={{position:"absolute",top:0,left:0,width:"100%",height:"100%",pointerEvents:"none"}}/>
            {/* Lasso path overlay */}
            <canvas ref={lassoCanvasRef} style={{position:"absolute",top:0,left:0,width:"100%",height:"100%",pointerEvents:"none"}}/>
          </div>

          {cursor.visible && isBrushTool && (
            <div style={{position:"fixed",left:cursor.x,top:cursor.y,width:cursor.size,height:cursor.size,boxSizing:"border-box",transform:"translate(-50%,-50%)",borderRadius:"9999px",border:`2px solid ${tool==="restore"?"rgba(80,220,120,0.95)":"rgba(255,255,255,0.95)"}`,boxShadow:"0 0 0 1px rgba(0,0,0,0.8), 0 0 10px rgba(0,0,0,0.4)",pointerEvents:"none",zIndex:30}}/>
          )}
        </div>

        {/* ── Right panel ── */}
        <div className="w-64 border-l flex flex-col shrink-0 overflow-y-auto" style={{borderColor:"rgba(255,255,255,0.08)",scrollbarWidth:"none"}}>

          {/* Fuzzy Select */}
          {tool==="fuzzy-select" && (
            <div className="p-5 space-y-4 border-b" style={{borderColor:"rgba(255,255,255,0.08)"}}>
              <div>
                <p className="text-[10px] uppercase tracking-[0.2em] text-white/30 mb-1">Fuzzy Select</p>
                <p className="text-[10px] text-white/35 leading-relaxed">Click to select connected pixels with similar color. Hold <span className="text-[#1e90ff]">Shift</span> to add, <span className="text-[#ff6b35]">Alt</span> to subtract.</p>
              </div>
              <div className="flex gap-1">
                {selModeBtn("new",Icons.New,"New")}
                {selModeBtn("add",Icons.Add,"Add")}
                {selModeBtn("subtract",Icons.Subtract,"Sub")}
              </div>
              <div>
                <div className="flex justify-between items-center mb-2">
                  <p className="text-[10px] uppercase tracking-[0.2em] text-white/30">Color Spread</p>
                  <span className="text-[11px] font-mono font-bold text-white/60">{tolerance}</span>
                </div>
                <input type="range" min={5} max={120} value={tolerance} onChange={e=>setTolerance(Number(e.target.value))} className="w-full accent-[#1e90ff]"/>
                <div className="flex justify-between mt-1">
                  <span className="text-[10px] text-white/20">Tight</span>
                  <span className="text-[10px] text-white/20">Wide</span>
                </div>
              </div>
              <div>
                <div className="flex justify-between items-center mb-2">
                  <p className="text-[10px] uppercase tracking-[0.2em] text-white/30">Edge Protection</p>
                  <span className="text-[11px] font-mono font-bold text-white/60">{edgeTol}</span>
                </div>
                <input type="range" min={10} max={200} value={edgeTol} onChange={e=>setEdgeTol(Number(e.target.value))} className="w-full accent-[#1e90ff]"/>
                <div className="flex justify-between mt-1">
                  <span className="text-[10px] text-white/20">Strict</span>
                  <span className="text-[10px] text-white/20">Relaxed</span>
                </div>
              </div>
            </div>
          )}

          {/* Lasso Select */}
          {tool==="lasso" && (
            <div className="p-5 space-y-4 border-b" style={{borderColor:"rgba(255,255,255,0.08)"}}>
              <div>
                <p className="text-[10px] uppercase tracking-[0.2em] text-white/30 mb-1">Lasso Select</p>
                <p className="text-[10px] text-white/35 leading-relaxed">Click and drag to draw a freehand selection around any area. Release to close the selection. Hold <span className="text-[#1e90ff]">Shift</span> to add, <span className="text-[#ff6b35]">Alt</span> to subtract.</p>
              </div>
              <div className="flex gap-1">
                {selModeBtn("new",Icons.New,"New")}
                {selModeBtn("add",Icons.Add,"Add")}
                {selModeBtn("subtract",Icons.Subtract,"Sub")}
              </div>
              <div className="p-3 rounded-lg" style={{backgroundColor:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.06)"}}>
                <p className="text-[10px] text-white/25 leading-relaxed">Draw freely around the exact region you want to select. Works on any complex shape.</p>
              </div>
            </div>
          )}

          {/* Brush tools */}
          {isBrushTool && (
            <div className="p-5 space-y-4">
              <div>
                <p className="text-[10px] uppercase tracking-[0.2em] text-white/30 mb-1">{tool==="erase"?"Erase Brush":"Restore Brush"}</p>
                <p className="text-[10px] text-white/35 leading-relaxed">{tool==="erase"?"Paint to erase pixels with full manual control.":"Paint to restore erased pixels from the original."}</p>
              </div>
              <div>
                <div className="flex justify-between items-center mb-2">
                  <p className="text-[10px] uppercase tracking-[0.2em] text-white/30">Brush Size</p>
                  <span className="text-[11px] font-mono font-bold text-white/60">{brushSize}px</span>
                </div>
                <input type="range" min={2} max={200} value={brushSize} onChange={e=>setBrushSize(Number(e.target.value))} className="w-full accent-[#f5c842]"/>
                <div className="flex justify-between mt-1">
                  <span className="text-[10px] text-white/20">Fine</span>
                  <span className="text-[10px] text-white/20">Large</span>
                </div>
              </div>
              <div>
                <div className="flex justify-between items-center mb-2">
                  <p className="text-[10px] uppercase tracking-[0.2em] text-white/30">Edge Softness</p>
                  <span className="text-[11px] font-mono font-bold text-white/60">{Math.round((1-brushHard)*100)}%</span>
                </div>
                <input type="range" min={0} max={100} value={Math.round((1-brushHard)*100)} onChange={e=>setBrushHard(1-Number(e.target.value)/100)} className="w-full accent-[#f5c842]"/>
                <div className="flex justify-between mt-1">
                  <span className="text-[10px] text-white/20">Hard edge</span>
                  <span className="text-[10px] text-white/20">Feathered</span>
                </div>
              </div>
            </div>
          )}

          {/* Move */}
          {tool==="move" && (
            <div className="p-5">
              <p className="text-[10px] uppercase tracking-[0.2em] text-white/30 mb-2">Pan & Zoom</p>
              <p className="text-[10px] text-white/30 leading-relaxed">Click and drag to pan. Scroll to zoom toward cursor.</p>
            </div>
          )}

          {/* Keyboard shortcuts */}
          <div className="mt-auto p-5 border-t" style={{borderColor:"rgba(255,255,255,0.06)"}}>
            <p className="text-[10px] uppercase tracking-[0.2em] text-white/20 mb-3">Shortcuts</p>
            <div className="space-y-1.5">
              {[
                ["Ctrl+Z","Undo"],["Ctrl+Y","Redo"],["Scroll","Zoom"],
                isSelectionTool&&["Shift+Click","Add to sel"],
                isSelectionTool&&["Alt+Click","Subtract sel"],
                isSelectionTool&&["I","Invert sel"],
                isSelectionTool&&["Ctrl+A","Select all"],
                hasSelection&&["Delete","Remove area"],
                ["Esc","Deselect"],
              ].filter(Boolean).map(([k,v])=>(
                <div key={k as string} className="flex justify-between">
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
