"""Build the deterministic Streetlight Phase 0 browser map proof."""

from __future__ import annotations

import base64
import html
import json
import math
import re
from collections import Counter
from pathlib import Path
from string import Template
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
FIXTURE_PATH = Path(__file__).with_name("fixture.json")
DEFAULT_HTML = ROOT / "output" / "phase0" / "map-proof.html"
DEFAULT_MAP = DEFAULT_HTML.with_name("google-static-map.png")
GOOGLE_STATIC_URL = "https://maps.googleapis.com/maps/api/staticmap"
GOOGLE_ROADS_URL = "https://roads.googleapis.com/v1/snapToRoads"

STREET_SUFFIXES = {
    "AVE": "AVENUE",
    "CIR": "CIRCLE",
    "CT": "COURT",
    "DR": "DRIVE",
    "LN": "LANE",
    "PL": "PLACE",
    "PKWY": "PARKWAY",
    "RD": "ROAD",
    "ST": "STREET",
}


def load_fixture(path: Path = FIXTURE_PATH) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def canonical_street(name: str) -> str:
    words = re.sub(r"[^A-Z0-9 ]", " ", name.upper()).split()
    return " ".join(STREET_SUFFIXES.get(word, word) for word in words)


def _xy(lon: float, lat: float, origin_lat: float) -> tuple[float, float]:
    radius_meters = 6_371_000
    return (
        math.radians(lon) * math.cos(math.radians(origin_lat)) * radius_meters,
        math.radians(lat) * radius_meters,
    )


def _point_segment_distance(
    point: tuple[float, float],
    start: tuple[float, float],
    end: tuple[float, float],
) -> float:
    dx, dy = end[0] - start[0], end[1] - start[1]
    if dx == 0 and dy == 0:
        return math.hypot(point[0] - start[0], point[1] - start[1])
    position = max(
        0.0,
        min(
            1.0,
            (
                (point[0] - start[0]) * dx
                + (point[1] - start[1]) * dy
            )
            / (dx * dx + dy * dy),
        ),
    )
    nearest = start[0] + position * dx, start[1] + position * dy
    return math.hypot(point[0] - nearest[0], point[1] - nearest[1])


def point_polyline_distance(
    lon: float, lat: float, coordinates: list[list[float]]
) -> float:
    point = _xy(lon, lat, lat)
    projected = [_xy(item[0], item[1], lat) for item in coordinates]
    return min(
        _point_segment_distance(point, start, end)
        for start, end in zip(projected, projected[1:])
    )


def _turn_degrees(
    before: list[float], vertex: list[float], after: list[float]
) -> float:
    incoming = vertex[0] - before[0], vertex[1] - before[1]
    outgoing = after[0] - vertex[0], after[1] - vertex[1]
    magnitude = math.hypot(*incoming) * math.hypot(*outgoing)
    if magnitude == 0:
        return 0.0
    cosine = max(
        -1.0,
        min(
            1.0,
            (
                incoming[0] * outgoing[0]
                + incoming[1] * outgoing[1]
            )
            / magnitude,
        ),
    )
    return math.degrees(math.acos(cosine))


def split_at_sharp_turns(
    coordinates: list[list[float]], threshold_degrees: float = 85
) -> list[list[list[float]]]:
    parts = []
    start = 0
    for index in range(1, len(coordinates) - 1):
        if (
            _turn_degrees(
                coordinates[index - 1],
                coordinates[index],
                coordinates[index + 1],
            )
            >= threshold_degrees
        ):
            parts.append(coordinates[start : index + 1])
            start = index
    parts.append(coordinates[start:])
    return parts


def _endpoint_key(point: list[float]) -> tuple[float, float]:
    return round(point[0], 6), round(point[1], 6)


def _address_key(address: dict) -> tuple[str, str, str]:
    return (
        str(address["number"]),
        canonical_street(address["street"]),
        address["postcode"],
    )


def _unique_residential_sources(fixture: dict) -> list[dict]:
    unique = {}
    for source in fixture["segments"]:
        if (
            source.get("class") != "residential"
            or not source.get("name")
            or len(source["coordinates"]) < 2
        ):
            continue
        forward = tuple(tuple(point) for point in source["coordinates"])
        reverse = tuple(reversed(forward))
        key = canonical_street(source["name"]), min(forward, reverse)
        if key not in unique or source["id"] < unique[key]["id"]:
            unique[key] = source
    return sorted(unique.values(), key=lambda source: source["id"])


