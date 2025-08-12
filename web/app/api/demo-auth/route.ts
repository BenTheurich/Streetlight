import { NextResponse } from 'next/server';

export async function DELETE() {
  return new NextResponse('Signed out', {
    status: 200,
    headers: {
      'Set-Cookie': 'demoSignedIn=; Path=/; Max-Age=0'
    }
  });
}
