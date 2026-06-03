import { useEffect, useState, type ReactNode } from 'react';
import supabase from '../../lib/supabase';

export type AppStatus = 'pending' | 'approved' | 'rejected';
export type AppKind = 'merchant' | 'delivery';

const STATUS_TONES: Record<AppStatus, { bg: string; text: string; border: string; dot: string; label: string }> = {
  pending:  { bg: '#FEF3C7', text: '#92400E', border: '#FCD34D', dot: '#F59E0B', label: 'قيد المراجعة' },
  approved: { bg: '#DCFCE7', text: '#166534', border: '#86EFAC', dot: '#16A34A', label: 'موافق عليها' },
  rejected: { bg: '#FEE2E2', text: '#991B1B', border: '#FCA5A5', dot: '#DC2626', label: 'مرفوضة' },
};

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2);
  return ((parts[0][0] ?? '') + (parts[1][0] ?? '')).trim() || '?';
}

/* ────────────────────────────────────────────────
   Shared inline icons (single source of truth)
   ──────────────────────────────────────────────── */
export const AppIcons = {
  mail: (
    <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
      <polyline points="22,6 12,13 2,6" />
    </svg>
  ),
  phone: (
    <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13.1 19.79 19.79 0 0 1 1.62 4.5 2 2 0 0 1 3.6 2.3h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.91 9.91a16 16 0 0 0 6.08 6.08l.97-.97a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.73 2.02z" />
    </svg>
  ),
  pin: (
    <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 1 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  ),
  user: (
    <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  ),
  idCard: (
    <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <line x1="7" y1="10" x2="9" y2="10" />
      <line x1="7" y1="14" x2="13" y2="14" />
      <circle cx="17" cy="11" r="2" />
    </svg>
  ),
  car: (
    <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 17h14a1 1 0 0 0 1-1l-1-5a2 2 0 0 0-2-1.5H7a2 2 0 0 0-2 1.5l-1 5a1 1 0 0 0 1 1z" />
      <path d="M6 10l1.5-4A2 2 0 0 1 9.4 4.5h5.2a2 2 0 0 1 1.9 1.5L18 10" />
      <circle cx="7.5" cy="17.5" r="1.5" />
      <circle cx="16.5" cy="17.5" r="1.5" />
    </svg>
  ),
  store: (
    <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l1-5h16l1 5" />
      <path d="M3 9v11a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V9" />
      <path d="M9 21V13h6v8" />
      <path d="M3 9c0 1.7 1.3 3 3 3s3-1.3 3-3 1.3 3 3 3 3-1.3 3-3 1.3 3 3 3 3-1.3 3-3" />
    </svg>
  ),
  clock: (
    <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  ),
  check: (
    <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
  cross: (
    <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  ),
  undo: (
    <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 1 0 9-9" />
      <polyline points="3 4 3 12 11 12" />
    </svg>
  ),
  trash: (
    <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M9 6V4h6v2" />
    </svg>
  ),
  pdf: (
    <svg width="26" height="26" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  ),
  zoom: (
    <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
      <line x1="11" y1="8" x2="11" y2="14" />
      <line x1="8" y1="11" x2="14" y2="11" />
    </svg>
  ),
  contact: (
    <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13.1 19.79 19.79 0 0 1 1.62 4.5 2 2 0 0 1 3.6 2.3h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.91 9.91a16 16 0 0 0 6.08 6.08l.97-.97a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.73 2.02z" />
    </svg>
  ),
  details: (
    <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
    </svg>
  ),
  paperclip: (
    <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  ),
  inbox: (
    <svg width="30" height="30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
      <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </svg>
  ),
  chevron: (
    <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  ),
};

/* ────────────────────────────────────────────────
   Status pill
   ──────────────────────────────────────────────── */
export function StatusPill({ status }: { status: AppStatus }) {
  const cfg = STATUS_TONES[status];
  return (
    <span
      className="ad-app-status"
      style={{ background: cfg.bg, color: cfg.text, borderColor: cfg.border }}
    >
      <span className="ad-app-status-dot" style={{ background: cfg.dot }} />
      {cfg.label}
    </span>
  );
}

/* ────────────────────────────────────────────────
   MediaPreview — thumbnail for docs / pictures
   Resolves a signed URL for bucket+path, or uses
   a direct public URL. PDFs open in a new tab,
   images use the lightbox callback if provided.
   ──────────────────────────────────────────────── */
export interface MediaSpec {
  url?: string;
  bucket?: string;
  path?: string;
  label: string;
  variant?: 'doc' | 'picture';
}

interface MediaPreviewProps extends MediaSpec {
  onLightbox?: (url: string) => void;
}

export function MediaPreview({ url, bucket, path, label, variant = 'doc', onLightbox }: MediaPreviewProps) {
  const [resolved, setResolved] = useState<string | null>(url ?? null);
  const [failed, setFailed] = useState(false);
  const target = path ?? url ?? '';
  const isPdf = /\.pdf($|\?)/i.test(target);

  useEffect(() => {
    if (url) { setResolved(url); setFailed(false); return; }
    if (!bucket || !path) return;
    let active = true;
    setFailed(false);
    setResolved(null);
    supabase.storage.from(bucket).createSignedUrl(path, 3600).then(({ data, error }) => {
      if (!active) return;
      if (error || !data?.signedUrl) setFailed(true);
      else setResolved(data.signedUrl);
    });
    return () => { active = false; };
  }, [url, bucket, path]);

  const handleClick = () => {
    if (!resolved) return;
    if (!isPdf && onLightbox) onLightbox(resolved);
    else window.open(resolved, '_blank', 'noopener,noreferrer');
  };

  return (
    <button
      type="button"
      className={`ad-app-media ad-app-media--${variant}`}
      onClick={handleClick}
      disabled={!resolved && !failed}
      title={`${label}${isPdf ? ' (PDF)' : ''}`}
    >
      <div className="ad-app-media-thumb">
        {failed ? (
          <div className="ad-app-media-fail">
            <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span>تعذّر التحميل</span>
          </div>
        ) : isPdf && resolved ? (
          <div className="ad-app-media-pdf">
            {AppIcons.pdf}
            <span>PDF</span>
          </div>
        ) : resolved ? (
          <img src={resolved} alt={label} loading="lazy" />
        ) : (
          <div className="ad-app-media-loading">
            <span className="ad-app-media-spin" />
          </div>
        )}
        {resolved && !failed && (
          <div className="ad-app-media-overlay">{AppIcons.zoom}</div>
        )}
      </div>
      <span className="ad-app-media-label">{label}</span>
    </button>
  );
}

/* ────────────────────────────────────────────────
   ApplicationCard
   ──────────────────────────────────────────────── */
export interface InfoSpec {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  href?: string;
}

interface SectionProps {
  title: string;
  icon: ReactNode;
  children: ReactNode;
}

function Section({ title, icon, children }: SectionProps) {
  return (
    <div className="ad-app-section">
      <div className="ad-app-section-title">
        <span className="ad-app-section-icon">{icon}</span>
        {title}
      </div>
      {children}
    </div>
  );
}

function InfoGrid({ items }: { items: InfoSpec[] }) {
  return (
    <div className="ad-app-info-grid">
      {items.map((item, i) => (
        <div key={i} className="ad-app-info-item">
          <span className="ad-app-info-icon">{item.icon}</span>
          <div className="ad-app-info-text">
            <span className="ad-app-info-label">{item.label}</span>
            {item.href ? (
              <a href={item.href} className="ad-app-info-value ad-app-info-link">{item.value}</a>
            ) : (
              <span className="ad-app-info-value">{item.value ?? <em className="ad-app-info-empty">—</em>}</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export interface ApplicationCardProps {
  /** Primary name shown in the store/applicant column */
  applicantName: string;
  /** Secondary line under the name (owner / role) */
  ownerName?: string;
  typeChip?: string;
  appKind: AppKind;
  status: AppStatus;
  /** Summary-row columns */
  location?: string;
  phone?: string;
  email?: string;
  /** Expanded-area data */
  contactItems: InfoSpec[];
  detailItems?: InfoSpec[];
  description?: string | null;
  documents?: MediaSpec[];
  createdAt: string;
  loading: boolean;
  onApprove: () => void;
  onReject: () => void;
  onWithdraw: () => void;
  onDelete: () => void;
  onLightbox?: (url: string) => void;
}

export default function ApplicationCard(props: ApplicationCardProps) {
  const {
    applicantName, ownerName, typeChip, appKind, status,
    location, phone, email,
    contactItems, detailItems, description, documents,
    createdAt, loading,
    onApprove, onReject, onWithdraw, onDelete, onLightbox,
  } = props;

  const [expanded, setExpanded] = useState(false);
  const toggle = () => setExpanded(v => !v);

  const formattedDate = new Date(createdAt).toLocaleDateString('ar-EG', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
  const formattedTime = new Date(createdAt).toLocaleTimeString('ar-EG', {
    hour: '2-digit', minute: '2-digit',
  });

  const docCount = documents?.length ?? 0;
  const hasDocuments = docCount > 0;

  return (
    <div className={`ad-row-wrap ad-row-wrap--${status}${expanded ? ' ad-row-wrap--open' : ''}`}>
      {/* ── Compact summary row ── */}
      <div
        className="ad-row"
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={toggle}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } }}
      >
        {/* Store / applicant */}
        <div className="ad-row-cell ad-row-cell--store">
          <span className="ad-row-avatar" data-kind={appKind} aria-hidden="true">
            {getInitials(applicantName)}
          </span>
          <div className="ad-row-store-text">
            <span className="ad-row-store-name">{applicantName}</span>
            {ownerName && <span className="ad-row-store-owner">{ownerName}</span>}
          </div>
        </div>

        {/* Type / category */}
        <div className="ad-row-cell ad-row-cell--type" data-label="النوع">
          {typeChip
            ? <span className="ad-row-chip">{appKind === 'merchant' ? AppIcons.store : AppIcons.car}{typeChip}</span>
            : <span className="ad-row-empty">—</span>}
        </div>

        {/* Location */}
        <div className="ad-row-cell ad-row-cell--location" data-label="الموقع">
          {location
            ? <><span className="ad-row-cell-icon">{AppIcons.pin}</span><span>{location}</span></>
            : <span className="ad-row-empty">—</span>}
        </div>

        {/* Contact */}
        <div className="ad-row-cell ad-row-cell--contact" data-label="التواصل">
          {phone && <span className="ad-row-contact-line"><span className="ad-row-cell-icon">{AppIcons.phone}</span>{phone}</span>}
          {email && <span className="ad-row-contact-line ad-row-contact-muted"><span className="ad-row-cell-icon">{AppIcons.mail}</span>{email}</span>}
          {!phone && !email && <span className="ad-row-empty">—</span>}
        </div>

        {/* Documents */}
        <div className="ad-row-cell ad-row-cell--docs" data-label="المستندات">
          <span className="ad-row-doc-badge" title={`${docCount} مستند`}>
            <span className="ad-row-cell-icon">{AppIcons.paperclip}</span>
            {docCount}
          </span>
        </div>

        {/* Status */}
        <div className="ad-row-cell ad-row-cell--status" data-label="الحالة">
          <StatusPill status={status} />
        </div>

        {/* Actions */}
        <div className="ad-row-cell ad-row-cell--actions" onClick={(e) => e.stopPropagation()}>
          <button type="button" className="ad-row-details-btn" onClick={toggle}>
            عرض التفاصيل
          </button>
          <button
            type="button"
            className={`ad-row-expand${expanded ? ' ad-row-expand--open' : ''}`}
            onClick={toggle}
            aria-label={expanded ? 'طي التفاصيل' : 'عرض التفاصيل'}
            aria-expanded={expanded}
          >
            {AppIcons.chevron}
          </button>
        </div>
      </div>

      {/* ── Expanded details ── */}
      {expanded && (
        <div className="ad-row-detail">
          <div className="ad-row-detail-grid">
            <Section title="معلومات التواصل" icon={AppIcons.contact}>
              <InfoGrid items={contactItems} />
            </Section>

            <Section title="تفاصيل الطلب" icon={AppIcons.details}>
              {detailItems && detailItems.length > 0 && <InfoGrid items={detailItems} />}
              <InfoGrid items={[{
                icon: AppIcons.clock,
                label: 'تاريخ الطلب',
                value: `${formattedDate} — ${formattedTime}`,
              }]} />
              {description && <p className="ad-app-description">{description}</p>}
            </Section>

            <Section title="المستندات والصور" icon={AppIcons.paperclip}>
              {hasDocuments ? (
                <>
                  <div className="ad-app-media-row">
                    {documents!.map((doc, i) => (
                      <MediaPreview key={i} {...doc} onLightbox={onLightbox} />
                    ))}
                  </div>
                  <div className="ad-row-doc-count">عرض جميع المستندات ({docCount})</div>
                </>
              ) : (
                <p className="ad-app-info-empty">لا توجد مستندات مرفقة</p>
              )}
            </Section>
          </div>

          {/* Review actions */}
          <div className="ad-row-actions">
            {status !== 'approved' && (
              <button type="button" className="ad-app-btn ad-app-btn--approve" disabled={loading} onClick={onApprove}>
                {AppIcons.check}
                موافقة
              </button>
            )}
            {status === 'approved' && (
              <button type="button" className="ad-app-btn ad-app-btn--withdraw" disabled={loading} onClick={onWithdraw}>
                {AppIcons.undo}
                {loading ? '...' : 'سحب الموافقة'}
              </button>
            )}
            {status !== 'rejected' && (
              <button type="button" className="ad-app-btn ad-app-btn--reject" disabled={loading} onClick={onReject}>
                {AppIcons.cross}
                رفض
              </button>
            )}
            <button type="button" className="ad-app-btn ad-app-btn--delete-outline" disabled={loading} onClick={onDelete}>
              {AppIcons.trash}
              حذف
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
