import supabase from './supabase';

/**
 * Admin client helpers for the "Delivery Issues" queue
 * (server/routes/adminDeliveryIssuesRouter.ts, behind requireAdmin).
 */

export interface DeliveryIssue {
  id: number;
  order_id: number;
  shipment_id: string | null;
  note: string | null;
  reported_at: string;
  customer_name: string | null;
  shipment_status: string | null;
}

interface ListResult {
  ok: boolean;
  error?: string;
  issues: DeliveryIssue[];
}

interface ActionResult {
  ok: boolean;
  error?: string;
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export async function fetchDeliveryIssues(): Promise<ListResult> {
  try {
    const resp = await fetch('/api/admin/delivery-issues', { headers: await authHeaders() });
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok || !json.ok) {
      return { ok: false, error: json.error ?? `Request failed (${resp.status})`, issues: [] };
    }
    return { ok: true, issues: json.issues ?? [] };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Network error', issues: [] };
  }
}

export async function resolveDeliveryIssue(id: number): Promise<ActionResult> {
  try {
    const resp = await fetch(`/api/admin/delivery-issues/${id}/resolve`, {
      method: 'POST',
      headers: await authHeaders(),
    });
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok || !json.ok) {
      return { ok: false, error: json.error ?? `Request failed (${resp.status})` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Network error' };
  }
}
