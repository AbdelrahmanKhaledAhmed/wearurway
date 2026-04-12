import { Router, type IRouter } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import sharp from "sharp";
import { SIZE_CHARTS_DIR, ensureDir, toSafeFilename } from "../lib/paths.js";

ensureDir(SIZE_CHARTS_DIR);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed"));
    }
  },
});

const router: IRouter = Router();

router.post("/size-charts", upload.single("file"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }

  const rawName = (req.body as Record<string, string>).name ?? "";
  const safeName = toSafeFilename(rawName);

  if (!safeName) {
    res.status(400).json({ error: "A valid file name is required" });
    return;
  }

  const filename = `${safeName}.png`;
  const filePath = path.join(SIZE_CHARTS_DIR, filename);

  try {
    const pngBuffer = await sharp(req.file.buffer).png().toBuffer();
    fs.writeFileSync(filePath, pngBuffer);
  } catch {
    res.status(500).json({ error: "Failed to process image" });
    return;
  }

  res.status(201).json({
    url: `/api/size-charts/${filename}`,
    filename,
  });
});

router.delete("/size-charts/:filename", (req, res) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.join(SIZE_CHARTS_DIR, filename);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: "File not found" });
    return;
  }
  fs.unlinkSync(filePath);
  res.status(200).json({ success: true });
});

export default router;
