import { useState } from 'react';
import supabase from '../lib/supabase';

interface Props {
  recipientName: string;
  recipientId: string | null;
  onClose: () => void;
}

export default function AdminMessageModal({ recipientName, recipientId, onClose }: Props) {
  const [subject, setSubject] = useState('');
  const [body, setBody]       = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError]     = useState('');
  const [sent, setSent]       = useState(false);

  async function handleSend() {
    if (!recipientId || !subject.trim()) return;
    setSending(true);
    setError('');
    const { error: err } = await supabase.from('admin_messages').insert({
      recipient_id:   recipientId,
      recipient_name: recipientName,
      subject:        subject.trim(),
      body:           body.trim() || null,
    });
    if (err) {
      setError('تعذّر إرسال الرسالة، حاول مرة أخرى.');
      setSending(false);
      return;
    }
    setSent(true);
    setTimeout(onClose, 1500);
  }

  const canSend = !!recipientId && subject.trim().length > 0 && !sending && !sent;

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
            <span className="w-7 h-7 rounded-lg bg-green-50 flex items-center justify-center flex-shrink-0">
              <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="#136540" strokeWidth="2">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
            </span>
            إرسال رسالة
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
              <div className="w-14 h-14 rounded-full bg-green-50 flex items-center justify-center mx-auto mb-3">
                <svg width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="#136540" strokeWidth="2.5">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              </div>
              <p className="text-sm font-bold text-green-700 m-0">تم إرسال الرسالة بنجاح!</p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* To field */}
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1.5">إلى</label>
                <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50">
                  <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="#94A3B8" strokeWidth="2">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
                  </svg>
                  <span className="text-sm font-semibold text-[#0F2B4E]">{recipientName}</span>
                  {!recipientId && (
                    <span className="text-xs text-red-500 mr-1">لا يوجد حساب مرتبط</span>
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
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm text-[#0F2B4E] placeholder:text-slate-400 focus:outline-none focus:border-[#136540] focus:ring-2 focus:ring-[#136540]/10 transition-all disabled:opacity-60 bg-white"
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
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm text-[#0F2B4E] placeholder:text-slate-400 focus:outline-none focus:border-[#136540] focus:ring-2 focus:ring-[#136540]/10 transition-all resize-y disabled:opacity-60 bg-white"
                  style={{ fontFamily: 'inherit' }}
                />
              </div>

              {error && (
                <p className="text-xs text-red-500 font-semibold m-0">{error}</p>
              )}

              <div className="flex gap-2.5 pt-1">
                <button
                  onClick={handleSend}
                  disabled={!canSend}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white bg-[#136540] hover:bg-[#0e4f32] disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed transition-colors shadow-sm shadow-green-900/10"
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
