import { Router } from 'express';
import type { Request, Response } from 'express';
import { supabase } from '../supabase.js';
import { expandQueryDynamic } from './dynamicSynonyms.js';
import { isSentenceQuery, preprocessQuery } from './queryPreprocessor.js';
import { normalizeArabic } from './normalizeArabic.js';
import { correctQuery } from './spellCorrect.js';

const router = Router();

// ── FTS helpers ───────────────────────────────────────────────────────────────

/** Escape single-quotes inside a tsquery lexeme by doubling them. */
function sanitiseLexeme(term: string): string {
  return term.replace(/'/g, "''");
}

/**
 * Convert expanded terms[] into a raw to_tsquery OR expression.
 *
 * Why to_tsquery (not websearch_to_tsquery):
 *   Only to_tsquery supports the :* prefix operator, which is needed
 *   for Arabic morphological coverage (e.g. 'بلوز':* matches بلوزة).
 *
 * Multi-word terms (containing spaces) are split into individual words
 * because to_tsquery does not allow spaces inside quoted lexemes.
 *
 * Terms shorter than 2 characters are dropped — the 'simple' config
 * rejects 1-char lexemes at query parse time with a runtime error.
 *
 * Returns null when no valid terms remain (caller should return empty results).
 */
function buildFtsQuery(terms: string[]): string | null {
  const parts: string[] = [];
  const seen = new Set<string>();

  for (const rawTerm of terms) {
    // Normalize each lexeme the SAME way the index is normalized
    // (souq_normalize / normalizeArabic) so query terms match stored lexemes.
    const trimmed = normalizeArabic(rawTerm).trim();
    if (trimmed.length < 2) continue;

    // Multi-word term: split on whitespace and add each word individually.
    // to_tsquery does not support spaces inside single-quoted lexemes.
    const subWords = trimmed.split(/\s+/);
    if (subWords.length > 1) {
      for (const word of subWords) {
        if (word.length >= 2 && !seen.has(word)) {
          seen.add(word);
          parts.push(`'${sanitiseLexeme(word)}'`);
        }
      }
      continue;
    }

    // Single-word term
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    parts.push(`'${sanitiseLexeme(trimmed)}'`);

    // Last-resort fallback: for Arabic words ≥ 5 chars, also emit a :* prefix
    // variant for inflections not covered by normalization or the synonym
    // dictionary. Normalization + curated/Groq synonyms + the trigram fuzzy tier
    // now do the heavy lifting, so this prefix is secondary.
    // Minimum prefix length 4 avoids overly broad matches.
    const isArabic = /[\u0600-\u06FF]/.test(trimmed);
    if (isArabic && trimmed.length >= 5) {
      const prefix = trimmed.slice(0, Math.ceil(trimmed.length * 0.75));
      const prefixKey = prefix + ':*';
      if (prefix.length >= 4 && !seen.has(prefixKey)) {
        seen.add(prefixKey);
        parts.push(`'${sanitiseLexeme(prefix)}':*`);
      }
    }
  }

  return parts.length > 0 ? parts.join(' | ') : null;
}

// ── Route ─────────────────────────────────────────────────────────────────────

/**
 * GET /api/search
 *
 * Query params:
 *   q          — search string (required)
 *   shop_id    — filter to a specific shop UUID (optional)
 *   min_price  — minimum price inclusive (optional)
 *   max_price  — maximum price inclusive (optional)
 *   page       — 1-based page number (default 1)
 *   limit      — results per page, max 50 (default 20)
 *
 * Response:
 *   { ok, products, total, page, limit, query, terms }
 *
 * Algorithm:
 *   1. Expand the raw query using the synonym dictionary.
 *   2. Optionally enrich with Claude Haiku for sentence queries.
 *   3. Build a to_tsquery OR expression from all expanded terms (normalized via
 *      normalizeArabic so lexemes match the normalized search_vector), with a
 *      secondary :* prefix variant for long Arabic words.
 *   4. Call the search_products() RPC, which does tiered matching, ts_rank_cd +
 *      business-signal ranking, trigram fuzzy fallback (typo tolerance), the
 *      shop/price/city filters, and pagination — all in one DB scan.
 *      (see supabase/migrations/search_products_rpc.sql)
 *   5. Reshape rows to the response contract (nest shop fields under `shops`).
 */
/**
 * GET /api/search/suggestions
 *
 * Lightweight autocomplete for the header search box. Returns distinct product
 * titles matching the partial query (normalized prefix / contains / trigram
 * fuzzy), ranked by closeness. Powered by the search_suggestions() RPC.
 *
 * Query params: q (partial string), limit (default 8, max 10)
 * Response: { ok, suggestions: string[] }
 */
router.get('/suggestions', async (req: Request, res: Response) => {
  const rawQuery = (req.query.q as string ?? '').trim();
  const limit    = Math.min(10, Math.max(1, parseInt(req.query.limit as string) || 8));
  const qNorm    = normalizeArabic(rawQuery);

  if (qNorm.length < 2) {
    return res.json({ ok: true, suggestions: [] });
  }

  const { data, error } = await supabase.rpc('search_suggestions', { q_norm: qNorm, p_limit: limit });

  if (error) {
    console.error('[/api/search/suggestions] RPC error:', error);
    return res.status(500).json({ ok: false, error: error.message, suggestions: [] });
  }

  const suggestions = ((data ?? []) as { suggestion: string }[]).map(r => r.suggestion);
  return res.json({ ok: true, suggestions });
});

router.get('/', async (req: Request, res: Response) => {
  const rawQuery = (req.query.q as string ?? '').trim();

  if (!rawQuery) {
    return res.json({ ok: true, products: [], total: 0, page: 1, limit: 20, query: '', terms: [] });
  }

  const shopId     = req.query.shop_id  as string | undefined;
  const minPrice   = parseFloat(req.query.min_price as string);
  const maxPrice   = parseFloat(req.query.max_price as string);
  const page       = Math.max(1,  parseInt(req.query.page  as string) || 1);
  const limit      = Math.min(50, parseInt(req.query.limit as string) || 20);
  const offset     = (page - 1) * limit;
  const citiesRaw  = req.query.cities as string | undefined;
  const cities     = citiesRaw ? citiesRaw.split(',').map(c => c.trim()).filter(Boolean) : [];

  // 1, 2 & 3. Spell-correct typos to real catalog words, then expand synonyms on
  //   BOTH the original and the corrected query (so a misspelled word still pulls
  //   the right word's synonyms), plus optional LLM sentence terms.
  let llmTerms: string[] = [];
  if (isSentenceQuery(rawQuery) && process.env.ANTHROPIC_API_KEY) {
    llmTerms = await preprocessQuery(rawQuery);
  }

  const { corrected, changed } = await correctQuery(rawQuery);
  if (changed) console.log('[/api/search] spell-corrected:', rawQuery, '→', corrected);

  const [baseExpansion, correctedExpansion] = await Promise.all([
    expandQueryDynamic(rawQuery),
    changed ? expandQueryDynamic(corrected) : Promise.resolve<string[]>([]),
  ]);
  const terms = [...new Set([...baseExpansion, ...correctedExpansion, ...llmTerms])];

  if (terms.length === 0) {
    return res.json({ ok: true, products: [], total: 0, page, limit, query: rawQuery, terms });
  }

  // 3. Build FTS query — an OR-joined to_tsquery expression.
  //    Arabic terms ≥ 5 chars also get a :* prefix variant for morphology.
  console.log('[/api/search] terms:', terms);

  const ftsQuery = buildFtsQuery(terms);
  const qNorm    = normalizeArabic(rawQuery);
  console.log('[/api/search] ftsQuery:', ftsQuery, '| qNorm:', qNorm);

  if (!ftsQuery && !qNorm) {
    // Nothing matchable (all terms < 2 chars and empty normalized query) —
    // return empty rather than calling the RPC with no criteria.
    return res.json({ ok: true, products: [], total: 0, page, limit, query: rawQuery, terms });
  }

  // 4 & 5 & 6. Single RPC does matching + ranking + fuzzy fallback + filters +
  //   pagination in one DB scan (see supabase/migrations/search_products_rpc.sql):
  //     - tier 1: FTS hit on the weighted search_vector, ranked by ts_rank_cd
  //       plus business signals (exact-title, in-stock, discount, recency).
  //     - tier 2: trigram fuzzy hit on the title (typo tolerance), always ranked
  //       below tier 1.
  //   total_count is a window count so `total` stays accurate for pagination.
  const { data, error } = await supabase.rpc('search_products', {
    q_query:     ftsQuery ?? '',
    q_norm:      qNorm,
    p_shop_id:   shopId ?? null,
    p_min_price: isNaN(minPrice) ? null : minPrice,
    p_max_price: isNaN(maxPrice) ? null : maxPrice,
    p_cities:    cities.length > 0 ? cities : null,
    p_limit:     limit,
    p_offset:    offset,
  });

  if (error) {
    console.error('[/api/search] Supabase RPC error:', error);
    return res.status(500).json({ ok: false, error: error.message });
  }

  const rows  = (data ?? []) as any[];
  const total = rows.length > 0 ? Number(rows[0].total_count) : 0;

  // Reshape to the existing response contract: nest shop fields under `shops`,
  // drop the ranking/internal columns so the frontend needs no changes.
  const products = rows.map(({ shop_name, shop_location, rank, match_tier, total_count, ...p }) => ({
    ...p,
    shops: { name: shop_name, location: shop_location },
  }));

  return res.json({
    ok:       true,
    products,
    total,
    page,
    limit,
    query:    rawQuery,
    terms,
  });
});

export default router;
