import { supabase } from '../supabase.js';
import { expandKeywords } from './synonyms.js';

// Palestinian city name variants (handles free-text inconsistencies in shop registration)
const CITY_VARIANTS: Record<string, string[]> = {
  'رام الله':  ['رام الله', 'البيرة', 'Ramallah'],
  'القدس':     ['القدس', 'Jerusalem'],
  'الخليل':    ['الخليل', 'Hebron'],
  'نابلس':     ['نابلس', 'Nablus'],
  'بيت لحم':  ['بيت لحم', 'Bethlehem'],
  'جنين':      ['جنين', 'Jenin'],
  'طولكرم':    ['طولكرم', 'Tulkarm'],
  'قلقيلية':   ['قلقيلية', 'Qalqilya'],
  'أريحا':     ['أريحا', 'Jericho'],
  'سلفيت':    ['سلفيت', 'Salfit'],
  'طوباس':     ['طوباس', 'Tubas'],
};

function buildLocationVariants(location: string): string[] {
  const lower = location.trim().toLowerCase();
  for (const [key, variants] of Object.entries(CITY_VARIANTS)) {
    if (variants.some(v => lower.includes(v.toLowerCase()) || v.toLowerCase().includes(lower))) {
      return variants;
    }
  }
  return [location.trim()];
}

// ─── SCHEMAS (sent to Claude API) ──────────────────────────────────────────

export const TOOL_SCHEMAS = [
  {
    name: 'search_products',
    description: `Search for products on the Souq Link marketplace.
Use this when the user wants to find products by type, color, price, or location.
Always call this tool first instead of answering directly.`,
    input_schema: {
      type: 'object' as const,
      properties: {
        keywords: {
          type: 'array',
          items: { type: 'string' },
          description: 'Product type keywords in Arabic and/or English (synonym expansion is automatic)',
        },
        color: {
          type: 'string',
          description: 'Color in Arabic: اسود، ابيض، احمر، ازرق، اخضر، رمادي، بني',
        },
        location: {
          type: 'string',
          description: 'City or area in Arabic (e.g. رام الله، القدس، الخليل، بيت لحم)',
        },
        store_name: {
          type: 'string',
          description: 'Store name if the user mentioned a specific shop',
        },
        price_sort: {
          type: 'string',
          enum: ['asc', 'desc'],
          description: '"asc" = cheapest first (رخيص/اقتصادي), "desc" = most expensive first (غالي/فاخر)',
        },
        max_price: {
          type: 'number',
          description: 'Maximum price in ILS if the user said a specific number',
        },
        limit: {
          type: 'number',
          description: 'Max results (default 20, max 40)',
        },
      },
      required: [],
    },
  },
  {
    name: 'search_stores',
    description: `Search for stores/shops on the Souq Link marketplace.
Use this when the user asks about a specific store, or when you want to find stores in a location.
Can be called alongside search_products.`,
    input_schema: {
      type: 'object' as const,
      properties: {
        name: {
          type: 'string',
          description: 'Store name to search for',
        },
        location: {
          type: 'string',
          description: 'City or area (e.g. رام الله، القدس)',
        },
      },
      required: [],
    },
  },
];

// ─── EXECUTORS ─────────────────────────────────────────────────────────────

export interface ProductResult {
  id: string;
  title: string;
  description: string | null;
  price: number | null;
  image_urls: string | null;
  shop_id: string;
  shop_name?: string;
  shop_location?: string;
}

export interface StoreResult {
  shop_id: string;
  name: string;
  location: string | null;
  shopLogo: string | null;
  avg_rating: number | null;
  review_count: number;
}

