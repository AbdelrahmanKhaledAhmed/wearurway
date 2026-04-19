import { useState, useRef, useEffect, useCallback } from "react";
import FuzzySelectPanel from "./AIAssistPanel";

type BgPreview = "checker" | "white" | "black";

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

function applyMaskRecolor(id: ImageData, mask: Uint8Array, hexColor: string): ImageData {
  const out=new ImageData(new Uint8ClampedArray(id.data),id.width,id.height);
  const r=parseInt(hexColor.slice(1,3),16);
  const g=parseInt(hexColor.slice(3,5),16);
  const b=parseInt(hexColor.slice(5,7),16);
  for (let i=0;i<mask.length;i++) {
    if (mask[i]&&out.data[i*4+3]>0) {
      out.data[i*4]=r; out.data[i*4+1]=g; out.data[i*4+2]=b;
    }
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
  const overlayCanvasRef= useRef<HTMLCanvasElement>(null);
  const imgRef          = useRef<HTMLImageElement>(null);
  const areaRef         = useRef<HTMLDivElement>(null);
  const originalDataRef = useRef<ImageData|null>(null);
  const isMoving        = useRef(false);
  const moveStartRef    = useRef<{pointerX:number;pointerY:number;panX:number;panY:number}|null>(null);
  const undoRef         = useRef<CanvasSnapshot[]>([]);
  const redoRef         = useRef<CanvasSnapshot[]>([]);
  const trimRef         = useRef<ImageEditResult|null>(null);
  const panRef          = useRef({x:0,y:0});
  const zoomRef         = useRef(1);
  const rafRef          = useRef<number|null>(null);

  const [bgPreview,     setBgPreview]     = useState<BgPreview>("checker");
  const [processing,    setProcessing]    = useState(false);
  const [loaded,        setLoaded]        = useState(false);
  const [zoom,          setZoom]          = useState(1);
  const [pan,           setPan]           = useState({x:0,y:0});
  const [dispSize,      setDispSize]      = useState<{w:number;h:number}|null>(null);
  const [histSig,       setHistSig]       = useState(0);
  const [displaySrc,    setDisplaySrc]    = useState("");
  const [toolActive,    setToolActive]    = useState(false);
  const [selectionMask, setSelectionMask] = useState<Uint8Array|null>(null);
  void histSig;

  useEffect(()=>{ panRef.current=pan; },[pan]);
  useEffect(()=>{ zoomRef.current=zoom; },[zoom]);

  // ── Update overlay canvas when selection changes ─────────────────────────────

  useEffect(()=>{
    const oc=overlayCanvasRef.current, mc=canvasRef.current;
    if (!oc||!mc) return;
    if (!selectionMask) {
      const ctx=oc.getContext("2d");
      if (ctx) { oc.width=mc.width; oc.height=mc.height; ctx.clearRect(0,0,oc.width,oc.height); }
      return;
    }
    oc.width=mc.width; oc.height=mc.height;
    const ctx=oc.getContext("2d"); if (!ctx) return;
    const id=ctx.createImageData(mc.width,mc.height);
    for (let i=0;i<selectionMask.length;i++) {
      if (selectionMask[i]) {
        id.data[i*4]=100; id.data[i*4+1]=120; id.data[i*4+2]=255; id.data[i*4+3]=110;
      }
    }
    ctx.putImageData(id,0,0);
  }, [selectionMask]);

  // ── Load ────────────────────────────────────────────────────────────────────

  const updateDisplay = useCallback(() => {
    const c=canvasRef.current; if (!c) return;
    setDisplaySrc(c.toDataURL("image/png"));
  }, []);

  const scheduleRefresh = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current=requestAnimationFrame(updateDisplay);
  }, [updateDisplay]);
  void scheduleRefresh;

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
    setSelectionMask(null);
  }, [restoreSnap]);

  const doRedo = useCallback(() => {
    const snap=redoRef.current.pop(); if (!snap) return;
    const c=canvasRef.current; if (!c) return;
    undoRef.current=[...undoRef.current, {width:c.width,height:c.height,data:c.getContext("2d")!.getImageData(0,0,c.width,c.height),trim:trimRef.current}];
    restoreSnap(snap); setHistSig(h=>h+1);
    setSelectionMask(null);
  }, [restoreSnap]);

  useEffect(() => {
    const h=(e: KeyboardEvent)=>{
      if ((e.ctrlKey||e.metaKey)&&e.key==="z") { e.preventDefault(); doUndo(); }
      if ((e.ctrlKey||e.metaKey)&&(e.key==="y"||(e.shiftKey&&e.key==="z"))) { e.preventDefault(); doRedo(); }
      if (e.key==="Escape") setSelectionMask(null);
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
    return {imageX:cx, imageY:cy};
  }, [dispSize]);

  // ── Fuzzy select ─────────────────────────────────────────────────────────────

  const handleFuzzySelect = useCallback((imgX: number, imgY: number) => {
    const c=canvasRef.current; if (!c) return;
    const ctx=c.getContext("2d"); if (!ctx) return;
    setProcessing(true);
    setTimeout(()=>{
      const id=ctx.getImageData(0,0,c.width,c.height);
      const px=Math.floor(Math.max(0,Math.min(c.width-1,imgX)));
      const py=Math.floor(Math.max(0,Math.min(c.height-1,imgY)));
      const mask=fuzzySelectRegion(id,px,py,42,65);
      setSelectionMask(mask);
      setProcessing(false);
    },0);
  }, []);

  // ── Selection actions ─────────────────────────────────────────────────────────

  const handleDelete = useCallback(() => {
    if (!selectionMask) return;
    const c=canvasRef.current; if (!c) return;
    const ctx=c.getContext("2d"); if (!ctx) return;
    setProcessing(true);
    saveUndo();
    setTimeout(()=>{
      const id=ctx.getImageData(0,0,c.width,c.height);
      const result=applyMaskDeletion(id,selectionMask);
      ctx.putImageData(result,0,0);
      originalDataRef.current=ctx.getImageData(0,0,c.width,c.height);
      updateDisplay();
      setSelectionMask(null);
      setProcessing(false);
    },0);
  }, [selectionMask, saveUndo, updateDisplay]);

  const handleChangeColor = useCallback((color: string) => {
    if (!selectionMask) return;
    const c=canvasRef.current; if (!c) return;
    const ctx=c.getContext("2d"); if (!ctx) return;
    setProcessing(true);
    saveUndo();
    setTimeout(()=>{
      const id=ctx.getImageData(0,0,c.width,c.height);
      const result=applyMaskRecolor(id,selectionMask,color);
      ctx.putImageData(result,0,0);
      originalDataRef.current=ctx.getImageData(0,0,c.width,c.height);
      updateDisplay();
      setSelectionMask(null);
      setProcessing(false);
    },0);
  }, [selectionMask, saveUndo, updateDisplay]);

  const handleClearSelection = useCallback(()=>{
    setSelectionMask(null);
  },[]);

  // ── Mouse events ────────────────────────────────────────────────────────────

  const onMouseDown = useCallback((e: React.MouseEvent<HTMLElement>) => {
    if (!loaded||!dispSize) return;
    if (toolActive) {
      const pt=pointFromEvent(e); if (!pt) return;
      handleFuzzySelect(pt.imageX, pt.imageY);
      return;
    }
    isMoving.current=true;
    moveStartRef.current={pointerX:e.clientX,pointerY:e.clientY,panX:panRef.current.x,panY:panRef.current.y};
  }, [loaded,dispSize,toolActive,pointFromEvent,handleFuzzySelect]);

  const onMouseMove = useCallback((e: React.MouseEvent<HTMLElement>) => {
    if (isMoving.current&&moveStartRef.current) {
      const s=moveStartRef.current;
      setPan({x:s.panX+e.clientX-s.pointerX,y:s.panY+e.clientY-s.pointerY});
    }
  }, []);

  const onMouseUp = useCallback(() => {
    isMoving.current=false; moveStartRef.current=null;
  }, []);

  const onMouseLeave = useCallback(() => { onMouseUp(); }, [onMouseUp]);

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
  const canvasCursor = toolActive ? "crosshair" : (selectionMask ? "default" : "grab");

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
          style={{...bgStyle, cursor: canvasCursor}}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseLeave}
          onWheel={onWheel}
        >
          {displaySrc && (
            <div style={{
              position:"relative", display:"inline-block",
              maxWidth:"90%", maxHeight:"90%",
              transform:canTransform, transformOrigin:"0 0",
            }}>
              <img
                ref={imgRef}
                src={displaySrc}
                alt="editing"
                draggable={false}
                style={{display:"block",maxWidth:"100%",maxHeight:"100%",
                  objectFit:"contain",imageRendering:"pixelated",userSelect:"none"}}
              />
              {/* Selection overlay */}
              <canvas
                ref={overlayCanvasRef}
                style={{position:"absolute",inset:0,width:"100%",height:"100%",
                  pointerEvents:"none",imageRendering:"pixelated"}}
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
                  style={{color:"rgba(196,140,255,0.9)"}}>
                  {selectionMask ? "Applying…" : "Selecting…"}
                </span>
              </div>
            </div>
          )}
          {/* Tool active hint */}
          {toolActive && !selectionMask && loaded && !processing && (
            <div className="absolute bottom-5 left-1/2 -translate-x-1/2 pointer-events-none">
              <div className="flex items-center gap-2 px-4 py-2 rounded-full text-[11px] font-bold"
                style={{backgroundColor:"rgba(0,0,0,0.7)",border:"1px solid rgba(168,85,247,0.4)",color:"rgba(196,140,255,0.9)",backdropFilter:"blur(8px)"}}>
                <span style={{color:"#a855f7"}}>✦</span> Click anywhere to select
              </div>
            </div>
          )}
          <canvas ref={canvasRef} style={{display:"none"}}/>
        </div>

        {/* ── Tool panel ── */}
        <div className="w-80 border-l flex flex-col shrink-0" style={{borderColor:"rgba(168,85,247,0.2)"}}>
          <FuzzySelectPanel
            toolActive={toolActive}
            hasSelection={!!selectionMask}
            onToggleTool={() => { setToolActive(v => !v); setSelectionMask(null); }}
            onDelete={handleDelete}
            onChangeColor={handleChangeColor}
            onClearSelection={handleClearSelection}
          />
        </div>
      </div>
    </div>
  );
}
