import { getFoundationSummary } from '@/lib/database';

export const dynamic = 'force-dynamic';

export default function HomePage() {
  const summary = getFoundationSummary();

  return (
    <div className="shell">
      <header className="masthead">
        <span className="wordmark">Streetlight</span>
        <span className="status">
          <span aria-hidden="true" />
          Local foundation ready
        </span>
      </header>

      <main>
        <section className="hero">
          <p className="eyebrow">Temecula pilot workspace</p>
          <h1>
            Outreach coverage,
            <br />
            ready to build.
          </h1>
          <p className="lede">
            The geographic proof now has a clean application and database foundation. Territory
            setup is the next phase.
          </p>
        </section>

        <section className="metrics" aria-label="Seeded workspace summary">
          <article>
            <span>Territory</span>
            <strong>{summary.territoryName}</strong>
          </article>
          <article>
            <span>Street segments</span>
            <strong>{summary.segmentCount}</strong>
          </article>
          <article>
            <span>Estimated homes</span>
            <strong>{summary.estimatedHomes}</strong>
          </article>
          <article>
            <span>Sample packets</span>
            <strong>{summary.packetCount}</strong>
          </article>
        </section>

        <section className="foundation">
          <div>
            <p className="eyebrow">Foundation record</p>
            <h2>{summary.churchName}</h2>
            <p>Local seed data is connected through the versioned database schema.</p>
          </div>
          <ol aria-label="Implementation progress">
            <li className="done">Geographic proof</li>
            <li className="current">Application foundation</li>
            <li>Territory setup</li>
          </ol>
        </section>
      </main>

      <footer>
        <span>Streetlight</span>
        <span>Phase 1 · Local only</span>
      </footer>
    </div>
  );
}
