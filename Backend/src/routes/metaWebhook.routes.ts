import { Router } from "express";
import {
  verifyMetaWebhook,
  handleMetaWebhook,
} from "../controllers/metaWebhook.controller";

const router = Router();

// Meta webhook verification
router.get("/meta", verifyMetaWebhook);

// Meta webhook events
router.post("/meta", handleMetaWebhook);

export default router;
