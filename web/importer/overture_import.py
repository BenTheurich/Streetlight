import argparse
import json
import math
import re
import sys
from contextlib import redirect_stdout
from datetime import datetime, timezone


ALWAYS_KEEP = {"residential", "living_street"}
KEEP_WITH_ADDRESS = {"primary", "secondary", "tertiary", "unclassified"}
MAX_ADDRESS_DISTANCE_METERS = 40
SPATIAL_MATCH_MARGIN_METERS = 8
NAME_MATCH_DISTANCE_METERS = 100
NAME_MATCH_MARGIN_METERS = 2
GROUP_MATCH_MIN_SPAN_METERS = 20
GROUP_MATCH_MAX_ANGLE_DEGREES = 30
ADDRESS_CLUSTER_GAP_METERS = 150
BUILDING_ADDRESS_DISTANCE_METERS = 15
MAX_SEGMENT_HOMES = 100
OVERTURE_RELEASE = "2026-06-17.0"
TURN_SPLIT_DEGREES = 85
EARTH_RADIUS_MILES = 3958.7613
EARTH_RADIUS_METERS = EARTH_RADIUS_MILES * 1609.344
APARTMENT_SQUARE_METERS_PER_TRACT = 100
SUFFIXES = {
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
DISPLAY_SUFFIXES = {value: key.title() for key, value in SUFFIXES.items()}
DIRECTION_NAMES = {
    "n": "north",
    "north": "north",
    "s": "south",
    "south": "south",
    "e": "east",
    "east": "east",
    "w": "west",
    "west": "west",
}
RESIDENTIAL_BUILDING_CLASSES = {
    "bungalow",
    "detached",
    "dwelling_house",
    "house",
    "semi",
    "semidetached_house",
}
APARTMENT_BUILDING_CLASSES = {"apartments"}


def canonical_street_name(value: str) -> str:
    words = re.sub(r"[^a-z0-9 ]", " ", value.lower()).split()
    return " ".join(SUFFIXES.get(word, word) for word in words)


def _street_name_core(value):
    ignored = set(DIRECTION_NAMES) | set(DISPLAY_SUFFIXES)
    return "".join(
        word for word in canonical_street_name(value).split() if word not in ignored
    )


def _street_directions(value):
    return {
        DIRECTION_NAMES[word]
        for word in canonical_street_name(value).split()
        if word in DIRECTION_NAMES
    }


def _directions_compatible(first, second):
    first_directions = _street_directions(first)
    second_directions = _street_directions(second)
    return (
        not first_directions
        or not second_directions
        or bool(first_directions & second_directions)
    )


def _street_names_equivalent(first, second):
    return (
        _street_name_core(first) == _street_name_core(second)
        and _directions_compatible(first, second)
    )


def _inferred_display_name(value):
    return " ".join(
        DISPLAY_SUFFIXES.get(word, word.title())
        for word in canonical_street_name(value).split()
    )


def _supported_address_name(addresses, minimum):
    name_counts = {}
    for address_item in addresses:
        name = canonical_street_name(address_item["street"])
        if name:
            name_counts[name] = name_counts.get(name, 0) + 1
    ranked_names = sorted(name_counts.items(), key=lambda item: (-item[1], item[0]))
    if not ranked_names:
        return None
    inferred_name, inferred_count = ranked_names[0]
    runner_up_count = ranked_names[1][1] if len(ranked_names) > 1 else 0
    if (
        inferred_count < minimum
        or inferred_count / len(addresses) < 0.8
        or inferred_count <= runner_up_count
    ):
        return None
    raw_counts = {}
    for address_item in addresses:
        if canonical_street_name(address_item["street"]) == inferred_name:
            raw_counts[address_item["street"]] = raw_counts.get(address_item["street"], 0) + 1
    raw_name = min(raw_counts, key=lambda value: (-raw_counts[value], value.casefold(), value))
    return _inferred_display_name(raw_name)


def keep_segment(road_class: str, address_count: int) -> bool:
    return road_class in ALWAYS_KEEP or (
        road_class in KEEP_WITH_ADDRESS and address_count > 0
    )


def _display_name(road):
    primary = (road["properties"].get("names") or {}).get("primary")
    if isinstance(primary, str) and canonical_street_name(primary):
        return primary
    return None


def _lines(geometry):
    if geometry["type"] == "LineString":
        return [geometry["coordinates"]]
    return geometry["coordinates"]


def _split_turns(coordinates):
    parts = []
    start = 0
    for index in range(1, len(coordinates) - 1):
        previous, current, following = coordinates[index - 1 : index + 2]
        longitude_scale = math.cos(math.radians(current[1]))
        incoming = (
            (current[0] - previous[0]) * longitude_scale,
            current[1] - previous[1],
        )
        outgoing = (
            (following[0] - current[0]) * longitude_scale,
            following[1] - current[1],
        )
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


def _segment_length(start, end):
    longitude_scale = math.cos(math.radians((start[1] + end[1]) / 2))
    return math.hypot(
        (end[0] - start[0]) * longitude_scale,
        end[1] - start[1],
    )


def _connector_parts(lines, connectors):
    segment_lengths = [
        [_segment_length(start, end) for start, end in zip(line, line[1:])]
        for line in lines
    ]
    total_length = sum(sum(lengths) for lengths in segment_lengths)
    targets = sorted(
        {
            connector["at"] * total_length
            for connector in connectors
            if connector.get("connector_id")
            and isinstance(connector.get("at"), (int, float))
            and 0 < connector["at"] < 1
        }
    )
    insertions = [{} for _ in lines]
    cuts = [set() for _ in lines]
    traversed = 0
    for line_index, (line, lengths) in enumerate(zip(lines, segment_lengths)):
        for segment_index, (start, end, length) in enumerate(
            zip(line, line[1:], lengths)
        ):
            for target in targets:
                if length and traversed <= target <= traversed + length:
                    amount = (target - traversed) / length
                    point = [
                        start[0] + amount * (end[0] - start[0]),
                        start[1] + amount * (end[1] - start[1]),
                    ]
                    cuts[line_index].add(tuple(point))
                    if 0 < amount < 1:
                        insertions[line_index].setdefault(segment_index, []).append(
                            (amount, point)
                        )
            traversed += length

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


def _distance_along_line(point, coordinates):
    scale_x = math.cos(math.radians(point[1]))
    px, py = point[0] * scale_x, point[1]
    traversed = 0
    best = (math.inf, 0)
    for start, end in zip(coordinates, coordinates[1:]):
        ax, ay = start[0] * scale_x, start[1]
        bx, by = end[0] * scale_x, end[1]
        dx, dy = bx - ax, by - ay
        length_squared = dx * dx + dy * dy
        amount = (
            max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / length_squared))
            if length_squared
            else 0
        )
        distance = math.hypot(px - (ax + amount * dx), py - (ay + amount * dy))
        if distance < best[0]:
            best = (distance, traversed + amount * _segment_length(start, end))
        traversed += _segment_length(start, end)
    return best[1]


