export function AdministratorAccount({ email }: { email: string }) {
  return (
    <div className="administrator-account">
      <span title={email}>{email}</span>
      <a href="/logout">Sign out</a>
    </div>
  );
}
