export function AdministratorAccount({ email }: { email: string }) {
  return (
    <div className="administrator-account">
      <button
        aria-haspopup="menu"
        className="administrator-account-trigger"
        popoverTarget="administrator-account-menu"
        type="button"
      >
        <span aria-hidden="true" className="administrator-avatar">
          {email.slice(0, 2).toUpperCase()}
        </span>
        <span className="administrator-email" title={email}>
          {email}
        </span>
        <span aria-hidden="true" className="administrator-account-chevron">
          ⌄
        </span>
      </button>
      <div
        className="administrator-account-menu"
        id="administrator-account-menu"
        popover="auto"
        role="menu"
      >
        <span>Signed in as</span>
        <strong>{email}</strong>
        <a href="/logout" role="menuitem">
          Sign out
        </a>
      </div>
    </div>
  );
}