def _principal_axis_angle(points):
    mean_latitude = sum(point[1] for point in points) / len(points)
    longitude_scale = math.cos(math.radians(mean_latitude))
    projected = [(point[0] * longitude_scale, point[1]) for point in points]
    center_x = sum(point[0] for point in projected) / len(projected)
    center_y = sum(point[1] for point in projected) / len(projected)
    xx = sum((point[0] - center_x) ** 2 for point in projected)
    yy = sum((point[1] - center_y) ** 2 for point in projected)
    xy = sum(
        (point[0] - center_x) * (point[1] - center_y)
        for point in projected
    )
    return math.atan2(2 * xy, xx - yy) / 2


def _address_group_aligns_with_segment(address_group, segment):
    address_points = [address_item["point"] for address_item in address_group]
    longitude_scale = math.cos(
        math.radians(sum(point[1] for point in address_points) / len(address_points))
    )
    address_span = math.hypot(
        (max(point[0] for point in address_points) - min(point[0] for point in address_points))
        * longitude_scale,
        max(point[1] for point in address_points) - min(point[1] for point in address_points),
    ) * 111_320
    segment_span = sum(
        _segment_length(start, end)
        for start, end in zip(segment["coordinates"], segment["coordinates"][1:])
    ) * 111_320
    if (
        address_span < GROUP_MATCH_MIN_SPAN_METERS
        or segment_span < GROUP_MATCH_MIN_SPAN_METERS
    ):
        return False
    difference = abs(
        (
            _principal_axis_angle(address_points)
            - _principal_axis_angle(segment["coordinates"])
            + math.pi / 2
        )
        % math.pi
        - math.pi / 2
    )
    return math.degrees(difference) <= GROUP_MATCH_MAX_ANGLE_DEGREES


def _address_clusters(addresses):
    remaining = set(range(len(addresses)))
    clusters = []
    while remaining:
        queue = [remaining.pop()]
        cluster = []
        while queue:
            index = queue.pop()
            cluster.append(addresses[index])
            point = addresses[index]["point"]
            connected = []
            for candidate_index in remaining:
                candidate = addresses[candidate_index]["point"]
                longitude_scale = math.cos(math.radians((point[1] + candidate[1]) / 2))
                distance = math.hypot(
                    (point[0] - candidate[0]) * longitude_scale,
                    point[1] - candidate[1],
                ) * 111_320
                if distance <= ADDRESS_CLUSTER_GAP_METERS:
                    connected.append(candidate_index)
            for candidate_index in connected:
                remaining.remove(candidate_index)
                queue.append(candidate_index)
        clusters.append(cluster)
    return clusters


def _nearest_unambiguous_segment(
    point,
    segments,
    max_distance=MAX_ADDRESS_DISTANCE_METERS,
    margin=SPATIAL_MATCH_MARGIN_METERS,
):
    ranked = sorted(
        (
            _distance_to_line(point, segment["coordinates"]),
            segment["source_id"],
            segment["part_index"],
            segment,
        )
        for segment in segments
    )
    if not ranked or ranked[0][0] > max_distance:
        return None
    if (
        len(ranked) > 1
        and ranked[1][0] <= max_distance
        and ranked[1][0] - ranked[0][0] < margin
    ):
        return None
    return ranked[0][3]


def _building_point(geometry):
    polygons = (
        [geometry["coordinates"]]
        if geometry["type"] == "Polygon"
        else geometry["coordinates"]
    )
    points = [
        point
        for polygon in polygons
        for point in polygon[0][:-1] or polygon[0]
    ]
    return [
        sum(point[0] for point in points) / len(points),
        sum(point[1] for point in points) / len(points),
    ]


def _ring_area_square_meters(ring):
    if len(ring) < 3:
        return 0
    latitude = math.radians(sum(point[1] for point in ring) / len(ring))
    points = [
        (
            math.radians(point[0]) * EARTH_RADIUS_METERS * math.cos(latitude),
            math.radians(point[1]) * EARTH_RADIUS_METERS,
        )
        for point in ring
    ]
    return abs(
        sum(
            start[0] * end[1] - end[0] * start[1]
            for start, end in zip(points, points[1:] + points[:1])
        )
        / 2
    )


