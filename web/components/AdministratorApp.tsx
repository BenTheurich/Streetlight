'use client';

import '../app/workspace.css';
import { AuthKitProvider } from '@workos-inc/authkit-nextjs/components';
import type { ComponentProps } from 'react';
import { ChurchOnboarding } from './ChurchOnboarding';
import { StreetlightWorkspace } from './StreetlightWorkspace';

export type AdministratorAppProps =
  | { view: 'workspace'; properties: ComponentProps<typeof StreetlightWorkspace> }
  | { view: 'onboarding'; properties: ComponentProps<typeof ChurchOnboarding> };

export default function AdministratorApp(props: AdministratorAppProps) {
  return (
    <AuthKitProvider>
      {props.view === 'workspace' ? (
        <StreetlightWorkspace {...props.properties} />
      ) : (
        <ChurchOnboarding {...props.properties} />
      )}
    </AuthKitProvider>
  );
}
