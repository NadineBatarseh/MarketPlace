import { Router } from 'express';
import type { Request, Response } from 'express';
import { supabase } from '../supabase.js';
import { requireCustomer } from '../middleware/requireCustomer.js';

/**
 * Profile router — the user's profile + default shipping address.
 *
 * Mounted at /api/profile. Like the orders router, all DB access runs here with
 * the service-role key and the user id is taken from the verified auth token
 * (req.authUserId), never from the request body — a client can only ever read or
 * write ITS OWN profile.
 *
 *   GET  /api/profile   → the current user's profile (an empty shell if none yet)
 *   PUT  /api/profile   → create-or-update (upsert) the current user's profile
 */
const router = Router();

// The fields a client is allowed to set. email/role live on public.Users and are
// intentionally NOT editable here; user_id/timestamps are server-controlled.
const EDITABLE_FIELDS = [
  'first_name',
  'last_name',
  'phone',
  'city',
  'street',
  'apartment',
  'postal_code',
] as const;

type ProfileField = (typeof EDITABLE_FIELDS)[number];
type ProfilePayload = Partial<Record<ProfileField, string | null>>;

/** Empty profile shape returned when the user has no row yet (first visit). */
function emptyProfile(): Record<ProfileField, string> {
  return {
    first_name: '',
    last_name: '',
    phone: '',
    city: '',
    street: '',
    apartment: '',
    postal_code: '',
  };
}

// ── GET /api/profile ──────────────────────────────────────────────────
router.get('/', requireCustomer, async (req: Request, res: Response) => {
  const { data, error } = await supabase
    .from('customer_profiles')
    .select('first_name, last_name, phone, city, street, apartment, postal_code')
    .eq('user_id', req.authUserId)
    .maybeSingle(); // no row yet is normal → null, not an error

  if (error) return res.status(500).json({ ok: false, error: error.message });

  // Always hand the client a complete object so its form can bind safely.
  return res.json({ ok: true, profile: { ...emptyProfile(), ...(data ?? {}) } });
});

// ── PUT /api/profile ──────────────────────────────────────────────────
router.put('/', requireCustomer, async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as ProfilePayload;

  // Whitelist: copy only known fields, trim strings, coerce empty → null.
  const updates: ProfilePayload = {};
  for (const field of EDITABLE_FIELDS) {
    if (field in body) {
      const raw = body[field];
      updates[field] = typeof raw === 'string' ? raw.trim() || null : null;
    }
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ ok: false, error: 'No profile fields provided' });
  }

  // Upsert: insert the row on first save, update it thereafter. user_id is the
  // primary key and comes from the verified token, so onConflict resolves to the
  // caller's own row.
  const { data, error } = await supabase
    .from('customer_profiles')
    .upsert({ user_id: req.authUserId, ...updates }, { onConflict: 'user_id' })
    .select('first_name, last_name, phone, city, street, apartment, postal_code')
    .single();

  if (error) return res.status(500).json({ ok: false, error: error.message });

  return res.json({ ok: true, profile: { ...emptyProfile(), ...(data ?? {}) } });
});

export default router;
