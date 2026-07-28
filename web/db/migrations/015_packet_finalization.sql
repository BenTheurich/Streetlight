ALTER TABLE packets
ADD COLUMN sequence_number INTEGER NOT NULL DEFAULT 0 CHECK (sequence_number >= 0);

ALTER TABLE packets
ADD COLUMN start_longitude REAL;

ALTER TABLE packets
ADD COLUMN start_latitude REAL;

CREATE UNIQUE INDEX packets_batch_sequence
ON packets(batch_id, sequence_number);
