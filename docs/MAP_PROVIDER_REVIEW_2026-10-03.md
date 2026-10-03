# Map provider review

Reviewed: October 3, 2026. Scope: the existing open-data workspace and packet-map workflow,
Overture releases `2026-08-19.0` and `2026-06-17.0`, the adapted Positron style, and the exact
USA Structures service used by the importer. Review and local verification are complete.
Production publication remains pending.

## Provider findings

| Source | Permission and conditions | Implementation |
|---|---|---|
| OpenFreeMap | Its [published guidance](https://openfreemap.org/#attribution) permits commercial use and gives printed-media credits; displaying OpenFreeMap's own name is optional. The [September 9 terms](https://openfreemap.org/tos/) provide no availability or accuracy warranty and prohibit unauthorized automated collection. | Ordinary MapLibre tile requests and bounded captures of up to three packet maps use the advertised printing path. There is no tile crawl, bulk prefetch, or use of `tile.openstreetmap.org`. Retain the approved public host and its outage behavior. |
| OpenStreetMap | [OSMF guidance](https://osmfoundation.org/wiki/Licence/Attribution_Guidelines) requires readable credits and access to ODbL information. Printed maps must show `openstreetmap.org/copyright`. | Interactive credits link directly to copyright information; packet maps and the workspace print view include the readable URL. |
| OpenMapTiles and Positron | The [style license](https://github.com/openmaptiles/positron-gl-style/blob/master/LICENSE.md) requires BSD software notices and accessible design credits. [OpenFreeMap's license list](https://github.com/hyperknot/openfreemap-styles/blob/main/LICENSE.md) identifies its MIT license, upstream cartography, fonts, icons, and imagery. | `web/public/map-style-licenses.txt` retains the supplied notices. The public map-data notice credits the CartoDB, Stamen, Paul Norman, and OpenMapTiles design lineage and identifies Streetlight's modifications. |
| Overture | Transportation and buildings use ODbL; addresses carry source-specific terms. The exact [August](https://github.com/OvertureMaps/docs/blob/3d742db2401e785d608d7c0497068f5c9326f8d2/docs/_generated_attribution.mdx) and [June](https://github.com/OvertureMaps/docs/blob/6fd9ed1257b26129b18654569393eb1620630f30/docs/_generated_attribution.mdx) upstream notices are preserved by immutable links. | Maps name Overture and link to the public source notices. Stored geographic metadata retains the release. Road normalization and the selected building layer are treated conservatively as adapted geography. |
| USA Structures | The [exact ArcGIS item](https://www.arcgis.com/home/item.html?id=0ec8512ad21e4bb987d7e848d14e7e24) states CC BY 4.0 and credits ORNL and FEMA Geospatial Response Office. [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/legalcode.en) permits copying and adaptation with creator, source, license, modification, and disclaimer information. | Compact map credits name ORNL/FEMA. The linked notice supplies full creator names, the source, license, Esri's prior field changes, and Streetlight's filtering. FEMA is credited only where accepted footprints exist. |

The exact service is
`https://services2.arcgis.com/FiaPA4ga0iQKduv3/arcgis/rest/services/USA_Structures_View/FeatureServer/0`.
Its item metadata is available at
`https://www.arcgis.com/sharing/rest/content/items/0ec8512ad21e4bb987d7e848d14e7e24?f=pjson`.
The downloader uses its Query capability and 2,000-record pagination. Its existing failure path
retains Overture-only geography. CC BY status comes from that item's explicit license, not an
assumption that all government-hosted data is public domain.

## Compact credit presentation

The workspace uses `© OpenMapTiles · © OpenStreetMap · Overture Maps · ORNL/FEMA · Credits`,
with FEMA conditional on the stored footprints. Satellite omits OpenMapTiles and keeps its
open-data overlay credits above the Google footer area and away from the map controls.

Packet PDFs use two native text lines below the map. The first names `© OpenMapTiles.org`,
`© OpenStreetMap contributors`, `Overture Maps (ODbL)`, and conditional `ORNL/FEMA`.
The second gives `openstreetmap.org/copyright` and the public Streetlight notice URL.
Browser printing also exposes the URLs, including `openmaptiles.org` for Roadmap.
The [OpenMapTiles license](https://github.com/openmaptiles/openmaptiles/blob/master/LICENSE.md)
allows its name with a link or the visible `.org` form. Neither reviewed terms nor the attribution
guidance require a visible release date; the geographic metadata and release notices retain it.

The public notice uses native expandable sections for full source, creator, license, modification,
and regional notices. The free machine-readable geographic-data offer stays visible without
opening a section. No provider, geographic transformation, or service request behavior changed.

## Adapted geographic data offer

[ODbL sections 4.4 and 4.6](https://opendatacommons.org/licenses/odbl/1-0/) require an offer of
machine-readable adapted geography or complete alterations when maps made from it are shared.
Invited administrators are external recipients. A public importer alone cannot reproduce every
stored generation because FEMA inputs change and approved roads can survive source replacement.

`web/public/map-data.html` provides the offer, license links, modification notices, and support
destination. Internet fulfillment is free. Account ownership, church membership, and restrictions
on redistribution are not conditions of fulfillment. Geographic source licenses govern reuse;
the application and church operational records are separate.

## Fulfill a geographic data request

1. Identify the area and stored generation from the map release, date, or packet code. A code is a
   lookup aid, not an authorization credential. Confirm the database and scope before reading it.
2. Work from a verified snapshot, using the existing backup command with a new destination. Never
   send the SQLite file. Use a read-only connection and explicit geography-column selections.
3. Export all normalized roads, assigned geographic addresses, and accepted building footprints
   for the relevant generation, including hidden and preserved roads. Retain recorded FEMA
   polygons and provenance. Do not redownload a mutable source to replace them.
4. Include release identifiers, the corresponding immutable upstream notices, ODbL and CC BY
   links, Streetlight's alteration method at the relevant Git commit, and source-specific notices.
   For a preserved apartment packet, also include its source-derived apartment geometry and
   geographic evidence; exclude administrator review and access settings.
5. Inspect the export before fulfillment. Exclude church IDs/names, administrator identities,
   invitations, packet assignments, active reservations, coverage dates, reconciliation history,
   exclusions, and other church preferences. Send geographic JSON or an equivalent open format
   without additional reuse restrictions. Responding to a recipient requires Ben's message approval.

The following read-only example covers street-map generations. Save it outside the repository's
public directory, supply the four exact arguments, and review its JSON before sharing:

```js
import { DatabaseSync } from 'node:sqlite';

const [filename, churchId, territoryId, generationText] = process.argv.slice(2);
const generation = Number(generationText);
if (!filename || !churchId || !territoryId || !generationText ||
    !Number.isSafeInteger(generation) || generation < 0) {
  throw new Error('Supply snapshot path, church ID, territory ID, and generation');
}
const database = new DatabaseSync(filename, { readOnly: true });
const scope = [churchId, territoryId, generation];
try {
  const roads = database.prepare(`
    SELECT import_segment_id AS source_id, street_name, road_class, estimated_homes,
      geometry_geojson
    FROM street_segments
    WHERE church_id = ? AND territory_id = ? AND import_generation = ?
    ORDER BY import_segment_id
  `).all(...scope);
  if (!roads.length) throw new Error('No stored streets for this scope and generation');
  const addresses = database.prepare(`
    SELECT s.import_segment_id AS road_source_id, a.house_number, a.street,
      a.locality, a.postcode, a.longitude, a.latitude
    FROM segment_addresses a JOIN street_segments s ON s.id = a.street_segment_id
    WHERE s.church_id = ? AND s.territory_id = ? AND s.import_generation = ?
    ORDER BY s.import_segment_id, a.id
  `).all(...scope);
  const buildings = database.prepare(`
    SELECT source, source_feature_id AS source_id, geometry_geojson, overture_release,
      fema_address_source_id, fema_distance_meters, fema_occupancy, fema_outbuilding,
      fema_source, fema_product_date, fema_image_date
    FROM map_buildings
    WHERE church_id = ? AND territory_id = ? AND import_generation = ?
    ORDER BY source, source_feature_id
  `).all(...scope);
  console.log(JSON.stringify({
    license: 'https://opendatacommons.org/licenses/odbl/1-0/',
    notices: 'https://streetlight.bentheurich.com/map-data.html',
    roads, addresses, buildings,
  }, null, 2));
} finally {
  database.close();
}
```

This example deliberately has no API, migration, write, authentication override, or live-database
default. It reads geographic snapshots for manual fulfillment.

## Scope and re-review

Provider review is bounded to this workflow and these recorded sources. Address suppliers can
impose additional regional conditions. The exact release notices include Kent County's required
notice and application disclaimer and G-NAF's mail-use restriction. Check the applicable source
conditions before introducing those uses or fulfilling an export that contains that data. The
current importer does not retain per-address supplier metadata, so do not infer a supplier solely
from an Overture address ID or make a worldwide legal-certification claim.

The public notice includes the conditional Kent County credit and application disclaimer from
sections 5 and 8 of its linked license. OSM credits remain visible on Satellite because Overture's
road overlays still include OSM-derived geography.

Re-review when changing the pinned release, source service, map host, cartographic style, or use
of the data. The Google Satellite service is separate and keeps its native credits; open-data
overlay credits now remain visible there. Printable packet maps continue to use no Google imagery.

## Verification and publication

- [x] Provider URLs, pinned release notices, and exact ArcGIS license metadata reviewed;
  independent Overture and FEMA reviews completed. Their attribution findings are addressed.
- [x] `pnpm check` passed in an isolated copy of the working source: lint, TypeScript,
  427 web tests, 4 Python-launcher tests, 73 importer tests, and the production build.
  Lint, types, and the build passed again after the final browser-print URL adjustment.
  Authentication values were fake; databases and browser storage were disposable.
- [x] The local production build returned HTTP 200 for `/map-data.html` and
  `/map-style-licenses.txt` without a session. Browser checks at 320, 390, and 1440 pixels
  found no horizontal overflow. Revised notice sections passed both collapsed and expanded
  checks at those widths, and the FEMA fragment opened its full notice. The actual Roadmap and
  Satellite UI retained unclipped credit links and exposed source URLs when printing.
  Satellite placement was checked without a Google key, with a 36-pixel footer clearance;
  the Google imagery and provider-generated footer were not reloaded for this local review.
- [x] The documented export ran against the real migrated schema in a disposable fixture.
  It included hidden and preserved roads, assigned addresses, and stored FEMA geometry and
  provenance for the requested generation. Other scopes and private-record sentinels were
  absent. The database bytes were unchanged; invalid and missing scopes failed.
- [x] A recorded geographic fixture passed through the actual map and packet PDF renderers.
  Visual inspection found two readable, unclipped 7-point credit lines below the Letter map.
  Focused PDF tests verify the text, placement, line widths, per-generation FEMA credits,
  and rejection of missing geographic provenance. An independent compact-credit review
  identified the browser-print OpenMapTiles URL omission; the final layout check verifies its fix.
- [ ] Publish the credit fixes and public notice together, then verify the public notice and
  changed maps on the deployed version. Production remains on `c25ffb0` at this review's close.

The provider-review item is complete. Production publication is the remaining action;
it requires Ben's approval under the repository's live-change rule. The regional conditions
and re-review triggers above remain ongoing requirements.
