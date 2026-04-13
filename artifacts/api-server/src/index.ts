import app from "./app";
import { logger } from "./lib/logger";
import { cleanupExpiredDesigns } from "./routes/shared-designs.js";

const rawPort = process.env["PORT"];
const port = rawPort ? Number(rawPort) : 3000;

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  cleanupExpiredDesigns();
  setInterval(cleanupExpiredDesigns, 60 * 60 * 1000);
});
