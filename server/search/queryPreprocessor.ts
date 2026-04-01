import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ timeout: 4000 });

const SYSTEM_PROMPT = `You are a product search keyword extractor for an Arabic e-commerce fashion store.
Extract product keywords from the user's query — garment type, color, style, occasion, gender, material.
Return ONLY a JSON array of short Arabic and English search terms. Include both Arabic singular and plural forms when they differ.
Do NOT explain anything. Return ONLY the JSON array on a single line.

Examples:
User: أبحث عن فستان أحمر للسهرة
Output: ["فستان","فساتين","dress","أحمر","red","سهرة","evening"]

User: عايز جاكيت شتوي رجالي
Output: ["جاكيت","jacket","coat","معطف","شتوي","winter","رجالي","men"]

User: محتاجة شنطة جلد بنية
Output: ["شنطة","حقيبة","bag","جلد","leather","بني","brown"]

User: طقم بيتي مريح
Output: ["طقم","بيجاما","ملابس بيت","loungewear","مريح","comfortable","هوم وير"]`;

const SENTENCE_MARKERS = /أبحث|عايز|أريد|ابغى|محتاج|محتاجة|بدي|أدور|عندكم/;

export function isSentenceQuery(raw: string): boolean {
  const tokens = raw.trim().split(/\s+/).filter(Boolean);
  return tokens.length >= 3 || SENTENCE_MARKERS.test(raw);
}

// Simple LRU cache: insertion-order Map, evict oldest when full
const CACHE_MAX = 200;
const cache = new Map<string, string[]>();

function cacheGet(key: string): string[] | undefined {
  const val = cache.get(key);
  if (val !== undefined) {
    // refresh insertion order
    cache.delete(key);
    cache.set(key, val);
  }
  return val;
}

function cacheSet(key: string, value: string[]): void {
  if (cache.size >= CACHE_MAX) {
    cache.delete(cache.keys().next().value!);
  }
  cache.set(key, value);
}

export async function preprocessQuery(raw: string): Promise<string[]> {
  const key = raw.trim().toLowerCase();
  const cached = cacheGet(key);
  if (cached) return cached;

  try {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 150,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: raw }],
    });

    const text = (message.content[0] as { type: string; text?: string }).text?.trim() ?? '[]';
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed)) throw new Error('response is not an array');

    const terms = (parsed as unknown[]).filter((t): t is string => typeof t === 'string');
    cacheSet(key, terms);
    return terms;
  } catch (err) {
    console.warn('[queryPreprocessor] Claude call failed, falling back to expandQuery:', (err as Error).message);
    return [];
  }
}
