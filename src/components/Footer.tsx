import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './Footer.css';

function Chevron() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="hp-footer__chevron">
      <path d="M15 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function Footer() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const browse = [
    { l: 'الرئيسية', a: () => navigate('/home') },
    { l: 'المتاجر',  a: () => navigate('/stores-list') },
    { l: 'الفئات',   a: () => document.getElementById('categories')?.scrollIntoView({ behavior: 'smooth' }) },
    { l: 'العروض',   a: () => navigate('/offers') },
    { l: 'البحث',    a: () => navigate('/search') },
  ];
  const account = [
    { l: 'تسجيل الدخول', a: () => navigate('/login') },
    { l: 'إنشاء حساب',   a: () => navigate('/signup') },
    { l: 'تفعيل الحساب', a: () => navigate('/activate') },
  ];
  const help = [
    { l: 'سياسة الخصوصية',        a: () => navigate('/privacy-policy') },
    { l: 'التسجيل كتاجر',          a: () => navigate('/merchant-application') },
    { l: 'التقديم كسائق توصيل',    a: () => navigate('/delivery-application') },
    { l: 'الشروط والأحكام',        a: undefined },
    { l: 'تواصل معنا',             a: undefined },
  ];

  return (
    <footer className="hp-footer">
      <div className="hp-wrap">
        <div className="hp-footer__card">
          <div className="hp-footer__grid">
            <div className="hp-footer__col hp-footer__col--brand">
              <div className="hp-footer__brand" onClick={() => navigate('/home')}>
                <img src="/logo.png" alt="Souq Link" className="hp-footer__logo"
                  onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                <div>
                  <div className="hp-footer__name-ar">سوق لينك</div>
                  <div className="hp-footer__name-en">SOUQ LINK</div>
                </div>
              </div>
              {open && (
                <>
                  <p className="hp-footer__about">منصة تجمع أفضل المتاجر المحلية الموثوقة<br />لتجربة تسوق مميزة وآمنة.</p>
                  <div className="hp-footer__socials">
                    <a href="#" className="hp-footer__social" title="Instagram" aria-label="Instagram">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/>
                      </svg>
                    </a>
                    <a href="#" className="hp-footer__social" title="Facebook" aria-label="Facebook">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/>
                      </svg>
                    </a>
                    <a href="#" className="hp-footer__social" title="YouTube" aria-label="YouTube">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M22.54 6.42a2.78 2.78 0 0 0-1.95-1.96C18.88 4 12 4 12 4s-6.88 0-8.59.46a2.78 2.78 0 0 0-1.95 1.96A29 29 0 0 0 1 12a29 29 0 0 0 .46 5.58A2.78 2.78 0 0 0 3.41 19.54C5.12 20 12 20 12 20s6.88 0 8.59-.46a2.78 2.78 0 0 0 1.95-1.96A29 29 0 0 0 23 12a29 29 0 0 0-.46-5.58z"/>
                        <polygon points="9.75 15.02 15.5 12 9.75 8.98 9.75 15.02"/>
                      </svg>
                    </a>
                  </div>
                </>
              )}
            </div>

            <div className="hp-footer__col">
              <h4 className="hp-footer__col-ttl">تصفح</h4>
              {open && (
                <ul className="hp-footer__links">
                  {browse.map(x => (
                    <li key={x.l}><button type="button" className="hp-footer__lbtn" onClick={x.a}>{x.l}<Chevron /></button></li>
                  ))}
                </ul>
              )}
            </div>

            <div className="hp-footer__col">
              <h4 className="hp-footer__col-ttl">الحساب</h4>
              {open && (
                <ul className="hp-footer__links">
                  {account.map(x => (
                    <li key={x.l}><button type="button" className="hp-footer__lbtn" onClick={x.a}>{x.l}<Chevron /></button></li>
                  ))}
                </ul>
              )}
            </div>

            <div className="hp-footer__col">
              <h4 className="hp-footer__col-ttl">المساعدة</h4>
              {open && (
                <ul className="hp-footer__links">
                  {help.map(x => (
                    <li key={x.l}><button type="button" className="hp-footer__lbtn" onClick={x.a}>{x.l}<Chevron /></button></li>
                  ))}
                </ul>
              )}
            </div>

            <div className="hp-footer__col hp-footer__col--contact">
              <h4 className="hp-footer__col-ttl">تواصل معنا</h4>
              {open && (
                <>
                  <p className="hp-footer__contact-text">نحن هنا لمساعدتك في أي وقت.</p>
                  <a href="mailto:support@souqlink.com" className="hp-footer__contact-row">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M2 7l10 6 10-6"/></svg>
                    support@souqlink.com
                  </a>
                  <a href="tel:+972501234567" className="hp-footer__contact-row">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                    +972 50-123-4567
                  </a>
                </>
              )}
            </div>

            <button type="button" className="hp-footer__toggle" onClick={() => setOpen(o => !o)} aria-label="تبديل الفوتر">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                className={open ? 'hp-footer__toggle-icon hp-footer__toggle-icon--open' : 'hp-footer__toggle-icon'}>
                <path d="M6 9l6 6 6-6"/>
              </svg>
            </button>
          </div>
        </div>
      </div>

      <div className="hp-footer__bottom">
        <div className="hp-wrap hp-footer__bottom-inner">
          <div className="hp-footer__secure">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
            تسوق آمن 100%
          </div>

          <p className="hp-footer__copy">سوق لينك. جميع الحقوق محفوظة © 2026</p>
        </div>
      </div>
    </footer>
  );
}
