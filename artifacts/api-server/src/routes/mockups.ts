import { Router, type IRouter } from "express";
import { getStore, updateStore } from "../data/store.js";
import type { Mockup } from "../data/store.js";

const router: IRouter = Router();

function mockupKey(productId: string, fitId: string, colorId: string): string {
  return `${productId}__${fitId}__${colorId}`;
}

router.get("/mockups", (req, res) => {
  const { productId, fitId, colorId } = req.query as Record<string, string>;

  if (!productId || !fitId || !colorId) {
    res.status(400).json({ error: "productId, fitId, colorId are required" });
    return;
  }

  const store = getStore();
  const key = mockupKey(productId, fitId, colorId);
  const mockup = store.mockups[key];

  if (!mockup) {
    // Return empty shell
    res.json({ productId, fitId, colorId });
    return;
  }

  res.json(mockup);
});

router.put("/mockups", (req, res) => {
  const { productId, fitId, colorId, front, back, mockupSize, mockupOffsetY } = req.body as Partial<Mockup>;

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
    store.mockups[key] = updated;
    saved = updated;
  });

  res.json(saved!);
});

export default router;
