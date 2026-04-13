import { Router, type IRouter } from "express";
import path from "path";
import fs from "fs";
import { getStore, updateStore, generateId, type SharedDesign } from "../data/store.js";
import { SHARED_LAYERS_DIR } from "../lib/paths.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

const SHARE_TTL_MS = 24 * 60 * 60 * 1000;

router.post("/shared-designs", (req, res) => {
  const { product, fit, color, size, frontLayers, backLayers, layerFilenames } = req.body as Partial<SharedDesign> & { layerFilenames?: string[] };

  if (!product || !fit || !color || !size) {
    res.status(400).json({ error: "product, fit, color, size are required" });
    return;
  }

  const id = generateId();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SHARE_TTL_MS).toISOString();

  const sharedDesign: SharedDesign = {
    id,
    product,
    fit,
    color,
    size,
    frontLayers: frontLayers ?? [],
    backLayers: backLayers ?? [],
    createdAt: now.toISOString(),
    expiresAt,
    layerFilenames: layerFilenames ?? [],
  };

  updateStore(store => {
    store.sharedDesigns[id] = sharedDesign;
  });

  res.json({ id });
});

router.get("/shared-designs/:id", (req, res) => {
  const { id } = req.params;
  const store = getStore();
  const design = store.sharedDesigns[id];

  if (!design) {
    res.status(404).json({ error: "Shared design not found" });
    return;
  }

  if (new Date(design.expiresAt) <= new Date()) {
    res.status(410).json({ error: "Shared design has expired" });
    return;
  }

  res.json(design);
});

export function cleanupExpiredDesigns(): void {
  const store = getStore();
  const now = new Date();
  const expiredIds = Object.keys(store.sharedDesigns).filter(
    id => new Date(store.sharedDesigns[id].expiresAt) <= now
  );

  if (expiredIds.length === 0) return;

  for (const id of expiredIds) {
    const design = store.sharedDesigns[id];

    for (const filename of design.layerFilenames ?? []) {
      const filePath = path.join(SHARED_LAYERS_DIR, filename);
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch (err) {
        logger.warn({ err, filename }, "Failed to delete expired layer file");
      }
    }
  }

  updateStore(s => {
    for (const id of expiredIds) {
      delete s.sharedDesigns[id];
    }
  });

  logger.info({ count: expiredIds.length }, "Cleaned up expired shared designs");
}

export default router;
