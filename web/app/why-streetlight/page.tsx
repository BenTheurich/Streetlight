import type { Metadata } from 'next';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import { PublicCta, PublicPage } from '@/components/PublicSiteChrome';
import { PUBLIC_RELEASE_ENABLED } from '@/lib/public-site';

export const metadata: Metadata = PUBLIC_RELEASE_ENABLED
  ? {
      title: 'Why Streetlight',
      description:
        'The story behind Streetlight and the church outreach workflow it is built to serve.',
    }
  : {};

export default function WhyStreetlightPage() {
  if (!PUBLIC_RELEASE_ENABLED) notFound();
  return (
    <PublicPage current="why">
      <section className="founder-opening">
        <div className="founder-opening-copy">
          <h1>It started with my own church.</h1>
          <p>
            Streetlight began with a problem I noticed in the outreach ministry at my own church. We
            had willing volunteers and a paper process that made it easy for people to take part,
            but there was no simple way to see the history of the whole region over time.
          </p>
          <p>
            Some streets could receive outreach repeatedly while others waited much longer—not
            because anyone didn't care, but because the pattern was difficult to see. I started
            building Streetlight to give that process a shared memory.
          </p>
          <span>Ben Theurich, founder</span>
        </div>
        <figure className="founder-photo">
          <Image
            loading="eager"
            fetchPriority="high"
            sizes="(max-width: 900px) min(calc(100vw - 48px), 360px), 360px"
            alt="Ben Theurich, founder of Streetlight"
            height={1900}
            src="/landing/ben-theurich-portrait.webp"
            width={1520}
          />
        </figure>
      </section>

      <section className="why-paper">
        <h2>Paper isn't the problem.</h2>
        <div>
          <p>
            Not every volunteer wants another app, and they shouldn't need one. Outreach is
            volunteer-led and built on trust. People should be able to pick up a paper map and go
            without creating an account, learning new software, or having their location tracked.
            Streetlight keeps the software with the administrators while volunteers keep the simple
            paper workflow that already works in the field.
          </p>
          <p className="paper-principle">
            No volunteer accounts. No individual tracking. Just a clear packet to carry and a
            dependable record for the church afterward.
          </p>
        </div>
      </section>

      <section className="why-map-memory">
        <div>
          <h2>The map should carry the memory.</h2>
          <p>
            Remembering which streets received outreach shouldn't depend on who is present, which
            paper map someone can find, or who happens to recall the last outreach event.
            Streetlight keeps one consistent record of what was completed and when, so the next set
            of packets can begin with the streets that have waited longest.
          </p>
        </div>
        <figure>
          <Image
            sizes="(max-width: 900px) calc(100vw - 48px), min(52vw, 640px)"
            alt="A Streetlight coverage map showing streets with different outreach histories"
            height={836}
            loading="lazy"
            src="/landing/coverage-map-circle.webp"
            width={1314}
          />
        </figure>
      </section>

      <section className="why-progress">
        <header>
          <h2>When people can see the progress, they're encouraged to keep going.</h2>
          <p>
            One packet can feel like a small part of a much larger effort. When the church can see
            several months—or an entire year—coming together on one map, that steady work becomes
            visible. It can encourage people to keep going, invite others to take part, and help the
            church carry the light farther into its community.
          </p>
        </header>
        <div className="progress-frames">
          <figure>
            <Image
              sizes="(max-width: 600px) calc(100vw - 48px), 29vw"
              alt="An early frame from a yearly Streetlight outreach presentation"
              height={900}
              loading="lazy"
              src="/landing/story-progress-streets-early.webp"
              width={1600}
            />
            <figcaption>Early in the year</figcaption>
          </figure>
          <figure>
            <Image
              sizes="(max-width: 600px) calc(100vw - 48px), 29vw"
              alt="A middle frame from a yearly Streetlight outreach presentation"
              height={900}
              loading="lazy"
              src="/landing/story-progress-streets-mid.webp"
              width={1600}
            />
            <figcaption>Partway through</figcaption>
          </figure>
          <figure>
            <Image
              sizes="(max-width: 600px) calc(100vw - 48px), 29vw"
              alt="The completed frame from a yearly Streetlight outreach presentation"
              height={900}
              loading="lazy"
              src="/landing/story-progress-streets-complete.webp"
              width={1600}
            />
            <figcaption>The completed year</figcaption>
          </figure>
        </div>
      </section>

      <section className="why-boundaries">
        <div>
          <h2>Simple enough to review. Dependable enough to remember.</h2>
          <p>
            Streetlight doesn't decide where your church should go or track the people doing the
            work. It uses clear, repeatable rules to prepare packet proposals from your region and
            recorded outreach history. An administrator reviews the proposals before anything is
            finalized. Streetlight keeps the information needed to remember the church's
            outreach—not volunteer locations, household profiles, or personal ministry notes.
          </p>
        </div>
        <div className="why-boundaries-proof">
          <figure className="proposal-review-figure">
            <Image
              sizes="(max-width: 900px) calc(100vw - 48px), min(48vw, 600px)"
              alt="A Streetlight packet proposal ready for an administrator to review"
              height={1000}
              loading="lazy"
              src="/landing/packet-proposal-review.jpg"
              width={1600}
            />
          </figure>
          <div className="memory-comparison">
            <section>
              <h3>Streetlight remembers</h3>
              <ul>
                <li>The church's outreach region</li>
                <li>Printed packets</li>
                <li>Completed outreach dates</li>
                <li>Corrections to the record</li>
              </ul>
            </section>
            <section>
              <h3>Streetlight does not track</h3>
              <ul>
                <li>Volunteer locations</li>
                <li>Individual performance</li>
                <li>Household profiles</li>
                <li>Personal ministry notes</li>
              </ul>
            </section>
          </div>
        </div>
      </section>

      <section className="founder-closing">
        <p>
          Streetlight started with a real need at my own church. I'm building it carefully around
          the people who actually use it: administrators who need a reliable record and volunteers
          who simply need a map they can carry. I hope it can quietly serve your church, too.
        </p>
        <strong>Ben</strong>
      </section>

      <PublicCta title="Give your church one dependable outreach record.">
        Request access and try every Streetlight feature free for 90 days. No credit card required.
      </PublicCta>
    </PublicPage>
  );
}
