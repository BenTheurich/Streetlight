# Packet download performance design

Status: founder approved

Date: 2026-07-31

## Goal

Reduce the wait for packet PDFs without changing their maps, layout, deterministic contents, or
all-or-nothing failure behavior. Make the remaining wait obvious and accessible.

## Measured baseline

A five-packet download takes about 14.7 seconds. The current renderer captures five 1280-by-1280
MapLibre pages serially and creates a fresh browser context for every page, which prevents map
styles, fonts, and nearby tiles from sharing a cache.

Local comparison with the same five packets measured:

- Current cold serial rendering: 13.5 seconds.
- Shared browser context, serial rendering: 9.3 seconds.
- Shared browser context, five concurrent renders: 3.3 seconds.

PDF assembly is not the bottleneck.

## Approved design

The renderer will create one browser context per capture attempt and render at most three packet
maps concurrently within that context. The limit prevents large active-packet downloads from
opening an unbounded number of Chromium pages while still sharing the browser cache and removing
most serial waiting. Output ordering will continue to match packet ordering regardless of which
page finishes first.

The existing complete-capture retry remains unchanged: a failed capture returns no partial PDF and
the renderer retries the complete set once.

While either download is running, the Downloads section will expose an `aria-busy` state and show
one visible, polite status message:

`Preparing 5 packet maps and PDF…`

The number will reflect the selected scope: the newest batch's packet count or the current active
packet count. Both download buttons remain disabled until the request succeeds or fails. Existing
success and recoverable-error messages remain unchanged.

## Verification

- A renderer check proves no more than three captures run at once and that output order remains
  stable when captures finish out of order.
- Component checks cover the packet-count loading message and busy state for both download scopes.
- Existing PDF, retry, workflow, and church-isolation checks remain green.
- Browser verification downloads the seeded five-packet batch, confirms the loading state is
  visible during work, and records the completed time against the 14.7-second baseline.

## Deliberate exclusions

Streetlight will not persist generated PDFs, keep a permanent Chromium process, stream synthetic
percent-complete values, or add a job queue. Those options add storage, lifecycle, or coordination
costs that the pilot does not need.
