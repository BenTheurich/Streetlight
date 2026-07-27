# Import Completeness Amendment

Status: approved through the founder's July 27, 2026 autonomous-execution delegation

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
- Keep the accepted Overture release and residential-road scope.
- A failed quality check must preserve the previously saved territory and import.

## Normalization rule

The importer keeps the current candidate road classes:

- Always eligible as residential geometry: `residential`, `living_street`.
- Eligible only after at least one exact-name address match: `primary`, `secondary`, `tertiary`,
  `unclassified`.

Named roads continue through the existing exact canonical-name matcher.

An unnamed `residential` or `living_street` source road may receive an inferred display name when:

1. at least three in-circle Overture address points are within 40 meters of its complete geometry;
2. at least 80 percent of those nearby addresses share one canonical street name; and
3. the winning canonical name is unique after deterministic count and lexical ordering.

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

After assignment, group unassigned in-circle addresses by canonical street name. A group of three
or more is an unresolved street-sized cluster. Any unresolved cluster fails the import before the
database transaction begins. The error names each unresolved street and its address count so the
source rule can be diagnosed; Streetlight never presents that import as complete.

One or two unmatched addresses remain visible in quality totals but do not block the import. They
are too weak a signal to infer a road or reject an otherwise usable territory.

## Import quality metadata

Every successful importer payload carries:

- `totalAddresses`: in-circle Overture address records considered;
- `assignedAddresses`: unique records assigned to retained segments;
- `inferredRoads`: unnamed source roads named by the consensus rule;
- `unmatchedAddresses`: the remaining one-off address records;
- `unresolvedClusters`: always zero for a successful payload.

The territory stores the first four counts with the import footprint. The setup sidebar shows one
compact line with the assigned/total count and inferred-road count. It does not expose editing
controls or raw addresses.

## Failure and atomicity

An import-quality failure exits the Python importer nonzero. The existing Node process boundary
surfaces the concise error, and the existing save transaction is never entered. The browser draft,
saved territory, prior segment generation, import timestamp, and history references remain intact.

## Verification

Automated checks cover:

- the four Hillsdale-shaped unnamed residential roads are inferred from 29 agreeing addresses;
- all 29 addresses are assigned exactly once;
- ambiguous or two-address evidence does not infer a name;
- three unassigned same-street addresses fail normalization;
- address points outside the requested circle do not affect the gate;
- quality metadata is validated and round-trips through SQLite;
- an import-quality process failure preserves the saved workspace.

The genuine Nicolas Road import must complete with zero unresolved clusters before Phase 3 starts.
The resulting map is compared against the Hillsdale screenshot and the imported quality totals are
recorded in `IMPLEMENTATION_PLAN.md`.

