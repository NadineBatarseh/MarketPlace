import { useState, useEffect } from 'react';
import type { Store } from '../types';
import { fetchStore } from '../api';

interface UseStoreResult {
  store: Store | null;
  loading: boolean;
  error: string | null;
}

export function useStore(shopId: string): UseStoreResult {
  const [store, setStore] = useState<Store | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchStore(shopId)
      .then(s => { if (!cancelled) setStore(s); })
      .catch(e => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [shopId]);

  return { store, loading, error };
}
