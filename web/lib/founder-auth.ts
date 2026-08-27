import type { AdministratorUser, AuthLoader } from './auth.ts';

const DEFAULT_FOUNDER_EMAIL = 'bentheurich@gmail.com';

export class FounderAccessNotFoundError extends Error {
  constructor() {
    super('Not found');
  }
}

async function loadWorkOSSession() {
  const { withAuth } = await import('@workos-inc/authkit-nextjs');
  return withAuth();
}

export function isFounderEmail(
  email: string,
  founderEmail = process.env.STREETLIGHT_FOUNDER_EMAIL ?? DEFAULT_FOUNDER_EMAIL,
): boolean {
  return Boolean(founderEmail && email.toLowerCase() === founderEmail.toLowerCase());
}

export async function requireFounderSession(
  loadSession: AuthLoader = loadWorkOSSession,
  founderEmail = process.env.STREETLIGHT_FOUNDER_EMAIL ?? DEFAULT_FOUNDER_EMAIL,
): Promise<AdministratorUser> {
  const { user } = await loadSession();
  if (!user || !isFounderEmail(user.email, founderEmail)) {
    throw new FounderAccessNotFoundError();
  }
  return user;
}
