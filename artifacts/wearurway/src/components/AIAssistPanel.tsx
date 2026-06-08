import { useState, useRef } from "react";

type ToolMode = "select" | null;

interface Props {
  toolMode: ToolMode;
  hasSelection: boolean;
  onSetToolMode: (mode: ToolMode) => void;
  onDelete: () => void;
  onChangeColor: (color: string) => void;
  onPreviewColor: (color: string) => void;
  onCancelColorPreview: () => void;
  onClearSelection: () => void;
  sensitivity: number;
  onSensitivity: (v: number) => void;
  onDownloadImage: () => void;
}

const WandIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 18, height: 18 }}>
    <path d="M15 4V2"/><path d="M15 16v-2"/><path d="M8 9h2"/><path d="M20 9h2"/>
    <path d="M17.8 11.8 19 13"/><path d="M15 9h.01"/><path d="M17.8 6.2 19 5"/>
    <path d="m3 21 9-9"/><path d="M12.2 6.2 11 5"/>
  </svg>
);

export default function FuzzySelectPanel({
  toolMode, hasSelection,
  onSetToolMode, onDelete, onChangeColor, onPreviewColor, onCancelColorPreview, onClearSelection,
  sensitivity, onSensitivity, onDownloadImage,
}: Props) {
  const [pickedColor, setPickedColor] = useState("#ff0000");
  const [hexInput, setHexInput]       = useState("#ff0000");
  const [showPicker,  setShowPicker]  = useState(false);
  const colorInputRef = useRef<HTMLInputElement>(null);

  const [showBgRemoverConfirm, setShowBgRemoverConfirm] = useState(false);

  const handleOpenBgRemover = () => {
    setShowBgRemoverConfirm(true);
  };

  const handleBgRemoverConfirm = () => {
    setShowBgRemoverConfirm(false);
    onDownloadImage();
    setTimeout(() => {
      window.open("https://www.photoroom.com/tools/background-remover", "_blank", "noopener,noreferrer");
    }, 1500);
  };

  const updateColor = (color: string) => {
    setPickedColor(color);
    setHexInput(color.toUpperCase());
    onPreviewColor(color);
  };

  const handleHexChange = (raw: string) => {
    const v = raw.startsWith("#") ? raw : `#${raw}`;
    setHexInput(v.toUpperCase());
    if (/^#([0-9a-fA-F]{6})$/.test(v)) {
      const lower = v.toLowerCase();
      setPickedColor(lower);
      onPreviewColor(lower);
    }
  };

  const handleApplyColor = () => {
    onChangeColor(pickedColor);
    setShowPicker(false);
  };

  const handleTogglePicker = () => {
    setShowPicker(v => {
      const next = !v;
      // Closing the picker without applying — revert any live preview.
      if (!next) onCancelColorPreview();
      return next;
    });
  };

  const selectActive = toolMode === "select";

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: "#0d0d0d" }}>

      {/* ── BG Remover Confirm Modal ── */}
      {showBgRemoverConfirm && (
        <div className="fixed inset-0 z-[200] flex items-end justify-center p-4"
          style={{ backgroundColor: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)" }}
          onClick={() => setShowBgRemoverConfirm(false)}
        >
          <div className="w-full max-w-sm rounded-2xl p-5 mb-4"
            style={{ background: "linear-gradient(135deg,rgba(30,15,50,0.98),rgba(15,5,30,0.98))", border: "1px solid rgba(168,85,247,0.4)" }}
            onClick={e => e.stopPropagation()}
          >
            <p className="text-[10px] font-black uppercase tracking-[0.3em] mb-2" style={{ color: "#c48cff" }}>
              Background Remover
            </p>
            <p className="text-sm text-white/80 leading-relaxed mb-4">
              Do you want to download your image and open the background remover tool?
            </p>
            <button
              onClick={handleBgRemoverConfirm}
              className="w-full py-3.5 rounded-xl text-[13px] font-black uppercase tracking-widest transition-all active:scale-[0.98] mb-2"
              style={{ background: "linear-gradient(135deg,#a855f7,#7c3aed)", color: "#fff" }}
            >
              Yes, Download & Open →
            </button>
            <button
              onClick={() => setShowBgRemoverConfirm(false)}
              className="w-full py-2 text-[10px] uppercase tracking-widest text-white/30"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Header ── */}
      <div className="px-5 pt-5 pb-4 border-b shrink-0" style={{ borderColor: "rgba(168,85,247,0.15)" }}>
        <div className="flex items-center gap-2.5 mb-1">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center"
            style={{ background: "linear-gradient(135deg,#a855f7,#7c3aed)" }}>
            <WandIcon />
          </div>
          <div>
            <p className="text-[12px] font-black uppercase tracking-[0.2em] text-white">Tools</p>
            <p className="text-[9px] uppercase tracking-widest" style={{ color: "rgba(196,140,255,0.45)" }}>
              Select · Delete · Recolor
            </p>
          </div>
        </div>
      </div>

      {/* ── Tool toggles ── */}
      <div className="px-4 pt-4 flex flex-col gap-2.5 shrink-0">


        {/* Selection strength — 3 simple presets instead of a raw slider */}
        {selectActive && (
          <div className="px-3 py-3 rounded-xl"
            style={{ backgroundColor: "rgba(168,85,247,0.07)", border: "1px solid rgba(168,85,247,0.18)" }}>
            <p className="text-[10px] font-bold uppercase tracking-wider mb-2.5" style={{ color: "rgba(196,140,255,0.8)" }}>
              How much to remove?
            </p>
            <div className="grid grid-cols-3 gap-1.5">
              {([
                { label: "A little", desc: "Tight edges", value: 18 },
                { label: "Normal", desc: "Best for most", value: 42 },
                { label: "A lot", desc: "Wide areas", value: 78 },
              ] as const).map(opt => (
                <button
                  key={opt.label}
                  onClick={() => onSensitivity(opt.value)}
                  className="flex flex-col items-center gap-0.5 py-2.5 px-1 rounded-xl transition-all"
                  style={
                    Math.abs(sensitivity - opt.value) < 20
                      ? { background: "linear-gradient(135deg,rgba(168,85,247,0.35),rgba(124,58,237,0.25))", border: "1px solid rgba(168,85,247,0.6)", color: "#e2c9ff" }
                      : { backgroundColor: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.09)", color: "rgba(255,255,255,0.4)" }
                  }
                >
                  <span className="text-[11px] font-black">{opt.label}</span>
                  <span className="text-[8px] opacity-70">{opt.desc}</span>
                </button>
              ))}
            </div>
            <p className="text-[9px] mt-2 text-center" style={{ color: "rgba(196,140,255,0.4)" }}>
              Not happy? Tap Undo and try another option
            </p>
          </div>
        )}
      </div>

      {/* ── Waiting state ── */}
      {selectActive && !hasSelection && (
        <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4 relative"
            style={{ background: "linear-gradient(135deg,rgba(168,85,247,0.13),rgba(124,58,237,0.08))", border: "1px solid rgba(168,85,247,0.2)" }}>
            <div className="absolute inset-0 rounded-2xl animate-ping opacity-15"
              style={{ backgroundColor: "rgba(168,85,247,0.4)" }} />
            <svg viewBox="0 0 24 24" fill="none" stroke="#a855f7" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 26, height: 26 }}>
              <path d="M15 4V2"/><path d="M15 16v-2"/><path d="M8 9h2"/><path d="M20 9h2"/>
              <path d="M17.8 11.8 19 13"/><path d="M15 9h.01"/><path d="M17.8 6.2 19 5"/>
              <path d="m3 21 9-9"/><path d="M12.2 6.2 11 5"/>
            </svg>
          </div>
          <p className="text-[13px] font-bold text-white mb-1.5">Click the image</p>
          <p className="text-[10px] leading-relaxed" style={{ color: "rgba(255,255,255,0.3)" }}>
            Tap any part of your image to select similar pixels. Works best on solid colors and backgrounds.
          </p>
        </div>
      )}

      {!toolMode && !hasSelection && (
        <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
          <p className="text-[10px]" style={{ color: "rgba(255,255,255,0.2)" }}>
            Pick a tool above,<br/>then interact with your image.
          </p>
        </div>
      )}

      {/* ── Selection actions (shown when an area is selected) ── */}
      {hasSelection && (
        <div className="flex-1 px-4 pt-4 flex flex-col gap-3 overflow-y-auto">

          {/* Selection indicator */}
          <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl"
            style={{ backgroundColor: "rgba(168,85,247,0.1)", border: "1px solid rgba(168,85,247,0.25)" }}>
            <div className="relative">
              <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: "#a855f7" }} />
              <div className="absolute inset-0 rounded-full animate-ping" style={{ backgroundColor: "rgba(168,85,247,0.5)" }} />
            </div>
            <p className="text-[11px] font-bold" style={{ color: "#e2c9ff" }}>Area selected</p>
          </div>

          {/* Delete */}
          <button
            onClick={onDelete}
            className="w-full flex items-center justify-center gap-2.5 py-3.5 rounded-2xl font-black text-[13px] uppercase tracking-widest transition-all hover:scale-[1.02] active:scale-[0.98]"
            style={{ background: "linear-gradient(135deg,#ef4444,#dc2626)", color: "#fff", boxShadow: "0 4px 18px rgba(239,68,68,0.28)" }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 15, height: 15 }}>
              <path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>
              <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
            </svg>
            Delete Selected
          </button>

          {/* Change Color */}
          <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.1)" }}>
            <button
              onClick={handleTogglePicker}
              className="w-full flex items-center gap-3 px-4 py-3.5 transition-all"
              style={{ backgroundColor: showPicker ? "rgba(168,85,247,0.12)" : "rgba(255,255,255,0.04)" }}
            >
              <div className="w-7 h-7 rounded-lg border-2 shrink-0 transition-all"
                style={{ backgroundColor: pickedColor, borderColor: showPicker ? "rgba(168,85,247,0.7)" : "rgba(255,255,255,0.2)" }} />
              <div className="text-left flex-1">
                <p className="text-[12px] font-bold text-white">Change Color</p>
                <p className="text-[9px]" style={{ color: "rgba(255,255,255,0.35)" }}>
                  {showPicker ? "Pick a color below" : "Recolor selected area"}
                </p>
              </div>
              <svg viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                style={{ width: 14, height: 14, transform: showPicker ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>
                <path d="m6 9 6 6 6-6"/>
              </svg>
            </button>

            {showPicker && (
              <div className="px-4 pb-4 pt-2" style={{ backgroundColor: "rgba(255,255,255,0.02)" }}>
                {/* Big color picker — click anywhere to open native picker for any shade */}
                <button
                  type="button"
                  onClick={() => colorInputRef.current?.click()}
                  className="relative w-full h-24 rounded-xl mb-3 overflow-hidden cursor-pointer transition-all hover:scale-[1.01] active:scale-[0.99]"
                  style={{ backgroundColor: pickedColor, border: "1px solid rgba(255,255,255,0.18)", boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.25)" }}
                  data-testid="button-open-color-picker"
                  aria-label="Open color picker"
                >
                  <input
                    ref={colorInputRef}
                    type="color"
                    value={pickedColor}
                    onChange={e => updateColor(e.target.value)}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    data-testid="input-color-picker"
                  />
                  <div className="absolute bottom-1.5 right-2 px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider"
                    style={{ backgroundColor: "rgba(0,0,0,0.55)", color: "rgba(255,255,255,0.85)" }}>
                    Tap to pick any shade
                  </div>
                </button>

                {/* Hex input — type any color */}
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-9 h-9 rounded-lg shrink-0" style={{ backgroundColor: pickedColor, border: "1px solid rgba(255,255,255,0.15)" }} />
                  <div className="flex-1 flex items-center rounded-lg overflow-hidden"
                    style={{ backgroundColor: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}>
                    <span className="pl-2.5 text-[11px] font-mono font-bold" style={{ color: "rgba(255,255,255,0.35)" }}>#</span>
                    <input
                      type="text"
                      value={hexInput.replace(/^#/, "")}
                      onChange={e => handleHexChange(e.target.value)}
                      maxLength={6}
                      placeholder="RRGGBB"
                      className="flex-1 bg-transparent px-1.5 py-2 text-[11px] font-mono font-bold text-white outline-none uppercase tracking-wider"
                      data-testid="input-hex-color"
                    />
                  </div>
                </div>

                {/* Apply Color — large, prominent, with helper text so users
                    know they have to confirm to keep the picked color. */}
                <div className="rounded-xl p-2.5 mb-3"
                  style={{ background: "linear-gradient(135deg,rgba(168,85,247,0.15),rgba(124,58,237,0.10))", border: "1px solid rgba(168,85,247,0.35)" }}>
                  <p className="text-[9px] text-center uppercase tracking-[0.18em] mb-2" style={{ color: "rgba(196,140,255,0.85)" }}>
                    ✦ Click Apply to keep this color
                  </p>
                  <button onClick={handleApplyColor}
                    className="w-full py-3.5 rounded-lg text-[13px] font-black uppercase tracking-widest transition-all hover:scale-[1.02] active:scale-95 flex items-center justify-center gap-2"
                    style={{ background: "linear-gradient(135deg,#a855f7,#7c3aed)", color: "#fff", boxShadow: "0 4px 18px rgba(168,85,247,0.35)" }}
                    data-testid="button-apply-color">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ width: 16, height: 16 }}>
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                    Apply Color
                  </button>
                </div>

                {/* Optional quick presets */}
                <p className="text-[9px] uppercase tracking-widest mb-1.5" style={{ color: "rgba(255,255,255,0.3)" }}>
                  Quick presets
                </p>
                <div className="grid grid-cols-8 gap-1.5">
                  {["#ffffff","#000000","#ef4444","#f97316","#eab308","#22c55e","#3b82f6","#a855f7",
                    "#ec4899","#14b8a6","#8b5cf6","#f59e0b","#10b981","#6366f1","#64748b","#1e293b"].map(c => (
                    <button key={c} onClick={() => updateColor(c)}
                      className="w-full aspect-square rounded-md border-2 transition-all hover:scale-110"
                      style={{ backgroundColor: c, borderColor: pickedColor.toLowerCase() === c ? "#fff" : "transparent" }} />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Clear selection */}
          <button onClick={onClearSelection}
            className="w-full py-2 text-[10px] uppercase tracking-widest transition-all hover:opacity-70"
            style={{ color: "rgba(255,255,255,0.25)" }}>
            Clear Selection
          </button>
        </div>
      )}

      {/* ── Shortcuts box ── */}
      <div className="px-4 py-3 border-t shrink-0" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
        <div className="rounded-xl p-3"
          style={{ backgroundColor: "rgba(168,85,247,0.06)", border: "1px solid rgba(168,85,247,0.18)" }}>
          <div className="flex items-center gap-1.5 mb-2">
            <svg viewBox="0 0 24 24" fill="none" stroke="rgba(196,140,255,0.85)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 11, height: 11 }}>
              <rect x="2" y="6" width="20" height="12" rx="2"/>
              <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>
            </svg>
            <p className="text-[9px] font-black uppercase tracking-[0.2em]" style={{ color: "rgba(196,140,255,0.85)" }}>
              Shortcuts
            </p>
          </div>
          <ul className="space-y-1.5">
            {[
              { keys: "Hold right-click", label: "Move / Pan" },
              { keys: "Scroll", label: "Zoom" },
              { keys: "Ctrl + Z", label: "Undo" },
              { keys: "Ctrl + Y", label: "Redo" },
              { keys: "Esc", label: "Deselect" },
            ].map(s => (
              <li key={s.keys} className="flex items-center justify-between gap-2">
                <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.55)" }}>{s.label}</span>
                <kbd className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded"
                  style={{ backgroundColor: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.85)" }}>
                  {s.keys}
                </kbd>
              </li>
            ))}
          </ul>
        </div>
      </div>

    </div>
  );
}
