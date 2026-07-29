ALTER TABLE churches ADD COLUMN onboarding_completed_at TEXT;

UPDATE churches
SET onboarding_completed_at = CURRENT_TIMESTAMP
WHERE EXISTS (
  SELECT 1
  FROM territories
  WHERE territories.church_id = churches.id
);

CREATE TABLE pilot_requests (
  id TEXT PRIMARY KEY,
  church_name TEXT NOT NULL,
  normalized_church_name TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  email TEXT NOT NULL,
  normalized_email TEXT NOT NULL,
  location TEXT NOT NULL,
  outreach_process TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'declined', 'provisioning', 'approved')),
  approved_church_name TEXT,
  invite_email TEXT,
  provisioned_church_id TEXT UNIQUE REFERENCES churches(id) ON DELETE RESTRICT,
  auth_organization_id TEXT UNIQUE,
  auth_invitation_id TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decided_at TEXT,
  UNIQUE (normalized_church_name, normalized_email)
) STRICT;
