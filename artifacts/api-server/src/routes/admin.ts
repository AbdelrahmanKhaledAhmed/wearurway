import { Router, type IRouter } from "express";
import crypto from "node:crypto";
import {
  AdminLoginBody,
  AdminLoginResponse,
  GetAdminMeResponse,
} from "@workspace/api-zod";
import { getStore, updateStore } from "../data/store.js";
import config from "../config.js";

const router: IRouter = Router();

const ADMIN_PASSWORD = config.admin.password;

function generateSessionToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

function getSessions(): Set<string> {
  return new Set(getStore().adminSessions ?? []);
}

function persistSessions(sessions: Set<string>): void {
  updateStore((store) => {
    store.adminSessions = Array.from(sessions);
  });
}

export function isAdminAuthenticated(req: { headers: Record<string, string | string[] | undefined> }): boolean {
  const auth = req.headers["authorization"];
  if (!auth || typeof auth !== "string") return false;
  const token = auth.replace("Bearer ", "").trim();
  return getSessions().has(token);
}

router.post("/admin/login", (req, res) => {
  const body = AdminLoginBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid body" });
    return;
  }

  if (body.data.password !== ADMIN_PASSWORD) {
    res.status(401).json({ error: "Invalid password" });
    return;
  }

  const token = generateSessionToken();
  const sessions = getSessions();
  sessions.add(token);
  persistSessions(sessions);

  const data = AdminLoginResponse.parse({ success: true, message: "Logged in" });
  res.json({ ...data, token });
});

router.post("/admin/logout", (req, res) => {
  const auth = req.headers["authorization"];
  if (auth && typeof auth === "string") {
    const token = auth.replace("Bearer ", "").trim();
    const sessions = getSessions();
    sessions.delete(token);
    persistSessions(sessions);
  }
  res.json({ success: true });
});

router.get("/admin/me", (req, res) => {
  const authenticated = isAdminAuthenticated(req as Parameters<typeof isAdminAuthenticated>[0]);
  const data = GetAdminMeResponse.parse({ authenticated });
  res.json(data);
});

export default router;
