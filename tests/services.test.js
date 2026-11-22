import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { test } from "node:test";
import chat from "../api/chat.js";
import aiDoctor from "../api/ai-doctor.js";
import who from "../api/who.js";
import { WHOApiService } from "../src/services/whoApiService.js";

async function invoke(handler, req) {
  const headers = {};
  const res = {
    code: 200,
    setHeader(name, value) { headers[name] = value; },
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; },
  };
  await handler(req, res);
  return { code: res.code, body: res.body, headers };
}

const messages = [
  { role: "user", content: "What can a health information assistant explain?" },
  { role: "assistant", content: "General health terminology." },
  { role: "user", content: "Give a short example." },
];

test("chat rejects unsigned requests without contacting providers", async t => {
  const fetch = t.mock.method(globalThis, "fetch", () => { throw new Error("Unexpected network request"); });
  const result = await invoke(chat, { method: "POST", body: { messages } });
  assert.equal(result.code, 401);
  assert.equal(fetch.mock.callCount(), 0);
});

test("chat verifies a Firebase ID token and forwards conversational context to Groq", async t => {
  const oldKey = process.env.GROQ_API_KEY;
  process.env.GROQ_API_KEY = "test-groq-key";
  t.after(() => {
    if (oldKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = oldKey;
  });
  const calls = [];
  t.mock.method(globalThis, "fetch", async (input, options) => {
    const url = new URL(input);
    const data = JSON.parse(options.body);
    calls.push({ url, data, headers: options.headers });
    if (url.pathname.endsWith("/accounts:lookup")) {
      return Response.json({ users: [{ localId: "qa-firebase-user" }] });
    }
    return Response.json({ choices: [{ finish_reason: "stop", message: { content: "Fixture reply" } }] });
  });
  const result = await invoke(chat, {
    method: "POST",
    headers: { authorization: "Bearer test.user.token" },
    body: { messages },
  });
  assert.equal(result.code, 200);
  assert.equal(result.body.response, "Fixture reply");
  assert.deepEqual(calls[0].data, { idToken: "test.user.token" });
  assert.equal(calls[1].url.href, "https://api.groq.com/openai/v1/chat/completions");
  assert.equal(calls[1].headers.Authorization, "Bearer test-groq-key");
  assert.equal(calls[1].data.messages[0].role, "system");
  assert.ok(calls[1].data.messages[0].content);
  assert.deepEqual(calls[1].data.messages.slice(1), messages);
  assert.equal(calls[1].data.response_format, undefined);
});

test("chat requires a Groq key even if a Gemini key is configured", async t => {
  const oldGroqKey = process.env.GROQ_API_KEY;
  const oldGeminiKey = process.env.GOOGLE_API_KEY;
  delete process.env.GROQ_API_KEY;
  process.env.GOOGLE_API_KEY = "fixture-gemini-key";
  t.after(() => {
    if (oldGroqKey !== undefined) process.env.GROQ_API_KEY = oldGroqKey;
    if (oldGeminiKey === undefined) delete process.env.GOOGLE_API_KEY;
    else process.env.GOOGLE_API_KEY = oldGeminiKey;
  });
  const fetch = t.mock.method(globalThis, "fetch", input => {
    assert.ok(new URL(input).pathname.endsWith("/accounts:lookup"));
    return Promise.resolve(Response.json({ users: [{ localId: "qa-firebase-user" }] }));
  });
  const result = await invoke(chat, {
    method: "POST",
    headers: { authorization: "Bearer test.user.token" },
    body: { message: "Health information fixture" },
  });
  assert.equal(result.code, 503);
  assert.equal(fetch.mock.callCount(), 1);
});

test("voice consultation verifies sign-in, retains context, and stops on urgent warning signs", async t => {
  const oldKey = process.env.GROQ_API_KEY;
  process.env.GROQ_API_KEY = "fixture-groq-key";
  t.after(() => {
    if (oldKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = oldKey;
  });
  const modelReplies = [
    { action: "self_care", question: "When did that start?", summary: "Fixture early report.", conditions: [] },
    { action: "emergency_ambulance", question: "", summary: "", conditions: [] },
    { action: "consultation", question: "", summary: "Fixture report after seven answers.", conditions: [] },
  ];
  const calls = [];
  t.mock.method(globalThis, "fetch", async (input, options) => {
    if (new URL(input).pathname.endsWith("/accounts:lookup")) {
      return Response.json({ users: [{ localId: "qa-voice-user" }] });
    }
    calls.push(JSON.parse(options.body));
    return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(modelReplies.shift()) } }] });
  });

  const method = "POST";
  assert.equal((await invoke(aiDoctor, { method, body: { action: "start" } })).code, 401);
  const send = body => invoke(aiDoctor, { method, headers: { authorization: "Bearer test.voice.token" }, body });
  const start = await send({ action: "start" });
  assert.equal(start.code, 200);
  assert.equal(calls.length, 0);
  const followUp = await send({ action: "respond", patient_message: "Synthetic first answer", history: start.body.history });
  assert.equal(followUp.code, 200);
  assert.equal(followUp.body.turn, 1);
  assert.equal(followUp.body.assessment_ready, false);
  assert.equal(followUp.body.response.question, "When did that start?");
  const urgent = await send({ action: "respond", patient_message: "Synthetic urgent follow-up", history: followUp.body.history });
  assert.equal(urgent.code, 200);
  assert.equal(urgent.body.assessment_ready, true);
  assert.equal(urgent.body.response.triage_level, "emergency_ambulance");
  assert.equal(calls[1].response_format.type, "json_schema");
  assert.equal(calls[1].response_format.json_schema.strict, true);
  assert.deepEqual(calls[1].response_format.json_schema.schema.properties.action.enum,
    ["question", "emergency_ambulance", "consultation_24", "consultation", "self_care"]);
  assert.deepEqual(JSON.parse(calls[1].messages[1].content).slice(0, -1), followUp.body.history);

  const routineHistory = [...start.body.history];
  for (let turn = 1; turn < 7; turn++) {
    routineHistory.push({ role: "user", content: `Fixture answer ${turn}` }, { role: "assistant", content: `Fixture question ${turn}` });
  }
  const completed = await send({ action: "respond", patient_message: "Fixture final answer", history: routineHistory });
  assert.equal(completed.code, 200);
  assert.equal(completed.body.turn, 7);
  assert.equal(completed.body.assessment_ready, true);
  assert.equal(completed.body.response.triage_level, "consultation");
  assert.equal(calls[2].response_format.json_schema.schema.properties.action.enum.includes("question"), false);
});

