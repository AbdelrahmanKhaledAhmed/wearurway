import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation, useSearch } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { useGetMockup, useSaveMockup, getGetMockupQueryKey } from "@workspace/api-client-react";
import { useCustomizer } from "@/hooks/use-customizer";
import { useToast } from "@/hooks/use-toast";
import ImageEditor, { type ImageEditResult } from "@/components/ImageEditor";
import TextLayerModal from "@/components/TextLayerModal";
import OrderReviewModal from "@/components/OrderReviewModal";

interface BBox { x: number; y: number; width: number; height: number }

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
const MIN_LAYER_SIZE = 10;
const MAX_LAYER_SCALE = 200;
const ROTATE_STEP = 1;

const SAVE_KEY = (productId: string, fitId: string, colorId: string) =>
  `ww_design_${productId}_${fitId}_${colorId}`;

async function blobUrlToDataUrl(url: string): Promise<string> {
  if (!url.startsWith("blob:")) return url;
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
    return url;
  }
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function Design() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const isAdminPreview = new URLSearchParams(search).get("admin") === "1";
  const shareId = new URLSearchParams(search).get("share");
  const { selectedProduct, selectedFit, selectedColor, selectedSize, setProduct, setFit, setColor, setSize, reset } = useCustomizer();
  const { toast } = useToast();
  const saveMockup = useSaveMockup();
  const [side, setSide] = useState<"front" | "back">("front");
  const [localFrontBbox, setLocalFrontBbox] = useState<BBox | null>(null);
  const [localBackBbox, setLocalBackBbox] = useState<BBox | null>(null);
  const [mockupSize, setMockupSize] = useState(320);
  const [mockupOffsetY, setMockupOffsetY] = useState(0);

  const [frontLayers, setFrontLayers] = useState<DesignLayer[]>([]);
  const [backLayers, setBackLayers] = useState<DesignLayer[]>([]);
  const sideRef = useRef(side);
  sideRef.current = side;
  const layers = side === "front" ? frontLayers : backLayers;
  const setLayers = useCallback((updater: React.SetStateAction<DesignLayer[]>) => {
    if (sideRef.current === "front") setFrontLayers(updater);
    else setBackLayers(updater);
  }, []);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [shareLoading, setShareLoading] = useState(() => !!shareId);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [showOrderModal, setShowOrderModal] = useState(false);
  const [clipSize, setClipSize] = useState<{ w: number; h: number } | null>(null);
  const [editorFile, setEditorFile] = useState<File | null>(null);
  const [editingLayerId, setEditingLayerId] = useState<string | null>(null);
  const [newUploadLayerId, setNewUploadLayerId] = useState<string | null>(null);
  const [showTextModal, setShowTextModal] = useState(false);

  const [showPlaceholder, setShowPlaceholder] = useState(() => localStorage.getItem("wearurway_show_placeholder") !== "false");
  const [showDimLabel, setShowDimLabel] = useState(() => localStorage.getItem("wearurway_show_dim_label") !== "false");
  const [showExportButton, setShowExportButton] = useState(() => localStorage.getItem("wearurway_show_export_button") !== "false");

  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === "wearurway_show_placeholder") setShowPlaceholder(e.newValue !== "false");
      if (e.key === "wearurway_show_dim_label") setShowDimLabel(e.newValue !== "false");
      if (e.key === "wearurway_show_export_button") setShowExportButton(e.newValue !== "false");
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  const clipAreaRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const pinchRef = useRef<{ dist: number } | null>(null);
  const holdActionRef = useRef<(() => void) | null>(null);
  const holdTimerRef = useRef<{ timeout: ReturnType<typeof setTimeout> | null; interval: ReturnType<typeof setInterval> | null }>({ timeout: null, interval: null });

  useEffect(() => {
    if (shareLoading) return;
    if (!selectedProduct || !selectedFit || !selectedColor || !selectedSize) {
      setLocation("/products");
    }
  }, [shareLoading, selectedProduct, selectedFit, selectedColor, selectedSize, setLocation]);

  const savedDesignLoaded = useRef(false);
  const shareLoadedRef = useRef(false);
  useEffect(() => {
    if (!shareId || shareLoadedRef.current) return;
    shareLoadedRef.current = true;
    fetch(`/api/shared-designs/${shareId}`)
      .then(async r => {
        if (r.status === 410) throw Object.assign(new Error("expired"), { expired: true });
        if (!r.ok) throw new Error("not found");
        return r.json();
      })
      .then((design: { product: Parameters<typeof setProduct>[0]; fit: Parameters<typeof setFit>[0]; color: Parameters<typeof setColor>[0]; size: Parameters<typeof setSize>[0]; frontLayers: DesignLayer[]; backLayers: DesignLayer[] }) => {
        setProduct(design.product);
        setFit(design.fit);
        setColor(design.color);
        setSize(design.size);
        if (design.frontLayers?.length) setFrontLayers(design.frontLayers);
        if (design.backLayers?.length) setBackLayers(design.backLayers);
        savedDesignLoaded.current = true;
      })
      .catch((err: unknown) => {
        const expired = (err instanceof Error) && (err as Error & { expired?: boolean }).expired;
        toast({
          title: expired ? "Design link expired" : "Share link not found",
          description: expired
            ? "This design link has expired. Please ask for a new one."
            : "This design link could not be found.",
        });
        setLocation("/products");
      })
      .finally(() => setShareLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shareId]);

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
  const realWidth = selectedSize?.realWidth ?? 0;
  const realHeight = selectedSize?.realHeight ?? 0;

  const getEditorQualityScale = useCallback(() => {
    const clipEl = clipAreaRef.current;
    const clipW = clipEl?.offsetWidth ?? 0;
    const clipH = clipEl?.offsetHeight ?? 0;
    if (!clipW || !clipH || !realWidth || !realHeight) return 1;
    return Math.max(
      (realWidth / 2.54 * 300) / clipW,
      (realHeight / 2.54 * 300) / clipH,
      1,
    );
  }, [realWidth, realHeight]);

  // Sync local bboxes and display settings when mockup loads
  useEffect(() => {
    if (mockup?.front?.boundingBox) setLocalFrontBbox(mockup.front.boundingBox as BBox);
    if (mockup?.back?.boundingBox) setLocalBackBbox(mockup.back.boundingBox as BBox);
    if (mockup?.mockupSize) setMockupSize(mockup.mockupSize);
    if (mockup?.mockupOffsetY !== undefined) setMockupOffsetY(mockup.mockupOffsetY);
  }, [mockup]);

  useEffect(() => {
    if (!selectedProduct || !selectedFit || !selectedColor) return;
    if (savedDesignLoaded.current) return;
    savedDesignLoaded.current = true;
    const key = SAVE_KEY(selectedProduct.id, selectedFit.id, selectedColor.id);
    const raw = localStorage.getItem(key);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as { frontLayers?: DesignLayer[]; backLayers?: DesignLayer[] };
      if (parsed.frontLayers?.length) setFrontLayers(parsed.frontLayers);
      if (parsed.backLayers?.length) setBackLayers(parsed.backLayers);
    } catch {
      // ignore corrupt data
    }
  }, [selectedProduct, selectedFit, selectedColor]);

  const bbox: BBox | null | undefined = side === "front" ? localFrontBbox : localBackBbox;

  const handleAdminSave = () => {
    if (!selectedProduct || !selectedFit || !selectedColor) return;
    saveMockup.mutate({
      data: {
        productId: selectedProduct.id,
        fitId: selectedFit.id,
        colorId: selectedColor.id,
        front: { image: mockup?.front?.image, boundingBox: localFrontBbox ?? undefined },
        back: { image: mockup?.back?.image, boundingBox: localBackBbox ?? undefined },
        mockupSize,
        mockupOffsetY,
      },
    }, {
      onSuccess: () => toast({ title: "Mockup saved" }),
    });
  };

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

  // Delete selected layer with Delete or Backspace key
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable) return;
      if (!selectedLayerId) return;
      e.preventDefault();
      setLayers(prev => {
        const layer = prev.find(l => l.id === selectedLayerId);
        if (layer?.imageUrl.startsWith("blob:")) URL.revokeObjectURL(layer.imageUrl);
        return prev.filter(l => l.id !== selectedLayerId);
      });
      setSelectedLayerId(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedLayerId, setLayers]);

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

  const getLayerAspectRatio = (layer: DesignLayer) => {
    const naturalRatio =
      layer.naturalWidth > 0 && layer.naturalHeight > 0
        ? layer.naturalWidth / layer.naturalHeight
        : 0;
    const displayRatio =
      layer.width > 0 && layer.height > 0
        ? layer.width / layer.height
        : 1;
    return Number.isFinite(naturalRatio) && naturalRatio > 0
      ? naturalRatio
      : displayRatio;
  };

  const getRatioLockedSize = (layer: DesignLayer, width: number) => {
    const aspect = getLayerAspectRatio(layer);
    const nextW = Math.max(MIN_LAYER_SIZE, width);
    return {
      width: nextW,
      height: Math.max(MIN_LAYER_SIZE, nextW / aspect),
    };
  };

  const scaleLayerAtPoint = useCallback((layer: DesignLayer, factor: number, anchorX?: number, anchorY?: number) => {
    const aspect = getLayerAspectRatio(layer);
    const baseW = Math.max(1, layer.naturalWidth || layer.width);
    const baseH = Math.max(1, layer.naturalHeight || layer.height);
    const maxScale = Math.min(
      MAX_LAYER_SCALE,
      (baseW * MAX_LAYER_SCALE) / Math.max(1, layer.width),
      (baseH * MAX_LAYER_SCALE) / Math.max(1, layer.width / aspect),
    );
    const minScale = Math.max(
      MIN_LAYER_SIZE / Math.max(1, layer.width),
      MIN_LAYER_SIZE / Math.max(1, layer.width / aspect),
    );
    const appliedFactor = Math.min(Math.max(factor, minScale), maxScale);
    const nextW = layer.width * appliedFactor;
    const nextH = nextW / aspect;
    const px = anchorX ?? layer.x + layer.width / 2;
    const py = anchorY ?? layer.y + layer.height / 2;

    return {
      ...layer,
      width: nextW,
      height: nextH,
      x: px - (px - layer.x) * appliedFactor,
      y: py - (py - layer.y) * appliedFactor,
    };
  }, []);

  // ── Scroll wheel zoom on clip area ─────────────────────────────────────────

  const onClipWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const clipRect = clipAreaRef.current?.getBoundingClientRect();
    if (!clipRect) return;
    const anchorX = e.clientX - clipRect.left;
    const anchorY = e.clientY - clipRect.top;
    setSelectedLayerId(prev => {
      if (!prev) return prev;
      setLayers(layers =>
        layers.map(l => {
          if (l.id !== prev) return l;
          const factor = e.deltaY < 0 ? 1 + ZOOM_STEP_SCROLL : 1 - ZOOM_STEP_SCROLL;
          return scaleLayerAtPoint(l, factor, anchorX, anchorY);
        })
      );
      return prev;
    });
  }, [scaleLayerAtPoint]);

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
            return scaleLayerAtPoint(l, ratio);
          })
        );
        return prev;
      });
    }
  }, [scaleLayerAtPoint]);

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

  // ── Compute print dimensions in cm for any layer, locked to image ratio ─────
  const selectedLayer = layers.find(l => l.id === selectedLayerId) ?? null;

  const layerPrintDim = (layer: DesignLayer) => {
    if (!clipSize || !realWidth || !realHeight) return null;
    const { width } = getRatioLockedSize(layer, layer.width);
    const w = Math.round((width / clipSize.w) * realWidth * 10) / 10;
    const h = Math.round((w / getLayerAspectRatio(layer)) * 10) / 10;
    return { w, h };
  };

  const printDim = selectedLayer ? layerPrintDim(selectedLayer) : null;

  // ── Zoom helpers ───────────────────────────────────────────────────────────

  const zoomSelected = useCallback((direction: "in" | "out") => {
    setLayers(prev =>
      prev.map(l => {
        if (l.id !== selectedLayerId) return l;
        const factor = direction === "in" ? 1 + ZOOM_STEP_BUTTON : 1 - ZOOM_STEP_BUTTON;
        return scaleLayerAtPoint(l, factor);
      })
    );
  }, [selectedLayerId, scaleLayerAtPoint]);

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

  // ── Add Image — use a local object URL (never touches the server) ──────────

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
        const objectUrl = URL.createObjectURL(file);

        const clipEl2 = clipAreaRef.current;
        const clipW = clipEl2?.offsetWidth ?? 200;
        const clipH = clipEl2?.offsetHeight ?? 200;

        const natural = await new Promise<{ w: number; h: number }>((resolve) => {
          const img = new Image();
          img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
          img.onerror = () => resolve({ w: 1, h: 1 });
          img.src = objectUrl;
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
          imageUrl: objectUrl,
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
        setNewUploadLayerId(newLayer.id);
        setEditorFile(file);
      } finally {
        setUploading(false);
      }
    };
  }, [layers.length]);

  // Called when user confirms from the editor (passes edited blob)
  const handleEditorConfirm = useCallback(async (blob: Blob, edit: ImageEditResult) => {
    const targetLayerId = editingLayerId;
    setEditorFile(null);
    setEditingLayerId(null);
    setNewUploadLayerId(null);
    setUploading(true);
    try {
      const objectUrl = URL.createObjectURL(blob);

      if (targetLayerId) {
        const natural = await new Promise<{ w: number; h: number }>((resolve) => {
          const img = new Image();
          img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
          img.onerror = () => resolve({ w: edit.width || 1, h: edit.height || 1 });
          img.src = objectUrl;
        });

        setLayers(prev => prev.map(l => {
          if (l.id !== targetLayerId) return l;
          // Revoke the old object URL to free browser memory
          if (l.imageUrl.startsWith("blob:")) URL.revokeObjectURL(l.imageUrl);
          const baseW = Math.max(1, edit.originalWidth || l.naturalWidth || l.width);
          const baseH = Math.max(1, edit.originalHeight || l.naturalHeight || l.height);
          const scale = l.width / baseW;
          const nextW = Math.max(MIN_LAYER_SIZE, edit.width * scale);
          const aspect = natural.w > 0 && natural.h > 0 ? natural.w / natural.h : edit.width / edit.height;
          return {
            ...l,
            imageUrl: objectUrl,
            x: l.x + edit.x * scale,
            y: l.y + edit.y * (l.height / baseH),
            width: nextW,
            height: nextW / aspect,
            naturalWidth: natural.w,
            naturalHeight: natural.h,
          };
        }));
        return;
      }

      const clipEl2 = clipAreaRef.current;
      const clipW = clipEl2?.offsetWidth ?? 200;
      const clipH = clipEl2?.offsetHeight ?? 200;

      const natural = await new Promise<{ w: number; h: number }>((resolve) => {
        const img = new Image();
        img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
        img.onerror = () => resolve({ w: 1, h: 1 });
        img.src = objectUrl;
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
        imageUrl: objectUrl,
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

  // Add text layer from TextLayerModal blob
  const handleAddTextBlob = useCallback(async (blob: Blob) => {
    setShowTextModal(false);
    const objectUrl = URL.createObjectURL(blob);
    const clipEl = clipAreaRef.current;
    const clipW = clipEl?.offsetWidth ?? 200;
    const clipH = clipEl?.offsetHeight ?? 200;
    const natural = await new Promise<{ w: number; h: number }>((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => resolve({ w: 1, h: 1 });
      img.src = objectUrl;
    });
    const maxW = clipW * 0.6;
    const maxH = clipH * 0.4;
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
      name: `Text ${layers.length + 1}`,
      imageUrl: objectUrl,
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
  }, [layers.length]);

  const removeLayer = (id: string) => {
    setLayers(prev => {
      const layer = prev.find(l => l.id === id);
      if (layer?.imageUrl.startsWith("blob:")) URL.revokeObjectURL(layer.imageUrl);
      return prev.filter(l => l.id !== id);
    });
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

  const loadCanvasImage = async (src?: string): Promise<HTMLImageElement | null> => {
    if (!src) return null;
    try {
      const res = await fetch(src);
      if (!res.ok) return null;
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      return await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          URL.revokeObjectURL(blobUrl);
          resolve(img);
        };
        img.onerror = () => {
          URL.revokeObjectURL(blobUrl);
          reject(new Error("image load failed"));
        };
        img.src = blobUrl;
      });
    } catch {
      return null;
    }
  };

  const drawImageContain = (
    ctx: CanvasRenderingContext2D,
    img: HTMLImageElement,
    x: number,
    y: number,
    w: number,
    h: number,
  ) => {
    const ratio = Math.min(w / img.naturalWidth, h / img.naturalHeight);
    const drawW = img.naturalWidth * ratio;
    const drawH = img.naturalHeight * ratio;
    ctx.drawImage(img, x + (w - drawW) / 2, y + (h - drawH) / 2, drawW, drawH);
  };

  const uploadBlobUrl = useCallback(async (url: string): Promise<{ url: string; filename: string | null }> => {
    if (!url.startsWith("blob:")) return { url, filename: null };
    const res = await fetch(url);
    const blob = await res.blob();
    const form = new FormData();
    form.append("file", blob, "layer.png");
    const uploadRes = await fetch("/api/shared-layers", { method: "POST", body: form });
    if (!uploadRes.ok) throw new Error("Upload failed");
    const { url: serverUrl, filename } = await uploadRes.json() as { url: string; filename: string };
    return { url: serverUrl, filename };
  }, []);

  const handleShareDesign = useCallback(async () => {
    if (!selectedProduct || !selectedFit || !selectedColor || !selectedSize) return;
    setSharing(true);
    try {
      const layerFilenames: string[] = [];
      const serializeLayers = async (ls: DesignLayer[]) =>
        Promise.all(ls.map(async l => {
          const { url, filename } = await uploadBlobUrl(l.imageUrl);
          if (filename) layerFilenames.push(filename);
          return { ...l, imageUrl: url };
        }));
      const [serializedFront, serializedBack] = await Promise.all([
        serializeLayers(frontLayers),
        serializeLayers(backLayers),
      ]);
      const res = await fetch("/api/shared-designs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product: selectedProduct,
          fit: selectedFit,
          color: selectedColor,
          size: selectedSize,
          frontLayers: serializedFront,
          backLayers: serializedBack,
          layerFilenames,
        }),
      });
      if (!res.ok) throw new Error("Server error");
      const { id } = await res.json() as { id: string };
      const url = `${window.location.origin}/design?share=${id}`;
      setShareUrl(url);
      setLinkCopied(false);
    } catch {
      toast({ title: "Share failed", description: "Could not generate a share link." });
    } finally {
      setSharing(false);
    }
  }, [selectedProduct, selectedFit, selectedColor, selectedSize, frontLayers, backLayers, uploadBlobUrl, toast]);

  const handleCopyShareLink = useCallback(async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2500);
    } catch {
      /* clipboard blocked — user can manually select */
    }
  }, [shareUrl]);

  // ── Save Design ─────────────────────────────────────────────────────────────

  const handleSaveDesign = useCallback(async () => {
    if (!selectedProduct || !selectedFit || !selectedColor) return;
    setSaving(true);
    try {
      const serializeLayers = async (ls: DesignLayer[]) =>
        Promise.all(ls.map(async l => ({ ...l, imageUrl: await blobUrlToDataUrl(l.imageUrl) })));
      const [savedFront, savedBack] = await Promise.all([
        serializeLayers(frontLayers),
        serializeLayers(backLayers),
      ]);
      const key = SAVE_KEY(selectedProduct.id, selectedFit.id, selectedColor.id);
      localStorage.setItem(key, JSON.stringify({ frontLayers: savedFront, backLayers: savedBack }));
      setSavedAt(new Date());
      toast({ title: "Design saved", description: "Your design will be restored on refresh." });
    } catch {
      toast({ title: "Save failed", description: "Could not save your design." });
    } finally {
      setSaving(false);
    }
  }, [selectedProduct, selectedFit, selectedColor, frontLayers, backLayers, toast]);

  // ── Export ─────────────────────────────────────────────────────────────────

  const handleExport = useCallback(async () => {
    if (!realWidth || !realHeight) return;

    const frontVisible = frontLayers.filter(l => l.visible);
    const backVisible  = backLayers.filter(l => l.visible);
    if (frontVisible.length === 0 && backVisible.length === 0) return;

    setExporting(true);
    try {
      type Loaded = { layer: DesignLayer; img: HTMLImageElement; blobUrl: string };

      // ── Helper: render one side and trigger download ─────────────────────────
      const renderSide = async (
        visibleLayers: DesignLayer[],
        sideBbox: BBox | null,
        label: "front" | "back",
      ) => {
        if (visibleLayers.length === 0 || !sideBbox) return;

        // Derive clip dimensions from mockupSize (same formula the DOM uses).
        // mockup container: width = mockupSize, height = mockupSize * 4/3 (aspect 3:4)
        const mockupContainerW = mockupSize;
        const mockupContainerH = mockupSize * (4 / 3);
        const clipW = Math.round(mockupContainerW * sideBbox.width  / 100);
        const clipH = Math.round(mockupContainerH * sideBbox.height / 100);
        if (!clipW || !clipH) return;

        // ── Load images ────────────────────────────────────────────────────────
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

        // ── Compute exported crop + real-world size ────────────────────────────
        let cropX = 0;
        let cropY = 0;
        let cropW = clipW;
        let cropH = clipH;
        let visCmW: number;
        let visCmH: number;

        if (loaded.length === 1) {
          const layer = loaded[0].layer;
          const { width, height } = getRatioLockedSize(layer, layer.width);
          const lx = Math.max(0, layer.x);
          const ly = Math.max(0, layer.y);
          const rx = Math.min(clipW, layer.x + width);
          const ry = Math.min(clipH, layer.y + height);
          if (rx <= lx || ry <= ly) return;

          cropX = lx;
          cropY = ly;
          cropW = rx - lx;
          cropH = ry - ly;

          const dim = layerPrintDim(layer);
          const fullCmW = dim?.w ?? Math.round((width / clipW) * realWidth * 10) / 10;
          const fullCmH = dim?.h ?? Math.round((height / width) * fullCmW * 10) / 10;
          visCmW = Math.round(fullCmW * (cropW / width) * 10) / 10;
          visCmH = Math.round(fullCmH * (cropH / height) * 10) / 10;
        } else {
          let visMinX = clipW, visMaxX = 0, visMinY = clipH, visMaxY = 0;
          for (const { layer } of loaded) {
            const { width, height } = getRatioLockedSize(layer, layer.width);
            const lx = Math.max(0, layer.x);
            const ly = Math.max(0, layer.y);
            const rx = Math.min(clipW, layer.x + width);
            const ry = Math.min(clipH, layer.y + height);
            if (rx > lx && ry > ly) {
              visMinX = Math.min(visMinX, lx); visMaxX = Math.max(visMaxX, rx);
              visMinY = Math.min(visMinY, ly); visMaxY = Math.max(visMaxY, ry);
            }
          }
          if (visMaxX <= visMinX || visMaxY <= visMinY) return;

          cropX = visMinX;
          cropY = visMinY;
          cropW = visMaxX - visMinX;
          cropH = visMaxY - visMinY;
          visCmW = Math.round((cropW / clipW) * realWidth * 10) / 10;
          visCmH = Math.round((cropH / clipH) * realHeight * 10) / 10;
        }

        const MAX_SIDE = 8192;
        const targetW = Math.max(1, Math.round((visCmW / 2.54) * 300));
        const targetH = Math.max(1, Math.round((visCmH / 2.54) * 300));
        const sideScale = Math.min(1, MAX_SIDE / targetW, MAX_SIDE / targetH);
        const exportW = Math.max(1, Math.round(targetW * sideScale));
        const exportH = Math.max(1, Math.round(targetH * sideScale));
        const scaleX = exportW / cropW;
        const scaleY = exportH / cropH;

        // ── Build canvas ───────────────────────────────────────────────────────
        const canvas = document.createElement("canvas");
        canvas.width  = exportW;
        canvas.height = exportH;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.setTransform(scaleX, 0, 0, scaleY, -cropX * scaleX, -cropY * scaleY);

        for (const { layer, img } of loaded) {
          const { width, height } = getRatioLockedSize(layer, layer.width);
          const cx    = layer.x + width  / 2;
          const cy    = layer.y + height / 2;
          const angle = (layer.rotation * Math.PI) / 180;
          ctx.save();
          ctx.translate(cx, cy);
          ctx.rotate(angle);
          ctx.drawImage(img, -width / 2, -height / 2, width, height);
          ctx.restore();
        }

        for (const { blobUrl } of loaded) URL.revokeObjectURL(blobUrl);

        // ── Download ───────────────────────────────────────────────────────────
        await new Promise<void>(resolve => {
          canvas.toBlob(blob => {
            if (!blob) { resolve(); return; }
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `${visCmW}x${visCmH}cm-${label}.png`;
            a.click();
            URL.revokeObjectURL(url);
            resolve();
          }, "image/png");
        });
      };

      await renderSide(frontVisible, localFrontBbox, "front");
      await renderSide(backVisible,  localBackBbox,  "back");
    } finally {
      setExporting(false);
    }
  }, [frontLayers, backLayers, localFrontBbox, localBackBbox, realWidth, realHeight, mockupSize]);

  if (!selectedProduct || !selectedFit || !selectedColor || !selectedSize) return null;

  return (
    <>
    {editorFile && (
      <ImageEditor
        file={editorFile}
        onConfirm={handleEditorConfirm}
        qualityScale={getEditorQualityScale()}
        onCancel={() => {
          if (newUploadLayerId) {
            setLayers(prev => {
              const layer = prev.find(l => l.id === newUploadLayerId);
              if (layer?.imageUrl.startsWith("blob:")) URL.revokeObjectURL(layer.imageUrl);
              return prev.filter(l => l.id !== newUploadLayerId);
            });
            setSelectedLayerId(null);
            setNewUploadLayerId(null);
          }
          setEditorFile(null);
          setEditingLayerId(null);
        }}
      />
    )}
    {showTextModal && (
      <TextLayerModal
        onConfirm={handleAddTextBlob}
        onCancel={() => setShowTextModal(false)}
      />
    )}
    <div className="h-screen overflow-hidden pt-20 flex flex-col bg-background">

      <div className="flex flex-1 overflow-hidden">

        {/* ── Left sidebar — Layers ── */}
        <div className="w-56 border-r border-border flex flex-col shrink-0 overflow-hidden">
          <div className="flex-1 overflow-y-auto no-scrollbar">
            <div className="p-5">
              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-4">
                {side === "front" ? "Front" : "Back"} Layers {layers.length > 0 && `(${layers.length})`}
              </p>

              {layers.length === 0 ? (
                <p className="text-xs text-muted-foreground uppercase tracking-widest leading-relaxed">
                  No layers yet. Add an image to the {side} to start designing.
                </p>
              ) : (
                <div className="space-y-2">
                  {[...layers].reverse().map((layer, reversedIdx) => {
                    const trueIdx = layers.length - 1 - reversedIdx;
                    const isSelected = selectedLayerId === layer.id;
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
                            <p className="text-xs font-bold uppercase tracking-widest truncate">
                              Layer {reversedIdx + 1}
                            </p>
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
          className="flex-1 relative overflow-hidden"
          style={{
            backgroundImage:
              "linear-gradient(45deg, #2a2a2a 25%, transparent 25%), linear-gradient(-45deg, #2a2a2a 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #2a2a2a 75%), linear-gradient(-45deg, transparent 75%, #2a2a2a 75%)",
            backgroundSize: "24px 24px",
            backgroundPosition: "0 0, 0 12px, 12px -12px, -12px 0px",
            backgroundColor: "#1a1a1a",
          }}
        >

          {/* Front / Back toggle — pinned at top center */}
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 flex gap-0 border border-border/60">
            {(["front", "back"] as const).map(s => (
              <button
                key={s}
                onClick={() => { setSide(s); setSelectedLayerId(null); }}
                className={`px-6 py-2 text-xs uppercase tracking-widest font-medium transition-colors ${side === s ? "bg-foreground text-background" : "bg-background/20 text-foreground hover:bg-muted/20"}`}
              >
                {s}
              </button>
            ))}
          </div>

          {/* Mockup viewer — centered absolutely, offset by mockupOffsetY */}
          <div className="absolute inset-0 flex items-center justify-center">
          <div
            className="relative"
            style={{ width: `${mockupSize}px`, aspectRatio: "3/4", transform: `translateY(${mockupOffsetY}px)` }}
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
                  layer.visible ? (() => {
                    const { width, height } = getRatioLockedSize(layer, layer.width);
                    return (
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
                        width,
                        height,
                        minWidth: width,
                        minHeight: height,
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
                    );
                  })() : null
                )}

                {/* ── Print dimension label for selected layer ── */}
                {selectedLayer && selectedLayer.visible && printDim && clipSize && showDimLabel && (
                  <div
                    style={{
                      position: "absolute",
                      left: selectedLayer.x + getRatioLockedSize(selectedLayer, selectedLayer.width).width / 2,
                      top: selectedLayer.y + getRatioLockedSize(selectedLayer, selectedLayer.width).height / 2,
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
                  border: (layers.length === 0 && showPlaceholder) ? "1px dashed rgba(255,255,255,0.18)" : "none",
                  zIndex: 6,
                  pointerEvents: "none",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 2,
                }}
              >
                {layers.length === 0 && realWidth > 0 && showPlaceholder && (
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
          </div>

          </div>{/* close absolute inset-0 wrapper */}
        </div>{/* close chess area */}

        {/* ── Right sidebar ── */}
        <div className="w-72 border-l border-border flex flex-col shrink-0 overflow-hidden">

          {/* Admin controls */}
          {isAdminPreview && (
            <div className="p-4 border-b border-border space-y-3 bg-muted/10">
              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Admin Preview</p>

              {/* Mockup size controls */}
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground uppercase tracking-widest">Size</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setMockupSize(prev => Math.max(160, prev - 40))}
                    className="flex-1 py-2.5 text-sm font-bold uppercase tracking-widest border border-border bg-background hover:border-foreground hover:bg-muted/20 transition-colors"
                  >
                    − Smaller
                  </button>
                  <button
                    onClick={() => setMockupSize(prev => Math.min(1400, prev + 40))}
                    className="flex-1 py-2.5 text-sm font-bold uppercase tracking-widest border border-border bg-background hover:border-foreground hover:bg-muted/20 transition-colors"
                  >
                    + Bigger
                  </button>
                </div>
              </div>

              {/* Mockup position controls */}
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground uppercase tracking-widest">Position</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setMockupOffsetY(prev => prev - 20)}
                    className="flex-1 py-2.5 text-sm font-bold uppercase tracking-widest border border-border bg-background hover:border-foreground hover:bg-muted/20 transition-colors"
                  >
                    ↑ Up
                  </button>
                  <button
                    onClick={() => setMockupOffsetY(prev => prev + 20)}
                    className="flex-1 py-2.5 text-sm font-bold uppercase tracking-widest border border-border bg-background hover:border-foreground hover:bg-muted/20 transition-colors"
                  >
                    ↓ Down
                  </button>
                </div>
              </div>

              <button
                onClick={handleAdminSave}
                disabled={saveMockup.isPending}
                className="w-full py-3 text-xs font-bold uppercase tracking-widest bg-foreground text-background hover:opacity-80 transition-opacity disabled:opacity-40"
              >
                {saveMockup.isPending ? "Saving..." : "Save Mockup"}
              </button>
              <button
                onClick={() => setLocation("/admin/dashboard")}
                className="w-full py-2 text-xs uppercase tracking-widest border border-border hover:border-foreground transition-colors"
              >
                ← Back to Admin
              </button>
            </div>
          )}

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
            </div>
          </div>


          {/* ── ORDER NOW ── */}
          <div className="px-6 py-5 border-b border-border">
            <button
              onClick={() => setShowOrderModal(true)}
              className="w-full py-4 font-black uppercase text-sm tracking-[0.2em] transition-all active:scale-[0.98] hover:opacity-90"
              style={{ backgroundColor: "#f5c842", color: "#0d0d0d", letterSpacing: "0.25em" }}
            >
              Order Now
            </button>
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

            {/* Add Text */}
            <button
              onClick={() => setShowTextModal(true)}
              disabled={!bbox}
              className="w-full flex items-center gap-3 border border-border px-4 py-3 hover:border-foreground hover:bg-muted/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <span className="text-lg leading-none">T</span>
              <div className="text-left">
                <p className="text-xs font-bold uppercase tracking-widest">Add Text</p>
                {!bbox && (
                  <p className="text-xs text-muted-foreground mt-0.5">Set bbox in admin first</p>
                )}
              </div>
            </button>

            <button
              onClick={handleShareDesign}
              disabled={sharing || uploading || (!mockup?.front?.image && !mockup?.back?.image)}
              className="w-full flex items-center gap-3 border border-border px-4 py-3 hover:border-foreground hover:bg-muted/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <span className="text-lg leading-none">↗</span>
              <p className="text-xs font-bold uppercase tracking-widest">
                {sharing ? "Preparing…" : "Share Design"}
              </p>
            </button>

            <button
              onClick={handleSaveDesign}
              disabled={saving || (!frontLayers.length && !backLayers.length)}
              className="w-full flex items-center gap-3 border border-border px-4 py-3 hover:border-foreground hover:bg-muted/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <span className="text-lg leading-none">↓</span>
              <div className="text-left">
                <p className="text-xs font-bold uppercase tracking-widest">
                  {saving ? "Saving…" : "Save Design"}
                </p>
                {savedAt && !saving && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Saved {savedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </p>
                )}
              </div>
            </button>
          </div>

          {/* ── Export ── */}
          {showExportButton && layers.some(l => l.visible) && realWidth > 0 && (
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

    <OrderReviewModal
      isOpen={showOrderModal}
      onClose={() => setShowOrderModal(false)}
      frontLayers={frontLayers}
      backLayers={backLayers}
      localFrontBbox={localFrontBbox}
      localBackBbox={localBackBbox}
      mockup={mockup}
      mockupSize={mockupSize}
      selectedProduct={selectedProduct}
      selectedFit={selectedFit}
      selectedColor={selectedColor}
      selectedSize={selectedSize}
    />

    <AnimatePresence>
      {shareUrl && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4"
          onClick={() => setShareUrl(null)}
        >
          <motion.div
            initial={{ scale: 0.92, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.92, opacity: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 28 }}
            className="bg-background border border-border w-full max-w-md p-6 flex flex-col gap-5"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold uppercase tracking-widest">Share Your Design</h2>
              <button
                onClick={() => setShareUrl(null)}
                className="text-muted-foreground hover:text-foreground transition-colors text-lg leading-none"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Anyone with this link can open your design and edit it — same mockup, same layers, everything.
            </p>
            <p className="text-xs text-amber-500/80 font-medium uppercase tracking-widest">
              This link is available for 24 hours only
            </p>
            <div className="flex gap-2">
              <input
                readOnly
                value={shareUrl}
                onFocus={e => e.currentTarget.select()}
                className="flex-1 bg-muted/20 border border-border px-3 py-2 text-xs font-mono text-foreground focus:outline-none focus:border-foreground transition-colors min-w-0"
              />
              <button
                onClick={handleCopyShareLink}
                className="shrink-0 text-xs font-bold uppercase tracking-widest px-4 py-2 bg-foreground text-background hover:opacity-80 transition-opacity"
              >
                {linkCopied ? "Copied!" : "Copy"}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
    </>
  );
}

