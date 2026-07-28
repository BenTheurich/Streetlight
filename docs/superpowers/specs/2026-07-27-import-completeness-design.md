# Import Completeness Amendment

Status: approved through the founder's July 27, 2026 autonomous-execution delegation

Superseded in part on July 28, 2026 by
[the hidden-road activation design](2026-07-28-hidden-road-activation-design.md). The strict rule
that every street-sized unmatched-address cluster must fail the complete import is replaced by a
broad retained Overture road pool and administrator activation. Its deterministic address-name
inference, atomic replacement, safe error handling, and Hillsdale regression evidence remain
applicable.

## Purpose

Streetlight must not silently omit a residential street because Overture supplies its geometry
without a name. Coverage history, heatmaps, and packet generation all depend on a trustworthy
current segment set, so this is a Phase 2 completion requirement.

The Belmont/Hillsdale example is the binding regression:

- Overture release `2026-06-17.0` contains four unnamed `residential` road features matching
  Hillsdale Heights.
- The address theme contains 29 nearby `HILLSDALE HEIGHTS` records.
- The current importer drops each road before address matching because `names.primary` is absent.

## Founder constraints

- Imported geometry and tract estimates remain read-only.
- Streetlight remains deterministic and AI-free.
- Do not add manual street drawing, geometry correction, or tract-count correction.
- Keep the accepted Overture release. The July 28 amendment expands storage to every Overture
  `road` feature while retaining this document's residential rule for automatic activation.
- A failed quality check must preserve the previously saved territory and import.

## Normalization rule

The importer keeps the current automatic-activation candidate classes:

- Always eligible as residential geometry: `residential`, `living_street`.
- Eligible only after at least one exact-name address match: `primary`, `secondary`, `tertiary`,
  `unclassified`.

Named roads continue through the existing exact canonical-name matcher.

An unnamed `residential` or `living_street` source road may receive an inferred display name when:

1. at least three in-circle Overture address points are within 40 meters of its complete geometry;
2. at least 80 percent of those nearby addresses share one canonical street name; and
3. the winning canonical name has strictly more nearby addresses than the runner-up.

The display name comes from the most common raw spelling for the winning canonical name, normalized
to title case with common street suffixes expanded. Inference happens before connector and turn
splitting so every part of one source road receives the same name.

No road is named from one or two addresses. No non-residential road class is rescued by this rule.

## Address assignment and quality gate

Only address points inside the requested import circle participate in quality metrics. Each address
is assigned to at most one normalized segment:

1. require the same canonical street name;
2. choose the nearest segment within 40 meters;
3. break equal-distance ties by source ID and part index.

After assignment, group unassigned in-circle addresses by canonical street name. Groups remain
visible in diagnostic quality metadata, but they do not reject an otherwise structurally valid
import. The retained hidden-road pool gives the administrator a deterministic recovery path when
automatic name or residential-use evidence is insufficient.

## Import quality metadata

Every successful importer payload carries:

- `normalizerVersion`: exactly `2`;
- `totalAddresses`: in-circle Overture address records considered;
- `assignedAddresses`: unique records assigned to retained segments;
- `inferredRoads`: unnamed source roads named by the consensus rule;
- `unmatchedAddresses`: the remaining one-off address records;
- `unresolvedClusters`: diagnostic count of street-sized unmatched-address groups.

The territory stores the normalizer version and the first four counts with the import footprint.
Legacy imports have no normalizer version, so `needsTerritoryImport` requires one replacement even
when release, center, and radius are unchanged. The setup sidebar shows one
compact line with the assigned/total count and inferred-road count. It does not expose editing
controls or raw addresses.

## Failure and atomicity

A structurally invalid import exits the Python importer nonzero. The API returns a concise safe
message and never exposes a Python traceback. The existing save transaction is never entered. The
editor renders that message while preserving the browser draft, saved territory, prior active and
hidden segment generation, import timestamp, and history references.

## Verification

Automated checks cover:

- the four Hillsdale-shaped unnamed residential roads are inferred from 29 agreeing addresses;
- all 29 addresses are assigned exactly once;
- ambiguous or two-address evidence does not infer a name;
- three unassigned same-street addresses appear in diagnostic metadata without failing an
  otherwise valid import;
- address points outside the requested circle do not affect the gate;
- quality metadata is validated and round-trips through SQLite;
- an import-quality process failure preserves the saved workspace.

The genuine Nicolas Road import must complete with all Overture roads retained as active or hidden
before Phase 3 starts. The resulting map is compared against the Hillsdale screenshot and the
imported quality totals are recorded in `IMPLEMENTATION_PLAN.md`.
