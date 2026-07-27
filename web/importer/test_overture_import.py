import json
from contextlib import redirect_stderr, redirect_stdout
from io import StringIO
from unittest import TestCase

from .overture_import import (
    OVERTURE_RELEASE,
    canonical_street_name,
    enclosing_bbox,
    main,
    normalize_features,
    query_bbox,
)


def road(
    source_id,
    road_class,
    name,
    coordinates,
    geometry_type="LineString",
    connectors=None,
):
    feature = {
        "id": source_id,
        "properties": {"class": road_class, "names": {"primary": name}},
        "geometry": {"type": geometry_type, "coordinates": coordinates},
    }
    if connectors is not None:
        feature["properties"]["connectors"] = connectors
    return feature


def address(street, longitude, latitude):
    return {
        "properties": {"street": street},
        "geometry": {"type": "Point", "coordinates": [longitude, latitude]},
    }


class NormalizeFeaturesTest(TestCase):
    def test_canonical_names_ignore_case_punctuation_and_suffix_spelling(self):
        self.assertEqual(canonical_street_name("Jons Place"), "jons pl")
        self.assertEqual(canonical_street_name("JONS PL."), "jons pl")

    def test_skips_roads_without_a_nonempty_primary_display_name(self):
        missing = road("missing", "residential", "ignored", [[0, 0], [0.001, 0]])
        del missing["properties"]["names"]
        roads = [
            missing,
            road("null", "residential", None, [[0, 0.001], [0.001, 0.001]]),
            road("blank", "residential", " -- ", [[0, 0.002], [0.001, 0.002]]),
            road("named", "residential", "Named Road", [[0, 0.003], [0.001, 0.003]]),
        ]

        result = normalize_features(roads, [])

        self.assertEqual([item["sourceSegmentId"] for item in result], ["named"])

    def test_keeps_residential_without_addresses_and_tertiary_only_with_an_address(self):
        roads = [
            road("r1", "residential", "Quiet Lane", [[0, 0], [0.001, 0]]),
            road(
                "r2",
                "tertiary",
                "Calle Medusa",
                [[0, 0.001], [0.001, 0.001]],
            ),
            road(
                "r3",
                "tertiary",
                "Empty Avenue",
                [[0, 0.002], [0.001, 0.002]],
            ),
            road(
                "r4",
                "service",
                "Loading Road",
                [[0, 0.003], [0.001, 0.003]],
            ),
        ]
        addresses = [address("Calle Medusa", 0.0005, 0.00105)]

        result = normalize_features(roads, addresses)

        self.assertEqual(
            [item["streetName"] for item in result],
            ["Calle Medusa", "Quiet Lane"],
        )
        self.assertEqual(result[0]["estimatedHomes"], 1)

    def test_address_backed_filter_includes_every_approved_major_road_class(self):
        roads = [
            road(
                road_class,
                road_class,
                f"{road_class.title()} Road",
                [[0, index * 0.001], [0.001, index * 0.001]],
            )
            for index, road_class in enumerate(
                ["primary", "secondary", "unclassified", "motorway"]
            )
        ]
        addresses = [
            address(f"{road_class.title()} Rd", 0.0005, index * 0.00105)
            for index, road_class in enumerate(
                ["primary", "secondary", "unclassified", "motorway"]
            )
        ]

        result = normalize_features(roads, addresses)

        self.assertEqual(
            [item["roadClass"] for item in result],
            ["primary", "secondary", "unclassified"],
        )

    def test_assigns_each_address_once_to_nearest_same_canonical_street(self):
        roads = [
            road("r1", "residential", "Jons Place", [[0, 0], [0.001, 0]]),
            road(
                "r2",
                "residential",
                "JONS PL.",
                [[0, 0.0002], [0.001, 0.0002]],
            ),
            road(
                "r3",
                "residential",
                "Other Street",
                [[0, 0.00017], [0.001, 0.00017]],
            ),
        ]
        addresses = [address("Jons Pl", 0.0005, 0.00017)]

        result = normalize_features(roads, addresses)

        self.assertEqual(
            [(item["id"], item["estimatedHomes"]) for item in result],
            [
                ("overture:r1:0", 0),
                ("overture:r2:0", 1),
                ("overture:r3:0", 0),
            ],
        )

    def test_ineligible_same_named_road_cannot_consume_an_address(self):
        roads = [
            road("eligible", "tertiary", "Shared Road", [[0, 0], [0.001, 0]]),
            road(
                "service",
                "service",
                "Shared Road",
                [[0, 0.0001], [0.001, 0.0001]],
            ),
        ]
        addresses = [address("Shared Rd", 0.0005, 0.0001)]

        result = normalize_features(roads, addresses)

        self.assertEqual(
            [(item["sourceSegmentId"], item["estimatedHomes"]) for item in result],
            [("eligible", 1)],
        )

    def test_rejects_same_street_addresses_beyond_forty_meters(self):
        roads = [
            road("near", "tertiary", "Near Road", [[0, 0], [0.001, 0]]),
            road("far", "tertiary", "Far Road", [[0, 0.001], [0.001, 0.001]]),
        ]
        addresses = [
            address("Near Rd", 0.0005, 0.00035),
            address("Far Rd", 0.0005, 0.00137),
        ]

        result = normalize_features(roads, addresses)

        self.assertEqual(
            [(item["sourceSegmentId"], item["estimatedHomes"]) for item in result],
            [("near", 1)],
        )

    def test_splits_at_turns_of_at_least_eighty_five_degrees(self):
        roads = [
            road(
                "turn",
                "residential",
                "Bent Lane",
                [
                    [-117, 33.5],
                    [-116.999, 33.5],
                    [-116.9989059115, 33.5009969173],
                ],
            )
        ]

        result = normalize_features(roads, [])

        self.assertEqual(
            [(item["id"], item["geometry"]["coordinates"]) for item in result],
            [
                ("overture:turn:0", [[-117, 33.5], [-116.999, 33.5]]),
                (
                    "overture:turn:1",
                    [
                        [-116.999, 33.5],
                        [-116.9989059115, 33.5009969173],
                    ],
                ),
            ],
        )

    def test_visual_crossing_without_connectors_does_not_split_roads(self):
        roads = [
            road("main", "residential", "Main Street", [[-0.001, 0], [0.001, 0]]),
            road(
                "cross",
                "residential",
                "Cross Street",
                [[0, -0.001], [0, 0.001]],
            ),
        ]

        result = normalize_features(roads, [])

        self.assertEqual(
            [(item["id"], item["geometry"]["coordinates"]) for item in result],
            [
                ("overture:cross:0", [[0, -0.001], [0, 0.001]]),
                ("overture:main:0", [[-0.001, 0], [0.001, 0]]),
            ],
        )

    def test_splits_at_interior_connector_linear_references(self):
        roads = [
            road(
                "connected",
                "residential",
                "Connected Road",
                [[0, 0], [0.002, 0]],
                connectors=[
                    {"connector_id": "start", "at": 0.0},
                    {"connector_id": "junction", "at": 0.5},
                    {"connector_id": "end", "at": 1.0},
                ],
            )
        ]

        result = normalize_features(roads, [])

        self.assertEqual(
            [(item["id"], item["geometry"]["coordinates"]) for item in result],
            [
                ("overture:connected:0", [[0, 0], [0.001, 0.0]]),
                ("overture:connected:1", [[0.001, 0.0], [0.002, 0]]),
            ],
        )

    def test_multilines_produce_stable_order_ids_and_exact_output_contract(self):
        roads = [
            road("z", "living_street", "Zulu Road", [[0, 0.003], [0.001, 0.003]]),
            road(
                "a",
                "residential",
                "Alpha Avenue",
                [
                    [[0, 0], [0.001, 0]],
                    [[0, 0.001], [0.001, 0.001]],
                ],
                "MultiLineString",
            ),
        ]
        addresses = [
            address("Alpha Ave.", 0.0005, 0.00105),
            address("Alpha Avenue", 0.0005, 0.00005),
        ]
        expected = [
            {
                "id": "overture:a:0",
                "sourceSegmentId": "a",
                "roadClass": "residential",
                "streetName": "Alpha Avenue",
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[0, 0], [0.001, 0]],
                },
                "estimatedHomes": 1,
            },
            {
                "id": "overture:a:1",
                "sourceSegmentId": "a",
                "roadClass": "residential",
                "streetName": "Alpha Avenue",
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[0, 0.001], [0.001, 0.001]],
                },
                "estimatedHomes": 1,
            },
            {
                "id": "overture:z:0",
                "sourceSegmentId": "z",
                "roadClass": "living_street",
                "streetName": "Zulu Road",
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[0, 0.003], [0.001, 0.003]],
                },
                "estimatedHomes": 0,
            },
        ]

        self.assertEqual(normalize_features(roads, addresses), expected)
        self.assertEqual(
            normalize_features(list(reversed(roads)), list(reversed(addresses))),
            expected,
        )


