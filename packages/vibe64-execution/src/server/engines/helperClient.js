import {
  runCaptureCommand
} from "./capture.js";
import { vibe64Host } from "../hostProfile.js";

const EXEC_HELPER_PAYLOAD_SCHEMA = "vibe64.exec-helper.payload";
const EXEC_HELPER_PAYLOAD_SCHEMA_VERSION = 1;

function execHelperPath(explicitPath = "") {
  const resolved = String(explicitPath || "").trim() || vibe64Host().execHelperPath;
  if (!resolved) {
    const error = new Error("This computer has no helper for running commands as another user.");
    error.code = "vibe64_exec_helper_unavailable";
    throw error;
  }
  return resolved;
}

function normalizedHelperPayload(fields = {}) {
  return {
    ...fields,
    schema: EXEC_HELPER_PAYLOAD_SCHEMA,
    schemaVersion: EXEC_HELPER_PAYLOAD_SCHEMA_VERSION
  };
}

function helperPayload({
  actor = {},
  command = "",
  cwd = "",
  env = {},
  input = undefined,
  operation = "vibe64-command",
  args = []
} = {}) {
  return normalizedHelperPayload({
    args: Array.isArray(args) ? args.map((arg) => String(arg)) : [],
    command,
    cwd,
    env,
    gid: actor.user?.gid,
    home: actor.user?.home,
    inputBase64: input === undefined || input === null
      ? ""
      : Buffer.isBuffer(input)
        ? input.toString("base64")
        : Buffer.from(String(input)).toString("base64"),
    operation,
    uid: actor.user?.uid,
    username: actor.user?.username
  });
}

function helperOperationForRequest(request = {}) {
  if (
    request.mode === "pty" &&
    request.envPolicy === "auth" &&
    !["assistant", "codex"].includes(request.purpose)
  ) {
    return "account-auth-terminal";
  }
  if (
    request.purpose === "codex" &&
    request.mode === "capture" &&
    request.envPolicy === "auth"
  ) {
    return "codex-app-server";
  }
  if (
    request.purpose === "codex" &&
    request.mode === "detached" &&
    request.execution?.kind === "assistant" &&
    request.execution?.lifecycle === "service"
  ) {
    return "codex-app-server";
  }
  if (
    request.mode === "detached" &&
    request.execution?.kind === "assistant" &&
    request.execution?.lifecycle === "service" &&
    ["opencode-catalog", "opencode-server"].includes(request.execution?.operationId)
  ) {
    return "opencode-app-server";
  }
  if (
    request.mode === "capture" &&
    request.execution?.kind === "assistant" &&
    request.execution?.operationId === "opencode-catalog"
  ) {
    return "opencode-app-server";
  }
  if (request.purpose === "account") {
    return "account-status";
  }
  if (request.purpose === "github") {
    return "github-workflow-command";
  }
  if (request.purpose === "github-api") {
    return "github-api-command";
  }
  if (request.purpose === "workspace-cache") {
    return "workspace-cache-command";
  }
  if (request.purpose === "health") {
    return "health-status";
  }
  return "vibe64-command";
}

async function runHelperCommand(payload = {}, {
  env = process.env,
  helperPath = "",
  maxBuffer = undefined,
  outputEncoding = "utf8",
  runCapture = runCaptureCommand,
  signal = null,
  timeout = 15_000
} = {}) {
  const options = {
    env,
    input: `${JSON.stringify(payload)}\n`,
    outputEncoding,
    signal,
    timeout
  };
  if (Number.isSafeInteger(Number(maxBuffer)) && Number(maxBuffer) > 0) {
    options.maxBuffer = Number(maxBuffer);
  }
  return runCapture("sudo", [
    "-n",
    execHelperPath(helperPath),
    "execute"
  ], options);
}

export {
  EXEC_HELPER_PAYLOAD_SCHEMA,
  EXEC_HELPER_PAYLOAD_SCHEMA_VERSION,
  execHelperPath,
  helperOperationForRequest,
  helperPayload,
  normalizedHelperPayload,
  runHelperCommand
};
