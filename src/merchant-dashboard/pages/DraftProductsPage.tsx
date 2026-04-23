import { useState, useEffect, useCallback } from 'react';
import supabase from '../../lib/supabase';
import { useMerchantAuth } from '../context/MerchantAuthContext';
import './DraftProductsPage.css';

interface DraftProduct {
  id: string;
  title: string;
  description: string | null;
  price: number | null;
  image_urls: string[] | null;
  video_url: string | null;
  stock_Quantity: number | null;
}

interface CardState {
  title: string;
  description: string;
  price: string;
  quantity: string;
  saving: boolean;
  deleting: boolean;
  titleError: boolean;
  priceError: boolean;
  quantityError: boolean;
}

function buildCardState(p: DraftProduct): CardState {
  return {
    title: p.title,
    description: p.description ?? '',
    price: p.price != null ? String(p.price) : '',
    quantity: p.stock_Quantity != null ? String(p.stock_Quantity) : '',
    saving: false,
    deleting: false,
    titleError: false,
    priceError: false,
    quantityError: false,
  };
}

export default function DraftProductsPage() {
  const { merchant } = useMerchantAuth();
  const shopId = merchant?.shop?.shop_id;

  const [drafts, setDrafts] = useState<DraftProduct[]>([]);
  const [cards, setCards] = useState<Record<string, CardState>>({});
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState('');
  const [toast, setToast] = useState('');

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  const loadDrafts = useCallback(async () => {
    if (!shopId) { setLoading(false); return; }
    setLoading(true);
    setFetchError('');

    const { data, error } = await supabase
      .from('products')
      .select('id, title, description, price, image_urls, video_url, stock_Quantity')
      .eq('shop_id', shopId)
      .eq('isPublish', false)
      .order('created_at', { ascending: false });

    if (error) {
      setFetchError('تعذّر تحميل المسودات. حاول مرة أخرى.');
      console.error(error);
    } else {
      const list = (data ?? []) as DraftProduct[];
      setDrafts(list);
      const initial: Record<string, CardState> = {};
      list.forEach((p) => { initial[p.id] = buildCardState(p); });
      setCards(initial);
    }
    setLoading(false);
  }, [shopId]);

  useEffect(() => { loadDrafts(); }, [loadDrafts]);

  // Re-fetch when the MCP tool inserts new drafts from the backend
  useEffect(() => {
    if (!shopId) return;

    const channel = supabase
      .channel(`drafts:${shopId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'products', filter: `shop_id=eq.${shopId}` },
        () => { loadDrafts(); }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [shopId, loadDrafts]);

  const updateCard = (id: string, patch: Partial<CardState>) => {
    setCards((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  };

  const handlePublish = async (id: string) => {
    const card = cards[id];

    const titleMissing = !card.title.trim();
    const priceNum = parseFloat(card.price);
    const priceInvalid = !card.price.trim() || isNaN(priceNum) || priceNum <= 0;
    const quantityNum = parseInt(card.quantity, 10);
    const quantityInvalid = !card.quantity.trim() || isNaN(quantityNum) || quantityNum < 0;

    if (titleMissing || priceInvalid || quantityInvalid) {
      updateCard(id, {
        titleError: titleMissing,
        priceError: priceInvalid,
        quantityError: quantityInvalid,
      });
      return;
    }

    updateCard(id, { saving: true, titleError: false, priceError: false, quantityError: false });

    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token ?? '';

    const response = await fetch(`/api/products/${id}/publish`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        title: card.title.trim(),
        description: card.description.trim() || null,
        price: priceNum,
        stock_Quantity: quantityNum,
      }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      console.error(body);
      updateCard(id, { saving: false });
      showToast('حدث خطأ أثناء النشر. حاول مرة أخرى.');
      return;
    }

    setDrafts((prev) => prev.filter((p) => p.id !== id));
    showToast('تم نشر المنتج بنجاح ✓');
  };

  const handleDelete = async (id: string) => {
    updateCard(id, { deleting: true });

    const { error } = await supabase.from('products').delete().eq('id', id);

    if (error) {
      console.error(error);
      updateCard(id, { deleting: false });
      showToast('حدث خطأ أثناء الحذف. حاول مرة أخرى.');
      return;
    }

    setDrafts((prev) => prev.filter((p) => p.id !== id));
    showToast('تم حذف المسودة.');
  };

  if (loading) {
    return <div className="dp-loading">جاري تحميل المسودات…</div>;
  }

  return (
    <div className="dp-root">
      {/* Header */}
      <div className="dp-header">
        <div>
          <h1 className="dp-title">
            المسودات
            {drafts.length > 0 && <span className="dp-badge">{drafts.length}</span>}
          </h1>
          <p className="dp-subtitle">
            المنتجات المستوردة من انستقرام — راجعها وأضف الأسعار ثم انشرها.
          </p>
        </div>
      </div>

      {fetchError && <div className="dp-error">{fetchError}</div>}

      {drafts.length === 0 && !fetchError && (
        <div className="dp-empty">
          <div className="dp-empty-icon">📭</div>
          لا توجد مسودات حالياً. استورد منتجات من انستقرام عبر المساعد الذكي.
        </div>
      )}

      <div className="dp-grid">
        {drafts.map((product) => {
          const card = cards[product.id];
          if (!card) return null;
          const imageUrl = product.image_urls?.[0] ?? null;
          const isBusy = card.saving || card.deleting;

          return (
            <div key={product.id} className="dp-card">
              {/* Media: video for reels, image otherwise */}
              <div className="dp-card-img-wrap">
                {product.video_url ? (
                  <video
                    src={product.video_url}
                    className="dp-card-img"
                    controls
                    muted
                    playsInline
                    poster={imageUrl ?? undefined}
                  />
                ) : imageUrl ? (
                  <img src={imageUrl} alt={product.title} className="dp-card-img" />
                ) : (
                  <div className="dp-card-no-img">📦</div>
                )}
              </div>

              {/* Editable fields */}
              <div className="dp-card-body">
                <div className="dp-field">
                  <label>اسم المنتج *</label>
                  <input
                    type="text"
                    value={card.title}
                    className={card.titleError ? 'dp-input-error' : ''}
                    onChange={(e) => updateCard(product.id, { title: e.target.value, titleError: false })}
                    disabled={isBusy}
                  />
                  {card.titleError && <span className="dp-field-error">اسم المنتج مطلوب</span>}
                </div>

                <div className="dp-field">
                  <label>الوصف</label>
                  <textarea
                    rows={3}
                    value={card.description}
                    onChange={(e) => updateCard(product.id, { description: e.target.value })}
                    disabled={isBusy}
                  />
                </div>

                <div className="dp-price-row">
                  <div className="dp-field">
                    <label>السعر (₪) *</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="مطلوب"
                      value={card.price}
                      className={card.priceError ? 'dp-input-error' : ''}
                      onChange={(e) =>
                        updateCard(product.id, { price: e.target.value, priceError: false })
                      }
                      disabled={isBusy}
                    />
                    {card.priceError && <span className="dp-field-error">أدخل سعراً صحيحاً</span>}
                  </div>
                  <div className="dp-field">
                    <label>الكمية *</label>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      placeholder="مطلوب"
                      value={card.quantity}
                      className={card.quantityError ? 'dp-input-error' : ''}
                      onChange={(e) => updateCard(product.id, { quantity: e.target.value, quantityError: false })}
                      disabled={isBusy}
                    />
                    {card.quantityError && <span className="dp-field-error">أدخل كمية صحيحة</span>}
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="dp-card-actions">
                <button
                  className="dp-btn-publish"
                  onClick={() => handlePublish(product.id)}
                  disabled={isBusy}
                >
                  {card.saving ? 'جاري النشر…' : 'نشر'}
                </button>
                <button
                  className="dp-btn-delete"
                  onClick={() => handleDelete(product.id)}
                  disabled={isBusy}
                >
                  {card.deleting ? '…' : 'حذف'}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {toast && <div className="dp-toast">{toast}</div>}
    </div>
  );
}