def _apartment_footprint_estimate(building):
    geometry = building["geometry"]
    polygons = (
        [geometry["coordinates"]]
        if geometry["type"] == "Polygon"
        else geometry["coordinates"]
    )
    footprint = sum(
        max(
            0,
            _ring_area_square_meters(polygon[0])
            - sum(_ring_area_square_meters(hole) for hole in polygon[1:]),
        )
        for polygon in polygons
    )
    properties = building["properties"]
    floors = properties.get("num_floors")
    if not isinstance(floors, int) or floors < 1:
        height = properties.get("height")
        floors = (
            max(1, round(height / 3))
            if isinstance(height, (int, float)) and height > 0
            else 1
        )
    return max(
        2,
        round(footprint * floors / APARTMENT_SQUARE_METERS_PER_TRACT),
    )


def _point_in_ring(point, ring):
    inside = False
    previous = ring[-1]
    for current in ring:
        if (current[1] > point[1]) != (previous[1] > point[1]):
            longitude = (previous[0] - current[0]) * (
                point[1] - current[1]
            ) / (previous[1] - current[1]) + current[0]
            if point[0] < longitude:
                inside = not inside
        previous = current
    return inside


def _building_has_address(building, point, addresses):
    polygons = (
        [building["geometry"]["coordinates"]]
        if building["geometry"]["type"] == "Polygon"
        else building["geometry"]["coordinates"]
    )
    for address_item in addresses:
        if any(
            _point_in_ring(address_item["point"], polygon[0])
            for polygon in polygons
        ):
            return True
        if _distance_to_line(
            address_item["point"],
            [point, point],
        ) <= BUILDING_ADDRESS_DISTANCE_METERS:
            return True
    return False


def _apartment_address(address_item):
    if not (address_item["number"] and address_item["street"]):
        return None
    locality = address_item["locality"]
    parts = [
        " ".join(
            part
            for part in [address_item["number"], address_item["street"]]
            if part
        ),
        locality,
        address_item["postcode"],
    ]
    value = ", ".join(part for part in parts if part)
    return value or None


def _apartment_complexes(addresses, buildings):
    apartment_buildings = [
        item
        for item in buildings
        if item["properties"].get("class") in APARTMENT_BUILDING_CLASSES
        and item["geometry"]["type"] in {"Polygon", "MultiPolygon"}
    ]
    used_indexes = set()
    complexes = []
    for building in apartment_buildings:
        polygons = (
            [building["geometry"]["coordinates"]]
            if building["geometry"]["type"] == "Polygon"
            else building["geometry"]["coordinates"]
        )
        contained = [
            item
            for item in addresses
            if any(
                _point_in_ring(item["point"], polygon[0])
                for polygon in polygons
            )
        ]
        by_premise = {}
        for item in contained:
            by_premise.setdefault(item["premise_key"], []).append(item)
            used_indexes.add(item["index"])
        selected = (
            min(
                by_premise.values(),
                key=lambda group: (-len(group), group[0]["premise_key"]),
            )
            if by_premise
            else []
        )
        units = {
            item["unit"].strip().casefold()
            for item in selected
            if item["unit"] and item["unit"].strip()
        }
        point = (
            selected[0]["point"]
            if selected
            else _building_point(building["geometry"])
        )
        complexes.append(
            {
                "id": f"overture-apartment-building:{building['id']}",
                "sourceId": building["id"],
                "address": _apartment_address(selected[0]) if selected else None,
                "position": point,
                "estimatedTracts": (
                    len(units)
                    if units
                    else _apartment_footprint_estimate(building)
                ),
                "evidence": {
                    "apartmentBuilding": True,
                    "distinctUnits": len(units),
                },
            }
        )

    by_premise = {}
    for item in addresses:
        if item["index"] not in used_indexes:
            by_premise.setdefault(item["premise_key"], []).append(item)
    for premise_key, group in sorted(by_premise.items()):
        if not (group[0]["number"] and group[0]["street"]):
            continue
        units = {
            item["unit"].strip().casefold()
            for item in group
            if item["unit"] and item["unit"].strip()
        }
        if len(units) < 5:
            continue
        source_id = re.sub(r"[^a-z0-9|]+", "-", premise_key).strip("-")
        used_indexes.update(item["index"] for item in group)
        point = [
            sum(item["point"][0] for item in group) / len(group),
            sum(item["point"][1] for item in group) / len(group),
        ]
        complexes.append(
            {
                "id": f"overture-apartment-address:{source_id}",
                "sourceId": source_id,
                "address": _apartment_address(group[0]),
                "position": point,
                "estimatedTracts": len(units),
                "evidence": {
                    "apartmentBuilding": False,
                    "distinctUnits": len(units),
                },
            }
        )
    return sorted(
        complexes,
        key=lambda item: (
            not item["evidence"]["apartmentBuilding"],
            item["id"],
        ),
    ), used_indexes


def _split_overfull_segment(segment):
    if segment["address_count"] <= MAX_SEGMENT_HOMES:
        return [segment]
    ordered = sorted(
        segment["homes"],
        key=lambda home: (
            _distance_along_line(home["position"], segment["coordinates"]),
            home["position"],
            (home["address"] or {}).get("number") or "",
        ),
    )
    chunks = [
        ordered[index : index + MAX_SEGMENT_HOMES]
        for index in range(0, len(ordered), MAX_SEGMENT_HOMES)
    ]
    total_length = sum(
        _segment_length(start, end)
        for start, end in zip(segment["coordinates"], segment["coordinates"][1:])
    )
    if total_length:
        targets = []
        for index in range(1, len(chunks)):
            previous = _distance_along_line(
                chunks[index - 1][-1]["position"], segment["coordinates"]
            )
            following = _distance_along_line(
                chunks[index][0]["position"], segment["coordinates"]
            )
            candidate = (previous + following) / 2 / total_length
            minimum = targets[-1] + 1e-9 if targets else 1e-9
            maximum = 1 - (len(chunks) - index) * 1e-9
            targets.append(max(minimum, min(candidate, maximum)))
        parts = _connector_parts(
            [segment["coordinates"]],
            [
                {"connector_id": f"capacity-{index}", "at": target}
                for index, target in enumerate(targets)
            ],
        )[0]
    else:
        parts = [segment["coordinates"] for _ in chunks]
    return [
        {
            **segment,
            "coordinates": coordinates,
            "address_count": len(homes),
            "homes": homes,
            "addresses": [
                home["address"] for home in homes if home["address"] is not None
            ],
            "capacity_part_index": index,
        }
        for index, (coordinates, homes) in enumerate(zip(parts, chunks))
    ]


