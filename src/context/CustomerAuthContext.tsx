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
    const { data: userRow } = await supabase
      .from('Users')
      .select('role, status, name')
      .eq('email', email)
      .maybeSingle();

    if (!userRow) return { success: false, error: 'أنت لست عضواً — قم بالتسجيل أولاً' };

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !data.user) return { success: false, error: 'كلمة المرور غير صحيحة' };

    if (userRow.role?.trim() === 'merchant') {
      await supabase.auth.signOut();
      return { success: false, error: 'هذا حساب تاجر — يرجى استخدام تسجيل دخول التاجر' };
    }

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

    if (error || !data.user) return { success: false, error: error?.message ?? 'حدث خطأ غير متوقع' };
    return { success: true };
  };

  const logout = async () => {
    await supabase.auth.signOut();
  };

  return (
    <CustomerAuthContext.Provider value={{ customer, login, signup, logout, isLoading }}>
      {children}
    </CustomerAuthContext.Provider>
  );
}

export function useCustomerAuth() {
  const ctx = useContext(CustomerAuthContext);
  if (!ctx) throw new Error('useCustomerAuth must be inside CustomerAuthProvider');
  return ctx;
}
