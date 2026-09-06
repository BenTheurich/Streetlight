import type { Metadata } from 'next';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import { PublicPage, SUPPORT_EMAIL } from '@/components/PublicSiteChrome';
import { PUBLIC_RELEASE_ENABLED } from '@/lib/public-site';

export const metadata: Metadata = PUBLIC_RELEASE_ENABLED
  ? {
      title: 'Streetlight pricing',
      description:
        'One Streetlight plan for the whole church, with a 90-day full-product free trial.',
    }
  : {};

const included = [
  "Set and adjust the church's outreach region",
  'See which streets received outreach and when',
  'Prepare connected outreach packets',
  'Print one-page volunteer maps',
  'Reconcile completed outreach and correct mistakes',
  'Show recent or yearly Outreach Progress',
  'Add every administrator the church needs',
  'Receive email support for Streetlight',
] as const;

const questions = [
  {
    question: 'Is there a free plan?',
    answer:
      "Unfortunately, no. I want Streetlight to stay affordable, but a permanent free plan wouldn't cover the cost of keeping it dependable.",
  },
  {
    question: 'How does the free trial work?',
    answer:
      'You get 90 days of full access, with no credit card required. That gives your church time to complete a real outreach cycle before deciding if Streetlight is right for you.',
  },
  {
    question: 'Is the price per church or per administrator?',
    answer:
      'Per church, not per administrator. Add everyone who helps manage your outreach at no extra cost!',
  },
  {
    question: 'What happens when the trial ends?',
    answer:
      "Your work stays right where you left it—nothing is lost. However, you'll need a subscription to continue using Streetlight.",
  },
  {
    question: 'What support is included?',
    answer:
      "Email support is included when Streetlight isn't working as expected or you need help using it.",
  },
  {
    question: 'Can I cancel at any time?',
    answer:
      "Yes. You'll keep access through the end of your paid period. We'll preserve your church's data and let you know before it is ever removed.",
  },
  {
    question: "Do you sell my church's data?",
    answer: 'Absolutely not.',
  },
] as const;

export default function PricingPage() {
  if (!PUBLIC_RELEASE_ENABLED) notFound();
  return (
    <PublicPage current="pricing">
      <section className="pricing-hero">
        <h1>One plan for the whole church.</h1>
        <p>Try every Streetlight feature free for 90 days. No credit card required.</p>
      </section>

      <div className="pricing-plan">
        <section className="pricing-choice" aria-labelledby="pricing-options-title">
          <h2 id="pricing-options-title">Billing options</h2>
          <div className="billing-options">
            <article className="billing-annual">
              <h3>
                Annual <span className="billing-recommended">Recommended</span>
              </h3>
              <p>
                <strong>$149</strong>
                <span>per year</span>
              </p>
              <small>Save $31 compared with monthly billing.</small>
            </article>
            <article>
              <h3>Monthly</h3>
              <p>
                <strong>$15</strong>
                <span>per month</span>
              </p>
              <small>Same complete product, billed monthly.</small>
            </article>
          </div>
          <div className="pricing-action">
            <button
              className="public-button public-button-dark"
              type="button"
              data-public-access-open
            >
              Request access
            </button>
            <p>
              Every feature and every church administrator is included with either billing option.
            </p>
          </div>
        </section>

        <section className="pricing-included">
          <h2>Everything Streetlight includes.</h2>
          <ul>
            {included.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      </div>

      <section className="pricing-founder-note">
        <figure>
          <Image
            sizes="(max-width: 600px) 120px, 200px"
            alt="Ben Theurich, founder of Streetlight"
            height={1900}
            loading="lazy"
            src="/landing/ben-theurich-portrait.webp"
            width={1520}
          />
        </figure>
        <div>
          <h2>A note on pricing</h2>
          <p>
            Streetlight began as software for my own church, and I want it to remain affordable for
            small churches. However, reliable hosting, map services, ongoing maintenance, and
            support require real time and money.
          </p>
          <p>
            The subscription price helps me keep Streetlight dependable without ads or selling
            church data.
          </p>
          <p>
            My hope is that $149 per year is a fair middle ground: small enough to fit a church
            budget, but sustainable enough for me to keep supporting and improving the service.
          </p>
          <strong>Ben</strong>
        </div>
      </section>

      <section className="pricing-faq">
        <header>
          <h2>Questions before you begin.</h2>
          <p>
            Need something else? Email <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
          </p>
        </header>
        <div>
          {questions.map(({ question, answer }) => (
            <details key={question}>
              <summary>{question}</summary>
              <div className="faq-answer">
                <p>{answer}</p>
              </div>
            </details>
          ))}
        </div>
      </section>

      <section className="pricing-closing">
        <h2>Take 90 days to complete a real outreach cycle.</h2>
        <p>No credit card required. No feature limits during the free trial.</p>
        <button className="public-button public-button-light" type="button" data-public-access-open>
          Request access
        </button>
      </section>
    </PublicPage>
  );
}
