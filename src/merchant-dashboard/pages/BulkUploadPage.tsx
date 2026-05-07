import { useState, useRef } from 'react';
import supabase from '../../lib/supabase';

interface UploadReport {
  summary: string;
  inserted: number;
  failed: number;
  failureDetails: Array<{ row: number; reason: string }>;
  _debug?: Array<{ title: string; image_urls: string[] | null }>;
}

export default function BulkUploadPage() {
  const [excelFile, setExcelFile]   = useState<File | null>(null);
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [status, setStatus]   = useState<'idle' | 'uploading' | 'done' | 'error'>('idle');
  const [report, setReport]   = useState<UploadReport | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  const excelRef  = useRef<HTMLInputElement>(null);
  const imagesRef = useRef<HTMLInputElement>(null);

  const handleExcelChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setExcelFile(e.target.files?.[0] ?? null);
    setStatus('idle');
    setReport(null);
    setErrorMsg('');
  };

  const handleImagesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setImageFiles(Array.from(e.target.files ?? []));
  };

  const handleUpload = async () => {
    if (!excelFile) return;

    setStatus('uploading');
    setReport(null);
    setErrorMsg('');

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        setStatus('error');
        setErrorMsg('لم يتم العثور على جلسة. يرجى تسجيل الدخول مرة أخرى.');
        return;
      }

      const formData = new FormData();
      formData.append('file', excelFile);
      // Append each image file under the "images" field
      imageFiles.forEach((img) => formData.append('images', img));

      const res = await fetch('/api/products/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: formData,
      });

      const json = await res.json();

      if (!res.ok || !json.ok) {
        setStatus('error');
        setErrorMsg(json.error ?? 'فشل رفع الملف');
        return;
      }

      setReport(json as UploadReport);
      setStatus('done');
    } catch (err) {
      setStatus('error');
      setErrorMsg(err instanceof Error ? err.message : 'خطأ غير متوقع');
    }
  };

  const reset = () => {
    setExcelFile(null);
    setImageFiles([]);
    setStatus('idle');
    setReport(null);
    setErrorMsg('');
    if (excelRef.current)  excelRef.current.value  = '';
    if (imagesRef.current) imagesRef.current.value = '';
  };

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: '2rem 1rem', direction: 'rtl' }}>
      <h2 style={{ fontSize: '1.4rem', fontWeight: 700, marginBottom: '0.5rem', color: '#1a1a2e' }}>
        رفع منتجات بالجملة
      </h2>
      <p style={{ color: '#555', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
        ارفع ملف Excel مع صور المنتجات من جهازك، أو ضع روابط الصور مباشرة في الملف.
      </p>

      {/* Step 1 — Excel file */}
      <StepLabel number={1} text="اختر ملف Excel" />
      <div
        style={dropZone}
        onClick={() => excelRef.current?.click()}
      >
        <input ref={excelRef} type="file" accept=".xlsx,.xls"
          style={{ display: 'none' }} onChange={handleExcelChange} aria-hidden="true" />
        {excelFile ? (
          <p style={{ margin: 0, color: '#4f2d91', fontWeight: 600 }}>
            {excelFile.name}{' '}
            <span style={{ color: '#888', fontWeight: 400 }}>
              ({(excelFile.size / 1024).toFixed(1)} KB)
            </span>
          </p>
        ) : (
          <>
            <UploadIcon />
            <p style={{ margin: '0.5rem 0 0', color: '#888' }}>اضغط لاختيار ملف .xlsx أو .xls</p>
          </>
        )}
      </div>

      {/* Step 2 — Image files (optional) */}
      <StepLabel number={2} text="اختر صور المنتجات من جهازك (اختياري)" />
      <div
        style={{ ...dropZone, marginBottom: '1.25rem' }}
        onClick={() => imagesRef.current?.click()}
      >
        <input ref={imagesRef} type="file" accept="image/*" multiple
          style={{ display: 'none' }} onChange={handleImagesChange} aria-hidden="true" />
        {imageFiles.length > 0 ? (
          <div style={{ textAlign: 'right' }}>
            <p style={{ margin: '0 0 0.4rem', color: '#4f2d91', fontWeight: 600 }}>
              {imageFiles.length} صورة مختارة:
            </p>
            <ul style={{ margin: 0, padding: '0 1rem', color: '#555', fontSize: '0.82rem' }}>
              {imageFiles.map((f) => <li key={f.name}>{f.name}</li>)}
            </ul>
          </div>
        ) : (
          <>
            <ImageIcon />
            <p style={{ margin: '0.5rem 0 0', color: '#888' }}>
              اضغط لاختيار صور (jpg، png، webp…)
            </p>
            <p style={{ margin: '0.2rem 0 0', color: '#aaa', fontSize: '0.78rem' }}>
              اكتب اسم الصورة في عمود image_urls بالإكسل (مثال: shirt.jpg)
            </p>
          </>
        )}
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: '0.75rem' }}>
        <button onClick={handleUpload} disabled={!excelFile || status === 'uploading'}
          style={primaryBtn(!excelFile || status === 'uploading')}>
          {status === 'uploading' ? 'جاري الرفع...' : 'رفع المنتجات'}
        </button>
        {(excelFile || report) && (
          <button onClick={reset} style={secondaryBtn}>إعادة تعيين</button>
        )}
      </div>

      {/* Error */}
      {status === 'error' && (
        <div style={alertBox('#fef2f2', '#b91c1c')}>{errorMsg}</div>
      )}

      {/* Success report */}
      {status === 'done' && report && (
        <div style={{ marginTop: '1.5rem' }}>
          <div style={alertBox('#f0fdf4', '#15803d')}>
            <strong>{report.summary}</strong>
          </div>

          {report.failureDetails.length > 0 && (
            <div style={{ marginTop: '1rem' }}>
              <p style={{ fontWeight: 600, color: '#b45309', marginBottom: '0.5rem' }}>
                تفاصيل الأخطاء ({report.failureDetails.length}):
              </p>
              <ul style={{ margin: 0, padding: '0 1.25rem', color: '#78350f', fontSize: '0.85rem' }}>
                {report.failureDetails.map((f, i) => (
                  <li key={i} style={{ marginBottom: '0.25rem' }}>{f.reason}</li>
                ))}
              </ul>
            </div>
          )}

          {report._debug && (
            <div style={{ marginTop: '1rem', padding: '0.75rem', background: '#f1f5f9', borderRadius: 8, fontSize: '0.8rem' }}>
              <p style={{ fontWeight: 600, color: '#334155', marginBottom: '0.4rem' }}>الصور المحفوظة:</p>
              <ul style={{ margin: 0, padding: '0 1.25rem', color: '#475569' }}>
                {report._debug.map((d, i) => (
                  <li key={i} style={{ marginBottom: '0.2rem' }}>
                    <strong>{d.title}</strong>:{' '}
                    {d.image_urls && d.image_urls.length > 0
                      ? <span style={{ color: '#16a34a' }}>{d.image_urls.length} صورة</span>
                      : <span style={{ color: '#dc2626' }}>بدون صور</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Format guide */}
      <div style={{ marginTop: '2rem', padding: '1rem', background: '#f8f9fa', borderRadius: 8, fontSize: '0.82rem', color: '#555' }}>
        <strong>تنسيق عمود image_urls في الإكسل:</strong>
        <table style={{ marginTop: '0.5rem', borderCollapse: 'collapse', width: '100%', fontSize: '0.8rem' }}>
          <thead>
            <tr style={{ background: '#e2e8f0', textAlign: 'right' }}>
              <th style={th}>الحالة</th>
              <th style={th}>ما تكتبه في الخلية</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={td}>صورة من جهازك</td>
              <td style={{ ...td, direction: 'ltr' }}>shirt.jpg</td>
            </tr>
            <tr style={{ background: '#f8fafc' }}>
              <td style={td}>عدة صور من جهازك</td>
              <td style={{ ...td, direction: 'ltr' }}>shirt.jpg, back.jpg</td>
            </tr>
            <tr>
              <td style={td}>رابط خارجي</td>
              <td style={{ ...td, direction: 'ltr' }}>https://example.com/img.jpg</td>
            </tr>
            <tr style={{ background: '#f8fafc' }}>
              <td style={td}>بدون صورة</td>
              <td style={td}>اتركها فارغة</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── helpers ──────────────────────────────────────────────────────── */

function StepLabel({ number, text }: { number: number; text: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
      <span style={{
        width: 22, height: 22, borderRadius: '50%', background: '#6c3fc5',
        color: '#fff', fontSize: '0.75rem', fontWeight: 700,
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>{number}</span>
      <span style={{ fontWeight: 600, color: '#333', fontSize: '0.9rem' }}>{text}</span>
    </div>
  );
}

function UploadIcon() {
  return (
    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#9a7dd1" strokeWidth="1.5"
      style={{ margin: '0 auto', display: 'block' }}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

function ImageIcon() {
  return (
    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#9a7dd1" strokeWidth="1.5"
      style={{ margin: '0 auto', display: 'block' }}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </svg>
  );
}

const dropZone: React.CSSProperties = {
  border: '2px dashed #c9b8f0',
  borderRadius: 12,
  padding: '1.5rem',
  textAlign: 'center',
  background: '#faf8ff',
  marginBottom: '1.25rem',
  cursor: 'pointer',
};

function primaryBtn(disabled: boolean): React.CSSProperties {
  return {
    padding: '0.65rem 1.5rem', borderRadius: 8, border: 'none',
    background: disabled ? '#d1c4e9' : '#6c3fc5', color: '#fff',
    fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer', fontSize: '0.95rem',
  };
}

const secondaryBtn: React.CSSProperties = {
  padding: '0.65rem 1.2rem', borderRadius: 8,
  border: '1.5px solid #d1c4e9', background: '#fff',
  color: '#6c3fc5', fontWeight: 600, cursor: 'pointer', fontSize: '0.95rem',
};

function alertBox(bg: string, color: string): React.CSSProperties {
  return { marginTop: '1rem', padding: '0.9rem 1rem', borderRadius: 8, background: bg, color, fontSize: '0.9rem', lineHeight: 1.5 };
}

const th: React.CSSProperties = { padding: '0.4rem 0.6rem', border: '1px solid #cbd5e1' };
const td: React.CSSProperties = { padding: '0.4rem 0.6rem', border: '1px solid #e2e8f0' };
