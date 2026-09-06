export const SUPPORT_EMAIL = 'support@streetlight.example';

export function PublicSiteFooter() {
  return (
    <footer className="site-footer">
      <span>STREETLIGHT</span>
      <nav className="site-footer-links" aria-label="Footer navigation">
        {PUBLIC_NAVIGATION.map((item) => (
          <a href={item.href} key={item.id}>
            {item.label}
          </a>
        ))}
        {PUBLIC_RELEASE_ENABLED && <a href={`mailto:${SUPPORT_EMAIL}`}>Contact</a>}
      </nav>
      <p className="site-footer-verse">
        Ye are the light of the world. <cite>Matthew 5:14</cite>
      </p>
    </footer>
  );
}

import { PUBLIC_NAVIGATION, PUBLIC_RELEASE_ENABLED } from '@/lib/public-site';
