/**
 * Arabic/Latin search normalizer — the application-side mirror of the SQL
 * function `public.souq_normalize()` in
 * supabase/migrations/search_normalization.sql.
 *
 * These two implementations MUST stay equivalent: the DB normalizes product
 * text when building `search_vector`, and this normalizes the query terms before
 * they are turned into to_tsquery lexemes. If they diverge, query lexemes stop
 * matching the stored ones and results silently disappear.
 *
 * Transforms (applied after lower-casing):
 *   STRIP  U+064B..U+065F (tashkeel) + U+0670 (superscript alef) + U+0640 (tatweel)
 *   FOLD   U+0623,U+0625,U+0622,U+0671 -> U+0627 (alef)
 *          U+0649,U+0626 -> U+064A (ya) | U+0624 -> U+0648 (waw) | U+0629 -> U+0647 (ha)
 *   then collapse whitespace and trim.
 *
 * Character sets are built from codepoints (String.fromCharCode) so this source
 * stays ASCII and the codepoints match the SQL chr() sets exactly.
 */

const cp = String.fromCharCode;

// Strip set: [U+064B-U+065F  U+0670  U+0640]
const STRIP_RE = new RegExp('[' + cp(0x064b) + '-' + cp(0x065f) + cp(0x0670) + cp(0x0640) + ']', 'g');

// Fold map: variant codepoint -> canonical codepoint
const FOLD: Record<string, string> = {
  [cp(0x0623)]: cp(0x0627), // أ -> ا
  [cp(0x0625)]: cp(0x0627), // إ -> ا
  [cp(0x0622)]: cp(0x0627), // آ -> ا
  [cp(0x0671)]: cp(0x0627), // ٱ -> ا
  [cp(0x0649)]: cp(0x064a), // ى -> ي
  [cp(0x0626)]: cp(0x064a), // ئ -> ي
  [cp(0x0624)]: cp(0x0648), // ؤ -> و
  [cp(0x0629)]: cp(0x0647), // ة -> ه
};
const FOLD_RE = new RegExp('[' + Object.keys(FOLD).join('') + ']', 'g');

export function normalizeArabic(input: string): string {
  if (!input) return '';
  return input
    .toLowerCase()
    .replace(STRIP_RE, '')
    .replace(FOLD_RE, (ch) => FOLD[ch] ?? ch)
    .replace(/\s+/g, ' ')
    .trim();
}
