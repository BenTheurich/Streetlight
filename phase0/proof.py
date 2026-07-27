"""Build the deterministic Streetlight Phase 0 outreach packet."""

from __future__ import annotations

import json
import math
import re
from collections import defaultdict
from pathlib import Path
from urllib.parse import urlencode

ROOT = Path(__file__).resolve().parents[1]
FIXTURE_PATH = Path(__file__).with_name("fixture.json")
DEFAULT_PDF = ROOT / "output" / "pdf" / "streetlight-phase0-sample-packet.pdf"

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
    return lon * math.cos(math.radians(origin_lat)), lat


def _point_segment_distance2(
    point: tuple[float, float],
    start: tuple[float, float],
    end: tuple[float, float],
) -> float:
    px, py = point
    ax, ay = start
    bx, by = end
    dx, dy = bx - ax, by - ay
    if dx == 0 and dy == 0:
        return (px - ax) ** 2 + (py - ay) ** 2
    position = max(
        0.0,
        min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)),
    )
    nearest = ax + position * dx, ay + position * dy
    return (px - nearest[0]) ** 2 + (py - nearest[1]) ** 2


def _point_polyline_distance2(
    address: dict, coordinates: list[list[float]]
) -> float:
    origin_lat = address["lat"]
    point = _xy(address["lon"], address["lat"], origin_lat)
    projected = [_xy(lon, lat, origin_lat) for lon, lat in coordinates]
    return min(
        _point_segment_distance2(point, start, end)
        for start, end in zip(projected, projected[1:])
    )


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


def build_packet(fixture: dict) -> dict:
    metadata = fixture["metadata"]
    route_order = {
        canonical_street(name): index
        for index, name in enumerate(metadata["route_streets"])
    }
    route_segments = [
        segment
        for segment in fixture["segments"]
        if segment["name"]
        and canonical_street(segment["name"]) in route_order
    ]
    route_segments.sort(
        key=lambda segment: (
            route_order[canonical_street(segment["name"])],
            min(point[1] for point in segment["coordinates"]),
            segment["id"],
        )
    )

    by_street: dict[str, list[dict]] = defaultdict(list)
    for segment in route_segments:
        by_street[canonical_street(segment["name"])].append(segment)

    assigned: dict[str, list[dict]] = defaultdict(list)
    for address in fixture["addresses"]:
        candidates = by_street.get(canonical_street(address["street"]), [])
        if not candidates:
            continue
        nearest = min(
            candidates,
            key=lambda segment: _point_polyline_distance2(
                address, segment["coordinates"]
            ),
        )
        assigned[nearest["id"]].append(address)

    selected_segments = []
    selected_addresses = []
    target = metadata["packet_target_homes"]
    for segment in route_segments:
        segment_addresses = assigned[segment["id"]]
        selected_segments.append(segment)
        selected_addresses.extend(segment_addresses)
        if len(selected_addresses) >= target:
            break

    selected_addresses.sort(
        key=lambda address: (address["lat"], address["lon"], address["number"])
    )
    start = selected_addresses[0]
    end = selected_addresses[-1]

    ranges = []
    for street in metadata["route_streets"]:
        matching = [
            address
            for address in selected_addresses
            if canonical_street(address["street"]) == canonical_street(street)
        ]
        if not matching:
            continue
        numbers = sorted(
            int(address["number"])
            for address in matching
            if address["number"].isdigit()
        )
        ranges.append(
            {
                "street": street,
                "first": numbers[0],
                "last": numbers[-1],
                "homes": len(matching),
            }
        )

    return {
        "packet_id": "P0-TEM-001",
        "batch_name": "Temecula Phase 0 Proof",
        "target_homes": target,
        "estimated_homes": len(selected_addresses),
        "segments": selected_segments,
        "addresses": selected_addresses,
        "start": start,
        "end": end,
        "start_address": _format_address(start),
        "end_address": _format_address(end),
        "google_maps_url": _google_maps_url(start),
        "street_ranges": ranges,
        "attribution": metadata["attribution"],
    }


def _draw_qr(canvas, value: str, x: float, y: float, size: float) -> None:
    from reportlab.graphics import renderPDF
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
    renderPDF.draw(drawing, canvas, x, y)


