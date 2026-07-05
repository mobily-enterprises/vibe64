import path from "node:path";
import process from "node:process";

import {
  containerWorkspacePath
} from "./containerRuntime.js";
import {
  gitToolchainMountArgs
} from "./gitToolchainMounts.js";
import {
  hostSupplementaryGroupDockerArgs,
  hostUserIdentityEnvArgs,
  setprivSupplementaryGroupArgsScript,
  shellQuote
} from "./shellCommands.js";
import {
  studioPlaywrightBrowsersDockerArgs
} from "./studioToolHome.js";
import {
  STUDIO_BASE_TOOLCHAIN_IMAGE,
  studioDaemonDockerLabels
} from "./studioRuntimeIdentity.js";
import {
  normalizeText
} from "@local/vibe64-core/server/core";
import {
  runtimeDockerNamePrefix,
  runtimeTargetName,
  targetRuntimeNetworkDockerArgs
} from "./runtimeContainers.js";

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
  return [
    "set -e",
    "mkdir -p /tmp/studio-home",
    "if [ \"$(id -u)\" = \"0\" ] && [ -n \"${VIBE64_HOST_UID:-}\" ] && [ -n \"${VIBE64_HOST_GID:-}\" ] && command -v setpriv >/dev/null 2>&1; then",
    "  chown -R \"$VIBE64_HOST_UID:$VIBE64_HOST_GID\" /tmp/studio-home",
    ...setprivSupplementaryGroupArgsScript({
      variableName: "docker_group_args"
    }),
    `  exec setpriv --reuid "$VIBE64_HOST_UID" --regid "$VIBE64_HOST_GID" $docker_group_args env HOME=/tmp/studio-home bash -lc ${shellQuote(runCommand)}`,
    "fi",
    `exec env HOME=/tmp/studio-home bash -lc ${shellQuote(runCommand)}`
  ].join("\n");
}

function targetScriptContainerName({
  adapterId = "generic",
  targetRoot = "",
  terminalId = ""
} = {}) {
  return [
    runtimeDockerNamePrefix(targetRoot),
    adapterId,
    "target-script",
    terminalId
  ].filter(Boolean).join("-");
}

function targetScriptTerminalArgs({
  adapterId = "generic",
  command = "",
  containerName = "",
  exitLabel = "command",
  extraDockerArgs = [],
  image = STUDIO_BASE_TOOLCHAIN_IMAGE,
  targetRoot = "",
  terminalId = "",
  workdir = ""
} = {}) {
  const resolvedWorkdir = normalizeText(workdir) || targetRoot;
  return [
    "run",
    "--rm",
    "-it",
    "--name",
    containerName,
    "--label",
    "vibe64.kind=target-script-terminal",
    "--label",
    `vibe64.adapter=${adapterId}`,
    ...studioDaemonDockerLabels().flatMap((label) => ["--label", label]),
    "--label",
    "vibe64.session=target",
    "--label",
    `vibe64.terminal=${terminalId}`,
    "--label",
    `vibe64.target=${runtimeTargetName(targetRoot)}`,
    ...hostSupplementaryGroupDockerArgs(),
    ...gitToolchainMountArgs(targetRoot),
    "-v",
    `${targetRoot}:${targetRoot}`,
    ...targetRuntimeNetworkDockerArgs(targetRoot),
    ...extraDockerArgs,
    ...studioPlaywrightBrowsersDockerArgs(),
    ...hostUserIdentityEnvArgs(),
    "-w",
    resolvedWorkdir,
    image,
    "bash",
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
  extraDockerArgs = [],
  image = STUDIO_BASE_TOOLCHAIN_IMAGE,
  input = {},
  metadata = {},
  packageManager = "",
  scripts = [],
  targetRoot = "",
  workdir = ""
} = {}) {
  const normalizedTargetRoot = path.resolve(targetRoot || process.cwd());
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
  if (!containerWorkspacePath(normalizedTargetRoot, normalizedTargetRoot)) {
    return targetScriptError("invalid_target_root", "The target script directory is outside the target root.");
  }
  const commandPreview = commandPreviewForScript(script);
  return {
    args: ({ id }) => targetScriptTerminalArgs({
      adapterId,
      command,
      containerName: targetScriptContainerName({
        adapterId,
        targetRoot: normalizedTargetRoot,
        terminalId: id
      }),
      extraDockerArgs,
      image,
      targetRoot: normalizedTargetRoot,
      terminalId: id,
      workdir: normalizeText(workdir) || normalizedTargetRoot
    }),
    closeExisting: true,
    command: "docker",
    commandPreview,
    cwd: normalizedTargetRoot,
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
    prepareTargetRuntimeNetwork: true,
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
