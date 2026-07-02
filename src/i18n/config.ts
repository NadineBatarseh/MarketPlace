import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import arCommon from '../locales/ar/common.json';
import arErrors from '../locales/ar/errors.json';
import arAuth from '../locales/ar/auth.json';
import arCustomer from '../locales/ar/customer.json';
import arCartCheckout from '../locales/ar/cart-checkout.json';
import arOrders from '../locales/ar/orders.json';
import arMerchant from '../locales/ar/merchant.json';
import arAdmin from '../locales/ar/admin.json';
import arDriver from '../locales/ar/driver.json';

import enCommon from '../locales/en/common.json';
import enErrors from '../locales/en/errors.json';
import enAuth from '../locales/en/auth.json';
import enCustomer from '../locales/en/customer.json';
import enCartCheckout from '../locales/en/cart-checkout.json';
import enOrders from '../locales/en/orders.json';
import enMerchant from '../locales/en/merchant.json';
import enAdmin from '../locales/en/admin.json';
import enDriver from '../locales/en/driver.json';

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: 'ar',
    supportedLngs: ['ar', 'en'],
    defaultNS: 'common',
    ns: ['common', 'errors', 'auth', 'customer', 'cart-checkout', 'orders', 'merchant', 'admin', 'driver'],
    resources: {
      ar: {
        common: arCommon,
        errors: arErrors,
        auth: arAuth,
        customer: arCustomer,
        'cart-checkout': arCartCheckout,
        orders: arOrders,
        merchant: arMerchant,
        admin: arAdmin,
        driver: arDriver,
      },
      en: {
        common: enCommon,
        errors: enErrors,
        auth: enAuth,
        customer: enCustomer,
        'cart-checkout': enCartCheckout,
        orders: enOrders,
        merchant: enMerchant,
        admin: enAdmin,
        driver: enDriver,
      },
    },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'souqlink_lang',
    },
    interpolation: {
      escapeValue: false,
    },
  });

export default i18n;
