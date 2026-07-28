import base64
import json
import math
import sys
import unittest
from pathlib import Path

from pypdf import PdfReader

PHASE0 = Path(__file__).resolve().parent
ROOT = PHASE0.parent
sys.path.insert(0, str(PHASE0))

from proof import (  # noqa: E402
    build_map_proof,
    canonical_street,
    load_fixture,
    normalize_segments,
    parse_snapped_coordinates,
    point_polyline_distance,
    render_html,
    render_pdf,
    roads_params,
    static_map_params,
)
from phase0.sample_maps import (  # noqa: E402
    assert_non_overlapping,
    build_sample_proofs,
    render_gallery,
)


class Phase0ProofTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.fixture = load_fixture()
        cls.proof = build_map_proof(cls.fixture)

    def test_source_feature_becomes_three_named_sections(self) -> None:
        self.assertEqual(
            [
                canonical_street(section["name"])
                for section in self.proof["sections"]
            ],
            ["ANDREWS WAY", "DIEGO DRIVE", "JONS PLACE"],
        )
        self.assertEqual(
            [
                section["estimated_homes"]
                for section in self.proof["sections"]
            ],
            [10, 30, 4],
        )
        self.assertTrue(
            all(section["both_sides"] for section in self.proof["sections"])
        )

    def test_connected_packet_is_deterministic(self) -> None:
        again = build_map_proof(self.fixture)
        self.assertEqual(
            json.dumps(self.proof, sort_keys=True),
            json.dumps(again, sort_keys=True),
        )
        self.assertEqual(
            [
                canonical_street(section["name"])
                for section in self.proof["selected"]
            ],
            ["ANDREWS WAY", "DIEGO DRIVE", "JONS PLACE"],
        )
        source = next(
            segment
            for segment in self.fixture["segments"]
            if segment["id"]
            == "8235e3b4-477f-41f8-814c-241d2ce98764"
        )
        self.assertEqual(
            {
                tuple(self.proof["selected_coordinates"][0]),
                tuple(self.proof["selected_coordinates"][-1]),
            },
            {
                tuple(source["coordinates"][0]),
                tuple(source["coordinates"][-1]),
            },
        )
        self.assertEqual(self.proof["estimated_homes"], 44)
        self.assertEqual(
            self.proof["start_address"],
            "30868 Jons Pl, Temecula, CA 92591",
        )
        self.assertIn(
            self.proof["start"],
            [
                address
                for section in self.proof["selected"]
                for address in section["addresses"]
            ],
        )
        self.assertTrue(
            all(
                point_polyline_distance(
                    address["lon"],
                    address["lat"],
                    section["coordinates"],
                )
                <= 40
                for section in self.proof["selected"]
                for address in section["addresses"]
            )
        )
        self.assertEqual(
            self.proof["google_maps_url"],
            (
                "https://www.google.com/maps/dir/?api=1&"
                "destination=30868+Jons+Pl%2C+Temecula%2C+CA+92591&"
                "travelmode=walking"
            ),
        )

    def test_normalizer_assigns_each_address_at_most_once(self) -> None:
        normalized = normalize_segments(self.fixture)
        address_keys = [
            (
                str(address["number"]),
                canonical_street(address["street"]),
                address["postcode"],
            )
            for segment in normalized
            for address in segment["addresses"]
        ]
        self.assertEqual(len(address_keys), len(set(address_keys)))
        self.assertEqual(
            json.dumps(normalized, sort_keys=True),
            json.dumps(normalize_segments(self.fixture), sort_keys=True),
        )

    def test_selected_sections_stay_inside_service_area(self) -> None:
        church = self.fixture["metadata"]["church"]
        radius = self.fixture["metadata"]["service_radius_miles"]
        for lon, lat in self.proof["selected_coordinates"]:
            lat1 = math.radians(church["lat"])
            lat2 = math.radians(lat)
            delta_lat = lat2 - lat1
            delta_lon = math.radians(lon - church["lon"])
            value = (
                math.sin(delta_lat / 2) ** 2
                + math.cos(lat1)
                * math.cos(lat2)
                * math.sin(delta_lon / 2) ** 2
            )
            miles = 3958.8 * 2 * math.asin(math.sqrt(value))
            self.assertLessEqual(miles, radius)

    def test_google_static_map_request_has_highlight_and_no_key(self) -> None:
        params = static_map_params(self.proof)
        values = dict(params)
        self.assertEqual(values["size"], "640x640")
        self.assertEqual(values["scale"], "2")
        self.assertIn("color:0xef6c3599|weight:6|", values["path"])
        self.assertNotIn("label:", values["markers"])
        self.assertNotIn("key", values)
        for name in ["Andrews Way", "Diego Drive", "Jons Place"]:
            self.assertNotIn(name, values["path"])
        snapped = dict(
            static_map_params(
                self.proof,
                [[-117.1, 33.5], [-117.2, 33.4]],
            )
        )
        self.assertIn(
            "33.5000000,-117.1000000|33.4000000,-117.2000000",
            snapped["path"],
        )

    def test_google_roads_request_and_response_exclude_the_key(self) -> None:
        values = dict(roads_params(self.proof["selected_coordinates"]))
        self.assertEqual(values["interpolate"], "true")
        self.assertNotIn("key", values)
        self.assertEqual(
            parse_snapped_coordinates(
                {
                    "snappedPoints": [
                        {
                            "location": {
                                "latitude": 33.5,
                                "longitude": -117.1,
                            }
                        },
                        {
                            "location": {
                                "latitude": 33.4,
                                "longitude": -117.2,
                            }
                        },
                    ]
                }
            ),
            [[-117.1, 33.5], [-117.2, 33.4]],
        )

    def test_browser_proof_contains_required_fields_without_route_directions(
        self,
    ) -> None:
        output = ROOT / "tmp" / "phase0-map-proof.html"
        render_html(self.proof, output)
        page = output.read_text(encoding="utf-8")
        for value in [
            self.proof["packet_id"],
            self.proof["start_address"],
            "Estimated homes",
            ">44<",
            "google-static-map.png",
            "STREETLIGHT",
        ]:
            self.assertIn(value, page)
        for rejected in [
            "Batch",
            "FINISH",
            "walking order",
            "route direction",
            "GOOGLE_MAPS_STATIC_API_KEY",
            "estimated homes</div>",
        ]:
            self.assertNotIn(rejected, page)
        self.assertIn(
            '</section>\n    <div class="brand">STREETLIGHT</div>',
            page,
        )

    def test_print_pdf_is_one_page_with_required_fields(self) -> None:
        temp = ROOT / "tmp" / "pdfs"
        temp.mkdir(parents=True, exist_ok=True)
        map_path = temp / "test-map.png"
        map_path.write_bytes(
            base64.b64decode(
                "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwC"
                "AAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
            )
        )
        output = render_pdf(
            self.proof,
            map_path,
            temp / "streetlight-phase0-test.pdf",
        )
        reader = PdfReader(output)
        self.assertEqual(len(reader.pages), 1)
        text = reader.pages[0].extract_text()
        street, _, locality = self.proof["start_address"].partition(", ")
        for required in [
            self.proof["packet_id"],
            street,
            locality,
            "ESTIMATED HOMES / TRACTS",
            str(self.proof["estimated_homes"]),
            "SCAN FOR DIRECTIONS",
            "STREETLIGHT",
        ]:
            self.assertIn(required, text)
        for rejected in ["BATCH", "WALKING", "END ADDRESS"]:
            self.assertNotIn(rejected, text)

    def test_neighboring_sample_packets_do_not_overlap(self) -> None:
        proofs = build_sample_proofs(self.fixture)
        assert_non_overlapping(proofs)
        self.assertEqual(
            [proof["packet_id"] for proof in proofs],
            ["P0-TEM-001", "P0-TEM-002", "P0-TEM-003", "P0-TEM-004"],
        )
        self.assertEqual(
            [proof["estimated_homes"] for proof in proofs],
            [44, 24, 48, 40],
        )
        self.assertTrue(
            all(len(proof["selected_coordinates"]) <= 100 for proof in proofs)
        )
        gallery = render_gallery(proofs).read_text(encoding="utf-8")
        self.assertIn(
            "no shared normalized segments or address points",
            gallery,
        )
        for proof in proofs:
            self.assertIn(proof["packet_id"], gallery)


if __name__ == "__main__":
    unittest.main()
