import Link from 'next/link';
import { cookies } from 'next/headers';
import SignOutClient from './SignOutClient';
import Brand from './Brand';

export default function Header() {
  const signedIn = cookies().get('demoSignedIn')?.value === 'true';
  return (
    <header>
      <Brand />
      <nav>
        <Link href="/">Home</Link>
        <Link href="/admin">Admin</Link>
        {signedIn ? <SignOutClient /> : <Link href="/sign-in">Sign In</Link>}
      </nav>
    </header>
  );
}
