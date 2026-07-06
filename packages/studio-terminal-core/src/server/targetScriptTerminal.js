import path from "node:path";
import process from "node:process";

import {
  shellQuote
} from "./shellCommands.js";
import {
  studioUserStartupScript
} from "./studioToolHome.js";
import {
  normalizeText
} from "@local/vibe64-core/server/core";

function targetScriptError(code, message, extra = {}) {
  return {
    ...extra,
    error: message,
    errors: [
      {
        code,
        message
      }
    ],
    ok: false
  };
}

function adapterScriptNameFromInput(input = {}) {
  const scriptId = normalizeText(input?.scriptId);
  return scriptId.startsWith("adapter:") ? scriptId.slice("adapter:".length).trim() : "";
}

function targetScriptStartupScript(command = "", {
  exitLabel = "command"
} = {}) {
  const normalizedCommand = normalizeText(command);
  const runCommand = [
    "set +e",
    `printf '\\n[studio] $ %s\\n\\n' ${shellQuote(normalizedCommand)}`,
    normalizedCommand,
    "status=$?",
    `printf '\\n[studio] ${exitLabel} exited with code %s\\n' "$status"`,
    "exit \"$status\""
  ].join("\n");
  return studioUserStartupScript(["bash", "-lc", runCommand]);
}

function pathInsideOrEqual(rootPath = "", candidatePath = "") {
  if (!rootPath || !candidatePath) {
    return false;
  }
  const relativePath = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function targetScriptTerminalArgs({
  command = "",
  exitLabel = "command"
} = {}) {
  return [
    "-lc",
    targetScriptStartupScript(command, {
      exitLabel
    })
  ];
}

function scriptByName(scripts = [], scriptName = "") {
  return scripts.find((candidate) => candidate.name === scriptName) || null;
}

function commandPreviewForScript(script = {}) {
  return normalizeText(script.commandPreview || script.command);
}

function targetScriptCommandPreview(command = "") {
  return normalizeText(command);
}

async function createVibe64TargetScriptTerminalSpec({
  adapterId = "generic",
  input = {},
  metadata = {},
  packageManager = "",
  scripts = [],
  targetRoot = "",
  workdir = ""
} = {}) {
  void adapterId;
  const normalizedTargetRoot = path.resolve(targetRoot || process.cwd());
  const resolvedWorkdir = path.resolve(normalizeText(workdir) || normalizedTargetRoot);
  const scriptName = adapterScriptNameFromInput(input);
  if (!scriptName) {
    return targetScriptError("missing_target_script", "scriptId must identify an adapter target script.");
  }
  const script = scriptByName(scripts, scriptName);
  if (!script) {
    return targetScriptError("invalid_target_script", `Unknown target script: ${scriptName}.`);
  }
  const command = normalizeText(script.command);
  if (!command) {
    return targetScriptError("invalid_target_script", `Target script has no command: ${scriptName}.`);
  }
  if (!pathInsideOrEqual(normalizedTargetRoot, resolvedWorkdir)) {
    return targetScriptError("invalid_target_workdir", "The target script directory is outside the target root.");
  }
  const commandPreview = commandPreviewForScript(script);
  return {
    args: () => targetScriptTerminalArgs({
      command,
      targetRoot: normalizedTargetRoot,
      workdir: resolvedWorkdir
    }),
    closeExisting: true,
    command: "bash",
    commandPreview,
    cwd: resolvedWorkdir,
    maxRunning: 1,
    metadata: {
      command,
      commandPreview,
      packageManager,
      runRoot: normalizedTargetRoot,
      scope: "target",
      scriptName,
      ...(metadata || {})
    },
    ok: true,
    reuseRunning: false,
    targetRoot: normalizedTargetRoot
  };
}

export {
  adapterScriptNameFromInput,
  createVibe64TargetScriptTerminalSpec,
  targetScriptCommandPreview,
  targetScriptError,
  targetScriptStartupScript,
  targetScriptTerminalArgs
};
