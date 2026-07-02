import { createContext, useContext, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import '../i18n/config';

type Dir = 'rtl' | 'ltr';
type Lang = 'ar' | 'en';

interface LanguageContextValue {
  lang: Lang;
  direction: Dir;
  setLang: (lang: Lang) => void;
}

const LanguageContext = createContext<LanguageContextValue>({
  lang: 'ar',
  direction: 'rtl',
  setLang: () => {},
});

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const { i18n } = useTranslation();

  const lang = (i18n.language === 'en' ? 'en' : 'ar') as Lang;
  const dir: Dir = lang === 'ar' ? 'rtl' : 'ltr';

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
  }, [lang, dir]);

  function setLang(next: Lang) {
    i18n.changeLanguage(next);
  }

  return (
    <LanguageContext.Provider value={{ lang, direction: dir, setLang }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  return useContext(LanguageContext);
}
