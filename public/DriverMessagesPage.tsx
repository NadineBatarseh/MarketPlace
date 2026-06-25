import React, { useMemo, useState } from "react";
import {
  Bell,
  CalendarDays,
  CheckCheck,
  ChevronDown,
  CircleDollarSign,
  Clock3,
  Headphones,
  Home,
  Info,
  LogOut,
  Mail,
  MapPinned,
  Menu,
  MessageCircle,
  MoreHorizontal,
  PackageCheck,
  Paperclip,
  RefreshCw,
  Search,
  Send,
  ShoppingBag,
  Star,
  Truck,
  UserRound,
  WalletCards,
  X,
} from "lucide-react";

type ConversationType =
  | "support"
  | "operations"
  | "payments"
  | "alerts"
  | "customer";

type Conversation = {
  id: number;
  title: string;
  preview: string;
  time: string;
  unread: number;
  type: ConversationType;
  online?: boolean;
};

type Message = {
  id: number;
  sender: "driver" | "support";
  text: string;
  time: string;
  read?: boolean;
};

const conversations: Conversation[] = [
  {
    id: 1,
    title: "فريق دعم سوق لينك",
    preview: "شكراً لتواصلك معنا. تم استلام ملاحظتك وسنقوم...",
    time: "10:45 ص",
    unread: 2,
    type: "support",
    online: true,
  },
  {
    id: 2,
    title: "إدارة العمليات",
    preview: "تم تحديث طلب جديد قريب منك، يرجى التحقق من التفاصيل.",
    time: "09:30 ص",
    unread: 1,
    type: "operations",
  },
  {
    id: 3,
    title: "قسم المدفوعات",
    preview: "تم تحويل الدفعة رقم #7845 إلى حسابك بنجاح.",
    time: "أمس",
    unread: 0,
    type: "payments",
  },
  {
    id: 4,
    title: "نظام التنبيهات",
    preview: "تذكير: تأكد من تحديث مستنداتك لضمان استمرار الحساب.",
    time: "أمس",
    unread: 0,
    type: "alerts",
  },
  {
    id: 5,
    title: "العميل أحمد سالم",
    preview: "شكراً لك على التوصيل السريع والخدمة الممتازة.",
    time: "2 مايو",
    unread: 0,
    type: "customer",
  },
  {
    id: 6,
    title: "فريق دعم سوق لينك",
    preview: "نود إبلاغك بوجود صيانة مجدولة يوم الأحد القادم.",
    time: "1 مايو",
    unread: 0,
    type: "support",
  },
];

const initialMessages: Record<number, Message[]> = {
  1: [
    {
      id: 1,
      sender: "support",
      text: "مرحباً بك في دعم سوق لينك 👋\nشكراً لتواصلك معنا بخصوص الاستفسار حول تحديث التطبيق. سنقوم بمراجعة طلبك والرد عليك في أقرب وقت ممكن.",
      time: "10:20 ص",
    },
    {
      id: 2,
      sender: "driver",
      text: "مرحباً، لدي استفسار حول سبب خصم مبلغ إضافي من رصيدي بعد إتمام آخر طلب.",
      time: "10:32 ص",
      read: true,
    },
    {
      id: 3,
      sender: "support",
      text: "شكراً لتواصلك معنا. تم استلام ملاحظتك وسنقوم بالتحقق من التفاصيل والرد عليك خلال وقت قصير.",
      time: "10:35 ص",
    },
  ],
  2: [
    {
      id: 1,
      sender: "support",
      text: "تم إسناد مهمة جديدة إليك. افتح صفحة الطلبات لمراجعة التفاصيل.",
      time: "09:30 ص",
    },
  ],
  3: [
    {
      id: 1,
      sender: "support",
      text: "تم تحويل دفعتك الأخيرة إلى المحفظة بنجاح.",
      time: "أمس",
    },
  ],
  4: [
    {
      id: 1,
      sender: "support",
      text: "يرجى تحديث مستندات المركبة قبل تاريخ الانتهاء.",
      time: "أمس",
    },
  ],
  5: [
    {
      id: 1,
      sender: "support",
      text: "شكراً لك على التوصيل السريع والخدمة الممتازة.",
      time: "2 مايو",
    },
  ],
  6: [
    {
      id: 1,
      sender: "support",
      text: "ستكون هناك صيانة مجدولة يوم الأحد القادم.",
      time: "1 مايو",
    },
  ],
};

const menuItems = [
  { label: "الرئيسية", icon: Home },
  { label: "طلباتي", icon: ShoppingBag },
  { label: "وردياتي", icon: Clock3 },
  { label: "الأرباح", icon: CircleDollarSign },
  { label: "صندوق الرسائل", icon: MessageCircle, active: true },
  { label: "سجل الرحلات", icon: CalendarDays },
  { label: "التسليم والاستلام", icon: PackageCheck },
  { label: "خريطة المسار", icon: MapPinned },
  { label: "التقييمات", icon: Star },
];

