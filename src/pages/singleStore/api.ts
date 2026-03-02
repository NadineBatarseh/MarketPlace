export async function apiFetch<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg = (body as { error?: string }).error;
    throw new Error(msg || (res.status === 404 ? "غير موجود (404)" : `خطأ ${res.status}`));
  }
  const json = (await res.json()) as { ok: boolean; error?: string } & T;
  if (!json.ok) throw new Error(json.error || "استجابة غير صالحة من الخادم");
  return json;
}
