import { useState, useRef, useEffect } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { useCustomizer } from "@/hooks/use-customizer";
import { useGetOrderSettings } from "@workspace/api-client-react";
import type { CreateOrderDesignJob } from "@workspace/api-client-react";
import { trackEvent } from "@/lib/analytics";
import {
  submitOrderAndWait,
  type QueuedOrderCustomer,
} from "@/lib/order-queue";

const FREE_SHIPPING_AREAS = ["6th of October", "Sheikh Zayed"];

type ShippingOption = "free" | "wasslaha";
type PaymentMethod = "instapay" | "cod";

interface FormState {
  firstName: string;
  lastName: string;
  phone: string;
  city: string;
  area: string;
  street: string;
  building: string;
  floor: string;
  apartment: string;
}

const EMPTY_FORM: FormState = {
  firstName: "", lastName: "", phone: "",
  city: "", area: "", street: "", building: "",
  floor: "", apartment: "",
};

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("Could not read payment proof"));
    };
    reader.onerror = () => reject(reader.error ?? new Error("Could not read payment proof"));
    reader.readAsDataURL(file);
  });
}

export default function Checkout() {
  const [, setLocation] = useLocation();
  const { selectedProduct, selectedFit, selectedColor, selectedSize, reset } = useCustomizer();

  const frontPreview = sessionStorage.getItem("ww_checkout_front") || "";
  const backPreview  = sessionStorage.getItem("ww_checkout_back")  || "";
  const productPrice = Number(sessionStorage.getItem("ww_checkout_price") || "550");
  const { data: orderSettings } = useGetOrderSettings();

  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  useEffect(() => { trackEvent("view_checkout"); }, []);
  const [shipping, setShipping] = useState<ShippingOption>("wasslaha");
  const [payment, setPayment] = useState<PaymentMethod>("cod");
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [proofPreview, setProofPreview] = useState<string | null>(null);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState | "proof", string>>>({});
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [orderId, setOrderId] = useState("");
  const [showRefundPolicy, setShowRefundPolicy] = useState(false);
  const [showFeedbackPrompt, setShowFeedbackPrompt] = useState(false);
  const [feedbackText, setFeedbackText] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const shippingCost = shipping === "free" ? 0 : (orderSettings?.shippingPrice ?? 85);
  const total = productPrice + shippingCost;

  useEffect(() => {
    if (!proofFile) { setProofPreview(null); return; }
    const url = URL.createObjectURL(proofFile);
    setProofPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [proofFile]);

  const setField = (key: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) => {
    let value = e.target.value;
    if (key === "phone") {
      value = value.replace(/\D/g, "").slice(0, 11);
    }
    setForm(prev => ({ ...prev, [key]: value }));
    setErrors(prev => ({ ...prev, [key]: undefined }));
  };

  const validate = (): boolean => {
    const errs: typeof errors = {};
    if (!form.firstName.trim()) errs.firstName = "Required";
    if (!form.lastName.trim())  errs.lastName  = "Required";
    const phoneDigits = form.phone.replace(/\D/g, "");
    if (!phoneDigits) {
      errs.phone = "Required";
    } else if (!/^01[0125]\d{8}$/.test(phoneDigits)) {
      errs.phone = "Enter a valid Egyptian number (11 digits, e.g. 01012345678)";
    }
    if (!form.city.trim())      errs.city      = "Required";
    if (!form.area.trim())      errs.area      = "Required";
    if (!form.street.trim())    errs.street    = "Required";
    if (!form.building.trim())  errs.building  = "Required";
    if (!form.floor.trim())     errs.floor     = "Required";
    if (!form.apartment.trim()) errs.apartment = "Required";
    if (payment === "instapay" && !proofFile) errs.proof = "Please upload payment proof";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleCompleteOrderClick = () => {
    if (!validate()) return;
    setSubmitError("");
    setFeedbackText("");
    setShowFeedbackPrompt(true);
  };

  const submitOrder = async (feedback: string) => {
    setShowFeedbackPrompt(false);
    setSubmitError("");
    setSubmitting(true);
    try {
      const designJobText = sessionStorage.getItem("ww_checkout_design_job");
      const designJob = designJobText
        ? (JSON.parse(designJobText) as CreateOrderDesignJob)
        : undefined;

      // 1. Read the (small) payment proof to a data URL. This is the only
      //    blocking I/O the customer waits for — typically <200ms even on
      //    a phone, since it's just a screenshot.
      const paymentProof =
        payment === "instapay" && proofFile
          ? { fileName: proofFile.name, dataUrl: await fileToDataUrl(proofFile) }
          : undefined;

      const customer: QueuedOrderCustomer = {
        name: `${form.firstName.trim()} ${form.lastName.trim()}`.trim(),
        phone: form.phone.replace(/\D/g, ""),
        address: `Building ${form.building.trim()}, Floor ${form.floor.trim()}, Apt ${form.apartment.trim()}, ${form.street.trim()}, ${form.area.trim()}, ${form.city.trim()}`,
        product: selectedProduct?.name ?? undefined,
        fit: selectedFit?.name ?? undefined,
        size: {
          name: selectedSize?.name ?? "",
          realWidth: selectedSize?.realWidth,
          realHeight: selectedSize?.realHeight,
        },
        color: selectedColor?.name ?? "",
        paymentMethod: payment,
        productPrice,
        shippingPrice: shippingCost,
        total,
        frontImage: frontPreview || undefined,
        backImage: backPreview || undefined,
      };

      // 2. Save the spec to IndexedDB for durability, render the design
      //    export PNGs, then POST to /api/create-order and AWAIT the
      //    response. The "Placing Order…" loading state stays on screen for
      //    the entire duration. Resolves only after the server returns
      //    HTTP 200 with an orderId; on any failure the spec stays in the
      //    queue so the background worker / Service Worker can retry, and
      //    the error is surfaced to the customer.
      const { orderId: newOrderId } = await submitOrderAndWait({
        customer,
        paymentProof,
        designJob,
        feedback: feedback.trim() || undefined,
      });

      // 3. Clear sessionStorage so a refresh doesn't re-prepare the same
      //    design — the order is now safely on the server.
      sessionStorage.removeItem("ww_checkout_front");
      sessionStorage.removeItem("ww_checkout_back");
      sessionStorage.removeItem("ww_checkout_price");
      sessionStorage.removeItem("ww_checkout_design_job");

      // 4. The server has confirmed the order. Show the success screen with
      //    the confirmed orderId. The server-side outbox continues to
      //    upload files to object storage and send the Telegram
      //    notification in the background after responding, so the
      //    customer doesn't wait for those.
      setOrderId(newOrderId);
      setSubmitting(false);
      setSubmitted(true);
      trackEvent("complete_order");
    } catch (error) {
      setSubmitError(
        error instanceof Error ? error.message : "Could not submit order. Please try again.",
      );
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="min-h-screen bg-[#0b0b0b] flex flex-col items-center justify-center px-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="w-full max-w-md text-center"
        >
          <motion.div
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.1, type: "spring", stiffness: 260, damping: 20 }}
            className="w-20 h-20 mx-auto mb-8 rounded-full flex items-center justify-center"
            style={{ backgroundColor: "#f5c842" }}
          >
            <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
              <path d="M8 18L15 25L28 11" stroke="#0d0d0d" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </motion.div>
          <p className="text-[10px] tracking-[0.3em] text-white/40 uppercase mb-3">Order Confirmed</p>
          <h1 className="text-4xl font-black uppercase mb-4" style={{ fontFamily: "monospace" }}>You're all set.</h1>
          <p className="text-sm text-white/50 leading-relaxed mb-4">
            Your order has been received. Your Order ID is <span className="font-black text-white">{orderId}</span>. Our team will contact you shortly to confirm the delivery details.
          </p>
          <div className="mb-10" />
          <button
            onClick={() => { reset(); setLocation("/products"); }}
            className="w-full py-4 font-black uppercase tracking-[0.2em] text-sm active:scale-[0.98] transition-all"
            style={{ backgroundColor: "#f5c842", color: "#0d0d0d" }}
          >
            Start New Order
          </button>
          <button
            onClick={() => setLocation("/")}
            className="mt-3 w-full py-3 text-xs uppercase tracking-widest font-bold border border-white/10 text-white/40 hover:text-white hover:border-white/30 transition-colors"
          >
            Back to Home
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0b0b0b] text-white">
      <div className="max-w-6xl mx-auto px-6 pt-20 pb-10">

        {/* Page heading */}
        <div className="mb-10">
          <p className="text-[10px] tracking-[0.3em] text-white/30 uppercase mb-1">Step 2 of 2</p>
          <h1 className="text-3xl font-black uppercase tracking-[0.08em]" style={{ fontFamily: "monospace" }}>Checkout</h1>
        </div>

        <div className="flex flex-col lg:flex-row gap-10">

          {/* ── LEFT COLUMN ── */}
          <div className="flex-1 space-y-8">

            {/* Delivery Form */}
            <section>
              <SectionLabel>Delivery Info</SectionLabel>
              <div className="grid grid-cols-2 gap-4">
                <Field label="First Name" value={form.firstName} onChange={setField("firstName")} error={errors.firstName} />
                <Field label="Last Name"  value={form.lastName}  onChange={setField("lastName")}  error={errors.lastName} />
              </div>
              <div className="mt-4">
                <Field label="Phone Number" value={form.phone} onChange={setField("phone")} error={errors.phone} type="tel" />
              </div>
              <div className="grid grid-cols-2 gap-4 mt-4">
                <Field label="City"            value={form.city}     onChange={setField("city")}     error={errors.city} />
                <Field label="Area / District"  value={form.area}     onChange={setField("area")}     error={errors.area} />
              </div>
              <div className="grid grid-cols-2 gap-4 mt-4">
                <Field label="Street Address"  value={form.street}   onChange={setField("street")}   error={errors.street} />
                <Field label="Building Number" value={form.building} onChange={setField("building")} error={errors.building} />
              </div>
              <div className="grid grid-cols-2 gap-4 mt-4">
                <Field label="Floor"           value={form.floor}     onChange={setField("floor")}     error={errors.floor} />
                <Field label="Apartment Number" value={form.apartment} onChange={setField("apartment")} error={errors.apartment} />
              </div>
            </section>

            {/* Shipping */}
            <section>
              <SectionLabel>Shipping</SectionLabel>
              <div className="space-y-3">
                <ShippingCard
                  selected={shipping === "free"}
                  onSelect={() => setShipping("free")}
                  title="Free Shipping"
                  description={`Available inside ${FREE_SHIPPING_AREAS.join(" & ")} only`}
                  price="0 EGP"
                  badge="FREE"
                />
                <ShippingCard
                  selected={shipping === "wasslaha"}
                  onSelect={() => setShipping("wasslaha")}
                  title={orderSettings?.shippingCompanyName ?? "Wasslaha Standard"}
                  description={orderSettings?.shippingDescription ?? "Delivered in 2–3 working days"}
                  price={`${orderSettings?.shippingPrice ?? 85} EGP`}
                />
              </div>
            </section>

            {/* Payment */}
            <section>
              <SectionLabel>Payment</SectionLabel>
              <div className="space-y-3">

                {/* InstaPay */}
                <div
                  className="border cursor-pointer transition-colors p-5"
                  style={{ borderColor: payment === "instapay" ? "#f5c842" : "rgba(255,255,255,0.1)" }}
                  onClick={() => setPayment("instapay")}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Radio checked={payment === "instapay"} />
                      <div>
                        <p className="text-xs font-black uppercase tracking-widest">InstaPay</p>
                        <p className="text-[11px] text-white/40 mt-0.5">Send to <span className="text-white/70 font-bold">{orderSettings?.instaPayPhone ?? "01069383482"}</span></p>
                      </div>
                    </div>
                    <div className="w-8 h-8 rounded flex items-center justify-center" style={{ backgroundColor: "#f5c842" }}>
                      <span className="text-[10px] font-black text-black">₣</span>
                    </div>
                  </div>

                  <AnimatePresence>
                    {payment === "instapay" && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                      >
                        <div className="mt-5 pt-5 border-t border-white/10">
                          <p className="text-[11px] text-white/50 mb-3 uppercase tracking-widest">Upload Payment Proof</p>
                          <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={e => {
                              const f = e.target.files?.[0] ?? null;
                              setProofFile(f);
                              setErrors(prev => ({ ...prev, proof: undefined }));
                            }}
                          />
                          {proofPreview ? (
                            <div className="relative">
                              <img
                                src={proofPreview}
                                alt="Payment proof"
                                className="w-full max-h-48 object-contain border border-white/10"
                              />
                              <button
                                onClick={e => { e.stopPropagation(); setProofFile(null); if (fileInputRef.current) fileInputRef.current.value = ""; }}
                                className="absolute top-2 right-2 w-7 h-7 bg-black/70 text-white/70 hover:text-white flex items-center justify-center text-lg leading-none"
                              >
                                ×
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={e => { e.stopPropagation(); fileInputRef.current?.click(); }}
                              className="w-full py-4 border border-dashed text-[11px] uppercase tracking-widest text-white/40 hover:text-white hover:border-white/30 transition-colors"
                              style={{ borderColor: errors.proof ? "#ef4444" : "rgba(255,255,255,0.15)" }}
                            >
                              + Upload Screenshot
                            </button>
                          )}
                          {errors.proof && (
                            <p className="text-[10px] text-red-400 mt-1.5">{errors.proof}</p>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Cash on Delivery */}
                <div
                  className="border cursor-pointer transition-colors p-5 flex items-center gap-3"
                  style={{ borderColor: payment === "cod" ? "#f5c842" : "rgba(255,255,255,0.1)" }}
                  onClick={() => setPayment("cod")}
                >
                  <Radio checked={payment === "cod"} />
                  <div>
                    <p className="text-xs font-black uppercase tracking-widest">Cash on Delivery</p>
                    <p className="text-[11px] text-white/40 mt-0.5">Pay when your order arrives</p>
                  </div>
                </div>

              </div>
            </section>

            {/* Complete Order — mobile visible */}
            <div className="lg:hidden pt-6 mt-2 border-t border-white/10">
              <CompleteOrderButton total={total} submitting={submitting} onSubmit={handleCompleteOrderClick} />
              {submitError && <p className="text-xs text-red-400 mt-3">{submitError}</p>}
              <div className="mt-3 flex items-center justify-center gap-4">
                <button
                  type="button"
                  onClick={() => setShowRefundPolicy(true)}
                  className="text-[11px] tracking-[0.2em] uppercase text-white/40 hover:text-white underline underline-offset-4 transition-colors"
                >
                  Refund Policy
                </button>
                <span className="text-white/20">·</span>
                <a
                  href={`https://wa.me/20${(orderSettings?.contactPhone || orderSettings?.instaPayPhone || "01069383482").replace(/^0/, "")}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] tracking-[0.2em] uppercase text-white/40 hover:text-white underline underline-offset-4 transition-colors"
                >
                  Contact Us
                </a>
              </div>
            </div>

          </div>

          {/* ── RIGHT COLUMN ── */}
          <div className="w-full lg:w-[380px] shrink-0 space-y-6">

            {/* Design Previews */}
            <section>
              <SectionLabel>Your Design</SectionLabel>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: "Front", src: frontPreview },
                  { label: "Back",  src: backPreview },
                ].map(({ label, src }) => (
                  <div key={label}>
                    <div
                      className="aspect-[3/4] border border-white/8 overflow-hidden flex items-center justify-center"
                      style={{ backgroundColor: "#111" }}
                    >
                      {src && (
                        <img src={src} alt={label} className="w-full h-full object-cover" />
                      )}
                    </div>
                    <p className="text-[10px] text-white/40 uppercase tracking-[0.2em] text-center mt-1.5 font-bold">{label}</p>
                  </div>
                ))}
              </div>
            </section>

            {/* Pricing breakdown */}
            <section>
              <SectionLabel>Order Summary</SectionLabel>
              <div className="border border-white/10 divide-y divide-white/10">
                {selectedProduct && (
                  <SummaryRow label="Product" value={selectedProduct.name} />
                )}
                {selectedFit && (
                  <SummaryRow label="Fit" value={selectedFit.name} />
                )}
                {selectedColor && (
                  <SummaryRow
                    label="Color"
                    value={
                      <div className="flex items-center gap-1.5">
                        <div className="w-3 h-3 border border-white/20" style={{ backgroundColor: selectedColor.hex }} />
                        <span>{selectedColor.name}</span>
                      </div>
                    }
                  />
                )}
                {selectedSize && (
                  <SummaryRow label="Size" value={selectedSize.name} />
                )}

                <div className="px-5 py-3.5 flex justify-between items-center">
                  <span className="text-[10px] tracking-[0.2em] text-white/40 uppercase">Design</span>
                  <span className="text-xs font-bold">{productPrice} EGP</span>
                </div>
                <div className="px-5 py-3.5 flex justify-between items-center">
                  <span className="text-[10px] tracking-[0.2em] text-white/40 uppercase">Shipping</span>
                  <span className="text-xs font-bold" style={{ color: shippingCost === 0 ? "#4ade80" : "white" }}>
                    {shippingCost === 0 ? "FREE" : `${shippingCost} EGP`}
                  </span>
                </div>
                <div className="px-5 py-4 flex justify-between items-center bg-white/[0.03]">
                  <span className="text-[10px] tracking-[0.2em] text-white/60 uppercase font-bold">Total</span>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-2xl font-black" style={{ fontFamily: "monospace", color: "#f5c842" }}>{total}</span>
                    <span className="text-xs font-bold text-white/40 uppercase">EGP</span>
                  </div>
                </div>
              </div>
            </section>

            {/* Complete Order — desktop */}
            <div className="hidden lg:block pt-4 mt-2">
              <CompleteOrderButton total={total} submitting={submitting} onSubmit={handleCompleteOrderClick} />
              {submitError && <p className="text-xs text-red-400 mt-3">{submitError}</p>}
              <div className="mt-3 flex items-center justify-center gap-4">
                <button
                  type="button"
                  onClick={() => setShowRefundPolicy(true)}
                  className="text-[11px] tracking-[0.2em] uppercase text-white/40 hover:text-white underline underline-offset-4 transition-colors"
                >
                  Refund Policy
                </button>
                <span className="text-white/20">·</span>
                <a
                  href={`https://wa.me/20${(orderSettings?.contactPhone || orderSettings?.instaPayPhone || "01069383482").replace(/^0/, "")}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] tracking-[0.2em] uppercase text-white/40 hover:text-white underline underline-offset-4 transition-colors"
                >
                  Contact Us
                </a>
              </div>
            </div>

          </div>
        </div>
      </div>

      <AnimatePresence>
        {submitting && (
          <motion.div
            key="placing-order-popup"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex items-center justify-center p-6 bg-black/70 backdrop-blur-sm"
            aria-live="polite"
            aria-busy="true"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.18 }}
              className="w-full max-w-sm bg-[#141414] border border-white/10 p-6 text-center"
            >
              <div className="flex justify-center mb-5">
                <span
                  className="w-10 h-10 border-2 rounded-full animate-spin"
                  style={{ borderColor: "rgba(245,200,66,0.25)", borderTopColor: "#f5c842" }}
                />
              </div>
              <p className="text-[10px] tracking-[0.3em] text-white/40 uppercase mb-2">Just a moment</p>
              <h3
                className="text-lg font-black uppercase tracking-[0.06em] mb-3"
                style={{ fontFamily: "monospace" }}
              >
                Preparing Your Order
              </h3>
              <p className="text-sm text-white/70 leading-relaxed">
                Please wait a moment while we prepare your order. This will only take a few seconds — please keep this page open until it's done.
              </p>
            </motion.div>
          </motion.div>
        )}
        {showFeedbackPrompt && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/70 backdrop-blur-sm"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.18 }}
              className="w-full max-w-md bg-[#141414] border border-white/10 p-6"
            >
              <p className="text-[10px] tracking-[0.3em] text-white/40 uppercase mb-2">Before You Go</p>
              <h3 className="text-lg font-black uppercase tracking-[0.06em] mb-3" style={{ fontFamily: "monospace" }}>
                Your Feedback
              </h3>
              <p className="text-sm text-white/70 leading-relaxed mb-4">
                If you have any suggestions about the website or any difficulties you faced, or anything you would like to change.
              </p>
              <textarea
                value={feedbackText}
                onChange={(e) => setFeedbackText(e.target.value)}
                rows={5}
                placeholder="Write your feedback here…"
                className="w-full bg-transparent border px-4 py-3 text-sm text-white placeholder-white/20 outline-none transition-colors focus:border-white/40 resize-none"
                style={{ borderColor: "rgba(255,255,255,0.12)" }}
                autoFocus
              />
              <div className="grid grid-cols-2 gap-3 mt-5">
                <button
                  type="button"
                  onClick={() => void submitOrder("")}
                  className="py-3 font-black uppercase tracking-[0.2em] text-xs border border-white/15 text-white/70 hover:text-white hover:border-white/30 transition-colors active:scale-[0.98]"
                >
                  Skip
                </button>
                <button
                  type="button"
                  onClick={() => void submitOrder(feedbackText)}
                  className="py-3 font-black uppercase tracking-[0.2em] text-xs transition-all active:scale-[0.98]"
                  style={{ backgroundColor: "#f5c842", color: "#0d0d0d" }}
                >
                  Submit
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
        {showRefundPolicy && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/70 backdrop-blur-sm"
            onClick={() => setShowRefundPolicy(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.18 }}
              className="w-full max-w-md bg-[#141414] border border-white/10 p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <p className="text-[10px] tracking-[0.3em] text-white/40 uppercase mb-2">Policy</p>
              <h3 className="text-lg font-black uppercase tracking-[0.06em] mb-4" style={{ fontFamily: "monospace" }}>
                Refund Policy
              </h3>
              <p className="text-sm text-white/70 leading-relaxed">
                Unfortunately, we do not offer returns or exchanges because this T-shirt is custom-made specifically for you. However, you can refuse to receive the order if the print is not as you designed or requested, or if you are not satisfied with the material.
              </p>
              <button
                type="button"
                onClick={() => setShowRefundPolicy(false)}
                className="mt-6 w-full py-3 font-black uppercase tracking-[0.2em] text-xs transition-all active:scale-[0.98]"
                style={{ backgroundColor: "#f5c842", color: "#0d0d0d" }}
              >
                Got It
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── Sub-components ── */

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-bold tracking-[0.3em] text-white/40 uppercase mb-4">{children}</p>
  );
}

function Field({
  label, value, onChange, error, type = "text",
}: {
  label: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  error?: string;
  type?: string;
}) {
  return (
    <div>
      <label className="block text-[10px] tracking-[0.2em] text-white/40 uppercase mb-1.5">{label}</label>
      <input
        type={type}
        value={value}
        onChange={onChange}
        className="w-full bg-transparent border px-4 py-3 text-sm text-white placeholder-white/20 outline-none transition-colors focus:border-white/40"
        style={{ borderColor: error ? "#ef4444" : "rgba(255,255,255,0.12)" }}
      />
      {error && <p className="text-[10px] text-red-400 mt-1">{error}</p>}
    </div>
  );
}

function Radio({ checked }: { checked: boolean }) {
  return (
    <div
      className="w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors"
      style={{ borderColor: checked ? "#f5c842" : "rgba(255,255,255,0.25)" }}
    >
      {checked && <div className="w-2 h-2 rounded-full" style={{ backgroundColor: "#f5c842" }} />}
    </div>
  );
}

function ShippingCard({
  selected, onSelect, title, description, price, badge,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  description: string;
  price: string;
  badge?: string;
}) {
  return (
    <div
      className="border cursor-pointer transition-colors p-4 flex items-center justify-between gap-4"
      style={{ borderColor: selected ? "#f5c842" : "rgba(255,255,255,0.1)" }}
      onClick={onSelect}
    >
      <div className="flex items-center gap-3">
        <Radio checked={selected} />
        <div>
          <div className="flex items-center gap-2">
            <p className="text-xs font-black uppercase tracking-widest">{title}</p>
            {badge && (
              <span
                className="text-[9px] font-black px-1.5 py-0.5 tracking-widest"
                style={{ backgroundColor: "#f5c842", color: "#0d0d0d" }}
              >
                {badge}
              </span>
            )}
          </div>
          <p className="text-[11px] text-white/40 mt-0.5">{description}</p>
        </div>
      </div>
      <span className="text-xs font-black uppercase tracking-widest shrink-0" style={{ color: price === "0 EGP" ? "#4ade80" : "white" }}>
        {price}
      </span>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="px-5 py-3.5 flex justify-between items-center">
      <span className="text-[10px] tracking-[0.2em] text-white/40 uppercase">{label}</span>
      <span className="text-xs font-bold uppercase">{value}</span>
    </div>
  );
}

function CompleteOrderButton({ total, submitting, onSubmit }: { total: number; submitting: boolean; onSubmit: () => void }) {
  return (
    <button
      onClick={onSubmit}
      disabled={submitting}
      className="w-full py-4 font-black uppercase tracking-[0.2em] text-sm transition-all active:scale-[0.98] disabled:opacity-60"
      style={{ backgroundColor: "#f5c842", color: "#0d0d0d" }}
    >
      {`Complete Order — ${total} EGP`}
    </button>
  );
}
