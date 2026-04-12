import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { useGetMockup, useSaveMockup, getGetMockupQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useCustomizer } from "@/hooks/use-customizer";
import ImageEditor from "@/components/ImageEditor";

// ─── Types ────────────────────────────────────────────────────────────────────

interface DesignLayer {
  id: string;
  name: string;
  imageUrl: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  visible: boolean;
  naturalWidth: number;
  naturalHeight: number;
}

interface DragState {
  layerId: string;
  startMouseX: number;
  startMouseY: number;
  startLayerX: number;
  startLayerY: number;
}

const ZOOM_STEP_SCROLL = 0.05;
const ZOOM_STEP_BUTTON = 0.01;
const ROTATE_STEP = 1;

// ─── Main Component ───────────────────────────────────────────────────────────

export default function Design() {
  const [, setLocation] = useLocation();
  const { selectedProduct, selectedFit, selectedColor, selectedSize, reset } = useCustomizer();
  const [side, setSide] = useState<"front" | "back">("front");

  const [layers, setLayers] = useState<DesignLayer[]>([]);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [clipSize, setClipSize] = useState<{ w: number; h: number } | null>(null);
  const [editorFile, setEditorFile] = useState<File | null>(null);
  const [editingLayerId, setEditingLayerId] = useState<string | null>(null);

  const isAdmin = !!localStorage.getItem("wearurway_admin_token");
  const queryClient = useQueryClient();
  const saveMockupMutation = useSaveMockup();
  const [adminWidthOverride, setAdminWidthOverride] = useState<number | null>(null);

  const clipAreaRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const pinchRef = useRef<{ dist: number } | null>(null);
  const holdActionRef = useRef<(() => void) | null>(null);
  const holdTimerRef = useRef<{ timeout: ReturnType<typeof setTimeout> | null; interval: ReturnType<typeof setInterval> | null }>({ timeout: null, interval: null });

  useEffect(() => {
    if (!selectedProduct || !selectedFit || !selectedColor || !selectedSize) {
      setLocation("/products");
    }
  }, [selectedProduct, selectedFit, selectedColor, selectedSize, setLocation]);

  const { data: mockup } = useGetMockup(
    {
      productId: selectedProduct?.id ?? "",
      fitId: selectedFit?.id ?? "",
      colorId: selectedColor?.id ?? "",
    },
    {
      query: {
        enabled: !!(selectedProduct && selectedFit && selectedColor),
        queryKey: getGetMockupQueryKey({
          productId: selectedProduct?.id ?? "",
          fitId: selectedFit?.id ?? "",
          colorId: selectedColor?.id ?? "",
        }),
      },
    }
  );

  const currentSide = side === "front" ? mockup?.front : mockup?.back;
  const bbox = currentSide?.boundingBox;
  const realWidth = selectedSize?.realWidth ?? 0;
  const realHeight = selectedSize?.realHeight ?? 0;

  // ── Drag handlers ──────────────────────────────────────────────────────────

  const onMouseMove = useCallback((e: MouseEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.startMouseX;
    const dy = e.clientY - drag.startMouseY;
    setLayers(prev =>
      prev.map(l =>
        l.id === drag.layerId
          ? { ...l, x: drag.startLayerX + dx, y: drag.startLayerY + dy }
          : l
      )
    );
  }, []);

  const onMouseUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  useEffect(() => {
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [onMouseMove, onMouseUp]);

  const startDrag = (e: React.MouseEvent, layer: DesignLayer) => {
    if (layer.id !== selectedLayerId) return;
    e.preventDefault();
    dragRef.current = {
      layerId: layer.id,
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      startLayerX: layer.x,
      startLayerY: layer.y,
    };
  };

  // ── Scroll wheel zoom on clip area ─────────────────────────────────────────

  const onClipWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    setSelectedLayerId(prev => {
      if (!prev) return prev;
      setLayers(layers =>
        layers.map(l => {
          if (l.id !== prev) return l;
          const factor = e.deltaY < 0 ? 1 + ZOOM_STEP_SCROLL : 1 - ZOOM_STEP_SCROLL;
          const newW = Math.max(10, l.width * factor);
          const newH = Math.max(10, l.height * factor);
          const cx = l.x + l.width / 2;
          const cy = l.y + l.height / 2;
          return { ...l, width: newW, height: newH, x: cx - newW / 2, y: cy - newH / 2 };
        })
      );
      return prev;
    });
  }, []);

  useEffect(() => {
    const el = clipAreaRef.current;
    if (!el) return;
    el.addEventListener("wheel", onClipWheel, { passive: false });
    return () => el.removeEventListener("wheel", onClipWheel);
  }, [onClipWheel, bbox]);

  // ── Pinch-to-zoom on mobile ────────────────────────────────────────────────

  const getTouchDist = (e: TouchEvent) => {
    const t = e.touches;
    if (t.length < 2) return 0;
    const dx = t[0].clientX - t[1].clientX;
    const dy = t[0].clientY - t[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const onTouchStart = useCallback((e: TouchEvent) => {
    if (e.touches.length === 2) {
      e.preventDefault();
      pinchRef.current = { dist: getTouchDist(e) };
    }
  }, []);

  const onTouchMove = useCallback((e: TouchEvent) => {
    if (e.touches.length === 2 && pinchRef.current) {
      e.preventDefault();
      const newDist = getTouchDist(e);
      const ratio = newDist / pinchRef.current.dist;
      pinchRef.current.dist = newDist;
      setSelectedLayerId(prev => {
        if (!prev) return prev;
        setLayers(layers =>
          layers.map(l => {
            if (l.id !== prev) return l;
            const newW = Math.max(10, l.width * ratio);
            const newH = Math.max(10, l.height * ratio);
            const cx = l.x + l.width / 2;
            const cy = l.y + l.height / 2;
            return { ...l, width: newW, height: newH, x: cx - newW / 2, y: cy - newH / 2 };
          })
        );
        return prev;
      });
    }
  }, []);

  const onTouchEnd = useCallback(() => {
    pinchRef.current = null;
  }, []);

  useEffect(() => {
    const el = clipAreaRef.current;
    if (!el) return;
    el.addEventListener("touchstart", onTouchStart, { passive: false });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
    };
  }, [onTouchStart, onTouchMove, onTouchEnd, bbox]);

  // ── Track clip area pixel size via ResizeObserver ───────────────────────────
  // Use offsetWidth/offsetHeight (integer CSS pixels) so the boundary values
  // match the coordinate space of layer.x/y/width/height exactly.
  useEffect(() => {
    const el = clipAreaRef.current;
    if (!el) return;
    const update = () => {
      setClipSize({ w: el.offsetWidth, h: el.offsetHeight });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [bbox]);

  // ── Compute print dimensions in cm for any layer, capped at box size ───────
  const selectedLayer = layers.find(l => l.id === selectedLayerId) ?? null;

  const layerPrintDim = (layer: DesignLayer) => {
    if (!clipSize || !realWidth || !realHeight) return null;
    const visibleW = Math.max(0, Math.min(clipSize.w, layer.x + layer.width) - Math.max(0, layer.x));
    const visibleH = Math.max(0, Math.min(clipSize.h, layer.y + layer.height) - Math.max(0, layer.y));
    const w = Math.round((visibleW / clipSize.w) * realWidth * 10) / 10;
    const h = Math.round((visibleH / clipSize.h) * realHeight * 10) / 10;
    return { w, h };
  };

  const printDim = selectedLayer ? layerPrintDim(selectedLayer) : null;

  // ── Zoom helpers ───────────────────────────────────────────────────────────

  const zoomSelected = useCallback((direction: "in" | "out") => {
    setLayers(prev =>
      prev.map(l => {
        if (l.id !== selectedLayerId) return l;
        const factor = direction === "in" ? 1 + ZOOM_STEP_BUTTON : 1 - ZOOM_STEP_BUTTON;
        const newW = Math.max(10, l.width * factor);
        const newH = Math.max(10, l.height * factor);
        const cx = l.x + l.width / 2;
        const cy = l.y + l.height / 2;
        return { ...l, width: newW, height: newH, x: cx - newW / 2, y: cy - newH / 2 };
      })
    );
  }, [selectedLayerId]);

  // ── Rotate helpers ─────────────────────────────────────────────────────────

  const rotateSelected = useCallback((direction: "cw" | "ccw") => {
    setLayers(prev =>
      prev.map(l => {
        if (l.id !== selectedLayerId) return l;
        const delta = direction === "cw" ? ROTATE_STEP : -ROTATE_STEP;
        return { ...l, rotation: (l.rotation + delta + 360) % 360 };
      })
    );
  }, [selectedLayerId]);

  // ── Hold-to-repeat for zoom/rotate buttons ────────────────────────────────

  const startHold = useCallback((action: () => void) => {
    holdActionRef.current = action;
    action();
    holdTimerRef.current.timeout = setTimeout(() => {
      holdTimerRef.current.interval = setInterval(() => {
        holdActionRef.current?.();
      }, 60);
    }, 350);
  }, []);

  const stopHold = useCallback(() => {
    if (holdTimerRef.current.timeout) clearTimeout(holdTimerRef.current.timeout);
    if (holdTimerRef.current.interval) clearInterval(holdTimerRef.current.interval);
    holdTimerRef.current = { timeout: null, interval: null };
    holdActionRef.current = null;
  }, []);

  // ── Add Image — place first, then auto-open editor ────────────────────────

  const handleAddImage = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.click();
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      setUploading(true);
      try {
        const formData = new FormData();
        formData.append("file", file, file.name);
        const res = await fetch("/api/uploads", { method: "POST", body: formData });
        const data = await res.json();

        const clipEl2 = clipAreaRef.current;
        const clipW = clipEl2?.offsetWidth ?? 200;
        const clipH = clipEl2?.offsetHeight ?? 200;

        const natural = await new Promise<{ w: number; h: number }>((resolve) => {
          const img = new Image();
          img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
          img.onerror = () => resolve({ w: 1, h: 1 });
          img.src = data.url;
        });

        const maxW = clipW * 0.6;
        const maxH = clipH * 0.6;
        const ratio = natural.w / natural.h;
        let defaultW: number, defaultH: number;
        if (ratio > maxW / maxH) {
          defaultW = maxW;
          defaultH = maxW / ratio;
        } else {
          defaultH = maxH;
          defaultW = maxH * ratio;
        }
        defaultW = Math.round(defaultW);
        defaultH = Math.round(defaultH);

        const newLayer: DesignLayer = {
          id: crypto.randomUUID(),
          name: `Layer ${layers.length + 1}`,
          imageUrl: data.url,
          x: Math.round((clipW - defaultW) / 2),
          y: Math.round((clipH - defaultH) / 2),
          width: defaultW,
          height: defaultH,
          rotation: 0,
          visible: true,
          naturalWidth: natural.w,
          naturalHeight: natural.h,
        };
        setLayers(prev => [...prev, newLayer]);
        setSelectedLayerId(newLayer.id);
        // Auto-open editor so user can immediately refine (remove bg, crop, etc.)
        setEditingLayerId(newLayer.id);
        setEditorFile(file);
      } finally {
        setUploading(false);
      }
    };
  }, [layers.length]);

  // Called when user confirms from the editor (passes edited blob)
  const handleEditorConfirm = useCallback(async (blob: Blob) => {
    const targetLayerId = editingLayerId;
    setEditorFile(null);
    setEditingLayerId(null);
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", blob, "design.png");
      const res = await fetch("/api/uploads", { method: "POST", body: formData });
      const data = await res.json();

      if (targetLayerId) {
        // Update existing layer's image in-place
        setLayers(prev => prev.map(l => l.id === targetLayerId ? { ...l, imageUrl: data.url } : l));
        return;
      }

      const clipEl2 = clipAreaRef.current;
      const clipW = clipEl2?.offsetWidth ?? 200;
      const clipH = clipEl2?.offsetHeight ?? 200;

      const natural = await new Promise<{ w: number; h: number }>((resolve) => {
        const img = new Image();
        img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
        img.onerror = () => resolve({ w: 1, h: 1 });
        img.src = data.url;
      });

      const maxW = clipW * 0.6;
      const maxH = clipH * 0.6;
      const ratio = natural.w / natural.h;
      let defaultW: number, defaultH: number;
      if (ratio > maxW / maxH) {
        defaultW = maxW;
        defaultH = maxW / ratio;
      } else {
        defaultH = maxH;
        defaultW = maxH * ratio;
      }
      defaultW = Math.round(defaultW);
      defaultH = Math.round(defaultH);

      const newLayer: DesignLayer = {
        id: crypto.randomUUID(),
        name: `Layer ${layers.length + 1}`,
        imageUrl: data.url,
        x: Math.round((clipW - defaultW) / 2),
        y: Math.round((clipH - defaultH) / 2),
        width: defaultW,
        height: defaultH,
        rotation: 0,
        visible: true,
        naturalWidth: natural.w,
        naturalHeight: natural.h,
      };
      setLayers(prev => [...prev, newLayer]);
      setSelectedLayerId(newLayer.id);
    } finally {
      setUploading(false);
    }
  }, [layers.length, editingLayerId]);

  // Open editor for an existing layer
  const startEditLayer = useCallback(async (layer: DesignLayer) => {
    try {
      const res = await fetch(layer.imageUrl);
      const blob = await res.blob();
      const file = new File([blob], "layer.png", { type: blob.type || "image/png" });
      setEditingLayerId(layer.id);
      setEditorFile(file);
    } catch {
      // silently ignore fetch errors
    }
  }, []);

  const removeLayer = (id: string) => {
    setLayers(prev => prev.filter(l => l.id !== id));
    if (selectedLayerId === id) setSelectedLayerId(null);
  };

  const toggleVisibility = (id: string) => {
    setLayers(prev => prev.map(l => l.id === id ? { ...l, visible: !l.visible } : l));
  };

  const moveLayerUp = (id: string) => {
    setLayers(prev => {
      const idx = prev.findIndex(l => l.id === id);
      if (idx >= prev.length - 1) return prev;
      const next = [...prev];
      [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
      return next.map((l, i) => ({ ...l, name: `Layer ${i + 1}` }));
    });
  };

  const moveLayerDown = (id: string) => {
    setLayers(prev => {
      const idx = prev.findIndex(l => l.id === id);
      if (idx <= 0) return prev;
      const next = [...prev];
      [next[idx], next[idx - 1]] = [next[idx - 1], next[idx]];
      return next.map((l, i) => ({ ...l, name: `Layer ${i + 1}` }));
    });
  };

  // ── Export ─────────────────────────────────────────────────────────────────

  const handleExport = useCallback(async () => {
    const clipEl = clipAreaRef.current;
    if (!clipEl || !realWidth || !realHeight || !bbox) return;

    const visibleLayers = layers.filter(l => l.visible);
    if (visibleLayers.length === 0) return;

    setExporting(true);
    try {
      // ── Load every image fresh via fetch() → blob URL ────────────────────────
      type Loaded = { layer: DesignLayer; img: HTMLImageElement; blobUrl: string };
      const loaded: Loaded[] = [];
      for (const layer of visibleLayers) {
        try {
          const res = await fetch(layer.imageUrl);
          if (!res.ok) continue;
          const blob = await res.blob();
          const blobUrl = URL.createObjectURL(blob);
          const img = await new Promise<HTMLImageElement>((resolve, reject) => {
            const i = new Image();
            i.onload = () => resolve(i);
            i.onerror = () => reject(new Error("load failed"));
            i.src = blobUrl;
          });
          loaded.push({ layer, img, blobUrl });
        } catch { /* skip */ }
      }
      if (loaded.length === 0) return;

      // ── Read clip dimensions right before drawing ─────────────────────────────
      // Use offsetWidth/offsetHeight (integer, no sub-pixel rounding) to avoid
      // fractional getBoundingClientRect values that can shift the scale factor.
      const clipW = clipEl.offsetWidth;
      const clipH = clipEl.offsetHeight;
      if (!clipW || !clipH) return;

      // ── Determine export scale ────────────────────────────────────────────────
      // Take the highest native resolution available from any loaded image.
      let maxNaturalScale = 1;
      for (const { layer, img } of loaded) {
        if (layer.width > 0)  maxNaturalScale = Math.max(maxNaturalScale, img.naturalWidth  / layer.width);
        if (layer.height > 0) maxNaturalScale = Math.max(maxNaturalScale, img.naturalHeight / layer.height);
      }
      // 300 DPI target for the real-world bounding box size.
      const printScale = Math.max(
        (realWidth  / 2.54 * 300) / clipW,
        (realHeight / 2.54 * 300) / clipH,
      );
      // Cap at 8 192 px on the long edge to stay within browser limits.
      const MAX_SIDE    = 8192;
      const rawScale    = Math.max(maxNaturalScale, printScale);
      const exportScale = Math.min(Math.max(rawScale, 1), MAX_SIDE / clipW, MAX_SIDE / clipH);

      const exportW = Math.round(clipW * exportScale);
      const exportH = Math.round(clipH * exportScale);

      // ── Build export canvas ───────────────────────────────────────────────────
      // Scale the context so we can work entirely in CSS-pixel coordinates (the
      // same coordinate space as layer.x / layer.y / layer.width / layer.height).
      // This eliminates any per-axis rounding drift.
      const canvas = document.createElement("canvas");
      canvas.width  = exportW;
      canvas.height = exportH;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";

      // Scale context: 1 CSS pixel → exportScale canvas pixels.
      const sx = exportW / clipW;
      const sy = exportH / clipH;
      ctx.scale(sx, sy);

      // Enforce the bounding-box boundary in CSS-pixel space.
      // Anything outside (0,0)-(clipW,clipH) is invisible in the DOM too.
      ctx.beginPath();
      ctx.rect(0, 0, clipW, clipH);
      ctx.clip();

      // Draw each layer at its exact CSS-pixel position — mirrors the DOM exactly.
      for (const { layer, img } of loaded) {
        const cx    = layer.x + layer.width  / 2;
        const cy    = layer.y + layer.height / 2;
        const angle = (layer.rotation * Math.PI) / 180;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(angle);
        ctx.drawImage(img, -layer.width / 2, -layer.height / 2, layer.width, layer.height);
        ctx.restore();
      }

      // Clean up blob URLs
      for (const { blobUrl } of loaded) URL.revokeObjectURL(blobUrl);

      // ── DTF edge sharpening ───────────────────────────────────────────────────
      // Sharpen kernel + hard alpha threshold so edges are crisp for DTF printing.
      {
        const id = ctx.getImageData(0, 0, exportW, exportH);
        const src = id.data;
        const dst = new Uint8ClampedArray(src);
        const w = exportW, h = exportH;
        // Strong unsharp kernel: centre=9, neighbours=−1 (8-connected)
        for (let y = 1; y < h - 1; y++) {
          for (let x = 1; x < w - 1; x++) {
            const i = (y * w + x) * 4;
            if (src[i + 3] === 0) continue;          // skip fully transparent
            for (let c = 0; c < 3; c++) {
              const v =
                9  * src[i + c]
                - src[((y-1)*w + (x-1))*4 + c]
                - src[((y-1)*w +  x   )*4 + c]
                - src[((y-1)*w + (x+1))*4 + c]
                - src[( y   *w + (x-1))*4 + c]
                - src[( y   *w + (x+1))*4 + c]
                - src[((y+1)*w + (x-1))*4 + c]
                - src[((y+1)*w +  x   )*4 + c]
                - src[((y+1)*w + (x+1))*4 + c];
              dst[i + c] = Math.max(0, Math.min(255, v));
            }
          }
        }
        // High-contrast alpha S-curve — preserves smooth curves while eliminating
        // faint semi-transparent fringes for DTF. 8x boost around the midpoint:
        // alpha < ~112 → 0,  alpha > ~144 → 255,  curve boundary stays smooth.
        for (let i = 3; i < dst.length; i += 4) {
          dst[i] = Math.max(0, Math.min(255, Math.round(8 * (src[i] - 128) + 128)));
        }
        ctx.putImageData(new ImageData(dst, w, h), 0, 0);
      }

      // ── Compute filename from the actual visible design size ─────────────────
      // Union of all visible layer rects, clamped to the clip area, converted
      // to real-world cm so the name reflects what the user currently sees.
      let visMinX = clipW, visMaxX = 0;
      let visMinY = clipH, visMaxY = 0;
      for (const { layer } of loaded) {
        const lx = Math.max(0, layer.x);
        const ly = Math.max(0, layer.y);
        const rx = Math.min(clipW, layer.x + layer.width);
        const ry = Math.min(clipH, layer.y + layer.height);
        if (rx > lx && ry > ly) {
          visMinX = Math.min(visMinX, lx);
          visMaxX = Math.max(visMaxX, rx);
          visMinY = Math.min(visMinY, ly);
          visMaxY = Math.max(visMaxY, ry);
        }
      }
      const visCmW = visMaxX > visMinX
        ? Math.round((visMaxX - visMinX) / clipW * realWidth * 10) / 10
        : Math.round(realWidth * 10) / 10;
      const visCmH = visMaxY > visMinY
        ? Math.round((visMaxY - visMinY) / clipH * realHeight * 10) / 10
        : Math.round(realHeight * 10) / 10;

      // ── Download ─────────────────────────────────────────────────────────────
      const filename = `${visCmW}x${visCmH}cm.png`;

      canvas.toBlob(blob => {
        if (!blob) { alert("Export failed — could not generate image."); return; }
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
      }, "image/png");
    } finally {
      setExporting(false);
    }
  }, [layers, realWidth, realHeight, bbox]);

  if (!selectedProduct || !selectedFit || !selectedColor || !selectedSize) return null;

  const effectiveWidth = adminWidthOverride ?? mockup?.viewerWidthPct ?? 80;

  const handleAdminResize = (direction: "bigger" | "smaller") => {
    const next = Math.min(100, Math.max(20, effectiveWidth + (direction === "bigger" ? 5 : -5)));
    setAdminWidthOverride(next);
    saveMockupMutation.mutate({
      data: {
        productId: selectedProduct.id,
        fitId: selectedFit.id,
        colorId: selectedColor.id,
        viewerWidthPct: next,
        viewerAspectW: mockup?.viewerAspectW ?? 3,
        viewerAspectH: mockup?.viewerAspectH ?? 4,
      },
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetMockupQueryKey({ productId: selectedProduct.id, fitId: selectedFit.id, colorId: selectedColor.id }) });
        setAdminWidthOverride(null);
      },
    });
  };

  return (
    <>
    {editorFile && (
      <ImageEditor
        file={editorFile}
        onConfirm={handleEditorConfirm}
        onCancel={() => { setEditorFile(null); setEditingLayerId(null); }}
      />
    )}
    <div className="h-screen overflow-hidden pt-20 flex flex-col bg-background">

      <div className="flex flex-1 overflow-hidden">

        {/* ── Left sidebar — Layers ── */}
        <div className="w-56 border-r border-border flex flex-col shrink-0 overflow-hidden">
          <div className="flex-1 overflow-y-auto no-scrollbar">
            <div className="p-5">
              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-4">
                Layers {layers.length > 0 && `(${layers.length})`}
              </p>

              {layers.length === 0 ? (
                <p className="text-xs text-muted-foreground uppercase tracking-widest leading-relaxed">
                  No layers yet. Add an image to start designing.
                </p>
              ) : (
                <div className="space-y-2">
                  {[...layers].reverse().map((layer, reversedIdx) => {
                    const trueIdx = layers.length - 1 - reversedIdx;
                    const isSelected = selectedLayerId === layer.id;
                    const dim = layerPrintDim(layer);
                    return (
                      <motion.div
                        key={layer.id}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        className={`border transition-colors ${isSelected ? "border-foreground bg-muted/10" : "border-border hover:border-muted-foreground/40"}`}
                      >
                        <div
                          className="flex items-center gap-2 px-3 py-2 cursor-pointer"
                          onClick={() => setSelectedLayerId(isSelected ? null : layer.id)}
                        >
                          <div className="w-8 h-8 border border-border overflow-hidden shrink-0"
                            style={{
                              backgroundImage: "linear-gradient(45deg, #2a2a2a 25%, transparent 25%), linear-gradient(-45deg, #2a2a2a 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #2a2a2a 75%), linear-gradient(-45deg, transparent 75%, #2a2a2a 75%)",
                              backgroundSize: "6px 6px",
                              backgroundPosition: "0 0, 0 3px, 3px -3px, -3px 0px",
                              backgroundColor: "#1a1a1a",
                            }}
                          >
                            <img src={layer.imageUrl} alt="" className="w-full h-full object-contain" />
                          </div>

                          <div className="flex-1 min-w-0">
                            {dim ? (
                              <p className="text-xs font-bold font-mono tracking-widest truncate">
                                {dim.w} × {dim.h} cm
                              </p>
                            ) : (
                              <p className="text-xs font-bold uppercase tracking-widest truncate">
                                {layer.name}
                              </p>
                            )}
                            {layer.rotation !== 0 && (
                              <p className="text-xs text-muted-foreground font-mono">{layer.rotation}°</p>
                            )}
                          </div>

                          <button
                            onClick={e => { e.stopPropagation(); toggleVisibility(layer.id); }}
                            className="text-muted-foreground hover:text-foreground transition-colors text-xs p-0.5"
                            title={layer.visible ? "Hide" : "Show"}
                          >
                            {layer.visible ? "👁" : "🙈"}
                          </button>
                        </div>

                        {isSelected && (
                          <div className="px-3 pb-3 space-y-2 border-t border-border pt-2">
                            <button
                              onClick={() => startEditLayer(layer)}
                              className="w-full text-xs py-1.5 border border-border hover:border-foreground transition-colors uppercase tracking-widest font-bold"
                              title="Edit image"
                            >
                              ✏ Edit Image
                            </button>
                            <div className="flex gap-1.5">
                              <button
                                onMouseDown={() => startHold(() => zoomSelected("out"))}
                                onMouseUp={stopHold}
                                onMouseLeave={stopHold}
                                onTouchStart={e => { e.preventDefault(); startHold(() => zoomSelected("out")); }}
                                onTouchEnd={stopHold}
                                className="flex-1 text-xs py-1 border border-border hover:border-foreground transition-colors uppercase tracking-widest font-bold select-none"
                                title="Zoom Out"
                              >
                                − Zoom
                              </button>
                              <button
                                onMouseDown={() => startHold(() => zoomSelected("in"))}
                                onMouseUp={stopHold}
                                onMouseLeave={stopHold}
                                onTouchStart={e => { e.preventDefault(); startHold(() => zoomSelected("in")); }}
                                onTouchEnd={stopHold}
                                className="flex-1 text-xs py-1 border border-border hover:border-foreground transition-colors uppercase tracking-widest font-bold select-none"
                                title="Zoom In"
                              >
                                + Zoom
                              </button>
                            </div>
                            <div className="flex gap-1.5">
                              <button
                                onMouseDown={() => startHold(() => rotateSelected("ccw"))}
                                onMouseUp={stopHold}
                                onMouseLeave={stopHold}
                                onTouchStart={e => { e.preventDefault(); startHold(() => rotateSelected("ccw")); }}
                                onTouchEnd={stopHold}
                                className="flex-1 text-xs py-1 border border-border hover:border-foreground transition-colors uppercase tracking-widest font-bold select-none"
                                title="Rotate CCW"
                              >
                                ↺ Rotate
                              </button>
                              <button
                                onMouseDown={() => startHold(() => rotateSelected("cw"))}
                                onMouseUp={stopHold}
                                onMouseLeave={stopHold}
                                onTouchStart={e => { e.preventDefault(); startHold(() => rotateSelected("cw")); }}
                                onTouchEnd={stopHold}
                                className="flex-1 text-xs py-1 border border-border hover:border-foreground transition-colors uppercase tracking-widest font-bold select-none"
                                title="Rotate CW"
                              >
                                ↻ Rotate
                              </button>
                            </div>
                            <div className="flex gap-1.5">
                              <button
                                onClick={() => moveLayerUp(layer.id)}
                                disabled={trueIdx === layers.length - 1}
                                className="flex-1 text-xs py-1 border border-border hover:border-foreground transition-colors disabled:opacity-30 uppercase tracking-widest"
                                title="Move up"
                              >
                                ↑ Up
                              </button>
                              <button
                                onClick={() => moveLayerDown(layer.id)}
                                disabled={trueIdx === 0}
                                className="flex-1 text-xs py-1 border border-border hover:border-foreground transition-colors disabled:opacity-30 uppercase tracking-widest"
                                title="Move down"
                              >
                                ↓ Down
                              </button>
                              <button
                                onClick={() => removeLayer(layer.id)}
                                className="text-xs py-1 px-2 border border-destructive/40 text-destructive hover:bg-destructive/10 transition-colors uppercase tracking-widest"
                                title="Delete layer"
                              >
                                ✕
                              </button>
                            </div>
                          </div>
                        )}
                      </motion.div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Main canvas — checkerboard fills entire center ── */}
        <div
          className="flex-1 flex flex-col items-center overflow-hidden"
          style={{
            backgroundImage:
              "linear-gradient(45deg, #2a2a2a 25%, transparent 25%), linear-gradient(-45deg, #2a2a2a 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #2a2a2a 75%), linear-gradient(-45deg, transparent 75%, #2a2a2a 75%)",
            backgroundSize: "24px 24px",
            backgroundPosition: "0 0, 0 12px, 12px -12px, -12px 0px",
            backgroundColor: "#1a1a1a",
          }}
        >

          {/* Front / Back toggle */}
          <div className="shrink-0 flex gap-0 mt-4 mb-3 border border-border/60">
            {(["front", "back"] as const).map(s => (
              <button
                key={s}
                onClick={() => setSide(s)}
                className={`px-6 py-2 text-xs uppercase tracking-widest font-medium transition-colors ${side === s ? "bg-foreground text-background" : "bg-background/20 text-foreground hover:bg-muted/20"}`}
              >
                {s}
              </button>
            ))}
          </div>

          {/* Mockup viewer — fills remaining height, no bottom gap */}
          <div
            className="flex-1 min-h-0 relative"
            style={{
              width: `${effectiveWidth}%`,
              maxWidth: "100%",
              transition: "width 0.15s ease",
            }}
          >
            <AnimatePresence mode="wait">
              <motion.div
                key={side}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="absolute inset-0"
              >
                {currentSide?.image ? (
                  <img
                    src={currentSide.image}
                    alt={`${side} mockup`}
                    className="w-full h-full object-contain pointer-events-none"
                    style={{ position: "relative", zIndex: 1 }}
                  />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center gap-3 border border-dashed border-border">
                    <span className="text-5xl text-muted-foreground/20 font-black uppercase">{side[0]}</span>
                    <p className="text-xs uppercase tracking-widest text-muted-foreground/50">
                      No mockup for {side} view
                    </p>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>

            {/* ── Design clip area ── */}
            {bbox && (
              <div
                ref={clipAreaRef}
                style={{
                  position: "absolute",
                  left: `${bbox.x}%`,
                  top: `${bbox.y}%`,
                  width: `${bbox.width}%`,
                  height: `${bbox.height}%`,
                  overflow: "hidden",
                  zIndex: 5,
                }}
              >
                {layers.map((layer) =>
                  layer.visible ? (
                    <img
                      key={layer.id}
                      src={layer.imageUrl}
                      alt={layer.name}
                      draggable={false}
                      onMouseDown={e => startDrag(e, layer)}
                      style={{
                        position: "absolute",
                        left: layer.x,
                        top: layer.y,
                        width: layer.width,
                        height: layer.height,
                        minWidth: layer.width,
                        minHeight: layer.height,
                        maxWidth: "none",
                        maxHeight: "none",
                        transform: `rotate(${layer.rotation}deg)`,
                        transformOrigin: "center center",
                        cursor: dragRef.current?.layerId === layer.id ? "grabbing" : "grab",
                        userSelect: "none",
                        background: "none",
                        flexShrink: 0,
                        imageRendering: "high-quality" as React.CSSProperties["imageRendering"],
                      }}
                    />
                  ) : null
                )}

                {/* ── Print dimension label for selected layer ── */}
                {selectedLayer && selectedLayer.visible && printDim && clipSize && (
                  <div
                    style={{
                      position: "absolute",
                      left: (Math.max(0, selectedLayer.x) + Math.min(clipSize.w, selectedLayer.x + selectedLayer.width)) / 2,
                      top: (Math.max(0, selectedLayer.y) + Math.min(clipSize.h, selectedLayer.y + selectedLayer.height)) / 2,
                      transform: "translateX(-50%) translateY(-50%)",
                      pointerEvents: "none",
                      zIndex: 20,
                      whiteSpace: "nowrap",
                    }}
                  >
                    <span style={{
                      display: "inline-flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 2,
                      background: "rgba(0,0,0,0.65)",
                      color: "#fff",
                      fontFamily: "monospace",
                      fontWeight: 700,
                      fontSize: "11px",
                      letterSpacing: "0.08em",
                      padding: "4px 8px",
                      borderRadius: 2,
                      backdropFilter: "blur(4px)",
                      border: "1px solid rgba(255,255,255,0.15)",
                      textAlign: "center",
                    }}>
                      <span>{printDim.w} × {printDim.h} cm</span>
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* ── Bbox border overlay ── */}
            {bbox && (
              <div
                style={{
                  position: "absolute",
                  left: `${bbox.x}%`,
                  top: `${bbox.y}%`,
                  width: `${bbox.width}%`,
                  height: `${bbox.height}%`,
                  border: layers.length === 0 ? "1px dashed rgba(255,255,255,0.18)" : "none",
                  zIndex: 6,
                  pointerEvents: "none",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 2,
                }}
              >
                {layers.length === 0 && realWidth > 0 && (
                  <>
                    <p style={{ fontSize: "clamp(10px, 2vw, 18px)", fontWeight: 900, fontFamily: "monospace", color: "rgba(255,255,255,0.4)", lineHeight: 1 }}>
                      {realWidth} × {realHeight}
                    </p>
                    <p style={{ fontSize: "clamp(8px, 1vw, 10px)", color: "rgba(255,255,255,0.25)", letterSpacing: "0.12em", textTransform: "uppercase", fontFamily: "monospace" }}>
                      cm
                    </p>
                  </>
                )}
              </div>
            )}

            {!bbox && currentSide?.image && (
              <div className="absolute inset-x-0 bottom-4 flex justify-center pointer-events-none" style={{ zIndex: 5 }}>
                <p className="text-xs text-muted-foreground/60 uppercase tracking-widest">
                  No bounding box set — configure it in the Admin Panel
                </p>
              </div>
            )}
          </div>
        </div>

        {/* ── Right sidebar ── */}
        <div className="w-72 border-l border-border flex flex-col shrink-0 overflow-hidden">

          {/* Config summary */}
          <div className="p-6 border-b border-border">
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">Configuration</p>
            <div className="space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground uppercase tracking-widest">Product</span>
                <span className="font-bold uppercase">{selectedProduct.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground uppercase tracking-widest">Fit</span>
                <span className="font-bold uppercase">{selectedFit.name}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground uppercase tracking-widest">Color</span>
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 border border-border" style={{ backgroundColor: selectedColor.hex }} />
                  <span className="font-bold uppercase">{selectedColor.name}</span>
                </div>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground uppercase tracking-widest">Size</span>
                <span className="font-bold uppercase">{selectedSize.name}</span>
              </div>
              {realWidth > 0 && (
                <div className="flex justify-between pt-1 border-t border-border mt-2">
                  <span className="text-muted-foreground uppercase tracking-widest">Print Area</span>
                  <span className="font-mono font-bold">{realWidth} × {realHeight} cm</span>
                </div>
              )}
              {printDim && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground uppercase tracking-widest">Image Size</span>
                  <span className="font-mono font-bold text-foreground">{printDim.w} × {printDim.h} cm</span>
                </div>
              )}
            </div>
          </div>


          {/* ── Tools ── */}
          <div className="p-6 border-b border-border space-y-3">
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Tools</p>

            {/* Add Image */}
            <button
              onClick={handleAddImage}
              disabled={uploading || !bbox}
              className="w-full flex items-center gap-3 border border-border px-4 py-3 hover:border-foreground hover:bg-muted/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <span className="text-lg leading-none">🖼</span>
              <div className="text-left">
                <p className="text-xs font-bold uppercase tracking-widest">
                  {uploading ? "Uploading…" : "Add Image"}
                </p>
                {!bbox && (
                  <p className="text-xs text-muted-foreground mt-0.5">Set bbox in admin first</p>
                )}
              </div>
            </button>
          </div>

          {/* ── Export ── */}
          {layers.some(l => l.visible) && realWidth > 0 && (
            <div className="px-4 pb-4 pt-2">
              <button
                onClick={handleExport}
                disabled={exporting}
                className="w-full text-xs uppercase tracking-widest font-bold px-5 py-3 bg-foreground text-background hover:opacity-80 transition-opacity disabled:opacity-40"
              >
                {exporting ? "Exporting…" : "Export Design"}
              </button>
            </div>
          )}

          {/* ── (layers moved to left sidebar) ── */}
          <div className="flex-1" /></div>
      </div>
    </div>

    {/* ── Admin resize overlay (fixed, always visible) ── */}
    {isAdmin && (
      <div
        style={{
          position: "fixed",
          bottom: "24px",
          left: "50%",
          transform: "translateX(-50%)",
          display: "flex",
          alignItems: "center",
          gap: "10px",
          zIndex: 9999,
          background: "rgba(0,0,0,0.82)",
          border: "1px solid rgba(255,255,255,0.18)",
          backdropFilter: "blur(12px)",
          padding: "8px 16px",
          borderRadius: "4px",
          whiteSpace: "nowrap",
          boxShadow: "0 4px 24px rgba(0,0,0,0.4)",
        }}
      >
        <span style={{ fontSize: "9px", color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.12em", fontFamily: "monospace" }}>
          Admin · Mockup Size
        </span>
        <button
          onClick={() => handleAdminResize("smaller")}
          disabled={effectiveWidth <= 20 || saveMockupMutation.isPending}
          style={{
            background: "transparent",
            border: "1px solid rgba(255,255,255,0.3)",
            color: "#fff",
            fontSize: "12px",
            fontWeight: 700,
            padding: "4px 14px",
            cursor: effectiveWidth <= 20 ? "not-allowed" : "pointer",
            opacity: effectiveWidth <= 20 ? 0.3 : 1,
            fontFamily: "monospace",
            letterSpacing: "0.05em",
            borderRadius: "2px",
          }}
        >
          − Smaller
        </button>
        <span style={{ fontSize: "13px", color: "#fff", fontFamily: "monospace", fontWeight: 700, minWidth: "40px", textAlign: "center" }}>
          {saveMockupMutation.isPending ? "…" : `${effectiveWidth}%`}
        </span>
        <button
          onClick={() => handleAdminResize("bigger")}
          disabled={effectiveWidth >= 100 || saveMockupMutation.isPending}
          style={{
            background: "transparent",
            border: "1px solid rgba(255,255,255,0.3)",
            color: "#fff",
            fontSize: "12px",
            fontWeight: 700,
            padding: "4px 14px",
            cursor: effectiveWidth >= 100 ? "not-allowed" : "pointer",
            opacity: effectiveWidth >= 100 ? 0.3 : 1,
            fontFamily: "monospace",
            letterSpacing: "0.05em",
            borderRadius: "2px",
          }}
        >
          + Bigger
        </button>
      </div>
    )}
    </>
  );
}

