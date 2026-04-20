import { useState, useRef } from "react";

type ToolMode = "select" | null;

interface Props {
  toolMode: ToolMode;
  hasSelection: boolean;
  onSetToolMode: (mode: ToolMode) => void;
  onDelete: () => void;
  onChangeColor: (color: string) => void;
  onClearSelection: () => void;
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
  onSetToolMode, onDelete, onChangeColor, onClearSelection,
}: Props) {
  const [pickedColor, setPickedColor] = useState("#ff0000");
  const [showPicker,  setShowPicker]  = useState(false);
  const colorInputRef = useRef<HTMLInputElement>(null);

  const handleApplyColor = () => {
    onChangeColor(pickedColor);
    setShowPicker(false);
  };

  const selectActive = toolMode === "select";

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: "#0d0d0d" }}>

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

        {/* Magic Select */}
        <button
          onClick={() => onSetToolMode("select")}
          className="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-2xl transition-all"
          style={selectActive
            ? { background: "linear-gradient(135deg,rgba(168,85,247,0.22),rgba(124,58,237,0.22))", border: "1px solid rgba(168,85,247,0.5)", color: "#e2c9ff" }
            : { backgroundColor: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.09)", color: "rgba(255,255,255,0.45)" }
          }
        >
          <div className="flex items-center gap-2.5">
            <div className={`w-6 h-6 rounded-lg flex items-center justify-center transition-all ${selectActive ? "opacity-100" : "opacity-40"}`}
              style={{ backgroundColor: selectActive ? "rgba(168,85,247,0.3)" : "rgba(255,255,255,0.07)" }}>
              <WandIcon />
            </div>
            <div className="text-left">
              <p className={`text-[11px] font-bold ${selectActive ? "text-white" : "text-white/45"}`}>Magic Select</p>
              <p className="text-[9px] mt-0.5" style={{ color: selectActive ? "rgba(196,140,255,0.65)" : "rgba(255,255,255,0.22)" }}>
                {selectActive ? "Click image to select area" : "Click to activate"}
              </p>
            </div>
          </div>
          <div className="shrink-0 w-9 h-5 rounded-full relative transition-all"
            style={{ backgroundColor: selectActive ? "#a855f7" : "rgba(255,255,255,0.1)" }}>
            <div className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all"
              style={{ left: selectActive ? "calc(100% - 1.125rem)" : "0.125rem" }} />
          </div>
        </button>
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
              onClick={() => setShowPicker(v => !v)}
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
                <div className="flex items-center gap-3 mb-3">
                  <input
                    ref={colorInputRef}
                    type="color"
                    value={pickedColor}
                    onChange={e => setPickedColor(e.target.value)}
                    className="w-10 h-10 rounded-lg cursor-pointer border-0 p-0"
                    style={{ backgroundColor: "transparent" }}
                  />
                  <div className="flex-1">
                    <p className="text-[10px] font-mono font-bold text-white/70">{pickedColor.toUpperCase()}</p>
                    <p className="text-[9px]" style={{ color: "rgba(255,255,255,0.3)" }}>Selected color</p>
                  </div>
                </div>
                <div className="grid grid-cols-8 gap-1.5 mb-3">
                  {["#ffffff","#000000","#ef4444","#f97316","#eab308","#22c55e","#3b82f6","#a855f7",
                    "#ec4899","#14b8a6","#8b5cf6","#f59e0b","#10b981","#6366f1","#64748b","#1e293b"].map(c => (
                    <button key={c} onClick={() => setPickedColor(c)}
                      className="w-full aspect-square rounded-md border-2 transition-all hover:scale-110"
                      style={{ backgroundColor: c, borderColor: pickedColor === c ? "#fff" : "transparent" }} />
                  ))}
                </div>
                <button onClick={handleApplyColor}
                  className="w-full py-2.5 rounded-xl text-[11px] font-black uppercase tracking-widest transition-all hover:scale-[1.02] active:scale-95"
                  style={{ background: "linear-gradient(135deg,#a855f7,#7c3aed)", color: "#fff" }}>
                  Apply Color
                </button>
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

      {/* ── Footer ── */}
      <div className="px-4 py-3 border-t shrink-0" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
        <p className="text-[9px] text-center tracking-wide" style={{ color: "rgba(255,255,255,0.15)" }}>
          Ctrl+Z undo · Ctrl+Y redo · Esc deselect · Scroll zoom
        </p>
      </div>
    </div>
  );
}
