import { Router, type IRouter } from "express";
import { getStore, updateStore } from "../data/store.js";
import type { Mockup } from "../data/store.js";
import { objectExists } from "../lib/objectStorage.js";

const router: IRouter = Router();

function mockupKey(productId: string, fitId: string, colorId: string): string {
  return `${productId}__${fitId}__${colorId}`;
}

function toMockupFilenamePart(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function buildMockupFilename(
  productName: string,
  fitName: string,
  colorName: string,
  side: "front" | "back"
): string {
  const parts = [productName, fitName, colorName].map(toMockupFilenamePart);
  if (parts.some((p) => !p)) return "";
  return `${parts.join("_")}_${side}.png`;
}

router.get("/mockups", async (req, res) => {
  const { productId, fitId, colorId } = req.query as Record<string, string>;

  if (!productId || !fitId || !colorId) {
    res.status(400).json({ error: "productId, fitId, colorId are required" });
    return;
  }

  const store = getStore();
  const key = mockupKey(productId, fitId, colorId);
  const saved = store.mockups[key];

  // Look up names to generate expected filenames
  const product = store.products.find((p) => p.id === productId);
  const fit = store.fits.find((f) => f.id === fitId);
  const color = store.colors.find((c) => c.id === colorId);

  const frontFilename = product && fit && color
    ? buildMockupFilename(product.name, fit.name, color.name, "front")
    : "";
  const backFilename = product && fit && color
    ? buildMockupFilename(product.name, fit.name, color.name, "back")
    : "";

  // Check Object Storage for auto-detection
  const [frontExists, backExists] = await Promise.all([
    frontFilename ? objectExists(`uploads/mockups/${frontFilename}`) : Promise.resolve(false),
    backFilename ? objectExists(`uploads/mockups/${backFilename}`) : Promise.resolve(false),
  ]);

  const autoFrontImage = frontExists ? `/api/uploads/mockups/${frontFilename}` : undefined;
  const autoBackImage = backExists ? `/api/uploads/mockups/${backFilename}` : undefined;

  if (!saved) {
    if (!autoFrontImage && !autoBackImage) {
      res.json({ productId, fitId, colorId });
      return;
    }
    res.json({
      productId,
      fitId,
      colorId,
      front: autoFrontImage ? { image: autoFrontImage } : undefined,
      back: autoBackImage ? { image: autoBackImage } : undefined,
    });
    return;
  }

  // Merge saved record with auto-detected images as fallback
  const merged: Mockup = {
    ...saved,
    front: {
      ...saved.front,
      image: saved.front?.image || autoFrontImage,
    },
    back: {
      ...saved.back,
      image: saved.back?.image || autoBackImage,
    },
  };

  res.json(merged);
});

router.put("/mockups", (req, res) => {
  const { productId, fitId, colorId, front, back, mockupSize, mockupOffsetY, showSaveDesignButton } = req.body as Partial<Mockup>;

  if (!productId || !fitId || !colorId) {
    res.status(400).json({ error: "productId, fitId, colorId are required" });
    return;
  }

  const key = mockupKey(productId, fitId, colorId);

  let saved: Mockup;
  updateStore((store) => {
    const existing = store.mockups[key] ?? { productId, fitId, colorId };
    const updated: Mockup = {
      ...existing,
      productId,
      fitId,
      colorId,
    };
    if (front !== undefined) updated.front = front;
    if (back !== undefined) updated.back = back;
    if (mockupSize !== undefined) updated.mockupSize = mockupSize;
    if (mockupOffsetY !== undefined) updated.mockupOffsetY = mockupOffsetY;
    if (showSaveDesignButton !== undefined) updated.showSaveDesignButton = showSaveDesignButton;
    store.mockups[key] = updated;
    saved = updated;
  });

  res.json(saved!);
});

export default router;
