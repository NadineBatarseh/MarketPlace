import { useState, useEffect } from 'react';
import supabase from '../../lib/supabase';
import { MerchantShop } from '../context/MerchantAuthContext';

export interface PublishCheck {
  id: string;
  label: string;
  passed: boolean;
  hint: string;
  action?: string;
}

export interface UsePublishReadinessResult {
  checks: PublishCheck[];
  allPassed: boolean;
  loading: boolean;
}

const MIN_DESCRIPTION_LEN = 20;

export function usePublishReadiness(shop: MerchantShop | null): UsePublishReadinessResult {
  const [productCount, setProductCount] = useState<number | null>(null);

  useEffect(() => {
    if (!shop?.shop_id) {
      setProductCount(0);
      return;
    }
    setProductCount(null);
    supabase
      .from('products')
      .select('*', { count: 'exact', head: true })
      .eq('shop_id', shop.shop_id)
      .then(({ count }) => setProductCount(count ?? 0));
  }, [shop?.shop_id]);

  if (!shop) return { checks: [], allPassed: false, loading: true };

  const loading = productCount === null;

  const checks: PublishCheck[] = [
    {
      id: 'logo',
      label: 'شعار المتجر',
      passed: !!shop.shopLogo,
      hint: 'ارفع صورة شعار من إعدادات المتجر',
      action: 'shopSettings',
    },
    {
      id: 'name',
      label: 'اسم المتجر',
      passed: shop.name.trim().length > 0,
      hint: 'أدخل اسم المتجر في إعدادات المتجر',
      action: 'shopSettings',
    },
    {
      id: 'description',
      label: `وصف المتجر (${MIN_DESCRIPTION_LEN} حرف على الأقل)`,
      passed: (shop.description?.trim().length ?? 0) >= MIN_DESCRIPTION_LEN,
      hint: `أضف وصفاً مفصّلاً عن متجرك (${MIN_DESCRIPTION_LEN} أحرف أو أكثر)`,
      action: 'shopSettings',
    },
    {
      id: 'location',
      label: 'المنطقة / المدينة',
      passed: (shop.location?.trim().length ?? 0) > 0,
      hint: 'أدخل المنطقة أو المدينة في إعدادات المتجر',
      action: 'shopSettings',
    },
    {
      id: 'social',
      label: 'رابط تواصل اجتماعي (إنستقرام أو فيسبوك أو واتساب)',
      passed: !!(shop.instagram?.trim() || shop.facebook?.trim() || shop.whatsapp?.trim()),
      hint: 'أضف رابط إنستقرام أو فيسبوك أو رقم واتساب في إعدادات المتجر',
      action: 'shopSettings',
    },
    {
      id: 'products',
      label: 'منتج واحد على الأقل',
      passed: (productCount ?? 0) >= 1,
      hint: 'أضف منتجاً واحداً على الأقل من صفحة إدارة المنتجات',
      action: 'editPage',
    },
  ];

  const allPassed = !loading && checks.every(c => c.passed);

  return { checks, allPassed, loading };
}
