'use client';

import { useRouter } from 'next/navigation';

export default function SignInPage() {
  const router = useRouter();
  const signIn = () => {
    document.cookie = 'demoSignedIn=true; path=/; max-age=86400';
    router.push('/admin');
  };
  return (
    <div>
      <h1>Sign In (Demo)</h1>
      <p>This demo creates a cookie to simulate a signed-in session. In production, use Clerk.</p>
      <button onClick={signIn}>Sign In (Set demo cookie)</button>
    </div>
  );
}
