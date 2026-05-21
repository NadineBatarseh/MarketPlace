import { useState } from 'react';
import emailjs from '@emailjs/browser';

interface Props {
  recipientName: string;
  recipientEmail: string | null;
  loadingEmail: boolean;
  onClose: () => void;
}

export default function EmailComposeModal({ recipientName, recipientEmail, loadingEmail, onClose }: Props) {
  const [subject, setSubject]   = useState('');
  const [body, setBody]         = useState('');
  const [sending, setSending]   = useState(false);
  const [sendError, setSendError] = useState('');
  const [sent, setSent]         = useState(false);

  async function handleSend() {
    if (!recipientEmail || !subject.trim()) return;
    setSending(true);
    setSendError('');
    try {
      await emailjs.send(
        import.meta.env.VITE_EMAILJS_SERVICE_ID,
        import.meta.env.VITE_EMAILJS_TEMPLATE_ID,
        {
          name:    recipientName,
          email:   recipientEmail,
          subject: subject,
          message: body,
        },
        { publicKey: import.meta.env.VITE_EMAILJS_PUBLIC_KEY }
      );
      setSent(true);
      setTimeout(onClose, 1500);
    } catch {
      setSendError('تعذّر إرسال البريد الإلكتروني، حاول مرة أخرى.');
    } finally {
      setSending(false);
    }
  }

  const canSend = !!recipientEmail && subject.trim().length > 0 && !sending && !sent;

  return (
    <div
      dir="rtl"
      onClick={sending ? undefined : onClose}
      className="fixed inset-0 bg-[#0F2B4E]/50 backdrop-blur-sm flex items-center justify-center z-[9999] p-4"
      style={{ fontFamily: "'Tajawal', sans-serif" }}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="bg-white rounded-2xl w-full max-w-md shadow-2xl shadow-slate-900/20 overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h3 className="text-sm font-bold text-[#0F2B4E] flex items-center gap-2 m-0">
            <span className="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
              <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="#2563eb" strokeWidth="2">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                <polyline points="22,6 12,13 2,6"/>
              </svg>
            </span>
            إرسال إيميل
          </h3>
          <button
            onClick={onClose}
            disabled={sending}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 text-lg leading-none disabled:cursor-not-allowed transition-all"
          >
            ×
          </button>
        </div>

        <div className="px-5 py-5">
          {sent ? (
            <div className="text-center py-8">
              <div className="w-14 h-14 rounded-full bg-blue-50 flex items-center justify-center mx-auto mb-3">
                <svg width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="#2563eb" strokeWidth="2.5">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              </div>
              <p className="text-sm font-bold text-blue-700 m-0">تم إرسال البريد الإلكتروني بنجاح!</p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* To field */}
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1.5">إلى</label>
                <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 flex-wrap">
                  <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="#94A3B8" strokeWidth="2">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
                  </svg>
                  <span className="text-sm font-semibold text-[#0F2B4E]">{recipientName}</span>
                  {loadingEmail ? (
                    <span className="text-xs text-slate-400 mr-1">جاري تحميل الإيميل...</span>
                  ) : recipientEmail ? (
                    <span className="text-xs text-slate-500 mr-1">({recipientEmail})</span>
                  ) : (
                    <span className="text-xs text-red-500 mr-1">لا يوجد إيميل مسجّل</span>
                  )}
                </div>
              </div>

              {/* Subject */}
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1.5">الموضوع</label>
                <input
                  value={subject}
                  onChange={e => setSubject(e.target.value)}
                  placeholder="اكتب موضوع الرسالة..."
                  disabled={sending}
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm text-[#0F2B4E] placeholder:text-slate-400 focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-400/10 transition-all disabled:opacity-60 bg-white"
                  style={{ fontFamily: 'inherit' }}
                />
              </div>

              {/* Body */}
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1.5">نص الرسالة</label>
                <textarea
                  value={body}
                  onChange={e => setBody(e.target.value)}
                  placeholder="اكتب نص الرسالة هنا..."
                  rows={5}
                  disabled={sending}
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm text-[#0F2B4E] placeholder:text-slate-400 focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-400/10 transition-all resize-y disabled:opacity-60 bg-white"
                  style={{ fontFamily: 'inherit' }}
                />
              </div>

              {sendError && (
                <p className="text-xs text-red-500 font-semibold m-0">{sendError}</p>
              )}

              <div className="flex gap-2.5 pt-1">
                <button
                  onClick={handleSend}
                  disabled={!canSend}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed transition-colors shadow-sm shadow-blue-900/10"
                  style={{ fontFamily: 'inherit' }}
                >
                  {sending ? 'جاري الإرسال...' : (
                    <>
                      <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                        <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
                      </svg>
                      إرسال
                    </>
                  )}
                </button>
                <button
                  onClick={onClose}
                  disabled={sending}
                  className="px-5 py-2.5 rounded-xl border border-slate-200 text-sm font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                  style={{ fontFamily: 'inherit' }}
                >
                  إلغاء
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
