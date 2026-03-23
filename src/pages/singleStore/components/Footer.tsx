import type { Store } from '../types';

interface Props {
  store: Store | null;
}

export default function Footer({ store }: Props) {
  return (
    <footer className="footer">
      <div className="footer-social">
        {store?.facebook && (
          <a className="social-link" href={store.facebook} target="_blank" rel="noopener noreferrer" title="Facebook">
            <svg fill="currentColor" viewBox="0 0 24 24">
              <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
            </svg>
          </a>
        )}
        <a className="social-link" href="#" title="Twitter">
          <svg fill="currentColor" viewBox="0 0 24 24">
            <path d="M23 3a10.9 10.9 0 0 1-3.14 1.53 4.48 4.48 0 0 0-7.86 3v1A10.66 10.66 0 0 1 3 4s-4 9 5 13a11.64 11.64 0 0 1-7 2c9 5 20 0 20-11.5a4.5 4.5 0 0 0-.08-.83A7.72 7.72 0 0 0 23 3z" />
          </svg>
        </a>
        {store?.instagram && (
          <a className="social-link" href={store.instagram} target="_blank" rel="noopener noreferrer" title="Instagram">
            <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
              <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
              <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
            </svg>
          </a>
        )}
        <a className="social-link" href="#" title="LinkedIn">
          <svg fill="currentColor" viewBox="0 0 24 24">
            <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6zM2 9h4v12H2z" />
            <circle cx="4" cy="4" r="2" />
          </svg>
        </a>
      </div>
      <div className="footer-links">
        <a href="#">اتصل بنا</a>
        <a href="#">من نحن</a>
        <a href="#">سياسة الخصوصية</a>
        <a href="#">المساعدة</a>
      </div>
    </footer>
  );
}
