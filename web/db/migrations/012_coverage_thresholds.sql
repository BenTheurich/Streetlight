ALTER TABLE territories
ADD COLUMN coverage_yellow_after_days INTEGER NOT NULL DEFAULT 90
CHECK (coverage_yellow_after_days BETWEEN 1 AND 3650);

ALTER TABLE territories
ADD COLUMN coverage_orange_after_days INTEGER NOT NULL DEFAULT 180
CHECK (coverage_orange_after_days BETWEEN 1 AND 3650);

ALTER TABLE territories
ADD COLUMN coverage_red_after_days INTEGER NOT NULL DEFAULT 365
CHECK (
  coverage_red_after_days BETWEEN 1 AND 3650
  AND coverage_yellow_after_days < coverage_orange_after_days
  AND coverage_orange_after_days < coverage_red_after_days
);
