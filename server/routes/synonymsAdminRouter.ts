import { Router } from 'express';
import type { Request, Response } from 'express';
import { supabase } from '../supabase.js';
import { requireAdmin } from '../middleware/requireAdmin.js';

/**
 * Synonyms Admin router — review and govern the search_synonyms dictionary.
 *
 * The search query expander (server/search/dynamicSynonyms.ts) caches Groq-
 * generated synonyms. Generation now validates candidates against the catalog
 * and tags rows with source/status/expires_at, but humans still need a way to
 * inspect, correct, approve, reject, or delete entries. That is this router.
 *
 * Mounted at /api/admin/synonyms. Every route is behind requireAdmin (the
 * service-role client bypasses RLS, so writes succeed here while a direct client
 * stays denied by RLS).
 *
 * Status semantics (see search_synonyms_governance.sql):
 *   active   — used by search.
 *   pending  — awaiting review (still usable unless you choose otherwise).
 *   rejected — blocklist: the expander returns the raw keyword only and never
 *              regenerates this keyword.
 *
 * Endpoints:
 *   GET    /api/admin/synonyms?status=&q=&limit=&offset=   list / filter
 *   PATCH  /api/admin/synonyms/:keyword                    body: { similar_words?, status? }
 *   POST   /api/admin/synonyms/:keyword/approve            -> status 'active'
 *   POST   /api/admin/synonyms/:keyword/reject             -> status 'rejected' (blocklist)
 *   DELETE /api/admin/synonyms/:keyword                    remove the row
 */
const router = Router();

router.use(requireAdmin);

const VALID_STATUS = ['active', 'pending', 'rejected'] as const;
type SynonymStatus = (typeof VALID_STATUS)[number];

// GET / — list with optional status filter and keyword search.
router.get('/', async (req: Request, res: Response) => {
  const status = req.query.status as string | undefined;
  const q      = (req.query.q as string | undefined)?.trim();
  const limit  = Math.min(200, parseInt(req.query.limit as string) || 50);
  const offset = Math.max(0, parseInt(req.query.offset as string) || 0);

  let query = supabase
    .from('search_synonyms')
    .select('keyword, similar_words, source, status, confidence, created_at, updated_at, expires_at, usage_count, last_used_at, zero_result_count', { count: 'exact' })
    .order('updated_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (status && (VALID_STATUS as readonly string[]).includes(status)) {
    query = query.eq('status', status);
  }
  if (q) query = query.ilike('keyword', `%${q}%`);

  const { data, error, count } = await query;
  if (error) return res.status(500).json({ ok: false, error: error.message });

  return res.json({ ok: true, synonyms: data ?? [], total: count ?? 0, limit, offset });
});

// PATCH /:keyword — edit similar_words and/or status. Manual edits become
// source='manual' and never expire (TTL cleared).
router.patch('/:keyword', async (req: Request, res: Response) => {
  const keyword = req.params.keyword;
  const { similar_words, status } = req.body ?? {};

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString(), source: 'manual', expires_at: null };

  if (similar_words !== undefined) {
    if (!Array.isArray(similar_words) || !similar_words.every((w) => typeof w === 'string')) {
      return res.status(400).json({ ok: false, error: 'similar_words must be an array of strings' });
    }
    patch.similar_words = similar_words.map((w: string) => w.trim()).filter(Boolean);
  }

  if (status !== undefined) {
    if (!(VALID_STATUS as readonly string[]).includes(status)) {
      return res.status(400).json({ ok: false, error: `status must be one of ${VALID_STATUS.join(', ')}` });
    }
    patch.status = status as SynonymStatus;
  }

  const { data, error } = await supabase
    .from('search_synonyms')
    .update(patch)
    .eq('keyword', keyword)
    .select()
    .maybeSingle();

  if (error) return res.status(500).json({ ok: false, error: error.message });
  if (!data) return res.status(404).json({ ok: false, error: 'keyword not found' });
  return res.json({ ok: true, synonym: data });
});

// POST /:keyword/approve — mark active.
router.post('/:keyword/approve', async (req: Request, res: Response) => {
  const { data, error } = await supabase
    .from('search_synonyms')
    .update({ status: 'active', updated_at: new Date().toISOString() })
    .eq('keyword', req.params.keyword)
    .select()
    .maybeSingle();

  if (error) return res.status(500).json({ ok: false, error: error.message });
  if (!data) return res.status(404).json({ ok: false, error: 'keyword not found' });
  return res.json({ ok: true, synonym: data });
});

// POST /:keyword/reject — blocklist: search uses raw keyword only and the
// expander never regenerates it. Clear the TTL so it stays rejected.
router.post('/:keyword/reject', async (req: Request, res: Response) => {
  const { data, error } = await supabase
    .from('search_synonyms')
    .update({ status: 'rejected', expires_at: null, updated_at: new Date().toISOString() })
    .eq('keyword', req.params.keyword)
    .select()
    .maybeSingle();

  if (error) return res.status(500).json({ ok: false, error: error.message });
  if (!data) return res.status(404).json({ ok: false, error: 'keyword not found' });
  return res.json({ ok: true, synonym: data });
});

// DELETE /:keyword — remove entirely. (Note: a deleted Groq keyword may be
// regenerated on the next search; use reject to permanently suppress instead.)
router.delete('/:keyword', async (req: Request, res: Response) => {
  const { error } = await supabase
    .from('search_synonyms')
    .delete()
    .eq('keyword', req.params.keyword);

  if (error) return res.status(500).json({ ok: false, error: error.message });
  return res.json({ ok: true });
});

export default router;
