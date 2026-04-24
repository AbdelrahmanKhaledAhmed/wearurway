const SESSION_KEY_PREFIX = "ww_analytics_event_";

export type AnalyticsEvent =
  | "view_landing"
  | "view_products"
  | "view_fits"
  | "view_colors"
  | "view_sizes"
  | "view_designer"
  | "view_checkout"
  | "complete_order";

function alreadyFiredThisSession(name: AnalyticsEvent): boolean {
  try {
    return sessionStorage.getItem(SESSION_KEY_PREFIX + name) === "1";
  } catch {
    return false;
  }
}

function markFiredThisSession(name: AnalyticsEvent) {
  try {
    sessionStorage.setItem(SESSION_KEY_PREFIX + name, "1");
  } catch {}
}

export function trackEvent(name: AnalyticsEvent) {
  if (alreadyFiredThisSession(name)) return;
  markFiredThisSession(name);
  try {
    const body = JSON.stringify({ name });
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      const blob = new Blob([body], { type: "application/json" });
      const ok = navigator.sendBeacon("/api/analytics/event", blob);
      if (ok) return;
    }
    void fetch("/api/analytics/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {}
}
