import React, { createContext, useContext, useState, useEffect } from 'react';
import supabase from '../lib/supabase';

export interface Customer {
  id: string;
  email: string;
  displayName: string;
}

interface CustomerAuthContextType {
  customer: Customer | null;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  signup: (email: string, password: string, name: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  isLoading: boolean;
}

const CustomerAuthContext = createContext<CustomerAuthContextType | null>(null);

async function fetchUserRole(userId: string): Promise<string | null> {
  const { data } = await supabase
    .from('users')
    .select('role')
    .eq('user_id', userId)
    .maybeSingle();
  return data?.role ?? null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildCustomer(user: any): Customer {
  return {
    id: user.id,
    email: user.email ?? '',
    displayName:
      user.user_metadata?.full_name ??
      user.user_metadata?.name ??
      (user.email as string | undefined)?.split('@')[0] ??
      'عميل',
  };
}

export function CustomerAuthProvider({ children }: { children: React.ReactNode }) {
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Restore session only if the logged-in user is NOT a merchant
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session?.user) {
        const role = await fetchUserRole(session.user.id);
        if (role !== 'merchant') {
          setCustomer(buildCustomer(session.user));
        }
      }
      setIsLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || !session) setCustomer(null);
    });

    return () => subscription.unsubscribe();
  }, []);

  const login = async (
    email: string,
    password: string
  ): Promise<{ success: boolean; error?: string }> => {
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

    const role = await fetchUserRole(data.user.id);
    if (role === 'merchant') {
      await supabase.auth.signOut();
      setIsLoading(false);
      return { success: false, error: 'هذا حساب تاجر — يرجى استخدام تسجيل دخول التاجر' };
    }

    setCustomer(buildCustomer(data.user));
    setIsLoading(false);
    return { success: true };
  };

  const signup = async (
    email: string,
    password: string,
    name: string
  ): Promise<{ success: boolean; error?: string }> => {
    setIsLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: name } },
    });

    if (error || !data.user) {
      setIsLoading(false);
      return { success: false, error: error?.message ?? 'حدث خطأ غير متوقع' };
    }

    // Register in public.users with customer role
    await supabase.from('users').upsert({
      user_id: data.user.id,
      email,
      name,
      role: 'customer',
      created_at: new Date().toISOString(),
    });

    setCustomer(buildCustomer(data.user));
    setIsLoading(false);
    return { success: true };
  };

  const logout = async () => {
    await supabase.auth.signOut();
    setCustomer(null);
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
