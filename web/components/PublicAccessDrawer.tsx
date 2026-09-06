import Script from 'next/script';
import { PUBLIC_ACCESS_DESCRIPTION } from '@/lib/public-site';

export function PublicAccessDrawer() {
  return (
    <>
      <link rel="stylesheet" href="/landing/public-access.css" />
      <dialog
        className="public-access-dialog"
        id="public-access-dialog"
        aria-labelledby="public-access-title"
        aria-describedby="public-access-description"
      >
        <button
          className="public-access-close"
          type="button"
          data-public-access-close
          aria-label="Close access request"
        >
          ×
        </button>
        <div className="public-access-body">
          <div className="public-access-heading">
            <h2 id="public-access-title" tabIndex={-1}>
              Request access
            </h2>
            <p id="public-access-description">{PUBLIC_ACCESS_DESCRIPTION}</p>
          </div>
          <form className="public-access-form">
            {[
              { name: 'churchName', label: 'Church name', autoComplete: 'organization' },
              { name: 'contactName', label: 'Your name', autoComplete: 'name' },
              { name: 'email', label: 'Email', autoComplete: 'email' },
              { name: 'location', label: 'City and state', autoComplete: 'address-level2' },
            ].map(({ name, label, autoComplete }) => (
              <div className="public-access-field" key={name}>
                <label htmlFor={`public-access-${name}`}>{label}</label>
                <input
                  id={`public-access-${name}`}
                  name={name}
                  type={name === 'email' ? 'email' : 'text'}
                  autoComplete={autoComplete}
                  required
                />
              </div>
            ))}
            <div className="public-access-field">
              <label htmlFor="public-access-process">
                How do you organize outreach today? <span>Optional</span>
              </label>
              <textarea id="public-access-process" name="outreachProcess" rows={4} />
            </div>
            <div className="public-access-honeypot" aria-hidden="true">
              <label htmlFor="public-access-website">Website</label>
              <input id="public-access-website" name="website" tabIndex={-1} autoComplete="off" />
            </div>
            <p className="public-access-error" role="alert" hidden />
            <button className="public-access-submit" type="submit">
              Request access
            </button>
          </form>
          <div className="public-access-success" role="status" aria-live="polite" hidden>
            <span aria-hidden="true">✓</span>
            <h2>Request received.</h2>
            <p data-public-access-message />
            <button type="button" data-public-access-close>
              Back to Streetlight
            </button>
          </div>
        </div>
      </dialog>
      <Script src="/landing/public-access.js" strategy="afterInteractive" />
    </>
  );
}
