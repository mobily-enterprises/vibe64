import { createHash } from "node:crypto";
import path from "node:path";

class Vibe64StackOperationError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "Vibe64StackOperationError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

// Every Vibe64 section error names the agent-readable spec of that section.
const SPEC_BY_ERROR_CODE = Object.freeze({
  VIBE64_WORKSPACE_SETUP_INVALID: "workspace-setup",
  VIBE64_OUTPUTS_INVALID: "outputs",
  VIBE64_DEPLOYMENT_INVALID: "deployment",
  VIBE64_RESOURCE_ESTIMATES_INVALID: "resource-estimates",
  VIBE64_CONNECTED_DEVELOPMENT_INVALID: "connected-development",
  VIBE64_PROJECT_SERVICES_INVALID: "project-services",
  VIBE64_INTEGRATION_SETUP_INVALID: "integration-setup",
  VIBE64_ARCHITECTURE_INSPECTION_INVALID: "architecture-inspection",
  VIBE64_ARCHITECTURE_LAYOUT_INVALID: "architecture-layout"
});
const SPEC_POINTER = / Exact grammar: vibe64-helper spec [a-z-]+\.$/u;

function stackOperationSpecMessage(code, message) {
  const name = SPEC_BY_ERROR_CODE[code];
  const base = String(message).replace(SPEC_POINTER, "");
  return name ? `${base} Exact grammar: vibe64-helper spec ${name}.` : base;
}

function unknownEntryMessage(label, source, forms) {
  return `Unknown ${label}: ${source}. Use one of: ${forms.join("; ")}.`;
}

function invalidStackOperation(code, operationPath, message, line, details = {}) {
  throw new Vibe64StackOperationError(code, stackOperationSpecMessage(code, message), {
    path: operationPath,
    ...(line === undefined ? {} : { line }),
    ...details
  });
}

function oneLineText(value, code, operationPath, label, line) {
  if (typeof value !== "string" || !value.trim() || /[\0\r\n]/u.test(value)) {
    invalidStackOperation(code, operationPath, `${label} must be one non-empty line.`, line);
  }
  return value.trim();
}

function parseBacktickedArguments(source) {
  const matches = [...String(source || "").matchAll(/`([^`\r\n]+)`/gu)];
  if (matches.length === 0 || matches.map((match) => match[0]).join(" ") !== source) return null;
  return matches.map((match) => match[1]);
}

function backtickedArguments(source, code, operationPath, label, line, {
  count,
  maximum = 64
} = {}) {
  const values = parseBacktickedArguments(source);
  if (
    !values
    || values.length > maximum
    || (count !== undefined && values.length !== count)
    || values.some((value) => value.length > 4096 || /[\0\r\n]/u.test(value))
  ) {
    const quantity = count === undefined ? "separate non-empty" : `exactly ${count}`;
    invalidStackOperation(
      code,
      operationPath,
      `${label} must contain ${quantity} backticked ${count === 1 ? "value" : "values"}.`,
      line
    );
  }
  return values;
}

function isSafeProcessExecutable(command = "") {
  return typeof command === "string"
    && Boolean(command)
    && !/[\s\0{}]/u.test(command)
    && !path.isAbsolute(command)
    && !command.split(/[\\/]/u).includes("..");
}

function processArguments(source, code, operationPath, label, line) {
  const values = backtickedArguments(source, code, operationPath, label, line);
  if (!isSafeProcessExecutable(values[0])) {
    invalidStackOperation(code, operationPath, `${label} must begin with a safe executable.`, line);
  }
  return values;
}

function isCanonicalProjectPath(value = "") {
  return typeof value === "string"
    && Boolean(value)
    && !/[\0\r\n\\]/u.test(value)
    && !path.posix.isAbsolute(value)
    && path.posix.normalize(value) === value
    && !value.split("/").some((part) => !part || part === "..");
}

function projectPath(value, code, operationPath, label, line, {
  allowRoot = true
} = {}) {
  if (!isCanonicalProjectPath(value) || (!allowRoot && value === ".")) {
    invalidStackOperation(
      code,
      operationPath,
      `${label} must be a canonical project-relative path.`,
      line
    );
  }
  return value;
}

function runtimeArguments(source, code, operationPath, label, line) {
  const values = backtickedArguments(source, code, operationPath, label, line);
  if (values.some((value) => !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value))) {
    invalidStackOperation(
      code,
      operationPath,
      `${label} must use lowercase technology ids separated into backticked values.`,
      line
    );
  }
  if (new Set(values).size !== values.length) {
    invalidStackOperation(code, operationPath, `${label} contains a duplicate technology id.`, line);
  }
  return values;
}

function urlPath(value, code, operationPath, label, line) {
  const normalized = oneLineText(value, code, operationPath, label, line);
  if (!normalized.startsWith("/") || normalized.startsWith("//") || /[\\?#]/u.test(normalized)) {
    invalidStackOperation(
      code,
      operationPath,
      `${label} must begin with one slash and contain no query or fragment.`,
      line
    );
  }
  return normalized;
}

function httpReadinessLine(source, code, operationPath, label, line) {
  const match = source.match(/^- Ready when: `GET` `([^`\r\n]+)` returns `([0-9]{3})`$/u);
  if (!match) {
    invalidStackOperation(
      code,
      operationPath,
      `${label} must use \`- Ready when: \`GET\` \`/path\` returns \`200\`\`.`,
      line
    );
  }
  const status = Number(match[2]);
  if (!Number.isInteger(status) || status < 200 || status > 399) {
    invalidStackOperation(code, operationPath, `${label} status must be from 200 through 399.`, line);
  }
  return {
    kind: "http",
    method: "GET",
    path: urlPath(match[1], code, operationPath, `${label} path`, line),
    status
  };
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

function stackOperationHash(value) {
  const source = `${JSON.stringify(stable(value), null, 2)}\n`;
  return `sha256:${createHash("sha256").update(source).digest("hex")}`;
}

function assertMatchingStackInspections(section = {}, environment = {}, label = "operation") {
  if (section.stackHash !== environment.stackHash) {
    throw new Vibe64StackOperationError(
      "VIBE64_STACK_CHANGED",
      `The Stack changed while Vibe64 inspected its ${label}. Retry the operation.`
    );
  }
}

function uniqueSorted(values = []) {
  return [...new Set(values)].sort();
}

function isExplicitlyEmptyStackSection(lines = []) {
  const entries = lines.map((line) => line.trim()).filter(Boolean);
  return entries.length === 1 && entries[0] === "- Nothing.";
}

export {
  SPEC_BY_ERROR_CODE,
  Vibe64StackOperationError,
  assertMatchingStackInspections,
  backtickedArguments,
  httpReadinessLine,
  isExplicitlyEmptyStackSection,
  invalidStackOperation,
  oneLineText,
  processArguments,
  projectPath,
  runtimeArguments,
  stackOperationHash,
  uniqueSorted,
  unknownEntryMessage,
  urlPath
};
