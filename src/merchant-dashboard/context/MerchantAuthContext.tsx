import React, { createContext, useContext, useState, useEffect } from 'react';
import supabase from '../../lib/supabase';

export interface MerchantShop {
  shop_id: string;
  name: string;
  shopLogo: string | null;
  location: string | null;
  description: string | null;
  whatsapp: string | null;
  facebook: string | null;
  instagram: string | null;
  merchant_id: string;
  categories: string[];
}

export interface Merchant {
  id: string;           // = auth.users.id
  email: string;
  displayName: string;  // from user_metadata.full_name, falls back to email prefix
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

/** Returns true only if the user has role='merchant' in public.users */
async function isMerchantRole(userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('Users')
    .select('role, user_id, email')
    .eq('user_id', userId)
    .single();

  console.log('Checking merchant role for userId:', userId);
  console.log('Users row:', data);
  console.log('Users query error:', error);

  if (error) return false;

  return data?.role?.trim() === 'merchant';
}

async function fetchMerchantShop(userId: string): Promise<MerchantShop | null> {
  const { data, error } = await supabase
    .from('shops')
    .select('*')
    .eq('owner_id', userId)
    .maybeSingle();

  if (error || !data) return null;

  return {
    shop_id: data.shop_id,
    name: data.name,
    shopLogo: data.shopLogo ?? null,
    location: data.location ?? null,
    description: data.description ?? null,
    whatsapp: data.whatsapp ?? null,
    facebook: data.facebook ?? null,
    instagram: data.instagram ?? null,
    merchant_id: data.merchant_id,
    categories: data.categories ?? [],
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildMerchant(user: any, shop: MerchantShop | null): Merchant {
  return {
    id: user.id,
    email: user.email ?? '',
    displayName:
      user.user_metadata?.full_name ??
      user.user_metadata?.name ??
      (user.email as string | undefined)?.split('@')[0] ??
      'تاجر',
    shop,
  };
}

export function MerchantAuthProvider({ children }: { children: React.ReactNode }) {
  const [merchant, setMerchant] = useState<Merchant | null>(null);
  const [isLoading, setIsLoading] = useState(true); // stays true until session is resolved

  useEffect(() => {
    // Restore existing session on page load — only if the user is actually a merchant
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session?.user) {
        const isMerchant = await isMerchantRole(session.user.id);
        if (isMerchant) {
          const shop = await fetchMerchantShop(session.user.id);
          setMerchant(buildMerchant(session.user, shop));
        }
      }
      setIsLoading(false);
    });

    // Keep in sync with auth state changes (token refresh, sign-out, etc.)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || !session) setMerchant(null);
    });

    return () => subscription.unsubscribe();
  }, []);

  const login = async (email: string, password: string): Promise<{ success: boolean; error?: string }> => {
    setIsLoading(true);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error || !data.user) {
      setIsLoading(false);
      const msg =
        error?.message === 'Invalid login credentials'
          ? 'البريد الإلكتروني أو كلمة المرور غير صحيحة'
          : (error?.message ?? 'حدث خطأ غير متوقع');
      return { success: false, error: msg };
    }

    // Verify the user has the merchant role in public.users
    const isMerchant = await isMerchantRole(data.user.id);
    if (!isMerchant) {
      await supabase.auth.signOut();
      setIsLoading(false);
      return { success: false, error: 'هذا الحساب ليس حساب تاجر — يرجى التواصل مع الإدارة' };
    }

    const shop = await fetchMerchantShop(data.user.id);
    setMerchant(buildMerchant(data.user, shop));
    setIsLoading(false);
    return { success: true };
  };

  const logout = async () => {
    await supabase.auth.signOut();
    setMerchant(null);
  };

  const refreshShop = async () => {
    if (!merchant) return;
    const shop = await fetchMerchantShop(merchant.id);
    setMerchant(prev => prev ? { ...prev, shop } : null);
  };

  const updateShopLocally = (shop: MerchantShop) => {
    setMerchant(prev => prev ? { ...prev, shop } : null);
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
