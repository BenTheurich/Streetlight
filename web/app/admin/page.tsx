export default function AdminPage() {
  const hasClerk = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) && Boolean(process.env.CLERK_SECRET_KEY);
  if (!hasClerk) {
    return (
      <div>
        <h1>Admin</h1>
        <div className="notice">
          <p className="badge">Auth Notice</p>
          <p>Clerk keys are not set. To enable full protection and Clerk UI, set:</p>
          <ul>
            <li><code>NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY</code></li>
            <li><code>CLERK_SECRET_KEY</code></li>
          </ul>
          <p>Locally: copy <code>web/.env.example</code> to <code>web/.env.local</code>. On Vercel: Project → Settings → Environment Variables.</p>
          <p>For development without Clerk, use the demo sign-in at <a href="/sign-in">/sign-in</a>.</p>
        </div>
      </div>
    );
  }
  return (
    <div>
      <h1>Admin Dashboard placeholder</h1>
      <p className="notice">Clerk keys detected. Middleware enforces protection for <code>/admin/**</code>.</p>
    </div>
  );
}
