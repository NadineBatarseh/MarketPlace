import { Router } from "express";
import multer from "multer";
import { supabase } from "../supabase.js";
import { verifyRecaptchaFromBody } from "../middleware/verifyRecaptcha.js";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

// POST /api/upload-docs
// Accepts: idFront, idBack, licenseFront (optional), licenseBack (optional)
// Returns: { idFrontPath, idBackPath, licenseFrontPath?, licenseBackPath? }
router.post(
  "/upload-docs",
  upload.fields([
    { name: "idFront", maxCount: 1 },
    { name: "idBack", maxCount: 1 },
    { name: "licenseFront", maxCount: 1 },
    { name: "licenseBack", maxCount: 1 },
  ]),
  verifyRecaptchaFromBody(['merchant_application', 'delivery_application']),
  async (req, res) => {
    const files = req.files as Record<string, Express.Multer.File[]>;
    const { bucket, folder } = req.body as { bucket: string; folder: string };

    if (!bucket || !folder) {
      res.status(400).json({ error: "bucket and folder are required" });
      return;
    }

    const allowed = ["merchant-id-docs", "delivery-applications"];
    if (!allowed.includes(bucket)) {
      res.status(400).json({ error: "invalid bucket" });
      return;
    }

    const uploadFile = async (fieldName: string): Promise<string | null> => {
      const file = files[fieldName]?.[0];
      if (!file) return null;
      const ext = file.originalname.split(".").pop() ?? "jpg";
      const path = `${folder}/${fieldName}.${ext}`;
      const { data, error } = await supabase.storage
        .from(bucket)
        .upload(path, file.buffer, { contentType: file.mimetype, upsert: true });
      if (error) throw new Error(error.message);
      return data.path;
    };

    try {
      const [idFrontPath, idBackPath, licenseFrontPath, licenseBackPath] =
        await Promise.all([
          uploadFile("idFront"),
          uploadFile("idBack"),
          uploadFile("licenseFront"),
          uploadFile("licenseBack"),
        ]);

      res.json({ idFrontPath, idBackPath, licenseFrontPath, licenseBackPath });
    } catch (err: unknown) {
      res
        .status(500)
        .json({ error: err instanceof Error ? err.message : "upload failed" });
    }
  }
);

export default router;
