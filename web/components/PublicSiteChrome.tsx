import Image from 'next/image';
import Script from 'next/script';
import type { ReactNode } from 'react';
import { PUBLIC_NAVIGATION, PUBLIC_RELEASE_ENABLED } from '@/lib/public-site';
import { PublicAccessDrawer } from './PublicAccessDrawer';
import { PublicSiteFooter } from './PublicSiteFooter';

export { SUPPORT_EMAIL } from './PublicSiteFooter';

export function PublicPage({
  current,
  children,
}: {
  current: (typeof PUBLIC_NAVIGATION)[number]['id'];
  children: ReactNode;
}) {
  return (
    <div className="public-page" data-public-page={current}>
      <link rel="stylesheet" href="/landing/public-pages-v1.css" />
      <link rel="stylesheet" href="/landing/public-site-chrome.css" />
      <a className="public-skip-link" href="#main-content">
        Skip to main content
      </a>
      <header className="public-shell-header">
        <a className="public-wordmark" href="/" aria-label="Streetlight home">
          <Image
            alt=""
            loading="eager"
            height={42}
            src="/landing/streetlight-logo-mark-v2.webp"
            width={24}
          />
          <span>Streetlight</span>
        </a>
        <nav className="public-shell-nav public-site-nav" aria-label="Main navigation">
          {PUBLIC_NAVIGATION.map((item) => (
            <a
              aria-current={current === item.id ? 'page' : undefined}
              href={item.href}
              key={item.id}
            >
              {item.label}
            </a>
          ))}
        </nav>
        <div className="public-shell-actions">
          <a className="public-button public-button-outline" href="/login">
            Admin login
          </a>
          <button
            className="public-button public-button-dark"
            type="button"
            data-public-access-open
          >
            Request access
          </button>
        </div>
      </header>
      <main id="main-content">{children}</main>
      <PublicSiteFooter />
      <PublicAccessDrawer />
      <Script src="/landing/public-pages-v1.js" strategy="afterInteractive" />
    </div>
  );
}

export function PublicCta({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="public-cta">
      <div>
        <h2>{title}</h2>
        {PUBLIC_RELEASE_ENABLED && <p>{children}</p>}
      </div>
      <div className="public-cta-actions">
        <button className="public-button public-button-light" type="button" data-public-access-open>
          Request access
        </button>
        {PUBLIC_RELEASE_ENABLED && <a href="/pricing">View pricing</a>}
      </div>
    </section>
  );
}
