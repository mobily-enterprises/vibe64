import {
  runCaptureCommand
} from "./engines/capture.js";
import {
  homeEnvForUser
} from "./actor/userIdentity.js";
import {
  DEFAULT_EXEC_HELPER_PATH,
  VIBE64_EXEC_HELPER_PATH_ENV,
  helperPayload,
  runHelperCommand
} from "./engines/helperClient.js";
import {
  normalizeAbsolutePath,
  normalizeInteger,
  normalizeText
} from "./normalize.js";

const DEFAULT_HOST_USER_EXEC_HELPER_PATH = DEFAULT_EXEC_HELPER_PATH;
const VIBE64_HOST_USER_EXEC_HELPER_PATH_ENV = "VIBE64_HOST_USER_EXEC_HELPER_PATH";
const HOST_USER_EXECUTION_DIRECT = "direct";
const HOST_USER_EXECUTION_HELPER = "helper";

function currentProcessUid() {
  return typeof process.getuid === "function" ? process.getuid() : null;
}

function currentProcessGid() {
  return typeof process.getgid === "function" ? process.getgid() : null;
}

function hostUserExecutionMode({
  gid = null,
  uid = null
} = {}) {
  const expectedUid = normalizeInteger(uid);
  const expectedGid = normalizeInteger(gid);
  const actualUid = currentProcessUid();
  const actualGid = currentProcessGid();
  if (expectedUid === null || expectedGid === null) {
    return {
      code: "vibe64_host_user_identity_required",
      error: "A real OS uid and gid are required for host user execution.",
      ok: false
    };
  }
  if (
    (actualUid === null || actualUid === expectedUid) &&
    (actualGid === null || actualGid === expectedGid)
  ) {
    return {
      executionMode: HOST_USER_EXECUTION_DIRECT,
      ok: true
    };
  }
  return {
    executionMode: HOST_USER_EXECUTION_HELPER,
    ok: true
  };
}

function realUserHomeEnv({
  env = {},
  home = "",
  username = ""
} = {}) {
  const resolvedHome = normalizeAbsolutePath(home);
  const resolvedUsername = normalizeText(username);
  const baseEnv = env && typeof env === "object" && !Array.isArray(env) ? env : {};
  if (!resolvedHome) {
    return {
      ...baseEnv,
      LOGNAME: resolvedUsername,
      USER: resolvedUsername
    };
  }
  return homeEnvForUser({
    home: resolvedHome,
    username: resolvedUsername
  }, baseEnv);
}

function hostUserExecutionPayload({
  args = [],
  command = "",
  cwd = "",
  env = {},
  gid = null,
  home = "",
  input = undefined,
  operation = "",
  uid = null,
  username = ""
} = {}) {
  const user = {
    gid: normalizeInteger(gid),
    home: normalizeAbsolutePath(home),
    uid: normalizeInteger(uid),
    username: normalizeText(username)
  };
  return helperPayload({
    actor: {
      user
    },
    args,
    command: normalizeText(command),
    cwd: normalizeText(cwd),
    env: env && typeof env === "object" && !Array.isArray(env) ? env : {},
    input,
    operation: normalizeText(operation)
  });
}

function hostUserExecHelperPath({
  env = process.env,
  helperPath = ""
} = {}) {
  return normalizeText(
    helperPath ||
      env?.[VIBE64_HOST_USER_EXEC_HELPER_PATH_ENV] ||
      env?.[VIBE64_EXEC_HELPER_PATH_ENV] ||
      DEFAULT_HOST_USER_EXEC_HELPER_PATH
  );
}

async function runHostUserCommand(command = "", args = [], {
  cwd = "",
  env = {},
  gid = null,
  helperPath = "",
  home = "",
  input = undefined,
  operation = "host-command",
  runCommand = runCaptureCommand,
  timeout = 15_000,
  uid = null,
  username = ""
} = {}) {
  const execution = hostUserExecutionMode({
    gid,
    uid
  });
  if (execution.ok === false) {
    return {
      exitCode: 1,
      ok: false,
      output: execution.error,
      stderr: execution.error,
      stdout: ""
    };
  }
  const payload = hostUserExecutionPayload({
    args,
    command,
    cwd,
    env: realUserHomeEnv({
      env,
      home,
      username
    }),
    gid,
    home,
    input,
    operation,
    uid,
    username
  });
  if (execution.executionMode === HOST_USER_EXECUTION_DIRECT) {
    return runCommand(payload.command, payload.args, {
      cwd: payload.cwd || undefined,
      env: payload.env,
      input,
      timeout
    });
  }
  return runHelperCommand(payload, {
    helperPath: hostUserExecHelperPath({
      env,
      helperPath
    }),
    runCapture: runCommand,
    timeout
  });
}

export {
  DEFAULT_HOST_USER_EXEC_HELPER_PATH,
  HOST_USER_EXECUTION_DIRECT,
  HOST_USER_EXECUTION_HELPER,
  VIBE64_HOST_USER_EXEC_HELPER_PATH_ENV,
  hostUserExecHelperPath,
  hostUserExecutionMode,
  hostUserExecutionPayload,
  realUserHomeEnv,
  runHostUserCommand
};
