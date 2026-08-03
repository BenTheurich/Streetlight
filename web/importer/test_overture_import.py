import json
import sys
from contextlib import redirect_stderr, redirect_stdout
from io import StringIO
from tempfile import TemporaryDirectory
from unittest import TestCase
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse

from . import overture_import as importer_module
from . import run_benchmark as benchmark_module
from .overture_import import (
    OVERTURE_RELEASE,
    SpatialIndex,
    canonical_street_name,
    download_fema_features,
    download_features,
    enclosing_bbox,
    main,
    normalize_features,
    select_map_buildings,
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
    unit=None,
    source_id=None,
):
    feature = {
        "properties": {
            "street": street,
            "number": number,
            "postal_city": postal_city,
            "postcode": postcode,
            "address_levels": address_levels or [],
            "unit": unit,
        },
        "geometry": {"type": "Point", "coordinates": [longitude, latitude]},
    }
    if source_id is not None:
        feature["id"] = source_id
    return feature


def building(
    source_id,
    building_class,
    coordinates,
    height=None,
    num_floors=None,
):
    return {
        "id": source_id,
        "properties": {
            "class": building_class,
            "subtype": "building",
            "height": height,
            "num_floors": num_floors,
        },
        "geometry": {"type": "Polygon", "coordinates": [coordinates]},
    }


def box(center_x_meters, center_y_meters, width_meters=10, height_meters=10):
    half_width = width_meters / 2 / 111_320
    half_height = height_meters / 2 / 111_320
    center_x = center_x_meters / 111_320
    center_y = center_y_meters / 111_320
    return [
        [center_x - half_width, center_y - half_height],
        [center_x + half_width, center_y - half_height],
        [center_x + half_width, center_y + half_height],
        [center_x - half_width, center_y + half_height],
        [center_x - half_width, center_y - half_height],
    ]


def fema_building(source_id, coordinates):
    return {
        "id": source_id,
        "geometry": {"type": "Polygon", "coordinates": [coordinates]},
        "properties": {
            "PRIM_OCC": "Single Family Dwelling",
            "OUTBLDG": None,
            "SOURCE": "FEMA",
            "PROD_DATE": None,
            "IMAGE_DATE": None,
        },
    }


