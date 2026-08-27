# Territory import performance — August 3, 2026

The founder-approved saved 1.9-mile pilot territory completed a clean production-importer run in
114.5 seconds using the pinned Overture/FEMA sources and deterministic normalizer version 11. The
run used the saved center only at execution time; no address or coordinates are recorded here.

This meets the product target of roughly two minutes for an ordinary one-to-two-mile territory.
It is not a guarantee for dense five-mile territories or slow upstream responses.

The application now persists coarse stage changes (`queued`, street/address download, building
download, matching, preparation, and saving) with timestamps. Import-required saves return a job
immediately, refresh reconnects to it, and the prior saved territory remains authoritative until
the replacement is committed atomically. A failed or interrupted job does not replace saved data.

Verification command:

```powershell
Measure-Command {
  python importer/overture_import.py --longitude <saved-longitude> --latitude <saved-latitude> --radius-miles 1.9
}
```

The complete importer test suite remains the deterministic-output check. Re-run this live benchmark
only when importer performance or upstream source behavior materially changes.