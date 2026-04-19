import { useState, useRef, useCallback, useEffect } from "react";

export interface ImageAdjustments {
  brightness?: number;
  contrast?: number;
  saturation?: number;
  sharpen?: boolean;
}

interface AIAction {
  type: "remove_pixels" | "adjust" | "describe";
  seedPoints?: { x: number; y: number }[];
  tolerance?: number;
  edgeTolerance?: number;
  brightness?: number;
  contrast?: number;
  saturation?: number;
  sharpen?: boolean;
}

interface AICommandResponse {
  message: string;
  intent: string;
  plan: string[];
  action: AIAction;
  hint: string | null;
}

type RefineMode = "erase" | "restore" | null;

interface Props {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  onApplyResult: (seedPoints: { x: number; y: number }[], tolerance: number, edgeTolerance: number) => void;
  onApplyAdjustments: (adjustments: ImageAdjustments) => void;
  refineMode: RefineMode;
  onRefineMode: (mode: RefineMode) => void;
  brushSize: number;
  brushHard: number;
  onBrushSize: (v: number) => void;
  onBrushHard: (v: number) => void;
}

type MessageRole = "user" | "assistant";

interface PendingAction {
  response: AICommandResponse;
  confirmed: boolean | null;
}

interface ChatMessage {
  role: MessageRole;
  text: string;
  plan?: string[];
  hint?: string | null;
  applied?: boolean;
  declined?: boolean;
  actionType?: string;
  adjustments?: ImageAdjustments;
}

const QUICK_ACTIONS = [
  { label: "Remove Background",    prompt: "Remove the background completely, keep only the main subject",               icon: "✂️", category: "select" },
  { label: "Keep Subject Only",    prompt: "Remove everything except the main subject in the foreground",                icon: "👤", category: "select" },
  { label: "Isolate Product",      prompt: "Isolate the product, remove all background elements",                        icon: "📦", category: "select" },
  { label: "Remove Shadow",        prompt: "Remove the shadow areas from the image",                                     icon: "🌑", category: "select" },
  { label: "Enhance Image",        prompt: "Enhance the overall image quality — sharper, better contrast and color",     icon: "✨", category: "adjust" },
  { label: "Fix Lighting",         prompt: "Fix the lighting — make it brighter and more balanced",                     icon: "💡", category: "adjust" },
  { label: "Make Professional",    prompt: "Make the image look more professional and polished",                         icon: "🏆", category: "adjust" },
  { label: "Boost Colors",         prompt: "Boost the colors and make them more vibrant and saturated",                 icon: "🎨", category: "adjust" },
];

const THINKING_STEPS = [
  "Understanding your request…",
  "Analyzing image content…",
  "Planning edits…",
  "Generating precise parameters…",
];

