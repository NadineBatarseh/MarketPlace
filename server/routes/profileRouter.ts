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

// Text fields a client is allowed to set. email/role live on public.Users and
// are intentionally NOT editable here; user_id/timestamps are server-controlled.
const TEXT_FIELDS = [
  'first_name',
  'last_name',
  'phone',
  'city',
  'street',
  'apartment',
  'postal_code',
] as const;

// Numeric fields (the delivery map pin). Handled separately from text because
// they need range validation, not string-trimming.
const COORD_FIELDS = ['latitude', 'longitude'] as const;

type TextField = (typeof TEXT_FIELDS)[number];
type CoordField = (typeof COORD_FIELDS)[number];

// Columns selected/returned to the client.
const SELECT = [...TEXT_FIELDS, ...COORD_FIELDS].join(', ');

type ProfilePayload = Partial<
  Record<TextField, string | null> & Record<CoordField, number | null>
>;

/** Empty profile shape returned when the user has no row yet (first visit). */
function emptyProfile(): ProfilePayload {
  return {
    first_name: '',
    last_name: '',
    phone: '',
    city: '',
    street: '',
    apartment: '',
    postal_code: '',
    latitude: null,
    longitude: null,
  };
}

/** Valid WGS-84 ranges, mirroring the DB check constraint. */
const COORD_RANGE: Record<CoordField, number> = { latitude: 90, longitude: 180 };

// ── GET /api/profile ──────────────────────────────────────────────────
router.get('/', requireCustomer, async (req: Request, res: Response) => {
  const { data, error } = await supabase
    .from('customer_profiles')
    .select(SELECT)
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
  for (const field of TEXT_FIELDS) {
    if (field in body) {
      const raw = body[field];
      updates[field] = typeof raw === 'string' ? raw.trim() || null : null;
    }
  }

  // Coordinates: accept a finite number in range, or null to clear the pin.
  // Anything else is rejected so a bad client can't poison the delivery routing.
  for (const field of COORD_FIELDS) {
    if (field in body) {
      const raw = body[field];
      if (raw === null) {
        updates[field] = null;
      } else if (typeof raw === 'number' && Number.isFinite(raw) && Math.abs(raw) <= COORD_RANGE[field]) {
        updates[field] = raw;
      } else {
        return res.status(400).json({ ok: false, error: `Invalid ${field}` });
      }
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
    .select(SELECT)
    .single();

  if (error) return res.status(500).json({ ok: false, error: error.message });

  return res.json({ ok: true, profile: { ...emptyProfile(), ...(data ?? {}) } });
});

export default router;
