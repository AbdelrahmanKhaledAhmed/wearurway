import { Router, type IRouter } from "express";
import {
  GetColorsParams,
  GetColorsResponse,
  AddColorParams,
  AddColorBody,
  DeleteColorParams,
} from "@workspace/api-zod";
import { getStore, updateStore, generateId } from "../data/store.js";

const router: IRouter = Router();

router.get("/fits/:fitId/colors", (req, res) => {
  const params = GetColorsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid params" });
    return;
  }
  const store = getStore();
  const colors = store.colors.filter((c) => c.fitId === params.data.fitId);
  const data = GetColorsResponse.parse(colors);
  res.json(data);
});

router.post("/fits/:fitId/colors", (req, res) => {
  const params = AddColorParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid params" });
    return;
  }
  const body = AddColorBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const newColor = {
    id: generateId(),
    name: body.data.name,
    hex: body.data.hex,
    fitId: params.data.fitId,
  };

  updateStore((store) => {
    store.colors.push(newColor);
  });

  res.status(201).json(newColor);
});

router.delete("/fits/:fitId/colors/:colorId", (req, res) => {
  const params = DeleteColorParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid params" });
    return;
  }

  let found = false;
  updateStore((store) => {
    const idx = store.colors.findIndex(
      (c) => c.id === params.data.colorId && c.fitId === params.data.fitId
    );
    if (idx !== -1) {
      found = true;
      store.colors.splice(idx, 1);
    }
  });

  if (!found) {
    res.status(404).json({ error: "Color not found" });
    return;
  }

  res.status(204).send();
});

export default router;
