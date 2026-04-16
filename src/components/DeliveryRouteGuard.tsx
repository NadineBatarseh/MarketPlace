import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useSharedAuth } from '../context/AuthContext';

interface DeliveryRouteGuardProps {
  children: ReactNode;
}

export default function DeliveryRouteGuard({ children }: DeliveryRouteGuardProps) {
  const { rawUser, role, isLoading } = useSharedAuth();

  // Auth state not resolved yet — render nothing to avoid flash redirects
  if (isLoading) return null;

  // Not logged in → send to login
  if (!rawUser) return <Navigate to="/login" replace />;

  // Logged in but wrong role → send to home
  if (role !== 'delivery') return <Navigate to="/" replace />;

  // Authorised delivery user → render the page
  return <>{children}</>;
}
