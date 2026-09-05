import './globals.css';
import type { ReactNode } from 'react';

export const metadata = {
  title: 'Streetlight',
  description: 'Outreach coverage and printable packet planning for churches.',
  icons: { icon: '/streetlight-icon-48.png' },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
