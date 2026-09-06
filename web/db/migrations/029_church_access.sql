ALTER TABLE churches ADD COLUMN access_kind TEXT NOT NULL DEFAULT 'standard'
  CHECK (access_kind IN ('standard', 'founding', 'sponsored'));

UPDATE churches SET access_kind = 'founding' WHERE id = 'church-temecula-pilot';
