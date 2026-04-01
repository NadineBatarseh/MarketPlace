//checks verification token/signature// src/meta-webhook/verifyMetaWebhook.ts

export function isValidWebhookVerificationToken(
  tokenFromMeta: string | undefined,
  expectedToken: string | undefined
): boolean {
  if (!tokenFromMeta || !expectedToken) {
    return false;
  }

  return tokenFromMeta === expectedToken;
}