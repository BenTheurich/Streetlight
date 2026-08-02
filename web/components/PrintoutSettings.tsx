'use client';

import { type FormEvent, useEffect, useState } from 'react';
import type { ChurchPrintoutSettings } from '@/lib/settings';
import { OperationStatus } from './OperationStatus';
import { setupToolViews, ToolViewSwitcher } from './ToolViewSwitcher';

export function PrintoutSettings({
  active,
  onSaved,
  onViewChange,
  settings,
}: {
  active: boolean;
  onSaved: (settings: ChurchPrintoutSettings) => void;
  onViewChange: (view: string) => void;
  settings: ChurchPrintoutSettings;
}) {
  const [message, setMessage] = useState(settings.message);
  const [reference, setReference] = useState(settings.reference);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ error: boolean; message: string } | null>(null);
  const dirty = message !== settings.message || reference !== settings.reference;

  useEffect(() => {
    setMessage(settings.message);
    setReference(settings.reference);
  }, [settings]);

  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!dirty || saving) return;
    setSaving(true);
    setFeedback(null);
    try {
      const response = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message, reference }),
      });
      const result = (await response.json()) as ChurchPrintoutSettings | { error: string };
      if (!response.ok || 'error' in result) {
        throw new Error('error' in result ? result.error : 'Could not save printout settings');
      }
      onSaved(result);
      setFeedback({ error: false, message: 'Future packet PDFs will use this footer.' });
    } catch (error) {
      setFeedback({
        error: true,
        message: error instanceof Error ? error.message : 'Could not save printout settings',
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <aside aria-busy={saving} className="territory-sidebar tool-sidebar" hidden={!active}>
      <ToolViewSwitcher
        label="Setup views"
        onChange={onViewChange}
        options={setupToolViews}
        value="printouts"
      />
      <div className="sidebar-scroll">
        <section className="printout-settings-intro">
          <h1>Packet footer</h1>
          <p>Set one church-wide message for every packet printed from now on.</p>
        </section>
        <form id="printout-settings-form" onSubmit={(event) => void save(event)}>
          <label>
            Message
            <textarea
              maxLength={80}
              onChange={(event) => {
                setMessage(event.target.value);
                setFeedback(null);
                if (!event.target.value) setReference('');
              }}
              placeholder="Leave blank to remove the footer message"
              rows={3}
              value={message}
            />
          </label>
          <label>
            <span className="printout-field-label">
              Reference <small>Optional</small>
            </span>
            <input
              disabled={!message}
              maxLength={60}
              onChange={(event) => {
                setReference(event.target.value);
                setFeedback(null);
              }}
              placeholder="Matthew 5:14"
              value={reference}
            />
          </label>
        </form>
        <section className="printout-preview" aria-label="Packet footer preview">
          <div>
            <strong>STREETLIGHT</strong>
            <span>PACKET ABC-001</span>
          </div>
          {message ? (
            <blockquote>
              <p>{message}</p>
              {reference && <cite>{reference}</cite>}
            </blockquote>
          ) : (
            <p>No church message will appear on future packet handouts.</p>
          )}
        </section>
      </div>
      <div className="sidebar-actions printout-settings-actions">
        {feedback && (
          <OperationStatus
            detail={feedback.message}
            headline={
              feedback.error ? 'Printout settings were not saved' : 'Printout settings saved'
            }
            tone={feedback.error ? 'error' : 'success'}
          />
        )}
        <div>
          <button
            className="secondary"
            disabled={!message && !reference}
            onClick={() => {
              setMessage('');
              setReference('');
              setFeedback(null);
            }}
            type="button"
          >
            Remove message
          </button>
          <button disabled={!dirty || saving} form="printout-settings-form" type="submit">
            {saving ? 'Saving…' : 'Save printout settings'}
          </button>
        </div>
      </div>
    </aside>
  );
}
