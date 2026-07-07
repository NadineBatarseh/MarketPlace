import React, { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Star, StarHalf, ShoppingCart, Heart, Share2, ChevronLeft, ChevronRight,
  Plus, Minus, Truck, CreditCard, ShieldCheck, X, Camera,
} from 'lucide-react';
import supabase from '../../lib/supabase';
import Topbar from '../../components/Topbar';
import StoreNav from '../../components/StoreNav';
import { useShop } from '../../context/ShopContext';
import CartConfirmModal from '../../components/CartConfirmModal';
import './ProductDetailPage.css';

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
        return <Star key={i} size={size} className="pdp-star--filled" />;
      }
      if (i === Math.floor(v) + 1 && v % 1 >= 0.3) {
        return <StarHalf key={i} size={size} className="pdp-star--half" />;
      }
      return <Star key={i} size={size} className="pdp-star--empty" />;
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

      } catch (e: any) {
        setError(e?.message ?? "حدث خطأ أثناء جلب البيانات");
      } finally {
        setLoadingData(false);
      }
    };

    fetchData();
  }, [id]);

  if (loadingData) {
    return (
      <div className="pdp-status-screen">
        <span className="pdp-status-dot" />
        جاري تحميل البيانات...
      </div>
    );
  }

  if (error) {
    return <div className="pdp-status-screen is-error">{error}</div>;
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
        <div className="lightbox-overlay" onClick={() => setLightboxUrl(null)}>
          <button type="button" className="lightbox-close" onClick={() => setLightboxUrl(null)}>
            <X size={20} />
          </button>
          <img
            className="lightbox-img"
            src={lightboxUrl}
            alt="صورة مكبّرة"
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}

      {/* LOGIN MODAL */}
      {showLoginModal && (
        <div className="login-overlay" onClick={() => setShowLoginModal(false)}>
          <div className="login-modal" onClick={e => e.stopPropagation()}>
            <div className="login-head">
              <h3 className="login-title">تسجيل الدخول</h3>
              <button type="button" className="login-close" onClick={() => setShowLoginModal(false)}>
                <X size={20} />
              </button>
            </div>
            <p className="login-hint">أدخل بريدك الإلكتروني للتحقق من حسابك.</p>
            <input
              type="email"
              className="login-input"
              placeholder="example@email.com"
              value={loginEmail}
              onChange={e => setLoginEmail(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleLogin()}
              autoFocus
            />
            {loginError && <p className="login-error">{loginError}</p>}
            <button type="button" className="login-submit" onClick={handleLogin} disabled={loginLoading}>
              {loginLoading ? 'جاري التحقق...' : 'دخول'}
            </button>
          </div>
        </div>
      )}

      <main className="pdp-page">
        <div className="pdp-shell">
          {/* BREADCRUMBS */}
          <nav className="pdp-breadcrumb">
            <a href="#" onClick={(e) => { e.preventDefault(); navigate('/home'); }}>الرئيسية</a>
            <ChevronLeft size={14} />
            <span className="pdp-bc-current">{safeText(product?.title)}</span>
          </nav>

          {/* HERO FRAME */}
          <div className="pdp-hero-frame">
            <div className="pdp-hero-grid">
              {/* Gallery */}
              <div className="pdp-gallery">
                {discountValue !== null && (
                  <span className="pdp-discount-tag">{`وفر ${discountValue}%`}</span>
                )}
                <div className="pdp-main-image">
                  <img src={mainImage} alt={safeText(product?.title)} />
                  {allImages.length > 1 && (
                    <>
                      <button type="button" onClick={prevImage} className="pdp-gallery-arrow pdp-gallery-arrow--prev">
                        <ChevronRight size={20} />
                      </button>
                      <button type="button" onClick={nextImage} className="pdp-gallery-arrow pdp-gallery-arrow--next">
                        <ChevronLeft size={20} />
                      </button>
                    </>
                  )}
                </div>

                {allImages.length > 0 && (
                  <div className="pdp-thumbs-col">
                    {allImages.length > 5 && (
                      <button type="button" className="pdp-thumbs-scroll" onClick={() => scrollThumbs(-1)}>
                        <ChevronRight size={16} />
                      </button>
                    )}
                    <div ref={thumbStripRef} className="pdp-thumbs-track">
                      {allImages.map((img, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => handleImageChange(idx, img)}
                          className={`pdp-thumb${activeThumb === idx ? ' is-active' : ''}`}
                        >
                          <img src={img} alt={`صورة ${idx + 1}`} />
                        </button>
                      ))}
                    </div>
                    {allImages.length > 5 && (
                      <button type="button" className="pdp-thumbs-scroll" onClick={() => scrollThumbs(1)}>
                        <ChevronLeft size={16} />
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Product info */}
              <div className="pdp-info">
                <div className="pdp-shop-row">
                  <div className="pdp-shop-seal">{shopName?.trim()?.[0] ?? '🏪'}</div>
                  <button
                    type="button"
                    className="pdp-shop-name"
                    onClick={() => { if (product?.shop_id) navigate(`/store/${product.shop_id}`); }}
                  >
                    {safeText(shopName)}
                  </button>
                  <span className="pdp-trust-pill">موثوق</span>
                </div>

                <h1 className="pdp-title">{safeText(product?.title)}</h1>

                <div className="pdp-rating-row">
                  <div className="pdp-stars">{renderStars(ratingAvg ?? 0, 18)}</div>
                  <span className="pdp-rating-text">
                    {ratingAvg !== null ? ratingAvg.toFixed(1) : NOT_FOUND} ({reviewsCount} تقييم)
                  </span>
                </div>

                <div className="pdp-price-ticket">
                  <span className="pdp-price-amount">
                    {discountedPrice !== null
                      ? discountedPrice.toFixed(2)
                      : (displayPrice ?? NOT_FOUND)} ₪
                  </span>
                  {discountValue !== null && product?.price != null && (
                    <span className="pdp-price-old">{product.price} ₪</span>
                  )}
                  {discountValue !== null && (
                    <span className="pdp-price-save">{`وفر ${discountValue}%`}</span>
                  )}
                </div>

                {product?.description?.trim() && (
                  <p className="pdp-desc-preview">{product.description}</p>
                )}

                <div className={`pdp-stock pdp-stock--${stockState}`}>
                  <span className="pdp-stock-dot" />
                  <span className="pdp-stock-text">
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
                  <div className="pdp-variants">
                    {hasColors && (
                      <div className="pdp-variant-block">
                        <span className="pdp-variant-label">
                          اللون:{' '}
                          <span className="pdp-variant-value">
                            {selectedColor ? parseColorEntry(selectedColor).name : 'اختر اللون'}
                          </span>
                        </span>
                        <div className="pdp-swatches">
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
                                className={`pdp-swatch${active ? ' is-active' : ''}`}
                                style={{ backgroundColor: hex }}
                              />
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {hasSizes && (
                      <div className="pdp-variant-block">
                        <span className="pdp-variant-label">
                          المقاس:{' '}
                          <span className="pdp-variant-value">{selectedSize ?? 'اختر المقاس'}</span>
                        </span>
                        <div className="pdp-sizes">
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
                                className={`pdp-size-chip${active ? ' is-active' : ''}${!available ? ' is-unavailable' : ''}`}
                              >
                                {size}
                              </button>
                            );
                          })}
                        </div>
                        {hasColors && !selectedColor && (
                          <p className="pdp-variant-hint">اختر اللون أولاً لمعرفة المقاسات المتاحة</p>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Actions */}
                <div className="pdp-actions">
                  <div className="pdp-qty-row">
                    <span>الكمية:</span>
                    <div className="pdp-qty">
                      <button type="button" onClick={() => updateQty(-1)} className="pdp-qty-btn">
                        <Minus size={16} />
                      </button>
                      <input value={qty} readOnly aria-label="الكمية" className="pdp-qty-value" />
                      <button type="button" onClick={() => updateQty(1)} className="pdp-qty-btn">
                        <Plus size={16} />
                      </button>
                    </div>
                  </div>

                  <div className="pdp-cta-row">
                    <button
                      type="button"
                      onClick={addToCart}
                      disabled={stockState === 'out'}
                      className="pdp-btn-primary"
                    >
                      <ShoppingCart size={18} /> أضف إلى السلة
                    </button>
                    <button
                      type="button"
                      onClick={handleBuyNow}
                      disabled={stockState === 'out'}
                      className="pdp-btn-secondary"
                    >
                      شراء الآن
                    </button>
                    <div className="pdp-icon-actions">
                      <button
                        type="button"
                        onClick={toggleFav}
                        title="أضف للمفضلة"
                        className={`pdp-icon-btn${isFav ? ' is-active' : ''}`}
                      >
                        <Heart size={18} className={isFav ? 'fill-current' : ''} />
                      </button>
                      <div className="pdp-share-wrap" ref={shareRef}>
                        <button
                          type="button"
                          title="مشاركة"
                          onClick={() => setShowShareMenu(prev => !prev)}
                          className="pdp-icon-btn pdp-icon-btn--share"
                          style={{ width: '100%' }}
                        >
                          <Share2 size={18} />
                        </button>
                        {showShareMenu && (
                          <div className="pdp-share-menu">
                            {shareOptions.map(opt => (
                              <button
                                key={opt.label}
                                type="button"
                                onClick={() => handleShareOption(opt)}
                                className="pdp-share-opt"
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

                  {cartMsg && <p className="pdp-cart-msg">{cartMsg}</p>}
                </div>

                {/* Delivery / payment trust strip */}
                <div className="pdp-trust-strip">
                  <div className="pdp-trust-item">
                    <div className="pdp-trust-icon"><Truck size={18} /></div>
                    <div>
                      <p className="pdp-trust-title">توصيل سريع</p>
                      <p className="pdp-trust-sub">توصيل سريع وآمن إلى باب منزلك</p>
                    </div>
                  </div>
                  <div className="pdp-trust-divider" />
                  <div className="pdp-trust-item">
                    <div className="pdp-trust-icon"><ShieldCheck size={18} /></div>
                    <div>
                      <p className="pdp-trust-title">دفع آمن</p>
                      <p className="pdp-trust-sub">دفع آمن ومشفّر — بياناتك محمية</p>
                    </div>
                  </div>
                  <div className="pdp-trust-divider" />
                  <div className="pdp-trust-item">
                    <div className="pdp-trust-icon"><CreditCard size={18} /></div>
                    <div>
                      <p className="pdp-trust-title">الشحن</p>
                      <p className="pdp-trust-sub">يتم حسابه عند إتمام الدفع</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* TABS SECTION */}
          <section className="pdp-tabs-panel">
            <div className="pdp-tab-list">
              {[
                { key: 'desc', label: 'الوصف' },
                { key: 'specs', label: 'المواصفات' },
                { key: 'reviews', label: `التقييمات (${reviewsCount})` },
              ].map(t => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setActiveTab(t.key)}
                  className={`pdp-tab${activeTab === t.key ? ' is-active' : ''}`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="pdp-tab-content">
              {/* Description */}
              {activeTab === 'desc' && (
                <p className="pdp-tab-desc">{safeText(product?.description)}</p>
              )}

              {/* Specifications */}
              {activeTab === 'specs' && (
                attributes.length === 0 ? (
                  <p className="pdp-specs-empty">المواصفات غير متوفرة حالياً</p>
                ) : (
                  <table className="pdp-spec-table">
                    <tbody>
                      {attributes.map((attr, i) => (
                        <tr key={i}>
                          <td>{attr.attribute_name}</td>
                          <td>{String(attr.attribute_value ?? '')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )
              )}

              {/* Reviews */}
              {activeTab === 'reviews' && (
                <div className="pdp-reviews">
                  {/* Summary column */}
                  <div className="rv-summary-col">
                    <div className="rv-summary-card">
                      <span className="rv-score">{ratingAvg !== null ? ratingAvg.toFixed(1) : '—'}</span>
                      <div className="pdp-stars">{renderStars(ratingAvg ?? 0, 22)}</div>
                      <span className="rv-total">بناءً على {reviewsCount} تقييم</span>
                    </div>
                    <div className="rv-dist">
                      {[5, 4, 3, 2, 1].map(star => {
                        const pct = reviewsCount ? ((ratingDist[star] ?? 0) / reviewsCount) * 100 : 0;
                        return (
                          <div key={star} className="rv-dist-row">
                            <span className="rv-dist-label">{star}</span>
                            <div className="rv-dist-track">
                              <div className="rv-dist-fill" style={{ width: `${pct}%` }} />
                            </div>
                            <span className="rv-dist-pct">{Math.round(pct)}%</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Form + list column */}
                  <div className="rv-main">
                    {/* Review form / auth states */}
                    {authLoading ? (
                      <p className="rv-auth-msg">جاري التحقق من حسابك...</p>
                    ) : !currentUser ? (
                      <p className="rv-auth-msg">
                        يجب تسجيل الدخول لإضافة تقييم —{' '}
                        <button type="button" className="pdp-link-btn" onClick={() => setShowLoginModal(true)}>
                          تسجيل الدخول
                        </button>
                      </p>
                    ) : userRole !== 'customer' ? (
                      <p className="rv-auth-msg">فقط العملاء يمكنهم إضافة تقييم.</p>
                    ) : reviewSuccess ? (
                      <p className="rv-success-msg">✅ تم إرسال تقييمك بنجاح، شكراً لك!</p>
                    ) : (
                      <div className="review-form">
                        <h4 className="review-form-title">أضف تقييمك</h4>
                        <div className="review-stars-row">
                          <span>تقييمك:</span>
                          <div className="review-stars">
                            {[1, 2, 3, 4, 5].map(star => (
                              <button
                                key={star}
                                type="button"
                                onClick={() => setReviewRating(star)}
                                onMouseEnter={() => setHoverRating(star)}
                                onMouseLeave={() => setHoverRating(0)}
                                className={`review-star${star <= (hoverRating || reviewRating) ? ' is-filled' : ''}`}
                              >
                                <Star size={22} />
                              </button>
                            ))}
                          </div>
                        </div>
                        <textarea
                          className="review-textarea"
                          placeholder="اكتب تقييمك هنا..."
                          value={reviewText}
                          onChange={e => setReviewText(e.target.value)}
                          rows={4}
                        />
                        <div>
                          <label htmlFor="review-photo-input" className="review-photo-label">
                            <Camera size={16} /> أضف صور (اختياري)
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
                            <div className="review-photo-grid">
                              {reviewPhotoPreviews.map((src, idx) => (
                                <div key={idx} className="review-photo-thumb">
                                  <img src={src} alt={`معاينة ${idx + 1}`} />
                                  <button
                                    type="button"
                                    className="review-photo-delete"
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
                        {reviewError && <p className="review-error">{reviewError}</p>}
                        <button type="button" onClick={submitReview} disabled={reviewSubmitting} className="review-submit">
                          {reviewSubmitting ? 'جاري الإرسال...' : 'إرسال التقييم'}
                        </button>
                      </div>
                    )}

                    {/* Reviews list */}
                    {reviews.length === 0 ? (
                      <p className="rv-empty">لا توجد تقييمات بعد — كن أول من يقيّم هذا المنتج!</p>
                    ) : (
                      <div className="rv-list">
                        {reviews.map(r => (
                          <div key={r.id} className="rv-card">
                            <div className="rv-card-top">
                              <div className="rv-card-who">
                                <div className="rv-avatar">{r.customerName?.[0] ?? '؟'}</div>
                                <div>
                                  <p className="rv-name">{r.customerName}</p>
                                  <p className="rv-date">
                                    {new Intl.DateTimeFormat('ar-EG-u-nu-latn', { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(r.created_at))}
                                  </p>
                                </div>
                              </div>
                              <div className="pdp-stars">{renderStars(r.rating, 16)}</div>
                            </div>
                            {r.review_text && <p className="rv-text">{r.review_text}</p>}
                            {Array.isArray(r.image_urls) && r.image_urls.length > 0 && (
                              <div className="rv-photos">
                                {r.image_urls.map((url: string, idx: number) => (
                                  <img
                                    key={idx}
                                    src={url}
                                    alt={`صورة ${idx + 1}`}
                                    className="rv-photo"
                                    onClick={() => setLightboxUrl(url)}
                                  />
                                ))}
                              </div>
                            )}
                            {r.reply && (
                              <div className="rv-reply">
                                <span className="rv-reply-label">رد المتجر:</span>
                                <p className="rv-reply-text">{r.reply.reply_text}</p>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </section>
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
