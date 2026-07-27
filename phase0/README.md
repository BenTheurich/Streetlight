# Phase 0 geographic and print proof

Status: **Awaiting human review**

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
| Streets and walking paths | [Overture transportation](https://docs.overturemaps.org/guides/transportation/) | Transportation is ODbL. Printed and interactive maps need attribution. |
| Printed map | Local vector rendering from the saved fixture | No raster tile server, API key, static-map fee, or headless browser is involved. |
| QR code | [Google Maps URL](https://developers.google.com/maps/documentation/urls/get-started) to the first house | The QR opens walking directions to the start. The printed route remains authoritative. |

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

## Proof result

The deterministic sample is packet `P0-TEM-001`:

- Target: 50 estimated tracts
- Generated: 63 estimated tracts across 6 complete road segments
- Start: `39654 Diego Dr, Temecula, CA 92591`
- End: `39227 Seraphina Rd, Murrieta, CA 92563`
- Streets: Diego Drive and Seraphina Road

The generated PDF is [streetlight-phase0-sample-packet.pdf](../output/pdf/streetlight-phase0-sample-packet.pdf). The `output` directory is ignored because the file is reproducible.

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

The automated check covers deterministic packet selection, nonnegative counts, route coordinates inside the 10-mile area, start and end membership, the exact Google Maps URL, required PDF text, and the one-page limit.

## Human review

Phase 1 must not begin until a person checks:

- [ ] Print the PDF on US Letter paper and confirm every field is readable.
- [ ] Scan the QR code on a phone and confirm it opens walking directions to `39654 Diego Dr`.
- [ ] Compare the marked Diego Drive and Seraphina Road homes with local knowledge or an on-site check.
- [ ] Confirm that route segments 1 through 6 make sense as one volunteer assignment, including any backtracking.
- [ ] Approve Overture addresses and transportation as the starting providers, or record what failed.

If the address count is unreliable, the first fallback is the [Riverside County Address Points](https://gisopendata-countyofriverside.opendata.arcgis.com/datasets/CountyofRiverside::address-points/about) service. Do not add a second provider before this review finds a concrete Overture failure.
