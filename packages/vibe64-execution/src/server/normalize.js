import path from "node:path";

function normalizeText(value = "") {
  return String(value ?? "").trim();
}

function normalizeInteger(value = null) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function normalizeAbsolutePath(value = "") {
  const normalized = normalizeText(value);
  return normalized ? path.resolve(normalized) : "";
}

function recordValue(value = {}) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function envRecord(value = {}) {
  return Object.fromEntries(Object.entries(recordValue(value))
    .map(([key, envValue]) => [
      normalizeText(key),
      String(envValue ?? "")
    ])
    .filter(([key]) => Boolean(key)));
}

function uniqueStrings(values = []) {
  const output = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : [values]) {
    const normalized = normalizeText(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    output.push(normalized);
  }
  return output;
}

function firstText(...values) {
  for (const value of values) {
    const normalized = normalizeText(value);
    if (normalized) {
      return normalized;
    }
  }
  return "";
}

export {
  envRecord,
  firstText,
  normalizeAbsolutePath,
  normalizeInteger,
  normalizeText,
  recordValue,
  uniqueStrings
};
