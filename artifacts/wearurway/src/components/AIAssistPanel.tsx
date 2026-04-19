import { useState, useRef, useCallback } from "react";

interface AIResponse {
  message: string;
  seedPoints: { x: number; y: number }[];
  tolerance: number;
  edgeTolerance: number;
  hint: string | null;
}

type RefineMode = "erase" | "restore" | null;

interface Props {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  onApplyResult: (seedPoints: { x: number; y: number }[], tolerance: number, edgeTolerance: number) => void;
  refineMode: RefineMode;
  onRefineMode: (mode: RefineMode) => void;
  brushSize: number;
  brushHard: number;
  onBrushSize: (v: number) => void;
  onBrushHard: (v: number) => void;
}

type MessageRole = "user" | "assistant";

interface ChatMessage {
  role: MessageRole;
  text: string;
  hint?: string | null;
  applied?: boolean;
}

const QUICK_ACTIONS = [
  { label: "Remove Background",  prompt: "Remove the background completely, keep only the main subject", icon: "✂️" },
  { label: "Keep Subject Only",  prompt: "Remove everything except the main subject in the foreground", icon: "👤" },
  { label: "Remove Shadow",      prompt: "Remove the shadow areas from the image",                      icon: "🌑" },
  { label: "Isolate Product",    prompt: "Isolate the product, remove all background elements",         icon: "📦" },
];

function resizeImageToBase64(canvas: HTMLCanvasElement, maxSize = 800): string {
  const scale = Math.min(1, maxSize / canvas.width, maxSize / canvas.height);
  const w = Math.max(1, Math.round(canvas.width * scale));
  const h = Math.max(1, Math.round(canvas.height * scale));
  const tmp = document.createElement("canvas");
  tmp.width = w; tmp.height = h;
  const ctx = tmp.getContext("2d");
  if (!ctx) return "";
  ctx.drawImage(canvas, 0, 0, w, h);
  return tmp.toDataURL("image/png", 0.9).replace(/^data:image\/png;base64,/, "");
}

