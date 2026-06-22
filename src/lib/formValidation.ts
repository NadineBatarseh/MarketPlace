/**
 * Shared client-side validators for contact fields (name / email / phone).
 * Used by the checkout form and the customer settings page so both behave
 * identically.
 */

// A valid email needs a part before @, a part after @, and a dotted domain.
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Arabic (and Arabic-supplement / presentation-form) letters — never valid
// inside an email address, so we strip them as the user types.
export const ARABIC_RE = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/g;

/**
 * Split a stored phone (any format) into a country code + the 8 local digits
 * that come after the leading "05". Recompose with `${code}5${local}`.
 */
export function parsePhone(raw: string): { code: string; local: string } {
  let rest = (raw || '').replace(/\D/g, '');
  let code = '970';
  if (rest.startsWith('972'))      { code = '972'; rest = rest.slice(3); }
  else if (rest.startsWith('970')) { code = '970'; rest = rest.slice(3); }
  if (rest.startsWith('0')) rest = rest.slice(1); // drop leading 0 of 05…
  if (rest.startsWith('5')) rest = rest.slice(1); // drop the mobile "5" prefix
  return { code, local: rest.slice(0, 8) };
}
