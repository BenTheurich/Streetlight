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


def _address_point_distance2(address: dict, point: list[float]) -> float:
    origin_lat = address["lat"]
    address_xy = _xy(address["lon"], address["lat"], origin_lat)
    point_xy = _xy(point[0], point[1], origin_lat)
    return (
        (address_xy[0] - point_xy[0]) ** 2
        + (address_xy[1] - point_xy[1]) ** 2
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

    target = metadata["packet_target_homes"]
    home_segments = []
    selected_addresses = []
    for segment in route_segments:
        segment_addresses = assigned[segment["id"]]
        if not segment_addresses:
            continue
        home_segments.append(segment)
        selected_addresses.extend(segment_addresses)
        if len(selected_addresses) >= target:
            break

    selected_ids = {segment["id"] for segment in home_segments}
    for street_segments in by_street.values():
        selected_positions = [
            index
            for index, segment in enumerate(street_segments)
            if segment["id"] in selected_ids
        ]
        if selected_positions:
            for segment in street_segments[
                min(selected_positions) : max(selected_positions) + 1
            ]:
                selected_ids.add(segment["id"])
    selected_segments = [
        segment for segment in route_segments if segment["id"] in selected_ids
    ]

    # ponytail: Phase 0 has two named streets. Phase 4 owns general route ordering.
    selected_by_street = {
        name: [
            segment
            for segment in selected_segments
            if canonical_street(segment["name"]) == canonical_street(name)
        ]
        for name in metadata["route_streets"]
    }
    route_legs = []
    second_street = metadata["route_streets"][1]
    northbound = selected_by_street[second_street]
    northbound.sort(key=lambda segment: min(p[1] for p in segment["coordinates"]))
    for segment in northbound:
        coordinates = list(segment["coordinates"])
        if coordinates[0][1] > coordinates[-1][1]:
            coordinates.reverse()
        route_legs.append({**segment, "coordinates": coordinates})

    first_street = metadata["route_streets"][0]
    first_legs = selected_by_street[first_street]
    next_start = route_legs[0]["coordinates"][0]
    first_route_legs = []
    for segment in first_legs:
        coordinates = list(segment["coordinates"])
        if (
            sum(
                (coordinates[0][axis] - next_start[axis]) ** 2
                for axis in (0, 1)
            )
            < sum(
                (coordinates[-1][axis] - next_start[axis]) ** 2
                for axis in (0, 1)
            )
        ):
            coordinates.reverse()
        first_route_legs.append({**segment, "coordinates": coordinates})
    route_legs = first_route_legs + route_legs

    selected_addresses.sort(
        key=lambda address: (
            canonical_street(address["street"]),
            int(address["number"]) if address["number"].isdigit() else 0,
            address["lon"],
            address["lat"],
        )
    )
    start_candidates = [
        address
        for address in selected_addresses
        if canonical_street(address["street"]) == canonical_street(first_street)
    ]
    end_candidates = [
        address
        for address in selected_addresses
        if canonical_street(address["street"]) == canonical_street(second_street)
    ]
    start = min(
        start_candidates,
        key=lambda address: _address_point_distance2(
            address, route_legs[0]["coordinates"][0]
        ),
    )
    end = min(
        end_candidates,
        key=lambda address: _address_point_distance2(
            address, route_legs[-1]["coordinates"][-1]
        ),
    )

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

    directions = [
        f"Start at {_format_address(start)}.",
        "Follow the arrows around Diego Drive to Seraphina Road.",
        "Continue north on Seraphina Road. Cover homes on both sides.",
        f"Finish at {_format_address(end)}.",
    ]
    return {
        "packet_id": "P0-TEM-001",
        "batch_name": "Temecula Phase 0 Proof",
        "target_homes": target,
        "estimated_homes": len(selected_addresses),
        "segments": selected_segments,
        "route_legs": route_legs,
        "directions": directions,
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


def _point_on_polyline(
    points: list[tuple[float, float]], fraction: float
) -> tuple[float, float, float]:
    lengths = [
        math.hypot(end[0] - start[0], end[1] - start[1])
        for start, end in zip(points, points[1:])
    ]
    target = sum(lengths) * fraction
    walked = 0.0
    for (start, end), length in zip(zip(points, points[1:]), lengths):
        if walked + length >= target:
            position = 0 if length == 0 else (target - walked) / length
            x = start[0] + (end[0] - start[0]) * position
            y = start[1] + (end[1] - start[1]) * position
            return x, y, math.atan2(end[1] - start[1], end[0] - start[0])
        walked += length
    start, end = points[-2:]
    return end[0], end[1], math.atan2(end[1] - start[1], end[0] - start[0])


def _draw_arrow(canvas, x: float, y: float, angle: float) -> None:
    from reportlab.lib import colors

    tip = x + math.cos(angle) * 7, y + math.sin(angle) * 7
    left = (
        x - math.cos(angle) * 5 - math.sin(angle) * 4,
        y - math.sin(angle) * 5 + math.cos(angle) * 4,
    )
    right = (
        x - math.cos(angle) * 5 + math.sin(angle) * 4,
        y - math.sin(angle) * 5 - math.cos(angle) * 4,
    )
    path = canvas.beginPath()
    path.moveTo(*tip)
    path.lineTo(*left)
    path.lineTo(*right)
    path.close()
    canvas.setFillColor(colors.HexColor("#F4A640"))
    canvas.setStrokeColor(colors.white)
    canvas.setLineWidth(0.8)
    canvas.drawPath(path, fill=1, stroke=1)


def _draw_map(canvas, fixture: dict, packet: dict, box: tuple[float, ...]) -> None:
    from reportlab.lib import colors
    from reportlab.pdfbase.pdfmetrics import stringWidth

    x, y, width, height = box
    route_coordinates = [
        point
        for leg in packet["route_legs"]
        for point in leg["coordinates"]
    ]
    route_coordinates += [
        [address["lon"], address["lat"]] for address in packet["addresses"]
    ]
    min_lon = min(point[0] for point in route_coordinates) - 0.0012
    max_lon = max(point[0] for point in route_coordinates) + 0.0012
    min_lat = min(point[1] for point in route_coordinates) - 0.0007
    max_lat = max(point[1] for point in route_coordinates) + 0.0007
    mean_lat = (min_lat + max_lat) / 2
    lon_scale = math.cos(math.radians(mean_lat))
    data_width = (max_lon - min_lon) * lon_scale
    data_height = max_lat - min_lat
    scale = min((width - 22) / data_width, (height - 22) / data_height)
    x_offset = x + (width - data_width * scale) / 2
    y_offset = y + (height - data_height * scale) / 2

    def project(point: list[float]) -> tuple[float, float]:
        lon, lat = point
        return (
            x_offset + (lon - min_lon) * lon_scale * scale,
            y_offset + (lat - min_lat) * scale,
        )

    canvas.setFillColor(colors.HexColor("#F4F5F2"))
    canvas.roundRect(x, y, width, height, 10, fill=1, stroke=0)
    clip = canvas.beginPath()
    clip.roundRect(x, y, width, height, 10)
    canvas.saveState()
    canvas.clipPath(clip, stroke=0, fill=0)

    selected_ids = {segment["id"] for segment in packet["segments"]}
    for segment in fixture["segments"]:
        if segment["id"] in selected_ids:
            continue
        road_class = segment["class"]
        if road_class in {"footway", "path", "cycleway"}:
            canvas.setStrokeColor(colors.HexColor("#A9C9B0"))
            canvas.setLineWidth(0.8)
            canvas.setDash(2, 2)
        else:
            canvas.setStrokeColor(colors.HexColor("#CACDC8"))
            canvas.setLineWidth(
                2.4 if road_class in {"secondary", "tertiary"} else 1.3
            )
            canvas.setDash()
        points = [project(point) for point in segment["coordinates"]]
        path = canvas.beginPath()
        path.moveTo(*points[0])
        for point in points[1:]:
            path.lineTo(*point)
        canvas.drawPath(path, stroke=1, fill=0)

    for leg in packet["route_legs"]:
        points = [project(point) for point in leg["coordinates"]]
        path = canvas.beginPath()
        path.moveTo(*points[0])
        for point in points[1:]:
            path.lineTo(*point)
        canvas.setDash()
        canvas.setStrokeColor(colors.HexColor("#17324D"))
        canvas.setLineWidth(7)
        canvas.drawPath(path, stroke=1, fill=0)
        canvas.setStrokeColor(colors.HexColor("#2E86AB"))
        canvas.setLineWidth(4.2)
        canvas.drawPath(path, stroke=1, fill=0)

    for address in packet["addresses"]:
        px, py = project([address["lon"], address["lat"]])
        canvas.setFillColor(colors.HexColor("#0F766E"))
        canvas.setStrokeColor(colors.white)
        canvas.setLineWidth(0.35)
        canvas.rect(px - 1.8, py - 1.8, 3.6, 3.6, fill=1, stroke=1)

    route_by_street: dict[str, list[tuple[float, float]]] = defaultdict(list)
    for leg in packet["route_legs"]:
        name = canonical_street(leg["name"])
        points = [project(point) for point in leg["coordinates"]]
        if route_by_street[name] and route_by_street[name][-1] == points[0]:
            route_by_street[name].extend(points[1:])
        else:
            route_by_street[name].extend(points)

    for street, points in route_by_street.items():
        fractions = (0.28, 0.68) if "DIEGO" in street else (0.2, 0.55, 0.84)
        for fraction in fractions:
            arrow_x, arrow_y, angle = _point_on_polyline(points, fraction)
            _draw_arrow(canvas, arrow_x, arrow_y, angle)

    for street, points in route_by_street.items():
        label_x, label_y, _ = _point_on_polyline(
            points, 0.48 if "DIEGO" in street else 0.7
        )
        label = "Diego Dr" if "DIEGO" in street else "Seraphina Rd"
        label_x += 15
        label_y += 2
        text_width = stringWidth(label, "Helvetica-Bold", 7.5)
        canvas.setFillColor(colors.white)
        canvas.roundRect(
            label_x - 4, label_y - 5, text_width + 8, 14, 4, fill=1, stroke=0
        )
        canvas.setFillColor(colors.HexColor("#17324D"))
        canvas.setFont("Helvetica-Bold", 7.5)
        canvas.drawString(label_x, label_y - 1, label)

    def marker(label: str, address: dict, color) -> None:
        px, py = project([address["lon"], address["lat"]])
        canvas.setFillColor(color)
        canvas.setStrokeColor(colors.white)
        canvas.setLineWidth(1.2)
        canvas.circle(px, py, 8, fill=1, stroke=1)
        text_width = stringWidth(label, "Helvetica-Bold", 7.5)
        label_x = px + 11
        if label_x + text_width + 12 > x + width:
            label_x = px - text_width - 23
        canvas.setFillColor(colors.white)
        canvas.roundRect(
            label_x, py - 7, text_width + 12, 14, 4, fill=1, stroke=0
        )
        canvas.setFillColor(color)
        canvas.setFont("Helvetica-Bold", 7.5)
        canvas.drawString(label_x + 6, py - 2.5, label)

    marker("START", packet["start"], colors.HexColor("#18875D"))
    marker("FINISH", packet["end"], colors.HexColor("#C44B3F"))
    canvas.restoreState()

    canvas.setFillColor(colors.HexColor("#17324D"))
    canvas.setFont("Helvetica-Bold", 9)
    canvas.drawString(x + 12, y + height - 20, "YOUR ROUTE")
    legend_x = x + width - 215
    canvas.setFillColor(colors.white)
    canvas.roundRect(legend_x, y + height - 31, 203, 22, 5, fill=1, stroke=0)
    canvas.setFillColor(colors.HexColor("#0F766E"))
    canvas.rect(legend_x + 8, y + height - 23, 5, 5, fill=1, stroke=0)
    canvas.setFillColor(colors.HexColor("#4E4B45"))
    canvas.setFont("Helvetica", 7)
    canvas.drawString(legend_x + 17, y + height - 23, "Estimated home")
    canvas.setFillColor(colors.HexColor("#F4A640"))
    arrow = canvas.beginPath()
    arrow.moveTo(legend_x + 110, y + height - 20)
    arrow.lineTo(legend_x + 120, y + height - 20)
    arrow.lineTo(legend_x + 117, y + height - 17)
    arrow.moveTo(legend_x + 120, y + height - 20)
    arrow.lineTo(legend_x + 117, y + height - 23)
    canvas.setStrokeColor(colors.HexColor("#F4A640"))
    canvas.setLineWidth(1.5)
    canvas.drawPath(arrow, stroke=1, fill=0)
    canvas.setFillColor(colors.HexColor("#4E4B45"))
    canvas.drawString(legend_x + 126, y + height - 23, "Walk this way")


def render_pdf(fixture: dict, packet: dict, output: Path = DEFAULT_PDF) -> Path:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import letter
    from reportlab.pdfgen import canvas

    output.parent.mkdir(parents=True, exist_ok=True)
    pdf = canvas.Canvas(str(output), pagesize=letter)
    page_width, _ = letter
    pdf.setTitle(f"Streetlight outreach packet {packet['packet_id']}")

    pdf.setFillColor(colors.HexColor("#FBFAF7"))
    pdf.rect(0, 0, page_width, 792, fill=1, stroke=0)
    pdf.setFillColor(colors.HexColor("#342F28"))
    pdf.setFont("Helvetica-Bold", 24)
    pdf.drawString(36, 751, "STREETLIGHT")
    pdf.setFillColor(colors.HexColor("#B46B2A"))
    pdf.setFont("Helvetica-Bold", 10)
    pdf.drawString(36, 735, "OUTREACH ROUTE")

    pdf.setFillColor(colors.HexColor("#4E4B45"))
    pdf.setFont("Helvetica-Bold", 9)
    pdf.drawRightString(576, 754, f"PACKET  {packet['packet_id']}")
    pdf.setFont("Helvetica", 8)
    pdf.drawRightString(576, 739, packet["batch_name"])

    pdf.setFillColor(colors.HexColor("#F5E6D4"))
    pdf.roundRect(36, 697, 540, 26, 6, fill=1, stroke=0)
    pdf.setFillColor(colors.HexColor("#8A4F1D"))
    pdf.setFont("Helvetica-Bold", 8.5)
    pdf.drawString(
        48,
        706,
        "TAKING THIS SHEET + FLYERS MEANS ACCEPTING THE ENTIRE ROUTE",
    )
    pdf.setFillColor(colors.HexColor("#17324D"))
    pdf.drawRightString(
        564,
        706,
        f"{packet['estimated_homes']} HOMES / "
        f"{packet['estimated_homes']} TRACTS",
    )

    _draw_map(pdf, fixture, packet, (36, 323, 540, 362))

    pdf.setFillColor(colors.HexColor("#342F28"))
    pdf.setFont("Helvetica-Bold", 12)
    pdf.drawString(36, 298, "HOW TO WALK THIS ROUTE")
    direction_y = 272
    for number, direction in enumerate(packet["directions"], start=1):
        pdf.setFillColor(colors.HexColor("#17324D"))
        pdf.circle(45, direction_y + 2, 9, fill=1, stroke=0)
        pdf.setFillColor(colors.white)
        pdf.setFont("Helvetica-Bold", 8)
        pdf.drawCentredString(45, direction_y - 1, str(number))
        pdf.setFillColor(colors.HexColor("#342F28"))
        pdf.setFont("Helvetica", 9.5)
        pdf.drawString(62, direction_y - 1, direction)
        direction_y -= 28

    _draw_qr(pdf, packet["google_maps_url"], 472, 184, 84)
    pdf.setFillColor(colors.HexColor("#17324D"))
    pdf.setFont("Helvetica-Bold", 8)
    pdf.drawCentredString(514, 174, "SCAN FOR START")
    pdf.setFillColor(colors.HexColor("#6C675E"))
    pdf.setFont("Helvetica", 6.5)
    pdf.drawCentredString(514, 164, "Walking directions in Google Maps")

    pdf.setFillColor(colors.HexColor("#EFF2F0"))
    pdf.roundRect(36, 91, 540, 55, 7, fill=1, stroke=0)
    pdf.setFillColor(colors.HexColor("#17324D"))
    pdf.setFont("Helvetica-Bold", 8)
    pdf.drawString(48, 130, "STREET COVERAGE")
    coverage_y = 114
    for street_range in packet["street_ranges"]:
        pdf.setFillColor(colors.HexColor("#342F28"))
        pdf.setFont("Helvetica-Bold", 8)
        pdf.drawString(48, coverage_y, street_range["street"])
        pdf.setFont("Helvetica", 8)
        pdf.drawString(
            143,
            coverage_y,
            (
                f"{street_range['homes']} homes  |  "
                f"addresses {street_range['first']}-{street_range['last']}"
            ),
        )
        coverage_y -= 14
    pdf.setFillColor(colors.HexColor("#6C675E"))
    pdf.setFont("Helvetica", 7)
    pdf.drawRightString(
        564, 99, "Tell the administrator about map or address corrections."
    )

    pdf.setStrokeColor(colors.HexColor("#D8D2C5"))
    pdf.line(36, 72, 576, 72)
    pdf.setFillColor(colors.HexColor("#6C675E"))
    pdf.setFont("Helvetica", 6.3)
    pdf.drawString(
        36,
        58,
        "Map data: OpenStreetMap contributors, Overture Maps Foundation",
    )
    pdf.drawString(
        36,
        47,
        "openstreetmap.org/copyright | Overture release 2026-07-22.0",
    )
    pdf.drawRightString(
        576,
        47,
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
        f"Wrote {output} - {packet['estimated_homes']} estimated homes, "
        f"{len(packet['segments'])} route segments."
    )
    print(f"Start: {packet['start_address']}")
    print(f"End:   {packet['end_address']}")
    print(f"QR:    {packet['google_maps_url']}")


if __name__ == "__main__":
    main()
