import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useSharedAuth } from '../context/AuthContext';

const ROLE_HOME: Record<string, string> = {
  customer: '/home',
  merchant: '/merchant-dashboard',
  delivery: '/driver-dashboard',
  admin: '/admin-dashboard',
};

interface RoleGuardProps {
  children: ReactNode;
  allowedRoles: string[];
  /** If true, unauthenticated (guest) users are also allowed through */
  allowGuests?: boolean;
}

export default function RoleGuard({ children, allowedRoles, allowGuests = false }: RoleGuardProps) {
  const { rawUser, role, isLoading } = useSharedAuth();

  if (isLoading) return null;

  if (!rawUser) {
    if (allowGuests) return <>{children}</>;
    return <Navigate to="/login" replace />;
  }

  // If guests are allowed, any authenticated user is also allowed (public page)
  if (allowGuests) return <>{children}</>;

  // Role not yet resolved (transient state between SIGNED_IN and DB fetch) — wait
  if (!role) return null;

  if (!allowedRoles.includes(role)) {
    const home = ROLE_HOME[role] ?? '/home';
    return <Navigate to={home} replace />;
  }

  return <>{children}</>;
}
