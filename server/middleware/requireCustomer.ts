import type { Request, Response, NextFunction } from 'express';
import { supabase } from '../supabase.js';

/**
 * Express middleware — gates a route to any authenticated user (customer).
 *
 * Reads `Authorization: Bearer <supabase-access-token>`, resolves the user via
 * the service-role client, and attaches the user id to `req.authUserId`.
 *
 * Unlike requireAdmin it does not check a role — ownership of the specific
 * resource (e.g. the order being paid) must be verified inside the handler.
 */
export async function requireCustomer(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    res.status(401).json({ ok: false, error: 'Authorization header is required (Bearer token)' });
    return;
  }

  const token = authHeader.slice(7);
  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    res.status(401).json({ ok: false, error: 'Invalid or expired session token' });
    return;
  }

  req.authUserId = user.id;
  next();
}

// Augment Express's Request type so `req.authUserId` is typed across the server.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      authUserId?: string;
    }
  }
}