def normalize_segments(fixture: dict) -> list[dict]:
    sources = _unique_residential_sources(fixture)
    network_endpoints = {
        _endpoint_key(coordinates)
        for source in sources
        for coordinates in (
            source["coordinates"][0],
            source["coordinates"][-1],
        )
    }
    normalized = []
    for source in sources:
        coordinates = source["coordinates"]
        cuts = {0, len(coordinates) - 1}
        for index in range(1, len(coordinates) - 1):
            if (
                _endpoint_key(coordinates[index]) in network_endpoints
                or _turn_degrees(
                    coordinates[index - 1],
                    coordinates[index],
                    coordinates[index + 1],
                )
                >= 85
            ):
                cuts.add(index)
        cut_indexes = sorted(cuts)
        for part_index, (start, end) in enumerate(
            zip(cut_indexes, cut_indexes[1:])
        ):
            part = coordinates[start : end + 1]
            source_name = canonical_street(source["name"])
            nearby_names = Counter(
                canonical_street(address["street"])
                for address in fixture["addresses"]
                if point_polyline_distance(
                    address["lon"],
                    address["lat"],
                    part,
                )
                <= 35
            )
            name = source_name
            if nearby_names and max(nearby_names.values()) >= 3:
                # ponytail: three nearby addresses are enough for this proof;
                # Phase 2 provides administrator correction for sparse streets.
                name = sorted(
                    nearby_names,
                    key=lambda candidate: (
                        -nearby_names[candidate],
                        candidate != source_name,
                        candidate,
                    ),
                )[0]
            normalized.append(
                {
                    "id": f"{source['id']}:{part_index}",
                    "source_segment_id": source["id"],
                    "source_name": source_name.title(),
                    "name": name.title(),
                    "coordinates": part,
                    "addresses": [],
                    "estimated_homes": 0,
                    "both_sides": True,
                }
            )

    for address in fixture["addresses"]:
        address_name = canonical_street(address["street"])
        candidates = []
        for segment in normalized:
            if canonical_street(segment["name"]) != address_name:
                continue
            distance = point_polyline_distance(
                address["lon"],
                address["lat"],
                segment["coordinates"],
            )
            if distance <= 40:
                candidates.append((distance, segment["id"], segment))
        if candidates:
            segment = min(candidates, key=lambda item: item[:2])[2]
            segment["addresses"].append(address)
            segment["estimated_homes"] += 1
    return normalized


def _connected_components(segments: list[dict]) -> list[list[dict]]:
    by_node = {}
    by_id = {segment["id"]: segment for segment in segments}
    for segment in segments:
        for point in (
            segment["coordinates"][0],
            segment["coordinates"][-1],
        ):
            by_node.setdefault(_endpoint_key(point), set()).add(segment["id"])
    neighbors = {segment["id"]: set() for segment in segments}
    for ids in by_node.values():
        for segment_id in ids:
            neighbors[segment_id].update(ids - {segment_id})
    components = []
    remaining = set(by_id)
    while remaining:
        todo = [min(remaining)]
        component = []
        while todo:
            segment_id = todo.pop()
            if segment_id not in remaining:
                continue
            remaining.remove(segment_id)
            component.append(by_id[segment_id])
            todo.extend(sorted(neighbors[segment_id], reverse=True))
        components.append(sorted(component, key=lambda segment: segment["id"]))
    return components


def select_named_segments(
    normalized: list[dict],
    street_names: list[str],
) -> list[dict]:
    wanted = {canonical_street(name) for name in street_names}
    candidates = [
        segment
        for segment in normalized
        if canonical_street(segment["name"]) in wanted
    ]
    components = [
        component
        for component in _connected_components(candidates)
        if wanted
        <= {
            canonical_street(segment["name"])
            for segment in component
        }
    ]
    if not components:
        raise ValueError(
            f"No connected normalized component for {sorted(wanted)}"
        )
    return max(
        components,
        key=lambda component: (
            sum(segment["estimated_homes"] for segment in component),
            len(component),
            tuple(segment["id"] for segment in component),
        ),
    )


