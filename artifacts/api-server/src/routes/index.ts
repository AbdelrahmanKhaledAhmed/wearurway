import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import productsRouter from "./products.js";
import fitsRouter from "./fits.js";
import colorsRouter from "./colors.js";
import sizesRouter from "./sizes.js";
import mockupsRouter from "./mockups.js";
import adminRouter from "./admin.js";
import uploadsRouter from "./uploads.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(productsRouter);
router.use(fitsRouter);
router.use(colorsRouter);
router.use(sizesRouter);
router.use(mockupsRouter);
router.use(adminRouter);
router.use(uploadsRouter);

export default router;