export async function executeSearchProducts(input: {
  keywords?: string[];
  color?: string;
  location?: string;
  store_name?: string;
  price_sort?: 'asc' | 'desc';
  max_price?: number;
  limit?: number;
}): Promise<{ products: ProductResult[]; total: number }> {
  const limit = Math.min(input.limit ?? 20, 40);

  const rawKeywords = input.keywords ?? [];
  const allKeywords = expandKeywords(rawKeywords);
  console.log('[search] input:', JSON.stringify(input));
  console.log('[search] expanded keywords:', allKeywords);

  // Pre-filter shops by status (always required)
  let shopIds: string[] | null = null;
  if (input.store_name || input.location) {
    // Build location variants to handle free-text inconsistencies (e.g. "رام الله" vs "رام الله والبيرة")
    const locationVariants = input.location ? buildLocationVariants(input.location) : [];

    let shopQ = supabase.from('shops').select('shop_id').eq('status', 'approved');
    if (input.store_name) shopQ = shopQ.ilike('name', `%${input.store_name}%`);
    if (locationVariants.length > 0) {
      const locFilter = locationVariants.map(v => `location.ilike.%${v}%`).join(',');
      shopQ = shopQ.or(locFilter);
    }
    const { data: shops } = await shopQ.limit(50);
    shopIds = (shops ?? []).map((s: any) => s.shop_id);
    console.log('[search] shops found for location:', shopIds.length);
    // If location specified but no matching shops found, search without location restriction
    // so users still get relevant products (AI answer will explain no results in that area)
    if (shopIds.length === 0 && !input.store_name) shopIds = null;
    if (shopIds !== null && shopIds.length === 0) return { products: [], total: 0 };
  }

  let q = supabase
    .from('products')
    .select('id, title, description, price, image_urls, shop_id, shops!inner(name, location)', { count: 'exact' });

  if (shopIds) q = q.in('shop_id', shopIds);

  const searchTerms = [
    ...allKeywords,
    ...(input.color ? [input.color] : []),
  ];
  if (searchTerms.length > 0) {
    const orFilter = searchTerms
      .flatMap(t => [`title.ilike.%${t}%`, `description.ilike.%${t}%`])
      .join(',');
    console.log('[search] orFilter:', orFilter);
    q = q.or(orFilter);
  }

  if (input.max_price) q = q.lte('price', input.max_price);
  if (input.price_sort) q = q.order('price', { ascending: input.price_sort === 'asc' });
  else q = q.order('created_at', { ascending: false });

  const { data, count, error } = await q.limit(limit);
  console.log('[search] result count:', count, '| error:', error?.message);

  let products: ProductResult[] = (data ?? []).map((p: any) => ({
    id:            p.id,
    title:         p.title,
    description:   p.description,
    price:         p.price,
    image_urls:    Array.isArray(p.image_urls) ? p.image_urls[0] : p.image_urls,
    shop_id:       p.shop_id,
    shop_name:     p.shops?.name,
    shop_location: p.shops?.location,
  }));

  // Post-filter by location to catch any DB-level leakage
  if (input.location) {
    const locationVariantsForFilter = buildLocationVariants(input.location);
    const filtered = products.filter(p =>
      p.shop_location && locationVariantsForFilter.some(v =>
        p.shop_location!.toLowerCase().includes(v.toLowerCase())
      )
    );
    // Only apply strict filter if it yields results; otherwise keep all (no data in that city)
    if (filtered.length > 0) products = filtered;
  }

  return { products, total: products.length };
}

export async function executeSearchStores(input: {
  name?: string;
  location?: string;
}): Promise<StoreResult[]> {
  let q = supabase
    .from('shops')
    .select('shop_id, name, shopLogo, location, shop_ratings(avg_rating, review_count)')
    .eq('status', 'approved');

  if (input.name)     q = q.ilike('name', `%${input.name}%`);
  if (input.location) q = q.ilike('location', `%${input.location}%`);

  const { data } = await q.limit(10);
  return (data ?? []).map((s: any) => ({
    shop_id:      s.shop_id,
    name:         s.name,
    shopLogo:     s.shopLogo,
    location:     s.location,
    avg_rating:   s.shop_ratings?.[0]?.avg_rating ?? null,
    review_count: s.shop_ratings?.[0]?.review_count ?? 0,
  }));
}

// ─── DISPATCHER ────────────────────────────────────────────────────────────

export async function executeTool(name: string, input: Record<string, any>): Promise<unknown> {
  switch (name) {
    case 'search_products': return executeSearchProducts(input as any);
    case 'search_stores':   return executeSearchStores(input as any);
    default: throw new Error(`Unknown tool: ${name}`);
  }
}
