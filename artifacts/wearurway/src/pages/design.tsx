import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation, useSearch } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { useGetMockup, useSaveMockup, getGetMockupQueryKey, useGetOrderSettings } from "@workspace/api-client-react";
import { useCustomizer } from "@/hooks/use-customizer";
import { useToast } from "@/hooks/use-toast";
import ImageEditor, { type ImageEditResult } from "@/components/ImageEditor";
import TextLayerModal, { type TextLayerOptions } from "@/components/TextLayerModal";
import AddImageModal from "@/components/AddImageModal";
import OrderReviewModal from "@/components/OrderReviewModal";
import PinterestImportButton from "@/components/PinterestImportButton";
import { generateDesignExportFiles } from "@/lib/design-export";

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
  // Text-layer specific. When `kind === "text"`, the layer was produced by the
  // TextLayerModal and should be edited as text (re-opening the same modal),
  // not as a raster image. `textOptions` lets us re-seed the modal state.
  kind?: "image" | "text";
  textOptions?: TextLayerOptions;
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
const SNAP_THRESHOLD = 8;

const SAVE_KEY = (productId: string, fitId: string, colorId: string) =>
  `ww_design_${productId}_${fitId}_${colorId}`;

async function loadImageFromUrl(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}


// ─── Main Component ───────────────────────────────────────────────────────────

