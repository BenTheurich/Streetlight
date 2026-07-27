import json
import math
import sys
import unittest
from pathlib import Path

from pypdf import PdfReader

PHASE0 = Path(__file__).resolve().parent
ROOT = PHASE0.parent
sys.path.insert(0, str(PHASE0))

from proof import build_packet, load_fixture, render_pdf  # noqa: E402


class Phase0ProofTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.fixture = load_fixture()
        cls.packet = build_packet(cls.fixture)

    def test_packet_is_deterministic_and_complete(self) -> None:
        again = build_packet(self.fixture)
        self.assertEqual(
            json.dumps(self.packet, sort_keys=True),
            json.dumps(again, sort_keys=True),
        )
        self.assertGreaterEqual(
            self.packet["estimated_homes"], self.packet["target_homes"]
        )
        self.assertLessEqual(
            self.packet["estimated_homes"], self.packet["target_homes"] + 20
        )
        self.assertEqual(
            sum(item["homes"] for item in self.packet["street_ranges"]),
            self.packet["estimated_homes"],
        )
        self.assertTrue(all(item["homes"] >= 0 for item in self.packet["street_ranges"]))
        self.assertIn(self.packet["start"], self.packet["addresses"])
        self.assertIn(self.packet["end"], self.packet["addresses"])
        self.assertEqual(
            self.packet["google_maps_url"],
            (
                "https://www.google.com/maps/dir/?api=1&"
                "destination=39483+Diego+Dr%2C+Temecula%2C+CA+92591&"
                "travelmode=walking"
            ),
        )
        self.assertEqual(len(self.packet["segments"]), 5)
        self.assertEqual(len(self.packet["directions"]), 4)
        for previous, current in zip(
            self.packet["route_legs"],
            self.packet["route_legs"][1:],
        ):
            self.assertAlmostEqual(
                previous["coordinates"][-1][0],
                current["coordinates"][0][0],
                places=6,
            )
            self.assertAlmostEqual(
                previous["coordinates"][-1][1],
                current["coordinates"][0][1],
                places=6,
            )

    def test_route_stays_inside_service_area(self) -> None:
        church = self.fixture["metadata"]["church"]
        radius = self.fixture["metadata"]["service_radius_miles"]
        for segment in self.packet["segments"]:
            for lon, lat in segment["coordinates"]:
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

    def test_pdf_is_one_page_and_has_required_fields(self) -> None:
        output = ROOT / "tmp" / "pdfs" / "phase0-test-packet.pdf"
        render_pdf(self.fixture, self.packet, output)
        reader = PdfReader(output)
        self.assertEqual(len(reader.pages), 1)
        text = reader.pages[0].extract_text()
        required = [
            "STREETLIGHT",
            "OUTREACH ROUTE",
            self.packet["packet_id"],
            self.packet["batch_name"],
            "HOMES /",
            "TAKING THIS SHEET + FLYERS",
            self.packet["start_address"],
            self.packet["end_address"],
            "HOW TO WALK THIS ROUTE",
            "STREET COVERAGE",
            "SCAN FOR START",
            "Estimated home",
            "Walk this way",
            "OpenStreetMap contributors",
        ]
        for field in required:
            self.assertIn(field, text)


if __name__ == "__main__":
    unittest.main()
