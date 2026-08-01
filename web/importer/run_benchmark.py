import argparse
import json
import urllib.parse
import urllib.request
from pathlib import Path

from .overture_import import (
    benchmark_metrics,
    download_fema_features,
    download_features,
    enclosing_bbox,
    normalize_features,
    select_map_buildings,
)


NAD_QUERY_URL = (
    "https://services.arcgis.com/xOi1kZaI0eWDREZv/ArcGIS/rest/services/"
    "Address_Points_from_National_Address_Database_view/FeatureServer/0/query"
)
AREAS = {
    "sacramento-suburban": (-121.3716, 38.4088, 0.5),
    "boston-urban": (-71.0870, 42.3480, 0.25),
    "austin-residential": (-97.7510, 30.3350, 0.5),
    "lehi-newer-development": (-111.8710, 40.4060, 0.5),
    "ames-small-city": (-93.6319, 42.0308, 0.5),
}
CACHE_VERSION = 4
AUDIT_CACHE_VERSION = 1
FEMA_AUDIT_PATH = Path(__file__).with_name("benchmark_fema_audit.json")


def download_nad_reference(longitude, latitude, radius_miles):
    west, south, east, north = enclosing_bbox(longitude, latitude, radius_miles)
    features = []
    offset = 0
    while True:
        query = urllib.parse.urlencode(
            {
                "f": "json",
                "where": "StNam_Full IS NOT NULL AND AddNo_Full IS NOT NULL",
                "geometry": f"{west},{south},{east},{north}",
                "geometryType": "esriGeometryEnvelope",
                "inSR": "4326",
                "outSR": "4326",
                "spatialRel": "esriSpatialRelIntersects",
                "outFields": "OBJECTID,AddNo_Full,StNam_Full,Post_City,Zip_Code",
                "returnGeometry": "true",
                "orderByFields": "OBJECTID",
                "resultOffset": offset,
                "resultRecordCount": 2000,
            }
        )
        with urllib.request.urlopen(f"{NAD_QUERY_URL}?{query}", timeout=45) as response:
            payload = json.load(response)
        if "error" in payload or not isinstance(payload.get("features"), list):
            raise RuntimeError(f"Invalid NAD response: {payload.get('error', payload)}")
        page = payload["features"]
        for item in page:
            attributes = item.get("attributes") or {}
            geometry = item.get("geometry") or {}
            street = attributes.get("StNam_Full")
            number = attributes.get("AddNo_Full")
            longitude_value = geometry.get("x")
            latitude_value = geometry.get("y")
            if (
                not isinstance(street, str)
                or not street.strip()
                or not isinstance(number, str)
                or not number.strip()
                or not isinstance(longitude_value, (int, float))
                or not isinstance(latitude_value, (int, float))
            ):
                continue
            features.append(
                {
                    "properties": {
                        "street": street,
                        "number": number,
                        "postal_city": attributes.get("Post_City"),
                        "postcode": attributes.get("Zip_Code"),
                        "address_levels": [],
                    },
                    "geometry": {
                        "type": "Point",
                        "coordinates": [longitude_value, latitude_value],
                    },
                }
            )
        if len(page) < 2000:
            return features
        offset += len(page)


def load_sources(name, longitude, latitude, radius_miles, cache_dir=None):
    cache_path = Path(cache_dir, f"{name}.json") if cache_dir else None
    if cache_path and cache_path.exists():
        payload = json.loads(cache_path.read_text(encoding="utf-8"))
        if (
            payload.get("cacheVersion") == CACHE_VERSION
            and payload["center"] == [longitude, latitude]
            and payload["radiusMiles"] == radius_miles
        ):
            if "fema" not in payload:
                payload["fema"] = download_fema_features(
                    longitude,
                    latitude,
                    radius_miles,
                )
                cache_path.write_text(
                    json.dumps(payload, separators=(",", ":")),
                    encoding="utf-8",
                )
            return (
                payload["roads"],
                payload["addresses"],
                payload["buildings"],
                payload["reference"],
                payload["fema"],
            )

    roads, addresses, buildings = download_features(longitude, latitude, radius_miles)
    reference = download_nad_reference(longitude, latitude, radius_miles)
    fema = download_fema_features(longitude, latitude, radius_miles)
    if cache_path:
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        cache_path.write_text(
            json.dumps(
                {
                    "cacheVersion": CACHE_VERSION,
                    "center": [longitude, latitude],
                    "radiusMiles": radius_miles,
                    "roads": roads,
                    "addresses": addresses,
                    "buildings": buildings,
                    "reference": reference,
                    "fema": fema,
                },
                separators=(",", ":"),
            ),
            encoding="utf-8",
        )
    return roads, addresses, buildings, reference, fema


