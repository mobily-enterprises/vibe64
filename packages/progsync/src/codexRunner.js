import fs from "node:fs/promises";
import path from "node:path";

import { runProgSyncCommand } from "./command.js";
import { SYNCHRONIZATION_MODES } from "./constants.js";
import { ProgSyncError } from "./errors.js";
import { synchronizerSchemaPath } from "./prompts.js";

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_CAPTURED_OUTPUT = 16 * 1024 * 1024;
const RESULT_ARRAY_FIELDS = Object.freeze([
  "programChanges",
  "implementationChanges",
  "preservedImplementationDetails",
  "sharedDefinitionProposals",
  "diagnostics",
  "verificationPerformed",
  "verificationStillRequired"
]);
const RESULT_STATUSES = new Set(["updated", "unchanged", "blocked"]);
const RESULT_MODES = new Set(SYNCHRONIZATION_MODES);
const RESULT_FIELDS = new Set([
  "status",
  "mode",
  "summary",
  ...RESULT_ARRAY_FIELDS
]);

function parseJsonResult(source) {
  const trimmed = String(source || "").trim();
  if (!trimmed) {
    throw new ProgSyncError(
      "CODEX_RESULT_MISSING",
      "Codex completed without a structured synchronization result."
    );
  }
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/iu, "")
    .replace(/\s*```$/u, "");
  try {
    return JSON.parse(unfenced);
  } catch {
    throw new ProgSyncError(
      "CODEX_RESULT_INVALID",
      "Codex returned invalid synchronization JSON.",
      { result: trimmed.slice(0, 2000) }
    );
  }
}

function validateRunnerResult(result) {
  if (!result || typeof result !== "object") {
    throw new ProgSyncError("CODEX_RESULT_INVALID", "Codex result must be an object.");
  }
  if (!RESULT_STATUSES.has(result.status)) {
    throw new ProgSyncError(
      "CODEX_RESULT_INVALID",
      `Codex returned invalid status: ${result.status}`
    );
  }
  if (!RESULT_MODES.has(result.mode)) {
    throw new ProgSyncError(
      "CODEX_RESULT_INVALID",
      `Codex returned invalid synchronization mode: ${result.mode}`
    );
  }
  if (typeof result.summary !== "string") {
    throw new ProgSyncError("CODEX_RESULT_INVALID", "Codex result has no textual summary.");
  }
  const unexpectedFields = Object.keys(result).filter((field) => !RESULT_FIELDS.has(field));
  if (unexpectedFields.length > 0) {
    throw new ProgSyncError(
      "CODEX_RESULT_INVALID",
      "Codex result contains unsupported fields.",
      { unexpectedFields }
    );
  }
  for (const field of RESULT_ARRAY_FIELDS) {
    if (!Array.isArray(result[field]) || result[field].some((entry) => typeof entry !== "string")) {
      throw new ProgSyncError(
        "CODEX_RESULT_INVALID",
        `Codex result field ${field} must be an array of strings.`
      );
    }
  }
  return result;
}

function createCodexExecRunner({
  command = "codex",
  execute = runProgSyncCommand,
  timeoutMs = DEFAULT_TIMEOUT_MS
} = {}) {
  return async function codexExecRunner({ onEvent, prompt, workspaceRoot }) {
    const resultPath = path.join(path.dirname(workspaceRoot), "codex-result.json");
    const args = [
      "exec",
      "--ephemeral",
      "--ignore-user-config",
      "--ignore-rules",
      "--dangerously-bypass-approvals-and-sandbox",
      "--disable",
      "shell_tool",
      "--disable",
      "web_search",
      "--disable",
      "apps",
      "--disable",
      "multi_agent",
      "--disable",
      "goals",
      "--disable",
      "hooks",
      "--disable",
      "memories",
      "--disable",
      "remote_plugin",
      "--disable",
      "shell_snapshot",
      "--config",
      "web_search=\"disabled\"",
      "--color",
      "never",
      "--json",
      "--output-schema",
      synchronizerSchemaPath(),
      "--output-last-message",
      resultPath,
      "--cd",
      workspaceRoot,
      "-"
    ];

    let pendingLine = "";
    const execution = await execute(command, args, {
      cwd: workspaceRoot,
      input: prompt,
      maxBuffer: MAX_CAPTURED_OUTPUT,
      onOutput(chunk) {
        pendingLine += String(chunk || "");
        const lines = pendingLine.split("\n");
        pendingLine = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) {
            continue;
          }
          try {
            onEvent?.(JSON.parse(line));
          } catch {
            onEvent?.({ type: "runner.output", text: line });
          }
        }
      },
      reject: false,
      timeout: timeoutMs
    });
    if (pendingLine.trim()) {
      try {
        onEvent?.(JSON.parse(pendingLine));
      } catch {
        onEvent?.({ type: "runner.output", text: pendingLine });
      }
    }

    if (execution.timedOut) {
      throw new ProgSyncError(
        "CODEX_TIMEOUT",
        `Codex did not finish within ${timeoutMs}ms.`,
        { timeoutMs }
      );
    }
    if (!execution.ok) {
      throw new ProgSyncError(
        "CODEX_EXEC_FAILED",
        `Codex exited with status ${execution.exitCode}.`,
        {
          signal: execution.signal,
          stderr: execution.stderr.slice(-4000),
          stdout: execution.stdout.slice(-4000)
        }
      );
    }
    let resultSource;
    try {
      resultSource = await fs.readFile(resultPath, "utf8");
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
      throw new ProgSyncError(
        "CODEX_RESULT_MISSING",
        `Codex did not write ${resultPath}.`
      );
    }
    return validateRunnerResult(parseJsonResult(resultSource));
  };
}

export {
  DEFAULT_TIMEOUT_MS,
  createCodexExecRunner,
  parseJsonResult,
  validateRunnerResult
};
