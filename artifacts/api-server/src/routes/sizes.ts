import { Router, type IRouter } from "express";
import {
  GetSizesParams,
  GetSizesResponse,
  AddSizeParams,
  AddSizeBody,
  UpdateSizeParams,
  UpdateSizeBody,
  UpdateSizeResponse,
  DeleteSizeParams,
} from "@workspace/api-zod";
import { getStore, updateStore, generateId } from "../data/store.js";

const router: IRouter = Router();

router.get("/fits/:fitId/sizes", (req, res) => {
  const params = GetSizesParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid params" });
    return;
  }
  const store = getStore();
  const sizes = store.sizes.filter((s) => s.fitId === params.data.fitId);
  const data = GetSizesResponse.parse(sizes);
  res.json(data);
});

router.post("/fits/:fitId/sizes", (req, res) => {
  const params = AddSizeParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid params" });
    return;
  }
  const body = AddSizeBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const newSize = {
    id: generateId(),
    name: body.data.name,
    realWidth: body.data.realWidth,
    realHeight: body.data.realHeight,
    fitId: params.data.fitId,
    available: body.data.available ?? true,
    comingSoon: body.data.comingSoon ?? false,
    heightMin: body.data.heightMin,
    heightMax: body.data.heightMax,
    weightMin: body.data.weightMin,
    weightMax: body.data.weightMax,
  };

  updateStore((store) => {
    store.sizes.push(newSize);
  });

  res.status(201).json(newSize);
});

router.patch("/fits/:fitId/sizes/:sizeId", (req, res) => {
  const params = UpdateSizeParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid params" });
    return;
  }
  const body = UpdateSizeBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  let found = false;
  updateStore((store) => {
    const size = store.sizes.find(
      (s) => s.id === params.data.sizeId && s.fitId === params.data.fitId
    );
    if (size) {
      found = true;
      if (body.data.name !== undefined) size.name = body.data.name;
      if (body.data.realWidth !== undefined) size.realWidth = body.data.realWidth;
      if (body.data.realHeight !== undefined) size.realHeight = body.data.realHeight;
      if (body.data.available !== undefined) size.available = body.data.available;
      if (body.data.comingSoon !== undefined) size.comingSoon = body.data.comingSoon;
      if (body.data.heightMin !== undefined) size.heightMin = body.data.heightMin;
      if (body.data.heightMax !== undefined) size.heightMax = body.data.heightMax;
      if (body.data.weightMin !== undefined) size.weightMin = body.data.weightMin;
      if (body.data.weightMax !== undefined) size.weightMax = body.data.weightMax;
    }
  });

  if (!found) {
    res.status(404).json({ error: "Size not found" });
    return;
  }

  const store = getStore();
  const size = store.sizes.find(
    (s) => s.id === params.data.sizeId && s.fitId === params.data.fitId
  )!;
  const data = UpdateSizeResponse.parse(size);
  res.json(data);
});

router.delete("/fits/:fitId/sizes/:sizeId", (req, res) => {
  const params = DeleteSizeParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid params" });
    return;
  }

  let found = false;
  updateStore((store) => {
    const idx = store.sizes.findIndex(
      (s) => s.id === params.data.sizeId && s.fitId === params.data.fitId
    );
    if (idx !== -1) {
      found = true;
      store.sizes.splice(idx, 1);
    }
  });

  if (!found) {
    res.status(404).json({ error: "Size not found" });
    return;
  }

  res.status(204).send();
});

export default router;
