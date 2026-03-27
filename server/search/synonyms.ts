/**
 * Arabic / English synonym dictionary for SouqLink product search.
 *
 * Each entry groups all surface forms of the same concept together —
 * singular, plural (sound & broken), transliterations, and English equivalents.
 * expandQuery() looks up every token in both directions so that
 * "بلايز" automatically expands to include "بلوزة", and vice-versa.
 */
export const SYNONYMS: Record<string, string[]> = {

  // ── Clothing & Fashion ────────────────────────────────────────
  // blouse
  بلوزة:    ['بلوزة', 'بلوز', 'بلايز', 'blouse', 'blouses','tops', 'top'],
  top:       ['top', 'tops', 'بلوزة', 'بلوز', 'بلايز', 'blouse', 'blouses'],
 tops :     ['top', 'tops', 'بلوزة', 'بلوز', 'بلايز', 'blouse', 'blouses'],

  بلايز:    ['بلوزة', 'بلوز', 'بلايز', 'blouse', 'blouses'],
  بلوز:     ['بلوزة', 'بلوز', 'بلايز', 'blouse', 'blouses'],
  // shirt / t-shirt
  قميص:     ['قميص', 'قمصان', 'تيشيرت', 'shirt', 't-shirt', 'tshirt', 'polo'],
  قمصان:    ['قميص', 'قمصان', 'تيشيرت', 'shirt', 't-shirt', 'tshirt'],
  تيشيرت:   ['قميص', 'تيشيرت', 'shirt', 't-shirt', 'tshirt'],
  // dress
  فستان:    ['فستان', 'فساتين', 'dress', 'gown'],
  فساتين:   ['فستان', 'فساتين', 'dress', 'gown'],
  // pants / jeans
  بنطلون:   ['بنطلون', 'بنطلونات', 'جينز', 'بنطال', 'trousers', 'pants', 'jeans', 'slacks'],
  بنطلونات: ['بنطلون', 'بنطلونات', 'جينز', 'بنطال', 'trousers', 'pants'],
  جينز:     ['جينز', 'بنطلون', 'denim', 'jeans'],
  // jacket / blazer
  جاكيت:    ['جاكيت', 'جاكيتات', 'بليزر', 'سترة', 'jacket', 'blazer', 'coat'],
  جاكيتات:  ['جاكيت', 'جاكيتات', 'بليزر', 'سترة', 'jacket', 'blazer'],
  بليزر:    ['بليزر', 'جاكيت', 'سترة', 'blazer', 'jacket'],
  سترة:     ['سترة', 'ستر', 'جاكيت', 'بليزر', 'jacket', 'vest'],
  ستر:      ['سترة', 'ستر', 'جاكيت', 'jacket'],
  // sweater / hoodie
  سويتر:    ['سويتر', 'كنزة', 'هودي', 'sweater', 'hoodie', 'pullover', 'sweatshirt'],
  كنزة:     ['كنزة', 'سويتر', 'هودي', 'sweater', 'hoodie', 'pullover'],
  هودي:     ['هودي', 'سويتر', 'كنزة', 'hoodie', 'sweatshirt'],
  // skirt
  تنورة:    ['تنورة', 'تنانير', 'skirt', 'mini skirt'],
  تنانير:   ['تنورة', 'تنانير', 'skirt'],
  // shoes / footwear
  حذاء:     ['حذاء', 'أحذية', 'حذاوات', 'جزمة', 'جزم', 'نعل', 'كوتشي', 'shoes', 'footwear', 'sneakers', 'boots', 'sandals'],
  أحذية:    ['حذاء', 'أحذية', 'جزمة', 'جزم', 'shoes', 'footwear', 'sneakers'],
  جزمة:     ['جزمة', 'جزم', 'حذاء', 'أحذية', 'boots', 'shoes'],
  جزم:      ['جزمة', 'جزم', 'حذاء', 'أحذية', 'boots', 'shoes'],
  كوتشي:    ['كوتشي', 'حذاء', 'أحذية', 'sneakers', 'trainers', 'shoes'],
  // bag / purse
  حقيبة:    ['حقيبة', 'حقائب', 'شنطة', 'شنط', 'كيس', 'محفظة', 'bag', 'purse', 'backpack', 'wallet', 'handbag'],
  حقائب:    ['حقيبة', 'حقائب', 'شنطة', 'شنط', 'bag', 'bags', 'purse'],
  شنطة:     ['شنطة', 'شنط', 'حقيبة', 'حقائب', 'bag', 'purse', 'handbag'],
  شنط:      ['شنطة', 'شنط', 'حقيبة', 'حقائب', 'bag', 'bags'],
  // general clothes
  ملابس:    ['ملابس', 'ثياب', 'لباس', 'أزياء', 'clothes', 'clothing', 'fashion', 'wear', 'outfit'],
  ثياب:     ['ملابس', 'ثياب', 'لباس', 'أزياء', 'clothes', 'clothing'],
  لباس:     ['ملابس', 'ثياب', 'لباس', 'clothes', 'clothing'],
  أزياء:    ['أزياء', 'ملابس', 'ثياب', 'fashion', 'clothes'],
  // abaya / hijab
  عباءة:    ['عباءة', 'عبايات', 'عباية', 'abaya'],
  عبايات:   ['عباءة', 'عبايات', 'عباية', 'abaya'],
  عباية:    ['عباءة', 'عبايات', 'عباية', 'abaya'],
  شيلة:     ['شيلة', 'شيلات', 'طرحة', 'طرح', 'حجاب', 'hijab', 'scarf', 'veil'],
  شيلات:    ['شيلة', 'شيلات', 'طرحة', 'طرح', 'حجاب', 'scarf'],
  طرحة:     ['طرحة', 'طرح', 'شيلة', 'حجاب', 'scarf', 'hijab'],
  حجاب:     ['حجاب', 'طرحة', 'شيلة', 'hijab', 'scarf', 'veil'],

  
};

