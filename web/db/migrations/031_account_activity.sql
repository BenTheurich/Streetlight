CREATE TABLE account_activity (
  id INTEGER PRIMARY KEY,
  church_id TEXT NOT NULL REFERENCES churches(id),
  user_id TEXT,
  actor_name TEXT,
  actor_email TEXT,
  action TEXT NOT NULL CHECK (action IN (
    'onboarding', 'geocoding', 'territory_save', 'packet_proposals',
    'batch_finalization', 'pdf_preparation', 'reconciliation', 'packet_correction',
    'coverage_settings', 'coverage_correction',
    'printout_settings', 'administrator_invitation', 'administrator_revocation',
    'administrator_removal'
  )),
  outcome TEXT NOT NULL CHECK (outcome IN ('succeeded', 'failed', 'rejected', 'started')),
  target_id TEXT,
  recorded_at TEXT NOT NULL
) STRICT;

CREATE INDEX account_activity_church_history
ON account_activity(church_id, recorded_at DESC, id DESC);
