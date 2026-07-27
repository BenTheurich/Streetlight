# Phase 0 geographic and print proof

> **Retired historical proof artifact.** This directory preserves the founder-approved map and
> print prototype only. Its committed fixture was a prototype with unverified source metadata;
> it is not current Overture import evidence. Agents must use
> [`web/importer/overture_import.py`](../web/importer/overture_import.py) and the current
> [territory setup specification](../docs/superpowers/specs/2026-07-27-territory-setup-design.md)
> for live territory imports.

Status: **Complete — founder approved July 27, 2026**

This proof answers one question: can Streetlight turn open geographic data into a useful, printable outreach packet near the test church?

## Test area

- Church: `31087 Nicolas Rd, Temecula, CA 92591, United States`
- Geocoded center: `33.542930, -117.116885`
- Import radius: `10.0 miles`
- Fixture provenance: historical/unverified prototype

A boundary check against OpenStreetMap polygons placed the farthest Temecula point 9.24 miles from the church and the farthest Murrieta point 9.53 miles away. The same circle includes about 49 percent of the Winchester census-designated place. The circle covers about 314 square miles, so later imports must exclude rural and nonresidential data.

The city GIS references are [Temecula GIS](https://temeculaca.gov/265/Geographic-Information-Systems-GIS) and [Murrieta maps and zoning](https://www.murrietaca.gov/288/Maps-Zoning-Information). The center and boundary measurements used OpenStreetMap data through Nominatim.

## Provider decisions

| Need | Phase 0 choice | Constraint |
|---|---|---|
| Address points and estimated tract counts | [Overture addresses](https://docs.overturemaps.org/guides/addresses/), with Riverside County as the correction source | The theme is Alpha, does not identify residential addresses, and has unstable IDs. Counts remain estimates. The historical proposal to make them editable was rejected; imported counts are read-only in the first release. |
| Street geometry | [Overture transportation](https://docs.overturemaps.org/guides/transportation/) | Transportation is ODbL. Printed and interactive maps need attribution. |
| Administrator map | [Google Maps JavaScript API](https://developers.google.com/maps/documentation/javascript/datalayer) is the Phase 0 recommendation | Its Data layer can display Streetlight's saved GeoJSON geometry. Each map load is billable after Google's monthly free usage. |
| Packet map | [Google Maps Static API](https://developers.google.com/maps/documentation/maps-static/start) with [Roads API snapping](https://developers.google.com/maps/documentation/roads/snap) | Each render snaps Streetlight's selected coordinates to Google's current road geometry, then draws them on the Google map. The key is not placed in the HTML. |
| Address lookup | Google Geocoding or Address Validation only for addresses submitted to Streetlight | These APIs validate or geocode a supplied address. They do not enumerate every home in a territory, and Google restricts storage of most response content. |
| QR code | [Google Maps URL](https://developers.google.com/maps/documentation/urls/get-started) to the first house | The QR opens walking directions to the proposed starting address. |

The July 2026 Overture attribution page lists Riverside County as an address source accessed on July 12, 2026. The county source is public-domain data under California public-records law. The fixture keeps address and ODbL transportation fields separate.

Google is the display provider, not Streetlight's coverage database. The [Roads API](https://developers.google.com/maps/documentation/roads/overview) snaps coordinates supplied by a caller to known roads; it does not supply a downloadable street network. The snapped coordinates are requested when the packet image is rendered and are not saved because [Roads API storage is restricted](https://developers.google.com/maps/documentation/roads/policies). [Address Validation](https://developers.google.com/maps/documentation/address-validation/overview) checks an address supplied by a caller; it does not list all houses on a street. Streetlight therefore keeps its own durable, reviewable street geometry and address-count source.

At the pricing published in July 2026, Google includes 10,000 monthly no-cost events for both Static Maps and Dynamic Maps, plus 5,000 Roads Route Traveled events. After that, Static Maps starts at $2 per 1,000 events, Dynamic Maps at $7 per 1,000, and Roads Route Traveled at $10 per 1,000. One packet render uses one Roads event and one Static Maps event. The current values must be rechecked on the [Google Maps Platform pricing page](https://developers.google.com/maps/billing-and-pricing/pricing) before launch.

AI remains out of scope under the founder decision recorded in `PRODUCT.md`.

## Saved fixture

`fixture.json` contains only the local packet proof area:

- 552 deduplicated address points
- 112 road or walking-path segments
- 170,758 bytes
- SHA-256: `418b1837ed0241eb18ffae6fba305275f45f09dc9d7f8286e0e49ffa008809c9`

The test church address is committed in this fixture with the founder's permission. Address points are deduplicated by normalized number, street, and postcode. The fixture metadata is deliberately marked historical/unverified because its prototype source
release and asset claims were never validated. Do not use it as live-import provenance.

## Browser map proof

The source data contains one 16-point Overture transportation feature named `Diego Drive`. Its geometry covers three physical street sections: Andrews Way, Diego Drive, and Jons Place. The feature turns about 90 degrees at each boundary.

The normalizer now processes every named residential source feature in the saved fixture. It:

- removes exact duplicate source geometry;
- splits at network intersections and turns of 85 degrees or more;
- uses at least three nearby saved address names to correct a split section's imported street name;
- assigns each saved address to only its nearest matching normalized segment within 40 meters; and
- preserves the first and last coordinates of a selected chain.

These are deliberately small Phase 0 rules. The historical proposal for administrator
correction of imported geometry was rejected. Phase 2 keeps imported geometry and counts
read-only and uses exclusion polygons to remove unsuitable segments.

For the Diego Drive source feature, the address evidence identifies these normalized sections:

| Section | Saved address points |
|---|---:|
| Andrews Way | 10 |
| Diego Drive | 30 |
| Jons Place | 4 |

Packet `P0-TEM-001` groups all three connected sections into one assignment. The orange highlight is one continuous U-shaped stroke across Andrews Way, Diego Drive, and Jons Place. The proof keeps all 16 source coordinates, including the outer endpoints, then asks Google Roads to snap them to Google's road geometry with interpolation. The current response contains 25 display points. It starts at `30868 Jons Pl, Temecula, CA 92591`, a north-side saved address near the Jons Place endpoint.

The proposed starting house comes from one of the two terminal segments. The proof prefers saved address points north of the road centerline, then chooses the one nearest its outer endpoint. The map marks that address with Google's standard unlabeled pin.

The displayed estimate is 44 because the saved fixture contains 44 nearby address points: 10 on Andrews Way, 30 on Diego Drive, and 4 on Jons Place. That is not yet a verified count of residential homes.

The proof downloads a Google Static Maps image and writes [map-proof.html](../output/phase0/map-proof.html). The generated files and local API key are ignored by Git. The HTML contains neither the key nor a request URL containing the key.

The old PDF used the entire U-shaped source feature, added a walking path and end point, and manually positioned highlights on a screenshot. It remains rejected. The revised print proofs use the accepted map design.

## Neighboring sample maps

`sample_maps.py` renders four fixed, nearby packet examples through the same Roads and Static Maps pipeline:

| Packet | Selected streets | Estimated address points | Normalized segments |
|---|---|---:|---:|
| P0-TEM-001 | Andrews Way, Diego Drive, Jons Place | 44 | 3 |
| P0-TEM-002 | Sugarcane Drive | 24 | 2 |
| P0-TEM-003 | Shree Road, Sonia Lane | 48 | 4 |
| P0-TEM-004 | Skyline Drive | 40 | 6 |

The examples share no normalized segment IDs or assigned address points. They are selected from the normalizer by connected street names, not hard-coded source IDs. They remain geographic proof cases rather than the age, reservation, and packet-size selection algorithm planned for Phase 4.

This wider check exposed two omissions hidden by the hand-picked samples: the saved Shree Road geometry turns onto Sonia Lane while retaining the Shree Road source name, and Skyline Drive continues through a sixth normalized segment. That changes Skyline's saved-address estimate from 31 to 40. The historical proposal to correct imported names or geometry in Phase 2 was rejected; the current product keeps them read-only and uses exclusions instead.

The generated [sample gallery](../output/phase0/sample-gallery.html) links to a full packet-layout preview for each map.

`sample_maps.py` also writes four separate one-page US Letter print proofs:

- [P0-TEM-001 PDF](../output/pdf/streetlight-p0-tem-001.pdf)
- [P0-TEM-002 PDF](../output/pdf/streetlight-p0-tem-002.pdf)
- [P0-TEM-003 PDF](../output/pdf/streetlight-p0-tem-003.pdf)
- [P0-TEM-004 PDF](../output/pdf/streetlight-p0-tem-004.pdf)

Each page contains only the packet identifier, estimated homes/tracts, starting address, navigation QR code, map, required Google attribution in the map image, and the Streetlight wordmark. The prominent estimate sits at the upper left, the two-line address and QR code share a compact directions panel at the upper right, and the packet identifier sits in the lower-right footer opposite the Streetlight wordmark. Automated checks confirm one Letter-sized page and the required text. All four PDFs were rendered back to PNG and visually checked for clipping, overlap, and legibility.

## Run the proof

```powershell
python -m pip install -r phase0/requirements.txt
python phase0/proof.py
python -m phase0.sample_maps
python -m unittest phase0.test_proof -v
python -m http.server 4173 --bind 127.0.0.1 --directory output/phase0
```

`python phase0/proof.py` requires `GOOGLE_MAPS_STATIC_API_KEY` in the ignored root `.env.local` file and both Maps Static API and Roads API enabled for that key.

Refreshing the committed fixture requires network access:

```powershell
python phase0/fetch_fixture.py
```

Open `http://127.0.0.1:4173/map-proof.html` after starting the local server.
Open `http://127.0.0.1:4173/sample-gallery.html` to compare all four examples.

## Review completed

The founder approved the four map layouts and starting pins on July 27, 2026. The remaining Phase 0 human checks are:

- [x] Confirm that the orange highlight correctly includes Andrews Way, Diego Drive, and Jons Place as one packet.
- [x] Check Sugarcane Drive, Shree Road with Sonia Lane, and Skyline Drive for correct road alignment and sensible full endpoints.
- [x] Confirm that none of the four packet assignments visibly repeats a selected street.
- [x] Confirm that `30868 Jons Pl` is a sensible starting house.
- [x] Review all four rendered US Letter PDFs and confirm the header, QR code, map labels, highlight, pin, and Streetlight wordmark are legible. The founder accepted rendered output for this proof; a physical print check remains part of Phase 5.
- [x] Compare the estimate of 44 address points with local knowledge or an on-site count.
- [x] Scan the QR code and confirm that it opens walking directions to `30868 Jons Pl`.
- [x] Approve Overture/Riverside County for saved geometry and address estimates, with Google for map display and road snapping.

The founder approved Phase 0 on July 27, 2026. Phase 1 may begin.

If the address count is wrong, the first fallback is the [Riverside County Address Points](https://gisopendata-countyofriverside.opendata.arcgis.com/datasets/CountyofRiverside::address-points/about) service. Do not add a second provider before this review finds a concrete Overture failure.
