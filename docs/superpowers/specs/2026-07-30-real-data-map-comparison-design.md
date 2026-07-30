# Real-data packet map comparison

## Purpose

Determine whether Streetlight can replace the Google map embedded in its printed
packets without losing the building outlines, house numbers, street readability,
or visual quality that make the current packet useful.

This is a visual research artifact, not a production provider migration.

## Comparison

Render the same existing Temecula pilot street packet in three panels:

1. **Current Google output** — generated through Streetlight's existing Google
   Roads and Google Static Maps packet renderer.
2. **Hosted OpenStreetMap output** — a real Stadia/OpenStreetMap basemap without
   Streetlight-supplied buildings or address labels.
3. **OpenStreetMap plus Overture** — the same open basemap enhanced with real
   Overture building footprints and Overture house-number address points.

Every panel must use the same packet, geographic bounds, output dimensions,
orange selected-street highlights, and starting-point marker. Provider
attribution must remain visible.

## Data integrity

No geography may be invented, approximated for appearance, or produced with an
image generator.

- Read the selected packet, segment geometry, and starting point from the
  existing Streetlight pilot database.
- Generate the Google panel through the existing production packet-map function.
- Request the open basemap from the named provider and record the exact style.
- Retrieve building polygons and address points from Streetlight's pinned
  Overture release for the comparison bounds.
- Display a house number only when the retrieved address record contains one.
- Display a building only when the retrieved Overture feature supplies its
  polygon.
- Record the packet identifier, bounding box, Overture release, providers, and
  retrieval time beside the comparison.

If any source cannot be retrieved or authenticated, show that failure explicitly
instead of substituting mock data.

## Rendering

The Google panel is the visual baseline. The open-data panels should preserve
their providers' native cartography rather than imitate Google's copyrighted
style.

For the enhanced panel:

- Draw Overture buildings with a quiet neutral fill and fine outline.
- Place Overture house numbers at their source coordinates, with conservative
  collision removal so unreadable labels are omitted rather than moved onto the
  wrong property.
- Draw Streetlight's selected road geometry in the existing orange treatment.
- Use the same start marker as closely as each renderer permits.

The first artifact compares only the map area, not the complete packet page.

## Isolation

Do not alter Streetlight's production map renderer, database schema, product
documents, or provider configuration. Store scripts and generated comparison
assets outside production paths. Do not commit credentials, retrieved provider
images, or temporary geographic extracts.

## Validation

Before presenting the comparison:

- Confirm all three panels have identical geographic bounds and pixel dimensions.
- Confirm the highlighted segments and starting point refer to the same database
  packet.
- Count the Overture building polygons and numbered address points inside the
  bounds and display those counts.
- Spot-check at least three rendered buildings and house numbers against the
  retrieved source records.
- Label every panel with its actual provider and data source.

The comparison succeeds if it gives the founder enough truthful visual evidence
to decide whether a hosted open basemap with Overture overlays deserves a
production-quality experiment.