test("WHO news and outbreaks use distinct field selections and links", async t => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async input => {
    const url = new URL(input);
    calls.push(url);
    const rows = url.pathname.endsWith("/diseaseoutbreaknews")
      ? [{ Title: "Fixture outbreak update", ItemDefaultUrl: "/2026-DON123", Summary: "<p>Fixture summary.</p>" }]
      : [{ Title: "Fixture news", ItemDefaultUrl: "/22-11-2026-fixture", ThumbnailUrl: "https://www.who.int/image.png" }];
    return Response.json({ value: rows });
  });
  const news = await invoke(who, { method: "GET", query: { type: "news" } });
  const outbreak = await invoke(who, { method: "GET", query: { type: "outbreaks" } });
  assert.equal(news.code, 200);
  assert.equal(outbreak.code, 200);
  assert.equal(calls[0].pathname, "/api/news/newsitems");
  assert.equal(calls[1].pathname, "/api/news/diseaseoutbreaknews");
  assert.equal(calls[0].searchParams.get("$select").includes("Summary"), false);
  assert.equal(outbreak.body.items[0].summary, "Fixture summary.");
  assert.equal(outbreak.body.items[0].url, "https://www.who.int/emergencies/disease-outbreak-news/item/2026-DON123");
});

test("WHO errors propagate to the page as errors", async t => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ error: "Feed unavailable" }, { status: 503 }));
  const result = await invoke(who, { method: "GET" });
  assert.equal(result.code, 502);
  const client = new WHOApiService();
  await assert.rejects(client.fetchNews());
});

test("Vite serves Node API paths and forwards the Python API paths", async t => {
  const python = createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ path: req.url }));
  });
  python.listen(0, "127.0.0.1");
  await once(python, "listening");
  t.after(() => new Promise(resolve => python.close(resolve)));
  const previous = process.env.PYTHON_API_ORIGIN;
  process.env.PYTHON_API_ORIGIN = "http://127.0.0.1:" + python.address().port;
  t.after(() => {
    if (previous === undefined) delete process.env.PYTHON_API_ORIGIN;
    else process.env.PYTHON_API_ORIGIN = previous;
  });
  const { createServer: startVite } = await import("vite");
  const vite = await startVite({
    server: { host: "127.0.0.1", port: 0, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  t.after(() => vite.close());
  await vite.listen();
  const origin = "http://127.0.0.1:" + vite.httpServer.address().port;
  const node = await fetch(origin + "/api/health");
  const health = await node.json();
  assert.ok(health.servicesConfigured);
  const finder = await fetch(origin + "/api/v1/nearby-finder?latitude=28&longitude=77");
  assert.deepEqual(await finder.json(), { path: "/api/v1/nearby-finder?latitude=28&longitude=77" });
  assert.equal((await fetch(origin + "/api/unknown")).status, 404);
  assert.equal((await fetch(origin + "/api/diagnosis")).status, 404);
  const assessment = await fetch(origin + "/api/symptom-assessment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "start" }),
  });
  assert.equal(assessment.status, 401);
  const voice = await fetch(origin + "/api/ai-doctor", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "start" }),
  });
  assert.equal(voice.status, 401);
});
