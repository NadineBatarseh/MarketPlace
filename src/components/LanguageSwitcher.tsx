import { useLanguage } from '../context/LanguageContext';
import './LanguageSwitcher.css';

export default function LanguageSwitcher() {
  const { lang, setLang } = useLanguage();

  return (
    <button
      type="button"
      className="lang-switcher"
      onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}
      title={lang === 'ar' ? 'Switch to English' : 'التبديل إلى العربية'}
      aria-label={lang === 'ar' ? 'Switch to English' : 'التبديل إلى العربية'}
    >
      <span className="lang-switcher__globe">🌐</span>
      <span className="lang-switcher__label">{lang === 'ar' ? 'EN' : 'ع'}</span>
    </button>
  );
}
