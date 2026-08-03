'use client';

import { type FormEvent, useEffect, useState } from 'react';
import { type ChurchPrintoutSettings, parseChurchPrintoutSettings } from '@/lib/settings';
import { OperationStatus } from './OperationStatus';
import { setupToolViews, ToolViewSwitcher } from './ToolViewSwitcher';

export function PrintoutSettings({
  active,
  onDirtyChange,
  onDiscardAndLeave,
  onSaved,
  onSaveAndLeave,
  onStay,
  onViewChange,
  pendingLeave,
  settings,
}: {
  active: boolean;
  onDirtyChange: (dirty: boolean) => void;
  onDiscardAndLeave: () => void;
  onSaved: (settings: ChurchPrintoutSettings) => void;
  onSaveAndLeave: () => void;
  onStay: () => void;
  onViewChange: (view: string) => void;
  pendingLeave: boolean;
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

  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  async function saveSettings(): Promise<boolean> {
    if (!dirty || saving) return !dirty;
    setSaving(true);
    setFeedback(null);
    try {
      const normalized = parseChurchPrintoutSettings({ message, reference });
      const response = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(normalized),
      });
      const result = (await response.json()) as ChurchPrintoutSettings | { error: string };
      if (!response.ok || 'error' in result) {
        throw new Error('error' in result ? result.error : 'Could not save printout settings');
      }
      onSaved(result);
      setFeedback({ error: false, message: 'Future packet PDFs will use this footer.' });
      return true;
    } catch (error) {
      setFeedback({
        error: true,
        message: error instanceof Error ? error.message : 'Could not save printout settings',
      });
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    await saveSettings();
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
          <p>Set one church-wide message for every packet.</p>
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
              placeholder="Leave blank for no church message"
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
          <h2>Footer preview</h2>
          <div className="printout-preview-sheet">
            <strong>STREETLIGHT</strong>
            {message ? (
              <blockquote>
                <p>{message}</p>
                {reference && <cite>{reference}</cite>}
              </blockquote>
            ) : (
              <p className="printout-preview-empty">No church message</p>
            )}
            <span>PACKET ABC-001</span>
          </div>
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
        {pendingLeave ? (
          <div className="territory-leave-prompt" role="alert">
            <strong>Save printout changes before leaving?</strong>
            <p>Your draft will stay here until you choose what to do.</p>
            <div>
              <button className="secondary" disabled={saving} onClick={onStay} type="button">
                Stay
              </button>
              <button
                className="secondary"
                disabled={saving}
                onClick={() => {
                  setMessage(settings.message);
                  setReference(settings.reference);
                  setFeedback(null);
                  onDiscardAndLeave();
                }}
                type="button"
              >
                Discard edits
              </button>
              <button
                disabled={saving}
                onClick={() => {
                  void saveSettings().then((saved) => {
                    if (saved) onSaveAndLeave();
                  });
                }}
                type="button"
              >
                Save and leave
              </button>
            </div>
          </div>
        ) : (
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
              Clear message
            </button>
            <button disabled={!dirty || saving} form="printout-settings-form" type="submit">
              {saving ? 'Saving...' : 'Save printout settings'}
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
