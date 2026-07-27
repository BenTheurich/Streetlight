import { getFoundationSummary } from '@/lib/database';

export const dynamic = 'force-dynamic';

export default function CoverageDashboardPage() {
  const summary = getFoundationSummary();

  return (
    <div className="dashboard-page">
      <header className="dashboard-header">
        <span className="wordmark">Streetlight</span>
        <a href="/territory">Territory setup</a>
      </header>
      <main>
        <p className="eyebrow">Coverage dashboard</p>
        <h1>{summary.territoryName}</h1>
        <p>
          The coverage heatmap arrives in Phase 3. Territory setup is available now as its own
          administration page.
        </p>
        <a className="primary-link" href="/territory">
          Open Territory Setup
        </a>
      </main>
    </div>
  );
}
