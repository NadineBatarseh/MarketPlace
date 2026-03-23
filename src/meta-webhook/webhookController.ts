//receives request and sends response
// src/meta-webhook/webhookController.ts

import { Request, Response } from "express";
import { processMetaWebhookEvent, verifyMetaWebhook } from "./webhookService";

export function verifyMetaWebhookController(req: Request, res: Response) {
  const result = verifyMetaWebhook(req.query);

  if (!result.success || !result.challenge) {
    return res.sendStatus(403);
  }

  return res.status(200).send(result.challenge);
}

export function handleMetaWebhookEventController(req: Request, res: Response) {
  processMetaWebhookEvent(req.body);

  return res.status(200).json({ status: "EVENT_RECEIVED" });
}