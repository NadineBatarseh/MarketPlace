import React, { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from './supabaseClient';
import './ProductDetailPage.css';

const NOT_FOUND = "المعلومة غير متوفرة";
const safeText = (v?: string | null) => (v && v.trim() ? v : NOT_FOUND);

const ProductDetailPage: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();

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
  const [isFav, setIsFav] = useState(false);
  const [activeThumb, setActiveThumb] = useState(0);
  const [mainImage, setMainImage] = useState<string>(
    'https://via.placeholder.com/600x600?text=SouqLink'
  );
  const [activeTab, setActiveTab] = useState('desc');
  const [variationView, setVariationView] = useState('main');

  // Nav counters
  const [favCount, setFavCount] = useState(0);
  const [cartCount, setCartCount] = useState(0);
  const [cartProductIds, setCartProductIds] = useState<Set<string>>(new Set());
  const [cartMsg, setCartMsg] = useState<string | null>(null);

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
  const [reviewPhoto, setReviewPhoto] = useState<File | null>(null);
  const [reviewPhotoPreview, setReviewPhotoPreview] = useState<string | null>(null);
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [reviewSuccess, setReviewSuccess] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);

  // Login modal
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (shareRef.current && !shareRef.current.contains(e.target as Node)) {
        setShowShareMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

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
      let photoUrl: string | null = null;

      if (reviewPhoto) {
        const ext = reviewPhoto.name.split('.').pop();
        const path = `${currentUser.id}-${Date.now()}.${ext}`;
        const { data: uploaded, error: upErr } = await supabase.storage
          .from('review-photos')
          .upload(path, reviewPhoto);
        if (upErr) throw upErr;
        const { data: urlData } = supabase.storage.from('review-photos').getPublicUrl(uploaded.path);
        photoUrl = urlData.publicUrl;
      }

      const row: Record<string, unknown> = {
        product_id: product?.id,
        user_id: currentUser.id,
        rating: reviewRating,
        review_text: reviewText.trim(),
      };
      if (photoUrl) row.image_url = photoUrl;

      const { error: insErr } = await supabase.from('Reviews').insert(row);
      if (insErr) throw insErr;

      // Refresh rating stats
      const { data: revs } = await supabase
        .from('Reviews').select('rating').eq('product_id', product?.id);
      const ratings = (revs ?? []).map((x: any) => Number(x.rating)).filter((n: number) => !Number.isNaN(n));
      setReviewsCount(ratings.length);
      setRatingAvg(ratings.length ? ratings.reduce((a: number, b: number) => a + b, 0) / ratings.length : null);

      setReviewSuccess(true);
      setReviewText('');
      setReviewRating(0);
      setReviewPhoto(null);
      setReviewPhotoPreview(null);
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
    const nowFav = !isFav;
    setIsFav(nowFav);
    setFavCount(prev => nowFav ? prev + 1 : Math.max(0, prev - 1));
  };

  const addToCart = () => {
    const productId = product?.id;
    if (!productId) return;
    if (cartProductIds.has(productId)) {
      setCartMsg('لقد أضفت هذا المنتج من قبل');
      return;
    }
    setCartProductIds(prev => new Set(prev).add(productId));
    setCartCount(prev => prev + 1);
    setCartMsg(null);
  };

  const prevImage = () => {
    const newIdx = (activeThumb - 1 + allImages.length) % allImages.length;
    handleImageChange(newIdx, allImages[newIdx]);
  };

  const nextImage = () => {
    const newIdx = (activeThumb + 1) % allImages.length;
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
          .select("id, title, description, price, stock_Quantity, shop_id, image_url")
          .eq("id", productId)
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

        // 2) Images — image_url is text[] in Postgres, Supabase returns it as a JS string[]
        const rawImg = productData?.image_url;
        let urls: string[] = [];
        if (Array.isArray(rawImg)) {
          urls = (rawImg as string[]).filter(Boolean);
        } else if (typeof rawImg === 'string' && rawImg.trim()) {
          urls = [rawImg];
        }
        if (urls.length > 0) {
          setAllImages(urls);
          setMainImage(urls[0]);
          setActiveThumb(0);
        }

        // 3) Reviews: avg + count (table is "Reviews" with capital R)
        const { data: revs } = await supabase
          .from("Reviews")
          .select("rating")
          .eq("product_id", productId);

        const ratings = (revs ?? [])
          .map((x: any) => Number(x.rating))
          .filter((n: number) => !Number.isNaN(n));

        setReviewsCount(ratings.length);
        setRatingAvg(
          ratings.length
            ? ratings.reduce((a: number, b: number) => a + b, 0) / ratings.length
            : null
        );

        // 4) Discounts — table may not exist, so errors are silently ignored
        setDiscountValue(null);

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
      {/* NAV */}
      <nav>
        <div className="logo">سوق<span>لينك</span></div>
        <ul className="nav-links">
          <li>
            <button
              onClick={() => navigate('/')}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontFamily: 'inherit',
                fontSize: 'inherit',
                color: 'inherit',
                padding: 0,
              }}
            >
              ← رجوع
            </button>
          </li>
          <li><a href="#">الرئيسية</a></li>
          <li><a href="#">المتاجر</a></li>
          <li><a href="#">العروض</a></li>
          <li><a href="#">تواصل معنا</a></li>
        </ul>
        <div className="nav-actions">
          <button className="nav-icon-btn">🔍</button>
          <button className="nav-icon-btn">
            ♡
            <span className="badge">{favCount}</span>
          </button>
          <button className="nav-icon-btn">
            🛒
            <span className="badge">{cartCount}</span>
          </button>
          <button
            className={`nav-icon-btn ${currentUser ? 'nav-icon-loggedin' : ''}`}
            title={currentUser ? currentUser.email : 'تسجيل الدخول'}
            onClick={() => { if (!currentUser) setShowLoginModal(true); }}
          >
            👤
          </button>
        </div>
      </nav>

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
        {/* SWITCHER */}
        <div className="variation-switcher">
          <button
            className={`var-btn ${variationView === 'main' ? 'active' : ''}`}
            onClick={() => setVariationView('main')}
          >
            التصميم الرئيسي
          </button>
          <button
            className={`var-btn ${variationView === 'var2' ? 'active' : ''}`}
            onClick={() => setVariationView('var2')}
          >
            الأسلوب الثاني
          </button>
          <button
            className={`var-btn ${variationView === 'var3' ? 'active' : ''}`}
            onClick={() => setVariationView('var3')}
          >
            الأسلوب الثالث
          </button>
        </div>

        {/* MAIN PRODUCT SECTION */}
        {variationView === 'main' && (
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
                  <span className="price-main">{product?.price ?? NOT_FOUND}</span>
                  <span className="price-currency">ر.س</span>
                  <span className="price-old">{NOT_FOUND}</span>
                  <span className="price-save">
                    {discountValue !== null ? `وفر ${discountValue}%` : NOT_FOUND}
                  </span>
                </div>

                <div className="stock-row">
                  <div className="stock-dot low"></div>
                  <span className="stock-label low">كمية</span>
                  <span className="stock-count">
                    {typeof product?.stock_Quantity === "number"
                      ? `– تبقى ${product.stock_Quantity} قطع`
                      : NOT_FOUND}
                  </span>
                </div>

                <div className="divider"></div>

                <div className="qty-row">
                  <div className="section-label" style={{ marginBottom: '0' }}>الكمية</div>
                  <div className="qty-control">
                    <button className="qty-btn" onClick={() => updateQty(-1)}>−</button>
                    <input className="qty-value" value={qty} readOnly aria-label="Quantity" />
                    <button className="qty-btn" onClick={() => updateQty(1)}>+</button>
                  </div>
                </div>

                <div className="btn-group">
                  <button className="btn-cart" onClick={addToCart}>🛒 أضف إلى السلة</button>
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
                  <div className="image-badge">
                    {discountValue !== null ? `خصم ${discountValue}%` : NOT_FOUND}
                  </div>
                  {allImages.length > 1 && (
                    <>
                      <button className="gallery-arrow gallery-arrow-prev" onClick={prevImage}>‹</button>
                      <button className="gallery-arrow gallery-arrow-next" onClick={nextImage}>›</button>
                    </>
                  )}
                </div>

                {/* Thumbnails row below the main image */}
                {allImages.length > 0 && (
                  <div className="thumbs">
                    {allImages.map((img, idx) => (
                      <div
                        key={idx}
                        className={`thumb ${activeThumb === idx ? 'active' : ''}`}
                        onClick={() => handleImageChange(idx, img)}
                      >
                        <img src={img} alt={`Product view ${idx + 1}`} />
                      </div>
                    ))}
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
                  <p style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>
                    المواصفات غير متوفرة حالياً
                  </p>
                </div>
              )}

              {activeTab === 'reviews' && (
                <div className="tab-content">
                  {authLoading ? (
                    <p className="review-info-msg">جاري التحقق من حسابك...</p>
                  ) : !currentUser ? (
                    <p className="review-info-msg">يجب عليك تسجيل الدخول لإضافة تقييم.</p>
                  ) : userRole !== 'customer' ? (
                    <p className="review-info-msg">فقط العملاء يمكنهم إضافة تقييم.</p>
                  ) : reviewSuccess ? (
                    <p className="review-success-msg">✅ تم إرسال تقييمك بنجاح، شكراً لك!</p>
                  ) : (
                    <div className="review-form">
                      <h4 className="review-form-title">أضف تقييمك</h4>

                      {/* Star rating */}
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
                            >
                              ★
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Text area */}
                      <textarea
                        className="review-textarea"
                        placeholder="اكتب تقييمك هنا..."
                        value={reviewText}
                        onChange={e => setReviewText(e.target.value)}
                        rows={4}
                      />

                      {/* Photo upload */}
                      <div className="review-photo-section">
                        <label className="review-photo-label" htmlFor="review-photo-input">
                          📷 أضف صورة (اختياري)
                        </label>
                        <input
                          id="review-photo-input"
                          type="file"
                          accept="image/*"
                          className="review-photo-input"
                          onChange={e => {
                            const file = e.target.files?.[0] ?? null;
                            setReviewPhoto(file);
                            setReviewPhotoPreview(file ? URL.createObjectURL(file) : null);
                          }}
                        />
                        {reviewPhotoPreview && (
                          <img src={reviewPhotoPreview} alt="معاينة" className="review-photo-preview" />
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
                </div>
              )}
            </div>
          </>
        )}

        {variationView === 'var2' && <Variation2 ratingAvg={ratingAvg} reviewsCount={reviewsCount} />}
        {variationView === 'var3' && <Variation3 />}
      </div>
    </>
  );
};

// ─── Sub-components ────────────────────────────────────────────────────────────

const Variation2: React.FC<{ ratingAvg: number | null; reviewsCount: number }> = ({ ratingAvg, reviewsCount }) => {
  const [activeSize, setActiveSize] = useState('٤٢');

  return (
    <div style={{ marginBottom: '12px', fontSize: '0.85rem', fontWeight: '600', color: 'var(--text-muted)' }}>
      الأسلوب الثاني — مدمج، مناسب للمتاجر الصغيرة
      <div className="var2-wrap">
        <div className="var2-imgs">
          <div className="var2-thumbs">
            <div className="var2-thumb active">
              <img src="https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=100&h=100&fit=crop" alt="Product" />
            </div>
          </div>
          <div className="var2-main">
            <img src="https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=400&h=530&fit=crop" alt="Main Product" />
          </div>
        </div>
        <div className="var2-details">
          <div className="var2-title">حذاء Nike Air Max 270</div>
          <div className="rating-row" style={{ marginBottom: '12px' }}>
            <div className="stars">★★★★☆</div>
            <span className="rating-text">
              <strong>{ratingAvg !== null ? ratingAvg.toFixed(1) : NOT_FOUND}</strong>
              {" "}({reviewsCount ? reviewsCount : NOT_FOUND} تقييم)
            </span>
          </div>

          <div style={{ marginBottom: '16px' }}>
            <div className="section-label">المقاس</div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {['٤٠', '٤٢', '٤٣', '٤٤', '٤٥'].map((size) => (
                <span
                  key={size}
                  onClick={() => size !== '٤٤' && setActiveSize(size)}
                  style={{
                    padding: '6px 14px',
                    border: `1.5px solid ${activeSize === size ? 'var(--accent)' : 'var(--border)'}`,
                    borderRadius: '8px',
                    fontSize: '0.8rem',
                    cursor: size === '٤٤' ? 'not-allowed' : 'pointer',
                    opacity: size === '٤٤' ? 0.4 : 1,
                  }}
                >
                  {size}
                </span>
              ))}
            </div>
          </div>

          <div className="var2-btns">
            <button className="var2-btn-primary">أضف إلى السلة</button>
            <button className="var2-btn-secondary">♡ أضف للمفضلة</button>
          </div>
        </div>
      </div>
    </div>
  );
};

const Variation3: React.FC = () => {
  const [isFav, setIsFav] = useState(false);

  return (
    <div style={{ marginBottom: '12px', fontSize: '0.85rem', fontWeight: '600', color: 'var(--text-muted)' }}>
      الأسلوب الثالث — فاخر، داكن، مناسب للمنتجات الراقية
      <div className="var3-wrap">
        <div className="var3-details">
          <div className="var3-badge">⚡ أعلى مبيعاً هذا الأسبوع</div>
          <h2 className="var3-title">
            ساعة Apple Watch Series 9<br />
            الإصدار التيتانيوم
          </h2>
          <p className="var3-desc">
            صُنعت لأولئك الذين لا يقبلون المساومة — ساعة Apple Watch Series 9 بهيكل تيتانيوم ممتاز وشاشة Retina المضيئة دائماً.
          </p>
          <div className="var3-btns">
            <button className="var3-btn-main">أضف إلى السلة 🛒</button>
            <button
              className="var3-btn-fav"
              onClick={() => setIsFav(!isFav)}
              style={{
                background: isFav ? 'rgba(232,87,42,0.2)' : '',
                color: isFav ? '#ff8a65' : '',
              }}
            >
              {isFav ? '♥' : '♡'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProductDetailPage;
