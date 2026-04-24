import { Router, type IRouter } from "express";
import { isAdminAuthenticated } from "./admin.js";
import { checkDatabaseHealth } from "../services/databaseService.js";
import { checkStorageHealth } from "../services/storageService.js";
import { getStore } from "../data/store.js";
import config from "../config.js";

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

  const dbUrl = config.database.url;
  const isSupabase = dbUrl.includes("supabase");
  const hasR2 = !!(config.r2.accountId && config.r2.accessKeyId && config.r2.secretAccessKey && config.r2.bucketName);

  res.json({
    database: {
      provider: isSupabase ? "Supabase (PostgreSQL)" : "PostgreSQL",
      configured: !!dbUrl,
      connectionVariable: "DATABASE_URL",
    },
    storage: {
      provider: "Cloudflare R2",
      configured: hasR2,
      bucket: config.r2.bucketName || "(not set)",
      publicUrl: config.r2.publicUrl || "(not set)",
      accountId: config.r2.accountId
        ? `${config.r2.accountId.slice(0, 6)}...`
        : "(not set)",
    },
    telegram: (() => {
      const s = getStore().orderSettings;
      const hasToken = !!s.telegramBotToken?.trim();
      const hasChat = !!s.telegramChatId?.trim();
      return {
        configured: hasToken && hasChat,
        botToken: hasToken ? "set" : "(not set)",
        chatId: hasChat ? "set" : "(not set)",
        note: "Bot token and chat ID are configurable via the Settings tab in Admin Panel",
      };
    })(),
    environment: process.env.NODE_ENV ?? "development",
  });
});

export default router;
