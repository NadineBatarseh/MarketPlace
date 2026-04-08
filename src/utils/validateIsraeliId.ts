/**
 * Israeli National ID (Teudat Zehut) Validation
 *
 * Rules:
 *  1. 1–9 digits (padded with leading zeros to reach 9 digits).
 *  2. Passes the Luhn-based checksum used by Israel's Population Registry.
 *
 * Algorithm (Israeli variant of Luhn):
 *  - Pad the number to 9 digits with leading zeros.
 *  - For each digit at position i (0-indexed), multiply by (i % 2 === 0 ? 1 : 2).
 *  - If the result > 9, subtract 9.
 *  - Sum all results; valid if total % 10 === 0.
 */

export type IdValidationResult =
  | { valid: true }
  | { valid: false; reason: string };

export function validateIsraeliId(raw: string): IdValidationResult {
  const trimmed = raw.trim();

  if (!/^\d{1,9}$/.test(trimmed)) {
    return { valid: false, reason: 'رقم الهوية يجب أن يحتوي على أرقام فقط (حتى 9 أرقام)' };
  }

  const id = trimmed.padStart(9, '0');
  let sum = 0;

  for (let i = 0; i < 9; i++) {
    let digit = parseInt(id[i], 10) * (i % 2 === 0 ? 1 : 2);
    if (digit > 9) digit -= 9;
    sum += digit;
  }

  if (sum % 10 !== 0) {
    return { valid: false, reason: 'رقم الهوية غير صحيح — تحقق من الأرقام وأعد المحاولة' };
  }

  return { valid: true };
}
