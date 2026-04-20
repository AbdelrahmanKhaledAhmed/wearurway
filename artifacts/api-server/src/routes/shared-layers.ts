import { Router, type IRouter } from "express";
import multer from "multer";
import path from "path";
import sharp from "sharp";
import { uploadBuffer, streamObject } from "../lib/objectStorage.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

const router: IRouter = Router();

// Serve shared-layer images from Object Storage
router.get("/uploads/shared-layers/:filename", async (req, res) => {
  const filename = path.basename(req.params.filename);
  const found = await streamObject(`uploads/shared-layers/${filename}`, res);
  if (!found) res.status(404).json({ error: "Not found" });
});

router.post("/shared-layers", upload.single("file"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }

  const id = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  const filename = `${id}.png`;

  try {
    const pngBuffer = await sharp(req.file.buffer).png().toBuffer();
    await uploadBuffer(`uploads/shared-layers/${filename}`, pngBuffer, "image/png");
  } catch {
    res.status(500).json({ error: "Failed to process image" });
    return;
  }

  res.status(201).json({
    url: `/api/uploads/shared-layers/${filename}`,
    filename,
  });
});

export default router;
