import chat from "../api/chat.js";
import aiDoctor from "../api/ai-doctor.js";
import health from "../api/health.js";
import symptomAssessment from "../api/symptom-assessment.js";
import who from "../api/who.js";

const routes = new Map(Object.entries({
  "/api/chat": chat,
  "/api/ai-doctor": aiDoctor,
  "/api/health": health,
  "/api/symptom-assessment": symptomAssessment,
  "/api/who": who,
}));

export const pythonApiPattern = /^\/api\/(medical-analysis|python-health|health-tracking|v1|chronic-care|recovery-plan|find-specialist)(\/|\?|$)/;

async function readJson(req) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes <= 64 * 1024) chunks.push(chunk);
  }
  if (bytes > 64 * 1024) {
    const error = new Error("Request body is too large.");
    error.status = 413;
    throw error;
  }
  return bytes ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

function mountNodeApi(server) {
  server.middlewares.use(async (req, res, next) => {
    const url = new URL(req.url, "http://localhost");
    const handler = routes.get(url.pathname);
    if (!handler) {
      const isApi = url.pathname === "/api" || url.pathname.startsWith("/api/");
      if (!isApi || pythonApiPattern.test(url.pathname)) return next();
      res.statusCode = 404;
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ error: "API route not found." }));
    }

    res.status = code => { res.statusCode = code; return res; };
    res.json = body => {
      if (!res.hasHeader("Content-Type")) res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify(body));
    };
    req.query = Object.fromEntries(url.searchParams);
    if (req.method === "POST") {
      try {
        req.body = await readJson(req);
      } catch (error) {
        return res.status(error.status ?? 400).json({ error: error.status ? error.message : "Invalid JSON." });
      }
    }
    try {
      await handler(req, res);
    } catch {
      if (!res.headersSent) res.status(500).json({ error: "The service could not complete the request." });
    }
  });
}

export default function nodeApiPlugin() {
  return {
    name: "doctorx-node-api",
    configureServer: mountNodeApi,
    configurePreviewServer: mountNodeApi,
  };
}
