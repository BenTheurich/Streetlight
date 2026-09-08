import Image from 'next/image';
import type { ReactNode } from 'react';
import { AdministratorAccount } from './AdministratorAccount';

export function AdministratorPage({
  title,
  description,
  email,
  pendingPilotRequests,
  children,
}: {
  title: string;
  description: string;
  email: string;
  pendingPilotRequests?: number | null;
  children: ReactNode;
}) {
  return (
    <div className="administrator-page">
      <header className="territory-header administrator-page-header">
        <a aria-label="Streetlight workspace" className="brand" href="/">
          <Image alt="" height="40" src="/landing/streetlight-logo-mark-v2.webp" width="24" />
          <span className="wordmark">Streetlight</span>
        </a>
        <AdministratorAccount email={email} pendingPilotRequests={pendingPilotRequests} />
      </header>
      <main className="administrator-page-content">
        <a className="administrator-page-back" href="/">
          <svg aria-hidden="true" viewBox="0 0 20 20">
            <path d="m8 5-5 5 5 5M3 10h14" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
          Back to workspace
        </a>
        <header className="administrator-page-heading">
          <h1>{title}</h1>
          <p>{description}</p>
        </header>
        {children}
      </main>
    </div>
  );
}
