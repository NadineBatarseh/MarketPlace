import React, { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Star, StarHalf, ShoppingCart, Heart, Share2, ChevronLeft, ChevronRight,
  Plus, Minus, Truck, CreditCard, X, Camera,
} from 'lucide-react';
import supabase from '../../lib/supabase';
import Topbar from '../../components/Topbar';
import StoreNav from '../../components/StoreNav';
import { useShop } from '../../context/ShopContext';
import CartConfirmModal from '../../components/CartConfirmModal';

// Brand palette (per Souq Link product-page design system)
const GREEN = '#064e3b';
const FONT: React.CSSProperties = { fontFamily: "'IBM Plex Sans Arabic', sans-serif" };

const NOT_FOUND = "المعلومة غير متوفرة";
const safeText = (v?: string | null) => (v && v.trim() ? v : NOT_FOUND);

interface ProductVariant {
  id: string;
  color: string | null;
  size: string | null;
  quantity: number | null;
  image_url: string | null;
}

// Arabic color names — browsers can't parse Arabic, so we map them manually.
// The map is indexed by a *normalized* form (alef variants collapsed, no diacritics)
// so "احمر" and "أحمر" both resolve to red.
const ARABIC_COLOR_MAP: Record<string, string> = {
  'أحمر': '#e53935', 'أزرق': '#1e88e5', 'أخضر': '#43a047', 'أصفر': '#fdd835',
  'أسود': '#212121', 'أبيض': '#f5f5f5', 'رمادي': '#757575', 'بنفسجي': '#8e24aa',
  'برتقالي': '#fb8c00', 'وردي': '#e91e63', 'بني': '#6d4c41', 'بيج': '#d7ccc8',
  'ذهبي': '#ffd600', 'فضي': '#bdbdbd', 'كحلي': '#1a237e', 'زيتي': '#558b2f',
  'تركواز': '#00acc1',
};

// Normalize Arabic text: collapse alef variants, teh-marbuta, alef-maqsura, strip diacritics
function normalizeArabic(s: string): string {
  return s
    .replace(/[أإآا]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[ً-ٰٟ]/g, '');
}

// Pre-build a normalized lookup so we never iterate at runtime
const ARABIC_NORMALIZED: Record<string, string> = Object.fromEntries(
  Object.entries(ARABIC_COLOR_MAP).map(([k, v]) => [normalizeArabic(k), v])
);

// Cache canvas results — canvas element is only created once per unique name
const _colorCache = new Map<string, string>();

function parseBrowserColor(name: string): string | null {
  if (_colorCache.has(name)) {
    const c = _colorCache.get(name)!;
    return c === '' ? null : c;
  }
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const sentinel = '#070b0d';
    ctx.fillStyle = sentinel;
    ctx.fillStyle = name;
    const result = ctx.fillStyle;
    const parsed = result !== sentinel ? result : null;
    _colorCache.set(name, parsed ?? '');
    return parsed;
  } catch {
    return null;
  }
}

