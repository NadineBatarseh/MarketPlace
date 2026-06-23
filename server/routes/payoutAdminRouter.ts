import { Router } from 'express';
import type { Request, Response } from 'express';
import { supabase } from '../supabase.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { loadPaymentConfig } from '../lib/paymentConfig.js';

/**
 * Marketplace payouts admin API (mounted /api/payments/payouts, requireAdmin).
 *
 * Vendor money moves via PayTabs Split Payout at pay-in (see paytabsRouter); this API is
 * read/reporting + the editable fee knobs:
 *   GET  /config   → read the admin-editable fee config
 *   PUT  /config   → update it (validated, audited via updated_by)
 *   GET  /ledger   → the payouts ledger (per-shop transfer status) for admin views
 */
const router = Router();

/* ─────────────────────────── payment config (admin-editable knobs) ─────────────────────────── */

// Editable fields → validation bounds. Keys are the payment_config column names.
const CONFIG_FIELDS: Record<string, { min: number; integer?: boolean }> = {
  platform_commission_rate: { min: 0 },
  delivery_fee:             { min: 0 },
};

router.get('/config', requireAdmin, async (_req: Request, res: Response) => {
  const { data, error } = await supabase
    .from('payment_config')
    .select('*')
    .eq('id', 1)
    .maybeSingle();

  if (error) return res.status(500).json({ ok: false, error: error.message });
  if (!data) return res.status(404).json({ ok: false, error: 'payment_config row (id=1) not found — run the migration' });
  return res.json({ ok: true, config: data });
});

router.put('/config', requireAdmin, async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const patch: Record<string, number> = {};

  // Accept only known fields; validate each is a number within bounds.
  for (const [key, bounds] of Object.entries(CONFIG_FIELDS)) {
    if (body[key] === undefined || body[key] === null) continue;
    const v = Number(body[key]);
    if (Number.isNaN(v)) return res.status(400).json({ ok: false, error: `${key} must be a number` });
    if (v < bounds.min) {
      return res.status(400).json({ ok: false, error: `${key} must be at least ${bounds.min}` });
    }
    if (bounds.integer && !Number.isInteger(v)) {
      return res.status(400).json({ ok: false, error: `${key} must be a whole number` });
    }
    patch[key] = v;
  }

  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ ok: false, error: 'No valid config fields provided' });
  }

  const { data, error } = await supabase
    .from('payment_config')
    .update({ ...patch, updated_at: new Date().toISOString(), updated_by: req.adminUserId ?? null })
    .eq('id', 1)
    .select('*')
    .single();

  if (error) return res.status(500).json({ ok: false, error: error.message });

  // Refresh the in-memory PC so changes take effect immediately (sweep interval
  // applies on next restart, as the scheduler interval is set once at startup).
  await loadPaymentConfig();

  return res.json({ ok: true, config: data });
});

/* ─────────────────────────── sales / earnings ledger ─────────────────────────── */
/**
 * GET /ledger → the full payouts ledger for the admin "sales statement" page.
 *
 * Query params (all optional):
 *   type=shop|courier|platform   filter by payee kind
 *   status=pending|queued|…       filter by payout status
 *   from / to                     ISO dates (created_at range, inclusive)
 *   q                             case-insensitive payee-name search (resolved server-side)
 *
 * Returns the matching rows (payee name resolved), per-payee group totals, and an
 * overall summary. Names live in shops/couriers (payee_id is polymorphic, so there's
 * no FK to embed) — they're resolved with two batched lookups.
 */
const LEDGER_ROW_CAP = 5000; // safety cap; logged implicitly via rows.length vs total

