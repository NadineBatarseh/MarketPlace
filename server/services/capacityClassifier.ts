/**
 * capacityClassifier.ts
 *
 * Estimates `capacity_units` (1–5) for a product, representing how much
 * space/handling it requires for first-mile delivery planning.
 *
 *   1 = very small  (jewelry, cosmetics, pens)
 *   2 = small       (clothing, phones, perfume)
 *   3 = medium      (bags, shoes, kitchen items, laptops)
 *   4 = large       (TVs, printers, bikes)
 *   5 = very large  (furniture, fridges, washing machines)
 *
 * Strategy:
 *   1. Try Claude Haiku with a tight prompt (same model already used in search).
 *   2. If AI is unavailable or returns a bad value, fall back to keyword rules
 *      then category defaults.
 */

import Anthropic from '@anthropic-ai/sdk';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ProductInput {
  title: string;
  description?: string | null;
  category?: string | null;
}

// ─── Category defaults ────────────────────────────────────────────────────────

const CATEGORY_DEFAULTS: Record<string, number> = {
  'ملابس رجالية':      2,
  'ملابس نسائية':      2,
  'ملابس أطفال':       1,
  'إكسسوارات':         1,
  'أدوات منزلية':      3,
  'إلكترونيات':        2,
  'مستلزمات مطبخ':    3,
  'عطور ومستحضرات':   1,
  'رياضة وترفيه':      3,
  'ألعاب أطفال':       2,
  'كتب وقرطاسية':     1,
  'أخرى':              3,
};

// ─── Keyword rules (ordered highest → lowest; first match wins) ───────────────

const KEYWORD_RULES: Array<{ pattern: RegExp; score: number }> = [
  // 5 – furniture & major appliances
  { pattern: /أريكة|كنبة|سرير|خزانة|ثلاجة|غسالة|مكيف|دولاب|فريزر|موقد|جاكوزي|حوض استحمام/i, score: 5 },
  // 4 – large electronics, bikes, printers
  { pattern: /تلفزيون|شاشة كبير|طابعة|دراجة|عجلة|ميزان ضخم|جهاز تمرين|آلة خياطة/i, score: 4 },
  // 3 – bags, shoes, kitchen sets, laptops, tablets
  { pattern: /حقيبة|شنطة|حذاء|جزمة|مجموعة أدوات|لابتوب|حاسوب محمول|آيباد|جهاز لوحي|مكواة/i, score: 3 },
  // 2 – clothing, phones, small electronics
  { pattern: /قميص|فستان|بنطلون|تيشرت|جاكيت|بلوزة|عباية|ثوب|هاتف|جوال|ساعة|نظارة|سماعة/i, score: 2 },
  // 1 – jewelry, cosmetics, stationery
  { pattern: /قلادة|خاتم|أسوارة|دبوس|عطر|برفيوم|مكياج|ظل|روج|كتاب|قلم|دفتر|شاحن صغير/i, score: 1 },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function clampCapacity(n: number): number {
  return Math.max(1, Math.min(5, Math.round(n)));
}

export function fallbackCapacity(product: ProductInput): number {
  const text = `${product.title} ${product.description ?? ''}`;
  for (const { pattern, score } of KEYWORD_RULES) {
    if (pattern.test(text)) return score;
  }
  if (product.category && CATEGORY_DEFAULTS[product.category] !== undefined) {
    return CATEGORY_DEFAULTS[product.category];
  }
  return 3; // safe default: medium
}

// ─── AI classification ────────────────────────────────────────────────────────

const AI_PROMPT = (p: ProductInput) =>
  `You are a logistics capacity estimator for an Arabic e-commerce delivery system.
Return ONE digit (1–5) representing how much space/handling this product needs during first-mile delivery pickup.

Scale:
1 = tiny   (jewelry, accessories, cosmetics, pens, small chargers)
2 = small  (clothing, shoes, phones, perfume, watches)
3 = medium (bags, laptops, kitchen appliances, toys, tools)
4 = large  (TVs, printers, bicycles, exercise equipment)
5 = huge   (furniture, fridges, washing machines, large cabinets)

Product name: ${p.title}
Description: ${p.description ?? 'N/A'}
Category: ${p.category ?? 'N/A'}

Reply with ONE digit only. No punctuation, no explanation.`;

// ─── Main export ──────────────────────────────────────────────────────────────

export async function estimateCapacityUnits(product: ProductInput): Promise<number> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return fallbackCapacity(product);
  }

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 5000 });
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 5,
      messages: [{ role: 'user', content: AI_PROMPT(product) }],
    });

    const raw = (response.content[0] as { type: string; text: string }).text.trim();
    const digit = parseInt(raw, 10);

    if (!isNaN(digit) && digit >= 1 && digit <= 5) return digit;
  } catch {
    // AI unavailable — fall through to rule-based fallback
  }

  return fallbackCapacity(product);
}
