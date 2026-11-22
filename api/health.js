export default function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET, OPTIONS");
    return res.status(405).json({ error: "Method not allowed." });
  }

  const ready = Boolean(process.env.GROQ_API_KEY);
  const servicesConfigured = { chat: ready, symptomAssessment: ready };
  return res.status(ready ? 200 : 503).json({
    status: ready ? "ready" : "incomplete",
    servicesConfigured,
    timestamp: new Date().toISOString(),
    environment: process.env.VERCEL_ENV || "development",
    availableEndpoints: ["GET /api/health", "POST /api/chat", "POST /api/symptom-assessment", "GET /api/who"],
  });
}
