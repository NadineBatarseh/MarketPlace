//defines webhook endpoints
// src/meta-webhook/webhookRoutes.ts

import { Router } from "express";
import {
  handleMetaWebhookEventController,
  verifyMetaWebhookController,
} from "./webhookController";

const router = Router();

router.get("/meta", verifyMetaWebhookController);
router.post("/meta", handleMetaWebhookEventController);

export default router;