def chain_coordinates(segments: list[dict]) -> list[list[float]]:
    by_id = {segment["id"]: segment for segment in segments}
    by_node = {}
    for segment in segments:
        for point in (
            segment["coordinates"][0],
            segment["coordinates"][-1],
        ):
            by_node.setdefault(_endpoint_key(point), []).append(segment["id"])
    if any(len(ids) > 2 for ids in by_node.values()):
        # ponytail: Phase 0 samples are chains. Phase 4 can render branched
        # packets as multiple snapped paths if the real selector needs them.
        raise ValueError("Selected normalized segments form a branch")
    start_nodes = sorted(node for node, ids in by_node.items() if len(ids) == 1)
    if not start_nodes:
        raise ValueError("Selected normalized segments do not form an open chain")
    first_source_endpoint = _endpoint_key(
        min(segments, key=lambda segment: segment["id"])["coordinates"][0]
    )
    current = (
        first_source_endpoint
        if first_source_endpoint in start_nodes
        else start_nodes[0]
    )
    unused = set(by_id)
    output = []
    while unused:
        choices = sorted(set(by_node[current]) & unused)
        if not choices:
            raise ValueError("Selected normalized segments are disconnected")
        segment_id = choices[0]
        coordinates = list(by_id[segment_id]["coordinates"])
        if _endpoint_key(coordinates[0]) != current:
            coordinates.reverse()
        output.extend(coordinates if not output else coordinates[1:])
        current = _endpoint_key(coordinates[-1])
        unused.remove(segment_id)
    return output


def _format_address(address: dict) -> str:
    city = "Murrieta" if address["postcode"] == "92563" else "Temecula"
    return (
        f"{address['number']} {address['street'].title()}, "
        f"{city}, CA {address['postcode']}"
    )


def _google_maps_url(address: dict) -> str:
    query = urlencode(
        {
            "api": "1",
            "destination": _format_address(address),
            "travelmode": "walking",
        }
    )
    return f"https://www.google.com/maps/dir/?{query}"


def build_named_map_proof(
    fixture: dict,
    packet_id: str,
    street_names: list[str],
) -> dict:
    selected = select_named_segments(
        normalize_segments(fixture),
        street_names,
    )
    selected_coordinates = chain_coordinates(selected)
    addresses = {
        _address_key(address): address
        for segment in selected
        for address in segment["addresses"]
    }
    start = _choose_start(selected, selected_coordinates)
    return {
        "packet_id": packet_id,
        "sections": selected,
        "selected": selected,
        "normalized_segment_ids": sorted(
            segment["id"] for segment in selected
        ),
        "source_segment_ids": sorted(
            {segment["source_segment_id"] for segment in selected}
        ),
        "selected_coordinates": selected_coordinates,
        "estimated_homes": len(addresses),
        "start": start,
        "start_address": _format_address(start),
        "google_maps_url": _google_maps_url(start),
        "street_names": sorted(
            {
                canonical_street(segment["name"])
                for segment in selected
            }
        ),
        "address_keys": sorted(addresses),
    }


def build_map_proof(fixture: dict) -> dict:
    return build_named_map_proof(
        fixture,
        "P0-TEM-001",
        ["ANDREWS WAY", "DIEGO DRIVE", "JONS PLACE"],
    )


def _coordinate_delta_meters(
    lon_a: float, lat_a: float, lon_b: float, lat_b: float
) -> tuple[float, float]:
    origin_lat = (lat_a + lat_b) / 2
    a = _xy(lon_a, lat_a, origin_lat)
    b = _xy(lon_b, lat_b, origin_lat)
    return a[0] - b[0], a[1] - b[1]


def _qr_data_uri(value: str) -> str:
    from reportlab.graphics import renderSVG

    drawing = _qr_drawing(value, 96)
    svg = renderSVG.drawToString(drawing).encode("utf-8")
    return "data:image/svg+xml;base64," + base64.b64encode(svg).decode("ascii")


def _qr_drawing(value: str, size: float):
    from reportlab.graphics.barcode.qr import QrCodeWidget
    from reportlab.graphics.shapes import Drawing

    widget = QrCodeWidget(value)
    left, bottom, right, top = widget.getBounds()
    scale = size / max(right - left, top - bottom)
    drawing = Drawing(
        size,
        size,
        transform=[scale, 0, 0, scale, -left * scale, -bottom * scale],
    )
    drawing.add(widget)
    return drawing


