'use client';
import { useRouter } from 'next/navigation';

export default function SignOutClient() {
  const router = useRouter();
  const signOut = async () => {
    await fetch('/api/demo-auth', { method: 'DELETE' });
    router.refresh();
  };
  return <button onClick={signOut}>Sign Out</button>;
}
