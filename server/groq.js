import { ApiError } from "./access.js";

export const DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b";
const COMPLETIONS_URL = "https://api.groq.com/openai/v1/chat/completions";

export async function groqCompletion({ service, model = DEFAULT_GROQ_MODEL, messages, maxTokens, responseFormat, timeout = 18_000 }) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new ApiError(503, service + " is temporarily unavailable.");

  let response;
  try {
    response = await fetch(COMPLETIONS_URL, {
      method: "POST",
      headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        max_completion_tokens: maxTokens,
        ...(model.startsWith("openai/gpt-oss-") ? { reasoning_effort: "low" } : {}),
        ...(responseFormat ? { response_format: responseFormat } : {}),
      }),
      signal: AbortSignal.timeout(timeout),
    });
  } catch {
    throw new ApiError(502, service + " did not respond. Please try again.");
  }

  if (response.status === 429) {
    throw new ApiError(429, service + " is busy. Wait a moment and try again.");
  }
  if (!response.ok) {
    throw new ApiError(502, service + " could not complete this request. Please try again.");
  }

  const data = await response.json().catch(() => null);
  const choice = data?.choices?.[0];
  const content = choice?.message?.content;
  if (choice?.finish_reason !== "stop" || typeof content !== "string" || !content.trim()) {
    throw new ApiError(502, service + " returned an incomplete response. Please try again.");
  }
  return content.trim();
}
