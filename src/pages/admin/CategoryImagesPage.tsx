import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import supabase from '../../lib/supabase';
import { useLanguage } from '../../context/LanguageContext';
import './CategoryImagesPage.css';

interface CategoryRow {
  id: string;
  label: string;
  image_url: string | null;
  hero_image_url: string | null;
}

const BUCKET = 'category-images';

export default function CategoryImagesPage() {
  const { t } = useTranslation('admin');
  const { direction } = useLanguage();
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  /** id of the category currently uploading, so we can show a per-card spinner */
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});

  async function load() {
    setLoading(true);
    setError('');
    const { data, error: err } = await supabase
      .from('categories')
      .select('id, label, image_url, hero_image_url')
      .order('label', { ascending: true });
    if (err) setError(t('categoryImages.loadError', { error: err.message }));
    else setCategories((data ?? []) as CategoryRow[]);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function handleFile(cat: CategoryRow, file: File) {
    if (!file.type.startsWith('image/')) {
      setError(t('categoryImages.invalidFile'));
      return;
    }
    setError('');
    setUploadingId(cat.id);
    setSavedId(null);
    try {
      // Remove the previous hero (if it lived in our bucket) so we don't orphan files.
      const prevPath = cat.hero_image_url?.split(`/${BUCKET}/`)[1];

      const ext = file.name.split('.').pop() || 'jpg';
      const path = `${cat.id}/hero_${Date.now()}.${ext}`;
      const { data: uploadData, error: uploadErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, { upsert: true });
      if (uploadErr) throw uploadErr;

      const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(uploadData.path);
      const publicUrl = urlData.publicUrl;

      // .select() so we can confirm a row actually changed. An RLS-blocked update
      // returns no error AND no rows — without this check we'd falsely report success.
      const { data: updated, error: updateErr } = await supabase
        .from('categories')
        .update({ hero_image_url: publicUrl })
        .eq('id', cat.id)
        .select('id');
      if (updateErr) throw updateErr;
      if (!updated || updated.length === 0) {
        throw new Error(t('categoryImages.rlsError'));
      }

      if (prevPath) await supabase.storage.from(BUCKET).remove([prevPath]);

      setCategories(prev =>
        prev.map(c => (c.id === cat.id ? { ...c, hero_image_url: publicUrl } : c)),
      );
      setSavedId(cat.id);
    } catch (e) {
      setError(t('categoryImages.uploadError', { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setUploadingId(null);
    }
  }

  async function handleRemove(cat: CategoryRow) {
    setError('');
    setUploadingId(cat.id);
    try {
      const prevPath = cat.hero_image_url?.split(`/${BUCKET}/`)[1];
      const { data: updated, error: updateErr } = await supabase
        .from('categories')
        .update({ hero_image_url: null })
        .eq('id', cat.id)
        .select('id');
      if (updateErr) throw updateErr;
      if (!updated || updated.length === 0) {
        throw new Error(t('categoryImages.rlsError'));
      }
      if (prevPath) await supabase.storage.from(BUCKET).remove([prevPath]);
      setCategories(prev =>
        prev.map(c => (c.id === cat.id ? { ...c, hero_image_url: null } : c)),
      );
    } catch (e) {
      setError(t('categoryImages.removeError', { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setUploadingId(null);
    }
  }

  return (
    <div className="cat-img-admin" dir={direction}>
      <div className="cat-img-head">
        <div>
          <h1 className="cat-img-title">{t('categoryImages.title')}</h1>
          <p className="cat-img-subtitle">
            {t('categoryImages.subtitle')}
          </p>
        </div>
        <button className="cat-img-refresh" onClick={load} disabled={loading}>↻ {t('categoryImages.refresh')}</button>
      </div>

      {error && <div className="cat-img-error">{error}</div>}

      {loading ? (
        <div className="cat-img-state">{t('categoryImages.loadingCategories')}</div>
      ) : categories.length === 0 ? (
        <div className="cat-img-state">{t('categoryImages.noCategories')}</div>
      ) : (
        <div className="cat-img-grid">
          {categories.map(cat => {
            const hero = cat.hero_image_url || cat.image_url;
            const busy = uploadingId === cat.id;
            return (
              <div key={cat.id} className="cat-img-card">
                <div className="cat-img-preview">
                  {hero ? (
                    <img src={hero} alt={cat.label} />
                  ) : (
                    <div className="cat-img-placeholder">{t('categoryImages.noImage')}</div>
                  )}
                  {busy && <div className="cat-img-overlay"><span className="cat-img-spin" /></div>}
                  {!cat.hero_image_url && cat.image_url && (
                    <span className="cat-img-badge">{t('categoryImages.defaultImageBadge')}</span>
                  )}
                </div>

                <div className="cat-img-body">
                  <div className="cat-img-label">{cat.label}</div>
                  {savedId === cat.id && <div className="cat-img-saved">✓ {t('categoryImages.saved')}</div>}

                  <input
                    ref={el => { fileInputs.current[cat.id] = el; }}
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={e => {
                      const f = e.target.files?.[0];
                      if (f) handleFile(cat, f);
                      e.target.value = '';
                    }}
                  />

                  <div className="cat-img-actions">
                    <button
                      className="cat-img-btn"
                      disabled={busy}
                      onClick={() => fileInputs.current[cat.id]?.click()}
                    >
                      {cat.hero_image_url ? t('categoryImages.changeImage') : t('categoryImages.uploadImage')}
                    </button>
                    {cat.hero_image_url && (
                      <button
                        className="cat-img-btn cat-img-btn--ghost"
                        disabled={busy}
                        onClick={() => handleRemove(cat)}
                      >
                        {t('categoryImages.delete')}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
