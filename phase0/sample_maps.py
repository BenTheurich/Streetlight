"""Render several non-overlapping Phase 0 packet-map samples."""

from __future__ import annotations

import html
from pathlib import Path
from string import Template

from phase0.proof import (
    ROOT,
    build_map_proof,
    build_named_map_proof,
    fetch_static_map,
    load_fixture,
    load_google_key,
    render_html,
    render_pdf,
    snap_to_roads,
)

OUTPUT = ROOT / "output" / "phase0"
SAMPLES = OUTPUT / "samples"
GALLERY = OUTPUT / "sample-gallery.html"
PDFS = ROOT / "output" / "pdf"

SPECS = [
    {
        "packet_id": "P0-TEM-002",
        "street_names": ["SUGARCANE DRIVE"],
    },
    {
        "packet_id": "P0-TEM-003",
        "street_names": ["SHREE ROAD", "SONIA LANE"],
    },
    {
        "packet_id": "P0-TEM-004",
        "street_names": ["SKYLINE DRIVE"],
    },
]


def build_sample_proofs(fixture: dict) -> list[dict]:
    return [build_map_proof(fixture)] + [
        build_named_map_proof(
            fixture,
            spec["packet_id"],
            spec["street_names"],
        )
        for spec in SPECS
    ]


def assert_non_overlapping(proofs: list[dict]) -> None:
    used_segments = set()
    used_addresses = set()
    for proof in proofs:
        segments = set(proof["normalized_segment_ids"])
        addresses = set(map(tuple, proof["address_keys"]))
        if used_segments & segments:
            raise ValueError(
                f"{proof['packet_id']} repeats a normalized street segment"
            )
        if used_addresses & addresses:
            raise ValueError(f"{proof['packet_id']} repeats an address")
        used_segments.update(segments)
        used_addresses.update(addresses)


GALLERY_TEMPLATE = Template(
    """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Streetlight Phase 0 sample maps</title>
  <link rel="icon" href="data:,">
  <style>
    * { box-sizing: border-box; }
    body {
      max-width: 1320px;
      margin: 0 auto;
      padding: 28px;
      color: #312c26;
      background: #f3f0ea;
      font-family: Arial, sans-serif;
    }
    h1 { margin: 0 0 8px; font-size: 26px; }
    .note { margin: 0 0 24px; color: #665f56; }
    .grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 24px;
    }
    .card {
      overflow: hidden;
      color: inherit;
      background: white;
      border: 1px solid #d7d1c8;
      text-decoration: none;
    }
    .meta { padding: 14px 16px 12px; }
    .packet { font-size: 16px; font-weight: 800; }
    .details { margin-top: 4px; color: #665f56; font-size: 13px; }
    img { display: block; width: 100%; height: auto; }
    @media (max-width: 800px) {
      body { padding: 14px; }
      .grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <h1>Neighboring packet-map proof</h1>
  <p class="note">Four packets · no shared normalized segments or address points</p>
  <main class="grid">$cards</main>
</body>
</html>
"""
)


def render_gallery(proofs: list[dict]) -> Path:
    cards = []
    for proof in proofs:
        slug = proof["packet_id"].lower()
        packet_id = html.escape(proof["packet_id"])
        street_names = ", ".join(
            name.title() for name in proof["street_names"]
        )
        cards.append(
            f"""<a class="card" href="samples/{slug}.html">
  <div class="meta">
    <div class="packet">{packet_id}</div>
    <div class="details">{html.escape(street_names)} · {proof["estimated_homes"]} estimated homes</div>
  </div>
  <img src="samples/{slug}.png" alt="{packet_id} map">
</a>"""
        )
    GALLERY.parent.mkdir(parents=True, exist_ok=True)
    GALLERY.write_text(
        GALLERY_TEMPLATE.substitute(cards="\n".join(cards)),
        encoding="utf-8",
    )
    return GALLERY


def main() -> None:
    proofs = build_sample_proofs(load_fixture())
    assert_non_overlapping(proofs)
    key = load_google_key()
    for proof in proofs:
        slug = proof["packet_id"].lower()
        snapped = snap_to_roads(proof["selected_coordinates"], key)
        map_path = fetch_static_map(
            proof,
            key,
            snapped,
            SAMPLES / f"{slug}.png",
        )
        render_html(
            proof,
            SAMPLES / f"{slug}.html",
            f"{slug}.png",
        )
        pdf_path = render_pdf(
            proof,
            map_path,
            PDFS / f"streetlight-{slug}.pdf",
        )
        print(
            f"{proof['packet_id']}: {proof['estimated_homes']} homes, "
            f"{len(proof['selected_coordinates'])} source points, "
            f"{len(snapped)} snapped points, wrote {pdf_path}"
        )
    print(f"Wrote {render_gallery(proofs)}")


if __name__ == "__main__":
    main()
