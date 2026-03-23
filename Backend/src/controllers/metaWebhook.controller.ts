import type { Request, Response } from "express";

export function verifyMetaWebhook(req: Request, res: Response) {
  // Meta sends these query params during verification
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  // Our secret token (from .env)
  const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN;

  // 1) Check that meta is trying to subscribe
  // 2) Check the token matches what we set in .env
  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    // Must return the challenge exactly (plain text)
    return res.status(200).send(String(challenge));
  }

  // If token doesn't match -> reject
  return res.sendStatus(403);
}

export const handleMetaWebhook = (req: Request, res: Response) => {
  console.log("📩 Meta Webhook received");
  console.log(JSON.stringify(req.body, null, 2));

  // Always respond 200 so Meta knows we received it
  res.sendStatus(200);
};
