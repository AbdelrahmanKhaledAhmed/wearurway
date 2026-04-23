import { useState, useCallback, useRef, useEffect } from "react";

interface Props {
  onClose: () => void;
  onUploadFile: (file: File) => void;
}

type Stage = "step1" | "step2" | "canvaInstructions" | "uploadFinal";

const CANVA_URL = "https://www.canva.com/magic-layers/";

export default function EditorHelpWizard({ onClose, onUploadFile }: Props) {
  const [stage, setStage] = useState<Stage>("step1");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleFile = useCallback(
    (file: File) => {
      onUploadFile(file);
      onClose();
    },
    [onUploadFile, onClose],
  );

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/85 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-[#141414] border p-8 relative shadow-2xl text-white max-h-[90vh] overflow-y-auto"
        style={{ borderColor: "rgba(168,85,247,0.35)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-white/40 hover:text-white text-2xl leading-none w-8 h-8 flex items-center justify-center"
          aria-label="Close"
        >
          ×
        </button>

        {stage === "step1" && <Step1 onNext={() => setStage("step2")} />}
        {stage === "step2" && (
          <Step2 onCanva={() => setStage("canvaInstructions")} />
        )}
        {stage === "canvaInstructions" && (
          <CanvaInstructions
            onUnderstand={() => {
              window.open(CANVA_URL, "_blank", "noopener,noreferrer");
              setStage("uploadFinal");
            }}
          />
        )}
        {stage === "uploadFinal" && <UploadFinal onFile={handleFile} />}
      </div>
    </div>
  );
}

function Header({ kicker, title }: { kicker: string; title: string }) {
  return (
    <div className="mb-5">
      <p
        className="text-[10px] font-bold uppercase tracking-[0.25em] mb-2"
        style={{ color: "rgba(196,140,255,0.9)" }}
      >
        {kicker}
      </p>
      <h2 className="text-xl font-black uppercase tracking-wide leading-tight">
        {title}
      </h2>
    </div>
  );
}

function PrimaryButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full py-4 rounded-lg font-black uppercase text-sm tracking-[0.2em] transition-all hover:scale-[1.01] active:scale-[0.99]"
      style={{
        background: "linear-gradient(135deg,#a855f7,#7c3aed)",
        color: "#fff",
      }}
    >
      {children}
    </button>
  );
}

function Step1({ onNext }: { onNext: () => void }) {
  return (
    <>
      <Header kicker="Need Help?" title="We've Got You Covered" />
      <p className="text-sm leading-relaxed text-white/80 mb-7">
        No stress at all — just upload your image and we'll handle everything.
        Once you place your order, we'll contact you immediately to confirm all
        the details. We'll first listen to everything you want to change, then
        professionally edit the design in Photoshop with you until it's exactly
        the way you imagine it.
      </p>
      <PrimaryButton onClick={onNext}>Next →</PrimaryButton>
    </>
  );
}

function Step2({ onCanva }: { onCanva: () => void }) {
  return (
    <>
      <Header kicker="Try It Yourself" title="Design With Canva" />
      <p className="text-sm leading-relaxed text-white/80 mb-7">
        If you'd like to try creating your design yourself in a more
        professional, easy, and simple way, you can go to Canva. Once you click
        the Canva button, you'll find a simple guide that walks you through
        everything step by step so your design comes out exactly the way you
        imagine.
      </p>
      <PrimaryButton onClick={onCanva}>Canva</PrimaryButton>
    </>
  );
}

function CanvaInstructions({ onUnderstand }: { onUnderstand: () => void }) {
  const steps = [
    'Click on "Try Magic Layers"',
    "Log in using your email",
    'Click "Select Media"',
    "Upload your design",
    "The editor will open, where you can edit everything",
    "You will see all layers separated",
    "Select any layer you want to edit or remove (text, background, etc.)",
  ];
  return (
    <>
      <Header kicker="Step By Step" title="How To Use Canva" />
      <p className="text-xs uppercase tracking-widest text-white/50 mb-3">
        After clicking the link, follow these steps:
      </p>
      <ol className="space-y-2 mb-5">
        {steps.map((step, i) => (
          <li key={i} className="flex gap-3 text-sm text-white/85 leading-snug">
            <span
              className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-black"
              style={{
                background: "rgba(168,85,247,0.18)",
                color: "rgba(196,140,255,0.95)",
                border: "1px solid rgba(168,85,247,0.35)",
              }}
            >
              {i + 1}
            </span>
            <span className="pt-0.5">{step}</span>
          </li>
        ))}
      </ol>

      <div
        className="border-l-2 p-4 mb-6"
        style={{
          borderColor: "#f5c842",
          background: "rgba(245,200,66,0.08)",
        }}
      >
        <p
          className="text-[10px] font-black uppercase tracking-[0.2em] mb-2"
          style={{ color: "#f5c842" }}
        >
          ⚠ Important Note
        </p>
        <p className="text-xs text-white/85 leading-relaxed mb-2">
          When removing the background, it does NOT become transparent. It
          becomes a solid color.
        </p>
        <p className="text-xs text-white/85 leading-relaxed mb-2">So:</p>
        <ul className="text-xs text-white/85 leading-relaxed list-disc pl-5 mb-2 space-y-1">
          <li>If your design (text or character) is white</li>
          <li>Make the background a different color (e.g. black)</li>
        </ul>
        <p className="text-xs text-white/85 leading-relaxed">
          Then you can remove the background later using the{" "}
          <span className="font-bold">Magic Tool</span> inside our website.
        </p>
      </div>

      <PrimaryButton onClick={onUnderstand}>I Understand</PrimaryButton>
    </>
  );
}