def _assign_road_groups(segments):
    parents = list(range(len(segments)))

    def find(index):
        while parents[index] != index:
            parents[index] = parents[parents[index]]
            index = parents[index]
        return index

    def union(first, second):
        first_root = find(first)
        second_root = find(second)
        if first_root != second_root:
            parents[max(first_root, second_root)] = min(first_root, second_root)

    endpoint_members = {}
    for index, segment in enumerate(segments):
        for point in (segment["coordinates"][0], segment["coordinates"][-1]):
            key = (round(point[0], 7), round(point[1], 7))
            endpoint_members.setdefault(key, []).append(index)

    for members in endpoint_members.values():
        named = {}
        unnamed = []
        for index in members:
            segment = segments[index]
            if segment["has_name_evidence"]:
                named.setdefault(segment["canonical_name"], []).append(index)
            else:
                unnamed.append(index)
        for matching in named.values():
            for index in matching[1:]:
                union(matching[0], index)
        if not named and len(unnamed) == 2:
            union(unnamed[0], unnamed[1])
    grouped_ids = {}
    for index, segment in enumerate(segments):
        grouped_ids.setdefault(find(index), []).append(segment["segment_id"])
    group_id_by_root = {
        root: f"road-group:{min(member_ids)}"
        for root, member_ids in grouped_ids.items()
    }
    for index, segment in enumerate(segments):
        segment["road_group_id"] = group_id_by_root[find(index)]


