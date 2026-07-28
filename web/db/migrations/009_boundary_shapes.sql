ALTER TABLE territories
  ADD COLUMN boundary_shape TEXT NOT NULL DEFAULT 'circle'
  CHECK (boundary_shape IN ('circle', 'square'));