class ImportBoundaryTest(TestCase):
    def test_enclosing_bbox_contains_the_circle_at_the_requested_latitude(self):
        west, south, east, north = enclosing_bbox(-117.1274, 33.5107, 1)

        self.assertAlmostEqual(west, -117.144758, places=6)
        self.assertAlmostEqual(south, 33.496227, places=6)
        self.assertAlmostEqual(east, -117.110042, places=6)
        self.assertAlmostEqual(north, 33.525173, places=6)

    def test_enclosing_bbox_covers_both_sides_of_the_antimeridian(self):
        west, _, east, _ = enclosing_bbox(179.99, 0, 1)

        self.assertEqual((west, east), (-180, 180))

    def test_query_bbox_uses_bbox_columns_and_returns_complete_normalizer_inputs(self):
        class Result:
            def __init__(self, rows):
                self.rows = rows

            def fetchall(self):
                return self.rows

        class Connection:
            def __init__(self):
                self.calls = []

            def execute(self, sql, parameters):
                self.calls.append((sql, parameters))
                if "theme=transportation" in sql:
                    return Result(
                        [
                            (
                                "road-1",
                                {"primary": "Main Street"},
                                "residential",
                                [
                                    {"connector_id": "start", "at": 0.0},
                                    {"connector_id": "junction", "at": 0.5},
                                ],
                                '{"type":"LineString","coordinates":[[-1,0],[0,0],[1,0]]}',
                            )
                        ]
                    )
                return Result(
                    [
                        (
                            "Main Street",
                            '{"type":"Point","coordinates":[0.25,0.0001]}',
                        )
                    ]
                )

        connection = Connection()
        roads = query_bbox(
            connection,
            "s3://bucket/theme=transportation/type=segment/*",
            -1,
            -2,
            3,
            4,
        )
        addresses = query_bbox(
            connection,
            "s3://bucket/theme=addresses/type=address/*",
            -1,
            -2,
            3,
            4,
        )

        self.assertEqual(
            roads,
            [
                road(
                    "road-1",
                    "residential",
                    "Main Street",
                    [[-1, 0], [0, 0], [1, 0]],
                    connectors=[
                        {"connector_id": "start", "at": 0.0},
                        {"connector_id": "junction", "at": 0.5},
                    ],
                )
            ],
        )
        self.assertEqual(addresses, [address("Main Street", 0.25, 0.0001)])
        for sql, parameters in connection.calls:
            self.assertIn("bbox.xmin <= ?", sql)
            self.assertIn("bbox.xmax >= ?", sql)
            self.assertIn("bbox.ymin <= ?", sql)
            self.assertIn("bbox.ymax >= ?", sql)
            self.assertNotIn("ST_Clip", sql)
            self.assertEqual(parameters, [3, -1, 4, -2])
        road_sql = connection.calls[0][0]
        self.assertIn("id, names, class, connectors", road_sql)
        self.assertIn("subtype = 'road'", road_sql)
        self.assertNotIn("sources", road_sql)
        address_sql = connection.calls[1][0]
        self.assertIn("street", address_sql)
        self.assertNotIn("number", address_sql)
        self.assertNotIn("ORDER BY id", address_sql)

    def test_cli_parses_arguments_and_prints_one_json_object(self):
        output = StringIO()

        def download(longitude, latitude, radius_miles):
            self.assertEqual((longitude, latitude, radius_miles), (-117.1274, 33.5107, 1))
            return (
                [
                    road(
                        "road-1",
                        "residential",
                        "Main Street",
                        [[-117.13, 33.51], [-117.12, 33.51]],
                    )
                ],
                [],
            )

        with redirect_stdout(output):
            main(
                [
                    "--longitude",
                    "-117.1274",
                    "--latitude",
                    "33.5107",
                    "--radius-miles",
                    "1",
                ],
                download=download,
            )

        parsed = json.loads(output.getvalue())
        self.assertEqual(parsed["release"], OVERTURE_RELEASE)
        self.assertEqual(parsed["center"], [-117.1274, 33.5107])
        self.assertEqual(parsed["radiusMiles"], 1)
        self.assertEqual(parsed["segments"][0]["id"], "overture:road-1:0")
        self.assertEqual(output.getvalue().count("\n"), 1)

    def test_cli_rejects_nonpositive_radius_before_downloading(self):
        with redirect_stderr(StringIO()):
            with self.assertRaises(SystemExit):
                main(
                    [
                        "--longitude",
                        "-117.1274",
                        "--latitude",
                        "33.5107",
                        "--radius-miles",
                        "0",
                    ],
                    download=lambda *_: self.fail("download should not run"),
                )
