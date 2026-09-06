import Image from 'next/image';
import Script from 'next/script';
import type { ImgHTMLAttributes } from 'react';
import {
  PUBLIC_ACCESS_DESCRIPTION,
  PUBLIC_NAVIGATION,
  PUBLIC_RELEASE_ENABLED,
} from '@/lib/public-site';
import { PublicSiteFooter } from './PublicSiteFooter';

export function PublicLanding() {
  return (
    <>
      <link rel="preload" href="/landing/streetlamp-dark-v2.webp" as="image" type="image/webp" />
      <link rel="stylesheet" href="/landing/spread-the-light-v2.css" />
      <link rel="stylesheet" href="/landing/public-site-chrome.css" />
      <a className="skip-link" href="#product-overview">
        Skip to product overview
      </a>

      <header className="site-header">
        <a className="site-brand" href="#top" aria-label="Streetlight home">
          <span className="brand-logo" aria-hidden="true">
            {/* biome-ignore lint/performance/noImgElement: The approved logo crossfade targets this raw asset markup and requires browser comparison before conversion. */}
            <img
              className="brand-logo-white"
              src="/landing/streetlight-logo-white-v2.webp"
              width="98"
              height="173"
              alt=""
            />
            {/* biome-ignore lint/performance/noImgElement: The approved logo crossfade targets this raw asset markup and requires browser comparison before conversion. */}
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
        <nav className="public-nav-links public-site-nav" aria-label="Public pages">
          {PUBLIC_NAVIGATION.map((item) => (
            <a
              href={item.href}
              key={item.id}
              aria-current={item.id === 'home' ? 'page' : undefined}
            >
              {item.label}
            </a>
          ))}
        </nav>
        <div className="top-actions">
          <a className="button button-outline" href="/login">
            Admin login
          </a>
          <button className="button button-solid" type="button" data-pilot-open>
            Request access
          </button>
        </div>
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
              <DesktopStoryImage
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
              <DesktopStoryImage
                className="lamp-dark"
                src="/landing/streetlamp-dark-v2.webp"
                width="768"
                height="1152"
                alt=""
              />
              <DesktopStoryImage
                className="lamp-lit"
                src="/landing/streetlamp-v2.webp"
                width="768"
                height="1152"
                alt=""
              />
            </div>
            <DesktopStoryImage
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
                  Streetlight helps your church see which streets have received outreach, find those
                  still waiting, and prepare printed maps for volunteers.
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
              Streetlight starts new packets with the streets that have waited longest for outreach.
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
              Streetlight groups connected streets into packets based on the approximate number of
              homes you choose.
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
              Volunteers take a printed map and the matching tracts to cover the streets marked on
              it.
            </StoryStep>
          </div>
        </section>

        <section className="compact-story" aria-label="Streetlight overview">
          <div className="compact-hero">
            {/* biome-ignore lint/performance/noImgElement: The approved compact composition relies on this asset's exact intrinsic sizing and requires browser comparison before conversion. */}
            <img src="/landing/streetlamp-dark-v2.webp" width="768" height="1152" alt="" />
            <div>
              <h1>
                Carry the light
                <br />
                to every street.
              </h1>
              <p>
                Streetlight helps your church see which streets have received outreach, find those
                still waiting, and prepare printed maps for volunteers.
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
              Streetlight starts new packets with the streets that have waited longest for outreach.
            </CompactBeat>
            <CompactBeat title="Turn need into clear assignments.">
              Streetlight groups connected streets into packets based on the approximate number of
              homes you choose.
            </CompactBeat>
            <article className="compact-beat compact-beat-packet">
              <figure>
                <Image
                  src="/landing/packet-page-v2.webp"
                  sizes="(max-width: 760px) min(78vw, 300px), 300px"
                  width={748}
                  height={968}
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
                <p>
                  Volunteers take a printed map and the matching tracts to cover the streets marked
                  on it.
                </p>
              </div>
            </article>
          </div>
        </section>

        <section className="product-overview" id="product-overview">
          <header className="overview-heading" data-reveal="overview-heading">
            <h2>One clear path from the coverage map to the outreach table.</h2>
            <p>
              Streetlight keeps the planning with the administrator and the fieldwork on paper.
              Volunteers do not need an account, an app, or a reporting step.
            </p>
          </header>
          <div className="proof-composition">
            <figure className="coverage-proof" data-reveal="coverage">
              <Image
                src="/landing/coverage-map-circle.webp"
                sizes="(max-width: 760px) calc(100vw - 40px), min(73vw, 1029px)"
                width={1314}
                height={836}
                loading="lazy"
                alt="A Streetlight coverage map centered on the church, with streets colored by time since outreach"
              />
            </figure>
            <figure className="packet-proof" data-reveal="packet">
              <Image
                src="/landing/packet-page-v2.webp"
                sizes="(max-width: 760px) min(calc(78vw - 31px), 320px), min(30vw, 350px)"
                width={748}
                height={968}
                loading="lazy"
                alt="A one-page Streetlight outreach packet with estimated tracts, a starting address, QR code, and highlighted street map"
              />
              <figcaption>One volunteer assignment. One printed page.</figcaption>
            </figure>
          </div>
          <ol className="workflow" data-reveal="workflow">
            <li>
              <strong>Coverage</strong>
              <p>See how long each street has waited since the last recorded outreach.</p>
            </li>
            <li>
              <strong>Generate</strong>
              <p>Prepare packets starting with streets that have older or no recorded outreach.</p>
            </li>
            <li>
              <strong>Print</strong>
              <p>Download the batch and pair each map with the matching number of tracts.</p>
            </li>
            <li>
              <strong>Reconcile</strong>
              <p>
                Check which paper packets are still on the table, then confirm the others as
                completed.
              </p>
            </li>
          </ol>
          <figure className="outreach-progress-proof" data-reveal="progress">
            <div className="progress-projector">
              <span className="projector-glow" />
              <span className="projector-housing" />
              <div className="projector-screen">
                <video
                  aria-label="Outreach progress over the past year"
                  src="/landing/outreach-progress-presentation.mp4"
                  poster="/landing/outreach-progress-presentation-poster.webp"
                  width={1600}
                  height={800}
                  loop
                  muted
                  playsInline
                  preload="none"
                >
                  Completed outreach lights up across the map over the course of a year.
                </video>
              </div>
              <span className="projector-rail" />
              <span className="projector-pull" />
            </div>
            <figcaption>
              <strong>Outreach Progress</strong>
              <span>
                Let the church watch completed outreach spread from neighborhood to neighborhood.
              </span>
            </figcaption>
          </figure>
        </section>

        <section className="closing">
          <span className="close-glow" aria-hidden="true" />
          <p>KEEP CARRYING THE LIGHT</p>
          <h2>
            Let no street
            <br />
            be forgotten.
          </h2>
          {PUBLIC_RELEASE_ENABLED && (
            <p className="closing-trial-note">90-day free trial. No credit card required.</p>
          )}
          <div className="close-actions">
            <a className="button button-outline" href="/login">
              Admin login
            </a>
            <button className="button button-solid" type="button" data-pilot-open>
              Request access
            </button>
          </div>
        </section>
      </main>

      <PublicSiteFooter />

      <dialog className="pilot-drawer" id="pilot-dialog" aria-labelledby="pilot-dialog-title">
        <button
          className="drawer-close"
          type="button"
          data-pilot-close
          aria-label="Close access request"
        >
          ×
        </button>
        <div className="drawer-body">
          <div className="drawer-heading">
            <h2 id="pilot-dialog-title" tabIndex={-1}>
              Request access
            </h2>
            <p>{PUBLIC_ACCESS_DESCRIPTION}</p>
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
              Request access
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

function DesktopStoryImage({
  src,
  alt = '',
  ...properties
}: Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> & { src: string }) {
  return (
    <picture>
      <source media="(min-width: 761px) and (prefers-reduced-motion: no-preference)" srcSet={src} />
      <img
        {...properties}
        alt={alt}
        src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1' height='1'/%3E"
      />
    </picture>
  );
}
