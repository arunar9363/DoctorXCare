import json
import os
from datetime import UTC, datetime
from typing import Annotated, Literal

from fastapi import Depends, FastAPI, File, Form, HTTPException, Path, Query, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, ValidationError

from . import gemini, places, tracking
from .access import User, authenticated_user, finder_client, limits
from .config import MAX_REQUEST_BYTES, gemini_key, maps_key


app = FastAPI()
origins = [
    "http://localhost:5173", "http://127.0.0.1:5173", "https://doctorcare-x.vercel.app",
    "https://doctorxcare.in", "https://www.doctorxcare.in",
]
origins.extend(origin.strip() for origin in os.getenv("DOCTORX_ALLOWED_ORIGINS", "").split(",") if origin.strip())
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type"],
)
Session = Annotated[User, Depends(authenticated_user)]


@app.middleware("http")
async def protect_request(request: Request, call_next):
    length = request.headers.get("content-length", "")
    if length.isdecimal() and int(length) > MAX_REQUEST_BYTES:
        return JSONResponse(status_code=413, content={"detail": "The request is too large."})
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    return response


@app.exception_handler(RequestValidationError)
async def validation_error(_request, error):
    fields = [".".join(map(str, field["loc"])) for field in error.errors()]
    return JSONResponse(status_code=422, content={"detail": "Check the submitted fields and try again.", "fields": fields})


@app.post("/api/medical-analysis")
async def analyze_report(user: Session, file: UploadFile = File(...)):
    limits.check("lab", user.uid, 8)
    attachment = await gemini.upload_part(file)
    return {"analysis": await gemini.generate("LAB", gemini.LAB_PROMPT, attachment=attachment)}


@app.post("/api/health-tracking/scan-report")
async def scan_health_report(
    user: Session,
    file: UploadFile = File(...),
    condition: str = Form(default="General", max_length=120),
    report_date: datetime | None = Form(default=None),
):
    limits.check("scan", user.uid, 8)
    attachment = await gemini.upload_part(file)
    text = await gemini.generate("TRACKING", gemini.SCAN_PROMPT, attachment=attachment, json_output=True)
    try:
        measurements = tracking.Measurements.model_validate_json(text)
    except ValidationError:
        raise HTTPException(502, "The scanner could not read structured measurements from this report.") from None
    items = measurements.summaries()
    if not items:
        raise HTTPException(422, "No readable measurements were found. Try a clearer report or add the readings manually.")
    date = report_date or datetime.now(UTC)
    for readings in items.values():
        for reading in readings:
            if not reading.get("date"):
                reading["date"] = date.isoformat()
    return {"success": True, "condition": condition, "extracted_data": items}


@app.post("/api/health-tracking/analyze")
async def analyze_tracking(data: tracking.HealthTrackingData, user: Session):
    limits.check("analysis", user.uid, 10)
    if not data.model_dump(include=set(tracking.Measurements.model_fields), exclude_defaults=True):
        raise HTTPException(422, "Add at least one reading before requesting an analysis.")
    prompt = (
        "Summarize the recorded measurements and any trends. Group results by metric and unit. "
        "Do not combine values with different units or infer context that is missing. "
        "Use short Markdown headings for summary, observations, questions for the care team and limitations.\n"
        + json.dumps(data.summaries(), ensure_ascii=False)
    )
    return {"success": True, "condition": data.condition, "analysis": await gemini.generate("TRACKING", prompt)}


@app.post("/api/health-tracking/trend-analysis")
async def trend_analysis(data: tracking.TrendAnalysisRequest, user: Session):
    limits.check("trend", user.uid, 10)
    readings = data.readings
    if data.metric_type == "blood_pressure":
        if not all(isinstance(reading, tracking.BloodPressureReading) for reading in readings):
            raise HTTPException(422, "Blood pressure trends require systolic and diastolic values.")
        statistics = {
            "systolic": tracking.statistics([reading.systolic for reading in readings]),
            "diastolic": tracking.statistics([reading.diastolic for reading in readings]),
            "total_readings": len(readings),
        }
    else:
        if not all(isinstance(reading, tracking.VitalReading) for reading in readings):
            raise HTTPException(422, "The readings must match the selected metric.")
        units = {reading.unit for reading in readings}
        if len(units) != 1:
            raise HTTPException(422, "Use a single unit for each trend analysis.")
        statistics = tracking.statistics([reading.value for reading in readings])
        statistics["unit"] = next(iter(units))

    prompt = (
        "Describe the direction and limits of this trend without assigning a diagnosis or advising treatment changes.\n"
        + data.model_dump_json()
        + "\nComputed statistics: " + json.dumps(statistics)
    )
    return {
        "success": True, "metric_type": data.metric_type, "time_range": data.time_range,
        "insights": await gemini.generate("TRACKING", prompt), "statistics": statistics,
    }


