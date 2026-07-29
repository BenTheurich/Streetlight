'use client';

import { type FormEvent, useRef, useState } from 'react';
import type { CoverageWorkspace } from '@/lib/database';
import type { FinalizedBatch, ReviewedPacketGenerationResult } from '@/lib/packet-finalization';

type PacketGeneratorProps = {
  active: boolean;
  result: ReviewedPacketGenerationResult | null;
  selectedIndex: number | null;
  latestBatch: CoverageWorkspace['latestBatch'];
  activePackets: number;
  qualityWarnings: string[];
  onFinalized: (batch: FinalizedBatch) => Promise<void>;
  onResultChange: (result: ReviewedPacketGenerationResult | null) => void;
  onSelectedIndexChange: (index: number | null) => void;
};

type RequestRow = {
  id: number;
  quantity: string;
  targetHomes: string;
};

const initialRow: RequestRow = { id: 0, quantity: '1', targetHomes: '30' };

function downloadPacketPdf(scope: 'newest' | 'active'): void {
  const link = document.createElement('a');
  link.href = `/api/packets/pdf?scope=${scope}`;
  link.download = '';
  document.body.append(link);
  link.click();
  link.remove();
}

export function PacketGenerator({
  active,
  result,
  selectedIndex,
  latestBatch,
  activePackets,
  qualityWarnings,
  onFinalized,
  onResultChange,
  onSelectedIndexChange,
}: PacketGeneratorProps) {
  const [rows, setRows] = useState<RequestRow[]>([initialRow]);
  const [customName, setCustomName] = useState('');
  const [notice, setNotice] = useState('');
  const [generating, setGenerating] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [finalized, setFinalized] = useState<FinalizedBatch | null>(null);
  const nextRowId = useRef(1);

  function discardResult(): void {
    onResultChange(null);
    onSelectedIndexChange(null);
    setConfirming(false);
    setFinalized(null);
  }

  function updateRow(index: number, field: keyof RequestRow, value: string) {
    setRows((current) =>
      current.map((row, rowIndex) => (rowIndex === index ? { ...row, [field]: value } : row)),
    );
    discardResult();
  }

  function requests() {
    return rows.map((row) => ({
      quantity: Number(row.quantity),
      targetHomes: Number(row.targetHomes),
    }));
  }

  async function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const packetRequests = requests();
    if (
      packetRequests.some(
        ({ quantity, targetHomes }) =>
          !Number.isSafeInteger(quantity) ||
          !Number.isSafeInteger(targetHomes) ||
          quantity <= 0 ||
          targetHomes <= 0,
      )
    ) {
      setNotice('Enter positive whole numbers for every packet size.');
      return;
    }

    setGenerating(true);
    setConfirming(false);
    setFinalized(null);
    setNotice('');
    try {
      const response = await fetch('/api/packet-proposals', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requests: packetRequests }),
      });
      const next = (await response.json()) as ReviewedPacketGenerationResult | { error: string };
      if (!response.ok || 'error' in next) {
        throw new Error('error' in next ? next.error : 'Could not generate packet proposals');
      }
      onResultChange(next);
      onSelectedIndexChange(null);
      setNotice(
        next.warnings[0] ??
          `Generated ${next.proposals.length} packet proposal${next.proposals.length === 1 ? '' : 's'}.`,
      );
    } catch (error) {
      onResultChange(null);
      setNotice(error instanceof Error ? error.message : 'Could not generate packet proposals');
    } finally {
      setGenerating(false);
    }
  }

  async function finalize(): Promise<void> {
    if (!result) return;
    setFinalizing(true);
    setNotice('');
    try {
      const response = await fetch('/api/batches/finalize', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          requests: requests(),
          proposalFingerprint: result.proposalFingerprint,
          customName: customName.trim() || null,
        }),
      });
      const batch = (await response.json()) as FinalizedBatch | { error: string };
      if (!response.ok || 'error' in batch) {
        throw new Error('error' in batch ? batch.error : 'Could not finalize packet batch');
      }
      setFinalized(batch);
      setConfirming(false);
      setNotice(`${batch.name} finalized. Your PDF download has started.`);
      downloadPacketPdf('newest');
      try {
        await onFinalized(batch);
      } catch {
        setNotice(`${batch.name} finalized. Reload the page to refresh the batch totals.`);
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('Generate proposals again')) {
        discardResult();
      }
      setNotice(error instanceof Error ? error.message : 'Could not finalize packet batch');
    } finally {
      setFinalizing(false);
    }
  }

  const proposedHomes =
    result?.proposals.reduce((total, proposal) => total + proposal.estimatedHomes, 0) ?? 0;

  return (
    <aside className="territory-sidebar packet-sidebar" hidden={!active}>
      <div className="sidebar-title">
        <h1>Generate outreach packets</h1>
        <p>Build, review, and print outreach routes.</p>
      </div>
      <div className="sidebar-scroll">
        {qualityWarnings.length > 0 && (
          <div className="import-quality-warning" role="alert">
            <strong>Street data may be incomplete</strong>
            <ul>
              {qualityWarnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        )}
        <section>
          <h2>Packet sizes</h2>
          <form className="packet-form" onSubmit={(event) => void generate(event)}>
            {rows.map((row, index) => (
              <div className="packet-request-row" key={row.id}>
                <label>
                  Quantity
                  <input
                    min="1"
                    onChange={(event) => updateRow(index, 'quantity', event.target.value)}
                    required
                    step="1"
                    type="number"
                    value={row.quantity}
                  />
                </label>
                <label>
                  Tracts per packet
                  <input
                    min="1"
                    onChange={(event) => updateRow(index, 'targetHomes', event.target.value)}
                    required
                    step="1"
                    type="number"
                    value={row.targetHomes}
                  />
                </label>
                {rows.length > 1 && (
                  <button
                    aria-label={`Remove packet size ${index + 1}`}
                    className="danger packet-remove"
                    onClick={() => {
                      setRows((current) => current.filter((_, rowIndex) => rowIndex !== index));
                      discardResult();
                    }}
                    type="button"
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
            <div className="packet-form-actions">
              <button
                className="secondary"
                onClick={() => {
                  setRows((current) => [
                    ...current,
                    {
                      ...initialRow,
                      id: nextRowId.current++,
                    },
                  ]);
                  discardResult();
                }}
                type="button"
              >
                Add packet size
              </button>
              <button disabled={generating} type="submit">
                {generating ? 'Generating…' : 'Generate proposals'}
              </button>
            </div>
          </form>
        </section>
        {result && (
          <section className="packet-results">
            <div className="packet-results-header">
              <h2>Proposals</h2>
              {selectedIndex !== null && (
                <button
                  className="secondary"
                  onClick={() => onSelectedIndexChange(null)}
                  type="button"
                >
                  Show all
                </button>
              )}
            </div>
            {result.proposals.map((proposal, index) => {
              const selected = index === selectedIndex;
              return (
                <article
                  className={`packet-card${selected ? ' selected' : ''}`}
                  key={
                    proposal.kind === 'apartment'
                      ? `apartment:${proposal.apartmentId}`
                      : proposal.segments.map(({ id }) => id).join('|')
                  }
                >
                  <button
                    aria-pressed={selected}
                    className="packet-card-button"
                    onClick={() => onSelectedIndexChange(index)}
                    type="button"
                  >
                    <strong>
                      Packet {index + 1}
                      {proposal.kind === 'apartment' ? ' · Apartment complex' : ''}
                    </strong>
                    <span>Target {proposal.targetHomes} tracts</span>
                    <span>{proposal.estimatedHomes} estimated tracts</span>
                  </button>
                  {selected && (
                    <div className="packet-card-detail">
                      <strong>
                        {proposal.kind === 'apartment' ? 'Complex address' : 'Starting address'}
                      </strong>
                      <p>{proposal.start.address}</p>
                      {proposal.kind !== 'apartment' && (
                        <>
                          <strong>Streets</strong>
                          <p>{proposal.streetNames.join(', ')}</p>
                        </>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
            {result.warnings.map((warning) => (
              <p className="packet-warning" key={warning}>
                {warning}
              </p>
            ))}
            {!finalized && (
              <div className="packet-finalize">
                <label>
                  Batch name <span>(optional)</span>
                  <input
                    maxLength={80}
                    onChange={(event) => setCustomName(event.target.value)}
                    placeholder="Streetlight will name it automatically"
                    value={customName}
                  />
                </label>
                {!confirming ? (
                  <button onClick={() => setConfirming(true)} type="button">
                    Finalize &amp; download
                  </button>
                ) : (
                  <div className="packet-confirmation">
                    <strong>Finalize this batch?</strong>
                    <p>
                      {result.proposals.length} packet
                      {result.proposals.length === 1 ? '' : 's'} · {proposedHomes} estimated tracts
                    </p>
                    <p>These streets and apartment complexes will be reserved for this outreach.</p>
                    <div>
                      <button
                        className="secondary"
                        disabled={finalizing}
                        onClick={() => setConfirming(false)}
                        type="button"
                      >
                        Cancel
                      </button>
                      <button disabled={finalizing} onClick={() => void finalize()} type="button">
                        {finalizing ? 'Finalizing…' : 'Confirm finalization'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>
        )}
        {(latestBatch || finalized) && (
          <section className="packet-downloads">
            <h2>Downloads</h2>
            <p>
              Newest: {(finalized ?? latestBatch)?.name} · {(finalized ?? latestBatch)?.packetCount}{' '}
              packet
              {(finalized ?? latestBatch)?.packetCount === 1 ? '' : 's'}
            </p>
            <button onClick={() => downloadPacketPdf('newest')} type="button">
              Download newest batch
            </button>
            <button
              className="secondary"
              disabled={activePackets === 0}
              onClick={() => downloadPacketPdf('active')}
              type="button"
            >
              Download all active packets ({activePackets})
            </button>
          </section>
        )}
      </div>
      <div className="sidebar-actions">
        <p aria-live="polite">{notice}</p>
      </div>
    </aside>
  );
}
