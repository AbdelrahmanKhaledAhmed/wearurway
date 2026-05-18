import { useState, useEffect, useCallback } from "react";

// ── Replace these with the actual paths to your images in attached_assets ──
import RealImg1 from "@assets/photo_1.jpg";
import RealImg2 from "@assets/photo_2.png";
import RealImg3 from "@assets/photo_3.jpg";
import RealImg4 from "@assets/photo_4.png";

import MockImg1 from "@assets/mockup_1.png";
import MockImg2 from "@assets/mockup_2.png";
import MockImg3 from "@assets/mockup_3.png";
import MockImg4 from "@assets/mockup_4.png";

type MockSettings = { scale: number; y: number; x: number; splitHeight: number };
type RealSettings = { scale: number; y: number; x: number };

const defaultMock: MockSettings = { scale: 1.65, y: -48, x: -50, splitHeight: 42 };
const defaultReal: RealSettings = { scale: 1.0, y: 0, x: 0 };

const slidesData = [
  { real: RealImg1, mock: MockImg1, label: "IRON MIKE TYSON" },
  { real: RealImg2, mock: MockImg2, label: "FULL THROTTLE" },
  { real: RealImg3, mock: MockImg3, label: "525 EP" },
  { real: RealImg4, mock: MockImg4, label: "39 EXTRATEREAL" },
];

