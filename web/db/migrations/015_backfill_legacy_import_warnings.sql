UPDATE territories
SET
  import_spatially_assigned_addresses = 0,
  import_total_residential_buildings = 0,
  import_fallback_buildings = 0,
  import_unmatched_residential_buildings = 0,
  import_populated_unnamed_roads = 0,
  import_building_address_disagreements = 0,
  import_quality_warnings_json = CASE
    WHEN import_total_addresses = 0
      THEN '["No usable address points were available for this territory."]'
    WHEN import_assigned_addresses * 1.0 / import_total_addresses < 0.95
      THEN printf(
        '["Address matching is below the 95%% reliability target (%.1f%% matched)."]',
        import_assigned_addresses * 100.0 / import_total_addresses
      )
    ELSE '[]'
  END
WHERE
  import_kind = 'overture'
  AND import_total_addresses IS NOT NULL
  AND import_assigned_addresses IS NOT NULL;
