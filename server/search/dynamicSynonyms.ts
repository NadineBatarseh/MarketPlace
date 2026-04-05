import Groq from 'groq-sdk';
import { supabase } from '../supabase.js';

// ── Stop words (Arabic + English) ────────────────────────────────────────────

const STOP_WORDS = new Set([
  'من','في','على','إلى','عن','مع','هذا','هذه','هو','هي',
  'التي','الذي','أو','و','the','a','an','and','or','of',
  'in','on','at','for','to','is','it',
]);

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Trim, lowercase, and strip the Arabic definite article ال */
function sanitise(keyword: string): string {
  let k = keyword.trim().toLowerCase();
  if (k.startsWith('ال') && k.length > 3) k = k.slice(2);
  return k;
}

/**
 * Tokenise a raw search query into individual keywords.
 */
export function tokeniseQuery(raw: string): string[] {
  const normalised = raw
    .trim()
    .toLowerCase()
    .replace(/[،,.!?؟؛;:()[\]{}"'']/g, ' ')
    .replace(/\s+/g, ' ');

  return [
    ...new Set(
      normalised
        .split(' ')
        .filter(t => t.length >= 2 && !STOP_WORDS.has(t))
        .flatMap(t => {
          const stripped =
            t.startsWith('ال') && t.length > 3 ? t.slice(2) : t;
          return stripped !== t ? [t, stripped] : [t];
        })
    ),
  ];
}

// ── Core function ─────────────────────────────────────────────────────────────

export async function getExpandedKeywords(userKeyword: string): Promise<string[]> {
  const key = sanitise(userKeyword);
  if (key.length < 2) return [userKeyword];

  try {
    // Step 2: Check DB cache
    const { data, error: dbErr } = await supabase
      .from('search_synonyms')
      .select('similar_words')
      .eq('keyword', key)
      .maybeSingle();

    if (dbErr) {
      console.warn('[dynamicSynonyms] DB error (is search_synonyms table created?):', dbErr.message);
      throw dbErr;
    }

    // Step 3: Cache hit — return without calling Groq
    if (data) {
      console.log(`[dynamicSynonyms] Cache HIT for "${key}":`, data.similar_words);
      return data.similar_words;
    }

    console.log(`[dynamicSynonyms] Cache MISS for "${key}" — calling Groq...`);

    // Guard: no API key
    if (!process.env.GROQ_API_KEY) {
      console.warn('[dynamicSynonyms] GROQ_API_KEY not set in .env — returning raw keyword only');
      return [key];
    }

    // Step 4: Cache miss — call Groq
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

    const completion = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      temperature: 0.2,
      max_tokens: 300,
      messages: [
        {
          role: 'system',
          content: `You are a linguistic search expert for "Souq Link", a Palestinian e-commerce platform.
Analyze the user's keyword and return ONLY this exact JSON structure (no markdown, no code fences):
{
  "singular": "strict singular noun",
  "plural": "strict plural noun",
  "dialect_palestinian": ["local variant 1", "local variant 2"],
  "english_equivalents": ["word1", "word2"]
}

STRICT RULES:
1. NO adjectives (e.g., "red", "luxury").
2. NO colors, NO sizes, NO compound phrases.
3. Nouns only — bare dictionary forms.
4. For Arabic broken plurals, return the correct dictionary singular (فساتين → فستان, أحذية → حذاء, قمصان → قميص).
5. english_equivalents must be lowercase.

Examples:
Input: فساتين
Output: {"singular":"فستان","plural":"فساتين","dialect_palestinian":["ثوب","روب"],"english_equivalents":["dress","dresses","gown"]}

Input: أحذية
Output: {"singular":"حذاء","plural":"أحذية","dialect_palestinian":["جزمة","جزم","كندرة"],"english_equivalents":["shoe","shoes","footwear"]}`,
        },
        { role: 'user', content: key },
      ],
    });

    const raw = completion.choices[0]?.message?.content?.trim() ?? '{}';
    console.log(`[dynamicSynonyms] Groq response for "${key}":`, raw);

    let synonyms: string[] = [];
    try {
      const parsed = JSON.parse(raw);
      const dialect = Array.isArray(parsed.dialect_palestinian) ? parsed.dialect_palestinian : [];
      const english = Array.isArray(parsed.english_equivalents)
        ? parsed.english_equivalents.map((w: unknown) => typeof w === 'string' ? w.toLowerCase() : w)
        : [];

      const parts: unknown[] = [parsed.singular, parsed.plural, ...dialect, ...english];

      synonyms = Array.from(
        new Set(
          parts.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
        )
      );
    } catch {
      console.warn('[dynamicSynonyms] Failed to parse Groq JSON:', raw);
      synonyms = [key];
    }

    if (synonyms.length === 0) synonyms = [key];
    if (!synonyms.includes(key)) synonyms.unshift(key);
    console.log(`[dynamicSynonyms] Final synonyms for "${key}":`, synonyms);

    // Step 5: Save to DB — fire-and-forget
    supabase
      .from('search_synonyms')
      .insert({ keyword: key, similar_words: synonyms })
      .then(({ error }) => {
        if (error && error.code !== '23505') {
          console.warn('[dynamicSynonyms] DB insert failed:', error.message);
        } else if (!error) {
          console.log(`[dynamicSynonyms] Saved "${key}" to search_synonyms`);
        }
      });

    return synonyms;

  } catch (err) {
    console.warn('[dynamicSynonyms] Error, falling back to raw keyword:', (err as Error).message);
    return [userKeyword];
  }
}

// ── Drop-in async replacement for expandQuery() ───────────────────────────────

export async function expandQueryDynamic(rawQuery: string): Promise<string[]> {
  const tokens = tokeniseQuery(rawQuery);
  if (tokens.length === 0) return [];

  console.log('[dynamicSynonyms] Tokens:', tokens);
  const arrays = await Promise.all(tokens.map(t => getExpandedKeywords(t)));
  return [...new Set(arrays.flat())];
}
