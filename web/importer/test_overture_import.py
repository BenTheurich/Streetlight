import json
import sys
from contextlib import redirect_stderr, redirect_stdout
from io import StringIO
from unittest import TestCase
from unittest.mock import patch

from .overture_import import (
    OVERTURE_RELEASE,
    canonical_street_name,
    download_features,
    enclosing_bbox,
    main,
    normalize_features,
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

        result = normalize_features(roads, [])["segments"]

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

        result = normalize_features(roads, addresses)["segments"]

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

        result = normalize_features(roads, addresses)["segments"]

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

        result = normalize_features(roads, addresses)["segments"]

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

        result = normalize_features(roads, addresses)["segments"]

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

        result = normalize_features(roads, addresses)["segments"]

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

        result = normalize_features(roads, [])["segments"]

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

        result = normalize_features(roads, [])["segments"]

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

        result = normalize_features(roads, [])["segments"]

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

        self.assertEqual(normalize_features(roads, addresses)["segments"], expected)
        self.assertEqual(
            normalize_features(list(reversed(roads)), list(reversed(addresses)))["segments"],
            expected,
        )


class ImportCompletenessTest(TestCase):
    center = [-117.0, 33.5]
    radius_miles = 1

    def test_infers_each_unnamed_hillsdale_source_road_and_assigns_every_address_once(self):
        roads = []
        addresses = []
        address_counts = [7, 7, 7, 8]
        for source_index, address_count in enumerate(address_counts):
            start = -117.002 + source_index * 0.001
            roads.append(
                road(
                    f"hillsdale-{source_index}",
                    "residential",
                    None,
                    [[start, 33.5], [start + 0.001, 33.5]],
                )
            )
            for address_index in range(address_count):
                addresses.append(
                    address(
                        "HILLSDALE HEIGHTS",
                        start + (address_index + 1) * 0.001 / (address_count + 1),
                        33.5001,
                    )
                )

        result = normalize_features(
            roads, addresses, center=self.center, radius_miles=self.radius_miles
        )

        self.assertEqual(
            {segment["streetName"] for segment in result["segments"]},
            {"Hillsdale Heights"},
        )
        self.assertEqual(
            sum(segment["estimatedHomes"] for segment in result["segments"]), 29
        )
        self.assertEqual(result["quality"], {
            "totalAddresses": 29,
            "assignedAddresses": 29,
            "inferredRoads": 4,
            "unmatchedAddresses": 0,
            "unresolvedClusters": 0,
        })

    def test_two_nearby_addresses_do_not_infer_an_unnamed_road(self):
        roads = [
            road("two", "residential", None, [[-117, 33.5], [-116.999, 33.5]])
        ]
        addresses = [
            address("Short Road", -116.9997, 33.5001),
            address("Short Rd", -116.9993, 33.5001),
        ]

        result = normalize_features(
            roads, addresses, center=self.center, radius_miles=self.radius_miles
        )

        self.assertEqual(result["segments"], [])
        self.assertEqual(result["quality"]["inferredRoads"], 0)
        self.assertEqual(result["quality"]["unmatchedAddresses"], 2)

    def test_equal_top_name_counts_do_not_infer_an_unnamed_road(self):
        roads = [
            road("tied", "residential", None, [[-117, 33.5], [-116.999, 33.5]])
        ]
        addresses = [
            address("Maple Road", -116.9998, 33.5001),
            address("Maple Rd", -116.9996, 33.5001),
            address("Oak Road", -116.9994, 33.5001),
            address("Oak Rd", -116.9992, 33.5001),
        ]

        result = normalize_features(
            roads, addresses, center=self.center, radius_miles=self.radius_miles
        )

        self.assertEqual(result["segments"], [])
        self.assertEqual(result["quality"]["inferredRoads"], 0)
        self.assertEqual(result["quality"]["unmatchedAddresses"], 4)

    def test_rejects_three_unresolved_in_circle_addresses_with_the_same_name(self):
        addresses = [
            address("Lost Lane", -116.9998, 33.5),
            address("Lost Ln", -116.9996, 33.5),
            address("Lost Lane", -116.9994, 33.5),
        ]

        with self.assertRaisesRegex(ValueError, r"lost ln: 3"):
            normalize_features(
                [], addresses, center=self.center, radius_miles=self.radius_miles
            )

    def test_out_of_circle_addresses_do_not_enter_the_unresolved_gate(self):
        addresses = [
            address("Outside Lane", -116.9, 33.5),
            address("Outside Ln", -116.8998, 33.5),
            address("Outside Lane", -116.8996, 33.5),
        ]

        result = normalize_features(
            [], addresses, center=self.center, radius_miles=self.radius_miles
        )

        self.assertEqual(result["quality"], {
            "totalAddresses": 0,
            "assignedAddresses": 0,
            "inferredRoads": 0,
            "unmatchedAddresses": 0,
            "unresolvedClusters": 0,
        })


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

    def test_download_sets_s3_region_before_bbox_queries_and_returns_complete_inputs(self):
        class Result:
            def __init__(self, rows):
                self.rows = rows

            def fetchall(self):
                return self.rows

        class Connection:
            def __init__(self):
                self.calls = []

            def execute(self, sql, parameters=None):
                self.calls.append((sql, parameters))
                if parameters is None:
                    return Result([])
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

            def close(self):
                pass

        connection = Connection()
        with patch.dict(
            sys.modules,
            {"duckdb": type("DuckDB", (), {"connect": lambda: connection})},
        ):
            roads, addresses = download_features(0, 0, 1)

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
        self.assertEqual(
            connection.calls[:5],
            [
                ("INSTALL spatial; LOAD spatial; INSTALL httpfs; LOAD httpfs", None),
                ("SET s3_region='us-west-2'", None),
                ("SET s3_access_key_id=''", None),
                ("SET s3_secret_access_key=''", None),
                ("SET s3_session_token=''", None),
            ],
        )
        bbox_calls = connection.calls[5:]
        for sql, parameters in bbox_calls:
            self.assertIn("bbox.xmin <= ?", sql)
            self.assertIn("bbox.xmax >= ?", sql)
            self.assertIn("bbox.ymin <= ?", sql)
            self.assertIn("bbox.ymax >= ?", sql)
            self.assertNotIn("ST_Clip", sql)
            self.assertEqual(len(parameters), 4)
            for actual, expected in zip(
                parameters,
                [0.014473158, -0.014473158, 0.014473158, -0.014473158],
            ):
                self.assertAlmostEqual(actual, expected, places=9)
        road_sql = bbox_calls[0][0]
        self.assertIn("id, names, class, connectors", road_sql)
        self.assertIn("subtype = 'road'", road_sql)
        self.assertNotIn("sources", road_sql)
        self.assertNotIn("ORDER BY id", road_sql)
        address_sql = bbox_calls[1][0]
        self.assertIn("theme=addresses/type=*/*", address_sql)
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
        self.assertEqual(parsed["normalizerVersion"], 2)
        self.assertEqual(parsed["quality"], {
            "totalAddresses": 0,
            "assignedAddresses": 0,
            "inferredRoads": 0,
            "unmatchedAddresses": 0,
            "unresolvedClusters": 0,
        })
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
