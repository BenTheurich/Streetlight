import math
import re


ALWAYS_KEEP = {"residential", "living_street"}
KEEP_WITH_ADDRESS = {"primary", "secondary", "tertiary", "unclassified"}
MAX_ADDRESS_DISTANCE_METERS = 40
TURN_SPLIT_DEGREES = 85


def canonical_street_name(value: str) -> str:
    words = re.sub(r"[^a-z0-9 ]", " ", value.lower()).split()
    suffixes = {
        "avenue": "ave",
        "drive": "dr",
        "lane": "ln",
        "place": "pl",
        "road": "rd",
        "street": "st",
        "circle": "cir",
        "court": "ct",
        "parkway": "pkwy",
    }
    return " ".join(suffixes.get(word, word) for word in words)


def keep_segment(road_class: str, address_count: int) -> bool:
    return road_class in ALWAYS_KEEP or (
        road_class in KEEP_WITH_ADDRESS and address_count > 0
    )


def _display_name(road):
    return road["properties"]["names"]["primary"]


def _lines(geometry):
    if geometry["type"] == "LineString":
        return [geometry["coordinates"]]
    return geometry["coordinates"]


def _split_turns(coordinates):
    parts = []
    start = 0
    for index in range(1, len(coordinates) - 1):
        previous, current, following = coordinates[index - 1 : index + 2]
        incoming = (current[0] - previous[0], current[1] - previous[1])
        outgoing = (following[0] - current[0], following[1] - current[1])
        lengths = math.hypot(*incoming) * math.hypot(*outgoing)
        if not lengths:
            continue
        cosine = max(
            -1,
            min(1, (incoming[0] * outgoing[0] + incoming[1] * outgoing[1]) / lengths),
        )
        if math.degrees(math.acos(cosine)) >= TURN_SPLIT_DEGREES:
            parts.append(coordinates[start : index + 1])
            start = index
    parts.append(coordinates[start:])
    return parts


def _intersection_parts(lines):
    # ponytail: pairwise scan suits territory imports; add a spatial index if imports become slow.
    insertions = [{} for _ in lines]
    cuts = [set() for _ in lines]
    for first_index, first in enumerate(lines):
        for second_index in range(first_index + 1, len(lines)):
            second = lines[second_index]
            for first_segment, (a, b) in enumerate(zip(first, first[1:])):
                rx, ry = b[0] - a[0], b[1] - a[1]
                for second_segment, (c, d) in enumerate(zip(second, second[1:])):
                    sx, sy = d[0] - c[0], d[1] - c[1]
                    denominator = rx * sy - ry * sx
                    if abs(denominator) < 1e-15:
                        continue
                    qx, qy = c[0] - a[0], c[1] - a[1]
                    first_amount = (qx * sy - qy * sx) / denominator
                    second_amount = (qx * ry - qy * rx) / denominator
                    if not (
                        0 <= first_amount <= 1 and 0 <= second_amount <= 1
                    ):
                        continue
                    point = [
                        a[0] + first_amount * rx,
                        a[1] + first_amount * ry,
                    ]
                    point_key = tuple(point)
                    cuts[first_index].add(point_key)
                    cuts[second_index].add(point_key)
                    if 0 < first_amount < 1:
                        insertions[first_index].setdefault(first_segment, []).append(
                            (first_amount, point)
                        )
                    if 0 < second_amount < 1:
                        insertions[second_index].setdefault(second_segment, []).append(
                            (second_amount, point)
                        )

    result = []
    for line_index, coordinates in enumerate(lines):
        expanded = [coordinates[0]]
        for segment_index, end in enumerate(coordinates[1:]):
            expanded.extend(
                point
                for _, point in sorted(
                    insertions[line_index].get(segment_index, []),
                    key=lambda item: item[0],
                )
                if point != expanded[-1]
            )
            if end != expanded[-1]:
                expanded.append(end)
        start = 0
        parts = []
        for index in range(1, len(expanded) - 1):
            if tuple(expanded[index]) in cuts[line_index]:
                parts.append(expanded[start : index + 1])
                start = index
        parts.append(expanded[start:])
        result.append(parts)
    return result


def _distance_to_line(point, coordinates):
    scale_x = 111_320 * math.cos(math.radians(point[1]))
    scale_y = 111_320
    px, py = point[0] * scale_x, point[1] * scale_y
    best = math.inf
    for start, end in zip(coordinates, coordinates[1:]):
        ax, ay = start[0] * scale_x, start[1] * scale_y
        bx, by = end[0] * scale_x, end[1] * scale_y
        dx, dy = bx - ax, by - ay
        length_squared = dx * dx + dy * dy
        amount = (
            max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / length_squared))
            if length_squared
            else 0
        )
        best = min(best, math.hypot(px - (ax + amount * dx), py - (ay + amount * dy)))
    return best


def normalize_features(roads, addresses):
    road_lines = [
        (road_feature, line)
        for road_feature in roads
        for line in _lines(road_feature["geometry"])
    ]
    intersection_parts = _intersection_parts(
        [coordinates for _, coordinates in road_lines]
    )
    segments = []
    next_part_index = {}
    for line_index, (road_feature, _) in enumerate(road_lines):
        name = _display_name(road_feature)
        parts = [
            part
            for intersection_part in intersection_parts[line_index]
            for part in _split_turns(intersection_part)
        ]
        for coordinates in parts:
            part_index = next_part_index.get(road_feature["id"], 0)
            next_part_index[road_feature["id"]] = part_index + 1
            segments.append(
                {
                    "source_id": road_feature["id"],
                    "part_index": part_index,
                    "road_class": road_feature["properties"]["class"],
                    "street_name": name,
                    "canonical_name": canonical_street_name(name),
                    "coordinates": coordinates,
                    "address_count": 0,
                }
            )

    for address_feature in addresses:
        address_name = canonical_street_name(address_feature["properties"]["street"])
        point = address_feature["geometry"]["coordinates"]
        candidates = [
            segment
            for segment in segments
            if segment["canonical_name"] == address_name
        ]
        if candidates:
            nearest = min(
                candidates,
                key=lambda segment: (
                    _distance_to_line(point, segment["coordinates"]),
                    segment["source_id"],
                    segment["part_index"],
                ),
            )
            if _distance_to_line(point, nearest["coordinates"]) <= MAX_ADDRESS_DISTANCE_METERS:
                nearest["address_count"] += 1

    result = []
    for segment in sorted(
        segments,
        key=lambda item: (
            item["canonical_name"],
            item["source_id"],
            item["part_index"],
        ),
    ):
        if not keep_segment(segment["road_class"], segment["address_count"]):
            continue
        result.append(
            {
                "id": f"overture:{segment['source_id']}:{segment['part_index']}",
                "sourceSegmentId": segment["source_id"],
                "roadClass": segment["road_class"],
                "streetName": segment["street_name"],
                "geometry": {
                    "type": "LineString",
                    "coordinates": segment["coordinates"],
                },
                "estimatedHomes": segment["address_count"],
            }
        )
    return result
