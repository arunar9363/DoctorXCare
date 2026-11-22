import { useEffect, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";
import { CARE_GUIDANCE, emergencyAssessment, MAX_QUESTIONS, MIN_QUESTIONS, SEX_LABELS, WARNING_SIGNS } from "../../../shared/triage.js";
import { requestJson } from "../../services/apiClient";
import { saveAssessmentToFirebase } from "../../services/firebaseService";
import AssessmentServiceLinks from "./AssessmentServiceLinks";
import "../../styles/SymptomAssessment.css";

const EMPTY_INTAKE = { age: "", sex: "unspecified", symptoms: "", safety: "" };

function downloadReport(report, intake) {
  const guidance = CARE_GUIDANCE[report.triageLevel];
  const text = [
    "DoctorXCare symptom assessment",
    new Date(report.completedAt).toLocaleString(),
    "Follow-up questions answered: " + report.answered,
    ...(intake.symptoms.trim() ? ["Reported symptoms: " + intake.symptoms.trim()] : []),
    "",
    guidance.label,
    guidance.action,
    "",
    "Summary",
    report.summary,
    report.rationale,
    ...(report.findings.length ? ["", "Details you reported", ...report.findings.map(item => "- " + item)] : []),
    ...(report.conditions.length ? ["", "Possible causes to discuss", ...report.conditions.map(item => "- " + item.name + " — " + item.reason)] : []),
    "",
    "What this assessment could not determine",
    report.limitations,
    ...(report.source === "groq" ? ["This is an AI-generated assessment. A healthcare professional can confirm the cause."] : []),
  ].join("\n");

  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "doctorx-assessment-" + report.completedAt.slice(0, 10) + ".txt";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function WarningSigns({ onEmergency, expanded }) {
  return (
    <details className="symptom-assessment__warning" open={expanded}>
      <summary>Urgent warning signs</summary>
      <ul>{WARNING_SIGNS.map(sign => <li key={sign}>{sign}</li>)}</ul>
      <p>If any of these are happening now, call your local emergency number.</p>
      {onEmergency && (
        <button className="symptom-assessment__urgent" type="button" onClick={onEmergency}>
          Show emergency guidance
        </button>
      )}
    </details>
  );
}

export default function SymptomAssessment() {
  const [intake, setIntake] = useState(EMPTY_INTAKE);
  const [flow, setFlow] = useState(null);
  const [answer, setAnswer] = useState("");
  const [pending, setPending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const activeRequest = useRef(null);
  const questionHeading = useRef(null);
  const reportHeading = useRef(null);
  const report = flow?.status === "complete" ? flow.report : null;

  useEffect(() => () => activeRequest.current?.abort(), []);
  useEffect(() => {
    if (report) reportHeading.current?.focus();
    else questionHeading.current?.focus();
  }, [flow, report]);

  const stopRequest = () => {
    activeRequest.current?.abort();
    activeRequest.current = null;
    setPending(false);
  };

  const showEmergency = () => {
    stopRequest();
    setError("");
    setFlow({
      status: "complete",
      report: emergencyAssessment(globalThis.crypto?.randomUUID?.() ?? "emergency-" + Date.now(), flow?.answered ?? 0),
    });
  };

  const restart = () => {
    stopRequest();
    setIntake(EMPTY_INTAKE);
    setFlow(null);
    setAnswer("");
    setError("");
    setSaved(false);
  };

  const requestStep = async (body) => {
    if (activeRequest.current) return;
    const controller = new AbortController();
    activeRequest.current = controller;
    setPending(true);
    setError("");
    try {
      const next = await requestJson("/api/symptom-assessment", {
        authenticated: true,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (next.status !== "question" && next.status !== "complete") {
        throw new Error("The assessment could not continue. Please try again.");
      }
      setFlow(next);
      setAnswer("");
    } catch (error) {
      if (!controller.signal.aborted) setError(error.message);
    } finally {
      if (activeRequest.current === controller) {
        activeRequest.current = null;
        setPending(false);
      }
    }
  };

  const start = (event) => {
    event.preventDefault();
    requestStep({ action: "start", intake: { ...intake, age: Number(intake.age) } });
  };

  const submitAnswer = (reply) => requestStep({ action: "answer", session: flow.session, answer: reply });

  const saveReport = async () => {
    if (!report || saving || saved) return;
    setSaving(true);
    setError("");
    try {
      await saveAssessmentToFirebase(report, intake);
      setSaved(true);
    } catch {
      setError("The report could not be saved. You can try again or download it.");
    } finally {
      setSaving(false);
    }
  };

  const guidance = report ? CARE_GUIDANCE[report.triageLevel] : null;

  return (
    <main className="symptom-assessment">
      <header className="symptom-assessment__header">
        <Link to="/symptoms" className="symptom-assessment__back">
          <ArrowLeft size={18} aria-hidden="true" />
          Back to symptom checker
        </Link>
        <h1>Personal symptom assessment</h1>
        {!flow && (
          <p className="symptom-assessment__intro">Tell us about your symptoms, then answer {MIN_QUESTIONS}–{MAX_QUESTIONS} follow-up questions. You’ll get a care recommendation and a report you can share with a healthcare professional.</p>
        )}
      </header>
      {!report && (
        <WarningSigns expanded={!flow} onEmergency={flow ? showEmergency : undefined} />
      )}
      {error && <p className="symptom-assessment__error" role="alert">{error}</p>}

      {!flow && (
        <form className="symptom-assessment__card" onSubmit={start}>
          <h2>Tell us what’s happening</h2>
          <div className="symptom-assessment__demographics">
            <label>
              Age in years
              <input
                required type="number" min="0" max="120" step="1" value={intake.age} disabled={pending}
                onChange={e => setIntake({ ...intake, age: e.target.value })}
              />
              <small>Enter 0 for a child under one year.</small>
            </label>
            <label>
              Sex
              <select value={intake.sex} disabled={pending} onChange={e => setIntake({ ...intake, sex: e.target.value })}>
                {Object.entries(SEX_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
          </div>
          <label>
            What symptoms are you experiencing?
            <textarea
              required minLength={3} maxLength={500} rows={3} value={intake.symptoms} disabled={pending}
              placeholder="Describe what you feel and when it started."
              aria-describedby="symptom-assessment-privacy"
              onChange={e => setIntake({ ...intake, symptoms: e.target.value })}
            />
          </label>
          <p className="symptom-assessment__muted" id="symptom-assessment-privacy">
            Your age and symptom answers are sent to Groq for the assessment. Leave out names, contact information, and other identifying details.
          </p>
          <fieldset>
            <legend>Do any of the urgent warning signs above apply right now?</legend>
            <label className="symptom-assessment__radio">
              <input required type="radio" name="urgent-signs" value="none" checked={intake.safety === "none"}
                disabled={pending} onChange={() => setIntake({ ...intake, safety: "none" })} />
              No
            </label>
            <label className="symptom-assessment__radio">
              <input type="radio" name="urgent-signs" value="unsure" checked={intake.safety === "unsure"}
                disabled={pending} onChange={() => setIntake({ ...intake, safety: "unsure" })} />
              I’m not sure
            </label>
            <button type="button" className="symptom-assessment__urgent" onClick={showEmergency}>Yes, show emergency guidance</button>
            {intake.safety === "unsure" && <p>If you think a warning sign may be present, call your local emergency number.</p>}
          </fieldset>
          <button className="symptom-assessment__primary" type="submit" disabled={pending}>
            {pending ? "Starting…" : "Start assessment"}
          </button>
        </form>
      )}

      {flow?.status === "question" && (
        <form className="symptom-assessment__card" onSubmit={event => {
          event.preventDefault();
          if (answer.trim()) submitAnswer(answer.trim());
        }}>
          <p className="symptom-assessment__progress-label">Question {flow.answered + 1} of up to {MAX_QUESTIONS}</p>
          <progress aria-label="Questions answered" max={MAX_QUESTIONS} value={flow.answered} />
          <h2 ref={questionHeading} tabIndex={-1}>{flow.question}</h2>
          {flow.options?.length > 0 && (
            <div className="symptom-assessment__actions" role="group" aria-label="Quick answers">
              {flow.options.map(option => (
                <button className="symptom-assessment__secondary" type="button" key={option} disabled={pending}
                  onClick={() => submitAnswer(option)}>
                  {option}
                </button>
              ))}
            </div>
          )}
          <label>
            Your answer
            <textarea required maxLength={500} rows={3} value={answer} disabled={pending} onChange={e => setAnswer(e.target.value)} />
          </label>
          <div className="symptom-assessment__actions">
            <button className="symptom-assessment__primary" type="submit" disabled={pending || !answer.trim()}>
              {pending ? "Reviewing your answer…" : "Continue"}
            </button>
            <button className="symptom-assessment__secondary" type="button" disabled={pending} onClick={() => submitAnswer(null)}>
              Not sure
            </button>
            <button className="symptom-assessment__secondary" type="button" disabled={pending} onClick={restart}>
              Start over
            </button>
          </div>
        </form>
      )}

      {report && guidance && (
        <section className="symptom-assessment__card">
          <h2 ref={reportHeading} tabIndex={-1}>Your assessment report</h2>
          <div className={"symptom-assessment__care symptom-assessment__care--" + report.triageLevel}
            role={report.triageLevel === "emergency_ambulance" ? "alert" : undefined}>
            <h3>{guidance.label}</h3>
            <p>{guidance.action}</p>
            <p>{report.rationale}</p>
          </div>
          <h3>Summary</h3>
          <p>{report.summary}</p>
          {report.source === "groq" && <p className="symptom-assessment__muted">{report.answered} follow-up questions answered</p>}
          {report.findings.length > 0 && (
            <>
              <h3>Details you reported</h3>
              <ul>{report.findings.map((item, index) => <li key={index}>{item}</li>)}</ul>
            </>
          )}
          {report.conditions.length > 0 && (
            <>
              <h3>Possible causes to discuss</h3>
              <ul>{report.conditions.map(({ name, reason }, index) => <li key={index}><strong>{name}.</strong> {reason}</li>)}</ul>
            </>
          )}
          <h3>What this assessment could not determine</h3>
          <p>{report.limitations}</p>
          {report.source === "groq" && <p className="symptom-assessment__muted">This is an AI-generated assessment. A healthcare professional can confirm the cause.</p>}
          <div className="symptom-assessment__actions">
            {saved ? (
              <Link to="/history">View saved assessment</Link>
            ) : (
              <button className="symptom-assessment__primary" type="button" disabled={saving} onClick={saveReport}>
                {saving ? "Saving…" : "Save to history"}
              </button>
            )}
            <button className="symptom-assessment__secondary" type="button" onClick={() => downloadReport(report, intake)}>
              Download report
            </button>
            <button className="symptom-assessment__secondary" type="button" disabled={saving} onClick={restart}>
              Start new assessment
            </button>
          </div>
          <AssessmentServiceLinks conditions={report.conditions} />
        </section>
      )}
    </main>
  );
}
