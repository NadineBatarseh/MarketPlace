import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import supabase from '../lib/supabase';

// ──────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────

export interface CartItem {
  id: string | number;
  name: string;
  image: string;
  price: number;
  quantity: number;
}

export interface FavoriteItem {
  id: string | number;
  name: string;
  image: string;
  price: number;
  dateAdded: string;
  inStock: boolean;
}

interface AddToCartInput {
  id: string | number;
  name: string;
  image: string;
  price: number;
}

interface ToggleFavoriteInput {
  id: string | number;
  name: string;
  image: string;
  price: number;
  inStock?: boolean;
}

interface ShopContextValue {
  cartItems: CartItem[];
  addToCart: (product: AddToCartInput) => void;
  removeFromCart: (id: string | number) => void;
  updateCartQty: (id: string | number, qty: number) => void;
  clearCart: () => void;
  cartCount: number;
  isInCart: (id: string | number) => boolean;

  favoriteItems: FavoriteItem[];
  toggleFavorite: (product: ToggleFavoriteInput) => void;
  removeFromFavorites: (id: string | number) => void;
  clearFavorites: () => void;
  isFavorited: (id: string | number) => boolean;
  favCount: number;
}

// ──────────────────────────────────────────────────────────
// Context
// ──────────────────────────────────────────────────────────

const ShopContext = createContext<ShopContextValue | null>(null);

// ──────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────

function loadStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

// ──────────────────────────────────────────────────────────
// Provider
// ──────────────────────────────────────────────────────────

