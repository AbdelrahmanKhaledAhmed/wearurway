import { useState, useEffect, useRef, useCallback } from "react";
import { CUSTOM_FONTS, type FontConfig } from "@/config/fonts";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TextLayerOptions {
  text: string;
  font: FontConfig;
  color: string;
  outlineColor: string;
  outlineWidth: number;
  arcDeg: number;
}

interface Props {
  onConfirm: (blob: Blob) => void;
  onCancel: () => void;
}

// ─── Canvas height used in preview cards ──────────────────────────────────────
const PREVIEW_FONT_SIZE = 38;

// ─── Font loader (cached per family) ─────────────────────────────────────────
const loadedFonts = new Set<string>();
async function ensureFontLoaded(font: FontConfig): Promise<void> {
  if (loadedFonts.has(font.family)) return;
  const base = import.meta.env.BASE_URL ?? "/";
  const url = `${base}fonts/${font.filename}`.replace(/\/\//g, "/");
  const face = new FontFace(font.family, `url(${url})`);
  await face.load();
  document.fonts.add(face);
  loadedFonts.add(font.family);
}

async function ensureAllFontsLoaded(): Promise<void> {
  await Promise.all(CUSTOM_FONTS.map(ensureFontLoaded));
}

// ─── Pixel bounds helper ──────────────────────────────────────────────────────
function getAlphaBounds(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d")!;
  const { width: W, height: H } = canvas;
  const data = ctx.getImageData(0, 0, W, H).data;
  let mx = W, Mx = 0, my = H, My = 0;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (data[(y * W + x) * 4 + 3] > 0) {
        mx = Math.min(mx, x); Mx = Math.max(Mx, x);
        my = Math.min(my, y); My = Math.max(My, y);
      }
  if (mx > Mx || my > My) return null;
  return { x: mx, y: my, w: Mx - mx + 1, h: My - my + 1 };
}

// ─── Core text-to-canvas renderer ─────────────────────────────────────────────
// Strategy: draw on a canvas 3× larger than needed (so nothing can overflow),
// then pixel-scan to find the actual ink bounds and crop tightly.
// This completely avoids relying on measureText for sizing, which is unreliable
// for decorative fonts whose glyphs extend far beyond their reported metrics.
async function renderTextToCanvas(
  opts: TextLayerOptions,
  outW: number,
  outH: number,
): Promise<HTMLCanvasElement> {
  const { text, font, color, outlineColor, outlineWidth, arcDeg } = opts;
  await ensureFontLoaded(font);

  const applyStroke = outlineWidth > 0;
  const strokePad = applyStroke ? outlineWidth + 8 : 8;

  // Work on a 3× oversized canvas so no glyph can possibly be clipped.
  const BIG = Math.max(outW, outH) * 3;
  const big = document.createElement("canvas");
  big.width  = BIG;
  big.height = BIG;
  const ctx = big.getContext("2d")!;
  ctx.clearRect(0, 0, BIG, BIG);

  const fontSize = Math.round(outH * 0.3);
  ctx.font = `${fontSize}px "${font.family}"`;

  if (Math.abs(arcDeg) < 2) {
    // ── Straight text ──
    ctx.textAlign    = "center";
    ctx.textBaseline = "middle";
    const cx = BIG / 2;
    const cy = BIG / 2;
    if (applyStroke) {
      ctx.strokeStyle = outlineColor;
      ctx.lineWidth   = outlineWidth * 2;
      ctx.lineJoin    = "round";
      ctx.strokeText(text, cx, cy);
    }
    ctx.fillStyle = color;
    ctx.fillText(text, cx, cy);
  } else {
    // ── Curved text ──
    ctx.textBaseline = "alphabetic";
    ctx.textAlign    = "left";

    const chars      = [...text];
    const charWidths = chars.map((c) => ctx.measureText(c).width);
    const totalWidth = charWidths.reduce((a, b) => a + b, 0);

    const arcRad = (Math.abs(arcDeg) * Math.PI) / 180;
    const radius = totalWidth / arcRad;
    const isUp   = arcDeg > 0;

    const cx = BIG / 2;
    const cy = isUp ? BIG * 0.5 + radius * 0.5 : BIG * 0.5 - radius * 0.5;

    let angle = isUp
      ? -Math.PI / 2 - arcRad / 2
      : Math.PI / 2 - arcRad / 2;

    chars.forEach((char, i) => {
      const cw        = charWidths[i];
      const charAngle = cw / radius;
      const midAngle  = angle + charAngle / 2;

      const px       = cx + radius * Math.cos(midAngle);
      const py       = cy + radius * Math.sin(midAngle);
      const rotation = isUp ? midAngle + Math.PI / 2 : midAngle - Math.PI / 2;

      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(rotation);
      ctx.textAlign    = "center";
      ctx.textBaseline = isUp ? "alphabetic" : "hanging";

      if (applyStroke) {
        ctx.strokeStyle = outlineColor;
        ctx.lineWidth   = outlineWidth * 2;
        ctx.lineJoin    = "round";
        ctx.strokeText(char, 0, 0);
      }
      ctx.fillStyle = color;
      ctx.fillText(char, 0, 0);
      ctx.restore();

      angle += charAngle;
    });
  }

  // Pixel-scan the oversized canvas to find the true ink bounds.
  const bounds = getAlphaBounds(big);
  if (!bounds) return big; // empty — nothing was drawn

  // Crop to ink + uniform padding on all sides.
  const tx = Math.max(0, bounds.x - strokePad);
  const ty = Math.max(0, bounds.y - strokePad);
  const tw = Math.min(BIG - tx, bounds.w + strokePad * 2);
  const th = Math.min(BIG - ty, bounds.h + strokePad * 2);

  const out = document.createElement("canvas");
  out.width  = tw;
  out.height = th;
  out.getContext("2d")!.drawImage(big, tx, ty, tw, th, 0, 0, tw, th);
  return out;
}

// ─── High-res export ──────────────────────────────────────────────────────────
async function renderTextToBlob(opts: TextLayerOptions): Promise<Blob> {
  // renderTextToCanvas already returns a tightly-cropped canvas, so just encode it.
  const canvas = await renderTextToCanvas(opts, 1200, 1200);
  return new Promise((res) => canvas.toBlob((b) => res(b!), "image/png"));
}

// ─── Small preview card renderer ─────────────────────────────────────────────
function FontPreviewCard({
  font,
  text,
  selected,
  onClick,
}: {
  font: FontConfig;
  text: string;
  selected: boolean;
  onClick: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const displayText = text.trim() || "Your Text";

  useEffect(() => {
    let cancelled = false;
    ensureFontLoaded(font).then(() => {
      if (cancelled) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d")!;
      const W = canvas.width;
      const H = canvas.height;
      ctx.clearRect(0, 0, W, H);
      ctx.font = `${PREVIEW_FONT_SIZE}px "${font.family}"`;
      ctx.fillStyle = "#ffffff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      // Scale down if text is too wide
      const measured = ctx.measureText(displayText).width;
      if (measured > W - 16) {
        const scale = (W - 16) / measured;
        ctx.font = `${Math.floor(PREVIEW_FONT_SIZE * scale)}px "${font.family}"`;
      }
      ctx.fillText(displayText, W / 2, H / 2);
    });
    return () => { cancelled = true; };
  }, [font, displayText]);

  return (
    <button
      onClick={onClick}
      className={`relative flex flex-col items-center border transition-colors p-2 ${
        selected
          ? "border-foreground bg-foreground/10"
          : "border-border hover:border-foreground/60"
      }`}
    >
      <canvas
        ref={canvasRef}
        width={220}
        height={72}
        className="w-full"
        style={{ imageRendering: "auto" }}
      />
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground mt-1 truncate w-full text-center">
        {font.name}
      </p>
      {selected && (
        <span className="absolute top-1 right-1 text-[10px] bg-foreground text-background px-1">✓</span>
      )}
    </button>
  );
}

// ─── Live styled preview ──────────────────────────────────────────────────────
function StyledPreview({ opts }: { opts: TextLayerOptions }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const raw = await renderTextToCanvas(opts, 600, 300);
      if (cancelled) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d")!;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Scale raw to fit preview
      const scaleX = canvas.width / raw.width;
      const scaleY = canvas.height / raw.height;
      const scale = Math.min(scaleX, scaleY, 1);
      const dx = (canvas.width - raw.width * scale) / 2;
      const dy = (canvas.height - raw.height * scale) / 2;
      ctx.drawImage(raw, dx, dy, raw.width * scale, raw.height * scale);
    })();
    return () => { cancelled = true; };
  }, [opts]);

  return (
    <canvas
      ref={canvasRef}
      width={520}
      height={200}
      className="w-full border border-border/40"
      style={{
        background:
          "repeating-conic-gradient(#1a1a1a 0% 25%, #242424 0% 50%) 0 0 / 16px 16px",
      }}
    />
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function TextLayerModal({ onConfirm, onCancel }: Props) {
  const [phase, setPhase] = useState<"pick" | "style">("pick");
  const [text, setText] = useState("");
  const [selectedFont, setSelectedFont] = useState<FontConfig | null>(null);
  const [color, setColor] = useState("#ffffff");
  const [outlineColor, setOutlineColor] = useState("#000000");
  const [outlineWidth, setOutlineWidth] = useState(0);
  const [arcDeg, setArcDeg] = useState(0);
  const [rendering, setRendering] = useState(false);
  const [fontsReady, setFontsReady] = useState(false);

  // Load all fonts on mount so previews render immediately
  useEffect(() => {
    ensureAllFontsLoaded().then(() => setFontsReady(true));
  }, []);

  const styledOpts: TextLayerOptions | null = selectedFont
    ? { text: text.trim() || "Your Text", font: selectedFont, color, outlineColor, outlineWidth, arcDeg }
    : null;

  const handleFontSelect = (font: FontConfig) => {
    setSelectedFont(font);
    setPhase("style");
  };

  const handleConfirm = useCallback(async () => {
    if (!styledOpts) return;
    setRendering(true);
    try {
      const blob = await renderTextToBlob(styledOpts);
      onConfirm(blob);
    } finally {
      setRendering(false);
    }
  }, [styledOpts, onConfirm]);

  const displayText = text.trim() || "Your Text";

  return (
    <div className="fixed inset-0 z-[110] bg-black/90 flex items-center justify-center p-4">
      <div className="bg-background border border-border w-full max-w-3xl max-h-[92vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-4">
            <h2 className="text-sm font-bold uppercase tracking-widest">Add Text</h2>
            {phase === "style" && selectedFont && (
              <button
                onClick={() => setPhase("pick")}
                className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors"
              >
                ← Change Font
              </button>
            )}
          </div>
          <button
            onClick={onCancel}
            className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors"
          >
            Cancel
          </button>
        </div>

        {/* Text input — always visible */}
        <div className="px-6 pt-4 pb-3 shrink-0 border-b border-border">
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Type your text here…"
            autoFocus
            className="w-full bg-transparent border border-border px-4 py-3 text-base font-medium placeholder:text-muted-foreground/50 focus:outline-none focus:border-foreground transition-colors"
          />
        </div>

        {/* Phase: Font picker */}
        {phase === "pick" && (
          <div className="flex-1 overflow-y-auto px-6 py-4">
            {!fontsReady && (
              <p className="text-xs text-muted-foreground uppercase tracking-widest animate-pulse mb-4">
                Loading fonts…
              </p>
            )}
            <p className="text-xs text-muted-foreground uppercase tracking-widest mb-3">
              Select a font to continue
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {CUSTOM_FONTS.map((font) => (
                <FontPreviewCard
                  key={font.family}
                  font={font}
                  text={displayText}
                  selected={selectedFont?.family === font.family}
                  onClick={() => handleFontSelect(font)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Phase: Style editor */}
        {phase === "style" && selectedFont && styledOpts && (
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">

            {/* Live preview */}
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">Preview</p>
              <StyledPreview opts={styledOpts} />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              {/* Text color */}
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">Text Color</p>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                    className="w-10 h-10 cursor-pointer border border-border bg-transparent p-0.5 rounded-none"
                  />
                  <span className="text-xs font-mono font-bold uppercase">{color}</span>
                </div>
              </div>

              {/* Outline */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Outline</p>
                  <span className="text-xs font-mono font-bold">{outlineWidth}px</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={24}
                  value={outlineWidth}
                  onChange={(e) => setOutlineWidth(Number(e.target.value))}
                  className="w-full accent-foreground mb-3"
                />
                {outlineWidth > 0 && (
                  <div className="flex items-center gap-3">
                    <input
                      type="color"
                      value={outlineColor}
                      onChange={(e) => setOutlineColor(e.target.value)}
                      className="w-8 h-8 cursor-pointer border border-border bg-transparent p-0.5 rounded-none"
                    />
                    <span className="text-xs font-mono font-bold uppercase text-muted-foreground">
                      Outline color: {outlineColor}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Arc / curve */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                  Curve / Arc
                </p>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono font-bold">
                    {arcDeg === 0
                      ? "Straight"
                      : arcDeg > 0
                      ? `Arch up ${arcDeg}°`
                      : `Arch down ${Math.abs(arcDeg)}°`}
                  </span>
                  {arcDeg !== 0 && (
                    <button
                      onClick={() => setArcDeg(0)}
                      className="text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors border border-border px-1.5 py-0.5"
                    >
                      Reset
                    </button>
                  )}
                </div>
              </div>
              <input
                type="range"
                min={-300}
                max={300}
                step={5}
                value={arcDeg}
                onChange={(e) => setArcDeg(Number(e.target.value))}
                className="w-full accent-foreground"
              />
              <div className="flex justify-between mt-1">
                <span className="text-xs text-muted-foreground">Arch Down ↓</span>
                <span className="text-xs text-muted-foreground">Straight</span>
                <span className="text-xs text-muted-foreground">Arch Up ↑</span>
              </div>
            </div>

          </div>
        )}

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border shrink-0 flex items-center justify-between gap-3">
          {phase === "style" && selectedFont ? (
            <>
              <div className="flex items-center gap-2">
                <div
                  className="w-5 h-5 border border-border/40"
                  style={{ backgroundColor: color, boxShadow: outlineWidth > 0 ? `0 0 0 ${Math.min(outlineWidth, 4)}px ${outlineColor}` : undefined }}
                />
                <span className="text-xs text-muted-foreground">
                  {selectedFont.name}
                </span>
              </div>
              <button
                onClick={handleConfirm}
                disabled={rendering || !text.trim()}
                className="text-xs uppercase tracking-widest font-bold px-6 py-2.5 bg-foreground text-background hover:opacity-80 transition-opacity disabled:opacity-40"
              >
                {rendering ? "Rendering…" : "Add to Design"}
              </button>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              {selectedFont ? `Font: ${selectedFont.name} — click a font to change` : "Click a font above to continue"}
            </p>
          )}
        </div>

      </div>
    </div>
  );
}
