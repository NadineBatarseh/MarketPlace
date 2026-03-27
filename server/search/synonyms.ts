export const SYNONYM_GROUPS: string[][] = [
  ['بنطال', 'بنطلون', 'بناطيل', 'بنطلونات', 'pants', 'trousers', 'jeans', 'slacks', 'دينم', 'denim'],
  ['قميص', 'قمصان', 'قمصانة', 'shirt', 'shirts', 'تيشيرت', 'تيشيرتات', 't-shirt', 'تي شيرت'],
  ['بلوزة', 'بلوزات', 'بلايز', 'blouse', 'blouses', 'top', 'tops'],
  ['حذاء', 'أحذية', 'احذية', 'كندرة', 'كنادر', 'shoes', 'shoe', 'sneakers', 'sandals', 'حذاء رياضي', 'سنيكرز'],
  ['فستان', 'فساتين', 'dress', 'dresses', 'روب', 'ثوب', 'ثياب'],
  ['جاكيت', 'جاكيتات', 'معطف', 'معاطف', 'jacket', 'coat', 'blazer', 'hoodie', 'هودي', 'كنزة', 'كنز', 'سترة', 'ستر'],
  ['حقيبة', 'حقائب', 'شنطة', 'شنط', 'bag', 'bags', 'purse', 'backpack', 'شنطة ظهر', 'حقيبة يد'],
  ['ساعة', 'ساعات', 'watch', 'watches', 'ساعة يد'],
  ['نظارة', 'نظارات', 'glasses', 'sunglasses', 'نظارة شمسية', 'نظارات شمسية'],
  ['قبعة', 'قبعات', 'hat', 'hats', 'كاب', 'كابات', 'طاقية', 'طواقي'],
  ['جوارب', 'جورب', 'شراب', 'شرابات', 'sock', 'socks'],
  ['ملابس داخلية', 'انتيريه', 'underwear', 'lingerie'],
  ['ملابس رياضية', 'sportswear', 'athletic wear', 'ترينج', 'ترنج'],
  ['ملابس رسمية', 'formal wear', 'suit', 'suits', 'بدلة', 'بدلات'],
  ['ملابس أطفال', 'ملابس اطفال', 'children clothing', 'kids clothing', 'baby clothes'],
  ['تنورة', 'تنانير', 'skirt', 'skirts'],
  ['عطر', 'عطور', 'بخور', 'perfume', 'perfumes', 'cologne', 'fragrance'],
  ['مجوهرات', 'مجوهر', 'اكسسوارات', 'اكسسوار', 'jewelry', 'jewellery', 'accessories', 'خاتم', 'خواتم', 'سوار', 'اساور', 'قلادة', 'قلائد'],
];

export function expandKeywords(terms: string[]): string[] {
  const expanded = new Set<string>(terms);
  for (const term of terms) {
    const lower = term.trim().toLowerCase();
    for (const group of SYNONYM_GROUPS) {
      if (group.some(g => {
        const gl = g.trim().toLowerCase();
        return lower.includes(gl) || gl.includes(lower);
      })) {
        group.forEach(g => expanded.add(g.trim()));
        break;
      }
    }
  }
  return [...expanded];
}
