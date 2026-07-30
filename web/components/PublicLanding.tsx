import Script from 'next/script';

export function PublicLanding() {
  return (
    <>
      <link rel="preload" href="/landing/streetlamp-v2.webp" as="image" type="image/webp" />
      <link rel="stylesheet" href="/landing/spread-the-light-v2.css" />
      <a className="skip-link" href="#product-overview">
        Skip to product overview
      </a>

      <header className="site-header">
        <a className="site-brand" href="#top" aria-label="Streetlight home">
          <span className="brand-logo" aria-hidden="true">
            <img
              className="brand-logo-white"
              src="/landing/streetlight-logo-white-v2.webp"
              width="98"
              height="173"
              alt=""
            />
            <img
              className="brand-logo-navy"
              src="/landing/streetlight-logo-mark-v2.webp"
              width="98"
              height="173"
              alt=""
            />
          </span>
          <span>STREETLIGHT</span>
        </a>
        <nav className="top-actions" aria-label="Account">
          <a className="button button-outline" href="/login">
            Admin login
          </a>
          <button className="button button-solid" type="button" data-pilot-open>
            Request pilot access
          </button>
        </nav>
      </header>

      <main id="top">
        <section
          className="anchor-story"
          data-active="0"
          aria-label="How Streetlight carries outreach from planning to paper"
        >
          <div className="anchor-stage" aria-hidden="true">
            <div className="anchor-night">
              <i />
              <i />
              <i />
              <i />
              <i />
            </div>
            <div className="anchor-daylight" />
            <div className="anchor-aura" />
            <div className="anchor-map real-map">
              <img
                src="/landing/neighborhood-map-frosted-v2.webp"
                width="1536"
                height="1024"
                alt=""
              />
              <div className="map-key">
                <span>
                  <i className="key-overdue" />
                  STREETS WAITING
                </span>
                <span>
                  <i className="key-packet" />
                  PROPOSED PACKET
                </span>
              </div>
            </div>
            <div className="anchor-lamp">
              <img
                className="lamp-dark"
                src="/landing/streetlamp-dark-v2.webp"
                width="768"
                height="1152"
                alt=""
              />
              <img
                className="lamp-lit"
                src="/landing/streetlamp-v2.webp"
                width="768"
                height="1152"
                alt=""
              />
            </div>
            <img
              className="anchor-paper real-packet"
              src="/landing/packet-page-v2.webp"
              width="748"
              height="968"
              alt=""
            />
          </div>

          <div className="anchor-steps">
            <section className="anchor-step anchor-opening is-current" data-step="0">
              <div>
                <h1>
                  Carry the light
                  <br />
                  to every street.
                </h1>
                <p>
                  Streetlight helps your church see where outreach has reached, find the streets
                  still waiting, and put the next clear assignment into a volunteer’s hands.
                </p>
              </div>
              <div className="hero-escape">
                <span>SCROLL TO FOLLOW THE LIGHT ↓</span>
              </div>
            </section>
            <StoryStep
              className="anchor-left"
              step={1}
              eyebrow="A SHARED MEMORY"
              title={
                <>
                  See where the light
                  <br />
                  has reached.
                </>
              }
            >
              Every street keeps its outreach history, so recent work stays visible and no area
              quietly disappears.
            </StoryStep>
            <StoryStep
              className="anchor-right anchor-ignition"
              step={2}
              eyebrow="WHAT STILL WAITS"
              title={
                <>
                  Bring forgotten streets
                  <br />
                  back into view.
                </>
              }
            >
              The streets waiting longest rise first—before familiar neighborhoods are covered
              again.
            </StoryStep>
            <StoryStep
              className="anchor-left anchor-light-copy"
              step={3}
              eyebrow="THE NEXT OUTREACH"
              title={
                <>
                  Turn need into
                  <br />
                  clear assignments.
                </>
              }
            >
              Streetlight groups connected streets into practical packets, sized for the tracts your
              church is ready to send.
            </StoryStep>
            <StoryStep
              className="anchor-right anchor-light-copy"
              step={4}
              eyebrow="INTO THEIR HANDS"
              title={
                <>
                  Print the map.
                  <br />
                  Set out the tracts.
                </>
              }
            >
              Volunteers take one sheet, one bundle, and one complete area to cover.
            </StoryStep>
          </div>
        </section>

        <section className="compact-story" aria-label="Streetlight overview">
          <div className="compact-hero">
            <img src="/landing/streetlamp-dark-v2.webp" width="768" height="1152" alt="" />
            <div>
              <h1>
                Carry the light
                <br />
                to every street.
              </h1>
              <p>
                Streetlight helps your church see where outreach has reached, find the streets still
                waiting, and put the next clear assignment into a volunteer’s hands.
              </p>
              <span className="compact-scroll">SCROLL TO FOLLOW THE LIGHT ↓</span>
            </div>
          </div>
          <div className="compact-sequence">
            <CompactBeat title="See where the light has reached.">
              Every street keeps its outreach history, so recent work stays visible and no area
              quietly disappears.
            </CompactBeat>
            <CompactBeat
              className="compact-beat-waiting"
              title="Bring forgotten streets back into view."
            >
              The streets waiting longest rise first—before familiar neighborhoods are covered
              again.
            </CompactBeat>
            <CompactBeat title="Turn need into clear assignments.">
              Streetlight groups connected streets into practical packets, sized for the tracts your
              church is ready to send.
            </CompactBeat>
            <article className="compact-beat compact-beat-packet">
              <figure>
                <img
                  src="/landing/packet-page-v2.webp"
                  width="748"
                  height="968"
                  loading="lazy"
                  alt="A printable Streetlight outreach packet"
                />
              </figure>
              <div>
                <h2>
                  Print the map.
                  <br />
                  Set out the tracts.
                </h2>
                <p>Volunteers take one sheet, one bundle, and one complete area to cover.</p>
              </div>
            </article>
          </div>
        </section>

        <section className="product-overview" id="product-overview">
          <header className="overview-heading">
            <h2>One clear path from the coverage map to the outreach table.</h2>
            <p>
              Streetlight keeps the planning with the administrator and the fieldwork on paper.
              Volunteers do not need an account, an app, or a reporting step.
            </p>
          </header>
          <div className="proof-composition">
            <figure className="coverage-proof">
              <img
                src="/landing/coverage-map-v2.webp"
                width="768"
                height="498"
                loading="lazy"
                alt="A Streetlight coverage map with older streets in red and a connected packet highlighted in blue"
              />
              <figcaption>
                <span>
                  <i className="key-overdue" />
                  Longest waiting
                </span>
                <span>
                  <i className="key-packet" />
                  Proposed packet
                </span>
              </figcaption>
            </figure>
            <figure className="packet-proof">
              <img
                src="/landing/packet-page-v2.webp"
                width="748"
                height="968"
                loading="lazy"
                alt="A one-page Streetlight outreach packet with estimated tracts, a starting address, QR code, and highlighted street map"
              />
              <figcaption>One volunteer assignment. One printed page.</figcaption>
            </figure>
          </div>
          <ol className="workflow">
            <li>
              <strong>Coverage</strong>
              <p>See how long each street has waited since the last recorded outreach.</p>
            </li>
            <li>
              <strong>Generate</strong>
              <p>Prepare connected packets from the oldest eligible streets first.</p>
            </li>
            <li>
              <strong>Print</strong>
              <p>Download the batch and pair each map with the matching number of tracts.</p>
            </li>
            <li>
              <strong>Reconcile</strong>
              <p>Record which sheets were taken so the next coverage map remembers the work.</p>
            </li>
          </ol>
        </section>

        <section className="closing">
          <span className="close-glow" aria-hidden="true" />
          <p>KEEP CARRYING THE LIGHT</p>
          <h2>
            Let no street
            <br />
            be forgotten.
          </h2>
          <div className="close-actions">
            <a className="button button-outline" href="/login">
              Admin login
            </a>
            <button className="button button-solid" type="button" data-pilot-open>
              Request pilot access
            </button>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <span>STREETLIGHT</span>
        <p>Territory planning for faithful neighborhood outreach.</p>
      </footer>

      <dialog className="pilot-drawer" id="pilot-dialog" aria-labelledby="pilot-dialog-title">
        <button
          className="drawer-close"
          type="button"
          data-pilot-close
          aria-label="Close pilot request"
        >
          ×
        </button>
        <div className="drawer-body">
          <div className="drawer-heading">
            <h2 id="pilot-dialog-title" tabIndex={-1}>
              Request pilot access
            </h2>
            <p>
              Tell us a little about your church. This requests a conversation; it does not create
              an account or start a paid plan.
            </p>
          </div>
          <form className="drawer-form">
            <DrawerField
              id="drawer-church-name"
              name="churchName"
              label="Church name"
              autoComplete="organization"
            />
            <DrawerField
              id="drawer-contact-name"
              name="contactName"
              label="Your name"
              autoComplete="name"
            />
            <DrawerField
              id="drawer-email"
              name="email"
              label="Email"
              type="email"
              autoComplete="email"
            />
            <DrawerField
              id="drawer-location"
              name="location"
              label="City and state"
              autoComplete="address-level2"
            />
            <div className="drawer-field">
              <label htmlFor="drawer-process">
                How do you organize outreach today? <span>Optional</span>
              </label>
              <textarea id="drawer-process" name="outreachProcess" rows={4} />
            </div>
            <div className="pilot-honeypot" aria-hidden="true">
              <label htmlFor="drawer-website">Website</label>
              <input id="drawer-website" name="website" tabIndex={-1} autoComplete="off" />
            </div>
            <p className="drawer-error" role="alert" hidden />
            <button className="button drawer-submit" type="submit">
              Request pilot access
            </button>
          </form>
          <div className="drawer-success" role="status" aria-live="polite" hidden>
            <span aria-hidden="true">✓</span>
            <h2>Request received.</h2>
            <p data-pilot-message />
            <button type="button" data-pilot-close>
              Back to Streetlight
            </button>
          </div>
        </div>
      </dialog>
      <Script src="/landing/spread-the-light-v2.js" strategy="afterInteractive" />
    </>
  );
}

function StoryStep({
  className,
  step,
  eyebrow,
  title,
  children,
}: {
  className: string;
  step: number;
  eyebrow: string;
  title: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className={`anchor-step ${className}`} data-step={step}>
      <div>
        <span>{eyebrow}</span>
        <h2>{title}</h2>
        <p>{children}</p>
      </div>
    </section>
  );
}

function CompactBeat({
  className = '',
  title,
  children,
}: {
  className?: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <article className={`compact-beat ${className}`}>
      <div>
        <h2>{title}</h2>
        <p>{children}</p>
      </div>
    </article>
  );
}

function DrawerField({
  id,
  name,
  label,
  type = 'text',
  autoComplete,
}: {
  id: string;
  name: string;
  label: string;
  type?: string;
  autoComplete: string;
}) {
  return (
    <div className="drawer-field">
      <label htmlFor={id}>{label}</label>
      <input id={id} name={name} type={type} autoComplete={autoComplete} required />
    </div>
  );
}