def audit_metrics(selected_ids, expected_ids, reviewed_ids):
    selected_reviewed = set(selected_ids) & set(reviewed_ids)
    expected = set(expected_ids)
    true_positives = selected_reviewed & expected
    false_positives = selected_reviewed - expected
    false_negatives = expected - selected_reviewed
    precision = (
        len(true_positives) / len(selected_reviewed) if selected_reviewed else 0
    )
    recall = len(true_positives) / len(expected) if expected else 1
    return {
        "reviewedCandidates": len(reviewed_ids),
        "expectedAccepted": len(expected),
        "selectedReviewed": len(selected_reviewed),
        "truePositives": len(true_positives),
        "falsePositiveIds": sorted(false_positives),
        "falseNegativeIds": sorted(false_negatives),
        "precision": precision,
        "recall": recall,
        "passed": not false_positives and not false_negatives,
    }


def load_audit_overture(fixture, cache_dir=None):
    longitude, latitude = fixture["center"]
    radius_miles = fixture["radiusMiles"]
    cache_path = (
        Path(cache_dir, "temecula-building-audit.json") if cache_dir else None
    )
    if cache_path and cache_path.exists():
        payload = json.loads(cache_path.read_text(encoding="utf-8"))
        if (
            payload.get("cacheVersion") in {3, CACHE_VERSION, AUDIT_CACHE_VERSION}
            and payload.get("center") == fixture["center"]
            and payload.get("radiusMiles") == radius_miles
        ):
            return payload["roads"], payload["addresses"], payload["buildings"]

    roads, addresses, buildings = download_features(
        longitude,
        latitude,
        radius_miles,
    )
    if cache_path:
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        cache_path.write_text(
            json.dumps(
                {
                    "cacheVersion": AUDIT_CACHE_VERSION,
                    "center": fixture["center"],
                    "radiusMiles": radius_miles,
                    "roads": roads,
                    "addresses": addresses,
                    "buildings": buildings,
                },
                separators=(",", ":"),
            ),
            encoding="utf-8",
        )
    return roads, addresses, buildings


def run_building_audit(cache_dir=None):
    fixture = json.loads(FEMA_AUDIT_PATH.read_text(encoding="utf-8"))
    candidates = fixture["candidates"]
    expected_ids = {
        candidate["sourceId"] for candidate in candidates if candidate["accepted"]
    }
    reviewed_ids = {candidate["sourceId"] for candidate in candidates}
    if len(reviewed_ids) != 50 or len(expected_ids) != 11:
        raise RuntimeError("The founder-reviewed FEMA benchmark fixture is invalid")
    roads, addresses, buildings = load_audit_overture(fixture, cache_dir)
    fema = [
        {
            "id": candidate["sourceId"],
            "geometry": candidate["geometry"],
            "properties": {
                "PRIM_OCC": "Single Family Dwelling",
                "OUTBLDG": False,
                "SOURCE": "FEMA USA Structures founder audit",
            },
        }
        for candidate in candidates
    ]
    selected, building_selection = select_map_buildings(
        addresses,
        buildings,
        fema,
        roads,
        include_metrics=True,
    )
    selected_ids = {
        building["sourceId"] for building in selected if building["source"] == "fema"
    }
    return {
        "area": "temecula-founder-audit",
        "center": fixture["center"],
        "radiusMiles": fixture["radiusMiles"],
        "buildingSelection": building_selection,
        **audit_metrics(selected_ids, expected_ids, reviewed_ids),
    }


def run_area(name, cache_dir=None):
    longitude, latitude, radius_miles = AREAS[name]
    roads, addresses, buildings, reference, fema = load_sources(
        name,
        longitude,
        latitude,
        radius_miles,
        cache_dir,
    )
    normalized = normalize_features(roads, addresses, buildings)
    _, building_selection = select_map_buildings(
        addresses,
        buildings,
        fema,
        roads,
        include_metrics=True,
    )
    return {
        "area": name,
        "center": [longitude, latitude],
        "radiusMiles": radius_miles,
        "source": {
            "roads": len(roads),
            "addresses": len(addresses),
            "residentialBuildings": len(buildings),
            "nadReferenceAddresses": len(reference),
        },
        "importQuality": normalized["quality"],
        "apartments": {
            "complexes": len(normalized["apartmentComplexes"]),
            "estimatedTracts": sum(
                item["estimatedTracts"] for item in normalized["apartmentComplexes"]
            ),
        },
        "buildingSelection": building_selection,
        "benchmark": benchmark_metrics(normalized, reference),
    }


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--area", choices=["all", *AREAS], default="all")
    parser.add_argument("--cache-dir")
    args = parser.parse_args(argv)
    names = AREAS if args.area == "all" else [args.area]
    results = [run_area(name, args.cache_dir) for name in names]
    building_audit = run_building_audit(args.cache_dir) if args.area == "all" else None
    output = {"areas": results}
    if building_audit is not None:
        output["buildingAudit"] = building_audit
    print(json.dumps(output, indent=2, sort_keys=True))
    return all(
        result["benchmark"]["classification"] != "below_usable_floor"
        for result in results
    ) and (building_audit is None or building_audit["passed"])


if __name__ == "__main__":
    raise SystemExit(0 if main() else 1)
