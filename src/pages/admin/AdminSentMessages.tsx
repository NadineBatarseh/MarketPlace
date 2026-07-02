import { useState, useEffect, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import supabase from '../../lib/supabase';
import { useLanguage } from '../../context/LanguageContext';
import AdminMessageModal from '../../components/AdminMessageModal';

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

interface Conversation {
  key: string;
  rootSubject: string;
  otherPartyId: string;
  otherPartyName: string;
  messages: Msg[];
  unreadCount: number;
  latestAt: string;
  latestPreview: string;
}

interface Recipient {
  id: string;
  name: string;
  type: 'courier' | 'shop';
}

function getRootSubject(subject: string): string {
  return subject.replace(/^(رد:\s*)+/gi, '').trim();
}

function mergeMsg(prev: Msg[], next: Msg): Msg[] {
  if (prev.find(m => m.id === next.id)) return prev;
  return [...prev, next].sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at));
}

export default function AdminSentMessages() {
  const { t } = useTranslation('admin');
  const { direction, lang } = useLanguage();
  const numLocale = lang === 'ar' ? 'ar-EG' : 'en-US';
  const [messages, setMessages]   = useState<Msg[]>([]);
  const [adminId, setAdminId]     = useState<string | null>(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');
  const [activeConv, setActiveConv] = useState<string | null>(null);
  const [search, setSearch]       = useState('');

  const [replyBody, setReplyBody]       = useState('');
  const [replySending, setReplySending] = useState(false);
  const [replyError, setReplyError]     = useState('');
  const [replySent, setReplySent]       = useState(false);

  const [showCompose, setShowCompose]             = useState(false);
  const [recipients, setRecipients]               = useState<Recipient[]>([]);
  const [recipientsLoading, setRecipientsLoading] = useState(false);
  const [selectedRecipient, setSelectedRecipient] = useState<Recipient | null>(null);
  const [recipientSearch, setRecipientSearch]     = useState('');
  const [showDropdown, setShowDropdown]           = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const replyRef  = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!adminId) return;
    const ch = supabase.channel('admin-msgs-rt-' + adminId)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'admin_messages',
      }, (p) => setMessages(prev => mergeMsg(prev, p.new as Msg)))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [adminId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeConv, messages.length]);

  async function load() {
    setLoading(true);
    setError('');
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }
    setAdminId(user.id);

    const [{ data: sent, error: e1 }, { data: recv, error: e2 }] = await Promise.all([
      supabase.from('admin_messages')
        .select('id,sender_id,recipient_id,recipient_name,subject,body,created_at,read_at')
        .eq('sender_id', user.id)
        .order('created_at', { ascending: true }),
      supabase.from('admin_messages')
        .select('id,sender_id,recipient_id,recipient_name,subject,body,created_at,read_at')
        .eq('recipient_id', user.id)
        .order('created_at', { ascending: true }),
    ]);

    if (e1 || e2) { setError(t('sentMessages.loadError')); setLoading(false); return; }

    const all = [...(sent ?? []), ...(recv ?? [])];
    const unique = Array.from(new Map(all.map((m: Msg) => [m.id, m])).values()) as Msg[];
    unique.sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at));
    setMessages(unique);
    setLoading(false);
  }

  const { conversations } = useMemo(() => {
    if (!adminId) return { conversations: [] };

    const nameLookup: Record<string, string> = {};
    for (const msg of messages) {
      if (msg.sender_id === adminId) {
        nameLookup[msg.recipient_id] = msg.recipient_name;
      }
    }

    const convMap = new Map<string, Msg[]>();
    for (const msg of messages) {
      const otherPartyId = msg.sender_id === adminId ? msg.recipient_id : (msg.sender_id ?? '');
      if (!otherPartyId) continue;
      const root = getRootSubject(msg.subject);
      const key  = `${otherPartyId}|${root}`;
      if (!convMap.has(key)) convMap.set(key, []);
      convMap.get(key)!.push(msg);
    }

    const convs: Conversation[] = Array.from(convMap.entries()).map(([key, msgs]) => {
      const [otherPartyId] = key.split('|');
      const otherPartyName = nameLookup[otherPartyId] ?? t('sentMessages.defaultUser');
      const root           = getRootSubject(msgs[0].subject);
      const unreadCount    = msgs.filter(m => m.recipient_id === adminId && !m.read_at).length;
      const latest         = msgs[msgs.length - 1];
      return {
        key,
        rootSubject:   root,
        otherPartyId,
        otherPartyName,
        messages:      msgs,
        unreadCount,
        latestAt:      latest.created_at,
        latestPreview: latest.body ?? '',
      };
    }).sort((a, b) => +new Date(b.latestAt) - +new Date(a.latestAt));

    return { conversations: convs };
  }, [messages, adminId, t]);

  const filteredConversations = useMemo(() =>
    search.trim()
      ? conversations.filter(c =>
          c.otherPartyName.includes(search) || c.rootSubject.includes(search)
        )
      : conversations,
    [conversations, search]
  );

  async function openConv(key: string) {
    setActiveConv(key);
    setReplyBody('');
    setReplyError('');
    setReplySent(false);
    const conv = conversations.find(c => c.key === key);
    if (!conv) return;
    const unread = conv.messages.filter(m => m.recipient_id === adminId && !m.read_at);
    if (unread.length > 0) {
      const now = new Date().toISOString();
      const ids = unread.map(m => m.id);
      await supabase.from('admin_messages').update({ read_at: now }).in('id', ids);
      setMessages(prev => prev.map(m => ids.includes(m.id) ? { ...m, read_at: now } : m));
    }
    setTimeout(() => replyRef.current?.focus(), 150);
  }

  async function sendReply() {
    if (!replyBody.trim() || !adminId) return;
    const conv = conversations.find(c => c.key === activeConv);
    if (!conv) return;
    setReplySending(true);
    setReplyError('');
    const { error: err } = await supabase.from('admin_messages').insert({
      recipient_id:   conv.otherPartyId,
      recipient_name: conv.otherPartyName,
      subject:        `رد: ${conv.rootSubject}`,
      body:           replyBody.trim(),
    });
    if (err) {
      setReplyError(t('sentMessages.replyError'));
      setReplySending(false);
      return;
    }
    setReplySent(true);
    setReplyBody('');
    setReplySending(false);
    setTimeout(() => setReplySent(false), 3000);
  }

  async function loadRecipients() {
    setRecipientsLoading(true);
    const [{ data: couriers }, { data: shops }] = await Promise.all([
      supabase.from('couriers').select('id, name').order('name'),
      supabase.from('shops').select('name, merchants!inner(user_id)').order('name'),
    ]);
    setRecipients([
      ...(couriers ?? []).map((c: any) => ({ id: c.id, name: c.name, type: 'courier' as const })),
      ...(shops ?? []).filter((s: any) => s.merchants?.user_id).map((s: any) => ({ id: s.merchants.user_id, name: s.name, type: 'shop' as const })),
    ]);
    setRecipientsLoading(false);
  }

  const conv        = conversations.find(c => c.key === activeConv) ?? null;
  const totalUnread = conversations.reduce((s, c) => s + c.unreadCount, 0);
  const filteredRecipients = recipients.filter(r =>
    r.name.toLowerCase().includes(recipientSearch.toLowerCase())
  );

  return (
    <div dir={direction} style={{ fontFamily: "'Tajawal', sans-serif" }} className="text-[#0F2B4E]">

      {/* Compose modal */}
      {selectedRecipient && (
        <AdminMessageModal
          recipientName={selectedRecipient.name}
          recipientId={selectedRecipient.id}
          onClose={() => { setSelectedRecipient(null); setShowCompose(false); load(); }}
        />
      )}

      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div className="flex items-center gap-2.5">
          <h2 className="text-lg font-extrabold m-0">{t('sentMessages.title')}</h2>
          {totalUnread > 0 && (
            <span className="bg-red-500 text-white rounded-full px-2.5 py-0.5 text-xs font-bold">
              {t('sentMessages.newCount', { count: totalUnread })}
            </span>
          )}
        </div>
        <div className="flex gap-2.5">
          <button
            onClick={load}
            disabled={loading}
            className="px-3.5 py-1.5 rounded-lg border border-slate-200 bg-white text-[#0F2B4E] text-xs font-medium hover:bg-slate-50 transition-colors disabled:opacity-50 cursor-pointer"
          >
            ↻ {t('sentMessages.refresh')}
          </button>
          <button
            onClick={() => {
              setSelectedRecipient(null);
              setRecipientSearch('');
              setShowDropdown(false);
              setShowCompose(true);
              if (recipients.length === 0) loadRecipients();
            }}
            className="flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-bold text-white bg-[#136540] hover:bg-[#0e4f32] transition-colors shadow-sm shadow-green-900/10"
            style={{ fontFamily: 'inherit' }}
          >
            <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            {t('sentMessages.newMessage')}
          </button>
        </div>
      </div>

      {/* ── Recipient picker ── */}
      {showCompose && !selectedRecipient && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 mb-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold m-0">{t('sentMessages.chooseRecipient')}</h3>
            <button
              onClick={() => setShowCompose(false)}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 text-lg leading-none transition-all"
            >
              ×
            </button>
          </div>
          <div className="relative">
            <input
              value={recipientSearch}
              onChange={e => { setRecipientSearch(e.target.value); setShowDropdown(true); }}
              onFocus={() => setShowDropdown(true)}
              onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
              placeholder={t('sentMessages.recipientSearchPlaceholder')}
              autoFocus
              className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm text-[#0F2B4E] placeholder:text-slate-400 focus:outline-none focus:border-[#136540] focus:ring-2 focus:ring-[#136540]/10 transition-all"
              style={{ fontFamily: 'inherit' }}
            />
            {showDropdown && (
              <div className="absolute top-full right-0 left-0 z-50 bg-white border border-slate-200 rounded-xl mt-1.5 max-h-56 overflow-y-auto shadow-lg shadow-slate-900/10">
                {recipientsLoading ? (
                  <div className="px-4 py-3 text-slate-400 text-sm">{t('sentMessages.loading')}</div>
                ) : filteredRecipients.length === 0 ? (
                  <div className="px-4 py-3 text-slate-400 text-sm">{t('sentMessages.noResults')}</div>
                ) : filteredRecipients.map((r, i) => (
                  <div
                    key={r.id}
                    onMouseDown={() => { setSelectedRecipient(r); setShowDropdown(false); }}
                    className={[
                      'px-4 py-2.5 cursor-pointer flex items-center gap-3 hover:bg-slate-50 transition-colors',
                      i < filteredRecipients.length - 1 ? 'border-b border-slate-100' : '',
                    ].join(' ')}
                  >
                    <div className={[
                      'w-8 h-8 rounded-lg flex-shrink-0 flex items-center justify-center font-bold text-xs',
                      r.type === 'courier' ? 'bg-green-50 text-[#136540]' : 'bg-blue-50 text-blue-600',
                    ].join(' ')}>
                      {r.name.charAt(0)}
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-[#0F2B4E]">{r.name}</div>
                      <div className="text-xs text-slate-400">{r.type === 'courier' ? t('sentMessages.courierType') : t('sentMessages.shopType')}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {error && (
        <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm mb-4">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-slate-400 text-sm">{t('sentMessages.loading')}</div>
      ) : conversations.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <svg width="40" height="40" fill="none" viewBox="0 0 24 24" stroke="#CBD5E1" strokeWidth="1.5" className="mx-auto mb-3 block">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
          <p className="text-sm font-semibold m-0">{t('sentMessages.noConversations')}</p>
          <p className="text-xs text-slate-300 mt-1.5 m-0">{t('sentMessages.noConversationsHint')}</p>
        </div>
      ) : (
        <div className={`flex flex-col gap-4 ${activeConv ? 'md:grid md:grid-cols-[290px_1fr]' : ''}`}>

          {/* ── Conversation list ── */}
          <div className={`${activeConv ? 'hidden md:block' : ''} rounded-xl border border-slate-200 overflow-hidden bg-white shadow-sm`}>
            {/* Search */}
            <div className="px-4 pt-4 pb-5 border-b border-slate-100">
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={t('sentMessages.conversationSearchPlaceholder')}
                className="w-full px-4 py-3.5 rounded-xl border border-slate-200 text-sm text-[#0F2B4E] placeholder:text-slate-400 focus:outline-none focus:border-[#136540] focus:ring-2 focus:ring-[#136540]/10 transition-all"
                style={{ fontFamily: 'inherit' }}
              />
            </div>

            {filteredConversations.length === 0 ? (
              <div className="px-4 py-6 text-center text-slate-400 text-xs">{t('sentMessages.noResults')}</div>
            ) : filteredConversations.map((c, i) => (
              <div
                key={c.key}
                onClick={() => openConv(c.key)}
                className={[
                  'px-4 py-5 cursor-pointer transition-colors border-r-[3px]',
                  i < filteredConversations.length - 1 ? 'border-b border-b-slate-100' : '',
                  activeConv === c.key
                    ? 'bg-green-50 border-r-[#136540]'
                    : `hover:bg-slate-50 ${c.unreadCount > 0 ? 'border-r-[#136540]' : 'border-r-transparent'}`,
                ].join(' ')}
              >
                <div className="flex items-start gap-4">
                  <div className={[
                    'w-11 h-11 rounded-xl flex-shrink-0 flex items-center justify-center font-extrabold text-sm',
                    activeConv === c.key ? 'bg-[#136540] text-white' : 'bg-slate-100 text-[#0F2B4E]',
                  ].join(' ')}>
                    {c.otherPartyName.charAt(0)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span className={`text-sm truncate ${c.unreadCount > 0 ? 'font-extrabold text-[#0F2B4E]' : 'font-semibold text-[#0F2B4E]'}`}>
                        {c.otherPartyName}
                      </span>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {c.unreadCount > 0 && (
                          <span className="bg-[#136540] text-white rounded-full px-1.5 py-px text-[10px] font-bold">
                            {c.unreadCount}
                          </span>
                        )}
                        <span className="text-[10px] text-slate-300">
                          {new Date(c.latestAt).toLocaleDateString(numLocale, { month: 'short', day: 'numeric' })}
                        </span>
                      </div>
                    </div>
                    <p style={{ margin: 0 }} className="text-[11px] text-slate-500 truncate font-medium">{c.rootSubject}</p>
                    <p style={{ margin: '5px 0 0' }} className="text-[11px] text-slate-400 truncate">{c.latestPreview || '...'}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* ── Chat panel ── */}
          {conv && (
            <div className="rounded-xl border border-slate-200 bg-white flex flex-col overflow-hidden shadow-sm" style={{ height: 540 }}>

              {/* Header */}
              <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between bg-white flex-shrink-0">
                <div className="flex items-center gap-2.5">
                  {/* Mobile: back button */}
                  <button
                    onClick={() => setActiveConv(null)}
                    className="md:hidden w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100 transition-colors ml-1"
                    aria-label={t('sentMessages.back')}
                  >
                    <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                      <path d="M9 18l6-6-6-6"/>
                    </svg>
                  </button>
                  <div className={[
                    'w-9 h-9 rounded-xl flex-shrink-0 flex items-center justify-center font-extrabold text-sm text-white',
                    'bg-[#0F2B4E]',
                  ].join(' ')}>
                    {conv.otherPartyName.charAt(0)}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-extrabold text-[#0F2B4E] m-0 leading-tight">{conv.otherPartyName}</p>
                    <p className="text-xs text-slate-400 truncate max-w-[200px] m-0">{conv.rootSubject}</p>
                  </div>
                </div>
                {/* Desktop: close button */}
                <button
                  onClick={() => setActiveConv(null)}
                  className="hidden md:flex w-7 h-7 rounded-lg items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 text-lg leading-none transition-all"
                >
                  ×
                </button>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto px-5 py-6 flex flex-col gap-6 bg-slate-50/40">
                {conv.messages.map(msg => {
                  const isMine = msg.sender_id === adminId;
                  return (
                    <div
                      key={msg.id}
                      className={`flex items-end gap-3 ${isMine ? 'flex-row' : 'flex-row-reverse'}`}
                    >
                      <div className={[
                        'w-7 h-7 rounded-lg flex-shrink-0 flex items-center justify-center font-extrabold text-[11px] text-white',
                        isMine ? 'bg-[#0F2B4E]' : 'bg-slate-500',
                      ].join(' ')}>
                        {isMine ? t('sentMessages.adminInitial') : conv.otherPartyName.charAt(0)}
                      </div>
                      <div className="max-w-[68%]">
                        <div
                          className={[
                            'px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap',
                            isMine
                              ? 'bg-[#0F2B4E] text-white shadow-sm'
                              : 'bg-white text-slate-800 border border-slate-200 shadow-sm',
                          ].join(' ')}
                          style={{ borderRadius: isMine ? '0.25rem 1rem 1rem 1rem' : '1rem 0.25rem 1rem 1rem' }}
                        >
                          {msg.body ?? <em className="opacity-60">{t('sentMessages.noText')}</em>}
                        </div>
                        <div className={`flex items-center gap-1 mt-2 ${isMine ? 'justify-start' : 'justify-end'}`}>
                          <span className="text-[10px] text-slate-400">
                            {new Date(msg.created_at).toLocaleTimeString(numLocale, { hour: '2-digit', minute: '2-digit' })}
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
                    placeholder={t('sentMessages.replyPlaceholder')}
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
                          ? 'bg-[#0F2B4E] hover:bg-[#1a3d6e] cursor-pointer shadow-md shadow-slate-900/20'
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
            </div>
          )}
        </div>
      )}
    </div>
  );
}