router.get('/ledger', requireAdmin, async (req: Request, res: Response) => {
  const { type, status, from, to, q } = req.query as Record<string, string | undefined>;

  let query = supabase
    .from('payouts')
    .select('id, order_id, payment_id, payee_type, payee_id, amount, currency, status, note, paid_at, failure_reason, created_at')
    .order('created_at', { ascending: false })
    .limit(LEDGER_ROW_CAP);

  if (type && ['shop', 'courier', 'platform'].includes(type)) query = query.eq('payee_type', type);
  if (status) query = query.eq('status', status);
  if (from) query = query.gte('created_at', from);
  if (to) query = query.lte('created_at', to);

  const { data: payouts, error } = await query;
  if (error) return res.status(500).json({ ok: false, error: error.message });

  const rows = payouts ?? [];

  // Resolve payee names in two batched lookups.
  const shopIds = [...new Set(rows.filter(r => r.payee_type === 'shop' && r.payee_id).map(r => r.payee_id))] as string[];
  const courierIds = [...new Set(rows.filter(r => r.payee_type === 'courier' && r.payee_id).map(r => r.payee_id))] as string[];

  const [shopsRes, couriersRes] = await Promise.all([
    shopIds.length ? supabase.from('shops').select('shop_id, name').in('shop_id', shopIds) : Promise.resolve({ data: [] as any[] }),
    courierIds.length ? supabase.from('couriers').select('id, name').in('id', courierIds) : Promise.resolve({ data: [] as any[] }),
  ]);

  const shopName = new Map((shopsRes.data ?? []).map((s: any) => [s.shop_id, s.name]));
  const courierName = new Map((couriersRes.data ?? []).map((c: any) => [c.id, c.name]));

  const nameOf = (r: any): string =>
    r.payee_type === 'shop' ? (shopName.get(r.payee_id) ?? 'متجر محذوف')
    : r.payee_type === 'courier' ? (courierName.get(r.payee_id) ?? 'مندوب محذوف')
    : 'المنصّة';

  let named = rows.map(r => ({ ...r, payee_name: nameOf(r) }));

  // Name search is applied after resolution (names aren't in the payouts table).
  if (q && q.trim()) {
    const needle = q.trim().toLowerCase();
    named = named.filter(r => r.payee_name.toLowerCase().includes(needle));
  }

  // Per-payee group totals.
  const groupMap = new Map<string, any>();
  for (const r of named) {
    const key = `${r.payee_type}:${r.payee_id ?? 'platform'}`;
    let g = groupMap.get(key);
    if (!g) {
      g = { payee_type: r.payee_type, payee_id: r.payee_id, payee_name: r.payee_name, total: 0, distributed_total: 0, held_total: 0, count: 0 };
      groupMap.set(key, g);
    }
    const amt = Number(r.amount ?? 0);
    g.total += amt;
    g.count += 1;
    if (r.status === 'distributed') g.distributed_total += amt;
    else if (r.status === 'platform_held') g.held_total += amt;
  }
  const round = (n: number) => Math.round(n * 100) / 100;
  const groups = [...groupMap.values()]
    .map(g => ({ ...g, total: round(g.total), distributed_total: round(g.distributed_total), held_total: round(g.held_total) }))
    .sort((a, b) => b.total - a.total);

  // Overall summary.
  const summary = {
    merchants_total: 0, couriers_total: 0, platform_total: 0,
    distributed: 0, held: 0, count: named.length,
  };
  for (const r of named) {
    const amt = Number(r.amount ?? 0);
    if (r.payee_type === 'shop') summary.merchants_total += amt;
    else if (r.payee_type === 'courier') summary.couriers_total += amt;
    else summary.platform_total += amt;
    if (r.status === 'distributed') summary.distributed += amt;
    else if (r.status === 'platform_held') summary.held += amt;
  }
  for (const k of Object.keys(summary) as (keyof typeof summary)[]) {
    if (k !== 'count') summary[k] = round(summary[k]);
  }

  // Total amount actually collected from customers in the same window (from payments).
  let customer_paid_total = 0;
  {
    let pq = supabase.from('payments').select('amount').eq('status', 'paid');
    if (from) pq = pq.gte('created_at', from);
    if (to) pq = pq.lte('created_at', to);
    const { data: pays } = await pq;
    customer_paid_total = round((pays ?? []).reduce((s, p: any) => s + Number(p.amount ?? 0), 0));
  }

  return res.json({
    ok: true,
    rows: named,
    groups,
    summary: { ...summary, customer_paid_total },
    capped: rows.length >= LEDGER_ROW_CAP,
  });
});

export default router;
