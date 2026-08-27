WITH accepted(payload) AS (
  VALUES ('[{"sourceId":"6026720","number":"31299","street":"CANTERBURY CT","distance":0,"geometry":{"type":"Polygon","coordinates":[[[-117.1133627,33.5166671],[-117.1132467,33.5166121],[-117.1133647,33.5164372],[-117.1134807,33.5164921],[-117.1133627,33.5166671]]]}},{"sourceId":"6027521","number":"32289","street":"CERCLE BEAUREGARD","distance":0,"geometry":{"type":"Polygon","coordinates":[[[-117.0974739,33.518515],[-117.097551,33.5184975],[-117.0975754,33.5185729],[-117.0974082,33.5186108],[-117.097349,33.5184277],[-117.097439,33.5184073],[-117.0974739,33.518515]]]}},{"sourceId":"6032732","number":"27434","street":"BOLANDRA CT","distance":0,"geometry":{"type":"Polygon","coordinates":[[[-117.1453231,33.5358552],[-117.1451876,33.5357173],[-117.1453008,33.5356393],[-117.1454363,33.5357772],[-117.1453231,33.5358552]]]}},{"sourceId":"6034173","number":"39528","street":"JUNE RD","distance":0,"geometry":{"type":"Polygon","coordinates":[[[-117.1391174,33.5395309],[-117.1393039,33.539535],[-117.1393018,33.539602],[-117.1391153,33.5395979],[-117.1391174,33.5395309]]]}},{"sourceId":"6034970","number":"30416","street":"BOGART PL","distance":2.374,"geometry":{"type":"Polygon","coordinates":[[[-117.1286642,33.5414688],[-117.1286444,33.5413584],[-117.1287763,33.5413419],[-117.128796,33.5414523],[-117.1286642,33.5414688]]]}},{"sourceId":"6036032","number":"39705","street":"N GENERAL KEARNY RD","distance":0,"geometry":{"type":"Polygon","coordinates":[[[-117.1255414,33.5437953],[-117.1253578,33.5437674],[-117.1253912,33.5436137],[-117.1255748,33.5436416],[-117.1255414,33.5437953]]]}},{"sourceId":"6038555","number":"39365","street":"SALINAS DR","distance":0,"geometry":{"type":"Polygon","coordinates":[[[-117.1291924,33.5488603],[-117.1293382,33.5488729],[-117.1293204,33.5490172],[-117.1291745,33.5490046],[-117.1291924,33.5488603]]]}},{"sourceId":"6039794","number":"39181","street":"MOUNTAIN SKY CIR","distance":0,"geometry":{"type":"Polygon","coordinates":[[[-117.1149694,33.5513713],[-117.1149664,33.5514941],[-117.1147265,33.55149],[-117.1147295,33.5513672],[-117.1149694,33.5513713]]]}},{"sourceId":"6040068","number":"39151","street":"TRAIL CREEK LN","distance":0,"geometry":{"type":"Polygon","coordinates":[[[-117.1094544,33.5520331],[-117.1094606,33.5519104],[-117.109647,33.5519169],[-117.1096409,33.5520396],[-117.1094544,33.5520331]]]}},{"sourceId":"6041846","number":"38785","street":"COBBLESTONE CIR","distance":0.079,"geometry":{"type":"Polygon","coordinates":[[[-117.1135232,33.5569508],[-117.1134282,33.5571353],[-117.1133058,33.5570911],[-117.1134008,33.5569066],[-117.1135232,33.5569508]]]}},{"sourceId":"6042078","number":"29621","street":"ROYAL BURGH DR","distance":0,"geometry":{"type":"Polygon","coordinates":[[[-117.1434888,33.557662],[-117.1436259,33.5577508],[-117.1434628,33.5579273],[-117.1433257,33.5578386],[-117.1434888,33.557662]]]}}]')
), candidates AS (
  SELECT
    json_extract(value, '$.sourceId') AS source_id,
    json_extract(value, '$.number') AS house_number,
    json_extract(value, '$.street') AS street,
    json_extract(value, '$.distance') AS distance_meters,
    json_extract(value, '$.geometry') AS geometry_geojson
  FROM accepted, json_each(accepted.payload)
)
INSERT OR IGNORE INTO map_buildings (
  church_id,
  territory_id,
  import_generation,
  source,
  source_feature_id,
  geometry_geojson,
  overture_release,
  retrieved_at,
  fema_address_source_id,
  fema_distance_meters,
  fema_occupancy,
  fema_outbuilding,
  fema_source
)
SELECT
  territory.church_id,
  territory.id,
  territory.import_generation,
  'fema',
  candidates.source_id,
  candidates.geometry_geojson,
  territory.import_release,
  COALESCE(territory.import_completed_at, '2026-07-30T00:00:00.000Z'),
  'legacy-row-gap:' || candidates.house_number || ':' || candidates.street,
  candidates.distance_meters,
  'Single Family Dwelling',
  0,
  'FEMA USA Structures (founder-approved row-gap audit)'
FROM candidates
JOIN territories AS territory
  ON territory.id = 'territory-temecula-pilot'
 AND territory.church_id = 'church-temecula-pilot'
 AND territory.import_generation = 9
 AND territory.import_release = '2026-06-17.0';
