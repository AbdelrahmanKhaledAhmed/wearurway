import { Router, type IRouter } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { SIZE_CHARTS_DIR, ensureDir } from "../lib/paths.js";

ensureDir(SIZE_CHARTS_DIR);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, SIZE_CHARTS_DIR);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext)
      .replace(/[^a-zA-Z0-9_-]/g, "_");
    const unique = `${base}_${Date.now()}${ext}`;
    cb(null, unique);
  },
});

const upload = multer({
  storage,
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

router.post("/size-charts", upload.single("file"), (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }
  res.status(201).json({
    url: `/api/size-charts/${req.file.filename}`,
    filename: req.file.filename,
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