export function ShopProvider({ children, userId }: { children: React.ReactNode; userId?: string }) {
  const cartKey = `sq_cart_${userId ?? 'guest'}`;
  const favKey  = `sq_fav_${userId ?? 'guest'}`;

  const [cartItems, setCartItems] = useState<CartItem[]>(() =>
    loadStorage<CartItem[]>(cartKey, [])
  );
  const [favoriteItems, setFavoriteItems] = useState<FavoriteItem[]>(() =>
    loadStorage<FavoriteItem[]>(favKey, [])
  );

  // Keep refs in sync so actions always read the latest state without stale closures
  const cartItemsRef = useRef<CartItem[]>(cartItems);
  const favItemsRef  = useRef<FavoriteItem[]>(favoriteItems);
  useEffect(() => { cartItemsRef.current = cartItems; }, [cartItems]);
  useEffect(() => { favItemsRef.current  = favoriteItems; }, [favoriteItems]);

  // Supabase serial IDs — fetched once on login
  const cartSerialIdRef = useRef<number | null>(null);
  const favSerialIdRef  = useRef<number | null>(null);

  // ── Lazy helpers: ensure the DB row exists and return its serial ID ──

  const ensureCartRow = useCallback(async (): Promise<number | null> => {
    if (!userId) return null;
    if (cartSerialIdRef.current !== null) return cartSerialIdRef.current;

    const { data: rows } = await supabase
      .from('carts')
      .select('cartsSerial_id')
      .eq('user_id', userId)
      .order('cartsSerial_id', { ascending: false })
      .limit(1);
    let row = rows?.[0] ?? null;

    if (!row) {
      const { data: newRow, error } = await supabase
        .from('carts')
        .insert({ user_id: userId })
        .select('cartsSerial_id')
        .single();
      if (error) { console.error('[ShopContext] create cart row failed:', error); return null; }
      row = newRow;
    }

    cartSerialIdRef.current = row?.cartsSerial_id ?? null;
    return cartSerialIdRef.current;
  }, [userId]);

  const ensureFavRow = useCallback(async (): Promise<number | null> => {
    if (!userId) return null;
    if (favSerialIdRef.current !== null) return favSerialIdRef.current;

    const { data: rows } = await supabase
      .from('favorites')
      .select('favoriteSerial_id')
      .eq('user_id', userId)
      .order('favoriteSerial_id', { ascending: false })
      .limit(1);
    let row = rows?.[0] ?? null;

    if (!row) {
      const { data: newRow, error } = await supabase
        .from('favorites')
        .insert({ user_id: userId })
        .select('favoriteSerial_id')
        .single();
      if (error) { console.error('[ShopContext] create favorites row failed:', error); return null; }
      row = newRow;
    }

    favSerialIdRef.current = row?.favoriteSerial_id ?? null;
    return favSerialIdRef.current;
  }, [userId]);

  // ── Load cart from Supabase on login ──────────────────

  useEffect(() => {
    if (!userId) {
      cartSerialIdRef.current = null;
      setCartItems(loadStorage<CartItem[]>(cartKey, []));
      return;
    }

    async function load() {
      const serialId = await ensureCartRow();
      if (serialId === null) return;

      const { data: items, error } = await supabase
        .from('cart_items')
        .select('product_id, quantity, products(id, title, image_urls, price)')
        .eq('cartSerial_id', serialId);

      if (error) { console.error('[ShopContext] load cart_items failed:', error); return; }
      if (!items) return;

      setCartItems((items as any[]).map((item) => ({
        id: item.product_id,
        name: item.products?.title ?? 'منتج',
        image: item.products?.image_urls?.[0] ?? '',
        price: parseFloat(String(item.products?.price ?? '0').replace(/[^\d.]/g, '')) || 0,
        quantity: item.quantity ?? 1,
      })));
    }

    load();
  }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load favorites from Supabase on login ─────────────

  useEffect(() => {
    if (!userId) {
      favSerialIdRef.current = null;
      setFavoriteItems(loadStorage<FavoriteItem[]>(favKey, []));
      return;
    }

    async function load() {
      const serialId = await ensureFavRow();
      if (serialId === null) return;

      const { data: items, error } = await supabase
        .from('favorite_items')
        .select('product_id, created_at, products(id, title, image_urls, price)')
        .eq('favoriteSerial_id', serialId);

      if (error) { console.error('[ShopContext] load favorite_items failed:', error); return; }
      if (!items) return;

      setFavoriteItems((items as any[]).map((item) => ({
        id: item.product_id,
        name: item.products?.title ?? 'منتج',
        image: item.products?.image_urls?.[0] ?? '',
        price: parseFloat(String(item.products?.price ?? '0').replace(/[^\d.]/g, '')) || 0,
        dateAdded: item.created_at?.split('T')[0] ?? new Date().toISOString().split('T')[0],
        inStock: true,
      })));
    }

    load();
  }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Persist to localStorage for guests only ────────────

  useEffect(() => {
    if (!userId) localStorage.setItem(cartKey, JSON.stringify(cartItems));
  }, [cartItems, cartKey, userId]);

  useEffect(() => {
    if (!userId) localStorage.setItem(favKey, JSON.stringify(favoriteItems));
  }, [favoriteItems, favKey, userId]);

  // ── Cart actions ──────────────────────────────────────

  const addToCart = useCallback((product: AddToCartInput) => {
    const existing = cartItemsRef.current.find((item) => item.id === product.id);

    // Update local state immediately
    setCartItems((prev) => {
      if (prev.find((item) => item.id === product.id)) {
        return prev.map((item) =>
          item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item
        );
      }
      return [...prev, { ...product, quantity: 1 }];
    });

    // Sync to Supabase in background
    if (userId) {
      ensureCartRow().then((serialId) => {
        if (serialId === null) return;
        if (existing) {
          supabase
            .from('cart_items')
            .update({ quantity: existing.quantity + 1 })
            .eq('cartSerial_id', serialId)
            .eq('product_id', String(product.id))
            .then(({ error }) => { if (error) console.error('[ShopContext] cart update failed:', error); });
        } else {
          supabase
            .from('cart_items')
            .insert({ cartSerial_id: serialId, product_id: String(product.id), quantity: 1 })
            .then(({ error }) => { if (error) console.error('[ShopContext] cart insert failed:', error); });
        }
      });
    }
  }, [userId, ensureCartRow]);

  const removeFromCart = useCallback((id: string | number) => {
    setCartItems((prev) => prev.filter((item) => item.id !== id));

    if (userId) {
      ensureCartRow().then((serialId) => {
        if (serialId === null) return;
        supabase
          .from('cart_items')
          .delete()
          .eq('cartSerial_id', serialId)
          .eq('product_id', String(id))
          .then(({ error }) => { if (error) console.error('[ShopContext] cart delete failed:', error); });
      });
    }
  }, [userId, ensureCartRow]);

  const updateCartQty = useCallback((id: string | number, qty: number) => {
    setCartItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, quantity: qty } : item))
    );

    if (userId) {
      ensureCartRow().then((serialId) => {
        if (serialId === null) return;
        supabase
          .from('cart_items')
          .update({ quantity: qty })
          .eq('cartSerial_id', serialId)
          .eq('product_id', String(id))
          .then(({ error }) => { if (error) console.error('[ShopContext] cart qty update failed:', error); });
      });
    }
  }, [userId, ensureCartRow]);

  const clearCart = useCallback(() => {
    setCartItems([]);

    if (userId) {
      ensureCartRow().then((serialId) => {
        if (serialId === null) return;
        supabase
          .from('cart_items')
          .delete()
          .eq('cartSerial_id', serialId)
          .then(({ error }) => { if (error) console.error('[ShopContext] cart clear failed:', error); });
      });
    }
  }, [userId, ensureCartRow]);

  const isInCart = useCallback(
    (id: string | number) => cartItems.some((item) => item.id === id),
    [cartItems]
  );

  // ── Favorites actions ─────────────────────────────────

  const toggleFavorite = useCallback((product: ToggleFavoriteInput) => {
    const exists = favItemsRef.current.find((item) => item.id === product.id);

    setFavoriteItems((prev) => {
      if (prev.find((item) => item.id === product.id)) {
        return prev.filter((item) => item.id !== product.id);
      }
      return [
        ...prev,
        {
          id: product.id,
          name: product.name,
          image: product.image,
          price: product.price,
          inStock: product.inStock ?? true,
          dateAdded: new Date().toISOString().split('T')[0],
        },
      ];
    });

    if (userId) {
      ensureFavRow().then((serialId) => {
        if (serialId === null) return;
        if (exists) {
          supabase
            .from('favorite_items')
            .delete()
            .eq('favoriteSerial_id', serialId)
            .eq('product_id', String(product.id))
            .then(({ error }) => { if (error) console.error('[ShopContext] fav delete failed:', error); });
        } else {
          supabase
            .from('favorite_items')
            .insert({ favoriteSerial_id: serialId, product_id: String(product.id) })
            .then(({ error }) => { if (error) console.error('[ShopContext] fav insert failed:', error); });
        }
      });
    }
  }, [userId, ensureFavRow]);

  const removeFromFavorites = useCallback((id: string | number) => {
    setFavoriteItems((prev) => prev.filter((item) => item.id !== id));

    if (userId) {
      ensureFavRow().then((serialId) => {
        if (serialId === null) return;
        supabase
          .from('favorite_items')
          .delete()
          .eq('favoriteSerial_id', serialId)
          .eq('product_id', String(id))
          .then(({ error }) => { if (error) console.error('[ShopContext] fav remove failed:', error); });
      });
    }
  }, [userId, ensureFavRow]);

  const clearFavorites = useCallback(() => {
    setFavoriteItems([]);

    if (userId) {
      ensureFavRow().then((serialId) => {
        if (serialId === null) return;
        supabase
          .from('favorite_items')
          .delete()
          .eq('favoriteSerial_id', serialId)
          .then(({ error }) => { if (error) console.error('[ShopContext] fav clear failed:', error); });
      });
    }
  }, [userId, ensureFavRow]);

  const isFavorited = useCallback(
    (id: string | number) => favoriteItems.some((item) => item.id === id),
    [favoriteItems]
  );

  // ── Derived counts ────────────────────────────────────

  const cartCount = cartItems.reduce((sum, item) => sum + item.quantity, 0);
  const favCount  = favoriteItems.length;

  return (
    <ShopContext.Provider
      value={{
        cartItems,
        addToCart,
        removeFromCart,
        updateCartQty,
        clearCart,
        cartCount,
        isInCart,
        favoriteItems,
        toggleFavorite,
        removeFromFavorites,
        clearFavorites,
        isFavorited,
        favCount,
      }}
    >
      {children}
    </ShopContext.Provider>
  );
}

// ──────────────────────────────────────────────────────────
// Hook
// ──────────────────────────────────────────────────────────

export function useShop(): ShopContextValue {
  const ctx = useContext(ShopContext);
  if (!ctx) throw new Error('useShop must be used inside <ShopProvider>');
  return ctx;
}
