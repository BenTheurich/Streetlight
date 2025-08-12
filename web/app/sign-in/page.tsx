'use client';
import { SignIn } from '@clerk/nextjs';
export default function Page() {
  return <main style={{ padding: 24 }}><SignIn /></main>;
}