export default function Design() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const isAdminPreview = new URLSearchParams(search).get("admin") === "1";
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
  const layersRef = useRef<DesignLayer[]>(layers);
  layersRef.current = layers;
  const setLayers = useCallback((updater: React.SetStateAction<DesignLayer[]>) => {
    if (sideRef.current === "front") setFrontLayers(updater);
    else setBackLayers(updater);
  }, []);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [showOrderModal, setShowOrderModal] = useState(false);
  const [editorFile, setEditorFile] = useState<File | null>(null);
  const [editingLayerId, setEditingLayerId] = useState<string | null>(null);
  const [newUploadLayerId, setNewUploadLayerId] = useState<string | null>(null);
  const [showTextModal, setShowTextModal] = useState(false);
  const [showAddImageModal, setShowAddImageModal] = useState(false);
  const [showQualityNotice, setShowQualityNotice] = useState(() => {
    if (typeof window === "undefined") return false;
    return sessionStorage.getItem("designQualityNoticeSeen") !== "1";
  });
  const dismissQualityNotice = useCallback(() => {
    setShowQualityNotice(false);
    try {
      sessionStorage.setItem("designQualityNoticeSeen", "1");
    } catch {}
  }, []);
  const [showSideHintNotice, setShowSideHintNotice] = useState(false);
  const dismissSideHintNotice = useCallback(() => {
    setShowSideHintNotice(false);
    try {
      localStorage.setItem("designSideHintSeen", "1");
    } catch {}
  }, []);
  useEffect(() => {
    if (frontLayers.length + backLayers.length === 0) return;
    try {
      if (localStorage.getItem("designSideHintSeen") === "1") return;
    } catch {
      return;
    }
    setShowSideHintNotice(true);
  }, [frontLayers.length, backLayers.length]);
  const [showDragHint, setShowDragHint] = useState(false);
  const [dragOverSide, setDragOverSide] = useState<"front" | "back" | null>(null);
  const dragOverSideRef = useRef<"front" | "back" | null>(null);
  dragOverSideRef.current = dragOverSide;
  const sideBtnsRef = useRef<HTMLDivElement>(null);

  const { data: orderSettings } = useGetOrderSettings();
  const showExportButton = orderSettings?.showExportButton === true;

  const clipAreaRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const pinchRef = useRef<{ dist: number } | null>(null);
  const mockupSizeRef = useRef(mockupSize);
  useEffect(() => { mockupSizeRef.current = mockupSize; }, [mockupSize]);
  const [snapActive, setSnapActive] = useState(false);
  const holdActionRef = useRef<(() => void) | null>(null);
  const holdTimerRef = useRef<{ timeout: ReturnType<typeof setTimeout> | null; interval: ReturnType<typeof setInterval> | null }>({ timeout: null, interval: null });

  useEffect(() => {
    if (!selectedProduct || !selectedFit || !selectedColor) {
      setLocation("/products");
    }
  }, [selectedProduct, selectedFit, selectedColor, setLocation]);

  const savedDesignLoaded = useRef(false);

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
    if (!realWidth || !realHeight || !mockupSize) return 1;
    const mockupW = mockupSize;
    const mockupH = mockupSize * (4 / 3);
    return Math.max(
      (realWidth / 2.54 * 300) / mockupW,
      (realHeight / 2.54 * 300) / mockupH,
      1,
    );
  }, [realWidth, realHeight, mockupSize]);

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
  const effectiveBbox: BBox = { x: 0, y: 0, width: 100, height: 100 };

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
    const canvasCenterX = mockupSizeRef.current / 2;
    const rawX = drag.startLayerX + dx;
    const rawY = drag.startLayerY + dy;

    // Compute snap outside the state updater so it's always reliable
    const layer = layersRef.current.find(l => l.id === drag.layerId);
    const layerW = layer ? Math.max(MIN_LAYER_SIZE, layer.width) : 0;
    const snapping = layerW > 0 && Math.abs((rawX + layerW / 2) - canvasCenterX) < SNAP_THRESHOLD;
    const finalX = snapping ? canvasCenterX - layerW / 2 : rawX;

    setLayers(prev =>
      prev.map(l =>
        l.id === drag.layerId ? { ...l, x: finalX, y: rawY } : l
      )
    );
    setSnapActive(snapping);

    // Detect hover over Front/Back buttons for drag-to-transfer
    const btnRect = sideBtnsRef.current?.getBoundingClientRect();
    if (btnRect && e.clientX >= btnRect.left && e.clientX <= btnRect.right && e.clientY >= btnRect.top && e.clientY <= btnRect.bottom) {
      const midX = (btnRect.left + btnRect.right) / 2;
      setDragOverSide(e.clientX < midX ? "front" : "back");
    } else {
      setDragOverSide(null);
    }
  }, []);

  const onMouseUp = useCallback(() => {
    const drag = dragRef.current;
    dragRef.current = null;
    setSnapActive(false);

    const overSide = dragOverSideRef.current;
    setDragOverSide(null);

    // Transfer layer to the other side if dropped on the opposite button
    if (drag && overSide && overSide !== sideRef.current) {
      const layerId = drag.layerId;
      const layer = layersRef.current.find(l => l.id === layerId);
      if (layer) {
        if (sideRef.current === "front") {
          setFrontLayers(prev => prev.filter(l => l.id !== layerId));
          setBackLayers(prev => [...prev, layer]);
        } else {
          setBackLayers(prev => prev.filter(l => l.id !== layerId));
          setFrontLayers(prev => [...prev, layer]);
        }
        setSide(overSide);
        setSelectedLayerId(layerId);
      }
    }
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


  const selectedLayer = layers.find(l => l.id === selectedLayerId) ?? null;

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
    setShowAddImageModal(true);
  }, []);

  const handleAddImageBrowse = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.click();
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      setShowAddImageModal(false);
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

  // Called when Pinterest import (or any external source) provides a File directly
  const handleImportFile = useCallback(async (file: File) => {
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
      setEditingLayerId(newLayer.id);
      setNewUploadLayerId(newLayer.id);
      setEditorFile(file);
    } finally {
      setUploading(false);
    }
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

      // Show one-time hint after first image is added
      if (!localStorage.getItem("ww_drag_hint_shown")) {
        localStorage.setItem("ww_drag_hint_shown", "1");
        setShowDragHint(true);
      }
    } finally {
      setUploading(false);
    }
  }, [layers.length, editingLayerId]);

  // Open editor for an existing layer.
  // Text layers re-open the TextLayerModal (so they're edited as text), image
  // layers continue to open the raster ImageEditor.
  const startEditLayer = useCallback(async (layer: DesignLayer) => {
    if (layer.kind === "text" && layer.textOptions) {
      setEditingLayerId(layer.id);
      setShowTextModal(true);
      return;
    }
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

  // Add text layer from TextLayerModal blob.
  // We persist the original `TextLayerOptions` on the layer so we can re-open
  // the same modal later with all settings pre-filled.
  const handleAddTextBlob = useCallback(async (blob: Blob, opts: TextLayerOptions) => {
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
      kind: "text",
      textOptions: opts,
    };
    setLayers(prev => [...prev, newLayer]);
    setSelectedLayerId(newLayer.id);
  }, [layers.length]);

  // Replace an existing text layer with a freshly rendered version.
  // Keeps position/rotation; updates dimensions to keep the previous height,
  // recomputing width from the new aspect ratio so the layer doesn't jump in size.
  const handleEditTextBlob = useCallback(async (blob: Blob, opts: TextLayerOptions) => {
    const targetId = editingLayerId;
    setShowTextModal(false);
    setEditingLayerId(null);
    if (!targetId) return;
    const objectUrl = URL.createObjectURL(blob);
    const natural = await new Promise<{ w: number; h: number }>((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => resolve({ w: 1, h: 1 });
      img.src = objectUrl;
    });
    setLayers(prev => prev.map(l => {
      if (l.id !== targetId) return l;
      if (l.imageUrl.startsWith("blob:")) URL.revokeObjectURL(l.imageUrl);
      const aspect = natural.h > 0 ? natural.w / natural.h : (l.width / l.height);
      const nextH = Math.max(MIN_LAYER_SIZE, l.height);
      const nextW = Math.max(MIN_LAYER_SIZE, nextH * aspect);
      return {
        ...l,
        imageUrl: objectUrl,
        width: nextW,
        height: nextH,
        naturalWidth: natural.w,
        naturalHeight: natural.h,
        kind: "text",
        textOptions: opts,
      };
    }));
  }, [editingLayerId]);

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
      return next;
    });
  };

  const moveLayerDown = (id: string) => {
    setLayers(prev => {
      const idx = prev.findIndex(l => l.id === id);
      if (idx <= 0) return prev;
      const next = [...prev];
      [next[idx], next[idx - 1]] = [next[idx - 1], next[idx]];
      return next;
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

  // ── Export ─────────────────────────────────────────────────────────────────

  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      const files = await generateDesignExportFiles({
        frontLayers,
        backLayers,
        mockupSize,
        frontMockupImage: mockup?.front?.image,
        backMockupImage: mockup?.back?.image,
      });
      for (const file of files) {
        const a = document.createElement("a");
        a.href = file.dataUrl;
        a.download = file.fileName;
        a.click();
      }
    } finally {
      setExporting(false);
    }
  }, [frontLayers, backLayers, mockupSize, mockup]);

  if (!selectedProduct || !selectedFit || !selectedColor) return null;

  return (
    <>
    {/* ── One-time drag-to-transfer hint popup ── */}
    {showDragHint && (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
        onClick={() => setShowDragHint(false)}
      >
        <div
          className="bg-background border border-border p-8 max-w-sm mx-4 shadow-2xl"
          onClick={e => e.stopPropagation()}
        >
          <p className="text-xs uppercase tracking-widest text-muted-foreground mb-3 font-bold">Tip</p>
          <h2 className="text-base font-black uppercase tracking-widest mb-4 leading-snug">
            Move your design to Front or Back
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed mb-6">
            While dragging an image layer, move it over the{" "}
            <span className="text-foreground font-bold">Front</span> or{" "}
            <span className="text-foreground font-bold">Back</span> buttons at the top of the
            canvas — then release to transfer the layer to that side of the T-shirt.
          </p>
          <button
            onClick={() => setShowDragHint(false)}
            className="w-full py-2.5 text-xs uppercase tracking-widest font-bold bg-foreground text-background hover:opacity-90 transition-opacity"
          >
            Got it
          </button>
        </div>
      </div>
    )}
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
    {showTextModal && (() => {
      // If editingLayerId is set AND that layer is a text layer, this is an
      // EDIT — pre-fill the modal with its saved options and route confirm
      // through handleEditTextBlob (which replaces in place). Otherwise it's
      // a brand new "Add Text" → handleAddTextBlob (appends a new layer).
      const editing = editingLayerId
        ? layers.find(l => l.id === editingLayerId)
        : null;
      const isEditingText = editing?.kind === "text" && !!editing.textOptions;
      return (
        <TextLayerModal
          initial={isEditingText ? editing!.textOptions! : null}
          onConfirm={isEditingText ? handleEditTextBlob : handleAddTextBlob}
          onCancel={() => {
            setShowTextModal(false);
            setEditingLayerId(null);
          }}
        />
      );
    })()}
    {showQualityNotice && (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4"
        onClick={dismissQualityNotice}
      >
        <div
          className="w-full max-w-md bg-background border border-border p-8 relative shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-6">
            <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-muted-foreground mb-2">
              Heads Up
            </p>
            <h2 className="text-xl font-black uppercase tracking-wide leading-tight">
              About Image Quality
            </h2>
          </div>
          <p className="text-sm leading-relaxed text-foreground/90 mb-6">
            Don't worry about quality at all — even if your image looks low
            quality or pixelated, we can still turn it into a high-resolution
            print. The preview on screen is not the final print result.
          </p>
          <button
            onClick={dismissQualityNotice}
            className="w-full py-4 font-black uppercase text-sm tracking-[0.2em] transition-all active:scale-[0.98] hover:opacity-90"
            style={{ backgroundColor: "#f5c842", color: "#0d0d0d", letterSpacing: "0.25em" }}
          >
            Got It
          </button>
        </div>
      </div>
    )}
    {showSideHintNotice && (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4"
        onClick={dismissSideHintNotice}
      >
        <div
          className="w-full max-w-md bg-background border border-border p-8 relative shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-6">
            <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-muted-foreground mb-2">
              Pro Tip
            </p>
            <h2 className="text-xl font-black uppercase tracking-wide leading-tight">
              Move Designs Between Sides
            </h2>
          </div>

          <div className="flex items-center justify-center gap-2 mb-5">
            <div className="px-4 py-2 border border-border text-[10px] font-bold uppercase tracking-widest">
              Front
            </div>
            <div className="px-4 py-2 border border-border text-[10px] font-bold uppercase tracking-widest">
              Back
            </div>
          </div>

          <p className="text-sm leading-relaxed text-foreground/90 mb-6">
            You can hold and drag any image onto the{" "}
            <span className="font-bold uppercase">Front</span> or{" "}
            <span className="font-bold uppercase">Back</span> buttons at the top
            of the t-shirt to instantly move it to the other side.
          </p>

          <button
            onClick={dismissSideHintNotice}
            className="w-full py-4 font-black uppercase text-sm tracking-[0.2em] transition-all active:scale-[0.98] hover:opacity-90"
            style={{ backgroundColor: "#f5c842", color: "#0d0d0d", letterSpacing: "0.25em" }}
          >
            Got It
          </button>
        </div>
      </div>
    )}
    {showAddImageModal && (
      <AddImageModal
        onBrowse={handleAddImageBrowse}
        onFile={(file) => {
          setShowAddImageModal(false);
          handleImportFile(file);
        }}
        onCancel={() => setShowAddImageModal(false)}
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
                              title={layer.kind === "text" ? "Edit text" : "Edit image"}
                            >
                              ✏ {layer.kind === "text" ? "Edit Text" : "Edit Image"}
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
          <div ref={sideBtnsRef} className="absolute top-4 left-1/2 -translate-x-1/2 z-10 flex gap-0 border border-border/60">
            {(["front", "back"] as const).map(s => (
              <button
                key={s}
                onClick={() => { setSide(s); setSelectedLayerId(null); }}
                className={`px-6 py-2 text-xs uppercase tracking-widest font-medium transition-colors ${
                  dragOverSide === s
                    ? "bg-yellow-400 text-black"
                    : side === s
                    ? "bg-foreground text-background"
                    : "bg-background/20 text-foreground hover:bg-muted/20"
                }`}
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

            {/* ── Center snap guide line ── */}
            {snapActive && (
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  bottom: 0,
                  left: "50%",
                  transform: "translateX(-50%)",
                  width: "1px",
                  backgroundColor: "#f5c842",
                  zIndex: 20,
                  pointerEvents: "none",
                  opacity: 0.75,
                }}
              />
            )}

            {/* ── Design clip area ── */}
            {/* z-index 5 places designs above the shirt (z-index 1). */}
            {/* CSS mask clips the design to the shirt's exact alpha silhouette. */}
            {/* mask-size:contain + mask-position:center mirrors object-fit:contain on the shirt img. */}
            <div
              ref={clipAreaRef}
              style={{
                position: "absolute",
                left: `${effectiveBbox.x}%`,
                top: `${effectiveBbox.y}%`,
                width: `${effectiveBbox.width}%`,
                height: `${effectiveBbox.height}%`,
                overflow: "hidden",
                zIndex: 5,
                ...(currentSide?.image ? {
                  WebkitMaskImage: `url("${currentSide.image}")`,
                  maskImage: `url("${currentSide.image}")`,
                  WebkitMaskSize: "contain",
                  maskSize: "contain",
                  WebkitMaskPosition: "center",
                  maskPosition: "center",
                  WebkitMaskRepeat: "no-repeat",
                  maskRepeat: "no-repeat",
                } : {}),
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
            </div>
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
              disabled={uploading}
              className="w-full flex items-center border border-border px-4 py-3 hover:border-foreground hover:bg-muted/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <div className="text-left">
                <p className="text-xs font-bold uppercase tracking-widest">
                  {uploading ? "Uploading…" : "Add Image"}
                </p>
              </div>
            </button>

            {/* Add Text */}
            <button
              onClick={() => setShowTextModal(true)}
              className="w-full flex items-center border border-border px-4 py-3 hover:border-foreground hover:bg-muted/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <div className="text-left">
                <p className="text-xs font-bold uppercase tracking-widest">Add Text</p>
              </div>
            </button>

          </div>

          {/* ── Export ── */}
          {showExportButton && (
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

    <PinterestImportButton onImageReady={handleImportFile} disabled={uploading} />

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
    />

    </>
  );
}

