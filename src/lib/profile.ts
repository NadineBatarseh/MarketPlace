import supabase from './supabase';

/**
 * Shared customer-profile model + API helpers.
 *
 * Used by BOTH the Profile Settings page and the Checkout page so they agree on
 * the exact field set and on how to talk to /api/profile. The frontend uses
 * camelCase; the API/DB use snake_case, so we translate at this boundary only.
 */

// camelCase shape the React components bind to.
export interface ProfileData {
  firstName: string;
  lastName: string;
  phone: string;
  city: string;
  street: string;     // street name + house number (main address line)
  apartment: string;  // apartment / floor (optional)
  postalCode: string;
  // Exact delivery pin captured from the Address Book map. null = no pin yet.
  latitude: number | null;
  longitude: number | null;
}

// snake_case shape exchanged with the API (matches the customer_profiles table).
interface ApiProfile {
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  city?: string | null;
  street?: string | null;
  apartment?: string | null;
  postal_code?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

/** A fully-blank profile — safe defaults so inputs are always controlled. */
export function emptyProfile(): ProfileData {
  return {
    firstName: '', lastName: '', phone: '', city: '', street: '', apartment: '',
    postalCode: '', latitude: null, longitude: null,
  };
}

/** API (snake_case, nullable) → component (camelCase). Text always strings;
 *  coordinates stay numeric (or null when unset). */
function fromApi(api: ApiProfile | null | undefined): ProfileData {
  return {
    firstName:  api?.first_name  ?? '',
    lastName:   api?.last_name   ?? '',
    phone:      api?.phone       ?? '',
    city:       api?.city        ?? '',
    street:     api?.street      ?? '',
    apartment:  api?.apartment   ?? '',
    postalCode: api?.postal_code ?? '',
    latitude:   api?.latitude  ?? null,
    longitude:  api?.longitude ?? null,
  };
}

/** Component (camelCase) → API (snake_case). */
function toApi(p: ProfileData): ApiProfile {
  return {
    first_name:  p.firstName,
    last_name:   p.lastName,
    phone:       p.phone,
    city:        p.city,
    street:      p.street,
    apartment:   p.apartment,
    postal_code: p.postalCode,
    latitude:    p.latitude,
    longitude:   p.longitude,
  };
}

/** Build the auth headers the API expects (Bearer <supabase access token>). */
async function authHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

/** GET /api/profile — load the signed-in user's saved profile. */
export async function fetchProfile(): Promise<ProfileData> {
  const resp = await fetch('/api/profile', { headers: await authHeaders() });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok || !json.ok) throw new Error(json.error || 'تعذّر تحميل بيانات الملف الشخصي');
  return fromApi(json.profile);
}

/** PUT /api/profile — save (upsert) the user's profile. Returns the saved data. */
export async function saveProfile(profile: ProfileData): Promise<ProfileData> {
  const resp = await fetch('/api/profile', {
    method: 'PUT',
    headers: await authHeaders(),
    body: JSON.stringify(toApi(profile)),
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok || !json.ok) throw new Error(json.error || 'تعذّر حفظ التعديلات');
  return fromApi(json.profile);
}

/**
 * Deep-equality check for two profiles. Used by checkout to decide whether the
 * user has changed anything vs. the data we originally auto-filled.
 */
export function profilesEqual(a: ProfileData, b: ProfileData): boolean {
  return (Object.keys(a) as Array<keyof ProfileData>).every((k) => a[k] === b[k]);
}