function resizeImageToBase64(canvas: HTMLCanvasElement, maxSize = 900): string {
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

function AdjustBadge({ action }: { action: AIAction }) {
  if (action.type !== "adjust") return null;
  const parts: string[] = [];
  if (action.brightness && action.brightness !== 0) parts.push(`${action.brightness > 0 ? "+" : ""}${action.brightness}% brightness`);
  if (action.contrast && action.contrast !== 0) parts.push(`${action.contrast > 0 ? "+" : ""}${action.contrast}% contrast`);
  if (action.saturation && action.saturation !== 0) parts.push(`${action.saturation > 0 ? "+" : ""}${action.saturation}% saturation`);
  if (action.sharpen) parts.push("sharpen");
  if (parts.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1 mt-2">
      {parts.map((p, i) => (
        <span key={i} className="px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wide"
          style={{ backgroundColor: "rgba(168,85,247,0.15)", border: "1px solid rgba(168,85,247,0.3)", color: "#c084fc" }}>
          {p}
        </span>
      ))}
    </div>
  );
}

export default function AIAssistPanel({
  canvasRef, onApplyResult, onApplyAdjustments,
  refineMode, onRefineMode,
  brushSize, brushHard, onBrushSize, onBrushHard,
}: Props) {
  const [messages,        setMessages]        = useState<ChatMessage[]>([]);
  const [input,           setInput]           = useState("");
  const [loading,         setLoading]         = useState(false);
  const [thinkingStep,    setThinkingStep]    = useState(0);
  const [hasApplied,      setHasApplied]      = useState(false);
  const [pending,         setPending]         = useState<PendingAction | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef       = useRef<HTMLInputElement>(null);
  const thinkingRef    = useRef<ReturnType<typeof setInterval> | null>(null);

  const scrollToBottom = useCallback(() => {
    setTimeout(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, 60);
  }, []);

  useEffect(() => {
    if (loading) {
      setThinkingStep(0);
      thinkingRef.current = setInterval(() => {
        setThinkingStep(s => (s + 1) % THINKING_STEPS.length);
      }, 900);
    } else {
      if (thinkingRef.current) clearInterval(thinkingRef.current);
    }
    return () => { if (thinkingRef.current) clearInterval(thinkingRef.current); };
  }, [loading]);

  const executeAction = useCallback((response: AICommandResponse, userPrompt: string) => {
    const { action } = response;
    if (action.type === "remove_pixels" && action.seedPoints && action.seedPoints.length > 0) {
      onApplyResult(action.seedPoints, action.tolerance ?? 40, action.edgeTolerance ?? 60);
      setMessages(prev => {
        const next = [...prev];
        const idx = next.findLastIndex(m => m.role === "assistant" && m.plan);
        if (idx >= 0) next[idx] = { ...next[idx], applied: true };
        return next;
      });
      setHasApplied(true);
    } else if (action.type === "adjust") {
      const adjustments: ImageAdjustments = {
        brightness:  action.brightness,
        contrast:    action.contrast,
        saturation:  action.saturation,
        sharpen:     action.sharpen,
      };
      onApplyAdjustments(adjustments);
      setMessages(prev => {
        const next = [...prev];
        const idx = next.findLastIndex(m => m.role === "assistant" && m.plan);
        if (idx >= 0) next[idx] = { ...next[idx], applied: true, adjustments };
        return next;
      });
      setHasApplied(true);
    }
    setPending(null);
    void userPrompt;
  }, [onApplyResult, onApplyAdjustments]);

  const sendPrompt = useCallback(async (prompt: string) => {
    const c = canvasRef.current;
    if (!c || loading) return;

    const base64 = resizeImageToBase64(c, 900);
    if (!base64) return;

    setMessages(prev => [...prev, { role: "user", text: prompt }]);
    setInput("");
    setLoading(true);
    setPending(null);
    scrollToBottom();

    try {
      const res = await fetch("/api/ai/command", {
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

      const data: AICommandResponse = await res.json();
      const hasAction = data.action.type !== "describe" && (
        (data.action.type === "remove_pixels" && (data.action.seedPoints?.length ?? 0) > 0) ||
        data.action.type === "adjust"
      );

      setMessages(prev => [...prev, {
        role: "assistant",
        text: data.message,
        plan: data.plan,
        hint: data.hint,
        applied: false,
        actionType: data.action.type,
      }]);

      if (hasAction) {
        setPending({ response: data, confirmed: null });
      }

      scrollToBottom();
    } catch {
      setMessages(prev => [...prev, {
        role: "assistant",
        text: "Connection error. Please check your connection and try again.",
      }]);
    } finally {
      setLoading(false);
      scrollToBottom();
    }
  }, [canvasRef, loading, scrollToBottom]);

  const handleConfirm = useCallback(() => {
    if (!pending) return;
    executeAction(pending.response, "");
  }, [pending, executeAction]);

  const handleDecline = useCallback(() => {
    setMessages(prev => {
      const next = [...prev];
      const idx = next.findLastIndex(m => m.role === "assistant" && m.plan);
      if (idx >= 0) next[idx] = { ...next[idx], declined: true };
      return next;
    });
    setPending(null);
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || loading) return;
    sendPrompt(trimmed);
  };

  const showQuickActions = messages.length === 0 && !loading;
  const selectActions = QUICK_ACTIONS.filter(a => a.category === "select");
  const adjustActions = QUICK_ACTIONS.filter(a => a.category === "adjust");

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: "#0d0d0d" }}>

      {/* ── Header ── */}
      <div className="px-5 pt-5 pb-4 border-b shrink-0" style={{ borderColor: "rgba(168,85,247,0.15)" }}>
        <div className="flex items-center gap-2.5 mb-1.5">
          <div className="relative">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center text-sm font-bold"
              style={{ background: "linear-gradient(135deg,#a855f7,#7c3aed)" }}>
              ✦
            </div>
            <div className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 animate-pulse"
              style={{ backgroundColor: "#22c55e", borderColor: "#0d0d0d" }} />
          </div>
          <div>
            <p className="text-[12px] font-black uppercase tracking-[0.2em] text-white">AI Studio</p>
            <p className="text-[9px] uppercase tracking-widest" style={{ color: "rgba(196,140,255,0.45)" }}>
              Advanced Vision Assistant
            </p>
          </div>
        </div>
        <p className="text-[10px] leading-relaxed mt-2.5" style={{ color: "rgba(196,140,255,0.55)" }}>
          Describe any edit — I analyze your image, plan the approach, and apply it with your approval.
        </p>
        <div className="flex gap-1.5 mt-3">
          {["Selections", "Adjustments", "Enhancement"].map(tag => (
            <span key={tag} className="px-2 py-0.5 rounded-full text-[8px] font-bold uppercase tracking-widest"
              style={{ backgroundColor: "rgba(168,85,247,0.1)", border: "1px solid rgba(168,85,247,0.2)", color: "rgba(196,140,255,0.6)" }}>
              {tag}
            </span>
          ))}
        </div>
      </div>

      {/* ── Quick Actions ── */}
      {showQuickActions && (
        <div className="px-4 pt-4 pb-2 shrink-0 overflow-y-auto" style={{ scrollbarWidth: "none" }}>
          <p className="text-[9px] uppercase tracking-[0.3em] mb-2.5" style={{ color: "rgba(255,255,255,0.18)" }}>
            Selection &amp; Removal
          </p>
          <div className="space-y-1.5 mb-4">
            {selectActions.map(a => (
              <button
                key={a.label}
                onClick={() => sendPrompt(a.prompt)}
                disabled={loading}
                className="w-full text-left flex items-center gap-3 px-3.5 py-3 rounded-xl transition-all disabled:opacity-40 group"
                style={{ backgroundColor: "rgba(168,85,247,0.06)", border: "1px solid rgba(168,85,247,0.12)" }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor = "rgba(168,85,247,0.14)"; (e.currentTarget as HTMLElement).style.borderColor = "rgba(168,85,247,0.28)"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = "rgba(168,85,247,0.06)"; (e.currentTarget as HTMLElement).style.borderColor = "rgba(168,85,247,0.12)"; }}
              >
                <span className="text-base leading-none">{a.icon}</span>
                <p className="text-[11px] font-bold text-white/80 flex-1">{a.label}</p>
                <span className="text-white/20 text-[11px] group-hover:text-white/40 transition-colors">→</span>
              </button>
            ))}
          </div>
          <p className="text-[9px] uppercase tracking-[0.3em] mb-2.5" style={{ color: "rgba(255,255,255,0.18)" }}>
            Adjustments &amp; Enhancement
          </p>
          <div className="space-y-1.5">
            {adjustActions.map(a => (
              <button
                key={a.label}
                onClick={() => sendPrompt(a.prompt)}
                disabled={loading}
                className="w-full text-left flex items-center gap-3 px-3.5 py-3 rounded-xl transition-all disabled:opacity-40 group"
                style={{ backgroundColor: "rgba(59,130,246,0.06)", border: "1px solid rgba(59,130,246,0.12)" }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor = "rgba(59,130,246,0.14)"; (e.currentTarget as HTMLElement).style.borderColor = "rgba(59,130,246,0.28)"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = "rgba(59,130,246,0.06)"; (e.currentTarget as HTMLElement).style.borderColor = "rgba(59,130,246,0.12)"; }}
              >
                <span className="text-base leading-none">{a.icon}</span>
                <p className="text-[11px] font-bold text-white/80 flex-1">{a.label}</p>
                <span className="text-white/20 text-[11px] group-hover:text-white/40 transition-colors">→</span>
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
                <div className="rounded-2xl rounded-tr-sm px-4 py-2.5 text-[11px] leading-relaxed max-w-[90%]"
                  style={{ backgroundColor: "rgba(168,85,247,0.25)", color: "#e2c9ff" }}>
                  {msg.text}
                </div>
              </div>
            )}
            {msg.role === "assistant" && (
              <div className="space-y-2">
                <div className="rounded-2xl rounded-tl-sm px-4 py-3.5 text-[11px] leading-relaxed"
                  style={{ backgroundColor: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.82)" }}>
                  <div className="flex items-start gap-2.5">
                    <span className="text-sm leading-none mt-0.5 shrink-0" style={{ color: "#a855f7" }}>✦</span>
                    <div className="space-y-2.5 w-full">
                      <p className="text-[11px] leading-relaxed">{msg.text}</p>

                      {/* Plan steps */}
                      {msg.plan && msg.plan.length > 0 && !msg.applied && !msg.declined && (
                        <div className="rounded-lg overflow-hidden mt-1"
                          style={{ backgroundColor: "rgba(168,85,247,0.07)", border: "1px solid rgba(168,85,247,0.15)" }}>
                          <div className="px-3 py-2 border-b" style={{ borderColor: "rgba(168,85,247,0.12)" }}>
                            <p className="text-[9px] font-black uppercase tracking-[0.25em]" style={{ color: "rgba(196,140,255,0.6)" }}>
                              Action Plan
                            </p>
                          </div>
                          <div className="px-3 py-2 space-y-1.5">
                            {msg.plan.map((step, si) => (
                              <div key={si} className="flex items-start gap-2">
                                <span className="text-[9px] font-black mt-0.5 shrink-0" style={{ color: "#a855f7" }}>{si + 1}.</span>
                                <p className="text-[10px] leading-relaxed" style={{ color: "rgba(255,255,255,0.55)" }}>{step}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Applied state */}
                      {msg.applied && (
                        <div className="flex items-center gap-2 flex-wrap">
                          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full"
                            style={{ backgroundColor: "rgba(34,197,94,0.12)", border: "1px solid rgba(34,197,94,0.25)" }}>
                            <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: "#22c55e" }} />
                            <span className="text-[9px] font-black uppercase tracking-widest" style={{ color: "#22c55e" }}>
                              Applied
                            </span>
                          </div>
                          {msg.adjustments && <AdjustBadge action={{ type: "adjust", ...msg.adjustments }} />}
                        </div>
                      )}

                      {/* Declined state */}
                      {msg.declined && (
                        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full w-fit"
                          style={{ backgroundColor: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}>
                          <span className="text-[9px] font-black uppercase tracking-widest" style={{ color: "rgba(255,255,255,0.3)" }}>
                            Skipped
                          </span>
                        </div>
                      )}

                      {msg.hint && (
                        <p className="text-[10px] italic" style={{ color: "rgba(168,85,247,0.55)" }}>
                          💡 {msg.hint}
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                {/* Confirmation buttons — shown only for the latest pending message */}
                {pending && i === messages.length - 1 && !msg.applied && !msg.declined && (
                  <div className="flex gap-2 pl-1">
                    <button
                      onClick={handleConfirm}
                      className="flex-1 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all hover:scale-[1.02] active:scale-95"
                      style={{ background: "linear-gradient(135deg,#a855f7,#7c3aed)", color: "#fff" }}>
                      ✓ Apply Changes
                    </button>
                    <button
                      onClick={handleDecline}
                      className="px-4 py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all hover:opacity-70"
                      style={{ backgroundColor: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.4)" }}>
                      ✕
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}

        {/* Thinking animation */}
        {loading && (
          <div className="rounded-2xl rounded-tl-sm px-4 py-3.5"
            style={{ backgroundColor: "rgba(168,85,247,0.06)", border: "1px solid rgba(168,85,247,0.18)" }}>
            <div className="flex items-start gap-2.5">
              <span className="text-sm mt-0.5 shrink-0" style={{ color: "#a855f7" }}>✦</span>
              <div className="space-y-2.5 w-full">
                <div className="flex items-center gap-2.5">
                  <div className="flex gap-1">
                    {[0, 1, 2].map(i => (
                      <div key={i} className="w-1.5 h-1.5 rounded-full animate-bounce"
                        style={{ backgroundColor: "#a855f7", animationDelay: `${i * 0.15}s` }} />
                    ))}
                  </div>
                  <span className="text-[10px]" style={{ color: "rgba(196,140,255,0.6)" }}>
                    {THINKING_STEPS[thinkingStep]}
                  </span>
                </div>
                <div className="h-0.5 rounded-full overflow-hidden" style={{ backgroundColor: "rgba(168,85,247,0.12)" }}>
                  <div className="h-full rounded-full animate-pulse" style={{ width: "60%", background: "linear-gradient(90deg,#a855f7,#7c3aed)" }} />
                </div>
              </div>
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
            placeholder="e.g. remove background, fix lighting…"
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
        <p className="text-[9px] text-white/15 mt-2 text-center tracking-wide">
          AI analyzes &amp; plans — you confirm before changes apply
        </p>
      </div>

      {/* ── Refine Edges ── */}
      {hasApplied && (
        <div className="px-4 py-4 border-t shrink-0"
          style={{ borderColor: "rgba(168,85,247,0.15)", background: "rgba(168,85,247,0.04)" }}>
          <p className="text-[9px] uppercase tracking-[0.3em] mb-3" style={{ color: "rgba(255,255,255,0.22)" }}>
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
