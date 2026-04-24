import { Router, type IRouter } from "express";
import { getStore, updateStore } from "../data/store.js";
import { isAdminAuthenticated } from "./admin.js";

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
  updateStore((store) => {
    const current = store.analyticsEvents?.[name] ?? 0;
    if (!store.analyticsEvents) store.analyticsEvents = {};
    store.analyticsEvents[name] = current + 1;
  });
  res.status(204).end();
});

router.get("/admin/analytics", (req, res) => {
  if (!isAdminAuthenticated(req as Parameters<typeof isAdminAuthenticated>[0])) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const events = getStore().analyticsEvents ?? {};
  res.json({ events });
});

router.post("/admin/analytics/reset", (req, res) => {
  if (!isAdminAuthenticated(req as Parameters<typeof isAdminAuthenticated>[0])) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  updateStore((store) => {
    store.analyticsEvents = {};
  });
  res.json({ success: true });
});

export default router;
