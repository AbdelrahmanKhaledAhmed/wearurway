import { Router, type IRouter } from "express";
import {
  incrementAnalyticsEvent,
  getAnalyticsEvents,
  resetAnalyticsEvents,
} from "../services/analyticsStore.js";
import { isAdminAuthenticated } from "./admin.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

const ALLOWED_EVENTS = new Set([
  "view_landing",
  "view_products",
  "view_fits",
  "view_colors",
  "view_sizes",
  "view_designer",
  "view_checkout",
  "complete_order",
]);

router.post("/analytics/event", (req, res) => {
  const body = (req.body ?? {}) as { name?: unknown };
  const name = typeof body.name === "string" ? body.name : "";
  if (!ALLOWED_EVENTS.has(name)) {
    res.status(204).end();
    return;
  }
  // Respond immediately. The single-row upsert is cheap and fire-and-forget
  // so visitors never wait on the analytics write.
  res.status(204).end();
  void incrementAnalyticsEvent(name).catch((err) => {
    logger.warn({ err, name }, "Failed to record analytics event");
  });
});

router.get("/admin/analytics", async (req, res) => {
  if (!isAdminAuthenticated(req as Parameters<typeof isAdminAuthenticated>[0])) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const events = await getAnalyticsEvents();
    res.json({ events });
  } catch (err) {
    logger.error({ err }, "Failed to read analytics events");
    res.status(500).json({ error: "Could not read analytics" });
  }
});

router.post("/admin/analytics/reset", async (req, res) => {
  if (!isAdminAuthenticated(req as Parameters<typeof isAdminAuthenticated>[0])) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    await resetAnalyticsEvents();
    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "Failed to reset analytics events");
    res.status(500).json({ error: "Could not reset analytics" });
  }
});

export default router;
