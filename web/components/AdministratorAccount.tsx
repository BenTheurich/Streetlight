export function AdministratorAccount({
  email,
  pendingPilotRequests = null,
}: {
  email: string;
  pendingPilotRequests?: number | null;
}) {
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
        {pendingPilotRequests !== null && (
          <a href="/pilot-requests" role="menuitem">
            Pilot requests
            {pendingPilotRequests > 0 && (
              <span className="administrator-account-badge">{pendingPilotRequests}</span>
            )}
          </a>
        )}
        <a href="/logout" role="menuitem">
          Sign out
        </a>
      </div>
    </div>
  );
}
