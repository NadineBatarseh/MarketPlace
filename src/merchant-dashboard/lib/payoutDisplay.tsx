/**
 * Shared display helpers for vendor payout status — used by the merchant earnings page
 * (MerchantPayouts) and the per-order earnings badge (MerchantOrders) so both render the
 * same Arabic labels, colours and money/date formatting.
 *
 * The earnings table uses the CSS pill classes (`cls`, defined in MerchantPayouts.css);
 * the <PayoutStatusPill> component is CSS-independent (inline-styled) for reuse elsewhere.
 */

// Split Payout statuses: 'distributed' (paid via PayTabs at pay-in), 'platform_held'
// (platform holds the share — shop wasn't onboarded for payout). The remaining values are
// legacy rows from the retired deferred-settlement model, kept so old data still renders.
export type PayoutStatus =
  | 'distributed' | 'platform_held'
  | 'pending' | 'queued' | 'submitted' | 'paid' | 'failed' | 'skipped' | 'reversed';

interface StatusMeta {
  label: string;  // Arabic label
  cls: string;    // MerchantPayouts.css pill class
  bg: string;     // inline pill background
  fg: string;     // inline pill text colour
}

// Arabic label + colour bucket per ledger status (colours mirror MerchantPayouts.css pills).
export const PAYOUT_STATUS_META: Record<PayoutStatus, StatusMeta> = {
  distributed:   { label: 'محوّلة عبر PayTabs', cls: 'mpo-st--green', bg: '#ecfdf5', fg: '#16b981' },
  platform_held: { label: 'محتجزة لدى المنصّة', cls: 'mpo-st--amber', bg: '#fffbeb', fg: '#b45309' },
  pending:   { label: 'قيد الانتظار', cls: 'mpo-st--amber', bg: '#fffbeb', fg: '#b45309' },
  queued:    { label: 'قيد التحويل',  cls: 'mpo-st--amber', bg: '#fffbeb', fg: '#b45309' },
  submitted: { label: 'قيد التحويل',  cls: 'mpo-st--blue',  bg: '#eff6ff', fg: '#2563eb' },
  paid:      { label: 'مدفوع',         cls: 'mpo-st--green', bg: '#ecfdf5', fg: '#16b981' },
  failed:    { label: 'فشل',           cls: 'mpo-st--red',   bg: '#fef2f2', fg: '#dc2626' },
  skipped:   { label: 'معلّق',         cls: 'mpo-st--grey',  bg: '#f1f5f9', fg: '#64748b' },
  reversed:  { label: 'ملغى',          cls: 'mpo-st--red',   bg: '#fef2f2', fg: '#dc2626' },
};

export function payoutMeta(status: PayoutStatus): StatusMeta {
  return PAYOUT_STATUS_META[status] ?? { label: String(status), cls: 'mpo-st--grey', bg: '#f1f5f9', fg: '#64748b' };
}

export const fmtMoney = (n: number, ccy: string) =>
  `${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${ccy}`;

export const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('ar-EG-u-nu-latn', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';

/** CSS-independent inline-styled status pill (for use outside the earnings page). */
export function PayoutStatusPill({ status }: { status: PayoutStatus }) {
  const meta = payoutMeta(status);
  return (
    <span
      style={{
        display: 'inline-block',
        fontSize: '0.72rem',
        fontWeight: 800,
        padding: '0.12rem 0.55rem',
        borderRadius: 999,
        background: meta.bg,
        color: meta.fg,
      }}
    >
      {meta.label}
    </span>
  );
}
