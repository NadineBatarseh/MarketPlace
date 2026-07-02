import React, { createContext, useContext, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import supabase from '../../lib/supabase';
import { useSharedAuth } from '../../context/AuthContext';

export interface MerchantShop {
  shop_id: string;
  name: string;
  shopLogo: string | null;
  location: string | null;
  zone_id: string | null;
  description: string | null;
  whatsapp: string | null;
  facebook: string | null;
  instagram: string | null;
  merchant_id: string;
  Type_of_store: string | null;
  latitude: number | null;
  longitude: number | null;
  status: string;
}

export interface Merchant {
  id: string;
  email: string;
  displayName: string;
  shop: MerchantShop | null;
}

interface MerchantAuthContextType {
  merchant: Merchant | null;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  refreshShop: () => Promise<void>;
  updateShopLocally: (shop: MerchantShop) => void;
  isLoading: boolean;
}

const MerchantAuthContext = createContext<MerchantAuthContextType | null>(null);

async function fetchMerchantShop(userId: string): Promise<MerchantShop | null> {
  const { data: merchantData } = await supabase
    .from('merchants')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle();

  if (!merchantData) return null;

  const { data, error } = await supabase
    .from('shops')
    .select('*')
    .eq('merchant_id', merchantData.id)
    .maybeSingle();

  if (error || !data) return null;

  return {
    shop_id: data.shop_id,
    name: data.name,
    shopLogo: data.shopLogo ?? null,
    location: data.location ?? null,
    zone_id: data.zone_id ?? null,
    description: data.description ?? null,
    whatsapp: data.whatsapp ?? null,
    facebook: data.facebook ?? null,
    instagram: data.instagram ?? null,
    merchant_id: data.merchant_id,
    Type_of_store: data.Type_of_store ?? null,
    latitude: data.shop_lat ?? null,
    longitude: data.shop_lng ?? null,
    // Strip accidental surrounding quotes from the DB default ('''pending''' → 'pending')
    status: (data.status ?? 'pending').replace(/^'|'$/g, ''),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildMerchant(user: any, shop: MerchantShop | null, defaultDisplayName: string): Merchant {
  return {
    id: user.id,
    email: user.email ?? '',
    displayName:
      user.user_metadata?.full_name ??
      user.user_metadata?.name ??
      (user.email as string | undefined)?.split('@')[0] ??
      defaultDisplayName,
    shop,
  };
}

export function MerchantAuthProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation('merchant');
  const { rawUser, role, status, isLoading: authLoading } = useSharedAuth();
  const [shop, setShop] = useState<MerchantShop | null>(null);
  const [shopLoading, setShopLoading] = useState(false);

  const isMerchantApproved = rawUser && role === 'merchant' && status === 'approved';

  useEffect(() => {
    if (!rawUser || role !== 'merchant' || status !== 'approved') {
      setShop(null);
      setShopLoading(false);
      return;
    }
    setShopLoading(true);
    fetchMerchantShop(rawUser.id).then(s => {
      setShop(s);
      setShopLoading(false);
    });
  }, [rawUser?.id, role, status]);

  const merchant: Merchant | null = isMerchantApproved
    ? buildMerchant(rawUser, shop, t('auth.defaultDisplayName'))
    : null;

  const isLoading = authLoading || shopLoading;

  const login = async (email: string, password: string): Promise<{ success: boolean; error?: string }> => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error || !data.user) {
      const msg =
        error?.message === 'Invalid login credentials'
          ? t('auth.invalidCredentials')
          : (error?.message ?? t('auth.unexpectedError'));
      return { success: false, error: msg };
    }

    // Direct DB check needed here — shared auth state hasn't updated yet
    const { data: userData } = await supabase
      .from('Users')
      .select('role, status')
      .eq('user_id', data.user.id)
      .maybeSingle();

    if (userData?.role?.trim() !== 'merchant') {
      await supabase.auth.signOut();
      return { success: false, error: t('auth.notMerchantAccount') };
    }

    if (userData?.status?.trim() !== 'approved') {
      await supabase.auth.signOut();
      return { success: false, error: t('auth.pendingApproval') };
    }

    return { success: true };
  };

  const logout = async () => {
    await supabase.auth.signOut();
    setShop(null);
  };

  const refreshShop = async () => {
    if (!rawUser) return;
    const s = await fetchMerchantShop(rawUser.id);
    setShop(s);
  };

  const updateShopLocally = (s: MerchantShop) => {
    setShop(s);
  };

  return (
    <MerchantAuthContext.Provider value={{ merchant, login, logout, refreshShop, updateShopLocally, isLoading }}>
      {children}
    </MerchantAuthContext.Provider>
  );
}

export function useMerchantAuth() {
  const ctx = useContext(MerchantAuthContext);
  if (!ctx) throw new Error('useMerchantAuth must be inside MerchantAuthProvider');
  return ctx;
}
