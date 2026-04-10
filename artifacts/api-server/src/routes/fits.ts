import { Router, type IRouter } from "express";
import {
  GetFitsResponse,
  UpdateFitParams,
  UpdateFitBody,
  UpdateFitResponse,
  CreateFitBody,
  DeleteFitParams,
} from "@workspace/api-zod";
import { getStore, updateStore, generateId } from "../data/store.js";

const router: IRouter = Router();

router.get("/fits", (_req, res) => {
  const store = getStore();
  const data = GetFitsResponse.parse(store.fits);
  res.json(data);
});

router.post("/fits", (req, res) => {
  const body = CreateFitBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const newFit = {
    id: generateId(),
    name: body.data.name,
    productId: body.data.productId,
    available: body.data.available ?? true,
    comingSoon: body.data.comingSoon ?? false,
  };

  updateStore((store) => {
    store.fits.push(newFit);
  });

  res.status(201).json(newFit);
});

router.patch("/fits/:id", (req, res) => {
  const params = UpdateFitParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid params" });
    return;
  }
  const body = UpdateFitBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid body" });
    return;
  }

  let found = false;
  updateStore((store) => {
    const fit = store.fits.find((f) => f.id === params.data.id);
    if (fit) {
      found = true;
      if (body.data.name !== undefined) fit.name = body.data.name;
      if (body.data.available !== undefined) fit.available = body.data.available;
      if (body.data.comingSoon !== undefined) fit.comingSoon = body.data.comingSoon;
    }
  });

  if (!found) {
    res.status(404).json({ error: "Fit not found" });
    return;
  }

  const store = getStore();
  const fit = store.fits.find((f) => f.id === params.data.id)!;
  const data = UpdateFitResponse.parse(fit);
  res.json(data);
});

router.delete("/fits/:id", (req, res) => {
  const params = DeleteFitParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid params" });
    return;
  }

  let found = false;
  updateStore((store) => {
    const idx = store.fits.findIndex((f) => f.id === params.data.id);
    if (idx !== -1) {
      found = true;
      store.fits.splice(idx, 1);
      store.colors = store.colors.filter((c) => c.fitId !== params.data.id);
      store.sizes = store.sizes.filter((s) => s.fitId !== params.data.id);
    }
  });

  if (!found) {
    res.status(404).json({ error: "Fit not found" });
    return;
  }

  res.status(204).send();
});

export default router;
