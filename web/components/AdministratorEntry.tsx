'use client';

import dynamic from 'next/dynamic';
import type { AdministratorAppProps } from './AdministratorApp';

// The client boundary keeps authenticated code and styles out of the public home page.
const AdministratorApp = dynamic(() => import('./AdministratorApp'));

export function AdministratorEntry(props: AdministratorAppProps) {
  return <AdministratorApp {...props} />;
}
