import { parseVibe64OutputsLines } from "./outputs.js";
import { parseVibe64WorkspaceSetupLines } from "./workspaceSetup.js";
import {
  assertMatchingStackInspections,
  invalidStackOperation,
  isExplicitlyEmptyStackSection,
  stackOperationHash
} from "./stackOperation.js";

const VIBE64_RESOURCE_ESTIMATES_CONTRACT = "vibe64.resource-estimates.v1";
const VIBE64_RESOURCE_ESTIMATES_SECTION = "Resource estimates";
const ERROR_CODE = "VIBE64_RESOURCE_ESTIMATES_INVALID";
const MIB = 1024 * 1024;
const MAX_ESTIMATE_MIB = 1024 * 1024;
const FIELDS = new Map([
  ["Startup typical MiB", "startupTypical"],
  ["Startup high MiB", "startupHigh"],
  ["Running typical MiB", "runningTypical"],
  ["Running high MiB", "runningHigh"],
  ["Typical MiB", "typical"],
  ["High MiB", "high"]
]);

function invalid(resourcePath, message, line) {
  invalidStackOperation(ERROR_CODE, resourcePath, message, line);
}

function memoryPair(fields, typicalKey, highKey, resourcePath, line) {
  const typicalBytes = fields.get(typicalKey);
  const highBytes = fields.get(highKey);
  if (typicalBytes === undefined || highBytes === undefined || typicalBytes > highBytes) {
    invalid(resourcePath, "Each resource phase requires typical and high estimates, with typical no greater than high.", line);
  }
  return { typicalBytes, highBytes };
}

function parseVibe64ResourceEstimatesLines(lines, {
  path: resourcePath = "genesis/stack.md#Resource estimates",
  targets = [],
  hasWorkspaceSetup = false
} = {}) {
  if (
    !Array.isArray(lines)
    || lines.length > 2048
    || lines.some((line) => typeof line !== "string")
    || Buffer.byteLength(lines.join("\n"), "utf8") > 64 * 1024
  ) {
    invalid(resourcePath, "Resource estimates must be exact Stack section lines within 64 KiB and 2048 lines.");
  }
  const result = { version: 1, outputs: [], workspaceSetup: null };
  if (isExplicitlyEmptyStackSection(lines)) return result;
  const targetById = new Map(targets.map((target) => [target.id, target]));
  const seen = new Set();
  let current = null;

  function finish() {
    if (!current) return;
    const { targetId, mode, fields, line } = current;
    if (mode === "interactive") {
      if (fields.has("typical") || fields.has("high")) {
        invalid(resourcePath, "Interactive outputs require separate Startup and Running estimates.", line);
      }
      result.outputs.push({
        targetId,
        mode,
        startup: memoryPair(fields, "startupTypical", "startupHigh", resourcePath, line),
        running: memoryPair(fields, "runningTypical", "runningHigh", resourcePath, line)
      });
      return;
    }
    if (fields.size !== 2 || !fields.has("typical") || !fields.has("high")) {
      invalid(resourcePath, "Finite outputs and Workspace setup require only Typical MiB and High MiB.", line);
    }
    const execution = memoryPair(fields, "typical", "high", resourcePath, line);
    if (targetId) result.outputs.push({ targetId, mode, execution });
    else result.workspaceSetup = execution;
  }

  for (let index = 0; index < lines.length; index += 1) {
    const source = lines[index].trim();
    const line = index + 1;
    if (!source) continue;
    const output = source.match(/^### Output `([a-z0-9]+(?:-[a-z0-9]+)*)`$/u);
    if (output || source === "### Workspace setup") {
      finish();
      const targetId = output?.[1] || "";
      const key = targetId ? `output:${targetId}` : "workspace-setup";
      if (seen.has(key)) invalid(resourcePath, "Resource estimates contains a duplicate operation.", line);
      seen.add(key);
      const target = targetById.get(targetId);
      if (targetId && !["interactive", "finite"].includes(target?.mode)) {
        invalid(resourcePath, `Resource estimate references an undeclared output: ${targetId}.`, line);
      }
      if (!targetId && !hasWorkspaceSetup) {
        invalid(resourcePath, "Resource estimate references undeclared Workspace setup steps.", line);
      }
      current = { targetId, mode: target?.mode || "setup", fields: new Map(), line };
      continue;
    }
    const field = source.match(/^- ([A-Za-z ]+): `([1-9][0-9]*)`$/u);
    const name = field && FIELDS.get(field[1]);
    if (!current || !name) {
      invalid(resourcePath, "Expected an Output or Workspace setup heading followed by positive integer MiB estimates.", line);
    }
    if (current.fields.has(name)) invalid(resourcePath, `Duplicate resource field: ${field[1]}.`, line);
    const mib = Number(field[2]);
    if (!Number.isSafeInteger(mib) || mib > MAX_ESTIMATE_MIB) {
      invalid(resourcePath, `Resource estimates must be between 1 and ${MAX_ESTIMATE_MIB} MiB.`, line);
    }
    current.fields.set(name, mib * MIB);
  }
  finish();
  if (seen.size === 0) invalid(resourcePath, "Resource estimates needs an operation or exactly `- Nothing.`.");
  return result;
}

function vibe64ResourceEstimatesInspection({
  section = {},
  outputsSection = {},
  workspaceSetupSection = {}
} = {}) {
  // A mixed-source read is not a bad optional hint: retry the whole inspection.
  assertMatchingStackInspections(section, outputsSection, "Resource estimates and Outputs");
  assertMatchingStackInspections(section, workspaceSetupSection, "Resource estimates and Workspace setup");
  const diagnostics = [...(section.diagnostics || [])];
  let parsed = { version: 1, outputs: [], workspaceSetup: null };
  if (section.status === "ready" && diagnostics.length === 0) {
    try {
      parsed = parseVibe64ResourceEstimatesLines(section.lines, {
        targets: outputsSection.status === "ready"
          ? parseVibe64OutputsLines(outputsSection.lines).targets
          : [],
        hasWorkspaceSetup: workspaceSetupSection.status === "ready"
          && parseVibe64WorkspaceSetupLines(workspaceSetupSection.lines).length > 0
      });
    } catch (error) {
      if (error?.name !== "Vibe64StackOperationError") throw error;
      diagnostics.push({
        code: ERROR_CODE,
        message: error.message,
        details: { ...error.details, causeCode: error.code }
      });
    }
  }
  const status = diagnostics.length > 0
    ? "invalid"
    : parsed.outputs.length > 0 || parsed.workspaceSetup ? "ready" : "unconfigured";
  return {
    contract: VIBE64_RESOURCE_ESTIMATES_CONTRACT,
    status,
    stackHash: section.stackHash,
    sectionHash: section.sectionHash || "",
    estimatesHash: status === "ready" ? stackOperationHash(parsed) : "",
    source: section.source || null,
    outputs: parsed.outputs,
    workspaceSetup: parsed.workspaceSetup,
    fallbackReason: status === "invalid" ? "invalid-estimates" : status === "unconfigured" ? "not-declared" : null,
    diagnostics
  };
}

export {
  VIBE64_RESOURCE_ESTIMATES_CONTRACT,
  VIBE64_RESOURCE_ESTIMATES_SECTION,
  parseVibe64ResourceEstimatesLines,
  vibe64ResourceEstimatesInspection
};
