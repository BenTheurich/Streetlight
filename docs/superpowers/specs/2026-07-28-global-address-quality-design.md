# Streetlight global address-quality design

Status: founder approved  
Approved: July 28, 2026

## Purpose

Streetlight's packet sizes depend on credible street names and residential home estimates. The
current importer rejects an address unless its canonical street name exactly matches an imported
road, even when that address is spatially associated with an obvious residential road. This leaves
too many usable addresses unmatched and can produce implausible segment estimates.

Streetlight must improve those estimates without county-by-county production integrations, routine
administrator correction, Google-data scraping, or AI. The same deterministic import must work
nationwide and, where Overture coverage permits, globally.

## Approved source direction

The first implementation continues using one pinned Overture release and imports:

- transportation segments for road identity and geometry;
- address points for street names, starting addresses, and primary home evidence; and
- building footprints as a bounded fallback for missing residential addresses.

Streetlight does not add regional production providers. Authoritative local datasets may be used
as test references when measuring the global pipeline, but they do not become runtime dependencies.

Google remains the interactive and printed map provider. Streetlight does not scrape labels or
house numbers from the Google basemap, enumerate addresses through unsupported sampling, or store
restricted Google geocoding content as its canonical database.

If the approved global pipeline cannot pass its benchmark, the next investigation is a licensed
commercial nationwide or global dataset. Do not keep adding unmeasured heuristics.

## Deterministic address assignment

Each usable address is assigned at most once.

1. Prefer a nearby plausible road whose canonical street name matches the address.
2. For an otherwise unmatched address, consider nearby plausible residential roads spatially.
3. Treat name agreement as strong evidence, not a mandatory condition.
4. Assign a spatial-only candidate only when it is unambiguous under the pinned normalizer's
   distance and tie rules.
5. Keep genuinely ambiguous addresses unmatched rather than silently assigning them across an
   intersection or to a parallel road.

The benchmark determines the smallest safe spatial thresholds. Once accepted, those thresholds and
tie rules are deterministic and versioned with the normalizer.

Nearby assigned address evidence may resolve an imported road with no name when one street name
clearly dominates. Ambiguous name evidence leaves the road unnamed. This extends the existing
address-consensus behavior; it does not call Google or another provider while the administrator
clicks the map.

## Home estimates

A segment estimate begins with its unique assigned address points. The importer does not retain
resident names, household notes, or unit identifiers.

An Overture building contributes one fallback home only when:

- its source classification clearly identifies a residential dwelling;
- no assigned address already accounts for that building; and
- it can be assigned unambiguously to a plausible residential road.

Unknown buildings, garages, sheds, commercial buildings, and other non-residential structures do
not contribute fallback homes. A building footprint never supplies an apartment-unit estimate.
This is a conservative missing-address fallback, not a second unrestricted count added on top of
the address data.

Normalization still retains every assigned address and caps normalized segments at 100 estimated
homes. Administrators cannot edit imported geometry or home counts.

## Reliability benchmark

The normalizer is not considered reliable merely because its output looks plausible in one
neighborhood. Verification uses five varied US test territories covering suburban, urban, rural,
and newer-development patterns across multiple states.

Authoritative local records may serve as test oracles for those fixed fixtures. This does not add a
local provider to the production import.

An accepted normalizer must demonstrate:

- at least 95 percent of usable imported address points assigned;
- at least 99 percent of known residential roads represented;
- at least 98 percent of populated roads carrying the correct name;
- at least 90 percent of sampled single-family segments within 20 percent or three homes of the
  reference count, whichever tolerance is larger; and
- every segment wrong by more than 50 percent or ten homes automatically identified as
  low-confidence.

The benchmark runs again whenever the normalizer rules change or Streetlight adopts a new pinned
Overture release.

Run it from `web` with:

```powershell
python -m pip install -r importer/requirements.txt
python -m importer.run_benchmark --area all
```

The command prints each literal rate, severe-outlier count, and failed metric name. Its process
exits unsuccessfully when any territory fails.

## Territory quality and warning behavior

Streetlight stores the Overture release, normalizer version, import counts, and concrete quality
failures with the territory import. It does not reduce those facts to an unexplained confidence
score.

A territory is low-confidence when its import fails an accepted quality check, including unusually
low address assignment, populated roads with inadequate count evidence, material disagreement
between addresses and high-confidence residential buildings, or unresolved populated street
names.

Low confidence does not block packet generation. Streetlight:

- shows a persistent, prominent warning in Territory Setup and Generate Packets;
- states the concrete reason or reasons;
- allows the administrator to continue without another confirmation modal;
- keeps the warning out of volunteer packet PDFs; and
- removes it only after a later successful import passes the checks.

The warning is informational. Version one does not turn it into an administrator data-cleanup
workflow.

## Scope boundaries

This design does not add:

- county-by-county or city-by-city production imports;
- manual street-name, geometry, or home-count correction;
- individual household editing;
- Google basemap scraping or bulk address discovery;
- AI classification or estimation;
- an opaque machine-learned confidence score; or
- a commercial provider before the global pipeline is benchmarked.

## Acceptance criteria

Implementation verification must prove:

- exact-name matches retain their current deterministic preference;
- a clearly nearest residential road can receive an otherwise unmatched address;
- an ambiguous intersection or parallel-road case remains unmatched;
- each address and residential building contributes at most once;
- addressed buildings do not receive a second fallback home;
- non-residential and unknown buildings do not contribute fallback homes;
- accepted address evidence can resolve a missing road name without changing road geometry;
- identical source data and normalizer versions produce identical results;
- benchmark failures name the failed metric;
- a low-confidence territory shows the warning in both administrator tools;
- the warning does not block generation or appear on PDFs; and
- a later passing import clears the warning.

## Completion condition

The global Overture pipeline passes the approved multi-territory benchmark and the founder confirms
that the previously implausible pilot-area names and estimates are credible. If it cannot pass,
Streetlight stops heuristic expansion and evaluates a licensed commercial dataset.
