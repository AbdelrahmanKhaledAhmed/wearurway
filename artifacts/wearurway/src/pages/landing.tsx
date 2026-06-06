import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { getAdminToken } from "@/lib/admin-token";

import RealImg1 from "@assets/photo_1.png";
import RealImg2 from "@assets/photo_2.png";
import RealImg3 from "@assets/photo_3.png";
import RealImg4 from "@assets/photo_4.png";

import MockImg1 from "@assets/mockup_1.png";
import MockImg2 from "@assets/mockup_2.png";
import MockImg3 from "@assets/mockup_3.png";
import MockImg4 from "@assets/mockup_4.png";

type MockSettings = { scale: number; y: number; x: number; splitHeight: number };
type RealSettings = { scale: number; y: number; x: number };

const DEFAULT_MOCK: MockSettings = { scale: 1.65, y: -48, x: -50, splitHeight: 42 };
const DEFAULT_REAL: RealSettings = { scale: 1.0, y: 0, x: 0 };

const slidesData = [
  { real: RealImg1, mock: MockImg1 },
  { real: RealImg2, mock: MockImg2 },
  { real: RealImg3, mock: MockImg3 },
  { real: RealImg4, mock: MockImg4 },
];

export default function LandingPage() {
  const [, navigate] = useLocation();
  const [current, setCurrent] = useState(0);
  const [transitioning, setTransitioning] = useState(false);
  const [visibleIndex, setVisibleIndex] = useState(0);
  const [editMode, setEditMode] = useState(false);
  const [mock, setMock] = useState<MockSettings>({ ...DEFAULT_MOCK });
  const [reals, setReals] = useState<RealSettings[]>(slidesData.map(() => ({ ...DEFAULT_REAL })));
  const [showEditPhotosButton, setShowEditPhotosButton] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/order-settings")
      .then((r) => r.json())
      .then((data: { showEditPhotosButton?: boolean }) => {
        setShowEditPhotosButton(data.showEditPhotosButton ?? false);
      })
      .catch(() => {});

    // Load from localStorage first (instant, no auth needed)
    try {
      const savedMock = localStorage.getItem("ww_landing_mock");
      const savedReals = localStorage.getItem("ww_landing_reals");
      if (savedMock) setMock(JSON.parse(savedMock));
      if (savedReals) {
        const parsed = JSON.parse(savedReals);
        if (Array.isArray(parsed) && parsed.length === slidesData.length) setReals(parsed);
      }
    } catch {}

    // Also try server (will override localStorage if server has newer data)
    fetch("/api/landing-settings")
      .then((r) => r.json())
      .then((data: { mock?: MockSettings; reals?: RealSettings[] } | null) => {
        if (data?.mock) setMock(data.mock);
        if (data?.reals && data.reals.length === slidesData.length) setReals(data.reals);
      })
      .catch(() => {});
  }, []);

  const saveSettings = useCallback(async (mockData: MockSettings, realsData: RealSettings[]) => {
    setSaving(true);
    try {
      // Save to localStorage so it persists without needing admin auth
      localStorage.setItem("ww_landing_mock", JSON.stringify(mockData));
      localStorage.setItem("ww_landing_reals", JSON.stringify(realsData));
      // Also try server save if admin token exists
      const token = getAdminToken();
      if (token) {
        await fetch("/api/admin/landing-settings", {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`,
          },
          body: JSON.stringify({ mock: mockData, reals: realsData }),
        });
      }
    } catch {
    } finally {
      setSaving(false);
    }
  }, []);
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

  const toggleEditMode = () => {
    if (editMode) {
      saveSettings(mock, reals);
    }
    setEditMode(v => !v);
  };

  const navigateToProducts = () => navigate("/products");

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
          <div style={{ height: `${mock.splitHeight}%`, position: "relative", overflow: "hidden", background: "#111", flexShrink: 0 }}>
            <img src={slide.mock} alt="mockup" style={{
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
          <div style={{ flex: 1, position: "relative", overflow: "hidden", background: "#080808" }}>
            <img src={slide.real} alt="worn" style={{
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
        <>
          <div style={{ position: "absolute", inset: 0, zIndex: 5, pointerEvents: "none", background: "linear-gradient(to right, #080808 0%, #080808 4%, rgba(8,8,8,0.85) 18%, rgba(8,8,8,0.3) 38%, transparent 65%)" }} />
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "80px", zIndex: 6, pointerEvents: "none", background: "linear-gradient(to bottom, #080808, transparent)" }} />
          <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: "25px", zIndex: 6, pointerEvents: "none", background: "linear-gradient(to top, #080808, transparent)" }} />
          <div style={{ position: "absolute", top: 0, right: 0, bottom: 0, width: "60px", zIndex: 6, pointerEvents: "none", background: "linear-gradient(to left, #080808, transparent)" }} />
        </>
      )}
      {mobile && (
        <div style={{ position: "absolute", inset: 0, zIndex: 5, pointerEvents: "none", background: "linear-gradient(to bottom, #080808 0%, transparent 8%, transparent 88%, #080808 100%)" }} />
      )}
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: "18px", zIndex: 5, pointerEvents: "none", background: "linear-gradient(to bottom, transparent, #080808)" }} />
    </div>
  );

  return (
    <div className="relative w-full flex flex-col" style={{ background: "#080808", fontFamily: "'Barlow Condensed', sans-serif", overflowX: "hidden", overflowY: "auto", height: "100dvh" }}>

      {/* ── MOBILE LAYOUT ── */}
      <div className="flex md:hidden" style={{ flex: 1, minHeight: 0, position: "relative", minHeight: "calc(100dvh - 0px)" }}>
        {/* Full-screen photo background */}
        <div style={{ position: "absolute", inset: 0 }}>
          <SlidePanel mobile={true} />
        </div>

        {/* Bottom overlay: WEARURWAY + button */}
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, zIndex: 20, padding: "0 0 44px" }}>
          <h1 className="text-white leading-none" style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 900, fontSize: "clamp(3.5rem, 22.5vw, 5.5rem)", letterSpacing: "-0.02em", textTransform: "uppercase", lineHeight: 0.88, width: "100%", textAlign: "left", paddingLeft: "16px" }}>
            WEARURWAY
          </h1>
          <p className="text-white mt-2" style={{ fontFamily: "'Barlow', sans-serif", fontWeight: 300, fontSize: "0.6rem", letterSpacing: "0.22em", opacity: 0.6, paddingLeft: "16px" }}>
            PREMIUM STREETWEAR. YOUR RULES.
          </p>
          <div className="mt-4" style={{ paddingLeft: "16px" }}>
            <button
              className="flex items-center gap-3 text-white tracking-widest px-5 py-3 transition-all duration-300 hover:bg-white hover:text-black group"
              onClick={navigateToProducts}
              style={{ fontFamily: "'Barlow', sans-serif", fontWeight: 600, letterSpacing: "0.18em", border: "1.5px solid rgba(255,255,255,0.6)", background: "transparent", fontSize: "0.6rem" }}
            >
              START CUSTOMIZING
              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="transition-transform duration-300 group-hover:translate-x-1">
                <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* ── DESKTOP LAYOUT ── */}
      <div className="hidden md:flex relative" style={{ flex: 1, minHeight: 0, height: "100%" }}>
        <div className="absolute z-0" style={{ right: 0, top: 0, width: "50%", height: "100%" }}>
          <SlidePanel mobile={false} />
        </div>
        <div className="relative z-20 flex flex-col px-10 pt-4 w-full justify-center" style={{ alignItems: "flex-start" }}>
          <div className="mb-6" />
          <h1 className="text-white leading-none" style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 900, fontSize: "clamp(3rem, 7vw, 6rem)", letterSpacing: "-0.01em", textTransform: "uppercase", lineHeight: 0.88 }}>
            WEARURWAY
          </h1>
          <p className="text-white mt-5" style={{ fontFamily: "'Barlow', sans-serif", fontWeight: 300, fontSize: "0.78rem", letterSpacing: "0.25em", opacity: 0.65 }}>
            PREMIUM STREETWEAR. YOUR RULES.
          </p>
          <div className="mt-6">
            <button
              className="flex items-center gap-4 text-white text-xs tracking-widest px-7 py-4 transition-all duration-300 hover:bg-white hover:text-black group"
              onClick={navigateToProducts}
              style={{ fontFamily: "'Barlow', sans-serif", fontWeight: 600, letterSpacing: "0.2em", border: "1.5px solid rgba(255,255,255,0.6)", background: "transparent" }}
            >
              START CUSTOMIZING
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="transition-transform duration-300 group-hover:translate-x-1">
                <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
              </svg>
            </button>
          </div>
        </div>

        {/* EDIT PANEL (desktop only, visible when editMode active) */}
        {editMode && (
          <div className="hidden md:flex absolute z-30 flex-col gap-2" style={{ right: "51%", top: "50%", transform: "translateY(-50%)", background: "rgba(0,0,0,0.93)", border: "1px solid rgba(255,255,255,0.15)", padding: "14px 16px", minWidth: "230px" }}>
            <p style={{ fontFamily: "'Barlow', sans-serif", fontWeight: 700, fontSize: "0.55rem", letterSpacing: "0.2em", color: "rgba(255,255,255,0.85)" }}>SLIDE {current + 1}</p>
            <p style={{ fontFamily: "'Barlow', sans-serif", fontSize: "0.48rem", color: "rgba(255,255,255,0.38)", letterSpacing: "0.1em" }}>── MOCKUP (all slides) ──</p>
            <ControlRow label="Zoom" onMinus={() => updateMock("scale", -0.05)} onPlus={() => updateMock("scale", 0.05)} value={mock.scale} />
            <ControlRow label="Up / Down" onMinus={() => updateMock("y", -2)} onPlus={() => updateMock("y", 2)} value={mock.y} />
            <ControlRow label="Left / Right" onMinus={() => updateMock("x", -2)} onPlus={() => updateMock("x", 2)} value={mock.x} />
            <ControlRow label="Height %" onMinus={() => updateMock("splitHeight", -2)} onPlus={() => updateMock("splitHeight", 2)} value={mock.splitHeight} />
            <p style={{ fontFamily: "'Barlow', sans-serif", fontSize: "0.48rem", color: "rgba(255,255,255,0.38)", letterSpacing: "0.1em" }}>── REAL PHOTO (this slide) ──</p>
            <ControlRow label="Zoom" onMinus={() => updateReal("scale", -0.05)} onPlus={() => updateReal("scale", 0.05)} value={r.scale} />
            <ControlRow label="Up / Down" onMinus={() => updateReal("y", -2)} onPlus={() => updateReal("y", 2)} value={r.y} />
            <ControlRow label="Left / Right" onMinus={() => updateReal("x", -2)} onPlus={() => updateReal("x", 2)} value={r.x} />
            <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: "7px", marginTop: "4px", display: "flex", gap: "8px" }}>
              <button onClick={goPrev} style={{ ...btnStyle, width: "auto", padding: "0 8px", fontSize: "0.48rem", letterSpacing: "0.1em" }}>◀ PREV</button>
              <button onClick={goNext} style={{ ...btnStyle, width: "auto", padding: "0 8px", fontSize: "0.48rem", letterSpacing: "0.1em" }}>NEXT ▶</button>
            </div>
          </div>
        )}

        {/* EDIT PHOTOS button — only shown if enabled from admin panel */}
        {/* EDIT PHOTOS button — desktop */}
        {showEditPhotosButton && (
          <button
            onClick={toggleEditMode}
            className="absolute z-30"
            style={{ top: "10px", right: "10px", fontFamily: "'Barlow', sans-serif", fontWeight: 600, fontSize: "0.5rem", letterSpacing: "0.18em", color: editMode ? "#080808" : "rgba(255,255,255,0.7)", background: editMode ? "rgba(255,255,255,0.95)" : "rgba(0,0,0,0.7)", border: "1px solid rgba(255,255,255,0.3)", padding: "5px 12px", cursor: "pointer" }}
          >
            {saving ? "SAVING…" : editMode ? "DONE" : "EDIT PHOTOS"}
          </button>
        )}
      </div>

    {/* MOBILE EDIT PANEL */}
      {showEditPhotosButton && editMode && (
        <div className="md:hidden fixed inset-0 z-50 flex items-end" style={{ backgroundColor: "rgba(0,0,0,0.7)" }}>
          <div className="w-full flex flex-col gap-2 p-4" style={{ background: "rgba(10,10,10,0.98)", border: "1px solid rgba(255,255,255,0.12)", maxHeight: "70vh", overflowY: "auto" }}>
            <div className="flex items-center justify-between mb-1">
              <p style={{ fontFamily: "'Barlow', sans-serif", fontWeight: 700, fontSize: "0.55rem", letterSpacing: "0.2em", color: "rgba(255,255,255,0.85)" }}>SLIDE {current + 1} — EDIT</p>
              <button onClick={toggleEditMode} style={{ fontFamily: "'Barlow', sans-serif", fontWeight: 600, fontSize: "0.5rem", letterSpacing: "0.15em", color: "#080808", background: "rgba(255,255,255,0.95)", border: "none", padding: "4px 10px", cursor: "pointer" }}>
                {saving ? "SAVING…" : "DONE"}
              </button>
            </div>
            <p style={{ fontFamily: "'Barlow', sans-serif", fontSize: "0.48rem", color: "rgba(255,255,255,0.38)", letterSpacing: "0.1em" }}>── MOCKUP (all slides) ──</p>
            <ControlRow label="Zoom"         onMinus={() => updateMock("scale", -0.05)} onPlus={() => updateMock("scale", 0.05)} value={mock.scale} />
            <ControlRow label="Up / Down"    onMinus={() => updateMock("y", -2)}        onPlus={() => updateMock("y", 2)}        value={mock.y} />
            <ControlRow label="Left / Right" onMinus={() => updateMock("x", -2)}        onPlus={() => updateMock("x", 2)}        value={mock.x} />
            <ControlRow label="Height %"     onMinus={() => updateMock("splitHeight", -2)} onPlus={() => updateMock("splitHeight", 2)} value={mock.splitHeight} />
            <p style={{ fontFamily: "'Barlow', sans-serif", fontSize: "0.48rem", color: "rgba(255,255,255,0.38)", letterSpacing: "0.1em" }}>── REAL PHOTO (this slide) ──</p>
            <ControlRow label="Zoom"         onMinus={() => updateReal("scale", -0.05)} onPlus={() => updateReal("scale", 0.05)} value={r.scale} />
            <ControlRow label="Up / Down"    onMinus={() => updateReal("y", -2)}        onPlus={() => updateReal("y", 2)}        value={r.y} />
            <ControlRow label="Left / Right" onMinus={() => updateReal("x", -2)}        onPlus={() => updateReal("x", 2)}        value={r.x} />
            <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: "7px", marginTop: "4px", display: "flex", gap: "8px" }}>
              <button onClick={goPrev} style={{ ...btnStyle, flex: 1, width: "auto", padding: "0 8px", fontSize: "0.48rem", letterSpacing: "0.1em" }}>◀ PREV</button>
              <button onClick={goNext} style={{ ...btnStyle, flex: 1, width: "auto", padding: "0 8px", fontSize: "0.48rem", letterSpacing: "0.1em" }}>NEXT ▶</button>
            </div>
          </div>
        </div>
      )}

      {/* MOBILE EDIT BUTTON */}
      {showEditPhotosButton && !editMode && (
        <button
          onClick={toggleEditMode}
          className="md:hidden fixed z-40"
          style={{ top: "10px", right: "10px", fontFamily: "'Barlow', sans-serif", fontWeight: 600, fontSize: "0.5rem", letterSpacing: "0.18em", color: "rgba(255,255,255,0.7)", background: "rgba(0,0,0,0.7)", border: "1px solid rgba(255,255,255,0.3)", padding: "5px 12px", cursor: "pointer" }}
        >
          EDIT PHOTOS
        </button>
      )}
    </div>
  );
}
