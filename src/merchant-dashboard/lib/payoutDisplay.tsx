/**
 * Shared display helpers for vendor payout status — used by the merchant earnings page
 * (MerchantPayouts) and the per-order earnings badge (MerchantOrders) so both render the
 * same labels, colours and money/date formatting.
 *
 * The earnings table uses the CSS pill classes (`cls`, defined in MerchantPayouts.css);
 * the <PayoutStatusPill> component is CSS-independent (inline-styled) for reuse elsewhere.
 *
 * Labels come from the `merchant` i18n namespace (`payoutStatus.<status>`) — this module
 * has no JSX-free way to call useTranslation, so payoutMeta() takes `t` as a parameter.
 */
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

// Split Payout statuses: 'distributed' (paid via PayTabs at pay-in), 'platform_held'
// (platform holds the share — shop wasn't onboarded for payout). The remaining values are
// legacy rows from the retired deferred-settlement model, kept so old data still renders.
export type PayoutStatus =
  | 'distributed' | 'platform_held'
  | 'pending' | 'queued' | 'submitted' | 'paid' | 'failed' | 'skipped' | 'reversed';

interface StatusMeta {
  label: string;
  cls: string;    // MerchantPayouts.css pill class
  bg: string;     // inline pill background
  fg: string;     // inline pill text colour
}

// Colour bucket per ledger status (colours mirror MerchantPayouts.css pills); labels are translated separately.
const PAYOUT_STATUS_STYLE: Record<PayoutStatus, { cls: string; bg: string; fg: string }> = {
  distributed:   { cls: 'mpo-st--green', bg: '#ecfdf5', fg: '#16b981' },
  platform_held: { cls: 'mpo-st--amber', bg: '#fffbeb', fg: '#b45309' },
  pending:       { cls: 'mpo-st--amber', bg: '#fffbeb', fg: '#b45309' },
  queued:        { cls: 'mpo-st--amber', bg: '#fffbeb', fg: '#b45309' },
  submitted:     { cls: 'mpo-st--blue',  bg: '#eff6ff', fg: '#2563eb' },
  paid:          { cls: 'mpo-st--green', bg: '#ecfdf5', fg: '#16b981' },
  failed:        { cls: 'mpo-st--red',   bg: '#fef2f2', fg: '#dc2626' },
  skipped:       { cls: 'mpo-st--grey',  bg: '#f1f5f9', fg: '#64748b' },
  reversed:      { cls: 'mpo-st--red',   bg: '#fef2f2', fg: '#dc2626' },
};

export function payoutMeta(status: PayoutStatus, t: TFunction): StatusMeta {
  const style = PAYOUT_STATUS_STYLE[status] ?? { cls: 'mpo-st--grey', bg: '#f1f5f9', fg: '#64748b' };
  return { ...style, label: t(`payoutStatus.${status}`, { defaultValue: String(status) }) };
}

export const fmtMoney = (n: number, ccy: string) =>
  `${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${ccy}`;

export const fmtDate = (iso: string | null, locale: string = 'ar-EG') =>
  iso ? new Date(iso).toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' }) : '—';

/** CSS-independent inline-styled status pill (for use outside the earnings page). */
export function PayoutStatusPill({ status }: { status: PayoutStatus }) {
  const { t } = useTranslation('merchant');
  const meta = payoutMeta(status, t);
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
