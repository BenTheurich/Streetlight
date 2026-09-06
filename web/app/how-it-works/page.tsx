import type { Metadata } from 'next';
import Image from 'next/image';
import { PublicCta, PublicPage } from '@/components/PublicSiteChrome';

export const metadata: Metadata = {
  title: 'How Streetlight works',
  description:
    'See how Streetlight carries church outreach from region setup to printed packets and a lasting coverage record.',
};

const steps = [
  {
    id: 'region',
    title: 'Start with the community around your church.',
    body: "Enter the church's location and choose how far the outreach region extends. Adjust the boundary and leave out neighborhoods or individual streets your church does not plan to cover or cannot access, such as gated communities.",
  },
  {
    id: 'coverage',
    title: 'See which streets have been waiting longest.',
    body: "Streetlight uses the church's recorded history to show which streets received outreach recently, which have waited longer, and which have no recorded outreach.",
  },
  {
    id: 'prepare',
    title: 'Prepare outreach packets.',
    body: 'Choose how many printable packets are needed and approximately how many homes each should include. Streetlight starts with streets that have waited longest and groups nearby, connected streets into practical packet proposals for review before printing. Each packet covers one connected area and includes a suggested place to begin.',
  },
  {
    id: 'print',
    title: "Put a clear map in every volunteer's hand.",
    body: 'Each finalized packet becomes a single-page map with highlighted streets, an estimated number of homes, a suggested starting address, and a QR code for directions. Volunteers need no Streetlight account or new app, and the printed map remains usable without a phone. One packet. One page. Ready to print and carry.',
  },
  {
    id: 'reconcile',
    title: 'Bring the results back to the map.',
    body: 'After outreach, compare the batch with the paper packets still on hand. Streetlight records which packets were completed, keeps unused packets available for another session, and returns cancelled streets for future packet generation. The coverage map then remembers when each street received outreach. The paper process stays simple; Streetlight keeps the long-term memory.',
  },
] as const;

function WorkflowStep({ index }: { index: number }) {
  const step = steps[index];
  return (
    <article className="workflow-step" id={step.id}>
      <span className="step-number" aria-hidden="true">
        {index + 1}
      </span>
      <div>
        <h2>{step.title}</h2>
        <p>{step.body}</p>
      </div>
    </article>
  );
}

export default function HowItWorksPage() {
  return (
    <PublicPage current="how">
      <h1 className="sr-only">How it works</h1>

      <div className="how-workflow">
        <svg className="workflow-path" aria-hidden="true" focusable="false">
          {steps.map((step) => (
            <line key={step.id} />
          ))}
        </svg>
        <div className="workflow-sequence">
          <section className="workflow-group workflow-region" aria-label="Region and coverage">
            <div className="workflow-copy">
              <WorkflowStep index={0} />
              <WorkflowStep index={1} />
            </div>
            <figure>
              <Image
                loading="eager"
                sizes="(max-width: 900px) calc(100vw - 48px), min(52vw, 640px)"
                alt="A circular outreach region centered on the church, with streets colored by time since their last recorded outreach"
                height={836}
                src="/landing/coverage-map-circle.webp"
                width={1314}
              />
            </figure>
          </section>

          <section className="workflow-group" aria-label="Packet preparation">
            <WorkflowStep index={2} />
            <figure>
              <Image
                sizes="(max-width: 900px) calc(100vw - 48px), min(52vw, 640px)"
                alt="An administrator reviewing a connected Streetlight packet proposal before finalizing it"
                height={1000}
                src="/landing/packet-proposal-review.jpg"
                width={1600}
              />
            </figure>
          </section>

          <section
            className="workflow-group workflow-paper"
            aria-label="Paper packets and reconciliation"
          >
            <div className="workflow-copy">
              <WorkflowStep index={3} />
              <WorkflowStep index={4} />
            </div>
            <figure>
              <Image
                sizes="(max-width: 900px) min(80vw, 420px), 390px"
                alt="A one-page volunteer packet with highlighted streets, estimated homes, a starting address, and a QR code for directions"
                height={968}
                src="/landing/packet-page-v2.webp"
                width={748}
              />
            </figure>
          </section>
        </div>

        <section className="progress-story" id="progress">
          <div className="progress-story-copy">
            <span className="step-number" aria-hidden="true">
              6
            </span>
            <div>
              <h2>See the progress and be encouraged.</h2>
              <p>
                Show the church how outreach has spread over recent months or a full year, on a TV
                screen or in a printed report.
              </p>
            </div>
          </div>
          <figure className="progress-presentation-figure">
            <Image
              sizes="(max-width: 400px) calc(100vw - 48px), min(88vw, 960px)"
              alt="The church-display presentation showing a year of completed outreach illuminated on the map"
              height={900}
              src="/landing/story-progress-streets-complete.webp"
              width={1600}
            />
          </figure>
        </section>
      </div>

      <PublicCta title="Ready to give your outreach map a better memory?">
        Request access to Streetlight and begin with a 90-day free trial. No credit card required.
      </PublicCta>
    </PublicPage>
  );
}
