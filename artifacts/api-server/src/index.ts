import app from "./app";
import { logger } from "./lib/logger";
import { initStore, flushPendingSaves } from "./data/store.js";
import { cleanupExpiredDesigns } from "./routes/shared-designs.js";
import { startOrderOutbox } from "./services/orderOutbox.js";
import http from "node:http";

const rawPort = process.env["PORT"];
const port = rawPort ? Number(rawPort) : 3000;

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

process.on("uncaughtException", (err) => {
  logger.error({ err }, "Uncaught exception — shutting down");
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "Unhandled promise rejection — shutting down");
  process.exit(1);
});

async function main() {
  await initStore();

  const server = http.createServer(app);

  server.on("error", (err) => {
    logger.error({ err }, "Server error");
    process.exit(1);
  });

  server.listen(port, () => {
    logger.info({ port }, "Server listening");

    cleanupExpiredDesigns();
    setInterval(cleanupExpiredDesigns, 60 * 60 * 1000);

    startOrderOutbox();
  });

  process.on("SIGTERM", () => {
    logger.info("SIGTERM received — shutting down gracefully");
    server.close(async () => {
      try {
        await flushPendingSaves();
      } catch (err) {
        logger.error({ err }, "Failed to flush pending DB saves on shutdown");
      }
      logger.info("Server closed");
      process.exit(0);
    });
  });
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
