import publicFirebaseConfig from "../shared/firebase-public.json" with { type: "json" };

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export async function requireUser(req) {
  const authorization = req.headers?.authorization;
  const token = typeof authorization === "string" && authorization.match(/^Bearer ([A-Za-z0-9._-]{1,8192})$/i)?.[1];
  if (!token) {
    throw new ApiError(401, "Please sign in to use this service.");
  }

  const key = process.env.FIREBASE_WEB_API_KEY || process.env.VITE_FIREBASE_API_KEY || publicFirebaseConfig.apiKey;
  const emulator = !process.env.VERCEL && process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const url = new URL(emulator
    ? "http://" + emulator + "/identitytoolkit.googleapis.com/v1/accounts:lookup"
    : "https://identitytoolkit.googleapis.com/v1/accounts:lookup");
  url.searchParams.set("key", key);
  let response;
  let data;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: token }),
      signal: AbortSignal.timeout(7000),
    });
    data = await response.json();
  } catch {
    throw new ApiError(502, "Sign-in verification is temporarily unavailable.");
  }

  if (response.status === 429 || response.status >= 500) {
    throw new ApiError(502, "Sign-in verification is temporarily unavailable.");
  }
  const user = data?.users?.[0];
  if (!response.ok || !user?.localId || user.disabled) {
    throw new ApiError(401, "Your session expired. Please sign in again.");
  }
  return user.localId;
}

const requestWindows = new Map();
const windowMs = 60_000;
let nextCleanup = 0;

export function limitRequests(service, uid, maximum) {
  const now = Date.now();
  if (now >= nextCleanup) {
    for (const [key, window] of requestWindows) {
      if (window.expiresAt <= now) requestWindows.delete(key);
    }
    nextCleanup = now + windowMs;
  }

  const key = service + ":" + uid;
  let window = requestWindows.get(key);
  if (!window || window.expiresAt <= now) {
    window = { count: 0, expiresAt: now + windowMs };
    requestWindows.set(key, window);
  }
  window.count += 1;
  if (window.count > maximum) {
    throw new ApiError(429, "Too many requests. Please wait a minute and try again.");
  }
}

export function limitChatRequests(uid) {
  limitRequests("chat", uid, 12);
}
