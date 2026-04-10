import { Router, type IRouter } from "express";
import {
  GetFitsResponse,
  UpdateFitParams,
  UpdateFitBody,
  UpdateFitResponse,
} from "@workspace/api-zod";
import { getStore, updateStore } from "../data/store.js";

const router: IRouter = Router();

router.get("/fits", (_req, res) => {
  const store = getStore();
  const data = GetFitsResponse.parse(store.fits);
  res.json(data);
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

export default router;
