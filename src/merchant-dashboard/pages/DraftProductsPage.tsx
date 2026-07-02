import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import supabase from '../../lib/supabase';
import { useMerchantAuth } from '../context/MerchantAuthContext';
import { useLanguage } from '../../context/LanguageContext';
import './DraftProductsPage.css';

interface DraftProduct {
  id: string;
  title: string;
  description: string | null;
  price: number | null;
  image_urls: string[] | null;
  video_url: string | null;
  stock_Quantity: number | null;
  instagram_post_id: string | null;
  product_source: string | null;
}

type SourceFilter = 'all' | 'instagram' | 'meta';

function getSource(p: DraftProduct): 'instagram' | 'meta' {
  if (p.product_source === 'meta_import') return 'meta';
  if (p.product_source === 'instagram') return 'instagram';
  return p.instagram_post_id ? 'instagram' : 'meta';
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
  const { t } = useTranslation('merchant');
  const { direction } = useLanguage();
  const { merchant } = useMerchantAuth();
  const shopId = merchant?.shop?.shop_id;

  const [drafts, setDrafts] = useState<DraftProduct[]>([]);
  const [cards, setCards] = useState<Record<string, CardState>>({});
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState('');
  const [toast, setToast] = useState('');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  const loadDrafts = useCallback(async (silent = false) => {
    if (!shopId) { setLoading(false); return; }
    if (!silent) setLoading(true);
    setFetchError('');

    const { data, error } = await supabase
      .from('products')
      .select('id, title, description, price, image_urls, video_url, stock_Quantity, instagram_post_id, product_source')
      .eq('shop_id', shopId)
      .eq('isPublish', false)
      .order('created_at', { ascending: false });

    if (error) {
      setFetchError(t('drafts.loadFailed'));
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
        () => { loadDrafts(true); }
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
      showToast(t('drafts.publishFailed'));
      return;
    }

    setDrafts((prev) => prev.filter((p) => p.id !== id));
    setSelectedIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
    showToast(t('drafts.publishSuccess'));
  };

  const handleDelete = async (id: string) => {
    updateCard(id, { deleting: true });

    const { error } = await supabase.from('products').delete().eq('id', id);

    if (error) {
      console.error(error);
      updateCard(id, { deleting: false });
      showToast(t('drafts.deleteFailed'));
      return;
    }

    setDrafts((prev) => prev.filter((p) => p.id !== id));
    setSelectedIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
    showToast(t('drafts.deleteSuccess'));
  };

  const filteredDrafts = drafts.filter((p) => sourceFilter === 'all' || getSource(p) === sourceFilter);

  const handleFilterChange = (filter: SourceFilter) => {
    setSourceFilter(filter);
    setSelectedIds(new Set());
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const allFilteredSelected = filteredDrafts.length > 0 && filteredDrafts.every((p) => selectedIds.has(p.id));

  const toggleSelectAll = () => {
    setSelectedIds((prev) => {
      if (allFilteredSelected) {
        const next = new Set(prev);
        filteredDrafts.forEach((p) => next.delete(p.id));
        return next;
      }
      const next = new Set(prev);
      filteredDrafts.forEach((p) => next.add(p.id));
      return next;
    });
  };

  const handleDeleteSelected = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (!window.confirm(t('drafts.bulkDeleteConfirm', { count: ids.length }))) return;

    setBulkDeleting(true);
    ids.forEach((id) => updateCard(id, { deleting: true }));

    const { error } = await supabase.from('products').delete().in('id', ids);

    if (error) {
      console.error(error);
      ids.forEach((id) => updateCard(id, { deleting: false }));
      setBulkDeleting(false);
      showToast(t('drafts.bulkDeleteFailed'));
      return;
    }

    const idSet = new Set(ids);
    setDrafts((prev) => prev.filter((p) => !idSet.has(p.id)));
    setSelectedIds(new Set());
    setBulkDeleting(false);
    showToast(t('drafts.bulkDeleteSuccess', { count: ids.length }));
  };

  if (loading) {
    return <div className="dp-loading" dir={direction}>{t('drafts.loading')}</div>;
  }

  return (
    <div className="dp-root" dir={direction}>
      {/* Header */}
      <div className="dp-header">
        <div>
          <h1 className="dp-title">
            {t('drafts.title')}
            {drafts.length > 0 && <span className="dp-badge">{drafts.length}</span>}
          </h1>
          <p className="dp-subtitle">
            {t('drafts.subtitle')}
          </p>
        </div>
      </div>

      {fetchError && <div className="dp-error">{fetchError}</div>}

      {drafts.length > 0 && (
        <div className="dp-toolbar">
          <div className="dp-filter-tabs">
            <button
              className={`dp-filter-tab ${sourceFilter === 'all' ? 'active' : ''}`}
              onClick={() => handleFilterChange('all')}
            >
              {t('drafts.filterAll')}
            </button>
            <button
              className={`dp-filter-tab ${sourceFilter === 'instagram' ? 'active' : ''}`}
              onClick={() => handleFilterChange('instagram')}
            >
              {t('drafts.filterInstagram')}
            </button>
            <button
              className={`dp-filter-tab ${sourceFilter === 'meta' ? 'active' : ''}`}
              onClick={() => handleFilterChange('meta')}
            >
              {t('drafts.filterMeta')}
            </button>
          </div>

          <div className="dp-bulk-actions">
            <label className="dp-select-all">
              <input
                type="checkbox"
                checked={allFilteredSelected}
                onChange={toggleSelectAll}
                disabled={filteredDrafts.length === 0}
              />
              {t('drafts.selectAll')}
            </label>
            {selectedIds.size > 0 && (
              <button className="dp-btn-delete-bulk" onClick={handleDeleteSelected} disabled={bulkDeleting}>
                {bulkDeleting ? t('drafts.deletingSelected') : t('drafts.deleteSelectedBtn', { count: selectedIds.size })}
              </button>
            )}
          </div>
        </div>
      )}

      {drafts.length === 0 && !fetchError && (
        <div className="dp-empty">
          <div className="dp-empty-icon">📭</div>
          {t('drafts.emptyNoDrafts')}
        </div>
      )}

      {drafts.length > 0 && filteredDrafts.length === 0 && (
        <div className="dp-empty">
          <div className="dp-empty-icon">🔍</div>
          {t('drafts.emptyNoMatch')}
        </div>
      )}

      <div className="dp-grid">
        {filteredDrafts.map((product) => {
          const card = cards[product.id];
          if (!card) return null;
          const imageUrl = product.image_urls?.[0] ?? null;
          const isBusy = card.saving || card.deleting;
          const source = getSource(product);

          return (
            <div key={product.id} className="dp-card">
              {/* Media: video for reels, image otherwise */}
              <div className="dp-card-img-wrap">
                <label className="dp-card-checkbox" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={selectedIds.has(product.id)}
                    onChange={() => toggleSelect(product.id)}
                    disabled={isBusy}
                  />
                </label>
                <span className={`dp-source-badge dp-source-${source}`}>
                  {source === 'meta' ? t('drafts.sourceMeta') : t('drafts.sourceInstagram')}
                </span>
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
                  <label>{t('drafts.titleFieldLabel')}</label>
                  <input
                    type="text"
                    value={card.title}
                    className={card.titleError ? 'dp-input-error' : ''}
                    onChange={(e) => updateCard(product.id, { title: e.target.value, titleError: false })}
                    disabled={isBusy}
                    title={t('drafts.titleFieldTitleAttr')}
                  />
                  {card.titleError && <span className="dp-field-error">{t('drafts.titleRequired')}</span>}
                </div>

                <div className="dp-field">
                  <label>{t('drafts.descriptionFieldLabel')}</label>
                  <textarea
                    rows={2}
                    value={card.description}
                    onChange={(e) => updateCard(product.id, { description: e.target.value })}
                    disabled={isBusy}
                    title={t('drafts.descriptionFieldLabel')}
                  />
                </div>

                <div className="dp-price-row">
                  <div className="dp-field">
                    <label>{t('drafts.priceFieldLabel')}</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder={t('drafts.pricePlaceholder')}
                      value={card.price}
                      className={card.priceError ? 'dp-input-error' : ''}
                      onChange={(e) =>
                        updateCard(product.id, { price: e.target.value, priceError: false })
                      }
                      disabled={isBusy}
                    />
                    {card.priceError && <span className="dp-field-error">{t('drafts.priceRequired')}</span>}
                  </div>
                  <div className="dp-field">
                    <label>{t('drafts.quantityFieldLabel')}</label>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      placeholder={t('drafts.quantityPlaceholder')}
                      value={card.quantity}
                      className={card.quantityError ? 'dp-input-error' : ''}
                      onChange={(e) => updateCard(product.id, { quantity: e.target.value, quantityError: false })}
                      disabled={isBusy}
                    />
                    {card.quantityError && <span className="dp-field-error">{t('drafts.quantityRequired')}</span>}
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
                  {card.saving ? t('drafts.publishing') : t('drafts.publishBtn')}
                </button>
                <button
                  className="dp-btn-delete"
                  onClick={() => handleDelete(product.id)}
                  disabled={isBusy}
                >
                  {card.deleting ? '…' : t('drafts.deleteBtn')}
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
