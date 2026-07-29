import './globals.css';
import { AuthKitProvider } from '@workos-inc/authkit-nextjs/components';
import type { ReactNode } from 'react';

export const metadata = {
  title: 'Streetlight',
  description: 'Outreach coverage and printable packet planning for churches.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AuthKitProvider>{children}</AuthKitProvider>
      </body>
    </html>
  );
}
