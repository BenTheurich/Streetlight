ALTER TABLE churches ADD COLUMN auth_organization_id TEXT;
ALTER TABLE churches
  ADD COLUMN time_zone TEXT NOT NULL DEFAULT 'America/Los_Angeles';

CREATE UNIQUE INDEX churches_auth_organization_id_unique
  ON churches (auth_organization_id)
  WHERE auth_organization_id IS NOT NULL;
