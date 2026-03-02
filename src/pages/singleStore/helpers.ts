export function parsePrice(raw: string | number | null | undefined): string {
  if (raw === null || raw === undefined || raw === "") return "";
  const num = parseFloat(String(raw).replace(/[^\d.]/g, ""));
  return isNaN(num) ? "" : num.toLocaleString("ar-SA", { maximumFractionDigits: 2 });
}

export function formatNumber(n: number | null | undefined): string {
  if (!n) return "0";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "م";
  if (n >= 1_000)     return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "k";
  return n.toLocaleString("ar-SA");
}
