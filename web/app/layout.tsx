import './globals.css';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

const description = 'Outreach coverage and printable packet planning for churches.';
const shareImage = {
  url: '/streetlight-share-v1.jpg',
  width: 1200,
  height: 630,
  alt: 'Streetlight. Carry the light to every street. A glowing streetlamp against a navy background.',
};

export const metadata: Metadata = {
  metadataBase: new URL('https://streetlight.bentheurich.com'),
  title: 'Streetlight',
  description,
  icons: { icon: '/streetlight-icon-48.png' },
  openGraph: {
    type: 'website',
    siteName: 'Streetlight',
    title: 'Streetlight',
    description,
    images: [shareImage],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Streetlight',
    description,
    images: [shareImage],
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
