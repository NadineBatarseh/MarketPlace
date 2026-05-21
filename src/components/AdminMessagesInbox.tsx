import { useState, useEffect, useRef, useMemo } from 'react';
import supabase from '../lib/supabase';

interface Msg {
  id: string;
  sender_id: string | null;
  recipient_id: string;
  recipient_name: string;
  subject: string;
  body: string | null;
  created_at: string;
  read_at: string | null;
}

interface Thread {
  key: string;
  rootSubject: string;
  messages: Msg[];
  otherPartyId: string | null;
  unreadCount: number;
  latestAt: string;
  latestPreview: string;
}

function getRootSubject(subject: string): string {
  return subject.replace(/^(رد:\s*)+/gi, '').trim();
}

function mergeMsg(prev: Msg[], next: Msg): Msg[] {
  if (prev.find(m => m.id === next.id)) return prev;
  return [...prev, next].sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at));
}

interface Props {
  userId: string;
}

export default function AdminMessagesInbox({ userId }: Props) {
  const [messages, setMessages]         = useState<Msg[]>([]);
  const [loading, setLoading]           = useState(true);
  const [activeThread, setActiveThread] = useState<string | null>(null);

  const [replyBody, setReplyBody]       = useState('');
  const [replySending, setReplySending] = useState(false);
  const [replyError, setReplyError]     = useState('');
  const [replySent, setReplySent]       = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const replyRef  = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { load(); }, [userId]);

  useEffect(() => {
    const ch = supabase.channel('inbox-rt-' + userId)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'admin_messages',
        filter: `recipient_id=eq.${userId}`,
      }, (p) => setMessages(prev => mergeMsg(prev, p.new as Msg)))
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'admin_messages',
        filter: `sender_id=eq.${userId}`,
      }, (p) => setMessages(prev => mergeMsg(prev, p.new as Msg)))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [userId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeThread, messages.length]);

  async function load() {
    setLoading(true);
    const [r1, r2] = await Promise.all([
      supabase.from('admin_messages')
        .select('id,sender_id,recipient_id,recipient_name,subject,body,created_at,read_at')
        .eq('recipient_id', userId)
        .order('created_at', { ascending: true }),
      supabase.from('admin_messages')
        .select('id,sender_id,recipient_id,recipient_name,subject,body,created_at,read_at')
        .eq('sender_id', userId)
        .order('created_at', { ascending: true }),
    ]);
    const all = [...(r1.data ?? []), ...(r2.data ?? [])];
    const unique = Array.from(new Map(all.map((m: Msg) => [m.id, m])).values()) as Msg[];
    unique.sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at));
    setMessages(unique);
    setLoading(false);
  }

  const threads = useMemo((): Thread[] => {
    const map = new Map<string, Msg[]>();
    for (const msg of messages) {
      const key = getRootSubject(msg.subject);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(msg);
    }
    return Array.from(map.entries())
      .map(([rootSubject, msgs]) => {
        const otherMsg     = msgs.find(m => m.sender_id !== userId);
        const otherPartyId = otherMsg?.sender_id ?? null;
        const unreadCount  = msgs.filter(m => m.recipient_id === userId && !m.read_at).length;
        const latest       = msgs[msgs.length - 1];
        return {
          key: rootSubject,
          rootSubject,
          messages: msgs,
          otherPartyId,
          unreadCount,
          latestAt:      latest.created_at,
          latestPreview: latest.body ?? '',
        };
      })
      .sort((a, b) => +new Date(b.latestAt) - +new Date(a.latestAt));
  }, [messages, userId]);

  async function openThread(key: string) {
    setActiveThread(key);
    setReplyBody('');
    setReplyError('');
    setReplySent(false);
    const thread = threads.find(t => t.key === key);
    if (!thread) return;
    const unread = thread.messages.filter(m => m.recipient_id === userId && !m.read_at);
    if (unread.length > 0) {
      const now = new Date().toISOString();
      const ids = unread.map(m => m.id);
      await supabase.from('admin_messages').update({ read_at: now }).in('id', ids);
      setMessages(prev => prev.map(m => ids.includes(m.id) ? { ...m, read_at: now } : m));
    }
    setTimeout(() => replyRef.current?.focus(), 150);
  }

  async function sendReply() {
    if (!replyBody.trim()) return;
    const thread = threads.find(t => t.key === activeThread);
    if (!thread?.otherPartyId) return;
    setReplySending(true);
    setReplyError('');
    const { error } = await supabase.from('admin_messages').insert({
      recipient_id:   thread.otherPartyId,
      recipient_name: 'المشرف',
      subject:        `رد: ${thread.rootSubject}`,
      body:           replyBody.trim(),
    });
    if (error) {
      setReplyError('تعذّر إرسال الرد، حاول مرة أخرى.');
      setReplySending(false);
      return;
    }
    setReplySent(true);
    setReplyBody('');
    setReplySending(false);
    setTimeout(() => setReplySent(false), 3000);
  }

  const thread      = threads.find(t => t.key === activeThread) ?? null;
  const totalUnread = threads.reduce((s, t) => s + t.unreadCount, 0);

  return (
    <div dir="rtl" style={{ fontFamily: "'Tajawal', sans-serif" }} className="text-[#0F2B4E]">

      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2.5">
          <h2 className="text-lg font-extrabold m-0">صندوق الرسائل</h2>
          {totalUnread > 0 && (
            <span className="bg-[#136540] text-white rounded-full px-2.5 py-0.5 text-xs font-bold">
              {totalUnread} جديد
            </span>
          )}
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="px-3.5 py-1.5 rounded-lg border border-slate-200 bg-white text-[#0F2B4E] text-xs font-medium hover:bg-slate-50 transition-colors disabled:opacity-50 cursor-pointer"
        >
          ↻ تحديث
        </button>
      </div>

      {loading ? (
        <div className="text-center py-12 text-slate-400 text-sm">جاري التحميل...</div>
      ) : threads.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <svg width="40" height="40" fill="none" viewBox="0 0 24 24" stroke="#CBD5E1" strokeWidth="1.5" className="mx-auto mb-3 block">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
          <p className="text-sm font-semibold m-0">لا توجد رسائل بعد</p>
        </div>
      ) : (
        <div className={`flex flex-col gap-4 ${activeThread ? 'md:grid md:grid-cols-[280px_1fr]' : ''}`}>

          {/* ── Thread list ── */}
          <div className={`${activeThread ? 'hidden md:block' : ''} rounded-xl border border-slate-200 overflow-hidden bg-white shadow-sm`}>
            {threads.map((t, i) => (
              <div
                key={t.key}
                onClick={() => openThread(t.key)}
                className={[
                  'px-4 py-5 cursor-pointer transition-colors border-r-[3px]',
                  i < threads.length - 1 ? 'border-b border-b-slate-100' : '',
                  activeThread === t.key
                    ? 'bg-green-50 border-r-[#136540]'
                    : `hover:bg-slate-50 ${t.unreadCount > 0 ? 'border-r-[#136540]' : 'border-r-transparent'}`,
                ].join(' ')}
              >
                <div className="flex items-start gap-4">
                  <div className={[
                    'w-11 h-11 rounded-xl flex-shrink-0 flex items-center justify-center font-extrabold text-sm',
                    activeThread === t.key
                      ? 'bg-[#136540] text-white'
                      : t.unreadCount > 0
                        ? 'bg-green-50 text-[#136540]'
                        : 'bg-slate-100 text-slate-500',
                  ].join(' ')}>
                    س
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span className={`text-sm truncate ${t.unreadCount > 0 ? 'font-extrabold text-[#0F2B4E]' : 'font-semibold text-[#0F2B4E]'}`}>
                        {t.rootSubject}
                      </span>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {t.unreadCount > 0 && (
                          <span className="bg-[#136540] text-white rounded-full px-1.5 py-px text-[10px] font-bold">
                            {t.unreadCount}
                          </span>
                        )}
                        <span className="text-[10px] text-slate-300">
                          {new Date(t.latestAt).toLocaleDateString('ar-EG', { month: 'short', day: 'numeric' })}
                        </span>
                      </div>
                    </div>
                    <p style={{ margin: 0 }} className="text-[11px] text-slate-500 truncate font-medium">فريق سوق لينك</p>
                    <p style={{ margin: '5px 0 0' }} className="text-[11px] text-slate-400 truncate">{t.latestPreview || '...'}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* ── Chat panel ── */}
          {thread && (
            <div className="rounded-xl border border-slate-200 bg-white flex flex-col overflow-hidden shadow-sm" style={{ height: 500 }}>

              {/* Chat header */}
              <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between bg-white flex-shrink-0">
                <div className="flex items-center gap-2.5">
                  {/* Mobile: back button */}
                  <button
                    onClick={() => setActiveThread(null)}
                    className="md:hidden w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100 transition-colors ml-1"
                    aria-label="رجوع"
                  >
                    <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                      <path d="M9 18l6-6-6-6"/>
                    </svg>
                  </button>
                  <div className="w-9 h-9 rounded-xl bg-[#0F2B4E] text-white flex items-center justify-center font-extrabold text-sm flex-shrink-0">
                    س
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-extrabold text-[#0F2B4E] m-0 leading-tight">فريق سوق لينك</p>
                    <p className="text-xs text-slate-400 truncate max-w-[180px] m-0">{thread.rootSubject}</p>
                  </div>
                </div>
                {/* Desktop: close button */}
                <button
                  onClick={() => setActiveThread(null)}
                  className="hidden md:flex w-7 h-7 rounded-lg items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 text-lg leading-none transition-all"
                >
                  ×
                </button>
              </div>

              {/* Messages area */}
              <div className="flex-1 overflow-y-auto px-5 py-6 flex flex-col gap-6 bg-slate-50/40">
                {thread.messages.map(msg => {
                  const isMine = msg.sender_id === userId;
                  return (
                    <div
                      key={msg.id}
                      className={`flex items-end gap-3 ${isMine ? 'flex-row' : 'flex-row-reverse'}`}
                    >
                      {/* Avatar */}
                      <div className={[
                        'w-7 h-7 rounded-lg flex-shrink-0 flex items-center justify-center font-extrabold text-[11px] text-white',
                        isMine ? 'bg-[#136540]' : 'bg-[#0F2B4E]',
                      ].join(' ')}>
                        {isMine ? 'أ' : 'س'}
                      </div>

                      <div className="max-w-[70%]">
                        {/* Bubble */}
                        <div className={[
                          'px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap',
                          isMine
                            ? 'bg-[#136540] text-white shadow-sm shadow-green-900/10'
                            : 'bg-white text-slate-800 border border-slate-200 shadow-sm',
                        ].join(' ')}
                        style={{ borderRadius: isMine ? '0.25rem 1rem 1rem 1rem' : '1rem 0.25rem 1rem 1rem' }}
                        >
                          {msg.body ?? <em className="opacity-60">لا يوجد نص</em>}
                        </div>

                        {/* Timestamp + read receipt */}
                        <div className={`flex items-center gap-1 mt-2 ${isMine ? 'justify-start' : 'justify-end'}`}>
                          <span className="text-[10px] text-slate-400">
                            {new Date(msg.created_at).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                          {isMine && msg.read_at && (
                            <svg width="11" height="11" fill="none" viewBox="0 0 24 24" stroke="#136540" strokeWidth="2.5">
                              <polyline points="20 6 9 17 4 12"/>
                            </svg>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div ref={bottomRef} />
              </div>

              {/* Reply box */}
              {thread.otherPartyId ? (
                <div className="border-t border-slate-100 p-3 bg-white flex-shrink-0">
                  {replyError && (
                    <p className="text-xs text-red-500 mb-2 m-0">{replyError}</p>
                  )}
                  <div className="flex gap-2.5 items-end">
                    <textarea
                      ref={replyRef}
                      value={replyBody}
                      onChange={e => setReplyBody(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReply(); } }}
                      placeholder="اكتب ردّك... (Enter للإرسال، Shift+Enter لسطر جديد)"
                      rows={2}
                      disabled={replySending}
                      className="flex-1 px-3 py-2.5 rounded-xl border border-slate-200 text-sm text-[#0F2B4E] placeholder:text-slate-400 focus:outline-none focus:border-[#136540] focus:ring-2 focus:ring-[#136540]/10 resize-none transition-all disabled:opacity-60 bg-slate-50/60"
                      style={{ fontFamily: 'inherit' }}
                    />
                    <div className="flex flex-col gap-1 items-center flex-shrink-0">
                      {replySent && (
                        <span className="text-[10px] text-[#136540] font-extrabold">✓</span>
                      )}
                      <button
                        onClick={sendReply}
                        disabled={!replyBody.trim() || replySending}
                        className={[
                          'w-10 h-10 rounded-full flex items-center justify-center transition-all',
                          replyBody.trim() && !replySending
                            ? 'bg-[#136540] hover:bg-[#0e4f32] cursor-pointer shadow-md shadow-green-900/20'
                            : 'bg-slate-200 cursor-not-allowed',
                        ].join(' ')}
                      >
                        <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="white" strokeWidth="2.5">
                          <line x1="22" y1="2" x2="11" y2="13"/>
                          <polygon points="22 2 15 22 11 13 2 9 22 2"/>
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="border-t border-slate-100 px-4 py-3 bg-white flex-shrink-0">
                  <p className="text-xs text-slate-400 text-center m-0">هذه الرسالة لا تدعم الرد المباشر</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
