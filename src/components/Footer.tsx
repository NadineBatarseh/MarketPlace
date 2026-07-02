import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import './Footer.css';

export default function Footer() {
  const { t } = useTranslation('common');
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const quick = [
    { l: t('footer.quickNav.home'),       a: () => navigate('/home') },
    { l: t('footer.quickNav.stores'),     a: () => navigate('/stores-list') },
    { l: t('footer.quickNav.categories'), a: () => document.getElementById('categories')?.scrollIntoView({ behavior: 'smooth' }) },
    { l: t('footer.quickNav.offers'),     a: () => document.getElementById('deals')?.scrollIntoView({ behavior: 'smooth' }) },
  ];
  const service = t('footer.serviceLinks', { returnObjects: true }) as string[];
  const help    = t('footer.helpLinks',    { returnObjects: true }) as string[];

  return (
    <footer className="hp-footer">
      <div className="hp-wrap hp-footer__grid">
        <div>
          <div className="hp-footer__brand" onClick={() => navigate('/home')}>
            <img src="/logo.png" alt="Souq Link" className="hp-footer__logo"
              onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
            <div>
              <div className="hp-footer__name-ar">{t('logo.ar')}</div>
              <div className="hp-footer__name-en">{t('logo.en')}</div>
            </div>
          </div>
          {open && (
            <>
              <p className="hp-footer__about">
                {t('footer.aboutLine1')}<br />{t('footer.aboutLine2')}
              </p>
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
                <a href="#" className="hp-footer__social" title="Twitter / X" aria-label="Twitter / X">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
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

        <div>
          <h4 className="hp-footer__col-ttl">{t('footer.quickLinks')}</h4>
          {open && <ul className="hp-footer__links">{quick.map(x => <li key={x.l}><button type="button" className="hp-footer__lbtn" onClick={x.a}>{x.l}</button></li>)}</ul>}
        </div>

        <div>
          <h4 className="hp-footer__col-ttl">{t('footer.customerService')}</h4>
          {open && <ul className="hp-footer__links">{service.map(s => <li key={s}><button type="button" className="hp-footer__lbtn">{s}</button></li>)}</ul>}
        </div>

        <div>
          <h4 className="hp-footer__col-ttl">{t('footer.help')}</h4>
          {open && <ul className="hp-footer__links">{help.map(s => <li key={s}><button type="button" className="hp-footer__lbtn">{s}</button></li>)}</ul>}
        </div>

        <div>
          <h4 className="hp-footer__col-ttl">{t('footer.paymentMethods')}</h4>
          {open && (
            <div className="hp-footer__payments">
              {['VISA', 'MC', 'PayPal', 'Apple Pay'].map(p => (
                <span key={p} className="hp-footer__pay">{p}</span>
              ))}
            </div>
          )}
        </div>

        <button type="button" className="hp-footer__toggle" onClick={() => setOpen(o => !o)} aria-label={t('footer.toggleLabel')}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
            className={open ? 'hp-footer__toggle-icon hp-footer__toggle-icon--open' : 'hp-footer__toggle-icon'}>
            <path d="M6 9l6 6 6-6"/>
          </svg>
        </button>
      </div>

      <div className="hp-footer__bottom">
        <div className="hp-wrap hp-footer__bottom-inner">
          <p>{t('footer.copyright')}</p>
        </div>
      </div>
    </footer>
  );
}
