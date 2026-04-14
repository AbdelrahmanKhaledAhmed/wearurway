import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import productsRouter from "./products.js";
import fitsRouter from "./fits.js";
import colorsRouter from "./colors.js";
import sizesRouter from "./sizes.js";
import mockupsRouter from "./mockups.js";
import adminRouter from "./admin.js";
import uploadsRouter from "./uploads.js";
import sizeChartsRouter from "./size-charts.js";
import sharedDesignsRouter from "./shared-designs.js";
import sharedLayersRouter from "./shared-layers.js";
import orderSettingsRouter from "./order-settings.js";
import ordersRouter from "./orders.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(productsRouter);
router.use(fitsRouter);
router.use(colorsRouter);
router.use(sizesRouter);
router.use(mockupsRouter);
router.use(adminRouter);
router.use(uploadsRouter);
router.use(sizeChartsRouter);
router.use(sharedDesignsRouter);
router.use(sharedLayersRouter);
router.use(orderSettingsRouter);
router.use(ordersRouter);

export default router;
