import path from "node:path";

import { pathInsideOrEqual } from "@local/vibe64-core/server/core";
import { runWithProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";
import { createStreamingLogSanitizer, sanitizeOperationText } from "@local/vibe64-core/server/logging";
import { workspaceSetupTranscript } from "@local/vibe64-runtime/server/workspaceSetupState";

import { vibe64RuntimePacks } from "./vibe64OutputTargets.js";
import { terminalNamespace } from "./terminalShared.js";
import { toText } from "@local/vibe64-core/shared/toText";

const WORKSPACE_SETUP_COMMAND_TIMEOUT_MS = 15 * 60 * 1000;
const WORKSPACE_SETUP_RUN_NAMESPACE = "vibe64-workspace-setup";
const CONNECTED_PREPARATION_LABEL = "Preparing connected projects";
const WORKSPACE_SETUP_DIAGNOSTIC_LENGTH = 1600;
const DIAGNOSTIC_OMISSION_MARKER = "\n[…]\n";

function diagnosticText(diagnostics = []) {
  return (Array.isArray(diagnostics) ? diagnostics : [])
    .map((diagnostic) => toText(
      typeof diagnostic === "string"
        ? diagnostic
        : diagnostic?.message || diagnostic?.code
    ))
    .find(Boolean) || "";
}

function diagnosticsInclude(diagnostics = [], code = "") {
  return (Array.isArray(diagnostics) ? diagnostics : [])
    .some((diagnostic) => toText(diagnostic?.code) === code);
}

function setupStep(step = {}, index = 0, sourcePath = "") {
  const argv = Array.isArray(step.argv) ? step.argv.map((value) => String(value)) : [];
  if (!toText(argv[0])) {
    throw new Error(`Workspace preparation step ${index + 1} has no command.`);
  }
  const cwd = path.resolve(sourcePath, toText(step.workdir) || ".");
  if (!pathInsideOrEqual(sourcePath, cwd)) {
    throw new Error(`Workspace preparation step ${index + 1} has a work directory outside the session source.`);
  }
  return {
    argv,
    cwd,
    label: toText(step.label) || `Workspace preparation step ${index + 1}`,
    runtimeRequirements: Array.isArray(step.runtimeRequirements)
      ? step.runtimeRequirements
      : []
  };
}

function preparedRecipe(setup = {}, sourcePath = "") {
  const recipeHash = toText(setup.recipeHash);
  if (!recipeHash) {
    throw new Error("Vibe64 produced a ready workspace preparation recipe without an identity.");
  }
  const steps = (Array.isArray(setup.steps) ? setup.steps : [])
    .map((step, index) => setupStep(step, index, sourcePath));
  if (steps.length < 1) {
    throw new Error("Vibe64 produced a ready workspace preparation recipe without any steps.");
  }
  const runtime = vibe64RuntimePacks([
    ...(Array.isArray(setup.runtimeRequirements) ? setup.runtimeRequirements : []),
    ...steps.flatMap((step) => step.runtimeRequirements)
  ]);
  if (!runtime.available) {
    throw new Error(runtime.disabledReason);
  }
  return {
    recipeHash,
    runtimes: runtime.runtimes,
    steps
  };
}

function operationRedactionSecrets(env = {}) {
  return [...new Set(Object.values(
    env && typeof env === "object" && !Array.isArray(env) ? env : {}
  ).map((value) => String(value ?? "")).filter((value) => value.length >= 4))];
}

function safeSetupLabel(value = "", secrets = []) {
  return sanitizeOperationText(toText(value), secrets)
    .replace(/\s+/gu, " ")
    .slice(0, 160);
}

function capturedCommandOutput(result = {}, secrets = []) {
  const combined = String(result.output ?? "");
  const raw = combined || [result.stdout, result.stderr, result.error]
    .map((value) => String(value ?? ""))
    .filter(Boolean)
    .join("\n");
  if (!raw) {
    return "";
  }
  const sanitizer = createStreamingLogSanitizer({ secrets });
  return workspaceSetupTranscript(`${sanitizer.push(raw)}${sanitizer.flush()}`);
}

function appendWorkspaceSetupTranscript(transcript = "", ...entries) {
  return workspaceSetupTranscript([
    transcript,
    ...entries
  ].map((entry) => String(entry ?? "").trim()).filter(Boolean).join("\n"));
}

/**
 * One transcript line per connected checkout: updated, current or why not.
 */
function connectedUpdateLine({ repository = "", update = null } = {}) {
  const name = `[Connected] ${toText(repository).split("/").pop()}`;
  if (update?.status === "updated") return `${name} updated to ${toText(update.commit).slice(0, 7)}.`;
  if (update?.status === "current") return `${name} is up to date.`;
  if (update?.status === "skipped") return `${name} was not updated: ${toText(update.reason)}`;
  return "";
}

function stepStatus(label = "", status = "", secrets = []) {
  return `[${safeSetupLabel(label, secrets) || "Workspace preparation"}] ${status}.`;
}

/**
 * A long failure keeps its opening (where most tools state the error) and its
 * end, joined by a visible marker; the tail starts on a whole line, never
 * mid-word.
 */
function boundedDiagnostic(output = "", maxLength = WORKSPACE_SETUP_DIAGNOSTIC_LENGTH) {
  if (output.length <= maxLength) return output;
  const half = Math.floor((maxLength - DIAGNOSTIC_OMISSION_MARKER.length) / 2);
  const tail = output.slice(-half);
  const lineStart = tail.indexOf("\n");
  return `${output.slice(0, half).trimEnd()}${DIAGNOSTIC_OMISSION_MARKER}${
    lineStart >= 0 && lineStart < tail.length - 1 ? tail.slice(lineStart + 1) : tail}`;
}

function commandDiagnostic(result = {}, label = "", secrets = []) {
  const output = toText(sanitizeOperationText(
    result.stderr || result.error || result.output,
    secrets
  ));
  // A program that isn't installed fails before it runs: say that, not "spawn x ENOENT".
  const absent = /\bspawn (\S+) ENOENT\b/u.exec(output)?.[1];
  if (absent) {
    return `Vibe64 couldn't find ${absent.split("/").pop()} on this computer, so this step couldn't run.`;
  }
  if (output) {
    return boundedDiagnostic(output);
  }
  const safeLabel = safeSetupLabel(label, secrets) || "Workspace preparation";
  if (result.timedOut === true) {
    return `${safeLabel} timed out after 15 minutes.`;
  }
  return `${safeLabel} exited with code ${Number(result.exitCode) || 1}.`;
}

/**
 * The cached run still matches the host resources only when both name the same
 * resource preparation, or neither has one.
 */
function resourceIdentityMatches(state = {}, environmentStatus = {}) {
  return Object.hasOwn(environmentStatus, "resourcePreparation")
    ? Boolean(state.resourceIdentity && state.resourceIdentity === environmentStatus.resourcePreparation?.identity)
    : !state.resourceIdentity;
}

function inProjectContext(projectContext, callback) {
  return projectContext ? runWithProjectRequestContext(projectContext, callback) : callback();
}

function workspaceSetupRunKey(sessionId = "") {
  return terminalNamespace(WORKSPACE_SETUP_RUN_NAMESPACE, sessionId);
}

export {
  CONNECTED_PREPARATION_LABEL,
  WORKSPACE_SETUP_COMMAND_TIMEOUT_MS,
  appendWorkspaceSetupTranscript,
  capturedCommandOutput,
  commandDiagnostic,
  connectedUpdateLine,
  diagnosticText,
  diagnosticsInclude,
  inProjectContext,
  operationRedactionSecrets,
  preparedRecipe,
  resourceIdentityMatches,
  safeSetupLabel,
  stepStatus,
  workspaceSetupRunKey
};
