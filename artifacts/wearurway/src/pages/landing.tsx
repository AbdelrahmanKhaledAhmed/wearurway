import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { getAdminToken } from "@/lib/admin-token";

import RealImg1 from "@assets/photo_1.webp";
import RealImg2 from "@assets/photo_2.webp";
import RealImg3 from "@assets/photo_3.webp";
import RealImg4 from "@assets/photo_4.webp";

import MockImg1 from "@assets/mockup_1.webp";
import MockImg2 from "@assets/mockup_2.webp";
import MockImg3 from "@assets/mockup_3.webp";
import MockImg4 from "@assets/mockup_4.webp";

type MockSettings = { scale: number; y: number; x: number; splitHeight: number; shadowTop: number; shadowBottom: number; shadowLeft: number; shadowRight: number; textY: number };
type RealSettings = { scale: number; y: number; x: number };

const DEFAULT_MOCK: MockSettings = { scale: 1.65, y: -48, x: -50, splitHeight: 42, shadowTop: 80, shadowBottom: 0, shadowLeft: 0, shadowRight: 60, textY: 50 };
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
  const [editTab, setEditTab] = useState<"desktop" | "mobile">("desktop");

  // Separate settings for desktop and mobile
  const [mockDesktop, setMockDesktop] = useState<MockSettings>({ ...DEFAULT_MOCK });
  const [mockMobile, setMockMobile] = useState<MockSettings>({ ...DEFAULT_MOCK });
  const [realsDesktop, setRealsDesktop] = useState<RealSettings[]>(slidesData.map(() => ({ ...DEFAULT_REAL })));
  const [realsMobile, setRealsMobile] = useState<RealSettings[]>(slidesData.map(() => ({ ...DEFAULT_REAL })));

  const [showEditPhotosButton, setShowEditPhotosButton] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    [RealImg1,RealImg2,RealImg3,RealImg4,MockImg1,MockImg2,MockImg3,MockImg4].forEach(src => {
      const img = new Image(); img.src = src;
    });

    fetch("/api/order-settings")
      .then((r) => r.json())
      .then((data: { showEditPhotosButton?: boolean }) => {
        setShowEditPhotosButton(data.showEditPhotosButton ?? false);
      })
      .catch(() => {});

    fetch("/api/landing-settings")
      .then((r) => r.json())
      .then((data: any) => {
        if (!data) return;
        if (data.mockDesktop) setMockDesktop(data.mockDesktop);
        if (data.mockMobile) setMockMobile(data.mockMobile);
        if (data.realsDesktop && data.realsDesktop.length === slidesData.length) setRealsDesktop(data.realsDesktop);
        if (data.realsMobile && data.realsMobile.length === slidesData.length) setRealsMobile(data.realsMobile);
      })
      .catch(() => {});
  }, []);

  const saveSettings = useCallback(async (md: MockSettings, mm: MockSettings, rd: RealSettings[], rm: RealSettings[]) => {
    setSaving(true);
    try {
      const token = getAdminToken();
      if (token) {
        await fetch("/api/admin/landing-settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
          body: JSON.stringify({ mockDesktop: md, mockMobile: mm, realsDesktop: rd, realsMobile: rm }),
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

  const updateMock = (tab: "desktop" | "mobile", key: keyof MockSettings, delta: number) => {
    if (tab === "desktop") setMockDesktop(prev => ({ ...prev, [key]: +((Number(prev[key]) || 0) + delta).toFixed(2) }));
    else setMockMobile(prev => ({ ...prev, [key]: +((Number(prev[key]) || 0) + delta).toFixed(2) }));
  };

  const updateReal = (tab: "desktop" | "mobile", key: keyof RealSettings, delta: number) => {
    if (tab === "desktop") {
      setRealsDesktop(prev => {
        const next = [...prev];
        next[current] = { ...next[current], [key]: +(next[current][key] + delta).toFixed(2) };
        return next;
      });
    } else {
      setRealsMobile(prev => {
        const next = [...prev];
        next[current] = { ...next[current], [key]: +(next[current][key] + delta).toFixed(2) };
        return next;
      });
    }
  };

  const toggleEditMode = () => {
    if (editMode) saveSettings(mockDesktop, mockMobile, realsDesktop, realsMobile);
    setEditMode(v => !v);
  };

  const navigateToProducts = () => navigate("/products");

  const rDesktop = realsDesktop[current];
  const rMobile = realsMobile[current];

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

  const tabBtnStyle = (active: boolean): React.CSSProperties => ({
    flex: 1, padding: "4px 0", fontFamily: "'Barlow', sans-serif", fontWeight: 700,
    fontSize: "0.5rem", letterSpacing: "0.15em", cursor: "pointer", border: "none",
    background: active ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.07)",
    color: active ? "#080808" : "rgba(255,255,255,0.5)",
  });

  const EditControls = ({ tab }: { tab: "desktop" | "mobile" }) => {
    const mock = tab === "desktop" ? mockDesktop : mockMobile;
    const r = tab === "desktop" ? rDesktop : rMobile;
    return (
      <>
        <p style={{ fontFamily: "'Barlow', sans-serif", fontSize: "0.48rem", color: "rgba(255,255,255,0.38)", letterSpacing: "0.1em" }}>── MOCKUP (all slides) ──</p>
        <ControlRow label="Zoom" onMinus={() => updateMock(tab, "scale", -0.05)} onPlus={() => updateMock(tab, "scale", 0.05)} value={mock.scale} />
        <ControlRow label="Up / Down" onMinus={() => updateMock(tab, "y", -2)} onPlus={() => updateMock(tab, "y", 2)} value={mock.y} />
        <ControlRow label="Left / Right" onMinus={() => updateMock(tab, "x", -2)} onPlus={() => updateMock(tab, "x", 2)} value={mock.x} />
        <ControlRow label="Height %" onMinus={() => updateMock(tab, "splitHeight", -2)} onPlus={() => updateMock(tab, "splitHeight", 2)} value={mock.splitHeight} />
        {tab === "desktop" && (
          <>
            <p style={{ fontFamily: "'Barlow', sans-serif", fontSize: "0.48rem", color: "rgba(255,255,255,0.38)", letterSpacing: "0.1em" }}>── SHADOWS (edges) ──</p>
            <ControlRow label="Top Shadow" onMinus={() => updateMock(tab, "shadowTop", -5)} onPlus={() => updateMock(tab, "shadowTop", 5)} value={mock.shadowTop} />
            <ControlRow label="Bottom Shadow" onMinus={() => updateMock(tab, "shadowBottom", -5)} onPlus={() => updateMock(tab, "shadowBottom", 5)} value={mock.shadowBottom} />
            <ControlRow label="Right Shadow" onMinus={() => updateMock(tab, "shadowRight", -5)} onPlus={() => updateMock(tab, "shadowRight", 5)} value={mock.shadowRight} />
          </>
        )}
        <p style={{ fontFamily: "'Barlow', sans-serif", fontSize: "0.48rem", color: "rgba(255,255,255,0.38)", letterSpacing: "0.1em" }}>── REAL PHOTO (this slide) ──</p>
        <ControlRow label="Zoom" onMinus={() => updateReal(tab, "scale", -0.05)} onPlus={() => updateReal(tab, "scale", 0.05)} value={r.scale} />
        <ControlRow label="Up / Down" onMinus={() => updateReal(tab, "y", -2)} onPlus={() => updateReal(tab, "y", 2)} value={r.y} />
        <ControlRow label="Left / Right" onMinus={() => updateReal(tab, "x", -2)} onPlus={() => updateReal(tab, "x", 2)} value={r.x} />
        {tab === "mobile" && (
          <>
            <p style={{ fontFamily: "'Barlow', sans-serif", fontSize: "0.48rem", color: "rgba(255,255,255,0.38)", letterSpacing: "0.1em" }}>── TEXT POSITION ──</p>
            <ControlRow label="Text Up/Down" onMinus={() => updateMock(tab, "textY", -2)} onPlus={() => updateMock(tab, "textY", 2)} value={mock.textY} />
          </>
        )}
      </>
    );
  };
  const SlidePanel = ({ mobile, mockSettings, reals }: { mobile: boolean; mockSettings: MockSettings; reals: RealSettings[] }) => (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
      {slidesData.map((slide, i) => (
        <div key={i} style={{
          position: "absolute", inset: 0, display: "flex", flexDirection: "column",
          opacity: i === visibleIndex ? (transitioning ? 0 : 1) : 0,
          transition: "opacity 0.5s ease",
        }}>
          <div style={{ height: `${mockSettings.splitHeight}%`, position: "relative", overflow: "hidden", background: "#000000", flexShrink: 0 }}>
            <img src={slide.mock} alt="mockup" style={{
              position: "absolute", top: "50%", left: "50%",
              transform: `translate(${mockSettings.x}%, ${mockSettings.y}%) scale(${mockSettings.scale})`,
              width: "100%", height: "100%", objectFit: "contain", objectPosition: "50% 50%",
              filter: "brightness(0.9) contrast(1.05)", transformOrigin: "center center",
            }} />
            <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: "40px", background: "linear-gradient(to bottom, transparent, #080808)", zIndex: 2 }} />
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "25px", background: "linear-gradient(to bottom, #000000, transparent)", zIndex: 2 }} />
            <div style={{ position: "absolute", top: "8px", left: "10px", zIndex: 3, fontFamily: "'Barlow', sans-serif", fontWeight: 600, fontSize: "0.42rem", letterSpacing: "0.2em", color: "rgba(255,255,255,0.5)", background: "rgba(0,0,0,0.6)", padding: "2px 7px", border: "1px solid rgba(255,255,255,0.15)" }}>
              MOCKUP DESIGN
            </div>
          </div>
          <div style={{ flex: 1, position: "relative", overflow: "hidden", background: "#000000" }}>
            <img src={slide.real} alt="worn" style={{
              position: "absolute", inset: 0, width: "100%", height: "100%",
              objectFit: "contain",
              transform: `translate(${reals[i].x}%, ${reals[i].y}%) scale(${reals[i].scale})`,
              filter: "brightness(0.85) contrast(1.05)", transformOrigin: "center center",
            }} />
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "25px", background: "linear-gradient(to bottom, #080808, transparent)", zIndex: 2 }} />
          </div>
        </div>
      ))}
      {!mobile && (
        <>
          <div style={{ position: "absolute", inset: 0, zIndex: 5, pointerEvents: "none", background: "linear-gradient(to right, #000000 0%, #000000 4%, rgba(0,0,0,0.85) 18%, rgba(0,0,0,0.3) 45%, transparent 70%)" }} />
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: `${mockSettings.shadowTop}px`, zIndex: 6, pointerEvents: "none", background: "linear-gradient(to bottom, #000000, transparent)" }} />
          <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: `${mockSettings.shadowBottom}px`, zIndex: 6, pointerEvents: "none", background: "linear-gradient(to top, #080808, transparent)" }} />
          <div style={{ position: "absolute", top: 0, right: 0, bottom: 0, width: `${mockSettings.shadowRight}px`, zIndex: 6, pointerEvents: "none", background: "linear-gradient(to left, #080808, transparent)" }} />
        </>
      )}
      {mobile && (
        <>
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "60px", zIndex: 5, pointerEvents: "none", background: "linear-gradient(to bottom, #000000, transparent)" }} />
          <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: "60px", zIndex: 5, pointerEvents: "none", background: "linear-gradient(to top, #000000, transparent)" }} />
        </>
      )}
    </div>
  );

  return (
    <div style={{ position: "fixed", inset: 0, background: "#000000", fontFamily: "'Barlow Condensed', sans-serif", overflow: "hidden" }}>

      {/* ── MOBILE LAYOUT ── */}
      <div className="flex md:hidden" style={{ position: "absolute", inset: 0 }}>
        <SlidePanel mobile={true} mockSettings={mockMobile} reals={realsMobile} />
        <div style={{ position: "absolute", top: `${mockMobile.textY}%`, left: 0, right: 0, zIndex: 20, transform: "translateY(-50%)", padding: "16px 0" }}>           <div style={{ position: "absolute", top: "-60px", left: 0, right: 0, height: "60px", pointerEvents: "none", background: "linear-gradient(to top, #000000 0%, #000000 20%, rgba(0,0,0,0.8) 50%, transparent 100%)" }} />
          <h1 className="leading-none" style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 900, fontSize: "clamp(2rem, 11vw, 3.5rem)", letterSpacing: "-0.02em", textTransform: "uppercase", lineHeight: 0.88, width: "100%", textAlign: "center", paddingLeft: "0", color: "#ffffff", textShadow: "none" }}>
            WEARURWAY
          </h1>
          <p className="text-white mt-2" style={{ fontFamily: "'Barlow', sans-serif", fontWeight: 300, fontSize: "0.6rem", letterSpacing: "0.22em", opacity: 0.6, paddingLeft: "0", textAlign: "center", width: "100%" }}>
            PREMIUM STREETWEAR. YOUR RULES.
          </p>
          <div className="mt-4" style={{ paddingLeft: "0", display: "flex", justifyContent: "center" }}>
            <button
              className="flex items-center gap-3 text-white tracking-widest px-5 py-3 transition-all duration-300 hover:bg-white hover:text-black group"
              onClick={navigateToProducts}
              style={{ fontFamily: "'Barlow', sans-serif", fontWeight: 600, letterSpacing: "0.18em", border: "1.5px solid rgba(255,255,255,0.6)", background: "transparent", fontSize: "0.6rem" }}
            >
              START CUSTOMIZING
            </button>
          </div>
          <div style={{ position: "absolute", bottom: "-160px", left: 0, right: 0, height: "160px", pointerEvents: "none", background: "linear-gradient(to bottom, #000000 0%, #000000 20%, rgba(0,0,0,0.8) 50%, transparent 100%)" }} />
        </div>
      </div>

      {/* ── DESKTOP LAYOUT ── */}
      <div className="hidden md:flex" style={{ position: "absolute", inset: 0 }}>
        <div style={{ position: "absolute", right: 0, top: 0, width: "50%", height: "100%" }}>
          <SlidePanel mobile={false} mockSettings={mockDesktop} reals={realsDesktop} />
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
            </button>
          </div>
        </div>

        {editMode && (
          <div className="hidden md:flex absolute z-30 flex-col gap-2" style={{ right: "51%", top: "50%", transform: "translateY(-50%)", background: "rgba(0,0,0,0.93)", border: "1px solid rgba(255,255,255,0.15)", padding: "14px 16px", minWidth: "230px", maxHeight: "80vh", overflowY: "auto" }}>
            <p style={{ fontFamily: "'Barlow', sans-serif", fontWeight: 700, fontSize: "0.55rem", letterSpacing: "0.2em", color: "rgba(255,255,255,0.85)" }}>SLIDE {current + 1}</p>
            <div style={{ display: "flex", gap: "4px", marginBottom: "4px" }}>
              <button onClick={() => setEditTab("desktop")} style={tabBtnStyle(editTab === "desktop")}>DESKTOP</button>
              <button onClick={() => setEditTab("mobile")} style={tabBtnStyle(editTab === "mobile")}>MOBILE</button>
            </div>
            <EditControls tab={editTab} />
            <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: "7px", marginTop: "4px", display: "flex", gap: "8px" }}>
              <button onClick={goPrev} style={{ ...btnStyle, width: "auto", padding: "0 8px", fontSize: "0.48rem", letterSpacing: "0.1em" }}>◀ PREV</button>
              <button onClick={goNext} style={{ ...btnStyle, width: "auto", padding: "0 8px", fontSize: "0.48rem", letterSpacing: "0.1em" }}>NEXT ▶</button>
            </div>
          </div>
        )}

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
            <div style={{ display: "flex", gap: "4px", marginBottom: "4px" }}>
              <button onClick={() => setEditTab("desktop")} style={tabBtnStyle(editTab === "desktop")}>DESKTOP</button>
              <button onClick={() => setEditTab("mobile")} style={tabBtnStyle(editTab === "mobile")}>MOBILE</button>
            </div>
            <EditControls tab={editTab} />
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
