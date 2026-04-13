import { Router, type IRouter } from "express";
import { getStore, updateStore, generateId, type SharedDesign } from "../data/store.js";

const router: IRouter = Router();

router.post("/shared-designs", (req, res) => {
  const { product, fit, color, size, frontLayers, backLayers } = req.body as Partial<SharedDesign>;

  if (!product || !fit || !color || !size) {
    res.status(400).json({ error: "product, fit, color, size are required" });
    return;
  }

  const id = generateId();
  const sharedDesign: SharedDesign = {
    id,
    product,
    fit,
    color,
    size,
    frontLayers: frontLayers ?? [],
    backLayers: backLayers ?? [],
    createdAt: new Date().toISOString(),
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
  res.json(design);
});

export default router;
