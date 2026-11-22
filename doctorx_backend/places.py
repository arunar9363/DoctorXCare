from math import asin, cos, radians, sin, sqrt
from urllib.parse import quote

import httpx
from fastapi import HTTPException

from .config import maps_key


PLACES_URL = "https://places.googleapis.com/v1/places"
TYPES = {
    "hospital": ["hospital", "general_hospital"],
    "pharmacy": ["pharmacy", "drugstore"],
    "doctor": ["doctor", "medical_clinic"],
    "clinic": ["medical_clinic", "medical_center"],
}
BASIC_FIELDS = (
    "id", "displayName", "formattedAddress", "location", "rating", "userRatingCount",
    "currentOpeningHours", "businessStatus", "types", "googleMapsUri", "attributions",
)
DETAIL_FIELDS = BASIC_FIELDS + ("nationalPhoneNumber", "websiteUri", "regularOpeningHours")


async def place_request(method: str, path: str, fields: tuple[str, ...], *, payload: dict | None = None) -> dict:
    key = maps_key()
    if not key:
        raise HTTPException(503, "Nearby search is temporarily unavailable.")
    try:
        async with httpx.AsyncClient(timeout=9) as client:
            response = await client.request(
                method, PLACES_URL + path,
                headers={"X-Goog-Api-Key": key, "X-Goog-FieldMask": ",".join(fields)},
                json=payload,
            )
        if method == "GET" and response.status_code == 404:
            raise HTTPException(404, "This facility could not be found.")
        if response.status_code in (401, 403):
            raise HTTPException(503, "Google Places is unavailable for in-app search.")
        response.raise_for_status()
        data = response.json()
        if not isinstance(data, dict):
            raise ValueError("Unexpected Places response")
        return data
    except (httpx.HTTPError, ValueError):
        raise HTTPException(502, "Google Places could not complete this search. Please try again.") from None


def facility(place: dict) -> dict:
    location = place.get("location", {})
    current_hours = place.get("currentOpeningHours", {})
    return {
        "id": place["id"],
        "name": place["displayName"]["text"],
        "address": place.get("formattedAddress", ""),
        "vicinity": place.get("formattedAddress", ""),
        "rating": place.get("rating"),
        "user_ratings_total": place.get("userRatingCount", 0),
        "is_open": current_hours.get("openNow"),
        "open_now": current_hours.get("openNow"),
        "geometry": {"lat": location["latitude"], "lng": location["longitude"]},
        "types": place.get("types", []),
        "business_status": place.get("businessStatus"),
        "phone": place.get("nationalPhoneNumber"),
        "website": place.get("websiteUri"),
        "opening_hours": place.get("regularOpeningHours", {}).get("weekdayDescriptions", []),
        "url": place.get("googleMapsUri"),
        "attributions": place.get("attributions", []),
    }


def facilities(result: dict) -> list[dict]:
    return [
        facility(place) for place in result.get("places", [])
        if place.get("id") and place.get("displayName", {}).get("text")
        and {"latitude", "longitude"} <= place.get("location", {}).keys()
        and place.get("businessStatus") not in ("CLOSED_PERMANENTLY", "CLOSED_TEMPORARILY")
    ]


async def search_by_text(query: str, *, circle: dict | None = None) -> list[dict]:
    payload = {"textQuery": query, "pageSize": 20}
    if circle:
        payload["locationBias"] = {"circle": circle}
    result = await place_request("POST", ":searchText", tuple(f"places.{field}" for field in BASIC_FIELDS), payload=payload)
    return facilities(result)


def distance_meters(latitude: float, longitude: float, place: dict) -> float:
    point = place["geometry"]
    delta_lat = radians(point["lat"] - latitude)
    delta_lng = radians(point["lng"] - longitude)
    factor = sin(delta_lat / 2) ** 2 + cos(radians(latitude)) * cos(radians(point["lat"])) * sin(delta_lng / 2) ** 2
    return 12_742_000 * asin(sqrt(min(1, factor)))


async def nearby(latitude: float, longitude: float, facility_type: str, radius: int | None) -> list[dict]:
    radius = radius or (3000 if facility_type == "pharmacy" else 5000)
    circle = {"center": {"latitude": latitude, "longitude": longitude}, "radius": radius}
    if facility_type == "emergency":
        matches = await search_by_text("emergency department", circle=circle)
        close = [(distance_meters(latitude, longitude, place), place) for place in matches]
        return [place for distance, place in sorted(close, key=lambda item: item[0]) if distance <= radius]

    result = await place_request(
        "POST", ":searchNearby", tuple(f"places.{field}" for field in BASIC_FIELDS),
        payload={
            "includedTypes": TYPES[facility_type],
            "maxResultCount": 20,
            "rankPreference": "DISTANCE",
            "locationRestriction": {"circle": circle},
        },
    )
    return facilities(result)


async def details(place_id: str) -> dict:
    place = await place_request("GET", "/" + quote(place_id, safe=""), DETAIL_FIELDS)
    try:
        return facility(place)
    except (TypeError, KeyError):
        raise HTTPException(502, "Google Places returned incomplete facility details.") from None
