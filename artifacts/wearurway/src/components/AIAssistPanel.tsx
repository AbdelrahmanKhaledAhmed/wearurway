import { useState, useRef, useCallback } from "react";

interface AIResponse {
  message: string;
  seedPoints: { x: number; y: number }[];
  tolerance: number;
  edgeTolerance: number;
  hint: string | null;
}

interface Props {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  onApplySuggestion: (seedPoints: { x: number; y: number }[], tolerance: number, edgeTolerance: number) => void;
  onClose: () => void;
}

type MessageRole = "user" | "assistant" | "system";

interface ChatMessage {
  role: MessageRole;
  text: string;
  hint?: string | null;
  hasSuggestion?: boolean;
  seedPoints?: { x: number; y: number }[];
  tolerance?: number;
  edgeTolerance?: number;
}

const SUGGESTIONS = [
  "Remove the white background",
  "Select the dark background",
  "Remove the background color",
  "Select the main subject",
  "Remove the shadow area",
];

function resizeImageToBase64(canvas: HTMLCanvasElement, maxSize = 512): string {
  const scale = Math.min(1, maxSize / canvas.width, maxSize / canvas.height);
  const w = Math.max(1, Math.round(canvas.width * scale));
  const h = Math.max(1, Math.round(canvas.height * scale));
  const tmp = document.createElement("canvas");
  tmp.width = w; tmp.height = h;
  const ctx = tmp.getContext("2d");
  if (!ctx) return "";
  ctx.drawImage(canvas, 0, 0, w, h);
  const dataUrl = tmp.toDataURL("image/png", 0.8);
  return dataUrl.replace(/^data:image\/png;base64,/, "");
}