export default function AIAssistPanel({
  canvasRef, onApplyResult,
  refineMode, onRefineMode,
  brushSize, brushHard, onBrushSize, onBrushHard,
}: Props) {
  const [messages,    setMessages]    = useState<ChatMessage[]>([]);
  const [input,       setInput]       = useState("");
  const [loading,     setLoading]     = useState(false);
  const [hasApplied,  setHasApplied]  = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef       = useRef<HTMLInputElement>(null);

  const scrollToBottom = useCallback(() => {
    setTimeout(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, 60);
  }, []);

  const sendPrompt = useCallback(async (prompt: string) => {
    const c = canvasRef.current;
    if (!c || loading) return;

    const base64 = resizeImageToBase64(c, 800);
    if (!base64) return;

    setMessages(prev => [...prev, { role: "user", text: prompt }]);
    setInput("");
    setLoading(true);
    scrollToBottom();

    try {
      const res = await fetch("/api/ai/select-assist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: base64, prompt, width: c.width, height: c.height }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Request failed" }));
        setMessages(prev => [...prev, {
          role: "assistant",
          text: (err as { error?: string }).error ?? "Something went wrong. Please try again.",
        }]);
        return;
      }

      const data: AIResponse = await res.json();
      const applied = data.seedPoints.length > 0;

      setMessages(prev => [...prev, {
        role: "assistant",
        text: data.message,
        hint: data.hint,
        applied,
      }]);

      if (applied) {
        onApplyResult(data.seedPoints, data.tolerance, data.edgeTolerance);
        setHasApplied(true);
      }
    } catch {
      setMessages(prev => [...prev, {
        role: "assistant",
        text: "Connection error. Please check your connection and try again.",
      }]);
    } finally {
      setLoading(false);
      scrollToBottom();
    }
  }, [canvasRef, loading, onApplyResult, scrollToBottom]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || loading) return;
    sendPrompt(trimmed);
  };

  const showQuickActions = messages.length === 0 && !loading;

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: "#0d0d0d" }}>

      {/* ── Header ── */}
      <div className="px-5 pt-5 pb-4 border-b shrink-0" style={{ borderColor: "rgba(168,85,247,0.15)" }}>
        <div className="flex items-center gap-2.5 mb-1.5">
          <div className="relative">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center text-sm"
              style={{ background: "linear-gradient(135deg,#a855f7,#7c3aed)" }}>
              ✦
            </div>
            <div className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 animate-pulse"
              style={{ backgroundColor: "#22c55e", borderColor: "#0d0d0d" }}/>
          </div>
          <div>
            <p className="text-[12px] font-black uppercase tracking-[0.2em] text-white">AI Studio</p>
            <p className="text-[9px] text-white/30 uppercase tracking-widest">Powered by GPT Vision</p>
          </div>
        </div>
        <p className="text-[10px] leading-relaxed mt-2" style={{ color: "rgba(196,140,255,0.6)" }}>
          Describe what to edit — I analyze your image and apply changes instantly.
        </p>
      </div>

      {/* ── Quick Actions ── */}
      {showQuickActions && (
        <div className="px-4 pt-5 pb-3 shrink-0">
          <p className="text-[9px] uppercase tracking-[0.3em] mb-3" style={{ color: "rgba(255,255,255,0.2)" }}>
            Quick Actions
          </p>
          <div className="space-y-2">
            {QUICK_ACTIONS.map(a => (
              <button
                key={a.label}
                onClick={() => sendPrompt(a.prompt)}
                disabled={loading}
                className="w-full text-left flex items-center gap-3 px-4 py-3.5 rounded-xl transition-all disabled:opacity-40"
                style={{ backgroundColor: "rgba(168,85,247,0.07)", border: "1px solid rgba(168,85,247,0.14)" }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor = "rgba(168,85,247,0.15)"; (e.currentTarget as HTMLElement).style.borderColor = "rgba(168,85,247,0.3)"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = "rgba(168,85,247,0.07)"; (e.currentTarget as HTMLElement).style.borderColor = "rgba(168,85,247,0.14)"; }}
              >
                <span className="text-lg leading-none">{a.icon}</span>
                <div>
                  <p className="text-[11px] font-bold text-white/80">{a.label}</p>
                </div>
                <span className="ml-auto text-white/20 text-[11px]">→</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Messages ── */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0" style={{ scrollbarWidth: "none" }}>
        {messages.map((msg, i) => (
          <div key={i}>
            {msg.role === "user" && (
              <div className="flex justify-end">
                <div className="rounded-2xl rounded-tr-sm px-4 py-2.5 text-[11px] leading-relaxed max-w-[88%]"
                  style={{ backgroundColor: "rgba(168,85,247,0.28)", color: "#e2c9ff" }}>
                  {msg.text}
                </div>
              </div>
            )}
            {msg.role === "assistant" && (
              <div className="space-y-1.5">
                <div className="rounded-2xl rounded-tl-sm px-4 py-3 text-[11px] leading-relaxed"
                  style={{ backgroundColor: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.82)" }}>
                  <div className="flex items-start gap-2.5">
                    <span className="text-sm leading-none mt-0.5 shrink-0" style={{ color: "#a855f7" }}>✦</span>
                    <div className="space-y-2 w-full">
                      <p>{msg.text}</p>
                      {msg.applied && (
                        <div className="flex items-center gap-2 pt-1 pb-0.5">
                          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full"
                            style={{ backgroundColor: "rgba(34,197,94,0.12)", border: "1px solid rgba(34,197,94,0.25)" }}>
                            <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: "#22c55e" }}/>
                            <span className="text-[9px] font-black uppercase tracking-widest" style={{ color: "#22c55e" }}>
                              Applied
                            </span>
                          </div>
                        </div>
                      )}
                      {msg.hint && (
                        <p className="text-[10px] italic" style={{ color: "rgba(168,85,247,0.6)" }}>
                          {msg.hint}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div className="rounded-2xl rounded-tl-sm px-4 py-3"
            style={{ backgroundColor: "rgba(168,85,247,0.07)", border: "1px solid rgba(168,85,247,0.2)" }}>
            <div className="flex items-center gap-3">
              <span className="text-sm" style={{ color: "#a855f7" }}>✦</span>
              <div className="flex gap-1">
                {[0,1,2].map(i => (
                  <div key={i} className="w-1.5 h-1.5 rounded-full animate-bounce"
                    style={{ backgroundColor: "#a855f7", animationDelay: `${i * 0.15}s` }} />
                ))}
              </div>
              <span className="text-[10px]" style={{ color: "rgba(196,140,255,0.5)" }}>Analyzing image…</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* ── Input ── */}
      <div className="px-4 py-3 shrink-0 border-t" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            disabled={loading}
            placeholder="e.g. remove the white background…"
            className="flex-1 px-3.5 py-2.5 rounded-xl text-[11px] text-white placeholder-white/20 outline-none transition-all disabled:opacity-40"
            style={{ backgroundColor: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.09)" }}
            onFocus={e => { (e.target as HTMLInputElement).style.borderColor = "rgba(168,85,247,0.55)"; (e.target as HTMLInputElement).style.backgroundColor = "rgba(168,85,247,0.05)"; }}
            onBlur={e => { (e.target as HTMLInputElement).style.borderColor = "rgba(255,255,255,0.09)"; (e.target as HTMLInputElement).style.backgroundColor = "rgba(255,255,255,0.06)"; }}
          />
          <button type="submit" disabled={loading || !input.trim()}
            className="px-3.5 py-2.5 rounded-xl font-black text-[14px] transition-all hover:scale-105 active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
            style={{ background: loading ? "rgba(168,85,247,0.4)" : "linear-gradient(135deg,#a855f7,#7c3aed)", color: "#fff" }}>
            {loading ? "…" : "↑"}
          </button>
        </form>
        <p className="text-[9px] text-white/12 mt-2 text-center tracking-wide">
          Changes are applied directly to your image
        </p>
      </div>

      {/* ── Refine Edges ── */}
      {hasApplied && (
        <div className="px-4 py-4 border-t shrink-0"
          style={{ borderColor: "rgba(168,85,247,0.15)", background: "rgba(168,85,247,0.04)" }}>
          <p className="text-[9px] uppercase tracking-[0.3em] mb-3" style={{ color: "rgba(255,255,255,0.25)" }}>
            Refine Edges
          </p>
          <div className="flex gap-2 mb-3">
            <button
              onClick={() => onRefineMode(refineMode === "erase" ? null : "erase")}
              className="flex-1 py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all"
              style={refineMode === "erase"
                ? { background: "rgba(168,85,247,0.3)", border: "1px solid rgba(168,85,247,0.6)", color: "#e2c9ff" }
                : { background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.4)" }}>
              ✕ Erase
            </button>
            <button
              onClick={() => onRefineMode(refineMode === "restore" ? null : "restore")}
              className="flex-1 py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all"
              style={refineMode === "restore"
                ? { background: "rgba(34,197,94,0.2)", border: "1px solid rgba(34,197,94,0.5)", color: "#86efac" }
                : { background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.4)" }}>
              ↩ Restore
            </button>
          </div>
          {refineMode && (
            <div className="space-y-3">
              <div>
                <div className="flex justify-between mb-1.5">
                  <span className="text-[9px] uppercase tracking-widest" style={{ color: "rgba(255,255,255,0.25)" }}>Brush Size</span>
                  <span className="text-[9px] font-mono" style={{ color: "rgba(255,255,255,0.4)" }}>{brushSize}px</span>
                </div>
                <input type="range" min={2} max={120} value={brushSize}
                  onChange={e => onBrushSize(Number(e.target.value))}
                  className="w-full accent-[#a855f7]" />
              </div>
              <div>
                <div className="flex justify-between mb-1.5">
                  <span className="text-[9px] uppercase tracking-widest" style={{ color: "rgba(255,255,255,0.25)" }}>Softness</span>
                  <span className="text-[9px] font-mono" style={{ color: "rgba(255,255,255,0.4)" }}>{Math.round((1 - brushHard) * 100)}%</span>
                </div>
                <input type="range" min={0} max={100} value={Math.round((1 - brushHard) * 100)}
                  onChange={e => onBrushHard(1 - Number(e.target.value) / 100)}
                  className="w-full accent-[#a855f7]" />
              </div>
              <p className="text-[9px] text-center" style={{ color: "rgba(255,255,255,0.18)" }}>
                {refineMode === "erase" ? "Paint over areas to erase" : "Paint to restore original pixels"}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