/** Arabic stop words to skip before matching */
const STOP_WORDS = new Set([
  'من', 'في', 'على', 'إلى', 'عن', 'مع', 'هذا', 'هذه', 'هو', 'هي',
  'التي', 'الذي', 'الذين', 'كان', 'كانت', 'كانوا', 'أن', 'إن', 'لا',
  'ما', 'لم', 'أو', 'و', 'ثم', 'لكن', 'بل', 'حتى', 'كل', 'كما',
  'قد', 'لقد', 'قبل', 'بعد', 'فوق', 'تحت', 'أمام', 'خلف', 'بين',
  'the', 'a', 'an', 'and', 'or', 'of', 'in', 'on', 'at', 'for', 'to',
]);

/**
 * Strip the Arabic definite article "ال" from the start of a word.
 * e.g. "الجوال" → "جوال", "البلوزة" → "بلوزة"
 */
function stripDefiniteArticle(token: string): string {
  if (token.startsWith('ال') && token.length > 3) return token.slice(2);
  return token;
}

/**
 * Tokenise, remove stop words, strip definite articles, and expand
 * the raw query with all known synonyms (singular, plural, transliterations).
 */
export function expandQuery(raw: string): string[] {
  const normalised = raw
    .trim()
    .toLowerCase()
    .replace(/[،,.!?؟؛;:()[\]{}""'']/g, ' ')
    .replace(/\s+/g, ' ');

  const rawTokens = normalised
    .split(' ')
    .filter(t => t.length > 1 && !STOP_WORDS.has(t));

  // Also try stripping "ال" from each token
  const tokens = new Set<string>(rawTokens);
  rawTokens.forEach(t => tokens.add(stripDefiniteArticle(t)));

  const expanded = new Set<string>(tokens);

  for (const token of tokens) {
    // Direct lookup
    if (SYNONYMS[token]) {
      SYNONYMS[token].forEach(s => expanded.add(s));
      continue;
    }
    // Reverse lookup: token might be inside a synonym list
    for (const syns of Object.values(SYNONYMS)) {
      if (syns.includes(token)) {
        syns.forEach(s => expanded.add(s));
        break;
      }
    }
  }
  return [...expanded];
}
