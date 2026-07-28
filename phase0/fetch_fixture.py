"""Download the pinned Overture subset used by the Phase 0 proof."""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path

import duckdb

RELEASE = "2026-06-17.0"
ADDRESS_URL = (
    f"s3://overturemaps-us-west-2/release/{RELEASE}/"
    "theme=addresses/type=*/*"
)
SEGMENT_URL = (
    f"s3://overturemaps-us-west-2/release/{RELEASE}/"
    "theme=transportation/type=segment/*"
)
PACKET_BBOX = [-117.123, 33.539, -117.112, 33.553]
OUTPUT = Path(__file__).with_name("fixture.json")


def main() -> None:
    connection = duckdb.connect()
    connection.install_extension("spatial")
    connection.load_extension("spatial")
    connection.install_extension("httpfs")
    connection.load_extension("httpfs")
    connection.execute("SET s3_region='us-west-2'")
    connection.execute("SET s3_access_key_id=''")
    connection.execute("SET s3_secret_access_key=''")
    connection.execute("SET s3_session_token=''")

    west, south, east, north = PACKET_BBOX
    addresses = [
        {
            "number": number,
            "street": street,
            "postcode": postcode,
            "lon": lon,
            "lat": lat,
        }
        for number, street, postcode, lon, lat in connection.execute(
            f"""
            SELECT number, street, postcode, lon, lat
            FROM (
                SELECT
                    trim(number) AS number,
                    upper(trim(street)) AS street,
                    trim(postcode) AS postcode,
                    bbox.xmin AS lon,
                    bbox.ymin AS lat,
                    row_number() OVER (
                        PARTITION BY
                            upper(trim(number)),
                            upper(trim(street)),
                            coalesce(trim(postcode), '')
                        ORDER BY id
                    ) AS duplicate_rank
                FROM read_parquet('{ADDRESS_URL}')
                WHERE bbox.xmin BETWEEN {west} AND {east}
                  AND bbox.ymin BETWEEN {south} AND {north}
                  AND number IS NOT NULL
                  AND street IS NOT NULL
            )
            WHERE duplicate_rank = 1
            ORDER BY street, try_cast(number AS INTEGER), number
            """
        ).fetchall()
    ]

    segments = [
        {
            "id": segment_id,
            "name": name,
            "class": road_class,
            "subclass": subclass,
            "coordinates": json.loads(geometry)["coordinates"],
        }
        for segment_id, name, road_class, subclass, geometry
        in connection.execute(
            f"""
            SELECT
                id,
                names.primary,
                class,
                subclass,
                ST_AsGeoJSON(geometry)
            FROM read_parquet('{SEGMENT_URL}')
            WHERE bbox.xmax >= {west}
              AND bbox.xmin <= {east}
              AND bbox.ymax >= {south}
              AND bbox.ymin <= {north}
              AND subtype = 'road'
              AND (
                  names.primary IS NOT NULL
                  OR class IN ('footway', 'path', 'cycleway')
              )
              AND NOT (
                  class = 'service'
                  AND subclass IN ('driveway', 'parking_aisle')
              )
            ORDER BY coalesce(names.primary, ''), id
            """
        ).fetchall()
    ]

    fixture = {
        "metadata": {
            "overture_release": RELEASE,
            "extracted_on": date.today().isoformat(),
            "church": {
                "address": (
                    "31087 Nicolas Rd, Temecula, CA 92591, United States"
                ),
                "lat": 33.54293,
                "lon": -117.116885,
            },
            "service_radius_miles": 10.0,
            "packet_bbox": PACKET_BBOX,
            "packet_target_homes": 50,
            "route_streets": ["Diego Drive", "Seraphina Road"],
            "sources": {
                "addresses": ADDRESS_URL,
                "transportation": SEGMENT_URL,
            },
            "attribution": (
                "OpenStreetMap contributors, Overture Maps Foundation"
            ),
        },
        "addresses": addresses,
        "segments": segments,
    }
    OUTPUT.write_text(json.dumps(fixture, indent=2) + "\n", encoding="utf-8")
    print(
        f"Wrote {OUTPUT} with {len(addresses)} addresses "
        f"and {len(segments)} road/path segments."
    )


if __name__ == "__main__":
    main()
