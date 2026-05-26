import {
  blockedDoctorCheck as blockedCheck,
  passDoctorCheck as passCheck
} from "@local/ai-studio-core/server/doctorCheckItems";
import {
  shellQuote
} from "@local/studio-terminal-core/server/shellCommands";
import {
  parseEnvText
} from "../envFiles.js";

function envValuesFromLines(lines = []) {
  return Object.fromEntries(lines.map((line) => {
    const index = String(line).indexOf("=");
    return index >= 0
      ? [String(line).slice(0, index), String(line).slice(index + 1)]
      : [String(line), ""];
  }));
}

async function readTargetEnvFile(toolkit, {
  relativePath = ".env",
  targetRoot = ""
} = {}) {
  const envFile = await toolkit.readTargetFile(relativePath, {
    targetRoot
  });
  return envFile.ok ? parseEnvText(envFile.value) : {};
}

function envHasAnyKeys(env = {}, keys = []) {
  return keys.some((key) => String(env[key] || "").trim());
}

function envValueDisplay(key = "", value = "", {
  secretKeys = new Set()
} = {}) {
  if (secretKeys.has(key) && value) {
    return "<redacted>";
  }
  return String(value || "").trim() || "(missing)";
}

function expectedEnvMismatches(env = {}, expectedValues = {}, {
  secretKeys = new Set()
} = {}) {
  return Object.entries(expectedValues)
    .filter(([key, expectedValue]) => String(env[key] || "").trim() !== String(expectedValue))
    .map(([key, expectedValue]) => ({
      actual: envValueDisplay(key, env[key], {
        secretKeys
      }),
      expected: secretKeys.has(key) ? "<managed password>" : String(expectedValue),
      key
    }));
}

function formatEnvMismatches(mismatches = []) {
  return mismatches
    .map((item) => `${item.key}: expected ${item.expected}, observed ${item.actual}`)
    .join("\n");
}

function grepKeyPattern(keys = []) {
  return keys.map((key) => String(key).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")).join("|");
}

function envFileWriteScript({
  existingValuesError = "",
  header = "",
  relativePath = ".env",
  replaceExisting = false,
  removeKeys = [],
  values = {}
} = {}) {
  const keys = [...new Set([
    ...removeKeys,
    ...Object.keys(values)
  ])];
  const lines = Object.entries(values).map(([key, value]) => `${key}=${value}`);
  const script = [
    "set -e",
    `env_file=${shellQuote(relativePath)}`,
    "touch \"$env_file\""
  ];

  if (keys.length && replaceExisting) {
    script.push(
      "tmp_file=\"$(mktemp)\"",
      `grep -Ev '^(${grepKeyPattern(keys)})=' "$env_file" > "$tmp_file" || true`,
      "mv \"$tmp_file\" \"$env_file\""
    );
  } else if (keys.length && existingValuesError) {
    script.push(
      `if grep -Eq '^(${grepKeyPattern(keys)})=' "$env_file"; then`,
      `  echo ${shellQuote(existingValuesError)} >&2`,
      "  exit 1",
      "fi"
    );
  }

  if (header) {
    script.push(`printf '\\n%s\\n' ${shellQuote(header)} >> "$env_file"`);
  }
  script.push(
    ...lines.map((line) => `printf '%s\\n' ${shellQuote(line)} >> "$env_file"`)
  );
  return script.join("\n");
}

async function checkExactEnvValues(toolkit, {
  expected = "",
  expectedValues = {},
  explanation = "",
  id = "",
  label = "",
  missingObserved = "",
  passObserved = "",
  relativePath = ".env",
  repair = null,
  repairs = [],
  targetRoot = ""
} = {}) {
  const env = await readTargetEnvFile(toolkit, {
    relativePath,
    targetRoot
  });
  const mismatches = expectedEnvMismatches(env, expectedValues);
  if (mismatches.length) {
    return blockedCheck({
      id,
      label,
      expected,
      observed: missingObserved || `Mismatched keys: ${mismatches.map((item) => item.key).join(", ")}`,
      explanation,
      repair,
      repairs
    });
  }
  return passCheck({
    id,
    label,
    expected,
    observed: passObserved,
    explanation
  });
}

export {
  checkExactEnvValues,
  envFileWriteScript,
  envHasAnyKeys,
  envValuesFromLines,
  expectedEnvMismatches,
  formatEnvMismatches,
  readTargetEnvFile
};
