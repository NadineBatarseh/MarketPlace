//contains the logic of processing webhook events
// src/meta-webhook/webhookService.ts

import { isValidWebhookVerificationToken } from "./verifyMetaWebhook";

export function verifyMetaWebhook(query: any): { success: boolean; challenge?: string } {
  const mode = query["hub.mode"];
  const token = query["hub.verify_token"];
  const challenge = query["hub.challenge"];

  const expectedToken = process.env.META_WEBHOOK_VERIFY_TOKEN;

  const isValid =
    mode === "subscribe" &&
    isValidWebhookVerificationToken(token, expectedToken);

  if (!isValid) {
    return { success: false };
  }

  return {
    success: true,
    challenge,
  };
}

export function processMetaWebhookEvent(body: any) {
  console.log("Received Meta webhook event:");
  console.dir(body, { depth: null });

  return { received: true };
}