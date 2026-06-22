/**
 * Symmetric encryption for vendor payout bank details (IBAN).
 *
 * PayTabs External Payouts has NO beneficiary-vault: the raw IBAN must be sent inside
 * every payout batch (see server/lib/paytabsPayout.ts), which happens days/weeks after
 * onboarding. So unlike the original entity_id design, we MUST custody the IBAN. It is
 * stored encrypted at rest (AES-256-GCM, authenticated) and only ever decrypted in
 * memory at settlement time.
 *
 *   - Key comes from PAYOUT_ENC_KEY (64 hex chars = 32 bytes preferred; any other string
 *     is hashed to 32 bytes via SHA-256 so a passphrase also works).
 *   - Ciphertext format: "v1:<iv-b64>:<tag-b64>:<data-b64>" — versioned for future rotation.
 *
 * ⚠️ NEVER log the plaintext IBAN or the key. Only the ciphertext blob is safe to persist.
 */
import crypto from 'crypto';

const VERSION = 'v1';

/** Resolve the 32-byte AES key from PAYOUT_ENC_KEY. Throws if unset. */
function getKey(): Buffer {
  const raw = process.env.PAYOUT_ENC_KEY ?? '';
  if (!raw) throw new Error('PAYOUT_ENC_KEY is missing — required to (de)crypt vendor IBANs');
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
  // Fall back to a derived key so a human-readable passphrase also works.
  return crypto.createHash('sha256').update(raw, 'utf8').digest();
}

/** Encrypt a secret string → versioned, authenticated ciphertext blob (safe to persist). */
export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(12); // 96-bit nonce, recommended for GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join(':');
}

/** Decrypt a blob produced by encryptSecret(). Throws if tampered or wrong key. */
export function decryptSecret(blob: string): string {
  const parts = blob.split(':');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error('unsupported or malformed ciphertext');
  }
  const [, ivB64, tagB64, dataB64] = parts;
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
}