function ConversationIcon({ type }: { type: ConversationType }) {
  const classes =
    "flex h-11 w-11 shrink-0 items-center justify-center rounded-full";

  if (type === "support") {
    return (
      <div className={`${classes} bg-slate-900 text-white`}>
        <Headphones size={20} />
      </div>
    );
  }

  if (type === "operations") {
    return (
      <div className={`${classes} bg-slate-100 text-slate-600`}>
        <Truck size={20} />
      </div>
    );
  }

  if (type === "payments") {
    return (
      <div className={`${classes} bg-emerald-100 text-emerald-700`}>
        <CircleDollarSign size={20} />
      </div>
    );
  }

  if (type === "alerts") {
    return (
      <div className={`${classes} bg-blue-100 text-blue-600`}>
        <Bell size={20} />
      </div>
    );
  }

  return (
    <div className={`${classes} bg-violet-100 text-violet-600`}>
      <UserRound size={20} />
    </div>
  );
}

function DriverSidebar({
  mobileOpen,
  onClose,
}: {
  mobileOpen: boolean;
  onClose: () => void;
}) {
  return (
    <>
      {mobileOpen && (
        <button
          type="button"
          aria-label="إغلاق القائمة"
          onClick={onClose}
          className="fixed inset-0 z-40 bg-slate-950/40 lg:hidden"
        />
      )}

      <aside
        className={[
          "fixed inset-y-0 right-0 z-50 flex w-[270px] flex-col bg-[#10172f] text-white transition-transform duration-300 lg:static lg:translate-x-0",
          mobileOpen ? "translate-x-0" : "translate-x-full",
        ].join(" ")}
      >
        <div className="flex h-[86px] items-center justify-between border-b border-white/10 px-5">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-emerald-400 via-green-500 to-orange-500 font-black">
              SL
            </div>
            <div>
              <div className="text-xl font-extrabold">
                سوق <span className="text-[#f05a28]">لينك</span>
              </div>
              <div className="text-xs text-slate-400">لوحة تحكم السائق</div>
            </div>
          </div>

          <button
            type="button"
            aria-label="إغلاق"
            onClick={onClose}
            className="rounded-xl p-2 text-slate-400 hover:bg-white/10 lg:hidden"
          >
            <X size={20} />
          </button>
        </div>

        <div className="border-b border-white/10 px-5 py-5">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-full bg-emerald-500 font-bold">
              D
            </div>
            <div>
              <div className="font-bold">السائق driver1</div>
              <div className="mt-1 flex items-center gap-1.5 text-xs text-slate-400">
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                متصل
              </div>
            </div>
          </div>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto p-4">
          {menuItems.map(({ label, icon: Icon, active }) => (
            <button
              key={label}
              type="button"
              className={[
                "flex w-full items-center justify-between rounded-xl px-4 py-3 text-right transition",
                active
                  ? "bg-[#f05a28] text-white shadow-lg shadow-orange-950/20"
                  : "text-slate-300 hover:bg-white/8 hover:text-white",
              ].join(" ")}
            >
              <span className="font-medium">{label}</span>
              <Icon size={19} />
            </button>
          ))}
        </nav>

        <div className="p-4">
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs text-slate-400">رصيد المحفظة</div>
                <div className="mt-1 text-lg font-extrabold">₪ 1,245.00</div>
              </div>
              <WalletCards className="text-[#f05a28]" />
            </div>

            <div className="mt-3 flex items-center gap-2 text-sm">
              <Star size={16} className="fill-amber-400 text-amber-400" />
              <span>4.9</span>
              <span className="text-slate-500">التقييم</span>
            </div>

            <button
              type="button"
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 px-3 py-2.5 text-sm text-slate-300 transition hover:bg-white/10 hover:text-white"
            >
              <LogOut size={17} />
              تسجيل الخروج
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}

export default function DriverMessagesPage() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(1);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [draft, setDraft] = useState("");
  const [messagesByConversation, setMessagesByConversation] =
    useState(initialMessages);

  const selectedConversation =
    conversations.find((item) => item.id === selectedId) ?? conversations[0];

  const visibleConversations = useMemo(() => {
    return conversations.filter((item) => {
      const matchesQuery =
        item.title.toLowerCase().includes(query.toLowerCase()) ||
        item.preview.toLowerCase().includes(query.toLowerCase());

      const matchesFilter = filter === "all" || item.unread > 0;
      return matchesQuery && matchesFilter;
    });
  }, [filter, query]);

  const sendMessage = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;

    setMessagesByConversation((current) => {
      const existing = current[selectedId] ?? [];
      const newMessage: Message = {
        id: Date.now(),
        sender: "driver",
        text: trimmed,
        time: new Date().toLocaleTimeString("ar", {
          hour: "2-digit",
          minute: "2-digit",
        }),
        read: true,
      };

      return {
        ...current,
        [selectedId]: [...existing, newMessage],
      };
    });

    setDraft("");
  };

  return (
    <div
      dir="rtl"
      className="min-h-screen bg-[#f6f7fb] font-sans text-slate-900"
    >
      <div className="flex min-h-screen">
        <DriverSidebar
          mobileOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
        />

        <main className="min-w-0 flex-1">
          <header className="sticky top-0 z-30 flex h-[86px] items-center justify-between border-b border-slate-200 bg-white/95 px-4 backdrop-blur md:px-7">
            <div className="flex items-center gap-3">
              <button
                type="button"
                aria-label="فتح القائمة"
                onClick={() => setSidebarOpen(true)}
                className="rounded-xl border border-slate-200 p-2.5 text-slate-600 lg:hidden"
              >
                <Menu size={21} />
              </button>

              <div>
                <h1 className="text-xl font-extrabold md:text-2xl">
                  صندوق الرسائل
                </h1>
                <p className="mt-1 text-xs text-slate-500">
                  الرئيسية / صندوق الرسائل
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                className="relative rounded-xl border border-slate-200 bg-white p-2.5 text-slate-600 shadow-sm hover:bg-slate-50"
              >
                <Bell size={20} />
                <span className="absolute -left-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-[#f05a28] px-1 text-[10px] font-bold text-white">
                  15
                </span>
              </button>

              <div className="grid h-10 w-10 place-items-center rounded-full bg-emerald-500 font-bold text-white">
                D
              </div>
            </div>
          </header>

          <div className="p-4 md:p-7">
            <section className="mb-5 grid gap-4 sm:grid-cols-3">
              <div className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="grid h-12 w-12 place-items-center rounded-2xl bg-orange-50 text-[#f05a28]">
                  <MessageCircle size={22} />
                </div>
                <div>
                  <div className="text-2xl font-extrabold">12</div>
                  <div className="text-sm text-slate-500">غير مقروءة</div>
                </div>
              </div>

              <div className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="grid h-12 w-12 place-items-center rounded-2xl bg-blue-50 text-blue-600">
                  <CalendarDays size={22} />
                </div>
                <div>
                  <div className="text-2xl font-extrabold">5</div>
                  <div className="text-sm text-slate-500">رسائل اليوم</div>
                </div>
              </div>

              <div className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="grid h-12 w-12 place-items-center rounded-2xl bg-emerald-50 text-emerald-600">
                  <Mail size={22} />
                </div>
                <div>
                  <div className="text-2xl font-extrabold">128</div>
                  <div className="text-sm text-slate-500">كل الرسائل</div>
                </div>
              </div>
            </section>

            <section className="mb-5 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:flex-row md:items-center">
              <div className="relative flex-1">
                <Search
                  size={19}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400"
                />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="ابحث في الرسائل..."
                  className="h-12 w-full rounded-xl border border-slate-200 bg-slate-50 pr-11 pl-4 outline-none transition focus:border-[#f05a28] focus:bg-white focus:ring-4 focus:ring-orange-100"
                />
              </div>

              <div className="relative min-w-[150px]">
                <select
                  value={filter}
                  onChange={(event) =>
                    setFilter(event.target.value as "all" | "unread")
                  }
                  className="h-12 w-full appearance-none rounded-xl border border-slate-200 bg-white px-4 pl-10 outline-none focus:border-[#f05a28]"
                >
                  <option value="all">كل الرسائل</option>
                  <option value="unread">غير المقروءة</option>
                </select>
                <ChevronDown
                  size={18}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                />
              </div>

              <button
                type="button"
                className="grid h-12 w-12 shrink-0 place-items-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50"
              >
                <RefreshCw size={19} />
              </button>
            </section>

            <section className="grid min-h-[650px] overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm xl:grid-cols-[390px_minmax(0,1fr)]">
              <aside className="border-b border-slate-200 xl:border-b-0 xl:border-l">
                <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
                  <h2 className="font-extrabold">المحادثات</h2>
                  <button
                    type="button"
                    className="flex items-center gap-2 text-sm text-slate-500"
                  >
                    الأحدث
                    <ChevronDown size={16} />
                  </button>
                </div>

                <div className="max-h-[650px] space-y-2 overflow-y-auto p-3">
                  {visibleConversations.map((conversation) => {
                    const active = selectedId === conversation.id;

                    return (
                      <button
                        key={conversation.id}
                        type="button"
                        onClick={() => setSelectedId(conversation.id)}
                        className={[
                          "flex w-full items-start gap-3 rounded-2xl border p-3 text-right transition",
                          active
                            ? "border-orange-300 bg-orange-50"
                            : "border-transparent bg-white hover:border-slate-200 hover:bg-slate-50",
                        ].join(" ")}
                      >
                        <ConversationIcon type={conversation.type} />

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-3">
                            <div className="truncate font-bold">
                              {conversation.title}
                            </div>
                            <span className="shrink-0 text-xs text-slate-400">
                              {conversation.time}
                            </span>
                          </div>

                          <div className="mt-1 flex items-center gap-2">
                            <p className="min-w-0 flex-1 truncate text-sm text-slate-500">
                              {conversation.preview}
                            </p>
                            {conversation.unread > 0 && (
                              <span className="grid h-5 min-w-5 place-items-center rounded-full bg-[#f05a28] px-1 text-[10px] font-bold text-white">
                                {conversation.unread}
                              </span>
                            )}
                          </div>
                        </div>
                      </button>
                    );
                  })}

                  {visibleConversations.length === 0 && (
                    <div className="py-14 text-center text-sm text-slate-500">
                      لا توجد رسائل مطابقة.
                    </div>
                  )}
                </div>
              </aside>

              <div className="flex min-w-0 flex-col">
                <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
                  <div className="flex items-center gap-3">
                    <ConversationIcon type={selectedConversation.type} />
                    <div>
                      <div className="font-extrabold">
                        {selectedConversation.title}
                      </div>
                      <div className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
                        {selectedConversation.online && (
                          <span className="h-2 w-2 rounded-full bg-emerald-500" />
                        )}
                        {selectedConversation.online
                          ? "متصل الآن"
                          : "آخر ظهور مؤخراً"}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1">
                    {[Star, Info, MoreHorizontal].map((Icon, index) => (
                      <button
                        key={index}
                        type="button"
                        className="rounded-xl p-2.5 text-slate-500 hover:bg-slate-100"
                      >
                        <Icon size={19} />
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto bg-[#fbfbfd] p-5 md:p-7">
                  <div className="mb-7 flex items-center gap-4">
                    <div className="h-px flex-1 bg-slate-200" />
                    <span className="text-xs text-slate-400">اليوم</span>
                    <div className="h-px flex-1 bg-slate-200" />
                  </div>

                  <div className="space-y-5">
                    {(messagesByConversation[selectedId] ?? []).map(
                      (message) => {
                        const isDriver = message.sender === "driver";

                        return (
                          <div
                            key={message.id}
                            className={[
                              "flex",
                              isDriver ? "justify-start" : "justify-end",
                            ].join(" ")}
                          >
                            <div
                              className={[
                                "max-w-[82%] rounded-2xl px-4 py-3 text-sm leading-7 shadow-sm md:max-w-[68%]",
                                isDriver
                                  ? "rounded-tr-sm border border-orange-200 bg-orange-50"
                                  : "rounded-tl-sm border border-slate-200 bg-white",
                              ].join(" ")}
                            >
                              <p className="whitespace-pre-line">{message.text}</p>
                              <div
                                className={[
                                  "mt-2 flex items-center gap-1 text-[11px] text-slate-400",
                                  isDriver ? "justify-start" : "justify-end",
                                ].join(" ")}
                              >
                                {isDriver && message.read && (
                                  <CheckCheck
                                    size={15}
                                    className="text-blue-500"
                                  />
                                )}
                                <span>{message.time}</span>
                              </div>
                            </div>
                          </div>
                        );
                      }
                    )}
                  </div>
                </div>

                <div className="border-t border-slate-200 bg-white p-4">
                  <div className="flex items-end gap-3">
                    <button
                      type="button"
                      className="grid h-12 w-12 shrink-0 place-items-center rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50"
                    >
                      <Paperclip size={20} />
                    </button>

                    <textarea
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.shiftKey) {
                          event.preventDefault();
                          sendMessage();
                        }
                      }}
                      rows={1}
                      placeholder="اكتب رسالتك هنا..."
                      className="min-h-12 flex-1 resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-[#f05a28] focus:bg-white focus:ring-4 focus:ring-orange-100"
                    />

                    <button
                      type="button"
                      onClick={sendMessage}
                      className="flex h-12 shrink-0 items-center gap-2 rounded-xl bg-[#f05a28] px-5 font-bold text-white shadow-lg shadow-orange-200 transition hover:bg-[#dc4b1d]"
                    >
                      <Send size={18} />
                      <span className="hidden sm:inline">إرسال</span>
                    </button>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}