def load_google_key(path: Path = ROOT / ".env.local") -> str:
    for line in path.read_text(encoding="utf-8").splitlines():
        name, separator, value = line.partition("=")
        if (
            separator
            and name.strip() == "GOOGLE_MAPS_STATIC_API_KEY"
            and value.strip()
        ):
            return value.strip().strip("\"'")
    raise RuntimeError(
        "GOOGLE_MAPS_STATIC_API_KEY is missing from .env.local"
    )


def _nearest_polyline_point(
    lon: float,
    lat: float,
    coordinates: list[list[float]],
) -> tuple[float, float]:
    point = _xy(lon, lat, lat)
    best = None
    for index, (start, end) in enumerate(
        zip(coordinates, coordinates[1:])
    ):
        projected_start = _xy(start[0], start[1], lat)
        projected_end = _xy(end[0], end[1], lat)
        dx = projected_end[0] - projected_start[0]
        dy = projected_end[1] - projected_start[1]
        denominator = dx * dx + dy * dy
        position = (
            0
            if denominator == 0
            else max(
                0,
                min(
                    1,
                    (
                        (point[0] - projected_start[0]) * dx
                        + (point[1] - projected_start[1]) * dy
                    )
                    / denominator,
                ),
            )
        )
        candidate = (
            start[0] + position * (end[0] - start[0]),
            start[1] + position * (end[1] - start[1]),
        )
        distance = math.hypot(
            *_coordinate_delta_meters(lon, lat, *candidate)
        )
        if best is None or (distance, index) < best[:2]:
            best = distance, index, candidate
    if best is None:
        raise ValueError("Cannot place a start pin on empty geometry")
    return best[2]


def _choose_start(
    selected: list[dict],
    coordinates: list[list[float]],
) -> dict:
    endpoints = coordinates[0], coordinates[-1]
    candidates = []
    for endpoint in endpoints:
        terminal = next(
            segment
            for segment in selected
            if _endpoint_key(segment["coordinates"][0])
            == _endpoint_key(endpoint)
            or _endpoint_key(segment["coordinates"][-1])
            == _endpoint_key(endpoint)
        )
        for address in terminal["addresses"]:
            road_point = _nearest_polyline_point(
                address["lon"],
                address["lat"],
                terminal["coordinates"],
            )
            distance = math.hypot(
                *_coordinate_delta_meters(
                    address["lon"],
                    address["lat"],
                    endpoint[0],
                    endpoint[1],
                )
            )
            candidates.append(
                (
                    address["lat"] <= road_point[1],
                    distance,
                    _address_key(address),
                    address,
                )
            )
    if not candidates:
        raise ValueError("Selected terminal segments have no starting address")
    return min(candidates, key=lambda candidate: candidate[:3])[3]


def static_map_params(
    proof: dict,
    coordinates: list[list[float]] | None = None,
) -> list[tuple[str, str]]:
    coordinates = coordinates or proof["selected_coordinates"]
    path = "|".join(
        f"{lat:.7f},{lon:.7f}"
        for lon, lat in coordinates
    )
    return [
        ("size", "640x640"),
        ("scale", "2"),
        ("format", "png"),
        ("maptype", "roadmap"),
        ("language", "en"),
        ("region", "us"),
        ("path", f"color:0xef6c3599|weight:6|{path}"),
        (
            "markers",
            (
                f"color:0x087f5b|"
                f"{proof['start']['lat']:.7f},{proof['start']['lon']:.7f}"
            ),
        ),
    ]


def roads_params(coordinates: list[list[float]]) -> list[tuple[str, str]]:
    path = "|".join(
        f"{lat:.7f},{lon:.7f}" for lon, lat in coordinates
    )
    return [("interpolate", "true"), ("path", path)]


def parse_snapped_coordinates(payload: dict) -> list[list[float]]:
    points = payload.get("snappedPoints") or []
    coordinates = [
        [
            point["location"]["longitude"],
            point["location"]["latitude"],
        ]
        for point in points
    ]
    if len(coordinates) < 2:
        raise RuntimeError("Google Roads returned no usable snapped path")
    return coordinates


def snap_to_roads(
    coordinates: list[list[float]],
    key: str,
) -> list[list[float]]:
    query = urlencode(
        roads_params(coordinates) + [("key", key)],
        safe=":,|",
    )
    request = Request(
        f"{GOOGLE_ROADS_URL}?{query}",
        headers={"User-Agent": "Streetlight phase-0 proof"},
    )
    try:
        with urlopen(request, timeout=30) as response:
            payload = json.loads(response.read())
    except HTTPError as error:
        raise RuntimeError(
            f"Google Roads API returned HTTP {error.code}; "
            "confirm that Roads API is enabled for this key"
        ) from None
    except (URLError, json.JSONDecodeError):
        raise RuntimeError("Could not read Google Roads API response") from None
    return parse_snapped_coordinates(payload)


