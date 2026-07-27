# Phase 0 geographic and print proof

Status: **In progress**

This proof answers one question: can Streetlight turn open geographic data into a useful, printable outreach packet near the test church?

## Test area

- Church: `31087 Nicolas Rd, Temecula, CA 92591, United States`
- Geocoded center: `33.542930, -117.116885`
- Import radius: `10.0 miles`
- Overture release: `2026-07-22.0`

A boundary check against OpenStreetMap polygons placed the farthest Temecula point 9.24 miles from the church and the farthest Murrieta point 9.53 miles away. The same circle includes about 49 percent of the Winchester census-designated place. The circle covers about 314 square miles, so later imports must exclude rural and nonresidential data.

The city GIS references are [Temecula GIS](https://temeculaca.gov/265/Geographic-Information-Systems-GIS) and [Murrieta maps and zoning](https://www.murrietaca.gov/288/Maps-Zoning-Information). The center and boundary measurements used OpenStreetMap data through Nominatim.

## Provider decisions

| Need | Phase 0 choice | Constraint |
|---|---|---|
| Address points and estimated tract counts | [Overture addresses](https://docs.overturemaps.org/guides/addresses/) | The theme is Alpha, does not identify residential addresses, and has unstable IDs. Counts remain estimates. |
| Street geometry | [Overture transportation](https://docs.overturemaps.org/guides/transportation/) | Transportation is ODbL. Printed and interactive maps need attribution. |
| Printed map | Local vector rendering from the saved fixture | No raster tile server, API key, static-map fee, or headless browser is involved. |
| QR code | [Google Maps URL](https://developers.google.com/maps/documentation/urls/get-started) to the first house | The QR opens walking directions to the proposed starting address. |

The July 2026 Overture attribution page lists Riverside County as an address source accessed on July 12, 2026. The county source is public-domain data under California public-records law. The fixture keeps address and ODbL transportation fields separate.

Public Overpass and `tile.openstreetmap.org` are not application dependencies. The [OSM tile policy](https://operations.osmfoundation.org/policies/tiles/) prohibits bulk or offline use and provides no service guarantee. Public Overpass instances also shed load. Streetlight should download pinned open data and render from local vectors.

AI remains out of scope under the founder decision recorded in `PRODUCT.md`.

## Saved fixture

`fixture.json` contains only the local packet proof area:

- 552 deduplicated address points
- 112 road or walking-path segments
- 179,516 bytes
- SHA-256: `66d8eed8a81892ffc083ec5a5e2edf744ac30df867f72b1373b973027a612ff5`

The test church address is committed in this fixture with the founder's permission. Address points are deduplicated by normalized number, street, and postcode. The Overture release and exact source assets are stored in the metadata.

## Rejected prototype output

The deterministic sample is packet `P0-TEM-001`:

- Target: 50 estimated tracts
- Generated: 63 estimated tracts across 5 connected road segments
- Start: `39483 Diego Dr, Temecula, CA 92591`
- End: `39227 Seraphina Rd, Murrieta, CA 92563`
- Streets: Diego Drive and Seraphina Road

The map uses teal squares for estimated homes and orange arrows for walking direction. Internal segment numbers are not printed.

The generated PDF is [streetlight-phase0-sample-packet.pdf](../output/pdf/streetlight-phase0-sample-packet.pdf). The `output` directory is ignored because the file is reproducible.

The founder rejected this packet layout because it invents a walking path and end point instead of showing only the selected street segments and a proposed starting point. The fixture and provider findings remain Phase 0 evidence; the PDF does not.

## Run the proof

```powershell
python -m pip install -r phase0/requirements.txt
python phase0/proof.py
python -m unittest phase0.test_proof -v
```

Refreshing the committed fixture requires network access:

```powershell
python phase0/fetch_fixture.py
```

The current automated check still tests the rejected walking-path and end-point prototype. The revised proof must replace those assertions with checks for whole-segment highlighting, one starting address, no walking path, and no end point.

## Review required after revision

Phase 1 must not begin until the revised PDF passes these checks:

- [ ] Print the PDF on US Letter paper and confirm every field is readable.
- [ ] Scan the QR code on a phone and confirm it opens walking directions to `39483 Diego Dr`.
- [ ] Confirm that every selected segment follows the real road geometry.
- [ ] Confirm that the packet states that each selected segment includes both sides of the street.
- [ ] Confirm that the packet has no proposed walking path, walking order, directional arrows, or end point.
- [ ] Compare the estimated tract count with local knowledge or an on-site check.
- [ ] Approve Overture addresses and transportation as the starting providers, or record what failed.

If the address count is unreliable, the first fallback is the [Riverside County Address Points](https://gisopendata-countyofriverside.opendata.arcgis.com/datasets/CountyofRiverside::address-points/about) service. Do not add a second provider before this review finds a concrete Overture failure.
