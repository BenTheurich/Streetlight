-- A building-only refresh must not leave immutable packets on an otherwise identical
-- generation with no printable building layer. Advance only street batches whose
-- complete segment and address geography is unchanged.
CREATE INDEX IF NOT EXISTS street_segments_generation_import
ON street_segments (church_id, territory_id, import_generation, import_segment_id);

WITH batch_territories AS (
  SELECT
    b.id AS batch_id,
    b.church_id,
    b.import_generation AS old_generation,
    MIN(s.territory_id) AS territory_id
  FROM batches b
  JOIN packets p ON p.batch_id = b.id AND p.church_id = b.church_id
  JOIN packet_segments ps ON ps.packet_id = p.id AND ps.church_id = p.church_id
  JOIN street_segments s ON s.id = ps.street_segment_id AND s.church_id = b.church_id
  WHERE b.finalized_at IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM packets apartment_packet
      WHERE apartment_packet.batch_id = b.id AND apartment_packet.packet_kind != 'street'
    )
  GROUP BY b.id, b.church_id, b.import_generation
  HAVING COUNT(DISTINCT s.territory_id) = 1
    AND MIN(s.import_generation) = b.import_generation
    AND MAX(s.import_generation) = b.import_generation
),
eligible AS (
  SELECT
    bt.batch_id,
    t.import_generation AS current_generation
  FROM batch_territories bt
  JOIN territories t ON t.id = bt.territory_id AND t.church_id = bt.church_id
  WHERE t.import_generation > bt.old_generation
    AND NOT EXISTS (
      SELECT 1 FROM map_buildings old_building
      WHERE old_building.church_id = bt.church_id
        AND old_building.territory_id = bt.territory_id
        AND old_building.import_generation = bt.old_generation
    )
    AND EXISTS (
      SELECT 1 FROM map_buildings current_building
      WHERE current_building.church_id = bt.church_id
        AND current_building.territory_id = bt.territory_id
        AND current_building.import_generation = t.import_generation
    )
    AND (
      SELECT COUNT(*) FROM street_segments old_segment
      WHERE old_segment.church_id = bt.church_id
        AND old_segment.territory_id = bt.territory_id
        AND old_segment.import_generation = bt.old_generation
    ) = (
      SELECT COUNT(*) FROM street_segments current_segment
      WHERE current_segment.church_id = bt.church_id
        AND current_segment.territory_id = bt.territory_id
        AND current_segment.import_generation = t.import_generation
    )
    AND NOT EXISTS (
      SELECT 1 FROM street_segments old_segment
      WHERE old_segment.church_id = bt.church_id
        AND old_segment.territory_id = bt.territory_id
        AND old_segment.import_generation = bt.old_generation
        AND NOT EXISTS (
          SELECT 1 FROM street_segments current_segment
          WHERE current_segment.church_id = bt.church_id
            AND current_segment.territory_id = bt.territory_id
            AND current_segment.import_generation = t.import_generation
            AND current_segment.import_segment_id = old_segment.import_segment_id
            AND current_segment.street_name = old_segment.street_name
            AND current_segment.road_class = old_segment.road_class
            AND current_segment.geometry_geojson = old_segment.geometry_geojson
            AND current_segment.estimated_homes = old_segment.estimated_homes
        )
    )
    AND (
      SELECT COUNT(*)
      FROM segment_addresses old_address
      JOIN street_segments old_segment ON old_segment.id = old_address.street_segment_id
      WHERE old_segment.church_id = bt.church_id
        AND old_segment.territory_id = bt.territory_id
        AND old_segment.import_generation = bt.old_generation
    ) = (
      SELECT COUNT(*)
      FROM segment_addresses current_address
      JOIN street_segments current_segment ON current_segment.id = current_address.street_segment_id
      WHERE current_segment.church_id = bt.church_id
        AND current_segment.territory_id = bt.territory_id
        AND current_segment.import_generation = t.import_generation
    )
    AND NOT EXISTS (
      SELECT 1
      FROM segment_addresses old_address
      JOIN street_segments old_segment ON old_segment.id = old_address.street_segment_id
      WHERE old_segment.church_id = bt.church_id
        AND old_segment.territory_id = bt.territory_id
        AND old_segment.import_generation = bt.old_generation
        AND NOT EXISTS (
          SELECT 1
          FROM segment_addresses current_address
          JOIN street_segments current_segment
            ON current_segment.id = current_address.street_segment_id
          WHERE current_segment.church_id = bt.church_id
            AND current_segment.territory_id = bt.territory_id
            AND current_segment.import_generation = t.import_generation
            AND current_segment.import_segment_id = old_segment.import_segment_id
            AND current_address.house_number IS old_address.house_number
            AND current_address.street = old_address.street
            AND current_address.locality IS old_address.locality
            AND current_address.postcode IS old_address.postcode
            AND current_address.longitude = old_address.longitude
            AND current_address.latitude = old_address.latitude
        )
    )
)
UPDATE batches
SET import_generation = (
  SELECT eligible.current_generation
  FROM eligible
  WHERE eligible.batch_id = batches.id
)
WHERE id IN (SELECT batch_id FROM eligible);
