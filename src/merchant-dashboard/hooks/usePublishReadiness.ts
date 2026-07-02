import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation('merchant');
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
      label: t('publishReadiness.logoLabel'),
      passed: !!shop.shopLogo,
      hint: t('publishReadiness.logoHint'),
      action: 'shopSettings',
    },
    {
      id: 'name',
      label: t('publishReadiness.nameLabel'),
      passed: shop.name.trim().length > 0,
      hint: t('publishReadiness.nameHint'),
      action: 'shopSettings',
    },
    {
      id: 'description',
      label: t('publishReadiness.descriptionLabel', { minLen: MIN_DESCRIPTION_LEN }),
      passed: (shop.description?.trim().length ?? 0) >= MIN_DESCRIPTION_LEN,
      hint: t('publishReadiness.descriptionHint', { minLen: MIN_DESCRIPTION_LEN }),
      action: 'shopSettings',
    },
    {
      id: 'location',
      label: t('publishReadiness.locationLabel'),
      passed: (shop.location?.trim().length ?? 0) > 0,
      hint: t('publishReadiness.locationHint'),
      action: 'shopSettings',
    },
    {
      id: 'social',
      label: t('publishReadiness.socialLabel'),
      passed: !!(shop.instagram?.trim() || shop.facebook?.trim() || shop.whatsapp?.trim()),
      hint: t('publishReadiness.socialHint'),
      action: 'shopSettings',
    },
    {
      id: 'products',
      label: t('publishReadiness.productsLabel'),
      passed: (productCount ?? 0) >= 1,
      hint: t('publishReadiness.productsHint'),
      action: 'editPage',
    },
  ];

  const allPassed = !loading && checks.every(c => c.passed);

  return { checks, allPassed, loading };
}
