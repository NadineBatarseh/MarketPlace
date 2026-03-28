import { Router } from 'express';
import type { Request, Response } from 'express';
import { supabase } from '../supabase.js';
import { expandQuery } from './synonyms.js';

const router = Router();

/** Escape PostgreSQL ilike wildcards: %, _, \ */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, c => `\\${c}`);
}

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
 *   2. Build a Supabase OR filter: each term is matched with ilike
 *      against both `title` and `description`.
 *   3. Apply optional shop / price filters.
 *   4. Fetch up to 3× the requested page window so we can rank in JS.
 *   5. Score each product by how many expanded terms appear in its text,
 *      with title matches weighted 2× vs. description matches.
 *   6. Sort by score descending, then slice the requested page.
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

  // 1. Expand query with synonyms
  const terms = expandQuery(rawQuery);

  if (terms.length === 0) {
    return res.json({ ok: true, products: [], total: 0, page, limit, query: rawQuery, terms });
  }

  // 2. Build ilike OR filter for title + description.
  //    For Arabic words ≥ 5 chars, also include a prefix (first 75% of chars,
  //    minimum 4 chars) to catch morphological variants not in the dictionary.
  //    We require both the source word ≥ 5 and the prefix result ≥ 4 to avoid
  //    short prefixes like "بلو" matching unrelated words (e.g. "بلون").
  const searchTerms = new Set<string>(terms);
  for (const term of terms) {
    const isArabic = /[\u0600-\u06FF]/.test(term);
    if (isArabic && term.length >= 5) {
      const prefix = term.slice(0, Math.ceil(term.length * 0.75));
      if (prefix.length >= 4) searchTerms.add(prefix);
    }
  }

  const orParts = [...searchTerms].flatMap(term => {
    const safe = escapeLike(term);
    return [`title.ilike.%${safe}%`, `description.ilike.%${safe}%`];
  });

  // 3. Build base query
  let dbQuery = supabase
    .from('products')
    .select('id, shop_id, title, description, price, image_urls, stock_Quantity', { count: 'exact' })
    .or(orParts.join(','));

  if (shopId)         dbQuery = dbQuery.eq('shop_id', shopId);
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

  // 4 & 5. Score and rank
  const lowerTerms = terms.map(t => t.toLowerCase());

  const scored = (data ?? []).map(product => {
    const titleText = (product.title ?? '').toLowerCase();
    const descText  = (product.description ?? '').toLowerCase();

    let score = 0;
    for (const term of lowerTerms) {
      if (titleText.includes(term)) score += 2; // title match is worth more
      if (descText.includes(term))  score += 1;
    }
    return { ...product, _score: score };
  });

  scored.sort((a, b) => b._score - a._score);

  // 6. Paginate on the ranked set, strip internal score field
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
