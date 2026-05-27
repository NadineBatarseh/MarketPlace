import { Link } from 'react-router-dom';
import Topbar from '../../components/Topbar';
import './PrivacyPolicyPage.css';

const LAST_UPDATED = 'May 27, 2026';
const CONTACT_EMAIL = 'nadinebatarseh03@gmail.com';
const APP_NAME = 'SouqLink';
const APP_URL = 'https://souq-link.com';

export default function PrivacyPolicyPage() {
  return (
    <div className="privacy-page" dir="ltr">
      <Topbar />
      {/* ── Header ── */}
      <header className="privacy-header">
        <div className="privacy-header-inner">
          <Link to="/" className="privacy-logo">
            <img src="/logo.png" alt="SouqLink logo" />
            <span className="privacy-logo-name">SouqLink</span>
          </Link>
          <h1>Privacy Policy</h1>
          <p>Last updated: {LAST_UPDATED}</p>
        </div>
      </header>

      {/* ── Body ── */}
      <main className="privacy-body">

{/* Intro */}
        <section className="privacy-section">
          <p>
            Welcome to <strong>{APP_NAME}</strong> (<a href={APP_URL}>{APP_URL}</a>). We operate an
            e-commerce marketplace that connects merchants and customers. This Privacy Policy explains
            what personal data we collect, why we collect it, how we protect it, and the choices you
            have over your information.
          </p>
          <p>
            By using {APP_NAME} you agree to the practices described in this policy. If you do not
            agree, please discontinue use of the platform.
          </p>
        </section>

        {/* 1 — Information We Collect */}
        <section id="information-we-collect" className="privacy-section">
          <div className="privacy-section-header">
            <div className="privacy-section-icon">📋</div>
            <h2>1. Information We Collect</h2>
          </div>

          <p><strong>Information you provide directly:</strong></p>
          <ul>
            <li>Name, email address, and password when you register an account</li>
            <li>Business name, address, and contact details for merchant accounts</li>
            <li>Shipping address and phone number during checkout</li>
            <li>Product listings, descriptions, images, and pricing submitted by merchants</li>
            <li>Messages sent through our in-app support or chatbot</li>
          </ul>

          <p><strong>Information collected automatically:</strong></p>
          <ul>
            <li>IP address, browser type, operating system, and device identifiers</li>
            <li>Pages visited, time spent, click paths, and referring URLs</li>
            <li>Session tokens and authentication state</li>
            <li>Error logs and performance diagnostics</li>
          </ul>

          <p><strong>Information from third parties:</strong></p>
          <ul>
            <li>Profile name and email address when you log in with Google OAuth</li>
            <li>Instagram Business account data (shop name, product catalogue) when a merchant connects their account</li>
          </ul>
        </section>

        {/* 2 — How We Use */}
        <section id="how-we-use" className="privacy-section">
          <div className="privacy-section-header">
            <div className="privacy-section-icon">🎯</div>
            <h2>2. How We Use Your Information</h2>
          </div>
          <ul>
            <li>Create and manage your account and authenticate your identity</li>
            <li>Process orders, payments, and delivery coordination</li>
            <li>Display your store and products to customers</li>
            <li>Send transactional emails (order confirmations, shipping updates, password resets)</li>
            <li>Provide customer support and respond to inquiries</li>
            <li>Detect and prevent fraud, abuse, and security incidents</li>
            <li>Improve platform features through aggregated, anonymised analytics</li>
            <li>Comply with legal obligations</li>
          </ul>
          <div className="privacy-highlight">
            We do <strong>not</strong> sell your personal data to advertisers or data brokers.
          </div>
        </section>

        {/* 3 — Instagram / Facebook */}
        <section id="instagram-facebook" className="privacy-section">
          <div className="privacy-section-header">
            <div className="privacy-section-icon">📸</div>
            <h2>3. Instagram / Facebook Authentication</h2>
          </div>
          <p>
            {APP_NAME} integrates with the <strong>Meta Platform</strong> (Instagram and Facebook)
            to allow merchants to connect their business accounts and sync product catalogues.
          </p>

          <p><strong>Permissions we request:</strong></p>
          <ul>
            <li><span className="privacy-badge">instagram_basic</span> — read your Instagram profile and media</li>
            <li><span className="privacy-badge">pages_show_list</span> — identify which Facebook Pages are linked to your account</li>
            <li><span className="privacy-badge">pages_read_engagement</span> — read engagement data on your linked Facebook Pages</li>
            <li><span className="privacy-badge">catalog_management</span> — access and sync your product catalogue from Meta Business</li>
          </ul>

          <p><strong>What we do with this access:</strong></p>
          <ul>
            <li>Import your Instagram product catalogue into your SouqLink merchant dashboard</li>
            <li>Display your connected shop name and profile image within the dashboard</li>
          </ul>

          <div className="privacy-highlight">
            We request only the permissions necessary for the above features. You can revoke access
            at any time from your Instagram settings or from within your SouqLink dashboard.
          </div>

          <p>
            Data obtained through Meta APIs is used solely to operate the merchant integration feature
            and is governed by the{' '}
            <a href="https://developers.facebook.com/policy/" target="_blank" rel="noopener noreferrer">
              Meta Platform Terms
            </a>
            . We do not share this data with unaffiliated third parties.
          </p>
        </section>

        {/* 4 — Cookies */}
        <section id="cookies" className="privacy-section">
          <div className="privacy-section-header">
            <div className="privacy-section-icon">🍪</div>
            <h2>4. Cookies &amp; Tracking</h2>
          </div>
          <p>
            We use cookies and similar technologies to operate the platform and understand how it is used.
          </p>

          <p><strong>Types of cookies we use:</strong></p>
          <ul>
            <li><strong>Essential cookies</strong> — required for authentication sessions, cart state, and security (cannot be disabled)</li>
          </ul>

          <p>
            We do not use analytics or preference cookies. Essential cookies cannot be disabled as they
            are required for the platform to function. Disabling them through your browser may prevent
            you from staying logged in or retaining your cart.
          </p>
        </section>

        {/* 5 — Merchant Data */}
        <section id="merchant-data" className="privacy-section">
          <div className="privacy-section-header">
            <div className="privacy-section-icon">🏪</div>
            <h2>5. Merchant Data Handling</h2>
          </div>
          <p>
            As a merchant on {APP_NAME}, we collect and process the following business data to operate
            your storefront:
          </p>
          <ul>
            <li>Business registration details and owner identity information</li>
            <li>Product catalogue: names, descriptions, images, prices, and stock levels</li>
            <li>Order history and fulfilment records</li>
            <li>Instagram/Facebook account tokens (stored encrypted, used only for catalogue sync)</li>
            <li>Store analytics: views, conversions, and sales reports</li>
          </ul>
          <p>
            Merchant business data is retained for as long as your account is active and for a minimum
            of 3 years thereafter for accounting and legal compliance purposes.
          </p>
          <div className="privacy-highlight">
            Your product listings and store page are publicly visible by design. Do not include
            sensitive personal information in product descriptions or store names.
          </div>
        </section>

        {/* 6 — Customer Data */}
        <section id="customer-data" className="privacy-section">
          <div className="privacy-section-header">
            <div className="privacy-section-icon">🛍️</div>
            <h2>6. Customer Data Handling</h2>
          </div>
          <p>
            As a customer, we collect the minimum data necessary to process your orders and personalise
            your shopping experience:
          </p>
          <ul>
            <li>Name, email, and phone number for order communication</li>
            <li>Delivery addresses associated with your orders</li>
            <li>Order history and wishlist / favourites</li>
            <li>Cart state (stored locally and synced to your account when logged in)</li>
          </ul>
          <p>
            We share your name, phone, and delivery address with the relevant merchant and delivery
            agent <strong>only</strong> to fulfil your order. This data is not used for marketing by
            merchants.
          </p>
        </section>

        {/* 7 — Third Parties */}
        <section id="third-parties" className="privacy-section">
          <div className="privacy-section-header">
            <div className="privacy-section-icon">🔗</div>
            <h2>7. Third-Party Services</h2>
          </div>
          <p>We work with the following third-party providers to operate {APP_NAME}:</p>

          <ul>
            <li>
              <strong>Supabase</strong> — our database and authentication infrastructure provider.
              All user data is stored in Supabase's secure cloud (EU region). Supabase is SOC 2
              compliant.{' '}
              <a href="https://supabase.com/privacy" target="_blank" rel="noopener noreferrer">Supabase Privacy Policy →</a>
            </li>
            <li>
              <strong>Meta (Facebook / Instagram)</strong> — used for merchant Instagram Business
              account connection and product catalogue synchronisation.{' '}
              <a href="https://www.facebook.com/privacy/policy/" target="_blank" rel="noopener noreferrer">Meta Privacy Policy →</a>
            </li>
            <li>
              <strong>Google</strong> — used for Google OAuth sign-in.{' '}
              <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">Google Privacy Policy →</a>
            </li>
            <li>
              <strong>Vercel / Hosting provider</strong> — our front-end is deployed on a CDN; server
              logs may include IP addresses and request metadata retained for up to 1 day.
            </li>
          </ul>

          <p>
            Each provider processes data only as necessary for the service they deliver and is bound
            by their own privacy policies and data processing agreements.
          </p>
        </section>

        {/* 8 — Security */}
        <section id="data-security" className="privacy-section">
          <div className="privacy-section-header">
            <div className="privacy-section-icon">🔒</div>
            <h2>8. Data Security</h2>
          </div>
          <p>
            We take reasonable technical and organisational measures to protect your data:
          </p>
          <ul>
            <li>All data in transit is encrypted with <strong>TLS 1.2+</strong> via HTTPS</li>
            <li>Passwords are managed by Supabase Auth using secure hashing — we never store or see plain-text passwords</li>
            <li>OAuth tokens from Meta/Google are stored in a secured database with restricted access and are never exposed publicly</li>
            <li>Access to production databases is managed through Supabase's role-based access control and Row Level Security (RLS)</li>
            <li>Authentication sessions are JWT-based with expiry, and are invalidated on logout</li>
          </ul>
          <p>
            Despite these measures, no system is completely secure. If you discover a security
            vulnerability, please report it responsibly to{' '}
            <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
          </p>
        </section>

        {/* 9 — Your Rights */}
        <section id="your-rights" className="privacy-section">
          <div className="privacy-section-header">
            <div className="privacy-section-icon">⚖️</div>
            <h2>9. Your Rights</h2>
          </div>
          <p>Depending on your location, you may have the following rights regarding your personal data:</p>
          <ul>
            <li><strong>Access</strong> — request a copy of the personal data we hold about you</li>
            <li><strong>Correction</strong> — ask us to correct inaccurate or incomplete data</li>
            <li><strong>Deletion</strong> — request that we delete your account and associated personal data</li>
            <li><strong>Withdraw consent</strong> — disconnect Instagram/Facebook access at any time</li>
          </ul>
          <p>
            To exercise any of these rights, contact us at{' '}
            <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. We will respond within 30 days.
          </p>
          <div className="privacy-highlight">
            To delete your account and all associated data, email us with the subject line
            "Account Deletion Request" from the email address linked to your account.
          </div>
        </section>

        {/* 10 — Contact */}
        <section id="contact" className="privacy-section">
          <div className="privacy-section-header">
            <div className="privacy-section-icon">✉️</div>
            <h2>10. Contact Us</h2>
          </div>
          <p>
            If you have questions, concerns, or requests regarding this Privacy Policy or your
            personal data, please reach out:
          </p>
          <div className="privacy-contact-card">
            <div className="privacy-contact-icon">📧</div>
            <div>
              <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
              <div className="privacy-contact-label">Privacy &amp; Data Protection — {APP_NAME}</div>
            </div>
          </div>
          <p className="privacy-contact-note">
            We may update this Privacy Policy from time to time. When we do, we will revise the
            "Last updated" date at the top of this page. Continued use of {APP_NAME} after changes
            are posted constitutes your acceptance of the updated policy.
          </p>
        </section>
      </main>

      <footer className="privacy-footer">
        © {new Date().getFullYear()} {APP_NAME} · <a href={APP_URL}>{APP_URL}</a>
        {' · '}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
      </footer>
    </div>
  );
}