def normalize_features(roads, addresses, buildings=None):
    buildings = buildings or []
    segments = []
    candidate_classes = ALWAYS_KEEP | KEEP_WITH_ADDRESS
    source_addresses = []
    for index, address_feature in enumerate(addresses):
        properties = address_feature["properties"]
        point = address_feature["geometry"]["coordinates"]
        canonical_name = canonical_street_name(properties["street"])
        number = (properties.get("number") or "").strip().casefold()
        levels = properties.get("address_levels") or []
        locality = properties.get("postal_city") or next(
            (
                level.get("value")
                for level in reversed(levels)
                if level and level.get("value")
            ),
            None,
        )
        postcode = (properties.get("postcode") or "").strip()
        source_addresses.append(
            {
                "index": index,
                "number": properties.get("number"),
                "street": properties["street"],
                "canonical_name": canonical_name,
                "locality": locality,
                "postcode": properties.get("postcode"),
                "unit": properties.get("unit"),
                "premise_key": "|".join([canonical_name, number, postcode.casefold()]),
                "point": point,
            }
        )
    apartment_complexes, apartment_address_indexes = _apartment_complexes(
        source_addresses,
        buildings,
    )
    footprint_addresses = []
    address_keys = set()
    for item in source_addresses:
        if item["index"] in apartment_address_indexes:
            continue
        number = (item["number"] or "").strip().casefold()
        key = (
            item["canonical_name"],
            number,
            (item["postcode"] or "").strip().casefold(),
            *((round(item["point"][0], 7), round(item["point"][1], 7)) if not number else ()),
        )
        if key not in address_keys:
            address_keys.add(key)
            footprint_addresses.append(item)
    inferred_roads = 0

    for road_feature in roads:
        road_class = road_feature["properties"]["class"]
        name = _display_name(road_feature)
        if name is None and road_class in ALWAYS_KEEP:
            nearby = [
                address_item
                for address_item in footprint_addresses
                if min(
                    _distance_to_line(address_item["point"], line)
                    for line in _lines(road_feature["geometry"])
                )
                <= MAX_ADDRESS_DISTANCE_METERS
            ]
            name = _supported_address_name(nearby, 3)
            if name:
                inferred_roads += 1
        has_name_evidence = name is not None
        if name is None:
            name = "Unnamed road"
        parts = [
            part
            for line in _lines(road_feature["geometry"])
            for part in _split_turns(line)
        ]
        for part_index, coordinates in enumerate(parts):
            segment_id = f"overture:{road_feature['id']}:{part_index}"
            segments.append(
                {
                    "segment_id": segment_id,
                    "source_id": road_feature["id"],
                    "part_index": part_index,
                    "road_class": road_class,
                    "street_name": name,
                    "canonical_name": canonical_street_name(name),
                    "has_name_evidence": has_name_evidence,
                    "coordinates": coordinates,
                    "address_count": 0,
                    "addresses": [],
                    "homes": [],
                    "residential_building_count": 0,
                }
            )

    assigned_address_indexes = set()
    spatially_assigned_addresses = 0

    def retain_address(segment, address_item):
        retained_address = {
            "number": address_item["number"],
            "street": address_item["street"],
            "locality": address_item["locality"],
            "postcode": address_item["postcode"],
            "position": address_item["point"],
        }
        segment["address_count"] += 1
        segment["addresses"].append(retained_address)
        segment["homes"].append(
            {"position": address_item["point"], "address": retained_address}
        )
        assigned_address_indexes.add(address_item["index"])

    for address_item in footprint_addresses:
        candidates = [
            segment
            for segment in segments
            if segment["road_class"] in candidate_classes
            and segment["has_name_evidence"]
            and segment["canonical_name"] == address_item["canonical_name"]
        ]
        nearest = None
        matched_by_exact_name = False
        if candidates:
            nearest = min(
                candidates,
                key=lambda segment: (
                    _distance_to_line(address_item["point"], segment["coordinates"]),
                    segment["source_id"],
                    segment["part_index"],
                ),
            )
            if (
                _distance_to_line(address_item["point"], nearest["coordinates"])
                > MAX_ADDRESS_DISTANCE_METERS
            ):
                nearest = None
            else:
                matched_by_exact_name = True
        if nearest is None and not candidates:
            name_core = _street_name_core(address_item["street"])
            if name_core:
                nearest = _nearest_unambiguous_segment(
                    address_item["point"],
                    [
                        segment
                        for segment in segments
                        if segment["road_class"] in candidate_classes
                        and _street_name_core(segment["street_name"]) == name_core
                        and _directions_compatible(
                            address_item["street"],
                            segment["street_name"],
                        )
                    ],
                    NAME_MATCH_DISTANCE_METERS,
                    NAME_MATCH_MARGIN_METERS,
                )
        if nearest is not None and not matched_by_exact_name:
            spatially_assigned_addresses += 1
        if nearest is not None:
            retain_address(nearest, address_item)

    unmatched_by_name = {}
    for address_item in footprint_addresses:
        if address_item["index"] not in assigned_address_indexes:
            unmatched_by_name.setdefault(address_item["canonical_name"], []).append(
                address_item
            )
    unnamed_segments = [
        segment for segment in segments if not segment["has_name_evidence"]
    ]
    for same_named_addresses in unmatched_by_name.values():
        for address_group in _address_clusters(same_named_addresses):
            if len(address_group) < 3:
                continue
            aligned_segments = [
                segment
                for segment in unnamed_segments
                if _address_group_aligns_with_segment(address_group, segment)
            ]
            choices = [
                (
                    address_item,
                    _nearest_unambiguous_segment(
                        address_item["point"],
                        aligned_segments,
                        NAME_MATCH_DISTANCE_METERS,
                        0,
                    ),
                )
                for address_item in address_group
            ]
            source_counts = {}
            for _, segment in choices:
                if segment is not None:
                    source_counts[segment["source_id"]] = (
                        source_counts.get(segment["source_id"], 0) + 1
                    )
            for address_item, segment in choices:
                if segment is not None and source_counts[segment["source_id"]] >= 2:
                    retain_address(segment, address_item)
                    spatially_assigned_addresses += 1

    for address_item in footprint_addresses:
        if (
            address_item["index"] in assigned_address_indexes
            or len(unmatched_by_name[address_item["canonical_name"]]) >= 3
        ):
            continue
        name_core = _street_name_core(address_item["street"])
        compatible_segments = [
            segment
            for segment in segments
            if segment["road_class"] in candidate_classes
            and (
                not segment["has_name_evidence"]
                or (
                    _directions_compatible(
                        address_item["street"],
                        segment["street_name"],
                    )
                    and (
                        not segment["addresses"]
                        or any(
                            _street_name_core(assigned["street"]) == name_core
                            for assigned in segment["addresses"]
                        )
                    )
                )
            )
        ]
        nearest = _nearest_unambiguous_segment(
            address_item["point"],
            compatible_segments,
        )
        if nearest is not None:
            retain_address(nearest, address_item)
            spatially_assigned_addresses += 1

    for segment in segments:
        if not segment["addresses"] or any(
            canonical_street_name(address_item["street"]) == segment["canonical_name"]
            for address_item in segment["addresses"]
        ):
            continue
        name = _supported_address_name(
            segment["addresses"],
            2 if segment["has_name_evidence"] else 3,
        )
        if name:
            segment["street_name"] = name
            segment["canonical_name"] = canonical_street_name(name)
            segment["has_name_evidence"] = True
            inferred_roads += 1

    residential_buildings = []
    building_ids = set()
    for item in buildings:
        if (
            item["id"] not in building_ids
            and item["properties"].get("class") in RESIDENTIAL_BUILDING_CLASSES
            and item["geometry"]["type"] in {"Polygon", "MultiPolygon"}
        ):
            residential_buildings.append(item)
            building_ids.add(item["id"])
    fallback_buildings = 0
    unmatched_residential_buildings = 0
    for building in residential_buildings:
        point = _building_point(building["geometry"])
        nearest = _nearest_unambiguous_segment(
            point,
            [
                segment
                for segment in segments
                if segment["road_class"] in candidate_classes
            ],
        )
        if nearest is None:
            unmatched_residential_buildings += 1
            continue
        nearest["residential_building_count"] += 1
        if _building_has_address(building, point, footprint_addresses):
            continue
        nearest["address_count"] += 1
        nearest["homes"].append({"position": point, "address": None})
        fallback_buildings += 1

    building_address_disagreements = sum(
        1
        for segment in segments
        if max(len(segment["addresses"]), segment["residential_building_count"]) >= 5
        and abs(len(segment["addresses"]) - segment["residential_building_count"])
        > max(
            10,
            max(len(segment["addresses"]), segment["residential_building_count"])
            * 0.5,
        )
    )

    segments = [
        split
        for segment in segments
        for split in _split_overfull_segment(segment)
    ]
    source_parts = {}
    for segment in segments:
        source_parts.setdefault(segment["source_id"], []).append(segment)
    for source_segments in source_parts.values():
        source_segments.sort(
            key=lambda segment: (
                segment["part_index"],
                segment.get("capacity_part_index", 0),
            )
        )
        for part_index, segment in enumerate(source_segments):
            segment["part_index"] = part_index
            segment["segment_id"] = f"overture:{segment['source_id']}:{part_index}"

    _assign_road_groups(segments)
    populated_unnamed_roads = len(
        {
            segment["road_group_id"]
            for segment in segments
            if not segment["has_name_evidence"] and segment["address_count"] > 0
        }
    )

    unresolved_counts = {}
    for address_item in footprint_addresses:
        if address_item["index"] not in assigned_address_indexes:
            unresolved_counts[address_item["canonical_name"]] = (
                unresolved_counts.get(address_item["canonical_name"], 0) + 1
            )
    unresolved_clusters = [
        (name, count)
        for name, count in sorted(unresolved_counts.items())
        if count >= 3
    ]
    warnings = []
    if not footprint_addresses and segments:
        warnings.append("No usable address points were available for this territory.")
    elif footprint_addresses:
        assignment_rate = len(assigned_address_indexes) / len(footprint_addresses)
        if assignment_rate < 0.95:
            warnings.append(
                "Address matching is below the 95% reliability target "
                f"({assignment_rate:.1%} matched)."
            )
    if unmatched_residential_buildings:
        warnings.append(
            f"{unmatched_residential_buildings} residential building "
            f"{'footprint' if unmatched_residential_buildings == 1 else 'footprints'} "
            "could not be matched to a road."
        )
    if populated_unnamed_roads:
        warnings.append(
            f"{populated_unnamed_roads} populated road "
            f"{'group' if populated_unnamed_roads == 1 else 'groups'} still "
            f"{'has' if populated_unnamed_roads == 1 else 'have'} no supported street name."
        )
    if building_address_disagreements:
        warnings.append(
            f"{building_address_disagreements} road "
            f"{'group has' if building_address_disagreements == 1 else 'groups have'} "
            "materially different address and residential-building counts."
        )

    result = []
    for segment in sorted(
        segments,
        key=lambda item: (
            item["canonical_name"],
            item["source_id"],
            item["part_index"],
        ),
    ):
        result.append(
            {
                "id": segment["segment_id"],
                "sourceSegmentId": segment["source_id"],
                "roadGroupId": segment["road_group_id"],
                "roadClass": segment["road_class"],
                "streetName": segment["street_name"],
                "geometry": {
                    "type": "LineString",
                    "coordinates": segment["coordinates"],
                },
                "estimatedHomes": segment["address_count"],
                "addresses": sorted(
                    segment["addresses"],
                    key=lambda item: (
                        item["street"].casefold(),
                        item["number"] is None,
                        item["number"] or "",
                        item["postcode"] or "",
                        item["position"],
                    ),
                ),
                "activationKind": (
                    "automatic"
                    if segment["has_name_evidence"]
                    and keep_segment(segment["road_class"], segment["address_count"])
                    else "hidden"
                ),
            }
        )
    return {
        "segments": result,
        "apartmentComplexes": apartment_complexes,
        "quality": {
            "totalAddresses": len(footprint_addresses),
            "assignedAddresses": len(assigned_address_indexes),
            "spatiallyAssignedAddresses": spatially_assigned_addresses,
            "inferredRoads": inferred_roads,
            "unmatchedAddresses": len(footprint_addresses)
            - len(assigned_address_indexes),
            "unresolvedClusters": len(unresolved_clusters),
            "totalResidentialBuildings": len(residential_buildings),
            "fallbackBuildings": fallback_buildings,
            "unmatchedResidentialBuildings": unmatched_residential_buildings,
            "populatedUnnamedRoads": populated_unnamed_roads,
            "buildingAddressDisagreements": building_address_disagreements,
            "warnings": warnings,
        },
    }


