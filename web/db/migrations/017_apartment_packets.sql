ALTER TABLE packets
ADD COLUMN packet_kind TEXT NOT NULL DEFAULT 'street'
CHECK (packet_kind IN ('street', 'apartment'));

CREATE TABLE packet_apartment_complexes (
  church_id TEXT NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  packet_id TEXT PRIMARY KEY REFERENCES packets(id) ON DELETE CASCADE,
  apartment_complex_id TEXT NOT NULL REFERENCES apartment_complexes(id) ON DELETE RESTRICT
) STRICT;

CREATE INDEX packet_apartment_complexes_complex
ON packet_apartment_complexes (apartment_complex_id);
