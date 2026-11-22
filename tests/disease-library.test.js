import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { diseaseLookupPath } from "../src/services/diseaseLibrary.js";

const catalog = JSON.parse(readFileSync(new URL("../public/data/diseases.json", import.meta.url), "utf8"));

test("a named cause opens the corresponding Disease Library entry by ID", () => {
  assert.equal(diseaseLookupPath(catalog, "  mIGRAINE "), "/diseases/migraine?id=50");
});

test("ambiguous titles open library results instead of choosing a disease record", () => {
  const records = [{ name: "Example Condition", id: "one" }, { name: "Example-Condition", id: "two" }];
  const url = new URL(diseaseLookupPath(records, "Example Condition"), "https://doctorxcare.in");
  assert.equal(url.pathname, "/diseases");
  assert.equal(url.searchParams.get("q"), "Example Condition");
  assert.equal(url.searchParams.has("id"), false);
});

test("unknown names prefill the search without adding other URL parameters", () => {
  const condition = "Example / Condition & id=other";
  const url = new URL(diseaseLookupPath(catalog, condition), "https://doctorxcare.in");
  assert.equal(url.pathname, "/diseases");
  assert.deepEqual([...url.searchParams], [["q", condition]]);
  assert.equal(diseaseLookupPath(catalog, ""), "/diseases");
});
