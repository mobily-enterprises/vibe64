import {
  runCaptureCommand
} from "./capture.js";

const DEFAULT_EXEC_HELPER_PATH = "/usr/lib/vibe64/vibe64-exec-helper";
const EXEC_HELPER_PAYLOAD_SCHEMA = "vibe64.exec-helper.payload";
const EXEC_HELPER_PAYLOAD_SCHEMA_VERSION = 1;
const VIBE64_EXEC_HELPER_PATH_ENV = "VIBE64_EXEC_HELPER_PATH";

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
  if (request.mode === "pty" && request.envPolicy === "auth") {
    return "account-auth-terminal";
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
  return "vibe64-command";
}

async function runHelperCommand(payload = {}, {
  env = process.env,
  helperPath = "",
  maxBuffer = undefined,
  runCapture = runCaptureCommand,
  timeout = 15_000
} = {}) {
  const options = {
    env,
    input: `${JSON.stringify(payload)}\n`,
    timeout
  };
  if (Number.isSafeInteger(Number(maxBuffer)) && Number(maxBuffer) > 0) {
    options.maxBuffer = Number(maxBuffer);
  }
  return runCapture("sudo", [
    "-n",
    helperPath || env[VIBE64_EXEC_HELPER_PATH_ENV] || DEFAULT_EXEC_HELPER_PATH,
    "execute"
  ], options);
}

export {
  DEFAULT_EXEC_HELPER_PATH,
  EXEC_HELPER_PAYLOAD_SCHEMA,
  EXEC_HELPER_PAYLOAD_SCHEMA_VERSION,
  VIBE64_EXEC_HELPER_PATH_ENV,
  helperOperationForRequest,
  helperPayload,
  normalizedHelperPayload,
  runHelperCommand
};