const getColorCss = (colorName: string): string => {
  const key = colorName.trim();
  if (!key) return '#9e9e9e';

  // 1. Exact Arabic map lookup
  if (ARABIC_COLOR_MAP[key]) return ARABIC_COLOR_MAP[key];

  // 2. Normalized Arabic lookup (handles missing hamza, diacritics, etc.)
  const normAr = normalizeArabic(key);
  if (ARABIC_NORMALIZED[normAr]) return ARABIC_NORMALIZED[normAr];

  // 3. Bare hex / rgb / hsl value
  if (/^#[0-9a-f]{3,8}$/i.test(key)) return key;

  // 4. Let the browser parse any English CSS named color (royalblue, deeppink, etc.)
  const browserResult = parseBrowserColor(key.toLowerCase());
  if (browserResult) return browserResult;

  return '#9e9e9e';
};

// Stored format: "DisplayName|#hex" (new) or plain name (legacy)
function parseColorEntry(raw: string): { name: string; hex: string } {
  const idx = raw.lastIndexOf('|');
  if (idx > -1) return { name: raw.slice(0, idx), hex: raw.slice(idx + 1) };
  return { name: raw, hex: getColorCss(raw) };
}

const ProductDetailPage: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toggleFavorite, isFavorited, isInCart, addToCart: addToCartCtx } = useShop();

  // Data states
  const [loadingData, setLoadingData] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [product, setProduct] = useState<any>(null);
  const [shopName, setShopName] = useState<string | null>(null);
  const [relatedProducts, setRelatedProducts] = useState<any[]>([]);

  const [ratingAvg, setRatingAvg] = useState<number | null>(null);
  const [reviewsCount, setReviewsCount] = useState<number>(0);

  const [discountValue, setDiscountValue] = useState<number | null>(null);
  const [allImages, setAllImages] = useState<string[]>([]);

  // UI states (keep design)
  const [qty, setQty] = useState(1);
  const isFav = product ? isFavorited(product.id) : false;
  const [activeThumb, setActiveThumb] = useState(0);
  const [mainImage, setMainImage] = useState<string>(
    'https://via.placeholder.com/600x600?text=SouqLink'
  );
  const [activeTab, setActiveTab] = useState('desc');

  // Nav counters
  const [cartMsg, setCartMsg] = useState<string | null>(null);
  const cartMsgTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showCartMsg = (msg: string) => {
    if (cartMsgTimerRef.current) clearTimeout(cartMsgTimerRef.current);
    setCartMsg(msg);
    cartMsgTimerRef.current = setTimeout(() => setCartMsg(null), 3000);
  };

  // Share menu
  const [showShareMenu, setShowShareMenu] = useState(false);
  const shareRef = useRef<HTMLDivElement>(null);
  const thumbStripRef = useRef<HTMLDivElement>(null);

  const scrollThumbs = (dir: number) => {
    thumbStripRef.current?.scrollBy({ left: dir * 200, behavior: 'smooth' });
  };

  // Render a 5-star row for a given rating value (filled / half / empty)
  const renderStars = (value: number, size = 20) => {
    const v = value || 0;
    return [1, 2, 3, 4, 5].map(i => {
      if (i <= Math.floor(v)) {
        return <Star key={i} size={size} className="text-amber-500 fill-amber-500" />;
      }
      if (i === Math.floor(v) + 1 && v % 1 >= 0.3) {
        return <StarHalf key={i} size={size} className="text-amber-500 fill-amber-500" />;
      }
      return <Star key={i} size={size} className="text-gray-300" />;
    });
  };

  // Auth + review form
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [reviewText, setReviewText] = useState('');
  const [reviewRating, setReviewRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [reviewPhotos, setReviewPhotos] = useState<File[]>([]);
  const [reviewPhotoPreviews, setReviewPhotoPreviews] = useState<string[]>([]);
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [reviewSuccess, setReviewSuccess] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);

  // Reviews list
  const [reviews, setReviews] = useState<any[]>([]);
  const [ratingDist, setRatingDist] = useState<Record<number, number>>({});

  // Lightbox
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  // Login modal
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  // Variants & attributes
  const [variants, setVariants] = useState<ProductVariant[]>([]);
  const [selectedColor, setSelectedColor] = useState<string | null>(null);
  const [selectedSize, setSelectedSize] = useState<string | null>(null);
  const [attributes, setAttributes] = useState<{ attribute_name: string; attribute_value: string | number }[]>([]);

  // Derived from variants (computed each render)
  const hasColors = variants.some(v => v.color);
  const hasSizes = variants.some(v => v.size);
  const uniqueColors = hasColors
    ? [...new Set(variants.filter(v => v.color).map(v => v.color!))]
    : [];
  const uniqueSizes = hasSizes
    ? [...new Set(variants.filter(v => v.size).map(v => v.size!))]
    : [];
  const isSizeAvailable = (size: string) => {
    if (hasColors && !selectedColor) {
      return variants.some(v => v.size === size && (v.quantity ?? 0) > 0);
    }
    return variants.some(
      v => v.size === size && (hasColors ? v.color === selectedColor : true) && (v.quantity ?? 0) > 0
    );
  };
  // When a color is selected, show only the sizes that exist for that color
  const sizesToShow = hasColors && selectedColor
    ? [...new Set(variants.filter(v => v.color === selectedColor && v.size).map(v => v.size!))]
    : uniqueSizes;
  const selectedVariant = variants.length > 0
    ? (variants.find(v =>
        (!hasColors || v.color === selectedColor) &&
        (!hasSizes || v.size === selectedSize)
      ) ?? null)
    : null;
  const displayPrice = product?.price ?? null;

  // Stock availability — prefer the selected variant's quantity, fall back to
  // the product-level stock. `null` means the value is unknown (not fetched).
  const stockQty: number | null = selectedVariant
    ? (selectedVariant.quantity ?? 0)
    : (typeof product?.stock_Quantity === 'number' ? product.stock_Quantity : null);
  const stockState: 'in' | 'out' | 'unknown' =
    stockQty === null ? 'unknown' : stockQty > 0 ? 'in' : 'out';

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (shareRef.current && !shareRef.current.contains(e.target as Node)) {
        setShowShareMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Switch main image when a color or size variant with an image is selected
  useEffect(() => {
    if (!selectedColor && !selectedSize) return;
    const match =
      variants.find(v =>
        (selectedColor ? v.color === selectedColor : true) &&
        (selectedSize  ? v.size  === selectedSize  : true) &&
        v.image_url
      ) ??
      (selectedColor ? variants.find(v => v.color === selectedColor && v.image_url) : null);

    if (!match?.image_url) return;
    setMainImage(match.image_url);
    setAllImages(prev => {
      const idx = prev.indexOf(match.image_url!);
      if (idx >= 0) { setActiveThumb(idx); return prev; }
      const next = [...prev, match.image_url!];
      setActiveThumb(next.length - 1);
      return next;
    });
  }, [selectedColor, selectedSize, variants]);

  // Check logged-in user and their role, and listen for magic-link sign-in
  useEffect(() => {
    const loadRole = async (userId: string) => {
      const { data } = await supabase
        .from('Users').select('role').eq('user_id', userId).maybeSingle();
      setUserRole(data?.role ?? null);
    };

    const checkAuth = async () => {
      setAuthLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      setCurrentUser(user);
      if (user) await loadRole(user.id);
      setAuthLoading(false);
    };
    checkAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        const user = session?.user ?? null;
        setCurrentUser(user);
        if (user) {
          await loadRole(user.id);
          setShowLoginModal(false);
        } else {
          setUserRole(null);
        }
      }
    );
    return () => subscription.unsubscribe();
  }, []);

  const handleLogin = async () => {
    if (!loginEmail.trim()) { setLoginError('يرجى إدخال بريد إلكتروني صحيح'); return; }
    setLoginLoading(true);
    setLoginError(null);

    // Direct DB check — no magic link, just look up email + role in Users table
    const { data, error } = await supabase
      .from('Users')
      .select('user_id, role')
      .eq('email', loginEmail.trim().toLowerCase())
      .maybeSingle();

    setLoginLoading(false);

    if (error) { setLoginError('حدث خطأ أثناء التحقق، حاول مجدداً'); return; }
    if (!data) { setLoginError('هذا البريد الإلكتروني غير مسجل'); return; }
    if (data.role !== 'customer') {
      setLoginError('يجب عليك التسجيل كعميل لتتمكن من إضافة تقييم');
      return;
    }

    // "Test login" — set user state locally from DB row
    setCurrentUser({ id: data.user_id, email: loginEmail.trim() });
    setUserRole('customer');
    setShowLoginModal(false);
    setLoginEmail('');
  };

  const submitReview = async () => {
    if (!currentUser || userRole !== 'customer') return;
    if (reviewRating === 0) { setReviewError('يرجى اختيار تقييم بالنجوم'); return; }
    if (!reviewText.trim()) { setReviewError('يرجى كتابة تقييمك'); return; }

    setReviewSubmitting(true);
    setReviewError(null);

    try {
      // Upload all photos into {userId}/{productId}/{index}.ext
      const uploadedUrls: string[] = [];
      for (let i = 0; i < reviewPhotos.length; i++) {
        const file = reviewPhotos[i];
        const ext = file.name.split('.').pop();
        const path = `${currentUser.id}/${product?.id}/${i}.${ext}`;
        const { data: uploaded, error: upErr } = await supabase.storage
          .from('review-photos')
          .upload(path, file, { upsert: true });
        if (upErr) throw upErr;
        const { data: urlData } = supabase.storage.from('review-photos').getPublicUrl(uploaded.path);
        uploadedUrls.push(urlData.publicUrl);
      }

      const { error: insErr } = await supabase.from('Reviews').insert({
        product_id: product?.id,
        user_id: currentUser.id,
        rating: reviewRating,
        review_text: reviewText.trim(),
        image_urls: uploadedUrls,
      });
      if (insErr) throw insErr;

      // Refresh reviews + stats
      const { data: revs } = await supabase
        .from('Reviews')
        .select(`id, created_at, rating, review_text, image_urls, user_id`)
        .eq('product_id', product?.id)
        .order('created_at', { ascending: false });
      const ratings = (revs ?? []).map((x: any) => Number(x.rating)).filter((n: number) => !Number.isNaN(n));
      setReviewsCount(ratings.length);
      setRatingAvg(ratings.length ? ratings.reduce((a: number, b: number) => a + b, 0) / ratings.length : null);
      const dist: Record<number, number> = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
      ratings.forEach(r => { if (dist[r] !== undefined) dist[r]++; });
      setRatingDist(dist);
      const userIds = [...new Set((revs ?? []).map((r: any) => r.user_id))];
      let nameMap: Record<string, string> = {};
      if (userIds.length > 0) {
        const { data: users } = await supabase.from("Users").select("user_id, name").in("user_id", userIds);
        (users ?? []).forEach((u: any) => { nameMap[u.user_id] = u.name; });
      }
      const reviewIds = (revs ?? []).map((r: any) => r.id);
      let replyMap: Record<string, { id: string; reply_text: string }> = {};
      if (reviewIds.length > 0) {
        const { data: replies } = await supabase
          .from("review_replies")
          .select("id, review_id, reply_text")
          .in("review_id", reviewIds);
        (replies ?? []).forEach((rep: any) => {
          replyMap[rep.review_id] = { id: rep.id, reply_text: rep.reply_text };
        });
      }
      setReviews((revs ?? []).map((r: any) => ({
        ...r,
        customerName: nameMap[r.user_id] ?? `عميل #${r.user_id.slice(0, 6)}`,
        reply: replyMap[r.id] ?? null,
      })));

      setReviewSuccess(true);
      setReviewText('');
      setReviewRating(0);
      setReviewPhotos([]);
      setReviewPhotoPreviews([]);
    } catch (e: any) {
      setReviewError(e?.message ?? 'حدث خطأ أثناء إرسال التقييم');
    } finally {
      setReviewSubmitting(false);
    }
  };

  const shareUrl = typeof window !== 'undefined' ? window.location.href : '';
  const shareText = product?.title ? `${product.title} — ${shareUrl}` : shareUrl;

  const shareOptions = [
    {
      label: 'WhatsApp',
      icon: '💬',
      href: `https://wa.me/?text=${encodeURIComponent(shareText)}`,
    },
    {
      label: 'Instagram',
      icon: '📸',
      href: 'https://www.instagram.com',
    },
    {
      label: 'Gmail',
      icon: '✉️',
      href: `https://mail.google.com/mail/?view=cm&fs=1&su=${encodeURIComponent(product?.title ?? 'منتج من سوق لينك')}&body=${encodeURIComponent(shareText)}`,
    },
  ];

  const handleShareOption = (opt: typeof shareOptions[0]) => {
    if (opt.href) {
      window.open(opt.href, '_blank', 'noopener,noreferrer');
    } else {
      navigator.clipboard.writeText(shareUrl).catch(() => {});
    }
    setShowShareMenu(false);
  };

  const updateQty = (delta: number) => {
    let newVal = qty + delta;
    if (newVal < 1) newVal = 1;
    if (newVal > 5) newVal = 5;
    setQty(newVal);
  };

  const handleImageChange = (index: number, src: string) => {
    setActiveThumb(index);
    setMainImage(src);
  };

  const toggleFav = () => {
    if (!currentUser) { showCartMsg('يجب تسجيل الدخول أو إنشاء حساب أولاً'); return; }
    if (userRole !== 'customer') { showCartMsg('متاح للعملاء فقط'); return; }
    if (!product) return;
    toggleFavorite({
      id: product.id,
      name: product.title ?? '',
      image: product.image_urls?.[0] ?? '',
      price: parseFloat(String(product.price ?? '0').replace(/[^\d.]/g, '')) || 0,
      inStock: true,
    });
  };

  const [showCartConfirm, setShowCartConfirm] = useState(false);

  const addToCart = () => {
    if (!currentUser) { showCartMsg('يجب تسجيل الدخول أو إنشاء حساب أولاً'); return; }
    if (userRole !== 'customer') { showCartMsg('متاح للعملاء فقط'); return; }
    if (!product) return;
    if (hasColors && !selectedColor) { showCartMsg('يرجى اختيار اللون أولاً'); return; }
    if (hasSizes && !selectedSize) { showCartMsg('يرجى اختيار المقاس أولاً'); return; }
    if (isInCart(product.id, selectedColor ? parseColorEntry(selectedColor).name : undefined, selectedSize ?? undefined)) {
      setShowCartConfirm(true);
      return;
    }
    const price = parseFloat(String(displayPrice ?? product.price ?? '0').replace(/[^\d.]/g, '')) || 0;
    addToCartCtx({
      id: product.id,
      name: product.title ?? '',
      image: product.image_urls?.[0] ?? '',
      price,
      color: selectedColor ? parseColorEntry(selectedColor).name : undefined,
      size: selectedSize ?? undefined,
    });
    showCartMsg('✓ تمت الإضافة إلى السلة');
  };

  // "Buy now": run the same guards/variant checks as add-to-cart, ensure the
  // item is in the cart, then take the customer straight to the cart page.
  const handleBuyNow = () => {
    if (!currentUser) { showCartMsg('يجب تسجيل الدخول أو إنشاء حساب أولاً'); return; }
    if (userRole !== 'customer') { showCartMsg('متاح للعملاء فقط'); return; }
    if (!product) return;
    if (hasColors && !selectedColor) { showCartMsg('يرجى اختيار اللون أولاً'); return; }
    if (hasSizes && !selectedSize) { showCartMsg('يرجى اختيار المقاس أولاً'); return; }
    const color = selectedColor ? parseColorEntry(selectedColor).name : undefined;
    const size = selectedSize ?? undefined;
    if (!isInCart(product.id, color, size)) {
      const price = parseFloat(String(displayPrice ?? product.price ?? '0').replace(/[^\d.]/g, '')) || 0;
      addToCartCtx({
        id: product.id,
        name: product.title ?? '',
        image: product.image_urls?.[0] ?? '',
        price,
        color,
        size,
      });
    }
    navigate('/cart');
  };

  const prevImage = () => {
    if (activeThumb === 0) return;
    const newIdx = activeThumb - 1;
    handleImageChange(newIdx, allImages[newIdx]);
  };

  const nextImage = () => {
    if (activeThumb === allImages.length - 1) return;
    const newIdx = activeThumb + 1;
    handleImageChange(newIdx, allImages[newIdx]);
  };

  useEffect(() => {
    const fetchData = async () => {
      setLoadingData(true);
      setError(null);

      try {
        // Resolve the product ID — use the URL param or fall back to the first product in DB
        let productId = id;

        if (!productId) {
          const { data: first, error: firstErr } = await supabase
            .from("products")
            .select("id")
            .eq("isPublish", true)
            .not("is_deleted", "eq", true)
            .not("is_archived", "eq", true)
            .limit(1)
            .maybeSingle();

          if (firstErr) throw firstErr;

          if (!first) {
            setError("لا توجد منتجات متاحة حالياً");
            setLoadingData(false);
            return;
          }

          productId = first.id;
        }

        // 1) Product
        const { data: productData, error: pErr } = await supabase
          .from("products")
          .select("id, title, description, price, discount_pct, stock_Quantity, shop_id, image_urls")
          .eq("id", productId)
          .eq("isPublish", true)
          .not("is_deleted", "eq", true)
          .not("is_archived", "eq", true)
          .single();

        if (pErr) throw pErr;

        setProduct(productData);

        // 2a) Shop name — shops PK is shop_id, name column is "name"
        if (productData?.shop_id) {
          const { data: shopData } = await supabase
            .from("shops")
            .select("name")
            .eq("shop_id", productData.shop_id)
            .maybeSingle();

          setShopName(shopData?.name ?? null);
        }

        // 2) Images from image_urls array
        const rawImgs = productData?.image_urls;
        let urls: string[] = [];
        if (Array.isArray(rawImgs) && rawImgs.length > 0) {
          urls = (rawImgs as string[]).filter(Boolean);
        }
        if (urls.length > 0) {
          setAllImages(urls);
          setMainImage(urls[0]);
          setActiveThumb(0);
        }

        // 3) Reviews: full data with replies and customer names
        const { data: revs } = await supabase
          .from("Reviews")
          .select(`id, created_at, rating, review_text, image_urls, user_id`)
          .eq("product_id", productId)
          .order("created_at", { ascending: false });

        const ratings = (revs ?? [])
          .map((x: any) => Number(x.rating))
          .filter((n: number) => !Number.isNaN(n));

        setReviewsCount(ratings.length);
        setRatingAvg(
          ratings.length
            ? ratings.reduce((a: number, b: number) => a + b, 0) / ratings.length
            : null
        );

        // Rating distribution
        const dist: Record<number, number> = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
        ratings.forEach(r => { if (dist[r] !== undefined) dist[r]++; });
        setRatingDist(dist);

        // Fetch customer names from Users table
        const userIds = [...new Set((revs ?? []).map((r: any) => r.user_id))];
        let nameMap: Record<string, string> = {};
        if (userIds.length > 0) {
          const { data: users } = await supabase
            .from("Users")
            .select("user_id, name")
            .in("user_id", userIds);
          (users ?? []).forEach((u: any) => { nameMap[u.user_id] = u.name; });
        }

        // Fetch replies separately (avoids RLS issues with nested join)
        const reviewIds = (revs ?? []).map((r: any) => r.id);
        let replyMap: Record<string, { id: string; reply_text: string }> = {};
        if (reviewIds.length > 0) {
          const { data: replies } = await supabase
            .from("review_replies")
            .select("id, review_id, reply_text")
            .in("review_id", reviewIds);
          (replies ?? []).forEach((rep: any) => {
            replyMap[rep.review_id] = { id: rep.id, reply_text: rep.reply_text };
          });
        }

        setReviews((revs ?? []).map((r: any) => ({
          ...r,
          customerName: nameMap[r.user_id] ?? `عميل #${r.user_id.slice(0, 6)}`,
          reply: replyMap[r.id] ?? null,
        })));

        // 4) Discount from product column
        setDiscountValue(productData?.discount_pct ?? null);

        // 5) Variants
        const { data: variantsData, error: varErr } = await supabase
          .from('product_variants')
          .select('id, color, size, quantity, image_url')
          .eq('product_id', productId);
        if (varErr) console.error('[variants fetch error]', varErr);
        const safeVariants: ProductVariant[] = (variantsData ?? []).map((v: any) => ({ ...v, image_url: v.image_url ?? null }));
        setVariants(safeVariants);
        setSelectedColor(null);
        setSelectedSize(null);

        // Merge variant images into the gallery (unique, appended after product images)
        const variantImgUrls = safeVariants.map(v => v.image_url).filter((u): u is string => !!u);
        if (variantImgUrls.length > 0) {
          setAllImages(prev => [...new Set([...prev, ...variantImgUrls])]);
        }

        // 6) Attributes
        const { data: attrsData, error: attrsErr } = await supabase
          .from('product_attributes')
          .select('attribute_name, attribute_value')
          .eq('product_id', productId);
        if (attrsErr) console.error('[attributes fetch error]', attrsErr);
        setAttributes(attrsData ?? []);

        // 7) Similar products — other published products (same shop first, then any)
        const { data: related } = await supabase
          .from("products")
          .select("id, title, price, image_urls, shop_id")
          .eq("isPublish", true)
          .not("is_deleted", "eq", true)
          .not("is_archived", "eq", true)
          .neq("id", productId)
          .limit(8);
        const relatedList = related ?? [];
        // Prefer products from the same shop, then fill with the rest, cap at 4
        const sameShop = relatedList.filter((p: any) => p.shop_id === productData?.shop_id);
        const others = relatedList.filter((p: any) => p.shop_id !== productData?.shop_id);
        setRelatedProducts([...sameShop, ...others].slice(0, 4));

      } catch (e: any) {
        setError(e?.message ?? "حدث خطأ أثناء جلب البيانات");
      } finally {
        setLoadingData(false);
      }
    };

    fetchData();
  }, [id]);

  if (loadingData) {
    return <div style={{ padding: 20, direction: "rtl", ...FONT }}>جاري تحميل البيانات...</div>;
  }

  if (error) {
    return <div style={{ padding: 20, direction: "rtl", ...FONT }}>{error}</div>;
  }

  const discountedPrice =
    discountValue !== null && displayPrice != null
      ? (displayPrice * (1 - discountValue / 100))
      : null;

  return (
    <>
      <Topbar />
      <StoreNav />

      {/* LIGHTBOX */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4"
          onClick={() => setLightboxUrl(null)}
        >
          <button
            type="button"
            className="absolute top-4 left-4 text-white/90 transition-colors hover:text-white"
            onClick={() => setLightboxUrl(null)}
          >
            <X size={32} />
          </button>
          <img
            className="max-h-[90vh] max-w-[90vw] rounded-xl object-contain"
            src={lightboxUrl}
            alt="صورة مكبّرة"
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}

      {/* LOGIN MODAL */}
      {showLoginModal && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
          onClick={() => setShowLoginModal(false)}
        >
          <div
            className="flex w-full max-w-md flex-col gap-5 rounded-2xl bg-white p-6 shadow-2xl"
            onClick={e => e.stopPropagation()}
            style={FONT}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-bold" style={{ color: GREEN }}>تسجيل الدخول</h3>
              <button
                type="button"
                className="text-gray-500 transition-colors hover:text-gray-800"
                onClick={() => setShowLoginModal(false)}
              >
                <X size={22} />
              </button>
            </div>
            <p className="text-sm text-gray-600">أدخل بريدك الإلكتروني للتحقق من حسابك.</p>
            <input
              type="email"
              className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 outline-none transition-colors focus:border-[#064e3b] focus:ring-2 focus:ring-[#064e3b]/20"
              placeholder="example@email.com"
              value={loginEmail}
              onChange={e => setLoginEmail(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleLogin()}
              autoFocus
            />
            {loginError && <p className="text-sm text-red-600">{loginError}</p>}
            <button
              type="button"
              className="w-full rounded-xl py-3 font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
              style={{ backgroundColor: GREEN }}
              onClick={handleLogin}
              disabled={loginLoading}
            >
              {loginLoading ? 'جاري التحقق...' : 'دخول'}
            </button>
          </div>
        </div>
      )}

      <main dir="rtl" className="bg-white text-[#191c1d]" style={FONT}>
        <div className="mx-auto max-w-[1280px] px-4 pt-6 pb-16 md:px-6">
          {/* BREADCRUMBS */}
          <nav className="mb-6 flex items-center gap-2 text-xs text-gray-500">
            <a
              href="#"
              className="transition-colors hover:text-[#064e3b]"
              onClick={(e) => { e.preventDefault(); navigate('/home'); }}
            >
              الرئيسية
            </a>
            <ChevronLeft size={14} />
            <span className="font-bold" style={{ color: GREEN }}>{safeText(product?.title)}</span>
          </nav>

          {/* HERO SECTION */}
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-2 lg:gap-10">
            {/* Gallery — appears on the left in RTL */}
            <div className="order-1 flex flex-col gap-4 lg:order-2">
              <div className="group relative aspect-square overflow-hidden rounded-2xl border border-gray-200 bg-white">
                <img
                  src={mainImage}
                  alt={safeText(product?.title)}
                  className="h-full w-full object-contain"
                />
                {discountValue !== null && (
                  <span className="absolute right-4 top-4 z-10 rounded-full bg-red-500 px-3 py-1 text-xs font-bold text-white">
                    {`وفر ${discountValue}%`}
                  </span>
                )}
                {allImages.length > 1 && (
                  <>
                    <button
                      type="button"
                      onClick={prevImage}
                      className="absolute right-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/80 opacity-0 shadow-md transition-opacity hover:bg-white group-hover:opacity-100"
                    >
                      <ChevronRight size={22} />
                    </button>
                    <button
                      type="button"
                      onClick={nextImage}
                      className="absolute left-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/80 opacity-0 shadow-md transition-opacity hover:bg-white group-hover:opacity-100"
                    >
                      <ChevronLeft size={22} />
                    </button>
                  </>
                )}
              </div>

              {/* Thumbnails strip */}
              {allImages.length > 0 && (
                <div className="flex items-center gap-2">
                  {allImages.length > 5 && (
                    <button
                      type="button"
                      className="shrink-0 text-gray-400 transition-colors hover:text-[#064e3b]"
                      onClick={() => scrollThumbs(1)}
                    >
                      <ChevronRight size={20} />
                    </button>
                  )}
                  <div
                    ref={thumbStripRef}
                    className="flex gap-2 overflow-x-auto scroll-smooth"
                    style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' } as React.CSSProperties}
                  >
                    {allImages.map((img, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => handleImageChange(idx, img)}
                        className={`h-20 w-20 shrink-0 overflow-hidden rounded-lg border-2 transition-colors ${activeThumb === idx ? '' : 'border-gray-200'}`}
                        style={activeThumb === idx ? { borderColor: GREEN } : {}}
                      >
                        <img src={img} alt={`صورة ${idx + 1}`} className="h-full w-full object-cover" />
                      </button>
                    ))}
                  </div>
                  {allImages.length > 5 && (
                    <button
                      type="button"
                      className="shrink-0 text-gray-400 transition-colors hover:text-[#064e3b]"
                      onClick={() => scrollThumbs(-1)}
                    >
                      <ChevronLeft size={20} />
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Product info — appears on the right in RTL */}
            <div className="order-2 flex flex-col gap-5 lg:order-1">
              {/* Shop tag */}
              <div className="flex items-center gap-2">
                <div
                  className="flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold"
                  style={{ backgroundColor: `${GREEN}1a`, color: GREEN }}
                >
                  {shopName?.trim()?.[0] ?? '🏪'}
                </div>
                <button
                  type="button"
                  className="text-sm font-bold hover:underline"
                  style={{ color: GREEN }}
                  onClick={() => { if (product?.shop_id) navigate(`/store/${product.shop_id}`); }}
                >
                  {safeText(shopName)}
                </button>
                <span className="rounded bg-gray-100 px-2 py-0.5 text-[10px] text-gray-600">موثوق</span>
              </div>

              {/* Title */}
              <h1 className="text-2xl font-bold leading-snug md:text-3xl" style={{ color: GREEN }}>
                {safeText(product?.title)}
              </h1>

              {/* Rating */}
              <div className="flex items-center gap-3">
                <div className="flex">{renderStars(ratingAvg ?? 0, 20)}</div>
                <span className="text-sm text-gray-500">
                  {ratingAvg !== null ? ratingAvg.toFixed(1) : NOT_FOUND} ({reviewsCount} تقييم)
                </span>
              </div>

              {/* Price */}
              <div className="flex flex-wrap items-end gap-3">
                <span className="text-3xl font-bold md:text-4xl" style={{ color: GREEN }}>
                  {discountedPrice !== null
                    ? discountedPrice.toFixed(2)
                    : (displayPrice ?? NOT_FOUND)} ₪
                </span>
                {discountValue !== null && product?.price != null && (
                  <span className="text-lg text-gray-400 line-through">{product.price} ₪</span>
                )}
              </div>

              {/* Stock */}
              <div className="flex items-center gap-2">
                <span
                  className={`h-2.5 w-2.5 rounded-full ${stockState === 'in' ? 'bg-green-500' : stockState === 'out' ? 'bg-red-500' : 'bg-gray-400'}`}
                />
                <span
                  className={`text-sm font-bold ${stockState === 'in' ? 'text-green-600' : stockState === 'out' ? 'text-red-600' : 'text-gray-500'}`}
                >
                  {stockState === 'in'
                    ? (stockQty !== null && stockQty <= 10
                        ? `متوفر في المخزون — تبقى ${stockQty} قطع`
                        : 'متوفر في المخزون')
                    : stockState === 'out'
                      ? 'غير متوفر حالياً'
                      : NOT_FOUND}
                </span>
              </div>

              {/* Variants */}
              {variants.length > 0 && (
                <div className="flex flex-col gap-5 border-t border-gray-200 pt-5">
                  {hasColors && (
                    <div className="flex flex-col gap-2">
                      <span className="text-sm font-bold">
                        اللون:{' '}
                        <span className="font-normal text-gray-500">
                          {selectedColor ? parseColorEntry(selectedColor).name : 'اختر اللون'}
                        </span>
                      </span>
                      <div className="flex flex-wrap gap-3">
                        {uniqueColors.map(color => {
                          const { name, hex } = parseColorEntry(color);
                          const active = selectedColor === color;
                          return (
                            <button
                              key={color}
                              type="button"
                              title={name}
                              aria-label={name}
                              onClick={() => { setSelectedColor(color); setSelectedSize(null); }}
                              className="h-8 w-8 rounded-full border border-gray-300 transition"
                              style={{
                                backgroundColor: hex,
                                outline: active ? `2px solid ${GREEN}` : 'none',
                                outlineOffset: '2px',
                              }}
                            />
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {hasSizes && (
                    <div className="flex flex-col gap-2">
                      <span className="text-sm font-bold">
                        المقاس:{' '}
                        <span className="font-normal text-gray-500">{selectedSize ?? 'اختر المقاس'}</span>
                      </span>
                      <div className="flex flex-wrap gap-3">
                        {sizesToShow.map(size => {
                          const available = isSizeAvailable(size);
                          const active = selectedSize === size;
                          return (
                            <button
                              key={size}
                              type="button"
                              disabled={!available}
                              onClick={() => available && setSelectedSize(size)}
                              title={!available ? 'نفد المخزون' : size}
                              className={`rounded-full border px-5 py-2 text-sm transition-all ${active ? 'text-white' : 'hover:border-[#064e3b]'} ${!available ? 'cursor-not-allowed bg-gray-100 opacity-40' : ''}`}
                              style={active ? { backgroundColor: GREEN, borderColor: GREEN } : { borderColor: '#d1d5db' }}
                            >
                              {size}
                            </button>
                          );
                        })}
                      </div>
                      {hasColors && !selectedColor && (
                        <p className="text-xs text-gray-400">اختر اللون أولاً لمعرفة المقاسات المتاحة</p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Actions */}
              <div className="flex flex-col gap-4 border-t border-gray-200 pt-5">
                {/* Quantity */}
                <div className="flex items-center gap-4">
                  <span className="text-sm font-bold">الكمية:</span>
                  <div className="flex items-center overflow-hidden rounded-lg border border-gray-300">
                    <button type="button" onClick={() => updateQty(-1)} className="p-2 transition-colors hover:bg-gray-100">
                      <Minus size={18} />
                    </button>
                    <input
                      value={qty}
                      readOnly
                      aria-label="الكمية"
                      className="w-12 bg-transparent text-center font-bold outline-none"
                    />
                    <button type="button" onClick={() => updateQty(1)} className="p-2 transition-colors hover:bg-gray-100">
                      <Plus size={18} />
                    </button>
                  </div>
                </div>

                {/* Buttons */}
                <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                  <button
                    type="button"
                    onClick={addToCart}
                    className="flex items-center justify-center gap-2 rounded-xl py-3.5 font-bold text-white transition-opacity hover:opacity-90 md:col-span-2"
                    style={{ backgroundColor: GREEN }}
                  >
                    <ShoppingCart size={20} /> أضف إلى السلة
                  </button>
                  <button
                    type="button"
                    onClick={handleBuyNow}
                    className="rounded-xl border-2 py-3.5 font-bold transition-colors hover:bg-[#064e3b]/5"
                    style={{ borderColor: GREEN, color: GREEN }}
                  >
                    شراء الآن
                  </button>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={toggleFav}
                      title="أضف للمفضلة"
                      className={`flex flex-1 items-center justify-center rounded-xl border transition-colors ${isFav ? 'border-red-200 bg-red-50' : 'border-gray-200 hover:bg-gray-100'}`}
                    >
                      <Heart size={20} className={isFav ? 'fill-red-500 text-red-500' : 'text-gray-600'} />
                    </button>
                    <div className="relative flex-1" ref={shareRef}>
                      <button
                        type="button"
                        title="مشاركة"
                        onClick={() => setShowShareMenu(prev => !prev)}
                        className="flex h-full w-full items-center justify-center rounded-xl border border-gray-200 transition-colors hover:bg-gray-100"
                      >
                        <Share2 size={20} className="text-gray-600" />
                      </button>
                      {showShareMenu && (
                        <div className="absolute bottom-full left-0 z-20 mb-2 w-44 rounded-xl border border-gray-200 bg-white p-2 shadow-xl">
                          {shareOptions.map(opt => (
                            <button
                              key={opt.label}
                              type="button"
                              onClick={() => handleShareOption(opt)}
                              className="flex w-full items-center gap-2 rounded-lg p-2 text-sm transition-colors hover:bg-gray-100"
                            >
                              <span>{opt.icon}</span>
                              <span>{opt.label}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {cartMsg && <p className="text-sm font-bold" style={{ color: GREEN }}>{cartMsg}</p>}
              </div>

              {/* Delivery / trust card */}
              <div className="flex flex-col gap-3 rounded-2xl border border-gray-200 bg-gray-50 p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white" style={{ color: GREEN }}>
                    <Truck size={20} />
                  </div>
                  <div>
                    <p className="text-sm font-bold">توصيل بواسطة سوق لينك</p>
                    <p className="text-xs text-gray-500">توصيل سريع وآمن إلى باب منزلك</p>
                  </div>
                </div>
                <div className="border-t border-gray-200" />
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white" style={{ color: GREEN }}>
                    <CreditCard size={20} />
                  </div>
                  <div>
                    <p className="text-sm font-bold">الشحن</p>
                    <p className="text-xs text-gray-500">يتم حسابه عند إتمام الدفع</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* TABS SECTION */}
          <section className="mt-16">
            <div className="flex gap-8 overflow-x-auto border-b border-gray-200">
              {[
                { key: 'desc', label: 'الوصف' },
                { key: 'specs', label: 'المواصفات' },
                { key: 'reviews', label: `التقييمات (${reviewsCount})` },
              ].map(t => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setActiveTab(t.key)}
                  className={`whitespace-nowrap pb-3 text-lg font-bold transition-colors md:text-xl ${activeTab === t.key ? '' : 'text-gray-400 hover:text-[#064e3b]'}`}
                  style={activeTab === t.key ? { color: GREEN, borderBottom: `2px solid ${GREEN}` } : {}}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="py-8">
              {/* Description */}
              {activeTab === 'desc' && (
                <div className="max-w-none leading-relaxed text-gray-600">
                  <p className="whitespace-pre-line">{safeText(product?.description)}</p>
                </div>
              )}

              {/* Specifications */}
              {activeTab === 'specs' && (
                attributes.length === 0 ? (
                  <p className="text-gray-500">المواصفات غير متوفرة حالياً</p>
                ) : (
                  <table className="w-full table-fixed border-collapse overflow-hidden rounded-xl border border-gray-200">
                    <tbody>
                      {attributes.map((attr, i) => (
                        <tr key={i} className={i % 2 === 0 ? 'bg-gray-50' : ''}>
                          <td className="w-1/3 p-4 align-top font-bold" style={{ color: GREEN }}>
                            {attr.attribute_name}
                          </td>
                          <td className="p-4 text-gray-600">{String(attr.attribute_value ?? '')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )
              )}

              {/* Reviews */}
              {activeTab === 'reviews' && (
                <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
                  {/* Summary column */}
                  <div className="flex flex-col gap-4">
                    <div className="flex flex-col items-center gap-2 rounded-2xl border border-gray-200 bg-white p-6">
                      <span className="text-5xl font-bold leading-none" style={{ color: GREEN }}>
                        {ratingAvg !== null ? ratingAvg.toFixed(1) : '—'}
                      </span>
                      <div className="flex">{renderStars(ratingAvg ?? 0, 24)}</div>
                      <span className="text-sm text-gray-500">بناءً على {reviewsCount} تقييم</span>
                    </div>
                    <div className="flex flex-col gap-2">
                      {[5, 4, 3, 2, 1].map(star => {
                        const pct = reviewsCount ? ((ratingDist[star] ?? 0) / reviewsCount) * 100 : 0;
                        return (
                          <div key={star} className="flex items-center gap-2">
                            <span className="w-4 text-sm">{star}</span>
                            <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-200">
                              <div className="h-full bg-amber-500" style={{ width: `${pct}%` }} />
                            </div>
                            <span className="w-10 text-left text-sm text-gray-500">{Math.round(pct)}%</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Form + list column */}
                  <div className="flex flex-col gap-6 lg:col-span-2">
                    {/* Review form / auth states */}
                    {authLoading ? (
                      <p className="text-gray-500">جاري التحقق من حسابك...</p>
                    ) : !currentUser ? (
                      <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm">
                        يجب تسجيل الدخول لإضافة تقييم —{' '}
                        <button
                          type="button"
                          className="font-bold underline"
                          style={{ color: GREEN }}
                          onClick={() => setShowLoginModal(true)}
                        >
                          تسجيل الدخول
                        </button>
                      </div>
                    ) : userRole !== 'customer' ? (
                      <p className="text-gray-500">فقط العملاء يمكنهم إضافة تقييم.</p>
                    ) : reviewSuccess ? (
                      <p className="font-bold text-green-600">✅ تم إرسال تقييمك بنجاح، شكراً لك!</p>
                    ) : (
                      <div className="flex flex-col gap-4 rounded-2xl border border-gray-200 p-5">
                        <h4 className="font-bold" style={{ color: GREEN }}>أضف تقييمك</h4>
                        <div className="flex items-center gap-2">
                          <span className="text-sm">تقييمك:</span>
                          <div className="flex">
                            {[1, 2, 3, 4, 5].map(star => (
                              <button
                                key={star}
                                type="button"
                                onClick={() => setReviewRating(star)}
                                onMouseEnter={() => setHoverRating(star)}
                                onMouseLeave={() => setHoverRating(0)}
                              >
                                <Star
                                  size={24}
                                  className={star <= (hoverRating || reviewRating) ? 'fill-amber-500 text-amber-500' : 'text-gray-300'}
                                />
                              </button>
                            ))}
                          </div>
                        </div>
                        <textarea
                          className="w-full rounded-xl border border-gray-200 bg-gray-50 p-3 outline-none transition-colors focus:border-[#064e3b]"
                          placeholder="اكتب تقييمك هنا..."
                          value={reviewText}
                          onChange={e => setReviewText(e.target.value)}
                          rows={4}
                        />
                        <div>
                          <label
                            htmlFor="review-photo-input"
                            className="inline-flex cursor-pointer items-center gap-2 text-sm font-bold"
                            style={{ color: GREEN }}
                          >
                            <Camera size={18} /> أضف صور (اختياري)
                          </label>
                          <input
                            id="review-photo-input"
                            type="file"
                            accept="image/*"
                            multiple
                            className="hidden"
                            onChange={e => {
                              const files = Array.from(e.target.files ?? []);
                              setReviewPhotos(prev => [...prev, ...files]);
                              setReviewPhotoPreviews(prev => [...prev, ...files.map(f => URL.createObjectURL(f))]);
                              e.target.value = '';
                            }}
                          />
                          {reviewPhotoPreviews.length > 0 && (
                            <div className="mt-3 flex flex-wrap gap-2">
                              {reviewPhotoPreviews.map((src, idx) => (
                                <div key={idx} className="relative h-20 w-20">
                                  <img src={src} alt={`معاينة ${idx + 1}`} className="h-full w-full rounded-lg object-cover" />
                                  <button
                                    type="button"
                                    className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-xs text-white"
                                    onClick={() => {
                                      setReviewPhotos(prev => prev.filter((_, i) => i !== idx));
                                      setReviewPhotoPreviews(prev => prev.filter((_, i) => i !== idx));
                                    }}
                                  >
                                    ×
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                        {reviewError && <p className="text-sm text-red-600">{reviewError}</p>}
                        <button
                          type="button"
                          onClick={submitReview}
                          disabled={reviewSubmitting}
                          className="self-start rounded-xl px-6 py-3 font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                          style={{ backgroundColor: GREEN }}
                        >
                          {reviewSubmitting ? 'جاري الإرسال...' : 'إرسال التقييم'}
                        </button>
                      </div>
                    )}

                    {/* Reviews list */}
                    {reviews.length === 0 ? (
                      <p className="text-gray-500">لا توجد تقييمات بعد — كن أول من يقيّم هذا المنتج!</p>
                    ) : (
                      reviews.map(r => (
                        <div key={r.id} className="border-b border-gray-200 pb-6">
                          <div className="mb-3 flex items-start justify-between">
                            <div className="flex items-center gap-3">
                              <div
                                className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 font-bold"
                                style={{ color: GREEN }}
                              >
                                {r.customerName?.[0] ?? '؟'}
                              </div>
                              <div>
                                <p className="font-bold">{r.customerName}</p>
                                <p className="text-xs text-gray-500">
                                  {new Intl.DateTimeFormat('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(r.created_at))}
                                </p>
                              </div>
                            </div>
                            <div className="flex">{renderStars(r.rating, 18)}</div>
                          </div>
                          {r.review_text && <p className="mb-3 text-gray-600">{r.review_text}</p>}
                          {Array.isArray(r.image_urls) && r.image_urls.length > 0 && (
                            <div className="mb-3 flex flex-wrap gap-2">
                              {r.image_urls.map((url: string, idx: number) => (
                                <img
                                  key={idx}
                                  src={url}
                                  alt={`صورة ${idx + 1}`}
                                  className="h-20 w-20 cursor-pointer rounded-lg border border-gray-200 object-cover"
                                  onClick={() => setLightboxUrl(url)}
                                />
                              ))}
                            </div>
                          )}
                          {r.reply && (
                            <div className="mt-3 rounded-xl bg-gray-50 p-4">
                              <p className="mb-1 text-sm font-bold" style={{ color: GREEN }}>رد المتجر:</p>
                              <p className="text-sm text-gray-600">{r.reply.reply_text}</p>
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* SIMILAR PRODUCTS */}
          {relatedProducts.length > 0 && (
            <section className="mt-16">
              <h2 className="mb-6 text-2xl font-bold" style={{ color: GREEN }}>منتجات مشابهة قد تعجبك</h2>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                {relatedProducts.map((p) => {
                  const img = Array.isArray(p.image_urls) ? p.image_urls.filter(Boolean)[0] : null;
                  return (
                    <div
                      key={p.id}
                      onClick={() => navigate(`/product/${p.id}`)}
                      className="group cursor-pointer overflow-hidden rounded-2xl border border-gray-200 bg-white transition-shadow hover:shadow-lg"
                    >
                      <div className="aspect-square overflow-hidden bg-gray-50">
                        {img ? (
                          <img
                            src={img}
                            alt={p.title ?? ''}
                            loading="lazy"
                            className="h-full w-full object-cover transition-transform group-hover:scale-105"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-3xl text-gray-300">🛍</div>
                        )}
                      </div>
                      <div className="p-3">
                        <h4 className="line-clamp-1 text-sm font-bold">{safeText(p.title)}</h4>
                        {p.price != null && (
                          <p className="mt-1 font-bold" style={{ color: GREEN }}>{p.price} ₪</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      </main>

      {showCartConfirm && product && (
        <CartConfirmModal
          onConfirm={() => {
            const price = parseFloat(String(product.price ?? '0').replace(/[^\d.]/g, '')) || 0;
            addToCartCtx({
              id: product.id,
              name: product.title ?? '',
              image: product.image_urls?.[0] ?? '',
              price,
              color: selectedColor ? parseColorEntry(selectedColor).name : undefined,
              size: selectedSize ?? undefined,
            });
            showCartMsg('✓ تمت إضافة قطعة أخرى إلى السلة');
            setShowCartConfirm(false);
          }}
          onCancel={() => setShowCartConfirm(false)}
        />
      )}
    </>
  );
};

export default ProductDetailPage;
