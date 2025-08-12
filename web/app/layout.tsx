import './globals.css';
import type { ReactNode } from 'react';
import { ClerkProvider, SignedIn, SignedOut, SignInButton, SignUpButton, UserButton } from '@clerk/nextjs';
import Header from '@/components/Header';

export const metadata = { title: 'Streetlight' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body>
          <header style={{ padding: 12 }}>
            <SignedOut>
              <SignInButton />
              <span style={{ margin: '0 8px' }} />
              <SignUpButton />
            </SignedOut>
            <SignedIn>
              <UserButton />
            </SignedIn>
          </header>
          <Header />
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}
