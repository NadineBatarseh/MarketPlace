import type { Request, Response, NextFunction } from 'express';
import { supabase } from '../supabase.js';

/**
 * Express middleware — gates a route to authenticated admins only.
 *
 * Reads the `Authorization: Bearer <supabase-access-token>` header, resolves the
 * user via the service-role client, then verifies `public.Users.role === 'admin'`.
 *
 * On success it attaches the admin's user id to `req.adminUserId` (used for
 * `archived_by` auditing). On failure it responds 401/403 and does NOT call next.
 *
 * This is the DB-level authority that RoleGuard (UI-only) cannot provide. All
 * admin-privileged server endpoints must sit behind it.
 */
export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    res.status(401).json({ ok: false, error: 'Authorization header is required (Bearer token)' });
    return;
  }

  const token = authHeader.slice(7);
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);

  if (authErr || !user) {
    res.status(401).json({ ok: false, error: 'Invalid or expired session token' });
    return;
  }

  const { data: row, error: roleErr } = await supabase
    .from('Users')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle();

  if (roleErr) {
    res.status(500).json({ ok: false, error: roleErr.message });
    return;
  }

  if (row?.role?.trim() !== 'admin') {
    res.status(403).json({ ok: false, error: 'Admin privileges are required' });
    return;
  }

  req.adminUserId = user.id;
  next();
}

// Augment Express's Request type so `req.adminUserId` is typed across the server.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      adminUserId?: string;
    }
  }
}
