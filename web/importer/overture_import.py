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
OVERTURE_RELEASE = "2026-06-17.0"
TURN_SPLIT_DEGREES = 85
EARTH_RADIUS_MILES = 3958.7613
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


def canonical_street_name(value: str) -> str:
    words = re.sub(r"[^a-z0-9 ]", " ", value.lower()).split()
    return " ".join(SUFFIXES.get(word, word) for word in words)


def _inferred_display_name(value):
    return " ".join(
        DISPLAY_SUFFIXES.get(word, word.title())
        for word in canonical_street_name(value).split()
    )


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


def normalize_features(roads, addresses, center=None, radius_miles=None):
    segments = []
    candidate_classes = ALWAYS_KEEP | KEEP_WITH_ADDRESS
    footprint_addresses = [
        {
            "index": index,
            "street": address_feature["properties"]["street"],
            "canonical_name": canonical_street_name(
                address_feature["properties"]["street"]
            ),
            "point": address_feature["geometry"]["coordinates"],
        }
        for index, address_feature in enumerate(addresses)
    ]
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
            name_counts = {}
            for address_item in nearby:
                if address_item["canonical_name"]:
                    name_counts[address_item["canonical_name"]] = (
                        name_counts.get(address_item["canonical_name"], 0) + 1
                    )
            ranked_names = sorted(
                name_counts.items(), key=lambda item: (-item[1], item[0])
            )
            if ranked_names:
                inferred_name, inferred_count = ranked_names[0]
                runner_up_count = ranked_names[1][1] if len(ranked_names) > 1 else 0
                if (
                    inferred_count >= 3
                    and inferred_count / len(nearby) >= 0.8
                    and inferred_count > runner_up_count
                ):
                    raw_counts = {}
                    for address_item in nearby:
                        if address_item["canonical_name"] == inferred_name:
                            raw_counts[address_item["street"]] = (
                                raw_counts.get(address_item["street"], 0) + 1
                            )
                    raw_name = min(
                        raw_counts, key=lambda value: (-raw_counts[value], value.casefold(), value)
                    )
                    name = _inferred_display_name(raw_name)
                    inferred_roads += 1
        has_name_evidence = name is not None
        if name is None:
            name = "Unnamed road"
        connector_parts = _connector_parts(
            _lines(road_feature["geometry"]),
            road_feature["properties"].get("connectors", []),
        )
        parts = [
            part
            for line_parts in connector_parts
            for connector_part in line_parts
            for part in _split_turns(connector_part)
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
                }
            )

    assigned_address_indexes = set()
    for address_item in footprint_addresses:
        candidates = [
            segment
            for segment in segments
            if segment["road_class"] in candidate_classes
            and segment["has_name_evidence"]
            and segment["canonical_name"] == address_item["canonical_name"]
        ]
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
                <= MAX_ADDRESS_DISTANCE_METERS
            ):
                nearest["address_count"] += 1
                assigned_address_indexes.add(address_item["index"])

    _assign_road_groups(segments)

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
        "quality": {
            "totalAddresses": len(footprint_addresses),
            "assignedAddresses": len(assigned_address_indexes),
            "inferredRoads": inferred_roads,
            "unmatchedAddresses": len(footprint_addresses)
            - len(assigned_address_indexes),
            "unresolvedClusters": len(unresolved_clusters),
        },
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

    rows = connection.execute(
        f"""
        SELECT street, ST_AsGeoJSON(geometry)
        FROM read_parquet('{path}', hive_partitioning = true)
        WHERE street IS NOT NULL AND {bbox_filter}
        """,
        parameters,
    ).fetchall()
    return [
        {
            "properties": {"street": street},
            "geometry": json.loads(geometry),
        }
        for street, geometry in rows
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
        return segments, addresses
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
        roads, addresses = download(
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
                "normalizerVersion": 4,
                **normalize_features(
                    roads,
                    addresses,
                    center=[args.longitude, args.latitude],
                    radius_miles=args.radius_miles,
                ),
            },
            separators=(",", ":"),
        )
    )


if __name__ == "__main__":
    main()
