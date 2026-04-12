import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import fs from "fs";
import router from "./routes";
import { logger } from "./lib/logger";
import { UPLOADS_DIR, FRONTEND_DIR, ensureDir } from "./lib/paths";

ensureDir(UPLOADS_DIR);

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api/uploads", express.static(UPLOADS_DIR));

app.use("/api", router);

if (process.env.NODE_ENV === "production" && fs.existsSync(FRONTEND_DIR)) {
  app.use(express.static(FRONTEND_DIR));
  app.get("*", (_req, res) => {
    res.sendFile(`${FRONTEND_DIR}/index.html`);
  });
}

export default app;