def benchmark_classification(
    address_assignment_rate,
    road_representation_rate,
    road_name_accuracy,
    segment_count_accuracy,
    severe_outliers,
    evaluated_segments,
):
    severe_rate = severe_outliers / evaluated_segments if evaluated_segments else 0
    high_confidence_failures = [
        name
        for name, failed in (
            ("addressAssignmentRate", address_assignment_rate < 0.95),
            ("roadRepresentationRate", road_representation_rate < 0.99),
            ("roadNameAccuracy", road_name_accuracy < 0.98),
            ("segmentCountAccuracy", segment_count_accuracy < 0.9),
            ("severeOutlierRate", severe_outliers > 0),
        )
        if failed
    ]
    usable_failures = [
        name
        for name, failed in (
            ("addressAssignmentRate", address_assignment_rate < 0.9),
            ("roadRepresentationRate", road_representation_rate < 0.99),
            ("roadNameAccuracy", road_name_accuracy < 0.9),
            ("segmentCountAccuracy", segment_count_accuracy < 0.85),
            ("severeOutlierRate", severe_rate > 0.03),
        )
        if failed
    ]
    return {
        "severeOutlierRate": severe_rate,
        "highConfidenceFailedMetrics": high_confidence_failures,
        "usableFailedMetrics": usable_failures,
        "classification": (
            "high_confidence"
            if not high_confidence_failures
            else "usable_with_warnings"
            if not usable_failures
            else "below_usable_floor"
        ),
    }


