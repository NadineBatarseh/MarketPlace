import { Router } from 'express';
import type { Request, Response } from 'express';
import { supabase } from '../supabase.js';
import { expandQueryDynamic } from './dynamicSynonyms.js';
import { isSentenceQuery, preprocessQuery } from './queryPreprocessor.js';

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

  for (const term of terms) {
    const trimmed = term.trim();
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

    // For Arabic words ≥ 5 chars, also emit a :* prefix variant to cover
    // morphological inflections not in the synonym dictionary.
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
 *   3. Build a to_tsquery OR expression from all expanded terms,
 *      with :* prefix variants for Arabic morphological coverage.
 *   4. Execute FTS via .textSearch() against the pre-built search_vector
 *      GIN-indexed column (see supabase/migrations/001_add_fts_index.sql).
 *   5. Apply optional shop / price filters.
 *   6. Fetch a wider window, then score in JS (title match +2, desc +1).
 *   7. Sort by score descending, slice the requested page.
 */
router.get('/', async (req: Request, res: Response) => {
  const rawQuery = (req.query.q as string ?? '').trim();

  if (!rawQuery) {
    return res.json({ ok: true, products: [], total: 0, page: 1, limit: 20, query: '', terms: [] });
  }

  const shopId   = req.query.shop_id  as string | undefined;
  const minPrice = parseFloat(req.query.min_price as string);
  const maxPrice = parseFloat(req.query.max_price as string);
  const page     = Math.max(1,  parseInt(req.query.page  as string) || 1);
  const limit    = Math.min(50, parseInt(req.query.limit as string) || 20);
  const offset   = (page - 1) * limit;

  // 1 & 2. Expand query with synonyms + optional LLM preprocessing for sentences
  let llmTerms: string[] = [];
  if (isSentenceQuery(rawQuery) && process.env.ANTHROPIC_API_KEY) {
    llmTerms = await preprocessQuery(rawQuery);
  }
  const terms = [...new Set([...await expandQueryDynamic(rawQuery), ...llmTerms])];

  if (terms.length === 0) {
    return res.json({ ok: true, products: [], total: 0, page, limit, query: rawQuery, terms });
  }

  // 3. Build FTS query — an OR-joined to_tsquery expression.
  //    Arabic terms ≥ 5 chars also get a :* prefix variant for morphology.
  console.log('[/api/search] terms:', terms);

  const ftsQuery = buildFtsQuery(terms);
  console.log('[/api/search] ftsQuery:', ftsQuery);

  if (!ftsQuery) {
    // All terms were < 2 chars — return empty rather than throw a tsquery error
    return res.json({ ok: true, products: [], total: 0, page, limit, query: rawQuery, terms });
  }

  // 4 & 5. Build base query with FTS + optional filters.
  //   No `type` option → PostgREST uses the `fts` operator → to_tsquery(config, query).
  //   This preserves the :* prefix operators in ftsQuery.
  //   Using type:'websearch' would call websearch_to_tsquery, which ignores :*.
  let dbQuery = supabase
    .from('products')
    .select('id, shop_id, title, description, price, image_urls, stock_Quantity', { count: 'exact' })
    .textSearch('search_vector', ftsQuery, { config: 'simple' });

  if (shopId)           dbQuery = dbQuery.eq('shop_id', shopId);
  if (!isNaN(minPrice)) dbQuery = dbQuery.gte('price', minPrice);
  if (!isNaN(maxPrice)) dbQuery = dbQuery.lte('price', maxPrice);

  // Fetch a wider window to allow JS-side relevance ranking, then paginate
  const fetchCap = Math.min(300, offset + limit * 4);
  dbQuery = dbQuery.range(0, fetchCap - 1);

  const { data, error, count } = await dbQuery;

  if (error) {
    console.error('[/api/search] Supabase error:', error);
    return res.status(500).json({ ok: false, error: error.message });
  }

  // 6. Score and rank in JS — title match +2, description match +1
  const lowerTerms = terms.map(t => t.toLowerCase());

  const scored = (data ?? []).map(product => {
    const titleText = (product.title ?? '').toLowerCase();
    const descText  = (product.description ?? '').toLowerCase();

    let score = 0;
    for (const term of lowerTerms) {
      if (titleText.includes(term)) score += 2;
      if (descText.includes(term))  score += 1;
    }
    return { ...product, _score: score };
  });

  scored.sort((a, b) => b._score - a._score);

  // 7. Paginate on the ranked set, strip internal score field
  const paginated = scored
    .slice(offset, offset + limit)
    .map(({ _score, ...p }) => p);

  return res.json({
    ok:       true,
    products: paginated,
    total:    count ?? scored.length,
    page,
    limit,
    query:    rawQuery,
    terms,
  });
});

export default router;
