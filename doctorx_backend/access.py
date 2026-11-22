import os
import re
from dataclasses import dataclass
from time import monotonic

import httpx
from fastapi import Header, HTTPException, Request

from .config import firebase_web_key


@dataclass(frozen=True)
class User:
    uid: str
    token: str


async def authenticated_user(authorization: str | None = Header(default=None)) -> User:
    match = re.fullmatch(r"Bearer ([A-Za-z0-9._-]{1,8192})", authorization or "", re.IGNORECASE)
    if not match:
        raise HTTPException(401, "Please sign in to use this service.", headers={"WWW-Authenticate": "Bearer"})

    token = match[1]
    url = "https://identitytoolkit.googleapis.com/v1/accounts:lookup"
    emulator = os.getenv("FIREBASE_AUTH_EMULATOR_HOST")
    if emulator and not os.getenv("VERCEL"):
        url = f"http://{emulator}/identitytoolkit.googleapis.com/v1/accounts:lookup"
    try:
        async with httpx.AsyncClient(timeout=7) as client:
            response = await client.post(
                url,
                params={"key": firebase_web_key()},
                json={"idToken": token},
            )
        data = response.json()
    except (httpx.HTTPError, ValueError):
        raise HTTPException(502, "Sign-in verification is temporarily unavailable.") from None

    if response.status_code == 429 or response.status_code >= 500:
        raise HTTPException(502, "Sign-in verification is temporarily unavailable.")
    users = data.get("users") if isinstance(data, dict) else None
    user = users[0] if isinstance(users, list) and users else {}
    if not response.is_success or not isinstance(user, dict) or not user.get("localId") or user.get("disabled"):
        raise HTTPException(401, "Your session expired. Please sign in again.", headers={"WWW-Authenticate": "Bearer"})
    return User(uid=user["localId"], token=token)


class RequestLimits:
    def __init__(self):
        self.windows: dict[tuple[str, str], tuple[float, int]] = {}
        self.cleanup_at = 0

    def check(self, service: str, client_id: str, maximum: int) -> None:
        now = monotonic()
        if now >= self.cleanup_at:
            self.windows = {key: value for key, value in self.windows.items() if value[0] > now}
            self.cleanup_at = now + 60

        key = (service, client_id)
        expires, count = self.windows.get(key, (now + 60, 0))
        if expires <= now:
            expires, count = now + 60, 0
        if count >= maximum:
            raise HTTPException(429, "Too many requests. Please wait a minute and try again.", headers={"Retry-After": "60"})
        self.windows[key] = (expires, count + 1)


def finder_client(request: Request) -> str:
    if os.getenv("VERCEL") == "1":
        ip = request.headers.get("x-vercel-forwarded-for")
        if ip:
            return ip.split(",", 1)[0].strip()
    return request.client.host if request.client else "anonymous"


limits = RequestLimits()
