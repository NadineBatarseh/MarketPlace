import React from 'react';
import '../styles/productTable.css';

interface ProductRowProps {
  image: string;
  name: string;
  color?: string;
  size?: string;
  onRemove: () => void;
  children?: React.ReactNode;
}

export default function ProductRow({
  image,
  name,
  color,
  size,
  onRemove,
  children,
}: ProductRowProps) {
  return (
    <tr className="pt-row">
      {/* Remove button */}
      <td className="pt-cell pt-cell-remove">
        <button
          className="pt-remove-btn"
          onClick={onRemove}
          aria-label={`إزالة ${name}`}
          title="إزالة"
        >
          ×
        </button>
      </td>

      {/* Product image + name + details */}
      <td className="pt-cell pt-cell-product">
        <div className="pt-product-info">
          <div className="pt-product-img-wrap">
            <img src={image} alt={name} className="pt-product-img" />
          </div>
          <div className="pt-product-text">
            <span className="pt-product-name">{name}</span>
            {(color || size) && (
              <span className="pt-product-meta">
                {color && `اللون: ${color}`}
                {color && size && ' · '}
                {size && `المقاس: ${size}`}
              </span>
            )}
          </div>
        </div>
      </td>

      {/* Extra columns injected by the parent page */}
      {children}
    </tr>
  );
}