def _draw_map(canvas, fixture: dict, packet: dict, box: tuple[float, ...]) -> None:
    from reportlab.lib import colors
    from reportlab.pdfbase.pdfmetrics import stringWidth

    x, y, width, height = box
    route_coordinates = [
        point
        for segment in packet["segments"]
        for point in segment["coordinates"]
    ]
    route_coordinates += [
        [address["lon"], address["lat"]] for address in packet["addresses"]
    ]
    min_lon = min(point[0] for point in route_coordinates) - 0.0013
    max_lon = max(point[0] for point in route_coordinates) + 0.0013
    min_lat = min(point[1] for point in route_coordinates) - 0.0008
    max_lat = max(point[1] for point in route_coordinates) + 0.0008
    mean_lat = (min_lat + max_lat) / 2
    lon_scale = math.cos(math.radians(mean_lat))
    data_width = (max_lon - min_lon) * lon_scale
    data_height = max_lat - min_lat
    scale = min((width - 20) / data_width, (height - 20) / data_height)
    x_offset = x + (width - data_width * scale) / 2
    y_offset = y + (height - data_height * scale) / 2

    def project(point: list[float]) -> tuple[float, float]:
        lon, lat = point
        return (
            x_offset + (lon - min_lon) * lon_scale * scale,
            y_offset + (lat - min_lat) * scale,
        )

    canvas.setFillColor(colors.HexColor("#F7F4EC"))
    canvas.roundRect(x, y, width, height, 8, fill=1, stroke=0)
    clip = canvas.beginPath()
    clip.roundRect(x, y, width, height, 8)
    canvas.saveState()
    canvas.clipPath(clip, stroke=0, fill=0)

    selected_ids = {segment["id"] for segment in packet["segments"]}
    for segment in fixture["segments"]:
        if segment["id"] in selected_ids:
            continue
        road_class = segment["class"]
        if road_class in {"footway", "path", "cycleway"}:
            canvas.setStrokeColor(colors.HexColor("#B5C9B1"))
            canvas.setLineWidth(0.8)
            canvas.setDash(2, 2)
        else:
            canvas.setStrokeColor(colors.HexColor("#D1CEC4"))
            canvas.setLineWidth(
                2.2 if road_class in {"secondary", "tertiary"} else 1.2
            )
            canvas.setDash()
        points = [project(point) for point in segment["coordinates"]]
        path = canvas.beginPath()
        path.moveTo(*points[0])
        for point in points[1:]:
            path.lineTo(*point)
        canvas.drawPath(path, stroke=1, fill=0)

    for address in packet["addresses"]:
        px, py = project([address["lon"], address["lat"]])
        canvas.setFillColor(colors.HexColor("#4E4B45"))
        canvas.circle(px, py, 1.25, fill=1, stroke=0)

    for number, segment in enumerate(packet["segments"], start=1):
        points = [project(point) for point in segment["coordinates"]]
        path = canvas.beginPath()
        path.moveTo(*points[0])
        for point in points[1:]:
            path.lineTo(*point)
        canvas.setDash()
        canvas.setStrokeColor(colors.HexColor("#473B2C"))
        canvas.setLineWidth(6)
        canvas.drawPath(path, stroke=1, fill=0)
        canvas.setStrokeColor(colors.HexColor("#F4A640"))
        canvas.setLineWidth(3.5)
        canvas.drawPath(path, stroke=1, fill=0)

        middle = points[len(points) // 2]
        canvas.setFillColor(colors.HexColor("#473B2C"))
        canvas.circle(*middle, 7, fill=1, stroke=0)
        canvas.setFillColor(colors.white)
        canvas.setFont("Helvetica-Bold", 7)
        canvas.drawCentredString(middle[0], middle[1] - 2.4, str(number))

    for label, address, color in (
        ("S", packet["start"], colors.HexColor("#18875D")),
        ("E", packet["end"], colors.HexColor("#C44B3F")),
    ):
        px, py = project([address["lon"], address["lat"]])
        canvas.setFillColor(color)
        canvas.circle(px, py, 9, fill=1, stroke=0)
        canvas.setFillColor(colors.white)
        canvas.setFont("Helvetica-Bold", 8)
        canvas.drawCentredString(px, py - 2.8, label)

    canvas.restoreState()
    canvas.setFillColor(colors.HexColor("#4E4B45"))
    canvas.setFont("Helvetica-Bold", 8)
    canvas.drawString(x + 10, y + height - 15, "PROPOSED WALKING ROUTE")
    canvas.setFont("Helvetica", 7)
    legend = "S Start   E End   dots homes   dashed walking path"
    canvas.drawRightString(x + width - 10, y + 10, legend)

    seen_names = set()
    label_y = y + height - 28
    for segment in packet["segments"]:
        name = segment["name"]
        if name in seen_names:
            continue
        seen_names.add(name)
        text_width = stringWidth(name, "Helvetica-Bold", 7)
        canvas.setFillColor(colors.Color(1, 1, 1, alpha=0.82))
        canvas.roundRect(x + 10, label_y - 3, text_width + 8, 12, 3, fill=1, stroke=0)
        canvas.setFillColor(colors.HexColor("#473B2C"))
        canvas.setFont("Helvetica-Bold", 7)
        canvas.drawString(x + 14, label_y, name)
        label_y -= 15


def render_pdf(fixture: dict, packet: dict, output: Path = DEFAULT_PDF) -> Path:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import letter
    from reportlab.pdfgen import canvas

    output.parent.mkdir(parents=True, exist_ok=True)
    pdf = canvas.Canvas(str(output), pagesize=letter)
    page_width, page_height = letter
    pdf.setTitle(f"Streetlight outreach packet {packet['packet_id']}")

    pdf.setFillColor(colors.HexColor("#FBFAF7"))
    pdf.rect(0, 0, page_width, page_height, fill=1, stroke=0)
    pdf.setFillColor(colors.HexColor("#473B2C"))
    pdf.setFont("Helvetica-Bold", 25)
    pdf.drawString(36, 751, "STREETLIGHT")
    pdf.setFillColor(colors.HexColor("#B46B2A"))
    pdf.setFont("Helvetica-Bold", 11)
    pdf.drawString(36, 735, "OUTREACH PACKET")

    pdf.setFillColor(colors.HexColor("#4E4B45"))
    pdf.setFont("Helvetica-Bold", 9)
    pdf.drawRightString(576, 754, f"PACKET ID  {packet['packet_id']}")
    pdf.setFont("Helvetica", 8)
    pdf.drawRightString(576, 739, f"BATCH  {packet['batch_name']}")
    pdf.drawRightString(
        576, 726, f"ESTIMATED TRACTS  {packet['estimated_homes']}"
    )

    _draw_map(pdf, fixture, packet, (36, 355, 540, 350))

    pdf.setFillColor(colors.HexColor("#473B2C"))
    pdf.setFont("Helvetica-Bold", 11)
    pdf.drawString(36, 329, "START")
    pdf.drawString(36, 283, "END")
    pdf.setFont("Helvetica", 9)
    pdf.drawString(36, 314, packet["start_address"])
    pdf.drawString(36, 268, packet["end_address"])

    pdf.setFont("Helvetica-Bold", 11)
    pdf.drawString(36, 238, "STREETS AND ADDRESS RANGES")
    pdf.setFont("Helvetica", 9)
    text_y = 221
    for street_range in packet["street_ranges"]:
        pdf.drawString(
            44,
            text_y,
            (
                f"{street_range['street']}: "
                f"{street_range['first']}-{street_range['last']} "
                f"({street_range['homes']} estimated tracts)"
            ),
        )
        text_y -= 16

    pdf.setFont("Helvetica-Bold", 11)
    pdf.drawString(36, 169, "VOLUNTEER CHECKLIST")
    pdf.setFont("Helvetica", 8.5)
    checklist = [
        "1. Taking this sheet and flyers means accepting the entire route.",
        "2. Scan the QR code for walking directions to the first house.",
        "3. Follow the numbered route and cover every marked home.",
        "4. Tell the administrator about any map or address corrections.",
    ]
    for index, line in enumerate(checklist):
        pdf.drawString(44, 151 - index * 15, line)

    _draw_qr(pdf, packet["google_maps_url"], 452, 203, 104)
    pdf.setFont("Helvetica-Bold", 8)
    pdf.drawCentredString(504, 191, "WALK TO START")
    pdf.setFont("Helvetica", 6.5)
    pdf.drawCentredString(504, 181, "Google Maps - no app login required")

    pdf.setStrokeColor(colors.HexColor("#D8D2C5"))
    pdf.line(36, 80, 576, 80)
    pdf.setFillColor(colors.HexColor("#6C675E"))
    pdf.setFont("Helvetica", 6.5)
    pdf.drawString(
        36,
        66,
        "Map data: OpenStreetMap contributors, Overture Maps Foundation",
    )
    pdf.drawString(
        36,
        55,
        "openstreetmap.org/copyright | Overture release 2026-07-22.0",
    )
    pdf.drawRightString(
        576,
        55,
        "Counts are estimates; administrator reconciles completion.",
    )

    pdf.showPage()
    pdf.save()
    return output


def main() -> None:
    fixture = load_fixture()
    packet = build_packet(fixture)
    output = render_pdf(fixture, packet)
    print(
        f"Wrote {output} - {packet['estimated_homes']} estimated tracts, "
        f"{len(packet['segments'])} route segments."
    )
    print(f"Start: {packet['start_address']}")
    print(f"End:   {packet['end_address']}")
    print(f"QR:    {packet['google_maps_url']}")


if __name__ == "__main__":
    main()
