from unittest import TestCase

from .overture_import import canonical_street_name, normalize_features


def road(source_id, road_class, name, coordinates, geometry_type="LineString"):
    return {
        "id": source_id,
        "properties": {"class": road_class, "names": {"primary": name}},
        "geometry": {"type": geometry_type, "coordinates": coordinates},
    }


def address(street, longitude, latitude):
    return {
        "properties": {"street": street},
        "geometry": {"type": "Point", "coordinates": [longitude, latitude]},
    }


class NormalizeFeaturesTest(TestCase):
    def test_canonical_names_ignore_case_punctuation_and_suffix_spelling(self):
        self.assertEqual(canonical_street_name("Jons Place"), "jons pl")
        self.assertEqual(canonical_street_name("JONS PL."), "jons pl")

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
                [[0, 0], [0.001, 0], [0.0010871557, 0.0009961947]],
            )
        ]

        result = normalize_features(roads, [])

        self.assertEqual(
            [(item["id"], item["geometry"]["coordinates"]) for item in result],
            [
                ("overture:turn:0", [[0, 0], [0.001, 0]]),
                (
                    "overture:turn:1",
                    [[0.001, 0], [0.0010871557, 0.0009961947]],
                ),
            ],
        )

    def test_splits_both_roads_at_geometric_intersections(self):
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
                ("overture:cross:0", [[0, -0.001], [0.0, 0.0]]),
                ("overture:cross:1", [[0.0, 0.0], [0, 0.001]]),
                ("overture:main:0", [[-0.001, 0], [0.0, 0.0]]),
                ("overture:main:1", [[0.0, 0.0], [0.001, 0]]),
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
