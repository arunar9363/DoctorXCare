export async function loadDiseaseCatalog(signal) {
  const response = await fetch("/data/diseases.json", { signal });
  if (!response.ok) throw new Error("Disease data could not be loaded.");
  const catalog = await response.json();
  if (!Array.isArray(catalog)) throw new Error("Invalid disease data.");
  return catalog;
}

export function diseaseSlug(name) {
  return name.toLowerCase().replace(/\s+/g, "-").replace(/[^\w-]/g, "");
}

export function diseaseDetailsPath(disease) {
  const slug = diseaseSlug(disease.name) || String(disease.id);
  return "/diseases/" + encodeURIComponent(slug) + "?" + new URLSearchParams({ id: disease.id });
}

export function normalizeDiseaseTitle(title) {
  return title.normalize("NFKD").toLowerCase().replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function diseaseLookupPath(catalog, conditionName) {
  const name = conditionName.trim();
  if (!name) return "/diseases";
  const title = normalizeDiseaseTitle(name);
  const matches = title ? catalog.filter(disease => normalizeDiseaseTitle(disease.name) === title) : [];
  return matches.length === 1
    ? diseaseDetailsPath(matches[0])
    : "/diseases?" + new URLSearchParams({ q: name });
}
