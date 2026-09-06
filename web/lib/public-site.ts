// Flip to true, then rebuild and deploy, to open the full public website.
export const PUBLIC_RELEASE_ENABLED = false;

export const PUBLIC_ACCESS_DESCRIPTION = PUBLIC_RELEASE_ENABLED
  ? 'Tell us a little about your church. If Streetlight is a fit, you can begin with a 90-day full-product free trial. No credit card required.'
  : 'Tell us a little about your church.';

export const PUBLIC_NAVIGATION = [
  { href: '/', label: 'Home', id: 'home' },
  { href: '/how-it-works', label: 'How it works', id: 'how' },
  ...(PUBLIC_RELEASE_ENABLED
    ? ([
        { href: '/why-streetlight', label: 'Why Streetlight', id: 'why' },
        { href: '/pricing', label: 'Pricing', id: 'pricing' },
      ] as const)
    : []),
] as const;
