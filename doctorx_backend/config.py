import json
import os
from pathlib import Path

from dotenv import load_dotenv


ROOT = Path(__file__).resolve().parents[1]
if not os.getenv("VERCEL"):
    load_dotenv(ROOT / ".env.local")
    load_dotenv(ROOT / ".env")
    load_dotenv(ROOT / "api" / "python-ai-agents" / ".env")

FIREBASE_PUBLIC = json.loads((ROOT / "shared" / "firebase-public.json").read_text(encoding="utf-8"))
DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite"
MAX_UPLOAD_BYTES = 4 * 1024 * 1024
MAX_REQUEST_BYTES = MAX_UPLOAD_BYTES + 64 * 1024


def firebase_web_key() -> str:
    return os.getenv("FIREBASE_WEB_API_KEY") or os.getenv("VITE_FIREBASE_API_KEY") or FIREBASE_PUBLIC["apiKey"]


def firebase_project() -> str:
    return os.getenv("FIREBASE_PROJECT_ID") or os.getenv("VITE_FIREBASE_PROJECT_ID") or FIREBASE_PUBLIC["projectId"]


def gemini_key(service: str) -> str | None:
    return os.getenv(f"{service}_SERVICE_API_KEY") or os.getenv("GOOGLE_API_KEY")


def gemini_model(service: str) -> str:
    return os.getenv(f"{service}_GEMINI_MODEL") or os.getenv("GEMINI_MODEL") or DEFAULT_GEMINI_MODEL


def maps_key() -> str | None:
    return os.getenv("GOOGLE_PLACES_API_KEY") or os.getenv("Maps_API_KEY")
