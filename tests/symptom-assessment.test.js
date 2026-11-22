import assert from "node:assert/strict";
import { test } from "node:test";
import handler from "../api/symptom-assessment.js";
import { MAX_QUESTIONS, MIN_QUESTIONS } from "../shared/triage.js";

const intake = { age: 35, sex: "unspecified", safety: "none", symptoms: "Synthetic mild shoulder discomfort" };

function setup(t, options = {}) {
  const previous = process.env.GROQ_API_KEY;
  if (options.noKey) delete process.env.GROQ_API_KEY;
  else process.env.GROQ_API_KEY = "fixture-provider-key";
  t.after(() => {
    if (previous === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = previous;
  });

  const calls = [];
  let decisionOverride = null;
  const requests = t.mock.method(globalThis, "fetch", async (input, init) => {
    const url = new URL(input);
    const body = JSON.parse(init.body);
    if (url.pathname.endsWith("/accounts:lookup")) {
      return Response.json({ users: [{ localId: t.name + ":" + body.idToken }] });
    }

    assert.equal(url.hostname, "api.groq.com");
    assert.equal(init.headers.Authorization, "Bearer fixture-provider-key");
    const schema = body.response_format.json_schema;
    const interview = JSON.parse(body.messages[1].content);
    const count = interview.answers.length;
    calls.push({ schema, interview });
    assert.equal(schema.strict, true);
    assert.equal(body.messages[0].role, "system");

    let reply;
    if (schema.name === "interview_decision") {
      if (decisionOverride) reply = decisionOverride;
      else if (count === options.finishAt) reply = { action: "report", question: "", emergencyConcern: "" };
      else reply = { action: "question", question: "Follow-up question " + (count + 1) + "?", options: ["Yes", "No"], emergencyConcern: "" };
    } else {
      reply = {
        triageLevel: options.triageLevel ?? "consultation",
        summary: "Synthetic assessment summary.",
        rationale: "A synthetic reason for discussing symptoms with a clinician.",
        findings: ["One fixture finding."],
        conditions: [{ name: "Example possibility", reason: "An example reason to discuss it." }],
        limitations: "An examination could clarify the cause.",
      };
    }
    return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(reply) } }] });
  });

  async function post(body, token = "fixture.user.token") {
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(name, value) { this.headers[name] = value; },
      status(code) { this.statusCode = code; return this; },
      json(data) { this.body = data; return this; },
    };
    await handler({ method: "POST", headers: token ? { authorization: "Bearer " + token } : {}, body }, res);
    return res;
  }

  async function finish(input, answer = "Synthetic answer") {
    let result = await post({ action: "start", intake: input });
    for (let index = 0; result.body.status === "question" && index <= MAX_QUESTIONS; index += 1) {
      result = await post({
        action: "answer",
        session: result.body.session,
        answer: answer === null ? null : answer + " " + (index + 1),
      });
    }
    assert.equal(result.statusCode, 200);
    assert.equal(result.body.status, "complete");
    return result.body.report;
  }

  return { calls, post, finish, requests, setDecision: value => { decisionOverride = value; } };
}

test("routine report follows at least ten personalized follow-ups", async t => {
  const fixture = setup(t, { finishAt: MIN_QUESTIONS });
  const report = await fixture.finish({ ...intake, name: "Do not forward this field" });
  assert.equal(report.answered, MIN_QUESTIONS);
  const final = fixture.calls.at(-1);
  assert.equal(final.schema.name, "assessment_report");
  assert.equal(final.interview.intake.name, undefined);
  assert.equal(final.interview.uid, undefined);
  assert.equal(final.interview.answers[0].answer, "Synthetic answer 1");
  assert.equal(final.interview.answers.at(-1).answer, "Synthetic answer 10");
  assert.equal(report.conditions[0].probability, undefined);
  assert.equal(fixture.calls[0].schema.schema.properties.action.enum.includes("report"), false);
});

test("an inconclusive interview switches to a report at fifteen questions", async t => {
  const fixture = setup(t);
  const report = await fixture.finish(intake);
  assert.equal(report.answered, MAX_QUESTIONS);
  assert.equal(fixture.calls.filter(call => call.schema.name === "interview_decision").length, MAX_QUESTIONS);
  assert.equal(fixture.calls.at(-1).schema.name, "assessment_report");
});

test("urgent signs end an interview without waiting on Groq", async t => {
  const fixture = setup(t, { noKey: true });
  const result = await fixture.post({ action: "start", intake: { safety: "present" } });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.report.triageLevel, "emergency_ambulance");
  assert.equal(result.body.report.answered, 0);
  assert.equal(fixture.calls.length, 0);
});

test("an urgent concern during a question stops early", async t => {
  const fixture = setup(t);
  const start = await fixture.post({ action: "start", intake });
  assert.deepEqual(start.body.options, ["Yes", "No"]);
  fixture.setDecision({ action: "emergency", question: "", emergencyConcern: "The fixture reports an urgent warning sign." });
  const result = await fixture.post({ action: "answer", session: start.body.session, answer: "Synthetic urgent answer" });
  assert.equal(result.body.report.triageLevel, "emergency_ambulance");
  assert.equal(result.body.report.answered, 1);
  assert.equal(result.body.report.conditions.length, 0);
});

test("a prematurely completed or repeated follow-up can be retried on the same session", async t => {
  const fixture = setup(t);
  const start = await fixture.post({ action: "start", intake });
  const turn = { action: "answer", session: start.body.session, answer: "Synthetic answer" };
  fixture.setDecision({ action: "report", question: "", emergencyConcern: "" });
  assert.equal((await fixture.post(turn)).statusCode, 502);
  fixture.setDecision({ action: "question", question: start.body.question.toUpperCase(), emergencyConcern: "" });
  assert.equal((await fixture.post(turn)).statusCode, 502);
  fixture.setDecision(null);
  const retry = await fixture.post(turn);
  assert.equal(retry.body.answered, 1);
});

test("interview state is tied to the signed-in user and cannot be edited", async t => {
  const fixture = setup(t);
  const blocked = await fixture.post({ action: "start", intake }, null);
  assert.equal(blocked.statusCode, 401);
  assert.equal(fixture.requests.mock.callCount(), 0);
  const start = await fixture.post({ action: "start", intake });
  const turn = { action: "answer", session: start.body.session, answer: "Synthetic answer" };
  assert.equal((await fixture.post(turn, "other.user.token")).statusCode, 400);
  const tampered = { ...turn, session: "x" + turn.session };
  assert.equal((await fixture.post(tampered)).statusCode, 400);
  assert.equal(fixture.calls.length, 1);
});

test("uncertain warning signs cannot result in a monitoring-only report", async t => {
  const fixture = setup(t, { finishAt: MIN_QUESTIONS, triageLevel: "self_care" });
  const report = await fixture.finish({ ...intake, safety: "unsure" }, null);
  assert.equal(report.triageLevel, "consultation_24");
});

test("missing Groq configuration surfaces an availability error", async t => {
  const fixture = setup(t, { noKey: true });
  const result = await fixture.post({ action: "start", intake });
  assert.equal(result.statusCode, 503);
  assert.equal(fixture.calls.length, 0);
});
