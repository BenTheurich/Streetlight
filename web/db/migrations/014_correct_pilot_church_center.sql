UPDATE territories
SET center_latitude = 33.5414958,
    center_longitude = -117.1164623
WHERE id = 'territory-temecula-pilot'
  AND origin_address LIKE '31087 Nicolas Rd%'
  AND ABS(center_latitude - 33.54293) < 0.000001
  AND ABS(center_longitude - -117.116885) < 0.000001;
