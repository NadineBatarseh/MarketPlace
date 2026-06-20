import { supabase } from '../supabase.js';
import { normalizeArabic } from './normalizeArabic.js';

/**
 * Spell-correct misspelled query tokens to the nearest real catalog/vocabulary
 * word BEFORE synonym expansion runs.
 *
 * Why: the trigram fuzzy tier in search_products() can already surface products
 * for a typo like "فسان", but synonym expansion (expandQueryDynamic) runs on the
 * raw token — so the typo never pulls "فستان"'s synonyms (فساتين, dress, ...).
 * Correcting the token first lets the router expand the RIGHT word's synonyms.
 *
 * The correct_term() RPC returns NULL for tokens that already exist in the
 * catalog, so legitimate words are never altered — only genuine typos change.
 */
export async function correctQuery(rawQuery: string): Promise<{ corrected: string; changed: boolean }> {
  // Simple whitespace/punctuation tokenization (no 'ال'-variant expansion — that
  // happens later in tokeniseQuery during synonym expansion).
  const tokens = rawQuery
    .trim()
    .toLowerCase()
    .replace(/[،,.!?؟؛;:()[\]{}"'']/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  if (tokens.length === 0) return { corrected: rawQuery, changed: false };

  let changed = false;

  const out = await Promise.all(
    tokens.map(async (tok) => {
      const norm = normalizeArabic(tok);
      if (norm.length < 3) return tok; // too short to correct reliably
      try {
        const { data, error } = await supabase.rpc('correct_term', { q_norm: norm, p_threshold: 0.45 });
        if (error || !data || typeof data !== 'string') return tok;
        changed = true;
        return data;
      } catch {
        return tok;
      }
    })
  );

  return { corrected: out.join(' '), changed };
}