class NormalizeFeaturesTest(TestCase):
    def test_spatial_index_finds_stable_candidates_across_cell_edges(self):
        meters = lambda value: value / 111_320
        features = [
            {"id": "left", "bbox": [meters(44), -0.001, meters(46), 0.001]},
            {"id": "right", "bbox": [meters(53), -0.001, meters(55), 0.001]},
            {"id": "distant", "bbox": [meters(99), -0.001, meters(101), 0.001]},
        ]

        index = SpatialIndex(
            list(reversed(features)),
            lambda item: item["bbox"],
            cell_meters=50,
        )

        self.assertEqual(
            [item["id"] for item in index.nearby([meters(50), 0], 10)],
            ["left", "right"],
        )

    def test_spatial_index_queries_bounds_with_padding(self):
        meters = lambda value: value / 111_320
        features = [
            {"id": "inside", "bbox": [meters(40), -0.001, meters(42), 0.001]},
            {"id": "edge", "bbox": [meters(53), -0.001, meters(55), 0.001]},
            {"id": "outside", "bbox": [meters(80), -0.001, meters(82), 0.001]},
        ]
        index = SpatialIndex(features, lambda item: item["bbox"], cell_meters=50)

        self.assertEqual(
            [
                item["id"]
                for item in index.intersecting(
                    [meters(43), -0.0001, meters(50), 0.0001],
                    padding_meters=5,
                )
            ],
            ["edge", "inside"],
        )

    def test_separates_apartment_buildings_and_five_unit_premises_from_street_counts(self):
        roads = [
            road("road-1", "residential", "Sample Road", [[0, 0], [0.001, 0]])
        ]
        addresses = [
            *[
                address(
                    "Sample Road",
                    0.0002,
                    0.00005,
                    number="10",
                    postal_city="Example",
                    postcode="12345",
                    unit=str(unit),
                )
                for unit in range(1, 3)
            ],
            *[
                address(
                    "Sample Road",
                    0.0007,
                    0.00005,
                    number="20",
                    postal_city="Example",
                    postcode="12345",
                    unit=str(unit),
                )
                for unit in range(1, 6)
            ],
            *[
                address(
                    "Sample Road",
                    0.0009,
                    0.00005,
                    number="30",
                    postal_city="Example",
                    postcode="12345",
                    unit=str(unit),
                )
                for unit in range(1, 5)
            ],
        ]
        buildings = [
            building(
                "apartment-building",
                "apartments",
                [
                    [0.0001, 0],
                    [0.0003, 0],
                    [0.0003, 0.0001],
                    [0.0001, 0.0001],
                    [0.0001, 0],
                ],
            )
        ]

        result = normalize_features(roads, addresses, buildings)

        self.assertEqual(result["segments"][0]["estimatedHomes"], 1)
        self.assertEqual(
            result["apartmentComplexes"],
            [
                {
                    "id": "overture-apartment-building:apartment-building",
                    "sourceId": "apartment-building",
                    "address": "10 Sample Road, Example, 12345",
                    "position": [0.0002, 0.00005],
                    "estimatedTracts": 2,
                    "evidence": {
                        "apartmentBuilding": True,
                        "distinctUnits": 2,
                    },
                },
                {
                    "id": "overture-apartment-address:sample-rd|20|12345",
                    "sourceId": "sample-rd|20|12345",
                    "address": "20 Sample Road, Example, 12345",
                    "position": [0.0007, 0.00005],
                    "estimatedTracts": 5,
                    "evidence": {
                        "apartmentBuilding": False,
                        "distinctUnits": 5,
                    },
                },
            ],
        )

    def test_address_only_apartment_requires_a_numbered_street_address(self):
        result = normalize_features(
            [road("road-1", "residential", "Sample Road", [[0, 0], [0.001, 0]])],
            [
                address(
                    "Sample Road",
                    0.0005,
                    0.00005,
                    number=None,
                    postcode="12345",
                    unit=str(unit),
                )
                for unit in range(1, 6)
            ],
        )

        self.assertEqual(result["apartmentComplexes"], [])

    def test_apartment_building_without_units_uses_a_footprint_estimate(self):
        result = normalize_features(
            [road("road-1", "residential", "Sample Road", [[0, 0], [0.001, 0]])],
            [
                address(
                    "Sample Road",
                    0.00015,
                    0.00015,
                    number="10",
                    postcode="12345",
                )
            ],
            [
                building(
                    "apartment-building",
                    "apartments",
                    [
                        [0, 0],
                        [0.0003, 0],
                        [0.0003, 0.0003],
                        [0, 0.0003],
                        [0, 0],
                    ],
                    num_floors=2,
                )
            ],
        )

        self.assertEqual(result["apartmentComplexes"][0]["estimatedTracts"], 22)
        self.assertEqual(result["apartmentComplexes"][0]["evidence"]["distinctUnits"], 0)

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

    def test_assigns_name_mismatch_to_clearly_nearest_residential_road(self):
        roads = [
            road("near", "residential", "Oak View Drive", [[0, 0], [0.001, 0]]),
            road(
                "far",
                "residential",
                "Cedar Ridge Lane",
                [[0, 0.0003], [0.001, 0.0003]],
            ),
        ]
        addresses = [address("Incorrect Source Name", 0.0005, 0.00005)]

        result = normalize_features(roads, addresses)

        self.assertEqual(
            [
                (item["sourceSegmentId"], item["estimatedHomes"])
                for item in result["segments"]
            ],
            [("far", 0), ("near", 1)],
        )
        self.assertEqual(result["quality"]["spatiallyAssignedAddresses"], 1)
        self.assertEqual(result["quality"]["unmatchedAddresses"], 0)

    def test_replaces_an_unsupported_source_name_with_consistent_assigned_addresses(self):
        roads = [
            road("titan", "residential", "Titan Drive", [[0, 0], [0.001, 0]]),
            road("cedar", "residential", "Cedar Lane", [[0, 0.0006], [0.001, 0.0006]]),
        ]
        addresses = [
            address("North Titan Dr", longitude, 0.0005, number=str(index))
            for index, longitude in enumerate([0.0002, 0.0005, 0.0008], start=1)
        ]

        result = normalize_features(roads, addresses)

        self.assertEqual(
            [
                (segment["sourceSegmentId"], segment["streetName"], segment["estimatedHomes"])
                for segment in result["segments"]
            ],
            [
                ("cedar", "Cedar Lane", 0),
                ("titan", "North Titan Drive", 3),
            ],
        )
        self.assertEqual(result["quality"]["assignedAddresses"], 3)
        self.assertEqual(result["quality"]["inferredRoads"], 1)

    def test_leaves_spatial_match_unassigned_between_parallel_roads(self):
        roads = [
            road("north", "residential", "North Road", [[0, 0], [0.001, 0]]),
            road(
                "south",
                "residential",
                "South Road",
                [[0, 0.00018], [0.001, 0.00018]],
            ),
        ]
        addresses = [address("Missing Source Road", 0.0005, 0.00009)]

        result = normalize_features(roads, addresses)

        self.assertEqual(
            [item["estimatedHomes"] for item in result["segments"]],
            [0, 0],
        )
        self.assertEqual(result["quality"]["spatiallyAssignedAddresses"], 0)
        self.assertEqual(result["quality"]["unmatchedAddresses"], 1)

    def test_address_group_resolves_an_unnamed_road_beside_a_named_road(self):
        roads = [
            road("unnamed", "unclassified", None, [[0, 0], [0.001, 0]]),
            road("cedar", "residential", "Cedar Lane", [[0, 0.0001], [0.001, 0.0001]]),
        ]
        addresses = [
            address("Group Lane", longitude, 0.00005, number=str(index))
            for index, longitude in enumerate([0.0002, 0.0005, 0.0008], start=1)
        ]

        result = normalize_features(roads, addresses)

        self.assertEqual(
            [
                (segment["sourceSegmentId"], segment["streetName"], segment["estimatedHomes"])
                for segment in result["segments"]
            ],
            [
                ("cedar", "Cedar Lane", 0),
                ("unnamed", "Group Lane", 3),
            ],
        )
        self.assertEqual(result["quality"]["unmatchedAddresses"], 0)

    def test_direction_conflict_prefers_a_nearby_unnamed_road(self):
        roads = [
            road("unnamed", "unclassified", None, [[0, 0], [0.001, 0]]),
            road(
                "west-state",
                "residential",
                "West State Street",
                [[0, 0.0001], [0.001, 0.0001]],
            ),
        ]
        addresses = [
            address("North State St", longitude, 0.00008, number=str(index))
            for index, longitude in enumerate([0.0002, 0.0005, 0.0008], start=1)
        ]

        result = normalize_features(roads, addresses)

        self.assertEqual(
            [
                (segment["sourceSegmentId"], segment["streetName"], segment["estimatedHomes"])
                for segment in result["segments"]
            ],
            [
                ("unnamed", "North State Street", 3),
                ("west-state", "West State Street", 0),
            ],
        )

    def test_address_group_does_not_name_perpendicular_road_geometry(self):
        roads = [
            road("vertical", "unclassified", None, [[0.0005, 0], [0.0005, 0.001]]),
            road("cedar", "residential", "Cedar Lane", [[0, 0.0001], [0.001, 0.0001]]),
        ]
        addresses = [
            address("Group Lane", longitude, 0.00005, number=str(index))
            for index, longitude in enumerate([0.0002, 0.0005, 0.0008], start=1)
        ]

        result = normalize_features(roads, addresses)

        self.assertEqual(
            [segment["estimatedHomes"] for segment in result["segments"]],
            [0, 0],
        )
        self.assertEqual(result["quality"]["unmatchedAddresses"], 3)

    def test_same_named_distant_address_clusters_match_separate_roads(self):
        roads = [
            road("south", "unclassified", None, [[0, 0], [0.001, 0]]),
            road("north", "unclassified", None, [[0, 0.005], [0.001, 0.005]]),
        ]
        addresses = [
            address("Shared Lane", longitude, latitude + 0.00005, number=str(group * 3 + index))
            for group, latitude in enumerate([0, 0.005])
            for index, longitude in enumerate([0.0002, 0.0005, 0.0008], start=1)
        ]

        result = normalize_features(roads, addresses)

        self.assertEqual(
            [
                (segment["sourceSegmentId"], segment["streetName"], segment["estimatedHomes"])
                for segment in result["segments"]
            ],
            [
                ("north", "Shared Lane", 3),
                ("south", "Shared Lane", 3),
            ],
        )
        self.assertEqual(result["quality"]["unmatchedAddresses"], 0)

    def test_counts_only_unaddressed_high_confidence_residential_buildings(self):
        roads = [
            road("homes", "residential", "Home Road", [[0, 0], [0.001, 0]])
        ]
        addresses = [address("Home Road", 0.0002, 0.00004, number="10")]
        buildings = [
            building(
                "addressed",
                "house",
                [
                    [0.00015, 0.00002],
                    [0.00025, 0.00002],
                    [0.00025, 0.00008],
                    [0.00015, 0.00008],
                    [0.00015, 0.00002],
                ],
            ),
            building(
                "fallback",
                "detached",
                [
                    [0.00065, 0.00002],
                    [0.00075, 0.00002],
                    [0.00075, 0.00008],
                    [0.00065, 0.00008],
                    [0.00065, 0.00002],
                ],
            ),
            building(
                "garage",
                "garage",
                [
                    [0.00082, 0.00002],
                    [0.00088, 0.00002],
                    [0.00088, 0.00007],
                    [0.00082, 0.00007],
                    [0.00082, 0.00002],
                ],
            ),
        ]

        result = normalize_features(roads, addresses, buildings)

        self.assertEqual(result["segments"][0]["estimatedHomes"], 2)
        self.assertEqual(len(result["segments"][0]["addresses"]), 1)
        self.assertEqual(result["quality"]["totalResidentialBuildings"], 2)
        self.assertEqual(result["quality"]["fallbackBuildings"], 1)
        self.assertEqual(result["quality"]["unmatchedResidentialBuildings"], 0)

    def test_duplicate_source_address_contributes_one_home(self):
        roads = [
            road("homes", "residential", "Home Road", [[0, 0], [0.001, 0]])
        ]
        duplicates = [
            address("Home Road", 0.0002, 0.00004, number="10"),
            address("Home Rd", 0.00021, 0.00004, number="10"),
        ]

        result = normalize_features(roads, duplicates)

        self.assertEqual(result["segments"][0]["estimatedHomes"], 1)
        self.assertEqual(result["quality"]["totalAddresses"], 1)
        self.assertEqual(result["quality"]["assignedAddresses"], 1)

    def test_duplicate_residential_building_contributes_one_fallback_home(self):
        roads = [
            road("homes", "residential", "Home Road", [[0, 0], [0.001, 0]])
        ]
        duplicate = building(
            "home-1",
            "house",
            [
                [0.00018, 0.00002],
                [0.00022, 0.00002],
                [0.00022, 0.00006],
                [0.00018, 0.00006],
                [0.00018, 0.00002],
            ],
        )

        result = normalize_features(roads, [], [duplicate, duplicate])

        self.assertEqual(result["segments"][0]["estimatedHomes"], 1)
        self.assertEqual(result["quality"]["totalResidentialBuildings"], 1)
        self.assertEqual(result["quality"]["fallbackBuildings"], 1)

    def test_flags_material_address_and_building_count_disagreement(self):
        roads = [
            road("homes", "residential", "Home Road", [[0, 0], [0.001, 0]])
        ]
        addresses = [
            address("Home Road", 0.0001 + index * 0.00004, 0.00004, number=str(index))
            for index in range(20)
        ]
        buildings = [
            building(
                "only-building",
                "house",
                [
                    [0.00008, 0.00002],
                    [0.00012, 0.00002],
                    [0.00012, 0.00008],
                    [0.00008, 0.00008],
                    [0.00008, 0.00002],
                ],
            )
        ]

        result = normalize_features(roads, addresses, buildings)

        self.assertEqual(result["quality"]["buildingAddressDisagreements"], 1)
        self.assertIn(
            "1 road group has materially different address and residential-building counts.",
            result["quality"]["warnings"],
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

    def test_does_not_split_a_straight_road_at_interior_connectors(self):
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
                ("overture:connected:0", [[0, 0], [0.002, 0]]),
            ],
        )

    def test_splits_long_roads_so_no_segment_exceeds_one_hundred_homes(self):
        roads = [
            road(
                "long",
                "residential",
                "Long Road",
                [[0, 0], [0.002, 0]],
            )
        ]
        addresses = [
            address(
                "Long Road",
                0.00001 + index * 0.0000198,
                0.00001,
                number=str(index + 1),
            )
            for index in range(101)
        ]

        result = normalize_features(roads, addresses)["segments"]

        self.assertEqual([item["estimatedHomes"] for item in result], [100, 1])
        self.assertEqual(sum(len(item["addresses"]) for item in result), 101)
        self.assertEqual(result[0]["geometry"]["coordinates"][0], [0, 0])
        self.assertEqual(result[-1]["geometry"]["coordinates"][-1], [0.002, 0])

    def test_home_cap_preserves_addresses_that_share_the_same_position(self):
        roads = [
            road(
                "dense",
                "residential",
                "Dense Road",
                [[0, 0], [0.002, 0]],
            )
        ]
        addresses = [
            address("Dense Road", 0.001, 0.00001, number=str(index + 1))
            for index in range(201)
        ]

        result = normalize_features(roads, addresses)["segments"]

        self.assertEqual([item["estimatedHomes"] for item in result], [100, 100, 1])
        self.assertEqual(sum(len(item["addresses"]) for item in result), 201)

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

    def test_map_buildings_add_only_address_confirmed_fema_fallbacks(self):
        overture = [
            building(
                "overture-covered",
                "house",
                [
                    [0, 0],
                    [0.0001, 0],
                    [0.0001, 0.0001],
                    [0, 0.0001],
                    [0, 0],
                ],
            )
        ]
        addresses = [
            address("Home Road", 0.00005, 0.00005, number="1", source_id="address-covered"),
            address("Home Road", 0.001, 0.001, number="2", source_id="address-missing"),
            address("Home Road", 0.002, 0.002, number="3", source_id="address-outbuilding"),
        ]
        fema = [
            {
                "id": "fema-home",
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [
                        [
                            [0.00098, 0.00098],
                            [0.00102, 0.00098],
                            [0.00102, 0.00102],
                            [0.00098, 0.00102],
                            [0.00098, 0.00098],
                        ]
                    ],
                },
                "properties": {
                    "PRIM_OCC": "Single Family Dwelling",
                    "OUTBLDG": None,
                    "SOURCE": "FEMA",
                    "PROD_DATE": 1735776000000,
                    "IMAGE_DATE": None,
                },
            },
            {
                "id": "fema-shed",
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [
                        [
                            [0.00198, 0.00198],
                            [0.00202, 0.00198],
                            [0.00202, 0.00202],
                            [0.00198, 0.00202],
                            [0.00198, 0.00198],
                        ]
                    ],
                },
                "properties": {
                    "PRIM_OCC": "Single Family Dwelling",
                    "OUTBLDG": 1,
                },
            },
        ]

        result = select_map_buildings(addresses, overture, fema)

        self.assertEqual(
            [(item["source"], item["sourceId"]) for item in result],
            [("fema", "fema-home"), ("overture", "overture-covered")],
        )
        fallback = result[0]
        self.assertEqual(fallback["fema"]["addressSourceId"], "address-missing")
        self.assertLessEqual(fallback["fema"]["distanceMeters"], 10)
        self.assertEqual(fallback["fema"]["occupancy"], "Single Family Dwelling")
        self.assertFalse(fallback["fema"]["outbuilding"])
        self.assertEqual(
            fallback["fema"]["productDate"],
            "2025-01-02T00:00:00+00:00",
        )

    def test_map_buildings_add_row_gap_fema_between_same_side_neighbors(self):
        roads = [
            road(
                "home-road",
                "residential",
                "Home Road",
                [[-0.001, 0], [0.001, 0]],
            )
        ]
        overture = [
            building("left-home", "house", box(-12, 20)),
            building("right-home", "house", box(12, 20)),
        ]
        addresses = [
            address(
                "Home Road",
                -5 / 111_320,
                20 / 111_320,
                number="20",
                source_id="address-20",
            ),
            address(
                "Home Road",
                -12 / 111_320,
                20 / 111_320,
                number="18",
                source_id="neighbor-left",
            ),
            address(
                "Home Road",
                12 / 111_320,
                20 / 111_320,
                number="22",
                source_id="neighbor-right",
            ),
        ]

        result = select_map_buildings(
            addresses,
            overture,
            [fema_building("missing-home", box(0, 20))],
            roads,
        )

        self.assertEqual(
            [(item["source"], item["sourceId"]) for item in result],
            [
                ("fema", "missing-home"),
                ("overture", "left-home"),
                ("overture", "right-home"),
            ],
        )
        self.assertEqual(result[0]["fema"]["addressSourceId"], "address-20")

    def test_map_building_metrics_separate_direct_and_row_gap(self):
        roads = [
            road(
                "home-road",
                "residential",
                "Home Road",
                [[-0.002, 0], [0.002, 0]],
            )
        ]
        overture = [
            building("left-home", "house", box(-12, 20)),
            building("right-home", "house", box(12, 20)),
        ]
        addresses = [
            address(
                "Home Road",
                0,
                20 / 111_320,
                number="20",
                source_id="row-gap-address",
            ),
            address(
                "Home Road",
                -12 / 111_320,
                20 / 111_320,
                number="18",
                source_id="left-address",
            ),
            address(
                "Home Road",
                12 / 111_320,
                20 / 111_320,
                number="22",
                source_id="right-address",
            ),
            address(
                "Home Road",
                100 / 111_320,
                20 / 111_320,
                number="30",
                source_id="direct-address",
            ),
        ]

        selected, metrics = select_map_buildings(
            addresses,
            overture,
            [
                fema_building("row-gap", box(0, 20)),
                fema_building("direct-gap", box(100, 20)),
            ],
            roads,
            include_metrics=True,
        )

        self.assertEqual(
            [(item["source"], item["sourceId"]) for item in selected],
            [
                ("fema", "direct-gap"),
                ("fema", "row-gap"),
                ("overture", "left-home"),
                ("overture", "right-home"),
            ],
        )
        self.assertEqual(
            metrics,
            {
                "rawOvertureBuildings": 2,
                "rawFemaStructures": 2,
                "selectedOvertureBuildings": 2,
                "directFemaGapFills": 1,
                "rowGapFemaGapFills": 1,
                "femaResolvedBuildings": 2,
                "selectedMapBuildings": 4,
            },
        )

    def test_map_buildings_reject_unbracketed_and_bad_shape_row_gaps(self):
        roads = [
            road(
                "home-road",
                "residential",
                "Home Road",
                [[-0.001, 0], [0.001, 0]],
            )
        ]
        overture = [
            building("left-home", "house", box(-19, 20)),
            building("right-home", "house", box(19, 20)),
        ]
        addresses = [
            address(
                "Home Road",
                33 / 111_320,
                20 / 111_320,
                number="38",
                source_id="address-unbracketed",
            ),
            address(
                "Home Road",
                -5 / 111_320,
                20 / 111_320,
                number="20",
                source_id="address-skinny",
            ),
        ]

        result = select_map_buildings(
            addresses,
            overture,
            [
                fema_building("unbracketed", box(38, 20)),
                fema_building("skinny", box(0, 20, height_meters=2)),
            ],
            roads,
        )

        self.assertEqual(
            [(item["source"], item["sourceId"]) for item in result],
            [("overture", "left-home"), ("overture", "right-home")],
        )

    def test_map_buildings_reject_low_compactness_row_gap_with_typical_area(self):
        roads = [
            road(
                "home-road",
                "residential",
                "Home Road",
                [[-0.001, 0], [0.001, 0]],
            )
        ]
        overture = [
            building("left-home", "house", box(-17, 20)),
            building("right-home", "house", box(17, 20)),
        ]
        addresses = [
            address(
                "Home Road",
                -2 / 111_320,
                20 / 111_320,
                number="20",
                source_id="address-20",
            ),
            address(
                "Home Road",
                -17 / 111_320,
                20 / 111_320,
                number="18",
                source_id="neighbor-left",
            ),
            address(
                "Home Road",
                17 / 111_320,
                20 / 111_320,
                number="22",
                source_id="neighbor-right",
            ),
        ]

        result = select_map_buildings(
            addresses,
            overture,
            [fema_building("skinny", box(0, 20, width_meters=4, height_meters=25))],
            roads,
        )

        self.assertEqual(
            [(item["source"], item["sourceId"]) for item in result],
            [("overture", "left-home"), ("overture", "right-home")],
        )

    def test_row_gap_ignores_closer_buildings_outside_the_setback_row(self):
        roads = [
            road(
                "home-road",
                "residential",
                "Home Road",
                [[-0.001, 0], [0.001, 0]],
            )
        ]
        overture = [
            building("left-home", "house", box(-19, 20)),
            building("right-home", "house", box(19, 20)),
            building("backyard-structure", "house", box(5, 60)),
        ]
        addresses = [
            address(
                "Home Road",
                -5 / 111_320,
                20 / 111_320,
                number="20",
                source_id="address-20",
            ),
            address(
                "Home Road",
                -19 / 111_320,
                20 / 111_320,
                number="18",
                source_id="neighbor-left",
            ),
            address(
                "Home Road",
                19 / 111_320,
                20 / 111_320,
                number="22",
                source_id="neighbor-right",
            ),
        ]

        result = select_map_buildings(
            addresses,
            overture,
            [fema_building("missing-home", box(0, 20))],
            roads,
        )

        self.assertIn(
            ("fema", "missing-home"),
            [(item["source"], item["sourceId"]) for item in result],
        )

    def test_row_gap_requires_addressed_overture_homes_on_both_sides(self):
        roads = [
            road(
                "home-road",
                "residential",
                "Home Road",
                [[-0.001, 0], [0.001, 0]],
            )
        ]
        overture = [
            building("left-unaddressed", "house", box(-19, 20)),
            building("right-unaddressed", "house", box(19, 20)),
        ]
        addresses = [
            address(
                "Home Road",
                -5 / 111_320,
                20 / 111_320,
                number="20",
                source_id="address-20",
            )
        ]

        result = select_map_buildings(
            addresses,
            overture,
            [fema_building("not-a-confirmed-gap", box(0, 20))],
            roads,
        )

        self.assertNotIn(
            ("fema", "not-a-confirmed-gap"),
            [(item["source"], item["sourceId"]) for item in result],
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
            "spatiallyAssignedAddresses": 0,
            "inferredRoads": 4,
            "unmatchedAddresses": 0,
            "unresolvedClusters": 0,
            "totalResidentialBuildings": 0,
            "fallbackBuildings": 0,
            "unmatchedResidentialBuildings": 0,
            "populatedUnnamedRoads": 0,
            "buildingAddressDisagreements": 0,
            "warnings": [],
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
        self.assertEqual(result["quality"]["assignedAddresses"], 2)
        self.assertEqual(result["quality"]["populatedUnnamedRoads"], 1)

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
        self.assertEqual(result["quality"]["populatedUnnamedRoads"], 1)
        self.assertEqual(
            result["quality"]["warnings"],
            ["1 populated road group still has no supported street name."],
        )

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
        self.assertEqual(result["quality"]["assignedAddresses"], 4)
        self.assertEqual(result["quality"]["populatedUnnamedRoads"], 1)

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
            "spatiallyAssignedAddresses": 0,
            "inferredRoads": 0,
            "unmatchedAddresses": 0,
            "unresolvedClusters": 0,
            "totalResidentialBuildings": 0,
            "fallbackBuildings": 0,
            "unmatchedResidentialBuildings": 0,
            "populatedUnnamedRoads": 0,
            "buildingAddressDisagreements": 0,
            "warnings": [],
        })
        self.assertEqual(result["segments"][0]["estimatedHomes"], 1)


