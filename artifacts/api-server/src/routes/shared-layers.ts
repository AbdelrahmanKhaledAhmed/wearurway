import { Router, type IRouter } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import sharp from "sharp";
import { SHARED_LAYERS_DIR, ensureDir } from "../lib/paths.js";

ensureDir(SHARED_LAYERS_DIR);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

const router: IRouter = Router();

router.post("/shared-layers", upload.single("file"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }

  const id = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  const filename = `${id}.png`;
  const filePath = path.join(SHARED_LAYERS_DIR, filename);

  try {
    const pngBuffer = await sharp(req.file.buffer).png().toBuffer();
    fs.writeFileSync(filePath, pngBuffer);
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
