import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarDays,
  CheckCheck,
  ChevronDown,
  Headphones,
  Info,
  Mail,
  MessageCircle,
  MoreHorizontal,
  Paperclip,
  RefreshCw,
  Search,
  Send,
  Star,
} from 'lucide-react';
import supabase from '../../lib/supabase';

const ACCENT = '#f05a28';

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

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function dayLabel(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(d, now)) return 'اليوم';
  if (isSameDay(d, yesterday)) return 'أمس';
  return d.toLocaleDateString('ar-EG-u-nu-latn', { day: 'numeric', month: 'long', year: 'numeric' });
}

function listTimeLabel(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(d, now)) return d.toLocaleTimeString('ar-EG-u-nu-latn', { hour: '2-digit', minute: '2-digit' });
  if (isSameDay(d, yesterday)) return 'أمس';
  return d.toLocaleDateString('ar-EG-u-nu-latn', { day: 'numeric', month: 'short' });
}

function timeLabel(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString('ar-EG-u-nu-latn', { hour: '2-digit', minute: '2-digit' });
}

interface Props {
  userId: string;
}

export default function DriverMessagesInbox({ userId }: Props) {
  const [messages, setMessages]         = useState<Msg[]>([]);
  const [loading, setLoading]           = useState(true);
  const [activeThread, setActiveThread] = useState<string | null>(null);
  const [query, setQuery]               = useState('');
  const [filter, setFilter]             = useState<'all' | 'unread'>('all');

  const [draft, setDraft]               = useState('');
  const [sending, setSending]           = useState(false);
  const [sendError, setSendError]       = useState('');

  const bottomRef = useRef<HTMLDivElement>(null);
  const draftRef  = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { load(); }, [userId]);

  useEffect(() => {
    const ch = supabase.channel('driver-inbox-rt-' + userId)
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

  // ── Stats ──────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const now = new Date();
    const unread = messages.filter(m => m.recipient_id === userId && !m.read_at).length;
    const today  = messages.filter(m => isSameDay(new Date(m.created_at), now)).length;
    return { unread, today, total: messages.length };
  }, [messages, userId]);

  // ── Filtered + searched threads ────────────────────────────────────────
  const visibleThreads = useMemo(() => {
    const q = query.trim().toLowerCase();
    return threads.filter(t => {
      if (filter === 'unread' && t.unreadCount === 0) return false;
      if (q) return t.rootSubject.toLowerCase().includes(q) || t.latestPreview.toLowerCase().includes(q);
      return true;
    });
  }, [threads, filter, query]);

  async function openThread(key: string) {
    setActiveThread(key);
    setDraft('');
    setSendError('');
    const thread = threads.find(t => t.key === key);
    if (!thread) return;
    const unread = thread.messages.filter(m => m.recipient_id === userId && !m.read_at);
    if (unread.length > 0) {
      const now = new Date().toISOString();
      const ids = unread.map(m => m.id);
      await supabase.from('admin_messages').update({ read_at: now }).in('id', ids);
      setMessages(prev => prev.map(m => ids.includes(m.id) ? { ...m, read_at: now } : m));
    }
    setTimeout(() => draftRef.current?.focus(), 150);
  }

  async function sendMessage() {
    const trimmed = draft.trim();
    if (!trimmed) return;
    const thread = threads.find(t => t.key === activeThread);
    if (!thread?.otherPartyId) return;
    setSending(true);
    setSendError('');
    const { error } = await supabase.from('admin_messages').insert({
      recipient_id:   thread.otherPartyId,
      recipient_name: 'المشرف',
      subject:        `رد: ${thread.rootSubject}`,
      body:           trimmed,
    });
    if (error) {
      setSendError('تعذّر إرسال الرسالة، حاول مرة أخرى.');
      setSending(false);
      return;
    }
    setDraft('');
    setSending(false);
  }

  const thread = threads.find(t => t.key === activeThread) ?? null;

  // ── Group active thread messages by day ────────────────────────────────
  const groupedMessages = useMemo(() => {
    if (!thread) return [] as { day: string; items: Msg[] }[];
    const groups: { day: string; items: Msg[] }[] = [];
    for (const m of thread.messages) {
      const label = dayLabel(m.created_at);
      const last = groups[groups.length - 1];
      if (last && last.day === label) last.items.push(m);
      else groups.push({ day: label, items: [m] });
    }
    return groups;
  }, [thread]);

  return (
    <div dir="rtl" className="text-slate-900" style={{ fontFamily: "'Tajawal', sans-serif" }}>

      {/* ── Stat cards ── */}
      <section className="mb-5 grid gap-4 sm:grid-cols-3">
        <StatCard icon={<MessageCircle size={22} />} value={stats.unread} label="غير مقروءة" bg="bg-orange-50" color={ACCENT} />
        <StatCard icon={<CalendarDays size={22} />}  value={stats.today}  label="رسائل اليوم" bg="bg-blue-50" colorClass="text-blue-600" />
        <StatCard icon={<Mail size={22} />}          value={stats.total}  label="كل الرسائل" bg="bg-emerald-50" colorClass="text-emerald-600" />
      </section>

      {/* ── Search + filter + refresh ── */}
      <section className="mb-5 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:flex-row md:items-center">
        <div className="relative flex-1">
          <Search size={19} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="ابحث في الرسائل..."
            className="h-12 w-full rounded-xl border border-slate-200 bg-slate-50 pr-11 pl-4 outline-none transition focus:border-[#f05a28] focus:bg-white focus:ring-4 focus:ring-orange-100"
          />
        </div>

        <div className="relative min-w-[150px]">
          <select
            value={filter}
            onChange={e => setFilter(e.target.value as 'all' | 'unread')}
            className="h-12 w-full appearance-none rounded-xl border border-slate-200 bg-white px-4 pl-10 outline-none focus:border-[#f05a28]"
            style={{ fontFamily: 'inherit' }}
          >
            <option value="all">كل الرسائل</option>
            <option value="unread">غير المقروءة</option>
          </select>
          <ChevronDown size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        </div>

        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="grid h-12 w-12 shrink-0 place-items-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
          aria-label="تحديث"
        >
          <RefreshCw size={19} className={loading ? 'animate-spin' : ''} />
        </button>
      </section>

      {/* ── Conversations + chat ── */}
      <section className="grid h-[calc(100vh-340px)] min-h-[440px] overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm xl:grid-cols-[360px_minmax(0,1fr)]">

        {/* Conversation list */}
        <aside className="flex min-h-0 flex-col border-b border-slate-200 xl:border-b-0 xl:border-l">
          <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-5 py-4">
            <h2 className="font-extrabold">المحادثات</h2>
            <span className="flex items-center gap-2 text-sm text-slate-500">
              الأحدث
              <ChevronDown size={16} />
            </span>
          </div>

          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
            {loading ? (
              <div className="py-14 text-center text-sm text-slate-400">جاري التحميل...</div>
            ) : visibleThreads.length === 0 ? (
              <div className="py-14 text-center text-sm text-slate-500">لا توجد رسائل مطابقة.</div>
            ) : visibleThreads.map(t => {
              const active = activeThread === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => openThread(t.key)}
                  className={[
                    'flex w-full items-start gap-3 rounded-2xl border p-3 text-right transition',
                    active
                      ? 'border-orange-300 bg-orange-50'
                      : 'border-transparent bg-white hover:border-slate-200 hover:bg-slate-50',
                  ].join(' ')}
                >
                  <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-slate-900 text-white">
                    <Headphones size={20} />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-3">
                      <div className={`truncate ${t.unreadCount > 0 ? 'font-extrabold' : 'font-bold'}`}>
                        {t.rootSubject || 'فريق دعم سوق لينك'}
                      </div>
                      <span className="shrink-0 text-xs text-slate-400">{listTimeLabel(t.latestAt)}</span>
                    </div>

                    <div className="mt-1 flex items-center gap-2">
                      <p className={`min-w-0 flex-1 truncate text-sm ${t.unreadCount > 0 ? 'text-slate-600 font-semibold' : 'text-slate-500'}`}>
                        {t.latestPreview || '...'}
                      </p>
                      {t.unreadCount > 0 && (
                        <span className="grid h-5 min-w-5 place-items-center rounded-full px-1 text-[10px] font-bold text-white" style={{ background: ACCENT }}>
                          {t.unreadCount}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        {/* Chat panel */}
        <div className="flex min-h-0 min-w-0 flex-col">
          {!thread ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-slate-300">
              <MessageCircle size={54} strokeWidth={1.3} />
              <p className="text-sm font-semibold text-slate-400">اختر محادثة لعرض الرسائل</p>
            </div>
          ) : (
            <>
              {/* Chat header */}
              <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-5 py-4">
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-slate-900 text-white">
                      <Headphones size={20} />
                    </div>
                    <span className="absolute bottom-0 left-0 h-3 w-3 rounded-full border-2 border-white bg-emerald-500" />
                  </div>
                  <div className="min-w-0">
                    <div className="truncate font-extrabold">فريق دعم سوق لينك</div>
                    <div className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
                      <span className="h-2 w-2 rounded-full bg-emerald-500" />
                      متصل · {thread.rootSubject}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  {[Star, Info, MoreHorizontal].map((Icon, index) => (
                    <button key={index} type="button" className="rounded-xl p-2.5 text-slate-500 hover:bg-slate-100">
                      <Icon size={19} />
                    </button>
                  ))}
                </div>
              </div>

              {/* Messages */}
              <div className="min-h-0 flex-1 overflow-y-auto bg-[#fbfbfd] p-5 md:p-7">
                {groupedMessages.map((group, gi) => (
                  <div key={gi}>
                    <div className="mb-7 flex items-center gap-4">
                      <div className="h-px flex-1 bg-slate-200" />
                      <span className="text-xs text-slate-400">{group.day}</span>
                      <div className="h-px flex-1 bg-slate-200" />
                    </div>

                    <div className="space-y-5">
                      {group.items.map(msg => {
                        const isMine = msg.sender_id === userId;
                        return (
                          <div key={msg.id} className={['flex', isMine ? 'justify-start' : 'justify-end'].join(' ')}>
                            <div
                              className={[
                                'max-w-[82%] rounded-2xl px-4 py-3 text-sm leading-7 shadow-sm md:max-w-[68%]',
                                isMine
                                  ? 'rounded-tr-sm border border-orange-200 bg-orange-50'
                                  : 'rounded-tl-sm border border-slate-200 bg-white',
                              ].join(' ')}
                            >
                              <p className="whitespace-pre-line">{msg.body ?? <em className="opacity-60">لا يوجد نص</em>}</p>
                              <div className={['mt-2 flex items-center gap-1 text-[11px] text-slate-400', isMine ? 'justify-start' : 'justify-end'].join(' ')}>
                                {isMine && msg.read_at && <CheckCheck size={15} className="text-blue-500" />}
                                <span>{timeLabel(msg.created_at)}</span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
                <div ref={bottomRef} />
              </div>

              {/* Composer */}
              {thread.otherPartyId ? (
                <div className="shrink-0 border-t border-slate-200 bg-white p-4">
                  {sendError && <p className="mb-2 text-xs text-red-500">{sendError}</p>}
                  <div className="flex items-end gap-3">
                    <button type="button" className="grid h-12 w-12 shrink-0 place-items-center rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50" aria-label="إرفاق">
                      <Paperclip size={20} />
                    </button>

                    <textarea
                      ref={draftRef}
                      value={draft}
                      onChange={e => setDraft(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                      rows={1}
                      disabled={sending}
                      placeholder="اكتب رسالتك هنا..."
                      className="min-h-12 max-h-32 flex-1 resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-[#f05a28] focus:bg-white focus:ring-4 focus:ring-orange-100 disabled:opacity-60"
                      style={{ fontFamily: 'inherit' }}
                    />

                    <button
                      type="button"
                      onClick={sendMessage}
                      disabled={!draft.trim() || sending}
                      className="flex h-12 shrink-0 items-center gap-2 rounded-xl px-5 font-bold text-white shadow-lg shadow-orange-200 transition hover:brightness-95 disabled:opacity-50"
                      style={{ background: ACCENT }}
                    >
                      <Send size={18} />
                      <span className="hidden sm:inline">إرسال</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="border-t border-slate-200 bg-white px-4 py-3 text-center text-xs text-slate-400">
                  هذه الرسالة لا تدعم الرد المباشر
                </div>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}

function StatCard({
  icon, value, label, bg, color, colorClass,
}: {
  icon: React.ReactNode; value: number; label: string; bg: string; color?: string; colorClass?: string;
}) {
  return (
    <div className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className={`grid h-12 w-12 place-items-center rounded-2xl ${bg} ${colorClass ?? ''}`} style={color ? { color } : undefined}>
        {icon}
      </div>
      <div>
        <div className="text-2xl font-extrabold">{value}</div>
        <div className="text-sm text-slate-500">{label}</div>
      </div>
    </div>
  );
}

