import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { ApiError } from "./access.js";
import { assessmentReport, interviewDecision } from "./groqTriage.js";
import { CARE_GUIDANCE, emergencyAssessment, MAX_QUESTIONS, MIN_QUESTIONS, SEX_LABELS } from "../shared/triage.js";

const SESSION_TTL = 60 * 60 * 1000;

function key() {
  const secret = process.env.TRIAGE_SESSION_SECRET || process.env.GROQ_API_KEY;
  if (!secret) throw new ApiError(503, "The symptom assessment service is temporarily unavailable.");
  return secret;
}

function sign(encoded) {
  return createHmac("sha256", key()).update("doctorx-triage-v1.").update(encoded).digest();
}

function saveSession(state) {
  const payload = Buffer.from(JSON.stringify(state)).toString("base64url");
  return payload + "." + sign(payload).toString("base64url");
}

function readSession(token, uid) {
  const invalid = new ApiError(400, "This interview could not be verified. Start a new assessment.");
  if (typeof token !== "string" || token.length > 60_000 || !/^[\w-]+\.[\w-]{43}$/.test(token)) throw invalid;
  const [payload, signature] = token.split(".");
  const supplied = Buffer.from(signature, "base64url");
  const expected = sign(payload);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw invalid;

  let state;
  try {
    state = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (state.uid !== uid || !state.question || state.answers.length >= MAX_QUESTIONS) throw invalid;
  } catch {
    throw invalid;
  }
  if (state.expiresAt <= Date.now()) {
    throw new ApiError(409, "This interview has expired. Start a new assessment.");
  }
  return state;
}

function intakeFrom(value) {
  const { age, sex, safety } = value ?? {};
  const symptoms = typeof value?.symptoms === "string" ? value.symptoms.trim() : "";
  if (!Number.isInteger(age) || age < 0 || age > 120) {
    throw new ApiError(400, "Enter an age from 0 to 120 years.");
  }
  if (typeof sex !== "string" || !Object.hasOwn(SEX_LABELS, sex) || !["none", "unsure"].includes(safety)) {
    throw new ApiError(400, "Complete the intake and the urgent warning signs check.");
  }
  if (symptoms.length < 3 || symptoms.length > 500) {
    throw new ApiError(400, "Describe your main symptoms using 3 to 500 characters.");
  }
  return { age, sex, safety, symptoms };
}

function answerFrom(value) {
  if (value === null) return null;
  const answer = typeof value === "string" ? value.trim() : "";
  if (!answer || answer.length > 500) {
    throw new ApiError(400, "Enter an answer up to 500 characters or select Not sure.");
  }
  return answer;
}

function providerText(value, limit) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text.length > limit) {
    throw new ApiError(502, "The symptom assessment returned an incomplete response. Please try again.");
  }
  return text;
}

function providerItems(value, limit) {
  if (!Array.isArray(value)) {
    throw new ApiError(502, "The symptom assessment returned an incomplete response. Please try again.");
  }
  return value.slice(0, limit);
}

function finished(report) {
  return { status: "complete", report };
}

function reportFrom(result, state) {
  if (typeof result?.triageLevel !== "string" || !Object.hasOwn(CARE_GUIDANCE, result.triageLevel)) {
    throw new ApiError(502, "The symptom assessment returned an invalid care level. Please try again.");
  }
  if (result.triageLevel === "emergency_ambulance") {
    return emergencyAssessment(state.id, state.answers.length, providerText(result.rationale, 500));
  }

  let { triageLevel } = result;
  let rationale = providerText(result.rationale, 800);
  const knownAnswers = state.answers.filter(turn => turn.answer !== null).length;
  if (state.intake.safety === "unsure" && triageLevel !== "consultation_24") {
    triageLevel = "consultation_24";
    rationale = "An urgent warning sign was uncertain during the intake. A healthcare professional can help assess how soon you need care.";
  } else if (state.intake.age === 0 && triageLevel !== "consultation_24") {
    triageLevel = "consultation_24";
    rationale = "A healthcare professional can assess new symptoms in an infant and advise how soon care is needed.";
  } else if (triageLevel === "self_care" && knownAnswers < 8) {
    triageLevel = "consultation";
    rationale = "A healthcare professional can assess symptoms and important details that this interview could not check.";
  }

  return {
    id: state.id,
    source: "groq",
    completedAt: new Date().toISOString(),
    answered: state.answers.length,
    triageLevel,
    summary: providerText(result.summary, 800),
    rationale,
    findings: providerItems(result.findings, 5).map(item => providerText(item, 240)),
    conditions: providerItems(result.conditions, 3).map(item => ({
      name: providerText(item?.name, 100),
      reason: providerText(item?.reason, 400),
    })),
    limitations: providerText(result.limitations, 600),
  };
}

function questionKey(text) {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

async function advance(state) {
  const { intake, answers } = state;
  const interview = { intake, answers };
  if (answers.length < MAX_QUESTIONS) {
    const decision = await interviewDecision(interview);
    if (decision?.action === "emergency") {
      return finished(emergencyAssessment(state.id, answers.length, providerText(decision.emergencyConcern, 500)));
    }
    if (decision?.action === "question") {
      const question = providerText(decision.question, 280);
      const normalized = questionKey(question);
      if (!normalized || answers.some(turn => questionKey(turn.question) === normalized)) {
        throw new ApiError(502, "A follow-up question was repeated. Please try again.");
      }
      const options = [...new Set(providerItems(decision.options, 4).map(option => providerText(option, 80)))];
      return {
        status: "question",
        answered: answers.length,
        question,
        options: options.length > 1 ? options : [],
        session: saveSession({ ...state, question }),
      };
    }
    if (decision?.action !== "report" || answers.length < MIN_QUESTIONS) {
      throw new ApiError(502, "The symptom assessment ended too early. Please try again.");
    }
  }
  return finished(reportFrom(await assessmentReport(interview), state));
}

export function runAssessment(body, uid) {
  if (body?.action === "start") {
    const id = randomUUID();
    if (body.intake?.safety === "present") return finished(emergencyAssessment(id, 0));
    const intake = intakeFrom(body.intake);
    return advance({ id, uid, intake, answers: [], expiresAt: Date.now() + SESSION_TTL });
  }
  if (body?.action === "answer") {
    const state = readSession(body.session, uid);
    const answer = answerFrom(body.answer);
    return advance({ ...state, answers: [...state.answers, { question: state.question, answer }] });
  }
  throw new ApiError(400, "Start an assessment or submit an answer.");
}
