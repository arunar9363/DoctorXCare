import os
from datetime import UTC, datetime
from typing import Annotated, Literal
from urllib.parse import quote

import httpx
from fastapi import HTTPException
from pydantic import BaseModel, Field, FiniteFloat, StringConstraints

from .access import User
from .config import firebase_project


Metric = Literal["blood_pressure", "blood_glucose", "heart_rate", "weight", "oxygen_saturation", "tsh", "t3", "t4"]
ShortText = Annotated[str, Field(max_length=120)]
Measurement = Annotated[FiniteFloat, Field(ge=0)]


class Reading(BaseModel):
    date: datetime | None = None
    context: ShortText | None = None
    notes: str | None = Field(default=None, max_length=500)


class VitalReading(Reading):
    value: Measurement
    unit: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=24)]


class BloodPressureReading(Reading):
    systolic: FiniteFloat = Field(gt=0)
    diastolic: FiniteFloat = Field(gt=0)
    pulse: int | None = Field(default=None, gt=0)


class Measurements(BaseModel):
    blood_pressure: list[BloodPressureReading] = Field(default_factory=list, max_length=250)
    blood_glucose: list[VitalReading] = Field(default_factory=list, max_length=250)
    heart_rate: list[VitalReading] = Field(default_factory=list, max_length=250)
    weight: list[VitalReading] = Field(default_factory=list, max_length=250)
    oxygen_saturation: list[VitalReading] = Field(default_factory=list, max_length=250)
    tsh: list[VitalReading] = Field(default_factory=list, max_length=250)
    t3: list[VitalReading] = Field(default_factory=list, max_length=250)
    t4: list[VitalReading] = Field(default_factory=list, max_length=250)

    def summaries(self):
        return self.model_dump(mode="json", exclude_defaults=True, exclude_none=True)


class HealthTrackingData(Measurements):
    condition: str = Field(min_length=1, max_length=120)
    medications: list[dict[str, ShortText]] = Field(default_factory=list, max_length=30)
    symptoms: str | None = Field(default=None, max_length=1000)
    lifestyle_changes: str | None = Field(default=None, max_length=1000)


class TrendAnalysisRequest(BaseModel):
    metric_type: Metric
    time_range: int = Field(default=30, ge=1, le=365)
    readings: list[BloodPressureReading | VitalReading] = Field(min_length=2, max_length=500)


class QuickLogRequest(BaseModel):
    metric_type: Metric
    reading: BloodPressureReading | VitalReading


def statistics(values: list[float]) -> dict:
    return {
        "average": round(sum(values) / len(values), 2),
        "min": min(values),
        "max": max(values),
        "total_readings": len(values),
    }


async def persist_reading(user: User, data: QuickLogRequest) -> dict:
    reading = data.reading
    if (data.metric_type == "blood_pressure") != isinstance(reading, BloodPressureReading):
        raise HTTPException(422, "The reading must match its metric type.")
    if not reading.date:
        reading.date = datetime.now(UTC)
    entry = {"metric": data.metric_type, **reading.model_dump(mode="json", exclude_none=True)}
    fields = {
        key: {"stringValue": value} if isinstance(value, str) else {"doubleValue": value}
        for key, value in entry.items()
    }
    project = quote(firebase_project(), safe="")
    uid = quote(user.uid, safe="")
    base_url = "https://firestore.googleapis.com"
    emulator = os.getenv("FIRESTORE_EMULATOR_HOST")
    if emulator and not os.getenv("VERCEL"):
        base_url = f"http://{emulator}"
    url = f"{base_url}/v1/projects/{project}/databases/(default)/documents/healthTracking/{uid}/readings"
    try:
        async with httpx.AsyncClient(timeout=9) as client:
            response = await client.post(
                url, headers={"Authorization": f"Bearer {user.token}"}, json={"fields": fields},
            )
        response.raise_for_status()
        entry["id"] = response.json()["name"].rsplit("/", 1)[-1]
    except (httpx.HTTPError, KeyError, ValueError):
        raise HTTPException(502, "The reading could not be saved. Please try again.") from None
    return entry
