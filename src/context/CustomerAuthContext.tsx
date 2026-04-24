import React, { createContext, useContext } from 'react';
import supabase from '../lib/supabase';
import { useSharedAuth } from './AuthContext';

export interface Customer {
  id: string;
  email: string;
  displayName: string;
  role: string;
}

interface CustomerAuthContextType {
  customer: Customer | null;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  signup: (email: string, password: string, name: string) => Promise<{ success: boolean; error?: string }>;
  signInWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  isLoading: boolean;
}

const CustomerAuthContext = createContext<CustomerAuthContextType | null>(null);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildCustomer(user: any, name: string | null, role: string): Customer {
  return {
    id: user.id,
    email: user.email ?? '',
    displayName: name ?? (user.email as string | undefined)?.split('@')[0] ?? 'عميل',
    role,
  };
}

export function CustomerAuthProvider({ children }: { children: React.ReactNode }) {
  const { rawUser, role, name, isLoading } = useSharedAuth();

  const customer: Customer | null =
    rawUser && role && role !== 'merchant'
      ? buildCustomer(rawUser, name, role)
      : null;

  const login = async (email: string, password: string): Promise<{ success: boolean; error?: string }> => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error || !data.user) {
      const msg = error?.message;
      if (msg === 'Email not confirmed')
        return { success: false, error: 'لم يتم تأكيد البريد الإلكتروني بعد — تحقق من بريدك واضغط على رابط التأكيد' };
      return { success: false, error: 'البريد الإلكتروني أو كلمة المرور غير صحيحة' };
    }

    const { data: userRow } = await supabase
      .from('Users')
      .select('role, status, name')
      .eq('user_id', data.user.id)
      .maybeSingle();

    // Row exists — validate role
    if (userRow) {
      if (userRow.role?.trim() === 'merchant') {
        await supabase.auth.signOut();
        return { success: false, error: 'هذا حساب تاجر — يرجى استخدام تسجيل دخول التاجر' };
      }
      return { success: true };
    }

    // No row yet — this is a customer who confirmed email but trigger missed it
    const name = data.user.user_metadata?.full_name ?? data.user.email?.split('@')[0] ?? 'عميل';
    await supabase.from('Users').insert({
      user_id: data.user.id,
      email: data.user.email,
      name,
      role: 'customer',
      status: 'approved',
    });

    return { success: true };
  };

  const signup = async (email: string, password: string, name: string): Promise<{ success: boolean; error?: string }> => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: name },
        emailRedirectTo: `${window.location.origin}/login`,
      },
    });

    if (error || !data.user) {
      const msg = error?.message?.toLowerCase();
      const friendly =
        msg?.includes('invalid') && msg?.includes('email')
          ? 'البريد الإلكتروني غير صالح — تحقق من الكتابة وأعد المحاولة'
          : msg?.includes('already registered') || msg?.includes('already been registered')
          ? 'هذا البريد الإلكتروني مسجل مسبقاً — يمكنك تسجيل الدخول مباشرة'
          : msg?.includes('too many') || msg?.includes('rate limit') || error?.status === 429
          ? 'تم تجاوز الحد المسموح به من المحاولات — يرجى الانتظار قليلاً ثم المحاولة مجدداً'
          : 'حدث خطأ غير متوقع';
      return { success: false, error: friendly };
    }
    return { success: true };
  };

  const signInWithGoogle = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/store`,
      },
    });
  };

  const logout = async () => {
    await supabase.auth.signOut();
  };

  return (
    <CustomerAuthContext.Provider value={{ customer, login, signup, signInWithGoogle, logout, isLoading }}>
      {children}
    </CustomerAuthContext.Provider>
  );
}

export function useCustomerAuth() {
  const ctx = useContext(CustomerAuthContext);
  if (!ctx) throw new Error('useCustomerAuth must be inside CustomerAuthProvider');
  return ctx;
}
