export default function Page() {
  return (
    <section>
      <h1>Welcome to Streetlight</h1>
      <p className="notice">Next.js 14 + TypeScript admin shell is ready.</p>
      <ul>
        <li>API: <code>http://localhost:4000/healthz</code></li>
        <li>Admin: <code>/admin</code> (guarded)</li>
      </ul>
    </section>
  );
}
