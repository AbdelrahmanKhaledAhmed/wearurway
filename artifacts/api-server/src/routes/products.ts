import { Router, type IRouter } from "express";
import {
  GetProductsResponse,
  UpdateProductParams,
  UpdateProductBody,
  UpdateProductResponse,
} from "@workspace/api-zod";
import { getStore, updateStore } from "../data/store.js";

const router: IRouter = Router();

router.get("/products", (_req, res) => {
  const store = getStore();
  const data = GetProductsResponse.parse(store.products);
  res.json(data);
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
      if (body.data.available !== undefined) product.available = body.data.available;
      if (body.data.comingSoon !== undefined) product.comingSoon = body.data.comingSoon;
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

export default router;
