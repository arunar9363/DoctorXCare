import { ApiError, limitRequests, requireUser } from "../server/access.js";
import { runAssessment } from "../server/symptomAssessment.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  try {
    const uid = await requireUser(req);
    limitRequests("symptom-assessment", uid, 24);
    return res.status(200).json(await runAssessment(req.body, uid));
  } catch (error) {
    if (error instanceof ApiError) return res.status(error.status).json({ error: error.message });
    return res.status(500).json({ error: "The symptom assessment could not be completed. Please try again." });
  }
}
