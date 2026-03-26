export const SYNONYM_GROUPS: string[][] = [
  ['بنطال', 'بنطلون', 'بناطيل', 'pants', 'trousers', 'jeans', 'slacks', 'دينم'],
  ['قميص', 'قمصان', 'shirt', 'shirts', 'تيشيرت', 'تيشيرتات', 't-shirt', 'بلوزة'],
  ['حذاء', 'أحذية', 'كندرة', 'كنادر', 'shoes', 'shoe', 'sneakers', 'sandals'],
  ['فستان', 'فساتين', 'dress', 'dresses', 'روب'],
  ['جاكيت', 'جاكيتات', 'معطف', 'معاطف', 'jacket', 'coat', 'blazer', 'hoodie', 'هودي'],
  ['حقيبة', 'حقائب', 'شنطة', 'شنط', 'bag', 'bags', 'purse', 'backpack'],
  ['ساعة', 'ساعات', 'watch', 'watches', 'ساعة يد'],
  ['نظارة', 'نظارات', 'glasses', 'sunglasses', 'نظارة شمسية'],
  ['قبعة', 'قبعات', 'hat', 'hats', 'كاب', 'كابات'],
  ['جوارب', 'sock', 'socks'],
  ['ملابس داخلية', 'underwear', 'lingerie'],
  ['ملابس رياضية', 'sportswear', 'athletic wear'],
  ['ملابس رسمية', 'formal wear', 'suit', 'suits'],
  ['ملابس أطفال', 'children clothing', 'kids clothing'],
  
    ['تنورة', ' تنانير', ' skirt', 'skirts'],

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