class BenchmarkMetricsTest(TestCase):
    def test_building_audit_reports_false_positives_and_false_negatives(self):
        result = benchmark_module.audit_metrics(
            selected_ids={"accepted", "false-positive"},
            expected_ids={"accepted", "missed"},
            reviewed_ids={"accepted", "false-positive", "missed"},
        )

        self.assertEqual(
            result,
            {
                "reviewedCandidates": 3,
                "expectedAccepted": 2,
                "selectedReviewed": 2,
                "truePositives": 1,
                "falsePositiveIds": ["false-positive"],
                "falseNegativeIds": ["missed"],
                "precision": 0.5,
                "recall": 0.5,
                "passed": False,
            },
        )

    def test_classifies_exact_high_confidence_and_usable_boundaries(self):
        classify = getattr(
            importer_module,
            "benchmark_classification",
            lambda *_: {},
        )

        self.assertEqual(
            classify(0.95, 0.99, 0.98, 0.9, 0, 100),
            {
                "severeOutlierRate": 0,
                "highConfidenceFailedMetrics": [],
                "usableFailedMetrics": [],
                "classification": "high_confidence",
            },
        )
        self.assertEqual(
            classify(0.9, 0.99, 0.9, 0.85, 3, 100),
            {
                "severeOutlierRate": 0.03,
                "highConfidenceFailedMetrics": [
                    "addressAssignmentRate",
                    "roadNameAccuracy",
                    "segmentCountAccuracy",
                    "severeOutlierRate",
                ],
                "usableFailedMetrics": [],
                "classification": "usable_with_warnings",
            },
        )

    def test_classifies_every_usable_floor_failure_as_below_usable(self):
        classify = getattr(
            importer_module,
            "benchmark_classification",
            lambda *_: {},
        )
        cases = [
            (0.8999, 0.99, 0.9, 0.85, 3, 100),
            (0.9, 0.9899, 0.9, 0.85, 3, 100),
            (0.9, 0.99, 0.8999, 0.85, 3, 100),
            (0.9, 0.99, 0.9, 0.8499, 3, 100),
            (0.9, 0.99, 0.9, 0.85, 4, 100),
        ]

        for case in cases:
            with self.subTest(case=case):
                self.assertEqual(
                    classify(*case)["classification"],
                    "below_usable_floor",
                )

    def test_treats_direction_abbreviations_as_the_same_road_name(self):
        reference = [
            address("West 900 North", 0.0002 + index * 0.0002, 0.00005, number=str(index + 1))
            for index in range(4)
        ]
        normalized = normalize_features(
            [road("west", "residential", "W 900 N", [[0, 0], [0.001, 0]])],
            reference,
        )
        normalized["segments"][0]["streetName"] = "W 900 N"

        result = importer_module.benchmark_metrics(normalized, reference)

        self.assertEqual(result["roadNameAccuracy"], 1.0)
        self.assertEqual(result["incorrectRoadNames"], [])

    def test_counts_duplicate_unit_points_as_one_reference_premise(self):
        reference = [
            address(
                "Oak Road",
                0.0002 + house * 0.0001 + duplicate * 0.000000001,
                0.00005,
                number=str(house + 1),
            )
            for house in range(5)
            for duplicate in range(50)
        ]
        normalized = normalize_features(
            [road("oak", "residential", "Oak Road", [[0, 0], [0.001, 0]])],
            [
                address(
                    "Oak Road",
                    0.0002 + house * 0.0001,
                    0.00005,
                    number=str(house + 1),
                )
                for house in range(5)
            ],
        )

        result = importer_module.benchmark_metrics(normalized, reference)

        self.assertEqual(result["rawReferencePoints"], 250)
        self.assertEqual(result["referenceAddresses"], 5)
        self.assertEqual(result["duplicateReferencePoints"], 245)
        self.assertEqual(result["accurateSegments"], 1)
        self.assertEqual(result["severeOutliers"], 0)

    def test_excludes_detected_apartment_premises_from_street_count_accuracy(self):
        reference = [
            address("Oak Road", 0.0002, 0.00005, number="10")
            for _ in range(20)
        ] + [
            address("Oak Road", 0.0004 + index * 0.0001, 0.00005, number=str(20 + index))
            for index in range(3)
        ]
        normalized = {
            "segments": [
                {
                    "id": "oak",
                    "sourceSegmentId": "source-oak",
                    "streetName": "Oak Road",
                    "geometry": {"type": "LineString", "coordinates": [[0, 0], [0.001, 0]]},
                    "estimatedHomes": 3,
                }
            ],
            "apartmentComplexes": [
                {
                    "address": "10 Oak Road, Test City, 12345",
                    "position": [0.0002, 0.00005],
                    "estimatedTracts": 20,
                }
            ],
            "quality": {
                "assignedAddresses": 3,
                "totalAddresses": 3,
            },
        }

        result = importer_module.benchmark_metrics(normalized, reference)

        self.assertEqual(result["referencePremises"], 4)
        self.assertEqual(result["apartmentReferencePremises"], 1)
        self.assertEqual(result["referenceAddresses"], 3)
        self.assertEqual(result["duplicateReferencePoints"], 19)
        self.assertEqual(result["segmentCountAccuracy"], 1.0)

    def test_reports_literal_reliability_rates_for_reference_addresses(self):
        roads = [
            road("oak", "residential", "Oak Road", [[0, 0], [0.001, 0]]),
            road("pine", "residential", "Pine Lane", [[0, 0.001], [0.001, 0.001]]),
        ]
        reference = [
            address(
                street,
                0.0002 + index * 0.0002,
                latitude,
                number=str(index + 1),
            )
            for street, latitude in [("Oak Rd", 0.00005), ("Pine Ln", 0.00105)]
            for index in range(4)
        ]
        normalized = normalize_features(roads, reference)
        benchmark_metrics = getattr(
            importer_module,
            "benchmark_metrics",
            lambda _normalized, _reference: None,
        )

        self.assertEqual(
            benchmark_metrics(normalized, reference),
            {
                "referenceAddresses": 8,
                "referencePremises": 8,
                "apartmentReferencePremises": 0,
                "rawReferencePoints": 8,
                "duplicateReferencePoints": 0,
                "knownResidentialRoads": 2,
                "representedResidentialRoads": 2,
                "correctlyNamedResidentialRoads": 2,
                "unrepresentedRoadNames": [],
                "incorrectRoadNames": [],
                "evaluatedSegments": 2,
                "accurateSegments": 2,
                "severeOutliers": 0,
                "severeOutlierSegments": [],
                "addressAssignmentRate": 1.0,
                "roadRepresentationRate": 1.0,
                "roadNameAccuracy": 1.0,
                "segmentCountAccuracy": 1.0,
                "severeOutlierRate": 0,
                "highConfidenceFailedMetrics": [],
                "usableFailedMetrics": [],
                "classification": "high_confidence",
            },
        )

    def test_names_each_failed_reliability_metric(self):
        reference = [
            address("Oak Road", 0.0002 + index * 0.0002, 0.00005, number=str(index))
            for index in range(4)
        ]
        normalized = normalize_features(
            [road("oak", "residential", "Oak Road", [[0, 0], [0.001, 0]])],
            [],
        )

        result = importer_module.benchmark_metrics(normalized, reference)

        self.assertEqual(
            result["highConfidenceFailedMetrics"],
            ["addressAssignmentRate", "segmentCountAccuracy"],
        )
        self.assertEqual(
            result["usableFailedMetrics"],
            ["addressAssignmentRate", "segmentCountAccuracy"],
        )
        self.assertEqual(result["classification"], "below_usable_floor")

    def test_benchmark_cli_accepts_usable_holdouts_and_rejects_below_floor(self):
        areas = {
            "high": (0, 0, 1),
            "usable": (0, 0, 1),
        }
        classifications = {
            "high": "high_confidence",
            "usable": "usable_with_warnings",
        }

        def result(name, _cache_dir):
            return {
                "area": name,
                "benchmark": {"classification": classifications[name]},
            }

        with (
            patch.object(benchmark_module, "AREAS", areas),
            patch.object(benchmark_module, "run_area", side_effect=result),
            patch.object(
                benchmark_module,
                "run_building_audit",
                return_value={"passed": True},
            ),
            redirect_stdout(StringIO()),
        ):
            self.assertTrue(benchmark_module.main([]))
            classifications["usable"] = "below_usable_floor"
            self.assertFalse(benchmark_module.main([]))

    def test_benchmark_cli_rejects_a_building_audit_regression(self):
        areas = {"usable": (0, 0, 1)}
        area_result = {
            "area": "usable",
            "benchmark": {"classification": "usable_with_warnings"},
        }
        audit = {
            "falsePositiveIds": ["false-positive"],
            "falseNegativeIds": [],
            "precision": 0.5,
            "recall": 1.0,
            "passed": False,
        }

        with (
            patch.object(benchmark_module, "AREAS", areas),
            patch.object(benchmark_module, "run_area", return_value=area_result),
            patch.object(benchmark_module, "run_building_audit", return_value=audit),
            redirect_stdout(StringIO()),
        ):
            self.assertFalse(benchmark_module.main([]))
            audit["falsePositiveIds"] = []
            audit["precision"] = 1.0
            audit["passed"] = True
            self.assertTrue(benchmark_module.main([]))

    def test_benchmark_cache_reuses_the_exact_downloaded_sources(self):
        sources = (
            [road("oak", "residential", "Oak Road", [[0, 0], [0.001, 0]])],
            [address("Oak Road", 0.0005, 0.00005, number="1")],
            [],
        )
        reference = [address("Oak Road", 0.0005, 0.00005, number="1")]
        fema = [fema_building("fema-home", box(0, 20))]
        with (
            TemporaryDirectory() as directory,
            patch.object(benchmark_module, "download_features", return_value=sources) as download,
            patch.object(
                benchmark_module,
                "download_nad_reference",
                return_value=reference,
            ) as download_reference,
            patch.object(
                benchmark_module,
                "download_fema_features",
                return_value=fema,
            ) as download_fema,
        ):
            first = benchmark_module.load_sources("test-area", 0, 0, 1, directory)
            second = benchmark_module.load_sources("test-area", 0, 0, 1, directory)

        self.assertEqual(first, (*sources, reference, fema))
        self.assertEqual(second, first)
        download.assert_called_once_with(0, 0, 1)
        download_reference.assert_called_once_with(0, 0, 1)
        download_fema.assert_called_once_with(0, 0, 1)

    def test_benchmark_replaces_legacy_cache_without_complete_map_buildings(self):
        current_sources = (
            [road("oak", "residential", "Oak Road", [[0, 0], [0.001, 0]])],
            [address("Oak Road", 0.0005, 0.00005, number="1")],
            [building("complete-footprint", "house", box(0, 20))],
        )
        reference = [address("Oak Road", 0.0005, 0.00005, number="1")]
        fema = [fema_building("fema-home", box(0, 20))]
        with TemporaryDirectory() as directory:
            benchmark_module.Path(directory, "test-area.json").write_text(
                json.dumps(
                    {
                        "cacheVersion": 3,
                        "center": [0, 0],
                        "radiusMiles": 1,
                        "roads": current_sources[0],
                        "addresses": current_sources[1],
                        "buildings": [],
                        "reference": reference,
                        "fema": fema,
                    }
                ),
                encoding="utf-8",
            )
            with (
                patch.object(
                    benchmark_module,
                    "download_features",
                    return_value=current_sources,
                ) as download,
                patch.object(
                    benchmark_module,
                    "download_nad_reference",
                    return_value=reference,
                ),
                patch.object(
                    benchmark_module,
                    "download_fema_features",
                    return_value=fema,
                ),
            ):
                result = benchmark_module.load_sources("test-area", 0, 0, 1, directory)

        self.assertEqual(result, (*current_sources, reference, fema))
        download.assert_called_once_with(0, 0, 1)

    def test_building_audit_reuses_its_complete_dedicated_cache(self):
        fixture = {"center": [0, 0], "radiusMiles": 1}
        cached = {
            "cacheVersion": benchmark_module.CACHE_VERSION,
            **fixture,
            "roads": [road("oak", "residential", "Oak Road", [[0, 0], [0.001, 0]])],
            "addresses": [address("Oak Road", 0.0005, 0.00005, number="1")],
            "buildings": [building("complete-footprint", "house", box(0, 20))],
        }
        with TemporaryDirectory() as directory:
            benchmark_module.Path(directory, "temecula-building-audit.json").write_text(
                json.dumps(cached),
                encoding="utf-8",
            )
            with patch.object(
                benchmark_module,
                "download_features",
                side_effect=AssertionError("complete audit cache must be reused"),
            ):
                result = benchmark_module.load_audit_overture(fixture, directory)

        self.assertEqual(result, (cached["roads"], cached["addresses"], cached["buildings"]))


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
                if "theme=buildings" in sql:
                    return Result(
                        [
                            (
                                "building-1",
                                "building",
                                "house",
                                12.0,
                                4,
                                '{"type":"Polygon","coordinates":[[[0.2,0.00005],[0.3,0.00005],[0.3,0.00015],[0.2,0.00015],[0.2,0.00005]]]}',
                            )
                        ]
                    )
                return Result(
                    [
                        (
                            "address-1",
                            "10",
                            "Main Street",
                            "Temecula",
                            "92591",
                            "2B",
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
            roads, addresses, buildings = download_features(0, 0, 1)

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
                    unit="2B",
                    address_levels=[
                        {"value": "California"},
                        {"value": "Temecula"},
                    ],
                    source_id="address-1",
                )
            ],
        )
        self.assertEqual(
            buildings,
            [
                building(
                    "building-1",
                    "house",
                    [
                        [0.2, 0.00005],
                        [0.3, 0.00005],
                        [0.3, 0.00015],
                        [0.2, 0.00015],
                        [0.2, 0.00005],
                    ],
                    height=12.0,
                    num_floors=4,
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
        self.assertIn("SELECT id, number", address_sql)
        self.assertIn("street", address_sql)
        self.assertIn("number", address_sql)
        self.assertIn("postal_city", address_sql)
        self.assertIn("postcode", address_sql)
        self.assertIn("address_levels", address_sql)
        self.assertIn("unit", address_sql)
        self.assertNotIn("ORDER BY id", address_sql)
        building_sql = bbox_calls[2][0]
        self.assertIn("theme=buildings/type=building/*", building_sql)
        self.assertIn("id, subtype, class", building_sql)
        self.assertIn("height, num_floors", building_sql)
        self.assertNotIn("class IN", building_sql)
        self.assertNotIn("ORDER BY id", building_sql)

    def test_fema_download_paginates_complete_real_polygons(self):
        pages = {
            0: [
                {
                    "properties": {"BUILD_ID": "one", "PRIM_OCC": "Single Family Dwelling"},
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 0]]],
                    },
                },
                {
                    "properties": {"BUILD_ID": "two", "PRIM_OCC": "Commercial"},
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [[[1, 1], [2, 1], [2, 2], [1, 1]]],
                    },
                },
            ],
            2: [
                {
                    "properties": {"BUILD_ID": 3, "PRIM_OCC": "Single Family Dwelling"},
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [[[2, 2], [3, 2], [3, 3], [2, 2]]],
                    },
                }
            ],
        }
        offsets = []

        class Response:
            def __init__(self, payload):
                self.payload = payload

            def __enter__(self):
                return self

            def __exit__(self, *_):
                return None

            def read(self):
                return json.dumps({"features": self.payload}).encode()

        def open_url(request, timeout):
            self.assertEqual(timeout, 30)
            query = parse_qs(urlparse(request.full_url).query)
            self.assertEqual(query["resultRecordCount"], ["2"])
            self.assertEqual(
                query["outFields"],
                ["BUILD_ID,PRIM_OCC,OUTBLDG,SOURCE,PROD_DATE,IMAGE_DATE"],
            )
            offset = int(query["resultOffset"][0])
            offsets.append(offset)
            return Response(pages[offset])

        with patch.object(importer_module, "FEMA_PAGE_SIZE", 2):
            result = download_fema_features(0, 0, 1, open_url=open_url)

        self.assertEqual(offsets, [0, 2])
        self.assertEqual([item["id"] for item in result], ["one", "two", "3"])

    def test_cli_parses_arguments_and_prints_one_json_object(self):
        output = StringIO()
        diagnostics = StringIO()

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
                [
                    building(
                        "building-1",
                        "commercial",
                        [
                            [-117.13, 33.51],
                            [-117.1299, 33.51],
                            [-117.1299, 33.5101],
                            [-117.13, 33.51],
                        ],
                    )
                ],
            )

        with redirect_stdout(output), redirect_stderr(diagnostics):
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
                download_fema=lambda *_: [],
            )

        parsed = json.loads(output.getvalue())
        self.assertEqual(parsed["release"], OVERTURE_RELEASE)
        self.assertEqual(parsed["center"], [-117.1274, 33.5107])
        self.assertEqual(parsed["radiusMiles"], 1)
        self.assertEqual(parsed["normalizerVersion"], 11)
        self.assertEqual(parsed["buildingMode"], "overture_only")
        self.assertEqual(
            [(item["source"], item["sourceId"]) for item in parsed["mapBuildings"]],
            [("overture", "building-1")],
        )
        self.assertEqual(parsed["quality"], {
            "totalAddresses": 0,
            "assignedAddresses": 0,
            "spatiallyAssignedAddresses": 0,
            "inferredRoads": 0,
            "unmatchedAddresses": 0,
            "unresolvedClusters": 0,
            "totalResidentialBuildings": 0,
            "fallbackBuildings": 0,
            "unmatchedResidentialBuildings": 0,
            "populatedUnnamedRoads": 0,
            "buildingAddressDisagreements": 0,
            "warnings": ["No usable address points were available for this territory."],
        })
        self.assertEqual(parsed["segments"][0]["id"], "overture:road-1:0")
        self.assertEqual(output.getvalue().count("\n"), 1)
        self.assertIn("STREETLIGHT_STAGE:downloading_streets", diagnostics.getvalue())
        self.assertIn("STREETLIGHT_STAGE:matching", diagnostics.getvalue())
        self.assertIn("STREETLIGHT_STAGE:preparing", diagnostics.getvalue())

    def test_cli_uses_overture_only_when_fema_service_is_unavailable(self):
        output = StringIO()
        diagnostics = StringIO()

        with redirect_stdout(output), redirect_stderr(diagnostics):
            main(
                [
                    "--longitude",
                    "-117.1274",
                    "--latitude",
                    "33.5107",
                    "--radius-miles",
                    "1",
                ],
                download=lambda *_: (
                    [],
                    [],
                    [building("building-1", "house", box(0, 0))],
                ),
                download_fema=lambda *_: (_ for _ in ()).throw(
                    OSError("service unavailable")
                ),
            )

        parsed = json.loads(output.getvalue())
        self.assertEqual(parsed["buildingMode"], "overture_only")
        self.assertEqual(
            [(item["source"], item["sourceId"]) for item in parsed["mapBuildings"]],
            [("overture", "building-1")],
        )
        self.assertIn("FEMA USA Structures unavailable", diagnostics.getvalue())

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
