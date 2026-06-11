import React from 'react';
import Topbar from './Topbar';
import StoreNav from './StoreNav';
import '../styles/productTable.css';

interface ProductListTemplateProps {
  /** Page title, e.g. "سلة التسوق" */
  title: string;
  /** Number of items to show in the heading */
  itemCount: number;
  /**
   * Column header labels (excluding the implicit remove + product columns).
   * The first label maps to the "product" column; subsequent labels map to
   * the extra <td> children rendered by ProductRow.
   */
  columns: string[];
  /** ProductRow elements */
  children: React.ReactNode;
  /** Optional right-side panel (order summary for Cart) */
  sidePanel?: React.ReactNode;
  /** Optional bottom action bar (coupon / clear / add-all) */
  bottomBar?: React.ReactNode;
}

export default function ProductListTemplate({
  title,
  itemCount,
  columns,
  children,
  sidePanel,
  bottomBar,
}: ProductListTemplateProps) {
  return (
    <>
      <Topbar />
      <StoreNav />
      <div className="pt-page">
      {/* ── CONTENT ── */}
      <div className="pt-wrapper">
        {/* Heading */}
        <h1 className="pt-page-title">
          {title}
          <span className="pt-item-count">({itemCount} منتج)</span>
        </h1>

        {/* Main layout */}
        <div className={`pt-layout${sidePanel ? ' pt-layout-with-panel' : ''}`}>
          {/* Table */}
          <div className="pt-table-wrap">
            <table className="pt-table">
              <thead>
                <tr className="pt-thead-row">
                  {/* Remove column – visually hidden label for accessibility */}
                  <th className="pt-th pt-th-remove" aria-label="إزالة" />
                  {/* Product column */}
                  <th className="pt-th pt-th-product">{columns[0]}</th>
                  {/* Dynamic extra columns */}
                  {columns.slice(1).map((col, i) => (
                    <th key={i} className="pt-th">{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>{children}</tbody>
            </table>

            {bottomBar && (
              <div className="pt-bottom-bar">{bottomBar}</div>
            )}
          </div>

          {/* Optional side panel */}
          {sidePanel && (
            <aside className="pt-side-panel">{sidePanel}</aside>
          )}
        </div>
      </div>
    </div>
    </>
  );
}
