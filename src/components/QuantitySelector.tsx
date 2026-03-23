import React from 'react';
import '../styles/productTable.css';

interface QuantitySelectorProps {
  value: number;
  onChange: (newValue: number) => void;
  min?: number;
  max?: number;
}

export default function QuantitySelector({
  value,
  onChange,
  min = 1,
  max = 99,
}: QuantitySelectorProps) {
  return (
    <div className="pt-qty-control">
      <button
        className="pt-qty-btn"
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
        aria-label="تقليل الكمية"
      >
        −
      </button>
      <span className="pt-qty-value">{value}</span>
      <button
        className="pt-qty-btn"
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
        aria-label="زيادة الكمية"
      >
        +
      </button>
    </div>
  );
}
