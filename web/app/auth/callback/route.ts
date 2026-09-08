import { handleAuth } from '@workos-inc/authkit-nextjs';

export const GET = handleAuth({
  returnPathname: '/',
  // Docker's request URL contains its bind address; redirects need the public origin.
  baseURL: process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI,
});
