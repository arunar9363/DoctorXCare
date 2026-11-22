import { auth } from "../firebase";

export async function requestJson(path, { authenticated = false, ...options } = {}) {
  const headers = new Headers(options.headers);
  if (authenticated) {
    const user = auth.currentUser;
    if (!user) throw new Error("Please sign in to use this service.");
    try {
      headers.set("Authorization", "Bearer " + await user.getIdToken());
    } catch {
      throw new Error("Your session could not be verified. Please sign in again.");
    }
  }

  const response = await fetch(path, { ...options, headers });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) {
    const message = data?.detail || data?.error;
    if (typeof message === "string") throw new Error(message);
    if (response.status === 413) throw new Error("The file is too large. Upload a file no larger than 4 MB.");
    throw new Error("The service is temporarily unavailable. Please try again.");
  }
  return data;
}

export function reportUploadError(file) {
  if (file.size > 4 * 1024 * 1024) return "Upload a file no larger than 4 MB.";
  if (file.size === 0) return "The selected file is empty.";
  if (!/\.(pdf|png|jpe?g)$/i.test(file.name)) return "Choose a PDF, PNG, or JPEG file.";
  return "";
}
