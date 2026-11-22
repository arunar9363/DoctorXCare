import { collection, deleteDoc, deleteField, doc, updateDoc, writeBatch } from "firebase/firestore";
import { auth, db } from "../firebase.js";

export const metricUnits = {
  blood_pressure: "mmHg", blood_glucose: "mg/dL", heart_rate: "bpm", weight: "kg",
  oxygen_saturation: "%", tsh: "mIU/L", t3: "ng/dL", t4: "ng/dL",
};

export function emptyReadings() {
  return Object.fromEntries(Object.keys(metricUnits).map(metric => [metric, []]));
}

export function readingsCollection(uid) {
  return collection(db, "healthTracking", uid, "readings");
}

function verifyOwner(uid) {
  if (!uid || auth.currentUser?.uid !== uid) throw new Error("Please sign in again to save your readings.");
}

export function localDateInput(value = new Date()) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function measurement(value, label, minimum) {
  if (value === null || value === undefined || String(value).trim() === "") {
    throw new Error("Enter " + label + ".");
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum) {
    throw new Error("Enter a valid " + label + ".");
  }
  return number;
}

export function formatReading(metric, source, fallbackDate) {
  if (!Object.hasOwn(metricUnits, metric)) throw new Error("Choose a supported metric.");
  const timestamp = new Date(source.date || fallbackDate);
  if (!Number.isFinite(timestamp.getTime())) throw new Error("Enter a valid date and time.");
  const reading = {
    metric,
    date: timestamp.toISOString(),
    context: String(source.context || "").trim().slice(0, 120),
    notes: String(source.notes || "").trim().slice(0, 500),
  };
  if (metric === "blood_pressure") {
    reading.systolic = measurement(source.systolic, "systolic value", 1);
    reading.diastolic = measurement(source.diastolic, "diastolic value", 1);
    if (source.pulse) reading.pulse = measurement(source.pulse, "pulse", 1);
  } else {
    reading.value = measurement(source.value, "reading value", 0);
    reading.unit = source.unit?.trim() || metricUnits[metric];
    if (reading.unit.length > 24) throw new Error("The reading unit is too long.");
  }
  return reading;
}

export async function addReadings(uid, readings) {
  verifyOwner(uid);
  if (!readings.length || readings.length > 500) throw new Error("This report must contain 1 to 500 usable readings.");
  const batch = writeBatch(db);
  for (const reading of readings) {
    batch.set(doc(readingsCollection(uid)), reading);
  }
  await batch.commit();
}

export async function updateReading(uid, id, reading) {
  verifyOwner(uid);
  const fields = { ...reading };
  if (fields.metric === "blood_pressure" && !Object.hasOwn(fields, "pulse")) fields.pulse = deleteField();
  await updateDoc(doc(readingsCollection(uid), id), fields);
}

export async function deleteReading(uid, id) {
  verifyOwner(uid);
  await deleteDoc(doc(readingsCollection(uid), id));
}
