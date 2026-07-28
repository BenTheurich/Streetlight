'use client';

import { type FormEvent, useRef, useState } from 'react';
import type { PacketGenerationResult } from '@/lib/packet-selection';

type PacketGeneratorProps = {
  active: boolean;
  result: PacketGenerationResult | null;
  selectedIndex: number | null;
  onResultChange: (result: PacketGenerationResult | null) => void;
  onSelectedIndexChange: (index: number | null) => void;
};

type RequestRow = {
  id: number;
  quantity: string;
  targetHomes: string;
};

const initialRow: RequestRow = { id: 0, quantity: '1', targetHomes: '30' };

export function PacketGenerator({
  active,
  result,
  selectedIndex,
  onResultChange,
  onSelectedIndexChange,
}: PacketGeneratorProps) {
  const [rows, setRows] = useState<RequestRow[]>([initialRow]);
  const [notice, setNotice] = useState('');
  const [generating, setGenerating] = useState(false);
  const nextRowId = useRef(1);

  function updateRow(index: number, field: keyof RequestRow, value: string) {
    setRows((current) =>
      current.map((row, rowIndex) => (rowIndex === index ? { ...row, [field]: value } : row)),
    );
  }

  async function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const requests = rows.map((row) => ({
      quantity: Number(row.quantity),
      targetHomes: Number(row.targetHomes),
    }));
    if (
      requests.some(
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
    setNotice('');
    try {
      const response = await fetch('/api/packet-proposals', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requests }),
      });
      const next = (await response.json()) as PacketGenerationResult | { error: string };
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

  return (
    <aside className="territory-sidebar packet-sidebar" hidden={!active}>
      <div className="sidebar-title">
        <h1>Generate outreach packets</h1>
        <p>Read-only proposals</p>
      </div>
      <div className="sidebar-scroll">
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
                    onClick={() =>
                      setRows((current) => current.filter((_, rowIndex) => rowIndex !== index))
                    }
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
                onClick={() =>
                  setRows((current) => [
                    ...current,
                    {
                      ...initialRow,
                      id: nextRowId.current++,
                    },
                  ])
                }
                type="button"
              >
                Add packet size
              </button>
              <button disabled={generating} type="submit">
                Generate proposals
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
                  key={proposal.segments.map(({ id }) => id).join('|')}
                >
                  <button
                    aria-pressed={selected}
                    className="packet-card-button"
                    onClick={() => onSelectedIndexChange(index)}
                    type="button"
                  >
                    <strong>Packet {index + 1}</strong>
                    <span>Target {proposal.targetHomes} tracts</span>
                    <span>{proposal.estimatedHomes} estimated tracts</span>
                  </button>
                  {selected && (
                    <div className="packet-card-detail">
                      <strong>Starting address</strong>
                      <p>{proposal.start.address}</p>
                      <strong>Streets</strong>
                      <p>{proposal.streetNames.join(', ')}</p>
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
          </section>
        )}
      </div>
      <div className="sidebar-actions">
        <p aria-live="polite">{notice}</p>
      </div>
    </aside>
  );
}