function UploadFinal({ onFile }: { onFile: (file: File) => void }) {
  const [isDragging, setIsDragging] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [pasteError, setPasteError] = useState<string | null>(null);
  const dragDepthRef = useRef(0);

  const browse = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.click();
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) onFile(file);
    };
  }, [onFile]);

  const pasteFromClipboard = useCallback(async () => {
    setPasteError(null);
    setPasting(true);
    try {
      const anyNav = navigator as unknown as {
        clipboard?: { read?: () => Promise<Array<{ types: string[]; getType: (t: string) => Promise<Blob> }>> };
      };
      if (!anyNav.clipboard?.read) {
        throw new Error("Your browser doesn't support reading from the clipboard.");
      }
      const items = await anyNav.clipboard.read();
      for (const item of items) {
        const imageType = item.types.find((t) => t.startsWith("image/"));
        if (imageType) {
          const blob = await item.getType(imageType);
          const ext = imageType.split("/")[1] || "png";
          const file = new File([blob], `pasted-design.${ext}`, { type: imageType });
          onFile(file);
          return;
        }
      }
      throw new Error("No image found on your clipboard. Copy your downloaded image first, then try again.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Couldn't read your clipboard.";
      setPasteError(msg);
    } finally {
      setPasting(false);
    }
  }, [onFile]);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current += 1;
    if (e.dataTransfer.types.includes("Files")) setIsDragging(true);
  }, []);
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
  }, []);
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current -= 1;
    if (dragDepthRef.current <= 0) {
      dragDepthRef.current = 0;
      setIsDragging(false);
    }
  }, []);
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragDepthRef.current = 0;
      setIsDragging(false);
      const file = Array.from(e.dataTransfer.files).find((f) =>
        f.type.startsWith("image/"),
      );
      if (file) onFile(file);
    },
    [onFile],
  );

  return (
    <div
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className="relative"
    >
      <Header kicker="Almost Done" title="Upload Your Final Design" />
      <p className="text-sm text-white/70 mb-6 leading-relaxed">
        Once your design is ready in Canva, download it and upload it here so
        you can keep editing in our image editor.
      </p>

      <button
        onClick={pasteFromClipboard}
        disabled={pasting}
        className="group w-full flex items-center gap-4 px-5 py-4 mb-3 rounded-xl transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-60"
        style={{
          background: "linear-gradient(135deg,#a855f7,#7c3aed)",
          color: "#fff",
          boxShadow: "0 8px 24px rgba(124,58,237,0.35)",
        }}
      >
        <span className="w-10 h-10 flex items-center justify-center rounded-lg bg-white/15 text-base">
          📋
        </span>
        <div className="text-left flex-1">
          <p className="text-xs font-bold uppercase tracking-widest">
            {pasting ? "Reading Clipboard…" : "Use Last Downloaded"}
          </p>
          <p className="text-[10px] uppercase tracking-widest text-white/80 mt-0.5">
            Paste the image you just downloaded
          </p>
        </div>
        <span className="text-lg leading-none opacity-80 group-hover:translate-x-0.5 transition-all">
          →
        </span>
      </button>

      {pasteError && (
        <p
          className="text-[11px] mb-3 px-3 py-2 rounded"
          style={{
            background: "rgba(245,200,66,0.1)",
            color: "#f5c842",
            border: "1px solid rgba(245,200,66,0.35)",
          }}
        >
          {pasteError}
        </p>
      )}

      <button
        onClick={browse}
        className="group w-full flex items-center gap-4 border px-5 py-4 hover:bg-white/5 transition-all mb-3"
        style={{ borderColor: "rgba(255,255,255,0.15)" }}
      >
        <span className="w-10 h-10 flex items-center justify-center border border-white/15 text-base">
          📁
        </span>
        <div className="text-left flex-1">
          <p className="text-xs font-bold uppercase tracking-widest">
            Browse File
          </p>
          <p className="text-[10px] uppercase tracking-widest text-white/50 mt-0.5">
            Select your final design
          </p>
        </div>
        <span className="text-lg leading-none text-white/40 group-hover:translate-x-0.5 transition-all">
          →
        </span>
      </button>

      <div className="flex items-center gap-3 my-5">
        <div className="flex-1 h-px bg-white/10" />
        <span className="text-[10px] font-bold uppercase tracking-[0.25em] text-white/40">
          Or
        </span>
        <div className="flex-1 h-px bg-white/10" />
      </div>

      <div
        className={`w-full border-2 border-dashed px-4 py-10 text-center transition-colors ${
          isDragging ? "bg-white/5" : ""
        }`}
        style={{
          borderColor: isDragging
            ? "rgba(168,85,247,0.7)"
            : "rgba(255,255,255,0.18)",
        }}
      >
        <p className="text-3xl mb-3 leading-none">⬆</p>
        <p className="text-xs font-bold uppercase tracking-widest mb-1">
          {isDragging ? "Drop To Upload" : "Drag & Drop"}
        </p>
        <p className="text-[10px] uppercase tracking-widest text-white/50">
          Drop an image anywhere on this window
        </p>
      </div>
    </div>
  );
}