export default function LandingPage() {
  const [current, setCurrent] = useState(0);
  const [transitioning, setTransitioning] = useState(false);
  const [visibleIndex, setVisibleIndex] = useState(0);
  const [editMode, setEditMode] = useState(false);
  const [mock, setMock] = useState<MockSettings>({ ...defaultMock });
  const [reals, setReals] = useState<RealSettings[]>(slidesData.map(() => ({ ...defaultReal })));

  const goTo = useCallback((index: number) => {
    if (transitioning || index === current) return;
    setTransitioning(true);
    setTimeout(() => { setCurrent(index); setVisibleIndex(index); setTransitioning(false); }, 400);
  }, [transitioning, current]);

  const goNext = useCallback(() => goTo((current + 1) % slidesData.length), [current, goTo]);
  const goPrev = useCallback(() => goTo((current - 1 + slidesData.length) % slidesData.length), [current, goTo]);

  useEffect(() => {
    if (editMode) return;
    const t = setInterval(goNext, 5000);
    return () => clearInterval(t);
  }, [goNext, editMode]);

  const updateMock = (key: keyof MockSettings, delta: number) =>
    setMock(prev => ({ ...prev, [key]: +(prev[key] + delta).toFixed(2) }));

  const updateReal = (key: keyof RealSettings, delta: number) =>
    setReals(prev => {
      const next = [...prev];
      next[current] = { ...next[current], [key]: +(next[current][key] + delta).toFixed(2) };
      return next;
    });

  const r = reals[current];

  const btnStyle: React.CSSProperties = {
    width: "22px", height: "22px", border: "1px solid rgba(255,255,255,0.3)",
    background: "rgba(255,255,255,0.07)", color: "white", cursor: "pointer",
    fontFamily: "'Barlow', sans-serif", fontSize: "0.9rem", lineHeight: 1,
    display: "flex", alignItems: "center", justifyContent: "center",
  };

  const ControlRow = ({ label, onMinus, onPlus, value }: { label: string; onMinus: () => void; onPlus: () => void; value: number }) => (
    <div className="flex items-center justify-between gap-2">
      <span style={{ fontFamily: "'Barlow', sans-serif", fontSize: "0.58rem", letterSpacing: "0.08em", color: "rgba(255,255,255,0.55)", width: "90px" }}>{label}</span>
      <button onClick={onMinus} style={btnStyle}>−</button>
      <span style={{ fontFamily: "'Barlow', sans-serif", fontSize: "0.58rem", color: "rgba(255,255,255,0.45)", width: "38px", textAlign: "center" }}>{value}</span>
      <button onClick={onPlus} style={btnStyle}>+</button>
    </div>
  );

  const SlidePanel = ({ mobile }: { mobile: boolean }) => (
    <div style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden", display: "flex", flexDirection: "column" }}>
      {slidesData.map((slide, i) => (
        <div key={i} style={{
          position: "absolute", inset: 0, display: "flex", flexDirection: "column",
          opacity: i === visibleIndex ? (transitioning ? 0 : 1) : 0,
          transition: "opacity 0.5s ease",
        }}>
          {/* Mockup */}
          <div style={{ height: `${mock.splitHeight}%`, position: "relative", overflow: "hidden", background: "#111", flexShrink: 0 }}>
            <img src={slide.mock} alt={`${slide.label} mockup`} style={{
              position: "absolute", top: "50%", left: "50%",
              transform: `translate(${mock.x}%, ${mock.y}%) scale(${mock.scale})`,
              width: "100%", height: "100%", objectFit: "cover", objectPosition: "50% 52%",
              filter: "brightness(0.9) contrast(1.05)", transformOrigin: "center center",
            }} />
            <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: "40px", background: "linear-gradient(to bottom, transparent, #080808)", zIndex: 2 }} />
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "25px", background: "linear-gradient(to bottom, #080808, transparent)", zIndex: 2 }} />
            <div style={{ position: "absolute", top: "8px", left: "10px", zIndex: 3, fontFamily: "'Barlow', sans-serif", fontWeight: 600, fontSize: "0.42rem", letterSpacing: "0.2em", color: "rgba(255,255,255,0.5)", background: "rgba(0,0,0,0.6)", padding: "2px 7px", border: "1px solid rgba(255,255,255,0.15)" }}>
              MOCKUP DESIGN
            </div>
          </div>

          {/* Real photo */}
          <div style={{ flex: 1, position: "relative", overflow: "hidden", background: "#080808" }}>
            <img src={slide.real} alt={`${slide.label} worn`} style={{
              position: "absolute", top: "50%", left: "50%",
              transform: `translate(-50%, -50%) translate(${reals[i].x}%, ${reals[i].y}%) scale(${reals[i].scale})`,
              maxWidth: "100%", maxHeight: "100%", width: "auto", height: "auto",
              objectFit: "contain", filter: "brightness(0.85) contrast(1.05)", transformOrigin: "center center",
            }} />
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "25px", background: "linear-gradient(to bottom, #080808, transparent)", zIndex: 2 }} />
            <div style={{ position: "absolute", top: "10px", right: "10px", zIndex: 3, fontFamily: "'Barlow', sans-serif", fontWeight: 600, fontSize: "0.42rem", letterSpacing: "0.18em", color: "rgba(255,255,255,0.45)", background: "rgba(0,0,0,0.5)", padding: "2px 7px", border: "1px solid rgba(255,255,255,0.12)" }}>
              IN THE WILD
            </div>
          </div>
        </div>
      ))}

      {!mobile && (
        <div style={{ position: "absolute", inset: 0, zIndex: 5, pointerEvents: "none", background: "linear-gradient(to right, #080808 0%, #080808 4%, rgba(8,8,8,0.85) 18%, rgba(8,8,8,0.3) 38%, transparent 65%)" }} />
      )}
      {mobile && (
        <div style={{ position: "absolute", inset: 0, zIndex: 5, pointerEvents: "none", background: "linear-gradient(to bottom, #080808 0%, transparent 8%, transparent 88%, #080808 100%)" }} />
      )}
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: "40px", zIndex: 5, pointerEvents: "none", background: "linear-gradient(to bottom, transparent, #080808)" }} />
    </div>
  );

  return (
    <div className="relative w-full h-full flex flex-col" style={{ background: "#080808", fontFamily: "'Barlow Condensed', sans-serif", overflowX: "hidden", overflowY: "auto" }}>

      {/* NAV */}
      <nav className="relative z-20 flex items-center justify-between px-5 md:px-10 pt-5 pb-3 flex-shrink-0">
        <div className="cursor-pointer">
          <span className="text-white" style={{ fontSize: "1.5rem", letterSpacing: "-0.04em", fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 900 }}>
            WRW<sup style={{ fontSize: "0.4rem", verticalAlign: "super" }}>®</sup>
          </span>
        </div>
        <div className="flex items-center gap-5 md:gap-10">
          {["HOME", "ABOUT", "CONTACT"].map((item, i) => (
            <a key={item} href="#"
              className="relative text-white tracking-widest transition-opacity hover:opacity-100"
              style={{ fontFamily: "'Barlow', sans-serif", fontWeight: 500, letterSpacing: "0.18em", opacity: i === 0 ? 1 : 0.5, fontSize: "clamp(0.55rem, 1.5vw, 0.7rem)" }}
            >
              {item}
              {i === 0 && <span className="absolute -bottom-1 left-0 w-full bg-white" style={{ height: "1.5px" }} />}
            </a>
          ))}
        </div>
      </nav>

      {/* MOBILE LAYOUT */}
      <div className="flex md:hidden flex-col flex-1 min-h-0">
        <div className="flex-shrink-0" style={{ height: "42vh", position: "relative" }}>
          <SlidePanel mobile={true} />
        </div>

        <div className="relative z-20 flex flex-col px-5 pt-3 pb-2">
          <div className="flex items-center gap-2 mb-3">
            <div className="flex flex-col gap-1">
              <div className="w-6 h-px bg-white opacity-40" />
              <div className="w-6 h-px bg-white opacity-40" />
            </div>
            <p className="text-white leading-tight" style={{ fontFamily: "'Barlow', sans-serif", letterSpacing: "0.1em", opacity: 0.55, fontWeight: 400, fontSize: "0.6rem" }}>
              RULES ARE MADE · TO BE REWRITTEN.
            </p>
          </div>

          <h1 className="text-white leading-none" style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 900, fontSize: "clamp(3rem, 14vw, 5rem)", letterSpacing: "-0.01em", textTransform: "uppercase", lineHeight: 0.88 }}>
            WEARURWAY
          </h1>

          <p className="text-white mt-2" style={{ fontFamily: "'Barlow', sans-serif", fontWeight: 300, fontSize: "0.6rem", letterSpacing: "0.22em", opacity: 0.6 }}>
            PREMIUM STREETWEAR. YOUR RULES.
          </p>

          <div className="flex items-center gap-3 mt-3">
            <button onClick={goPrev} className="flex items-center justify-center text-white" style={{ width: "28px", height: "28px", border: "1px solid rgba(255,255,255,0.3)", background: "transparent", cursor: "pointer" }} aria-label="Previous">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
            </button>
            <div className="flex items-center gap-2">
              {slidesData.map((_, i) => (
                <button key={i} onClick={() => goTo(i)} style={{ width: i === current ? "18px" : "5px", height: "2px", background: i === current ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.28)", border: "none", padding: 0, borderRadius: "1px", cursor: "pointer", transition: "all 0.4s ease" }} aria-label={`Slide ${i + 1}`} />
              ))}
            </div>
            <button onClick={goNext} className="flex items-center justify-center text-white" style={{ width: "28px", height: "28px", border: "1px solid rgba(255,255,255,0.3)", background: "transparent", cursor: "pointer" }} aria-label="Next">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
            </button>
            <p key={current} style={{ fontFamily: "'Barlow', sans-serif", fontWeight: 600, fontSize: "0.45rem", letterSpacing: "0.2em", color: "rgba(255,255,255,0.4)", textTransform: "uppercase", animation: "fadeUp 0.5s ease" }}>
              {slidesData[current].label}
            </p>
          </div>

          <div className="mt-3">
            <button className="flex items-center gap-3 text-white tracking-widest px-5 py-3 transition-all duration-300 hover:bg-white hover:text-black group"
              style={{ fontFamily: "'Barlow', sans-serif", fontWeight: 600, letterSpacing: "0.18em", border: "1.5px solid rgba(255,255,255,0.6)", background: "transparent", fontSize: "0.6rem" }}
            >
              EXPLORE COLLECTION
              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="transition-transform duration-300 group-hover:translate-x-1">
                <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* DESKTOP LAYOUT */}
      <div className="hidden md:flex flex-1 min-h-0 relative">
        <div className="absolute z-0" style={{ right: 0, top: 0, width: "50%", height: "100%" }}>
          <SlidePanel mobile={false} />
        </div>

        <div className="relative z-20 flex flex-col px-10 pt-4 w-full">
          <div className="flex items-center gap-3 mb-6">
            <div className="flex flex-col gap-1">
              <div className="w-7 h-px bg-white opacity-40" />
              <div className="w-7 h-px bg-white opacity-40" />
            </div>
            <p className="text-white text-xs leading-tight" style={{ fontFamily: "'Barlow', sans-serif", letterSpacing: "0.1em", opacity: 0.55, fontWeight: 400 }}>
              RULES ARE MADE<br />TO BE REWRITTEN.
            </p>
          </div>

          <h1 className="text-white leading-none" style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 900, fontSize: "clamp(4.5rem, 12vw, 9.5rem)", letterSpacing: "-0.01em", textTransform: "uppercase", lineHeight: 0.88, maxWidth: "58%" }}>
            WEARURWAY
          </h1>

          <p className="text-white mt-5" style={{ fontFamily: "'Barlow', sans-serif", fontWeight: 300, fontSize: "0.78rem", letterSpacing: "0.25em", opacity: 0.65 }}>
            PREMIUM STREETWEAR. YOUR RULES.
          </p>

          <div className="mt-6">
            <button className="flex items-center gap-4 text-white text-xs tracking-widest px-7 py-4 transition-all duration-300 hover:bg-white hover:text-black group"
              style={{ fontFamily: "'Barlow', sans-serif", fontWeight: 600, letterSpacing: "0.2em", border: "1.5px solid rgba(255,255,255,0.6)", background: "transparent" }}
            >
              EXPLORE COLLECTION
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="transition-transform duration-300 group-hover:translate-x-1">
                <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
              </svg>
            </button>
          </div>
        </div>

        {/* Slide label */}
        <div className="absolute z-20 pointer-events-none" style={{ right: "52%", bottom: "18%", transform: "translateX(50%)" }}>
          <p key={current} style={{ fontFamily: "'Barlow', sans-serif", fontWeight: 600, fontSize: "0.55rem", letterSpacing: "0.25em", color: "rgba(255,255,255,0.5)", textTransform: "uppercase", animation: "fadeUp 0.5s ease" }}>
            {slidesData[current].label}
          </p>
        </div>

        {/* Nav arrows + dots */}
        <div className="absolute z-20 flex items-center gap-3" style={{ left: "40px", bottom: "18%" }}>
          <button onClick={goPrev} className="flex items-center justify-center text-white hover:bg-white hover:text-black transition-all" style={{ width: "32px", height: "32px", border: "1px solid rgba(255,255,255,0.3)", background: "transparent", cursor: "pointer" }} aria-label="Previous">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
          </button>
          <div className="flex items-center gap-2">
            {slidesData.map((_, i) => (
              <button key={i} onClick={() => goTo(i)} style={{ width: i === current ? "22px" : "6px", height: "2px", background: i === current ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.28)", border: "none", padding: 0, borderRadius: "1px", cursor: "pointer", transition: "all 0.4s ease" }} aria-label={`Slide ${i + 1}`} />
            ))}
          </div>
          <button onClick={goNext} className="flex items-center justify-center text-white hover:bg-white hover:text-black transition-all" style={{ width: "32px", height: "32px", border: "1px solid rgba(255,255,255,0.3)", background: "transparent", cursor: "pointer" }} aria-label="Next">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
          </button>
        </div>

        {/* Badge */}
        <div className="absolute z-10 pointer-events-none" style={{ right: "4%", bottom: "17%", width: "80px", height: "80px", border: "1px solid rgba(255,255,255,0.2)", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ width: "64px", height: "64px", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <p style={{ fontFamily: "'Barlow', sans-serif", fontWeight: 700, fontSize: "0.26rem", color: "rgba(255,255,255,0.5)", letterSpacing: "0.2em", textAlign: "center", textTransform: "uppercase", lineHeight: 1.9, padding: "0 5px" }}>PREMIUM<br />QUALITY<br />·<br />STREETWEAR</p>
          </div>
        </div>

        {/* Right-side vertical numbers */}
        <div className="absolute right-7 z-20 flex flex-col gap-5 items-center" style={{ top: "50%", transform: "translateY(-50%)" }}>
          {["01", "02", "03"].map((num, i) => (
            <div key={num} className="flex flex-col items-center gap-1 cursor-pointer">
              <span className="text-white" style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: i === 0 ? 700 : 400, fontSize: "0.65rem", letterSpacing: "0.08em", opacity: i === 0 ? 1 : 0.3 }}>{num}</span>
              {i === 0 && <div className="w-px bg-white" style={{ height: "8px", opacity: 0.7 }} />}
            </div>
          ))}
        </div>
      </div>

      {/* EDIT PANEL (desktop only) */}
      {editMode && (
        <div className="hidden md:flex absolute z-30 flex-col gap-2" style={{ right: "51%", top: "50%", transform: "translateY(-50%)", background: "rgba(0,0,0,0.93)", border: "1px solid rgba(255,255,255,0.15)", padding: "14px 16px", minWidth: "230px" }}>
          <p style={{ fontFamily: "'Barlow', sans-serif", fontWeight: 700, fontSize: "0.55rem", letterSpacing: "0.2em", color: "rgba(255,255,255,0.85)" }}>SLIDE {current + 1} — {slidesData[current].label}</p>
          <p style={{ fontFamily: "'Barlow', sans-serif", fontSize: "0.48rem", color: "rgba(255,255,255,0.38)", letterSpacing: "0.1em" }}>── MOCKUP (all slides) ──</p>
          <ControlRow label="Zoom"         onMinus={() => updateMock("scale", -0.05)} onPlus={() => updateMock("scale", 0.05)} value={mock.scale} />
          <ControlRow label="Up / Down"    onMinus={() => updateMock("y", -2)}        onPlus={() => updateMock("y", 2)}        value={mock.y} />
          <ControlRow label="Left / Right" onMinus={() => updateMock("x", -2)}        onPlus={() => updateMock("x", 2)}        value={mock.x} />
          <ControlRow label="Height %"     onMinus={() => updateMock("splitHeight", -2)} onPlus={() => updateMock("splitHeight", 2)} value={mock.splitHeight} />
          <p style={{ fontFamily: "'Barlow', sans-serif", fontSize: "0.48rem", color: "rgba(255,255,255,0.38)", letterSpacing: "0.1em" }}>── REAL PHOTO (this slide) ──</p>
          <ControlRow label="Zoom"         onMinus={() => updateReal("scale", -0.05)} onPlus={() => updateReal("scale", 0.05)} value={r.scale} />
          <ControlRow label="Up / Down"    onMinus={() => updateReal("y", -2)}        onPlus={() => updateReal("y", 2)}        value={r.y} />
          <ControlRow label="Left / Right" onMinus={() => updateReal("x", -2)}        onPlus={() => updateReal("x", 2)}        value={r.x} />
          <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: "7px" }}>
            <p style={{ fontFamily: "'Barlow', sans-serif", fontSize: "0.43rem", color: "rgba(255,255,255,0.28)", letterSpacing: "0.07em" }}>Use ‹ › arrows to switch slides while editing.</p>
          </div>
        </div>
      )}

      <button onClick={() => setEditMode(v => !v)}
        className="hidden md:block absolute z-30"
        style={{ top: "10px", right: "10px", fontFamily: "'Barlow', sans-serif", fontWeight: 600, fontSize: "0.5rem", letterSpacing: "0.18em", color: editMode ? "#080808" : "rgba(255,255,255,0.7)", background: editMode ? "rgba(255,255,255,0.95)" : "rgba(0,0,0,0.7)", border: "1px solid rgba(255,255,255,0.3)", padding: "5px 12px", cursor: "pointer" }}>
        {editMode ? "✓ EDITING" : "EDIT PHOTOS"}
      </button>

      <style>{`
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