def benchmark_metrics(normalized, reference_addresses):
    reference_groups = {}
    for item in reference_addresses:
        properties = item["properties"]
        key = (
            canonical_street_name(properties["street"]),
            (properties.get("number") or "").strip().casefold(),
            str(properties.get("postcode") or "").strip().casefold(),
        )
        reference_groups.setdefault(key, []).append(item)
    apartment_premises = set()
    for apartment in normalized.get("apartmentComplexes", []):
        address_value = apartment.get("address")
        if not address_value:
            continue
        premise = address_value.split(",", 1)[0].strip().split(maxsplit=1)
        if len(premise) == 2:
            apartment_premises.add(
                (canonical_street_name(premise[1]), premise[0].casefold())
            )
    all_reference = [
        min(
            group,
            key=lambda item: tuple(item["geometry"]["coordinates"]),
        )
        for _, group in sorted(reference_groups.items())
    ]
    reference = [
        item
        for item in all_reference
        if (
            canonical_street_name(item["properties"]["street"]),
            (item["properties"].get("number") or "").strip().casefold(),
        )
        not in apartment_premises
    ]
    duplicate_points_by_key = {
        key: len(group) - 1 for key, group in reference_groups.items()
    }
    segments = [
        {
            "id": item["id"],
            "street_name": item["streetName"],
            "canonical_name": canonical_street_name(item["streetName"]),
            "source_segment_id": item["sourceSegmentId"],
            "coordinates": item["geometry"]["coordinates"],
            "estimated_homes": item["estimatedHomes"],
        }
        for item in normalized["segments"]
    ]
    addresses_by_name = {}
    for item in reference:
        name = canonical_street_name(item["properties"]["street"])
        if name:
            addresses_by_name.setdefault(name, []).append(item)
    known_names = {
        name for name, items in addresses_by_name.items() if len(items) >= 3
    }
    represented_names = set()
    correct_names = set()
    reference_counts = {}
    reference_details = {}
    for name in known_names:
        for item in addresses_by_name[name]:
            point = item["geometry"]["coordinates"]
            nearby = sorted(
                (
                    _distance_to_line(point, segment["coordinates"]),
                    segment["id"],
                    segment,
                )
                for segment in segments
            )
            nearby = [
                candidate
                for candidate in nearby
                if candidate[0] <= MAX_ADDRESS_DISTANCE_METERS
            ]
            if not nearby:
                continue
            represented_names.add(name)
            matching = [
                candidate
                for candidate in nearby
                if _street_names_equivalent(candidate[2]["canonical_name"], name)
            ]
            if matching:
                correct_names.add(name)
                selected = matching[0][2]
            elif len(nearby) == 1 or nearby[1][0] - nearby[0][0] >= SPATIAL_MATCH_MARGIN_METERS:
                selected = nearby[0][2]
            else:
                continue
            reference_counts[selected["id"]] = reference_counts.get(selected["id"], 0) + 1
            key = (
                name,
                (item["properties"].get("number") or "").strip().casefold(),
                str(item["properties"].get("postcode") or "").strip().casefold(),
            )
            reference_details.setdefault(selected["id"], []).append(
                {
                    "point": point,
                    "duplicate_points": duplicate_points_by_key.get(key, 0),
                    "competing_names": sorted(
                        {
                            candidate[2]["street_name"]
                            for candidate in nearby
                            if candidate[2]["street_name"]
                        }
                    ),
                }
            )

    segments_by_id = {segment["id"]: segment for segment in segments}
    accurate_segments = 0
    severe_outliers = 0
    severe_outlier_segments = []
    for segment_id, expected in reference_counts.items():
        segment = segments_by_id[segment_id]
        actual = segment["estimated_homes"]
        error = abs(actual - expected)
        if error <= max(3, expected * 0.2):
            accurate_segments += 1
        if error > max(10, expected * 0.5):
            severe_outliers += 1
            details = reference_details[segment_id]
            severe_outlier_segments.append(
                {
                    "segmentId": segment_id,
                    "sourceSegmentId": segment["source_segment_id"],
                    "streetName": segment["street_name"],
                    "coordinates": segment["coordinates"][0],
                    "competingStreetNames": sorted(
                        {
                            name
                            for detail in details
                            for name in detail["competing_names"]
                        }
                    ),
                    "expectedPremises": expected,
                    "estimatedTracts": actual,
                    "duplicateReferencePoints": sum(
                        detail["duplicate_points"] for detail in details
                    ),
                    "expectedHomes": expected,
                    "estimatedHomes": actual,
                }
            )

    quality = normalized["quality"]
    assignment_rate = (
        quality["assignedAddresses"] / quality["totalAddresses"]
        if quality["totalAddresses"]
        else 0
    )
    road_count = len(known_names)
    represented_rate = len(represented_names) / road_count if road_count else 0
    name_rate = len(correct_names) / road_count if road_count else 0
    evaluated_segments = len(reference_counts)
    segment_accuracy = (
        accurate_segments / evaluated_segments if evaluated_segments else 0
    )
    return {
        "referenceAddresses": len(reference),
        "referencePremises": len(all_reference),
        "apartmentReferencePremises": len(all_reference) - len(reference),
        "rawReferencePoints": len(reference_addresses),
        "duplicateReferencePoints": len(reference_addresses) - len(all_reference),
        "knownResidentialRoads": road_count,
        "representedResidentialRoads": len(represented_names),
        "correctlyNamedResidentialRoads": len(correct_names),
        "unrepresentedRoadNames": sorted(known_names - represented_names),
        "incorrectRoadNames": sorted(represented_names - correct_names),
        "evaluatedSegments": evaluated_segments,
        "accurateSegments": accurate_segments,
        "severeOutliers": severe_outliers,
        "severeOutlierSegments": sorted(
            severe_outlier_segments,
            key=lambda item: item["segmentId"],
        ),
        "addressAssignmentRate": assignment_rate,
        "roadRepresentationRate": represented_rate,
        "roadNameAccuracy": name_rate,
        "segmentCountAccuracy": segment_accuracy,
        **benchmark_classification(
            assignment_rate,
            represented_rate,
            name_rate,
            segment_accuracy,
            severe_outliers,
            evaluated_segments,
        ),
    }


