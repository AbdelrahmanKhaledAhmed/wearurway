import { Router, type IRouter } from "express";
import { isAdminAuthenticated } from "./admin.js";
import { checkDatabaseHealth } from "../services/databaseService.js";
import { checkStorageHealth } from "../services/storageService.js";

const router: IRouter = Router();

/** GET /api/admin/system/health — returns health status of all services */
router.get("/admin/system/health", async (req, res) => {
  if (!isAdminAuthenticated(req as Parameters<typeof isAdminAuthenticated>[0])) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const [db, storage] = await Promise.all([
    checkDatabaseHealth(),
    checkStorageHealth(),
  ]);

  res.json({
    database: db,
    storage,
    environment: process.env.NODE_ENV ?? "development",
    timestamp: new Date().toISOString(),
  });
});

/** GET /api/admin/system/config — returns non-sensitive config overview */
router.get("/admin/system/config", (req, res) => {
  if (!isAdminAuthenticated(req as Parameters<typeof isAdminAuthenticated>[0])) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const isSupabase = !!process.env.SUPABASE_DATABASE_URL;
  const hasR2 =
    !!process.env.R2_ACCOUNT_ID &&
    !!process.env.R2_ACCESS_KEY_ID &&
    !!process.env.R2_SECRET_ACCESS_KEY &&
    !!process.env.R2_BUCKET_NAME;

  res.json({
    database: {
      provider: isSupabase ? "Supabase (PostgreSQL)" : "Replit PostgreSQL",
      configured: isSupabase || !!process.env.DATABASE_URL,
      connectionVariable: isSupabase ? "SUPABASE_DATABASE_URL" : "DATABASE_URL",
    },
    storage: {
      provider: "Cloudflare R2",
      configured: hasR2,
      bucket: process.env.R2_BUCKET_NAME ?? "(not set)",
      publicUrl: process.env.R2_PUBLIC_URL ?? "(not set)",
      accountId: process.env.R2_ACCOUNT_ID
        ? `${process.env.R2_ACCOUNT_ID.slice(0, 6)}...`
        : "(not set)",
    },
    telegram: {
      configured:
        !!(process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN),
      note: "Bot token and chat ID are also configurable via the Settings tab in Admin Panel",
    },
    environment: process.env.NODE_ENV ?? "development",
  });
});

export default router;
