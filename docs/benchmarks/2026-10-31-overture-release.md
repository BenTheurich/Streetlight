# Overture release validation, October 31, 2026

Streetlight's August release pin expired upstream. New imports now request
`2026-10-21.0` in Python and TypeScript. The normalized process contract remains version 12;
the source change requires no SQL adapter, database migration, or normalization-rule change.

## Source availability and schema

The anonymous AWS listing for August transportation segments returned zero objects. October's
road, address, building, and land-use Parquet schemas were read with the existing DuckDB 1.5.5
runtime. All four production projections remain valid, including spatial conversion and bbox
filters. The complete local import below exercised their returned values through normalization
and the TypeScript boundary validator.

The upstream schema changed from v1.18.0 to v2.0.0:

| Theme | Fields Streetlight consumes | Relevant compatibility findings |
|---|---|---|
| Transportation | ID, names, class, subtype, connectors, geometry, bbox | Connector IDs and fractional `at` positions keep their structure. v2 requires connectors and changes unused route, level, and speed fields. |
| Addresses | ID, number, street, postal city, postcode, unit, address levels, geometry, bbox | `address_levels` remains the actual column. Added source-provenance fields are outside our projection. |
| Buildings | ID, subtype, class, height, floor count, geometry, bbox | The new `shelter` class remains outside the residential whitelist. Changes to the unused level default do not affect the importer. |
| Base land use | ID, names, source tags, class, geometry, bbox | The consumed fields remain compatible. DuckDB returns `source_tags` as a map, already supported by the normalizer. |

Regression checks cover rejection of August process output, August territory metadata requiring
an import on explicit save, all download paths using the pin, map-shaped source tags, and shelters
not increasing home estimates. The shared Python/TypeScript process fixture verifies agreement
between the two release pins. Current-release fixtures were updated together.

October source notices were added to `/map-data.html`. August and June notices remain for
previously saved geography. Base feature IDs changed upstream in September; existing saved
generations, active packet references, and coverage history still use the established atomic
replacement and archival behavior.

Primary sources:

- [October release and schema version](https://docs.overturemaps.org/blog/2026/10/21/release-notes/)
- [September breaking changes and ID changes](https://docs.overturemaps.org/blog/2026/09/23/release-notes/)
- [Transportation v2 changelog](https://github.com/OvertureMaps/schema/blob/v2.0.0/packages/overture-schema-theme-transportation/CHANGELOG.md)
- [Buildings v2 changelog](https://github.com/OvertureMaps/schema/blob/v2.0.0/packages/overture-schema-theme-buildings/CHANGELOG.md)
- [Common v2 changelog](https://github.com/OvertureMaps/schema/blob/v2.0.0/packages/overture-schema-common/CHANGELOG.md)
- [Public release retention policy](https://docs.overturemaps.org/release-calendar/#data-retention-policy)

## Complete importer check

The production Python CLI ran locally at the Calvary church coordinates
`(-117.1164623, 33.5414958)` with a one-mile radius, using anonymous October Overture data and
the public FEMA source. No church database participated.

```powershell
python -m web.importer.overture_import --longitude -117.1164623 --latitude 33.5414958 --radius-miles 1
```

The result contains 1,133 normalized street segments, 4,528 map buildings, and 49 retained
apartment sites. The complete JSON passed `parseOvertureImportOutput` in TypeScript.
The payload reports 4,424 addresses, 3,733 assigned addresses (84.4%), and the existing quality
warnings for unmatched addresses/buildings, unnamed roads, and count disagreements. This check
establishes that the import and process contract work; it does not establish high geographic
confidence for this region or a full four-mile expansion.

## Geographic benchmarks

The five fixed holdouts use freshly downloaded October Overture roads, addresses, and buildings
against the archived fixed NAD reference fixtures. Only the independent references are reused;
August Overture features are not reused. The founder-reviewed FEMA audit uses fresh October
Overture inputs and the existing 50 reviewed candidate footprints.

Both benchmark cache formats now store the Overture release and require an exact match before
reuse. Regression checks reject older and unlabelled caches. This prevents a pin change from
silently testing the previous release's geography.

All five holdouts meet the existing usable-quality floor. None meets every high-confidence
threshold; the benchmark criteria and matching rules were not changed.

| Fixed holdout | Address assignment | Roads represented | Correct road names | Segment-count accuracy | Severe outliers | Download and evaluation |
|---|---:|---:|---:|---:|---:|---:|
| Sacramento suburban | 95.10% | 100% | 98.89% | 93.70% | 5 / 270 | 167 s |
| Boston urban | 98.16% | 100% | 100% | 86.67% | 2 / 90 | 183 s |
| Austin residential | 96.17% | 100% | 94.44% | 98.20% | 0 / 167 | 148 s |
| Lehi newer development | 91.04% | 100% | 92.86% | 96.75% | 0 / 154 | 158 s |
| Ames small city | 94.22% | 100% | 96.77% | 100% | 0 / 113 | 150 s |

Each result is `usable_with_warnings`. Austin was previously high confidence and now misses the
98% road-name threshold: the October source uses `North Mopac Expressway` and
`North Mopac Service Road`, while the fixed NAD reference includes northbound/southbound names
on three road groups. All 54 reference roads remain represented. This is a source-name change,
not a schema parsing failure. The table records the remaining count and matching limitations
without adjusting the thresholds to fit the new release.

The Temecula FEMA audit also passes with fresh October inputs: all 50 reviewed decisions remain
unchanged, with 11 expected footprints selected, zero false positives, and zero false negatives
(100% precision and recall). Download and evaluation took 121 seconds. The audit used 3,630
Overture roads, 15,385 addresses, and 14,500 buildings; it did not reuse August Overture features.

## Application checks and review boundary

The canonical `pnpm check` passed in an isolated source copy: lint, TypeScript, 454 application
tests, four Python-launcher tests, 74 importer tests, and the production build. Migrations and
seed ran against a fresh disposable database. Browser-based tests used an isolated installation
of the pinned Chromium. An independent code review found and resolved the benchmark-cache issue.

The daily preview, production application, live databases, and WorkOS accounts were not changed.
The release pin does not run an import at application startup. A church's next import-required
explicit save uses the new source; failure still preserves its saved territory and history.
Deployment and a live church refresh require separate authorization.

Local raw payload, benchmark helper/results, and check logs are kept under
`tmp/overture-release-20261031/` and are not committed. For later upgrades, run the benchmark with
a release-specific cache directory, such as:

```powershell
python -m web.importer.run_benchmark --area all --cache-dir tmp/benchmark-2026-10-21
```