def fetch_static_map(
    proof: dict,
    key: str,
    coordinates: list[list[float]] | None = None,
    output: Path = DEFAULT_MAP,
) -> Path:
    query = urlencode(
        static_map_params(proof, coordinates) + [("key", key)],
        safe=":,|",
    )
    request = Request(
        f"{GOOGLE_STATIC_URL}?{query}",
        headers={"User-Agent": "Streetlight phase-0 proof"},
    )
    try:
        with urlopen(request, timeout=30) as response:
            image = response.read()
            content_type = response.headers.get_content_type()
    except HTTPError as error:
        raise RuntimeError(
            f"Google Static Maps returned HTTP {error.code}"
        ) from None
    except URLError:
        raise RuntimeError("Could not reach Google Static Maps") from None
    if content_type != "image/png" or not image.startswith(b"\x89PNG\r\n\x1a\n"):
        raise RuntimeError("Google Static Maps did not return a PNG image")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(image)
    return output


HTML_TEMPLATE = Template(
    """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Streetlight Phase 0 map proof</title>
  <link rel="icon" href="data:,">
  <style>
    * { box-sizing: border-box; }
    html, body { min-width: 100%; min-height: 100%; margin: 0; }
    body {
      color: #312c26;
      background: #dedbd5;
      font-family: Arial, sans-serif;
    }
    .packet {
      position: relative;
      width: min(816px, 100vw);
      min-height: 100vh;
      margin: 0 auto;
      padding: 18px 18px 48px;
      background: #fffdfa;
    }
    .packet-bar {
      display: grid;
      grid-template-columns: auto auto 1fr;
      gap: 18px 28px;
      align-items: center;
      min-height: 108px;
      padding: 0 4px 14px;
    }
    .field { display: grid; gap: 3px; }
    .label {
      color: #746d64;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: .08em;
      text-transform: uppercase;
    }
    .value { font-size: 15px; font-weight: 700; }
    .count { font-size: 24px; }
    .destination {
      display: flex;
      justify-self: end;
      align-items: center;
      gap: 12px;
      min-width: 0;
    }
    .qr { width: 82px; height: 82px; flex: 0 0 82px; }
    .map {
      position: relative;
      width: 100%;
      aspect-ratio: 1;
      overflow: hidden;
      border: 1px solid #d7d1c8;
      background: #eee;
    }
    .map img {
      display: block;
      width: 100%;
      height: 100%;
    }
    .brand {
      position: absolute;
      left: 18px;
      bottom: 16px;
      color: #312c26;
      font-size: 13px;
      font-weight: 800;
      letter-spacing: .04em;
    }
    @media (max-width: 650px) {
      .packet { padding: 10px; }
      .packet-bar {
        grid-template-columns: 1fr 1fr;
        gap: 10px 18px;
      }
      .destination { grid-column: 1 / -1; justify-self: stretch; }
      .qr { width: 68px; height: 68px; flex-basis: 68px; }
    }
  </style>
</head>
<body>
  <main class="packet">
    <header class="packet-bar">
      <div class="field">
        <span class="label">Packet</span>
        <span class="value">$packet_id</span>
      </div>
      <div class="field">
        <span class="label">Estimated homes</span>
        <span class="value count">$estimated_homes</span>
      </div>
      <div class="destination">
        <div class="field">
          <span class="label">Starting address</span>
          <span class="value">$start_address</span>
        </div>
        <img class="qr" src="$qr_data_uri" alt="Google Maps directions to $start_address">
      </div>
    </header>
    <section class="map" aria-label="Selected outreach streets">
      <img src="$map_filename" alt="Google map with the selected outreach streets highlighted">
    </section>
    <div class="brand">STREETLIGHT</div>
  </main>
</body>
</html>
"""
)


