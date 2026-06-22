import supabase from './supabase';

/**
 * Client helpers for the admin Archive System.
 *
 * Archive/restore are admin-privileged actions enforced server-side
 * (server/routes/adminArchiveRouter.ts behind requireAdmin). The browser must
 * never write these tables directly with the anon key — RLS now denies it.
 * Every call carries the current Supabase access token as a Bearer header.
 */

export interface ArchiveResult {
  ok: boolean;
  error?: string;
  /** Set when a risk guard blocked the action (e.g. 'ACTIVE_ORDERS', 'ACTIVE_BATCHES'). */
  code?: string;
  /** Number of blocking active records, when code is set. */
  activeCount?: number;
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function post(path: string, body?: Record<string, unknown>): Promise<ArchiveResult> {
  try {
    const resp = await fetch(path, {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify(body ?? {}),
    });
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok || !json.ok) {
      return { ok: false, error: json.error ?? `Request failed (${resp.status})`, code: json.code, activeCount: json.activeCount };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Network error' };
  }
}

export type ApplicationType = 'merchant' | 'delivery';

export const archiveShop   = (shopId: string, opts?: { reason?: string; force?: boolean }) =>
  post(`/api/admin/shops/${shopId}/archive`, opts);
export const restoreShop   = (shopId: string) =>
  post(`/api/admin/shops/${shopId}/restore`);

export const archiveCourier = (courierId: string, opts?: { reason?: string; force?: boolean }) =>
  post(`/api/admin/couriers/${courierId}/archive`, opts);
export const restoreCourier = (courierId: string) =>
  post(`/api/admin/couriers/${courierId}/restore`);

export const archiveApplication = (type: ApplicationType, id: string | number, opts?: { reason?: string; force?: boolean }) =>
  post(`/api/admin/applications/${type}/${id}/archive`, opts);
export const restoreApplication = (type: ApplicationType, id: string | number) =>
  post(`/api/admin/applications/${type}/${id}/restore`);