@app.post("/api/health-tracking/quick-log", status_code=201)
async def quick_log(
    user: Session,
    data: tracking.QuickLogRequest | None = None,
    metric_type: tracking.Metric | None = None,
    value: float | None = None,
    unit: str | None = None,
    context: str | None = None,
):
    limits.check("quick-log", user.uid, 30)
    if data is None:
        try:
            data = tracking.QuickLogRequest(
                metric_type=metric_type,
                reading=tracking.VitalReading(value=value, unit=unit, context=context),
            )
        except ValidationError:
            raise HTTPException(422, "Supply the metric, measurement and unit.") from None
    return {"success": True, "message": "Reading saved.", "data": await tracking.persist_reading(user, data)}


@app.get("/api/v1/nearby-finder")
async def nearby_finder(
    request: Request,
    latitude: float = Query(ge=-90, le=90),
    longitude: float = Query(ge=-180, le=180),
    facility_type: Literal["hospital", "pharmacy", "doctor", "emergency", "clinic"] = "hospital",
    radius: int | None = Query(default=None, ge=100, le=50000),
):
    limits.check("places", finder_client(request), 24)
    results = await places.nearby(latitude, longitude, facility_type, radius)
    return {
        "success": True, "facility_type": facility_type, "total": len(results),
        "location": {"latitude": latitude, "longitude": longitude}, "facilities": results,
    }


@app.get("/api/v1/facility-details/{place_id}")
async def facility_details(request: Request, place_id: str = Path(min_length=5, max_length=512, pattern=r"^[A-Za-z0-9_-]+$")):
    limits.check("places", finder_client(request), 24)
    return {"success": True, "details": await places.details(place_id)}


class HealthData(BaseModel):
    condition: str = Field(min_length=1, max_length=120)
    symptoms: str = Field(max_length=1000)
    age: int = Field(ge=0, le=130)


class RecoveryData(BaseModel):
    surgery_type: str = Field(min_length=1, max_length=120)
    days_post_op: int = Field(ge=0)
    pain_level: int = Field(ge=0, le=10)


class SpecialistSearch(BaseModel):
    location: str = Field(min_length=1, max_length=160)


@app.post("/api/chronic-care")
async def chronic_care_advice(data: HealthData, user: Session):
    limits.check("analysis", user.uid, 10)
    prompt = (
        "Prepare a brief tracking and appointment discussion plan for this recorded condition. "
        "Keep recommendations about recording information and questions for the care team. "
        "Do not prescribe a treatment plan or assign clinical targets.\n" + data.model_dump_json()
    )
    return {"plan": await gemini.generate("TRACKING", prompt)}


@app.post("/api/recovery-plan")
async def recovery_plan(data: RecoveryData, user: Session):
    limits.check("recovery", user.uid, 20)
    return {
        "status": "ready",
        "recovery_summary": data.model_dump(),
        "checklist": [
            "Review your discharge instructions and check which follow-up steps they list.",
            "Record your current pain rating and any changes to discuss with your care team.",
            "Confirm the date of your follow-up and how to get in touch if new concerns arise.",
            "Prepare a list of your questions and any difficulties following the instructions you received.",
        ],
    }


@app.post("/api/find-specialist")
async def find_specialist(data: SpecialistSearch, request: Request):
    limits.check("places", finder_client(request), 24)
    return {"doctors": await places.search_by_text(f"medical specialists in {data.location}")}


@app.get("/")
@app.get("/api/python-health")
async def health_check():
    services = {
        "lab_analysis": bool(gemini_key("LAB")),
        "health_tracking": bool(gemini_key("TRACKING")),
        "nearby_finder": bool(maps_key()),
    }
    ready = all(services.values())
    return JSONResponse(
        status_code=200 if ready else 503,
        content={"status": "ready" if ready else "incomplete", "services_configured": services},
    )
