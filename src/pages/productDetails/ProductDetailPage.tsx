import React, { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
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
    .replace(/[ً-ٰٟ]/g, '');
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
  const [thumbOffset, setThumbOffset] = useState(0);
  const THUMBS_PER_PAGE = 7;
  const [mainImage, setMainImage] = useState<string>(
    'https://via.placeholder.com/600x600?text=SouqLink'
  );
  const [activeTab, setActiveTab] = useState('desc');

  // Nav counters
  const [favCount] = useState(0);
  const [cartCount, setCartCount] = useState(0);
  const [cartProductIds, setCartProductIds] = useState<Set<string>>(new Set());
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
      className: 'share-opt-whatsapp',
      href: `https://wa.me/?text=${encodeURIComponent(shareText)}`,
    },
    {
      label: 'Instagram',
      icon: '📸',
      className: 'share-opt-instagram',
      href: 'https://www.instagram.com',
    },
    {
      label: 'Gmail',
      icon: '✉️',
      className: 'share-opt-gmail',
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
    return <div style={{ padding: 20, direction: "rtl" }}>جاري تحميل البيانات...</div>;
  }

  if (error) {
    return <div style={{ padding: 20, direction: "rtl" }}>{error}</div>;
  }

  return (
    <>
      <Topbar />
      <StoreNav />

      {/* LIGHTBOX */}
      {lightboxUrl && (
        <div className="lightbox-overlay" onClick={() => setLightboxUrl(null)}>
          <button type="button" className="lightbox-close" onClick={() => setLightboxUrl(null)}>✕</button>
          <img className="lightbox-img" src={lightboxUrl} alt="صورة مكبّرة" onClick={e => e.stopPropagation()} />
        </div>
      )}

      {/* LOGIN MODAL */}
      {showLoginModal && (
        <div className="login-overlay" onClick={() => setShowLoginModal(false)}>
          <div className="login-modal" onClick={e => e.stopPropagation()}>
            <button type="button" className="login-close" onClick={() => setShowLoginModal(false)}>✕</button>
            <h3 className="login-title">تسجيل الدخول</h3>

            <p className="login-hint">أدخل بريدك الإلكتروني للتحقق من حسابك.</p>
            <input
              type="email"
              className="login-email-input"
              placeholder="example@email.com"
              value={loginEmail}
              onChange={e => setLoginEmail(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleLogin()}
              autoFocus
            />
            {loginError && <p className="login-error-msg">{loginError}</p>}
            <button
              type="button"
              className="login-submit-btn"
              onClick={handleLogin}
              disabled={loginLoading}
            >
              {loginLoading ? 'جاري التحقق...' : 'دخول'}
            </button>
          </div>
        </div>
      )}

      <div className="page-wrapper">
        {/* MAIN PRODUCT SECTION */}
        <>
            <div className="product-section">
              {/* LEFT: Product Details */}
              <div className="product-details">
                <a href="#" className="shop-tag">
                  <div className="shop-avatar">T</div>
                  <span className="shop-name">{safeText(shopName)}</span>
                </a>

                <h1 className="product-title">
                  {safeText(product?.title)}
                </h1>

                <div className="rating-row">
                  <div className="stars">★★★★★</div>
                  <span className="rating-text">
                    <strong>{ratingAvg !== null ? ratingAvg.toFixed(1) : NOT_FOUND}</strong>
                    {" "}من 5 · ({reviewsCount ? reviewsCount : NOT_FOUND} تقييم)
                  </span>
                </div>

                <div className="divider"></div>

                <div className="price-row">
                  <span className="price-main">
                    {discountValue !== null && displayPrice != null
                      ? (displayPrice * (1 - discountValue / 100)).toFixed(1)
                      : displayPrice ?? NOT_FOUND}
                  </span>
                  <span className="price-currency">₪</span>
                  {discountValue !== null && product?.price != null && (
                    <>
                      <span className="price-old">{product.price} ₪</span>
                      <span className="price-save">{`وفر ${discountValue}%`}</span>
                    </>
                  )}
                </div>

                <div className="stock-row">
                  <div className="stock-dot low"></div>
                  <span className="stock-label low">كمية</span>
                  <span className="stock-count">
                    {selectedVariant
                      ? `– تبقى ${selectedVariant.quantity ?? 0} قطع`
                      : typeof product?.stock_Quantity === "number"
                        ? `– تبقى ${product.stock_Quantity} قطع`
                        : NOT_FOUND}
                  </span>
                </div>

                <div className="divider"></div>

                {/* COLOR & SIZE VARIANTS */}
                {variants.length > 0 && (
                  <>
                    {hasColors && (
                      <div className="variants-section">
                        <div className="section-label">
                          اللون{selectedColor ? `: ${parseColorEntry(selectedColor).name}` : ''}
                        </div>
                        <div className="color-options">
                          {uniqueColors.map(color => {
                            const { name: cName, hex: cHex } = parseColorEntry(color);
                            return (
                              <button
                                key={color}
                                type="button"
                                className={`color-swatch${selectedColor === color ? ' active' : ''}`}
                                style={{ backgroundColor: cHex } as React.CSSProperties}
                                onClick={() => { setSelectedColor(color); setSelectedSize(null); }}
                                title={cName}
                                aria-label={cName}
                              />
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {hasSizes && (
                      <div className="variants-section">
                        <div className="section-label">
                          المقاس{selectedSize ? `: ${selectedSize}` : ''}
                        </div>
                        <div className="size-options">
                          {sizesToShow.map(size => {
                            const available = isSizeAvailable(size);
                            return (
                              <button
                                key={size}
                                type="button"
                                className={`size-chip${selectedSize === size ? ' active' : ''}${!available ? ' unavailable' : ''}`}
                                onClick={() => available && setSelectedSize(size)}
                                disabled={!available}
                                title={!available ? 'نفد المخزون' : size}
                              >
                                {size}
                              </button>
                            );
                          })}
                        </div>
                        {hasColors && !selectedColor && (
                          <p className="variants-hint">اختر اللون أولاً لمعرفة المقاسات المتاحة</p>
                        )}
                      </div>
                    )}
                  </>
                )}

                <div className="qty-row">
                  <div className="section-label" style={{ marginBottom: '0' }}>الكمية</div>
                  <div className="qty-control">
                    <button className="qty-btn" onClick={() => updateQty(-1)}>−</button>
                    <input className="qty-value" value={qty} readOnly aria-label="Quantity" />
                    <button className="qty-btn" onClick={() => updateQty(1)}>+</button>
                  </div>
                </div>

                <div className="btn-group">
                  <button className="btn-cart" onClick={addToCart}>
                    🛒 أضف إلى السلة
                  </button>
                  <button
                    className={`btn-fav ${isFav ? 'active' : ''}`}
                    onClick={toggleFav}
                    title="أضف للمفضلة"
                  >
                    {isFav ? '♥' : '♡'}
                  </button>
                  <div className="share-wrapper" ref={shareRef}>
                    <button
                      className="btn-share"
                      title="مشاركة"
                      onClick={() => setShowShareMenu(prev => !prev)}
                    >
                      ↗
                    </button>
                    {showShareMenu && (
                      <div className="share-menu">
                        {shareOptions.map(opt => (
                          <button
                            key={opt.label}
                            type="button"
                            className={`share-opt ${opt.className}`}
                            onClick={() => handleShareOption(opt)}
                          >
                            <span className="share-opt-icon">{opt.icon}</span>
                            <span>{opt.label}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                {cartMsg && <p className="cart-msg">{cartMsg}</p>}
              </div>

              {/* RIGHT: Gallery */}
              <div className="product-gallery">
                {/* Main image with arrows */}
                <div className="main-image-wrap">
                  <img src={mainImage} alt={safeText(product?.title)} />
                  {discountValue !== null && (
                    <div className="image-badge">{`خصم ${discountValue}%`}</div>
                  )}
                  {allImages.length > 1 && (
                    <>
                      <button className="gallery-arrow gallery-arrow-prev" onClick={prevImage}>‹</button>
                      <button className="gallery-arrow gallery-arrow-next" onClick={nextImage}>›</button>
                    </>
                  )}
                </div>

                {/* Thumbnails row below the main image */}
                {allImages.length > 0 && (
                  <div className="thumbs-wrap">
                    {allImages.length > THUMBS_PER_PAGE && (
                      <button
                        type="button"
                        className="thumbs-arrow thumbs-arrow-prev"
                        onClick={() => setThumbOffset(o => Math.max(0, o - 1))}
                        disabled={thumbOffset === 0}
                      >‹</button>
                    )}
                    <div className="thumbs">
                      {allImages.slice(thumbOffset, thumbOffset + THUMBS_PER_PAGE).map((img, idx) => {
                        const realIdx = thumbOffset + idx;
                        return (
                          <div
                            key={realIdx}
                            className={`thumb ${activeThumb === realIdx ? 'active' : ''}`}
                            onClick={() => handleImageChange(realIdx, img)}
                          >
                            <img src={img} alt={`Product view ${realIdx + 1}`} />
                          </div>
                        );
                      })}
                    </div>
                    {allImages.length > THUMBS_PER_PAGE && (
                      <button
                        type="button"
                        className="thumbs-arrow thumbs-arrow-next"
                        onClick={() => setThumbOffset(o => Math.min(allImages.length - THUMBS_PER_PAGE, o + 1))}
                        disabled={thumbOffset >= allImages.length - THUMBS_PER_PAGE}
                      >›</button>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* TABS */}
            <div className="tabs-section">
              <div className="tabs-header">
                <button
                  className={`tab-btn ${activeTab === 'desc' ? 'active' : ''}`}
                  onClick={() => setActiveTab('desc')}
                >
                  الوصف
                </button>
                <button
                  className={`tab-btn ${activeTab === 'specs' ? 'active' : ''}`}
                  onClick={() => setActiveTab('specs')}
                >
                  المواصفات
                </button>
                <button
                  className={`tab-btn ${activeTab === 'reviews' ? 'active' : ''}`}
                  onClick={() => setActiveTab('reviews')}
                >
                  التقييمات ({reviewsCount ? reviewsCount : 0})
                </button>
              </div>

              {activeTab === 'desc' && (
                <div className="tab-content">
                  <h4>عن المنتج</h4>
                  <p>{safeText(product?.description)}</p>
                </div>
              )}

              {activeTab === 'specs' && (
                <div className="tab-content">
                  {attributes.length === 0 ? (
                    <p className="specs-empty">المواصفات غير متوفرة حالياً</p>
                  ) : (
                    <table className="spec-table">
                      <thead>
                        <tr>
                          <th>الخاصية</th>
                          <th>القيمة</th>
                        </tr>
                      </thead>
                      <tbody>
                        {attributes.map((attr, i) => (
                          <tr key={i}>
                            <td>{attr.attribute_name}</td>
                            <td>{String(attr.attribute_value ?? '')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}

              {activeTab === 'reviews' && (
                <div className="tab-content">

                  {/* ── Rating Summary ── */}
                  {reviewsCount > 0 && (
                    <div className="rv-summary">
                      <div className="rv-summary-score">
                        <span className="rv-big-score">{ratingAvg !== null ? ratingAvg.toFixed(1) : '—'}</span>
                        <span className="rv-big-stars">
                          {[1,2,3,4,5].map(s => (
                            <span key={s} className={s <= Math.round(ratingAvg ?? 0) ? 'rv-star filled' : 'rv-star'}>★</span>
                          ))}
                        </span>
                        <span className="rv-total-count">{reviewsCount} تقييم</span>
                      </div>
                      <div className="rv-dist">
                        {[5,4,3,2,1].map(star => (
                          <div key={star} className="rv-dist-row">
                            <span className="rv-dist-label">{star} ★</span>
                            <div className="rv-dist-bar-wrap">
                              <div
                                className="rv-dist-bar-fill"
                                style={{ '--bar-pct': reviewsCount ? `${((ratingDist[star] ?? 0) / reviewsCount) * 100}%` : '0%' } as React.CSSProperties}
                              />
                            </div>
                            <span className="rv-dist-count">{ratingDist[star] ?? 0}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* ── Submit Form ── */}
                  {authLoading ? (
                    <p className="review-info-msg">جاري التحقق من حسابك...</p>
                  ) : !currentUser ? (
                    <div className="rv-guest-prompt">
                      <p>يجب تسجيل الدخول لإضافة تقييم — <a href="/login">تسجيل الدخول</a></p>
                    </div>
                  ) : userRole !== 'customer' ? (
                    <p className="review-info-msg">فقط العملاء يمكنهم إضافة تقييم.</p>
                  ) : reviewSuccess ? (
                    <p className="review-success-msg">✅ تم إرسال تقييمك بنجاح، شكراً لك!</p>
                  ) : (
                    <div className="review-form">
                      <h4 className="review-form-title">أضف تقييمك</h4>
                      <div className="review-stars-row">
                        <span className="review-label">تقييمك:</span>
                        <div className="review-stars">
                          {[1, 2, 3, 4, 5].map(star => (
                            <button
                              key={star}
                              type="button"
                              className={`review-star ${star <= (hoverRating || reviewRating) ? 'filled' : ''}`}
                              onClick={() => setReviewRating(star)}
                              onMouseEnter={() => setHoverRating(star)}
                              onMouseLeave={() => setHoverRating(0)}
                            >★</button>
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
                      <div className="review-photo-section">
                        <label className="review-photo-label" htmlFor="review-photo-input">
                          📷 أضف صور (اختياري)
                        </label>
                        <input
                          id="review-photo-input"
                          type="file"
                          accept="image/*"
                          multiple
                          className="review-photo-input"
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
                                >×</button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      {reviewError && <p className="review-error-msg">{reviewError}</p>}
                      <button
                        type="button"
                        className="review-submit-btn"
                        onClick={submitReview}
                        disabled={reviewSubmitting}
                      >
                        {reviewSubmitting ? 'جاري الإرسال...' : 'إرسال التقييم'}
                      </button>
                    </div>
                  )}

                  {/* ── Review Cards ── */}
                  {reviews.length === 0 ? (
                    <p className="review-info-msg rv-empty-msg">لا توجد تقييمات بعد — كن أول من يقيّم هذا المنتج!</p>
                  ) : (
                    <div className="rv-list">
                      {reviews.map(r => (
                        <div key={r.id} className="rv-card">
                          <div className="rv-card-top">
                            <div className="rv-avatar">{(r.customerName?.[0] ?? '؟')}</div>
                            <div className="rv-card-body">
                              <span className="rv-card-name">{r.customerName}</span>
                              {r.review_text && <p className="rv-card-text">{r.review_text}</p>}
                              <div className="rv-card-stars">
                                {[1,2,3,4,5].map(s => (
                                  <span key={s} className={s <= r.rating ? 'rv-star filled' : 'rv-star'}>★</span>
                                ))}
                              </div>
                            </div>
                            <span className="rv-card-date rv-card-date--push">
                              {new Intl.DateTimeFormat('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(r.created_at))}
                            </span>
                          </div>
                          {/* Row 4: photos */}
                          {Array.isArray(r.image_urls) && r.image_urls.length > 0 && (
                            <div className="rv-card-photos">
                              {r.image_urls.map((url: string, idx: number) => (
                                <img
                                  key={idx}
                                  src={url}
                                  alt={`صورة ${idx + 1}`}
                                  className="rv-card-photo rv-card-photo--zoomable"
                                  onClick={() => setLightboxUrl(url)}
                                />
                              ))}
                            </div>
                          )}
                          {r.reply && (
                            <div className="rv-merchant-reply">
                              <span className="rv-reply-label">رد التاجر:</span>
                              <p className="rv-reply-text">{r.reply.reply_text}</p>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
        </>
      </div>
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