def enclosing_bbox(longitude: float, latitude: float, radius_miles: float):
    angular_distance = radius_miles / EARTH_RADIUS_MILES
    latitude_delta = math.degrees(angular_distance)
    latitude_radians = math.radians(latitude)
    if abs(latitude) + latitude_delta >= 90:
        longitude_delta = 180
    else:
        longitude_delta = math.degrees(
            math.asin(math.sin(angular_distance) / math.cos(latitude_radians))
        )
    # ponytail: read all longitudes at the antimeridian; split the query if that scan matters.
    if longitude - longitude_delta < -180 or longitude + longitude_delta > 180:
        west, east = -180, 180
    else:
        west, east = longitude - longitude_delta, longitude + longitude_delta
    return (
        west,
        max(-90, latitude - latitude_delta),
        east,
        min(90, latitude + latitude_delta),
    )


def query_bbox(connection, path, west, south, east, north):
    bbox_filter = """
        bbox.xmin <= ? AND bbox.xmax >= ?
        AND bbox.ymin <= ? AND bbox.ymax >= ?
    """
    parameters = [east, west, north, south]
    if "theme=transportation/type=segment/" in path:
        rows = connection.execute(
            f"""
            SELECT id, names, class, connectors, ST_AsGeoJSON(geometry)
            FROM read_parquet('{path}', hive_partitioning = true)
            WHERE subtype = 'road' AND {bbox_filter}
            """,
            parameters,
        ).fetchall()
        return [
            {
                "id": source_id,
                "properties": {
                    "names": names,
                    "class": road_class,
                    "connectors": [
                        {
                            "connector_id": connector["connector_id"],
                            "at": connector["at"],
                        }
                        for connector in (connectors or [])
                    ],
                },
                "geometry": json.loads(geometry),
            }
            for source_id, names, road_class, connectors, geometry in rows
        ]

    if "theme=buildings/type=building/" in path:
        retained_classes = ", ".join(
            f"'{value}'"
            for value in sorted(
                RESIDENTIAL_BUILDING_CLASSES | APARTMENT_BUILDING_CLASSES
            )
        )
        rows = connection.execute(
            f"""
            SELECT id, subtype, class, height, num_floors, ST_AsGeoJSON(geometry)
            FROM read_parquet('{path}', hive_partitioning = true)
            WHERE class IN ({retained_classes}) AND {bbox_filter}
            """,
            parameters,
        ).fetchall()
        return [
            {
                "id": source_id,
                "properties": {
                    "subtype": subtype,
                    "class": building_class,
                    "height": height,
                    "num_floors": num_floors,
                },
                "geometry": json.loads(geometry),
            }
            for source_id, subtype, building_class, height, num_floors, geometry in rows
        ]

    rows = connection.execute(
        f"""
        SELECT number, street, postal_city, postcode, unit, address_levels,
          ST_AsGeoJSON(geometry)
        FROM read_parquet('{path}', hive_partitioning = true)
        WHERE street IS NOT NULL AND {bbox_filter}
        """,
        parameters,
    ).fetchall()
    return [
        {
            "properties": {
                "number": number,
                "street": street,
                "postal_city": postal_city,
                "postcode": postcode,
                "unit": unit,
                "address_levels": address_levels or [],
            },
            "geometry": json.loads(geometry),
        }
        for (
            number,
            street,
            postal_city,
            postcode,
            unit,
            address_levels,
            geometry,
        ) in rows
    ]


def download_features(longitude: float, latitude: float, radius_miles: float):
    import duckdb

    west, south, east, north = enclosing_bbox(longitude, latitude, radius_miles)
    connection = duckdb.connect()
    try:
        connection.execute("INSTALL spatial; LOAD spatial; INSTALL httpfs; LOAD httpfs")
        connection.execute("SET s3_region='us-west-2'")
        connection.execute("SET s3_access_key_id=''")
        connection.execute("SET s3_secret_access_key=''")
        connection.execute("SET s3_session_token=''")
        segments = query_bbox(
            connection,
            f"s3://overturemaps-us-west-2/release/{OVERTURE_RELEASE}/"
            "theme=transportation/type=segment/*",
            west,
            south,
            east,
            north,
        )
        addresses = query_bbox(
            connection,
            f"s3://overturemaps-us-west-2/release/{OVERTURE_RELEASE}/"
            "theme=addresses/type=*/*",
            west,
            south,
            east,
            north,
        )
        buildings = query_bbox(
            connection,
            f"s3://overturemaps-us-west-2/release/{OVERTURE_RELEASE}/"
            "theme=buildings/type=building/*",
            west,
            south,
            east,
            north,
        )
        return segments, addresses, buildings
    finally:
        connection.close()


def _finite_float(value):
    number = float(value)
    if not math.isfinite(number):
        raise argparse.ArgumentTypeError("must be finite")
    return number


def _positive_float(value):
    number = _finite_float(value)
    if number <= 0:
        raise argparse.ArgumentTypeError("must be positive")
    return number


def main(argv=None, download=download_features):
    parser = argparse.ArgumentParser()
    parser.add_argument("--longitude", type=_finite_float, required=True)
    parser.add_argument("--latitude", type=_finite_float, required=True)
    parser.add_argument("--radius-miles", type=_positive_float, required=True)
    args = parser.parse_args(argv)
    if not -180 <= args.longitude <= 180 or not -90 <= args.latitude <= 90:
        parser.error("coordinates are out of range")

    with redirect_stdout(sys.stderr):
        roads, addresses, buildings = download(
            args.longitude,
            args.latitude,
            args.radius_miles,
        )
    print(
        json.dumps(
            {
                "release": OVERTURE_RELEASE,
                "center": [args.longitude, args.latitude],
                "radiusMiles": args.radius_miles,
                "completedAt": datetime.now(timezone.utc).isoformat(),
                "normalizerVersion": 9,
                **normalize_features(roads, addresses, buildings),
            },
            separators=(",", ":"),
        )
    )


if __name__ == "__main__":
    main()
