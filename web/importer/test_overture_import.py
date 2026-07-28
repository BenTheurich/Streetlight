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


def address(
    street,
    longitude,
    latitude,
    number=None,
    postal_city=None,
    postcode=None,
    address_levels=None,
):
    return {
        "properties": {
            "street": street,
            "number": number,
            "postal_city": postal_city,
            "postcode": postcode,
            "address_levels": address_levels or [],
        },
        "geometry": {"type": "Point", "coordinates": [longitude, latitude]},
    }


class NormalizeFeaturesTest(TestCase):
    def test_canonical_names_ignore_case_punctuation_and_suffix_spelling(self):
        self.assertEqual(canonical_street_name("Jons Place"), "jons pl")
        self.assertEqual(canonical_street_name("JONS PL."), "jons pl")

    def test_preserves_assigned_address_components_without_units(self):
        roads = [
            road(
                "road-1",
                "residential",
                "Sample Road",
                [[0, 0], [0.001, 0]],
            )
        ]
        addresses = [
            address(
                "Sample Road",
                0.00025,
                0.00005,
                number="10",
                postal_city="Temecula",
                postcode="92591",
                address_levels=[
                    {"value": "California"},
                    {"value": "Temecula"},
                ],
            ),
            address(
                "Sample Road",
                0.00075,
                0.00005,
                address_levels=[
                    {"value": "California"},
                    {"value": "Murrieta"},
                ],
            ),
        ]

        segment = normalize_features(roads, addresses)["segments"][0]

        self.assertEqual(segment["estimatedHomes"], 2)
        self.assertEqual(
            segment["addresses"],
            [
                {
                    "number": "10",
                    "street": "Sample Road",
                    "locality": "Temecula",
                    "postcode": "92591",
                    "position": [0.00025, 0.00005],
                },
                {
                    "number": None,
                    "street": "Sample Road",
                    "locality": "Murrieta",
                    "postcode": None,
                    "position": [0.00075, 0.00005],
                },
            ],
        )

    def test_retains_uncertain_overture_roads_as_hidden_candidates(self):
        roads = [
            road("residential", "residential", "Home Road", [[0, 0], [0.001, 0]]),
            road("service", "service", "Access Road", [[0, 0.001], [0.001, 0.001]]),
            road("motorway", "motorway", "Freeway", [[0, 0.002], [0.001, 0.002]]),
        ]

        result = normalize_features(roads, [])["segments"]

        self.assertEqual(
            [
                (segment["sourceSegmentId"], segment.get("activationKind"))
                for segment in result
            ],
            [
                ("service", "hidden"),
                ("motorway", "hidden"),
                ("residential", "automatic"),
            ],
        )

    def test_groups_connected_named_source_roads_without_joining_disconnected_namesakes(self):
        roads = [
            road("west", "residential", "Shared Road", [[0, 0], [0.001, 0]]),
            road("east", "residential", "Shared Rd", [[0.001, 0], [0.002, 0]]),
            road("separate", "residential", "Shared Road", [[0.01, 0], [0.011, 0]]),
        ]

        result = normalize_features(roads, [])["segments"]
        groups = {
            segment["sourceSegmentId"]: segment.get("roadGroupId")
            for segment in result
        }

        self.assertIsNotNone(groups["west"])
        self.assertEqual(groups["west"], groups["east"])
        self.assertNotEqual(groups["west"], groups["separate"])

    def test_unnamed_groups_continue_only_through_unbranched_unnamed_connections(self):
        roads = [
            road("chain-a", "service", None, [[0, 0], [0.001, 0]]),
            road("chain-b", "service", None, [[0.001, 0], [0.002, 0]]),
            road("branch-a", "service", None, [[0.01, 0], [0.011, 0]]),
            road("branch-b", "service", None, [[0.011, 0], [0.012, 0]]),
            road("branch-c", "service", None, [[0.011, 0], [0.011, 0.001]]),
            road("named-stop", "residential", "Named Road", [[0.02, 0], [0.021, 0]]),
            road("stop-a", "service", None, [[0.019, 0], [0.02, 0]]),
            road("stop-b", "service", None, [[0.02, 0], [0.02, 0.001]]),
        ]

        result = normalize_features(roads, [])["segments"]
        groups = {
            segment["sourceSegmentId"]: segment["roadGroupId"]
            for segment in result
        }

        self.assertEqual(groups["chain-a"], groups["chain-b"])
        self.assertEqual(
            len({groups["branch-a"], groups["branch-b"], groups["branch-c"]}),
            3,
        )
        self.assertNotEqual(groups["stop-a"], groups["stop-b"])

    def test_retains_roads_without_a_name_as_hidden_candidates(self):
        missing = road("missing", "residential", "ignored", [[0, 0], [0.001, 0]])
        del missing["properties"]["names"]
        roads = [
            missing,
            road("null", "residential", None, [[0, 0.001], [0.001, 0.001]]),
            road("blank", "residential", " -- ", [[0, 0.002], [0.001, 0.002]]),
            road("named", "residential", "Named Road", [[0, 0.003], [0.001, 0.003]]),
        ]

        result = normalize_features(roads, [])["segments"]

        self.assertEqual(
            {
                item["sourceSegmentId"]: (item["streetName"], item["activationKind"])
                for item in result
            },
            {
                "blank": ("Unnamed road", "hidden"),
                "missing": ("Unnamed road", "hidden"),
                "named": ("Named Road", "automatic"),
                "null": ("Unnamed road", "hidden"),
            },
        )

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
            [(item["streetName"], item["activationKind"]) for item in result],
            [
                ("Calle Medusa", "automatic"),
                ("Empty Avenue", "hidden"),
                ("Loading Road", "hidden"),
                ("Quiet Lane", "automatic"),
            ],
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
            [(item["roadClass"], item["activationKind"]) for item in result],
            [
                ("motorway", "hidden"),
                ("primary", "automatic"),
                ("secondary", "automatic"),
                ("unclassified", "automatic"),
            ],
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
            [
                (
                    item["sourceSegmentId"],
                    item["estimatedHomes"],
                    item["activationKind"],
                )
                for item in result
            ],
            [("eligible", 1, "automatic"), ("service", 0, "hidden")],
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
            [
                (
                    item["sourceSegmentId"],
                    item["estimatedHomes"],
                    item["activationKind"],
                )
                for item in result
            ],
            [("far", 0, "hidden"), ("near", 1, "automatic")],
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
                "roadGroupId": "road-group:overture:a:0",
                "roadClass": "residential",
                "streetName": "Alpha Avenue",
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[0, 0], [0.001, 0]],
                },
                "estimatedHomes": 1,
                "addresses": [
                    {
                        "number": None,
                        "street": "Alpha Avenue",
                        "locality": None,
                        "postcode": None,
                        "position": [0.0005, 0.00005],
                    }
                ],
                "activationKind": "automatic",
            },
            {
                "id": "overture:a:1",
                "sourceSegmentId": "a",
                "roadGroupId": "road-group:overture:a:1",
                "roadClass": "residential",
                "streetName": "Alpha Avenue",
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[0, 0.001], [0.001, 0.001]],
                },
                "estimatedHomes": 1,
                "addresses": [
                    {
                        "number": None,
                        "street": "Alpha Ave.",
                        "locality": None,
                        "postcode": None,
                        "position": [0.0005, 0.00105],
                    }
                ],
                "activationKind": "automatic",
            },
            {
                "id": "overture:z:0",
                "sourceSegmentId": "z",
                "roadGroupId": "road-group:overture:z:0",
                "roadClass": "living_street",
                "streetName": "Zulu Road",
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[0, 0.003], [0.001, 0.003]],
                },
                "estimatedHomes": 0,
                "addresses": [],
                "activationKind": "automatic",
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

        result = normalize_features(roads, addresses)

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

        result = normalize_features(roads, addresses)

        self.assertEqual(
            [
                (segment["streetName"], segment["activationKind"])
                for segment in result["segments"]
            ],
            [("Unnamed road", "hidden")],
        )
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

        result = normalize_features(roads, addresses)

        self.assertEqual(
            [
                (segment["streetName"], segment["activationKind"])
                for segment in result["segments"]
            ],
            [("Unnamed road", "hidden")],
        )
        self.assertEqual(result["quality"]["inferredRoads"], 0)
        self.assertEqual(result["quality"]["unmatchedAddresses"], 4)

    def test_blank_nearby_address_prevents_eighty_percent_unnamed_road_inference(self):
        roads = [
            road("blank", "residential", None, [[-117, 33.5], [-116.999, 33.5]])
        ]
        addresses = [
            address("Main Road", -116.9998, 33.5001),
            address("Main Rd", -116.9996, 33.5001),
            address("Main Road", -116.9994, 33.5001),
            address("", -116.9992, 33.5001),
        ]

        result = normalize_features(roads, addresses)

        self.assertEqual(result["segments"][0]["activationKind"], "hidden")
        self.assertEqual(result["quality"]["unresolvedClusters"], 1)

    def test_reports_three_unresolved_addresses_without_rejecting_the_import(self):
        addresses = [
            address("Lost Lane", -116.9998, 33.5),
            address("Lost Ln", -116.9996, 33.5),
            address("Lost Lane", -116.9994, 33.5),
        ]

        try:
            result = normalize_features([], addresses)
        except ValueError as error:
            self.fail(f"valid import was rejected: {error}")

        self.assertEqual(result["segments"], [])
        self.assertEqual(result["quality"]["unmatchedAddresses"], 3)
        self.assertEqual(result["quality"]["unresolvedClusters"], 1)

    def test_bounding_box_corner_addresses_are_normalized_outside_the_circle(self):
        roads = [
            road(
                "corner",
                "residential",
                "Corner Lane",
                [[-116.988, 33.512], [-116.987, 33.513]],
            )
        ]
        addresses = [
            address("Corner Lane", -116.9875, 33.5125),
        ]

        result = normalize_features(roads, addresses)

        self.assertEqual(result["quality"], {
            "totalAddresses": 1,
            "assignedAddresses": 1,
            "inferredRoads": 0,
            "unmatchedAddresses": 0,
            "unresolvedClusters": 0,
        })
        self.assertEqual(result["segments"][0]["estimatedHomes"], 1)


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
                            "10",
                            "Main Street",
                            "Temecula",
                            "92591",
                            [
                                {"value": "California"},
                                {"value": "Temecula"},
                            ],
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
        self.assertEqual(
            addresses,
            [
                address(
                    "Main Street",
                    0.25,
                    0.0001,
                    number="10",
                    postal_city="Temecula",
                    postcode="92591",
                    address_levels=[
                        {"value": "California"},
                        {"value": "Temecula"},
                    ],
                )
            ],
        )
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
        self.assertIn("number", address_sql)
        self.assertIn("postal_city", address_sql)
        self.assertIn("postcode", address_sql)
        self.assertIn("address_levels", address_sql)
        self.assertNotIn("unit", address_sql)
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
        self.assertEqual(parsed["normalizerVersion"], 5)
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
