import { Link } from 'react-router-dom';
import { useSharedAuth } from '../../context/AuthContext';
import AdminMessagesInbox from '../../components/AdminMessagesInbox';

export default function DriverInboxPage() {
  const { rawUser } = useSharedAuth();

  if (!rawUser) return null;

  return (
    <div
      style={{ fontFamily: "'Tajawal', sans-serif", minHeight: '100vh', background: '#F8FAFC' }}
      dir="rtl"
    >
      {/* Top bar */}
      <div className="bg-[#1a1a2e] text-white px-5 h-13 flex items-center gap-3.5 shadow-md">
        <Link
          to="/driver-dashboard"
          className="flex items-center gap-1.5 text-slate-400 hover:text-slate-200 transition-colors text-xs no-underline"
        >
          <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path d="M15 18l-6-6 6-6"/>
          </svg>
          العودة للوحة التحكم
        </Link>
        <span className="text-slate-600 text-sm">|</span>
        <span className="text-sm font-bold">صندوق الرسائل</span>
      </div>

      <div className="px-4 sm:px-6 py-7 max-w-3xl mx-auto">
        <AdminMessagesInbox userId={rawUser.id} />
      </div>
    </div>
  );
}