def render_html(
    proof: dict,
    output: Path = DEFAULT_HTML,
    map_filename: str = "google-static-map.png",
) -> Path:
    page = HTML_TEMPLATE.substitute(
        packet_id=html.escape(proof["packet_id"]),
        start_address=html.escape(proof["start_address"]),
        estimated_homes=proof["estimated_homes"],
        qr_data_uri=_qr_data_uri(proof["google_maps_url"]),
        map_filename=html.escape(map_filename),
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(page, encoding="utf-8")
    return output


def render_pdf(
    proof: dict,
    map_path: Path,
    output: Path,
) -> Path:
    from reportlab.graphics import renderPDF
    from reportlab.lib.colors import HexColor
    from reportlab.lib.pagesizes import letter
    from reportlab.pdfbase.pdfmetrics import stringWidth
    from reportlab.pdfgen.canvas import Canvas

    output.parent.mkdir(parents=True, exist_ok=True)
    canvas = Canvas(str(output), pagesize=letter, pageCompression=1)
    canvas.setTitle(f"Streetlight packet {proof['packet_id']}")

    ink = HexColor("#312c26")
    muted = HexColor("#746d64")
    border = HexColor("#d7d1c8")
    panel = HexColor("#f7f3ec")
    map_x = 15
    map_y = 70
    map_size = 582
    label_y = 752
    value_y = 722

    canvas.setFillColor(panel)
    canvas.setStrokeColor(border)
    canvas.setLineWidth(0.5)
    canvas.roundRect(304, 664, 293, 112, 6, stroke=1, fill=1)

    canvas.setFillColor(muted)
    canvas.setFont("Helvetica-Bold", 9)
    canvas.drawString(22, label_y, "ESTIMATED HOMES / TRACTS")
    canvas.setFont("Helvetica-Bold", 8)
    canvas.drawString(318, label_y, "STARTING ADDRESS")

    canvas.setFillColor(ink)
    canvas.setFont("Helvetica-Bold", 38)
    canvas.drawString(22, value_y - 18, str(proof["estimated_homes"]))

    address = proof["start_address"]
    street, separator, locality = address.partition(", ")
    canvas.setFont("Helvetica-Bold", 12)
    canvas.drawString(318, 724, street)
    if separator:
        canvas.setFont("Helvetica-Bold", 10.5)
        canvas.drawString(318, 705, locality)

    canvas.setFillColor(HexColor("#ffffff"))
    canvas.roundRect(497, 681, 94, 94, 4, stroke=0, fill=1)
    renderPDF.draw(
        _qr_drawing(proof["google_maps_url"], 86),
        canvas,
        501,
        685,
    )
    canvas.setFillColor(muted)
    canvas.setFont("Helvetica-Bold", 7.2)
    canvas.drawCentredString(544, 671, "SCAN FOR DIRECTIONS")

    canvas.drawImage(
        str(map_path),
        map_x,
        map_y,
        width=map_size,
        height=map_size,
        preserveAspectRatio=True,
        mask="auto",
    )
    canvas.setStrokeColor(border)
    canvas.setLineWidth(0.5)
    canvas.rect(map_x, map_y, map_size, map_size, stroke=1, fill=0)

    canvas.setFillColor(ink)
    canvas.setFont("Helvetica-Bold", 9)
    canvas.drawString(15, 34, "STREETLIGHT")
    packet_code = proof["packet_id"]
    canvas.setFont("Helvetica-Bold", 9.5)
    canvas.drawRightString(597, 34, packet_code)
    code_width = stringWidth(packet_code, "Helvetica-Bold", 9.5)
    canvas.setFillColor(muted)
    canvas.setFont("Helvetica-Bold", 7)
    canvas.drawRightString(597 - code_width - 8, 34, "PACKET")

    canvas.showPage()
    canvas.save()
    return output


def main() -> None:
    fixture = load_fixture()
    proof = build_map_proof(fixture)
    key = load_google_key()
    snapped_coordinates = snap_to_roads(
        proof["selected_coordinates"],
        key,
    )
    map_output = fetch_static_map(
        proof,
        key,
        snapped_coordinates,
    )
    output = render_html(proof)
    section_summary = ", ".join(
        f"{section['name']} ({section['estimated_homes']})"
        for section in proof["sections"]
    )
    print(f"Normalized source segment into: {section_summary}")
    print(
        "Google Roads snapped "
        f"{len(proof['selected_coordinates'])} source points to "
        f"{len(snapped_coordinates)} display points"
    )
    print(f"Wrote {map_output}")
    print(f"Wrote {output}")
    print(f"Start: {proof['start_address']}")
    print(f"QR: {proof['google_maps_url']}")


if __name__ == "__main__":
    main()
