import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const UPLOADS_DIR = process.env.UPLOADS_DIR
  ? path.resolve(process.env.UPLOADS_DIR)
  : path.join(__dirname, "..", "..", "uploads");

export const MOCKUPS_DIR = path.join(UPLOADS_DIR, "mockups");

export const SIZE_CHARTS_DIR = process.env.SIZE_CHARTS_DIR
  ? path.resolve(process.env.SIZE_CHARTS_DIR)
  : path.join(UPLOADS_DIR, "size-charts");

export const FRONTEND_DIR = process.env.FRONTEND_DIR
  ? path.resolve(process.env.FRONTEND_DIR)
  : path.join(__dirname, "..", "..", "wearurway", "dist", "public");

export function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function toSafeFilename(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}