export default function AIAssistPanel({ canvasRef, onApplySuggestion, onClose }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "system",
      text: "I can analyze your image and help you select the exact areas you want to remove. Describe what you want, or click a suggestion below.",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = useCallback(() => {
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, 50);
  }, []);

  const sendPrompt = useCallback(async (prompt: string) => {
    const c = canvasRef.current;
    if (!c || loading) return;

    const base64 = resizeImageToBase64(c, 512);
    if (!base64) return;

    setMessages(prev => [...prev, { role: "user", text: prompt }]);
    setInput("");
    setLoading(true);
    scrollToBottom();

    try {
      const res = await fetch("/api/ai/select-assist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageBase64: base64,
          prompt,
          width: c.width,
          height: c.height,
        }),
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

      setMessages(prev => [...prev, {
        role: "assistant",
        text: data.message,
        hint: data.hint,
        hasSuggestion: data.seedPoints.length > 0,
        seedPoints: data.seedPoints,
        tolerance: data.tolerance,
        edgeTolerance: data.edgeTolerance,
      }]);

      // Auto-apply if seed points found
      if (data.seedPoints.length > 0) {
        onApplySuggestion(data.seedPoints, data.tolerance, data.edgeTolerance);
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
  }, [canvasRef, loading, onApplySuggestion, scrollToBottom]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || loading) return;
    sendPrompt(trimmed);
  };

  const handleReapply = (msg: ChatMessage) => {
    if (msg.seedPoints && msg.tolerance !== undefined && msg.edgeTolerance !== undefined) {
      onApplySuggestion(msg.seedPoints, msg.tolerance, msg.edgeTolerance);
    }
  };

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: "#141414" }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b shrink-0" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: "#a855f7" }} />
          <span className="text-[11px] font-black uppercase tracking-[0.2em] text-white">AI Assistant</span>
        </div>
        <button onClick={onClose} className="text-white/30 hover:text-white/70 transition-colors text-[10px] uppercase tracking-widest font-bold px-2 py-1 rounded hover:bg-white/8">
          ✕ Close
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3" style={{ scrollbarWidth: "none" }}>
        {messages.map((msg, i) => (
          <div key={i}>
            {msg.role === "system" && (
              <div className="rounded-xl p-3 text-[11px] leading-relaxed" style={{ backgroundColor: "rgba(168,85,247,0.1)", border: "1px solid rgba(168,85,247,0.2)", color: "rgba(196,140,255,0.9)" }}>
                <div className="flex items-start gap-2">
                  <span className="text-base leading-none mt-0.5">✦</span>
                  <span>{msg.text}</span>
                </div>
              </div>
            )}

            {msg.role === "user" && (
              <div className="flex justify-end">
                <div className="rounded-xl px-3 py-2 text-[11px] leading-relaxed max-w-[85%]" style={{ backgroundColor: "rgba(168,85,247,0.25)", color: "#e2c9ff" }}>
                  {msg.text}
                </div>
              </div>
            )}

            {msg.role === "assistant" && (
              <div className="space-y-2">
                <div className="rounded-xl p-3 text-[11px] leading-relaxed" style={{ backgroundColor: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.8)" }}>
                  <div className="flex items-start gap-2">
                    <span className="text-base leading-none mt-0.5 shrink-0">🤖</span>
                    <div className="space-y-2">
                      <p>{msg.text}</p>
                      {msg.hasSuggestion && (
                        <div className="flex items-center gap-1.5 mt-2">
                          <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: "#22c55e" }} />
                          <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "#22c55e" }}>Selection applied — refine with manual tools</span>
                        </div>
                      )}
                      {msg.hint && (
                        <p className="text-[10px] mt-1" style={{ color: "rgba(255,255,255,0.35)" }}>
                          💡 {msg.hint}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
                {msg.hasSuggestion && (
                  <button onClick={() => handleReapply(msg)}
                    className="text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 rounded transition-all hover:opacity-90 w-full"
                    style={{ backgroundColor: "rgba(168,85,247,0.15)", border: "1px solid rgba(168,85,247,0.3)", color: "rgba(196,140,255,0.9)" }}>
                    ↺ Re-apply this suggestion
                  </button>
                )}
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div className="rounded-xl p-3" style={{ backgroundColor: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}>
            <div className="flex items-center gap-2">
              <span className="text-base leading-none">🤖</span>
              <div className="flex gap-1">
                {[0,1,2].map(i => (
                  <div key={i} className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ backgroundColor: "#a855f7", animationDelay: `${i*0.15}s` }} />
                ))}
              </div>
              <span className="text-[10px] text-white/30">Analyzing image…</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Quick suggestions */}
      {messages.length <= 1 && (
        <div className="px-4 pb-3 space-y-1.5 shrink-0">
          <p className="text-[9px] uppercase tracking-[0.25em] text-white/20 mb-2">Quick start</p>
          {SUGGESTIONS.map(s => (
            <button key={s} onClick={() => sendPrompt(s)} disabled={loading}
              className="w-full text-left text-[10px] px-3 py-2 rounded-lg transition-all hover:bg-white/8 text-white/40 hover:text-white/70 disabled:opacity-30"
              style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="px-4 pb-4 shrink-0" style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: "12px" }}>
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            disabled={loading}
            placeholder="Describe what to select…"
            className="flex-1 px-3 py-2 rounded-lg text-[11px] text-white placeholder-white/20 outline-none transition-all disabled:opacity-40"
            style={{ backgroundColor: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.1)" }}
            onFocus={e => { (e.target as HTMLInputElement).style.borderColor = "rgba(168,85,247,0.6)"; }}
            onBlur={e => { (e.target as HTMLInputElement).style.borderColor = "rgba(255,255,255,0.1)"; }}
          />
          <button type="submit" disabled={loading || !input.trim()}
            className="px-3 py-2 rounded-lg font-black text-[11px] transition-all hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
            style={{ backgroundColor: "#a855f7", color: "#fff" }}>
            {loading ? "…" : "↑"}
          </button>
        </form>
        <p className="text-[9px] text-white/15 mt-2 text-center">AI analyzes your image · You control the result</p>
      </div>
    </div>
  );
}
