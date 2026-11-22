import json
import os
import unittest
from base64 import b64decode
from unittest.mock import patch

import httpx
from fastapi.testclient import TestClient

from doctorx_backend import main


PDF = b"%PDF-1.7\nsynthetic document"
PNG = b"\x89PNG\r\n\x1a\nsynthetic image"
AUTH = {"Authorization": "Bearer verified.fixture.token"}
METRIC = {"date": "2026-11-22T08:00:00Z", "value": 70, "unit": "bpm"}


class MedicalServiceTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(main.app)
        self.track_response = "Fixture analysis"
        self.provider_status = 200
        self.calls = []
        self.auth_allowed = True
        real_client = httpx.AsyncClient
        fixture_client = lambda **options: real_client(transport=httpx.MockTransport(self.provider), **options)
        environment = patch.dict(os.environ, {
            "LAB_SERVICE_API_KEY": "fixture-key",
            "TRACKING_SERVICE_API_KEY": "fixture-key",
            "GOOGLE_PLACES_API_KEY": "fixture-key",
            "FIREBASE_PROJECT_ID": "demo-doctorx",
            "VERCEL": "1",
        })
        patcher = patch.object(httpx, "AsyncClient", side_effect=fixture_client)
        environment.start()
        patcher.start()
        self.addCleanup(patcher.stop)
        self.addCleanup(environment.stop)
        main.limits.windows.clear()

    def provider(self, request):
        self.calls.append(request)
        if request.url.host == "identitytoolkit.googleapis.com":
            valid = self.auth_allowed and json.loads(request.content)["idToken"] == "verified.fixture.token"
            return httpx.Response(200, json={"users": [{"localId": "qa-owner"}]}) if valid else httpx.Response(400, json={})
        if request.url.host == "generativelanguage.googleapis.com":
            if self.provider_status != 200:
                return httpx.Response(self.provider_status, json={"error": "Fixture failure"})
            return httpx.Response(200, json={"candidates": [{
                "content": {"parts": [{"text": self.track_response}]},
                "finishReason": "STOP",
            }]})
        if request.url.host == "firestore.googleapis.com":
            return httpx.Response(200, json={"name": request.url.path + "/created-reading"})
        if request.url.host == "places.googleapis.com":
            place = {
                "id": "test-place",
                "displayName": {"text": "Test Medical Center"},
                "formattedAddress": "Fixture Street",
                "location": {"latitude": 0, "longitude": 0},
                "currentOpeningHours": {"openNow": True},
                "nationalPhoneNumber": "555-0100",
            }
            return httpx.Response(200, json=place if request.method == "GET" else {"places": [place]})
        raise AssertionError("Unexpected provider host")

    def upload(self, path, content=PDF, **kwargs):
        return self.client.post(path, headers=AUTH, files={"file": ("synthetic.pdf", content, "application/pdf")}, **kwargs)

    def model_request(self):
        return json.loads(next(call.content for call in self.calls if call.url.host == "generativelanguage.googleapis.com"))

    def test_missing_or_invalid_auth_stops_before_provider_generation(self):
        response = self.client.post("/api/medical-analysis", files={"file": ("sample.pdf", PDF)})
        self.assertEqual(response.status_code, 401)
        self.assertEqual(self.calls, [])
        self.auth_allowed = False
        self.assertEqual(self.upload("/api/medical-analysis").status_code, 401)
        self.assertEqual(len(self.calls), 1)

    def test_pdf_bytes_and_mime_type_reach_gemini(self):
        response = self.upload("/api/medical-analysis")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["analysis"], "Fixture analysis")
        attachment = self.model_request()["contents"][0]["parts"][1]["inlineData"]
        self.assertEqual(attachment["mimeType"], "application/pdf")
        self.assertEqual(b64decode(attachment["data"]), PDF)

    def test_validation_and_provider_errors_are_http_errors(self):
        self.assertEqual(self.upload("/api/medical-analysis", b"plain text").status_code, 415)
        self.assertEqual(self.upload("/api/medical-analysis", PNG + b"a" * (4 * 1024 * 1024)).status_code, 413)
        self.provider_status = 503
        failed = self.upload("/api/medical-analysis")
        self.assertEqual(failed.status_code, 502)
        self.assertNotIn("Fixture failure", failed.text)

    def test_scan_reads_form_fields_and_rejects_invalid_or_empty_extraction(self):
        self.track_response = json.dumps({"heart_rate": [{"value": 70, "unit": "bpm"}]})
        result = self.upload("/api/health-tracking/scan-report", data={"condition": "General", "report_date": METRIC["date"]})
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json()["condition"], "General")
        self.assertEqual(result.json()["extracted_data"]["heart_rate"][0]["date"], "2026-11-22T08:00:00+00:00")
        self.assertEqual(self.model_request()["generationConfig"]["responseMimeType"], "application/json")
        self.track_response = "{}"
        self.assertEqual(self.upload("/api/health-tracking/scan-report").status_code, 422)
        self.track_response = "{"
        self.assertEqual(self.upload("/api/health-tracking/scan-report").status_code, 502)

    def test_tracking_send_only_the_readings_and_return_statistics(self):
        result = self.client.post("/api/health-tracking/analyze", headers=AUTH, json={
            "patient_id": "irrelevant-supplied-id",
            "condition": "General",
            "heart_rate": [METRIC],
        })
        self.assertEqual(result.status_code, 200)
        self.assertNotIn("irrelevant-supplied-id", json.dumps(self.model_request()))
        result = self.client.post("/api/health-tracking/trend-analysis", headers=AUTH, json={
            "metric_type": "heart_rate", "readings": [METRIC, {**METRIC, "value": 74}],
        })
        self.assertEqual(result.json()["statistics"]["average"], 72)
        result = self.client.post("/api/health-tracking/trend-analysis", headers=AUTH, json={
            "metric_type": "heart_rate", "readings": [METRIC, {**METRIC, "unit": "other"}],
        })
        self.assertEqual(result.status_code, 422)

    def test_quick_log_persists_under_verified_uid(self):
        result = self.client.post("/api/health-tracking/quick-log", headers=AUTH, json={
            "patient_id": "another-user",
            "metric_type": "heart_rate",
            "reading": METRIC,
        })
        self.assertEqual(result.status_code, 201)
        self.assertEqual(result.json()["data"]["id"], "created-reading")
        firestore = self.calls[-1]
        self.assertTrue(firestore.url.path.endswith("/healthTracking/qa-owner/readings"))
        self.assertEqual(firestore.headers["authorization"], AUTH["Authorization"])

    def test_nearby_and_details_use_places_new_and_keep_map_contract(self):
        response = self.client.get("/api/v1/nearby-finder?latitude=0&longitude=0&facility_type=clinic")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["facilities"][0]["open_now"])
        self.assertEqual(self.calls[-1].url.path, "/v1/places:searchNearby")
        self.assertEqual(json.loads(self.calls[-1].content)["includedTypes"], ["medical_clinic", "medical_center"])
        response = self.client.get("/api/v1/facility-details/test-place")
        self.assertEqual(response.json()["details"]["phone"], "555-0100")

    def test_legacy_placeholder_routes_have_working_contracts(self):
        result = self.client.post("/api/chronic-care", headers=AUTH, json={"condition": "General", "symptoms": "", "age": 30})
        self.assertEqual(result.json()["plan"], "Fixture analysis")
        result = self.client.post("/api/recovery-plan", headers=AUTH, json={"surgery_type": "Test", "days_post_op": 2, "pain_level": 0})
        self.assertEqual(result.json()["status"], "ready")
        self.assertTrue(result.json()["checklist"])
        result = self.client.post("/api/find-specialist", json={"location": "Test City"})
        self.assertTrue(result.json()["doctors"])
        self.assertEqual(self.calls[-1].url.path, "/v1/places:searchText")
