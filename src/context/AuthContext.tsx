import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import supabase from '../lib/supabase';

export interface SharedAuthState {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rawUser: any | null;
  role: string | null;
  name: string | null;
  status: string | null;
  isLoading: boolean;
}

const AuthContext = createContext<SharedAuthState | null>(null);

async function fetchUserData(userId: string) {
  const { data } = await supabase
    .from('Users')
    .select('role, name, status')
    .eq('user_id', userId)
    .maybeSingle();
  return {
    role: data?.role?.trim() ?? null,
    name: data?.name ?? null,
    status: data?.status?.trim() ?? null,
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [rawUser, setRawUser] = useState<any | null>(undefined); // undefined = not yet resolved
  const [role, setRole] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const wasLoggedIn = useRef(false);

  // Step 1: listen for auth changes — no async DB work here
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || !session) {
        // Redirect to login if the session dropped for a previously authenticated user
        // (covers both explicit logout and invalid/expired refresh token)
        if (event === 'SIGNED_OUT' && wasLoggedIn.current) {
          window.location.href = '/login';
        }
        setRawUser(null);
      } else if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        wasLoggedIn.current = true;
        setRawUser(session.user);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  // Step 2: fetch DB data separately, after the auth lock is released
  useEffect(() => {
    if (rawUser === undefined) return; // not yet resolved
    if (rawUser === null) {
      setRole(null);
      setName(null);
      setStatus(null);
      setIsLoading(false);
      return;
    }
    fetchUserData(rawUser.id).then(async userData => {
      if (userData.role) {
        setRole(userData.role);
        setName(userData.name);
        setStatus(userData.status);
        setIsLoading(false);
        return;
      }

      // No public.Users row but user exists in auth and email is confirmed
      // Only auto-create for customers — merchants/delivery/hub go through admin approval
      if (rawUser.email_confirmed_at) {
        const role = rawUser.user_metadata?.role?.trim() || 'customer';
        if (role === 'customer') {
          const name = rawUser.user_metadata?.full_name ?? rawUser.email?.split('@')[0] ?? null;
          const provider = rawUser.app_metadata?.provider === 'google' ? 'google' : 'email';
          await supabase.from('Users').insert({
            user_id: rawUser.id,
            email: rawUser.email,
            name,
            role: 'customer',
            status: 'approved',
            provider,
          });
          setRole('customer');
          setName(name);
          setStatus('approved');
        }
      }
      setIsLoading(false);
    });
  }, [rawUser?.id, rawUser === null]);

  return (
    <AuthContext.Provider value={{ rawUser, role, name, status, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useSharedAuth(): SharedAuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useSharedAuth must be inside AuthProvider');
  return ctx;
}
