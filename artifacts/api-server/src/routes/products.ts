import { Router, type IRouter } from "express";
import {
  GetProductsResponse,
  UpdateProductParams,
  UpdateProductBody,
  UpdateProductResponse,
  CreateProductBody,
  DeleteProductParams,
} from "@workspace/api-zod";
import { getStore, updateStore, generateId } from "../data/store.js";

const router: IRouter = Router();

router.get("/products", (_req, res) => {
  const store = getStore();
  const data = GetProductsResponse.parse(store.products);
  res.json(data);
});

router.post("/products", (req, res) => {
  const body = CreateProductBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const newProduct = {
    id: generateId(),
    name: body.data.name,
    available: body.data.available ?? true,
    comingSoon: body.data.comingSoon ?? false,
    image: body.data.image,
  };

  updateStore((store) => {
    store.products.push(newProduct);
  });

  res.status(201).json(newProduct);
});

router.patch("/products/:id", (req, res) => {
  const params = UpdateProductParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid params" });
    return;
  }
  const body = UpdateProductBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid body" });
    return;
  }

  let found = false;
  updateStore((store) => {
    const product = store.products.find((p) => p.id === params.data.id);
    if (product) {
      found = true;
      if (body.data.name !== undefined) product.name = body.data.name;
      if (body.data.available !== undefined) product.available = body.data.available;
      if (body.data.comingSoon !== undefined) product.comingSoon = body.data.comingSoon;
      if (body.data.image !== undefined) product.image = body.data.image;
    }
  });

  if (!found) {
    res.status(404).json({ error: "Product not found" });
    return;
  }

  const store = getStore();
  const product = store.products.find((p) => p.id === params.data.id)!;
  const data = UpdateProductResponse.parse(product);
  res.json(data);
});

router.delete("/products/:id", (req, res) => {
  const params = DeleteProductParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid params" });
    return;
  }

  let found = false;
  updateStore((store) => {
    const idx = store.products.findIndex((p) => p.id === params.data.id);
    if (idx !== -1) {
      found = true;
      store.products.splice(idx, 1);
      // Also remove associated fits, colors, sizes
      const fitIds = store.fits
        .filter((f) => f.productId === params.data.id)
        .map((f) => f.id);
      store.fits = store.fits.filter((f) => f.productId !== params.data.id);
      store.colors = store.colors.filter((c) => !fitIds.includes(c.fitId));
      store.sizes = store.sizes.filter((s) => !fitIds.includes(s.fitId));
    }
  });

  if (!found) {
    res.status(404).json({ error: "Product not found" });
    return;
  }

  res.status(204).send();
});

export default router;
