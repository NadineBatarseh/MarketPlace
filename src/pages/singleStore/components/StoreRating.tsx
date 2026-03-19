import { useState } from 'react';

interface Props {
  shopId: string;
  onSubmitted: (avgRating: number, reviewCount: number) => void;
}

export default function StoreRating({ shopId, onSubmitted }: Props) {
  const [hovered, setHovered] = useState(0);
  const [selected, setSelected] = useState(0);
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  async function submit() {
    if (!selected || loading) return;
    setLoading(true);
    try {
      const r = await fetch(`/api/stores/${shopId}/reviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating: selected }),
      });
      const data = await r.json();
      if (data.ok) {
        setSubmitted(true);
        onSubmitted(data.avg_rating, data.review_count);
      }
    } finally {
      setLoading(false);
    }
  }

  if (submitted) {
    return <p className="store-rating-thanks">شكراً على تقييمك!</p>;
  }

  return (
    <div className="store-rating-input">
      <span className="store-rating-label">قيّم المتجر:</span>
      <div className="store-rating-stars">
        {[1, 2, 3, 4, 5].map(i => (
          <svg
            key={i}
            className={`star-input ${i <= (hovered || selected) ? 'star-input--on' : ''}`}
            viewBox="0 0 24 24"
            width="26"
            height="26"
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(0)}
            onClick={() => setSelected(i)}
          >
            <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" />
          </svg>
        ))}
      </div>
      {selected > 0 && (
        <button className="store-rating-submit" onClick={submit} disabled={loading}>
          {loading ? '...' : 'إرسال'}
        </button>
      )}
    </div>
  );
}
