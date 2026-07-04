import path from "node:path";

import {
  runHostCommand
} from "./shellCommands.js";

const DEFAULT_HOST_USER_EXEC_HELPER_PATH = "/usr/lib/vibe64/vibe64-exec-helper";
const VIBE64_HOST_USER_EXEC_HELPER_PATH_ENV = "VIBE64_HOST_USER_EXEC_HELPER_PATH";
const HOST_USER_EXECUTION_DIRECT = "direct";
const HOST_USER_EXECUTION_HELPER = "helper";

function normalizeText(value = "") {
  return String(value || "").trim();
}

function normalizeHome(value = "") {
  const normalized = normalizeText(value);
  return normalized ? path.resolve(normalized) : "";
}

function normalizeId(value = null) {
  const normalized = Number(value);
  return Number.isSafeInteger(normalized) && normalized >= 0 ? normalized : null;
}

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
  const expectedUid = normalizeId(uid);
  const expectedGid = normalizeId(gid);
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
  const resolvedHome = normalizeHome(home);
  const resolvedUsername = normalizeText(username);
  return {
    ...(env && typeof env === "object" && !Array.isArray(env) ? env : {}),
    LOGNAME: resolvedUsername,
    USER: resolvedUsername,
    ...(resolvedHome ? {
      HOME: resolvedHome,
      XDG_CACHE_HOME: path.join(resolvedHome, ".cache"),
      XDG_CONFIG_HOME: path.join(resolvedHome, ".config"),
      XDG_DATA_HOME: path.join(resolvedHome, ".local", "share")
    } : {})
  };
}

function hostUserExecutionPayload({
  args = [],
  command = "",
  cwd = "",
  env = {},
  gid = null,
  home = "",
  operation = "",
  uid = null,
  username = ""
} = {}) {
  return {
    args: Array.isArray(args) ? args.map((arg) => String(arg)) : [],
    command: normalizeText(command),
    cwd: normalizeText(cwd),
    env: env && typeof env === "object" && !Array.isArray(env) ? env : {},
    gid: normalizeId(gid),
    home: normalizeHome(home),
    operation: normalizeText(operation),
    uid: normalizeId(uid),
    username: normalizeText(username)
  };
}

function hostUserExecHelperPath({
  env = process.env,
  helperPath = ""
} = {}) {
  return normalizeText(helperPath || env?.[VIBE64_HOST_USER_EXEC_HELPER_PATH_ENV] || DEFAULT_HOST_USER_EXEC_HELPER_PATH);
}

async function runHostUserCommand(command = "", args = [], {
  cwd = "",
  env = {},
  gid = null,
  helperPath = "",
  home = "",
  operation = "host-command",
  runCommand = runHostCommand,
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
    operation,
    uid,
    username
  });
  if (execution.executionMode === HOST_USER_EXECUTION_DIRECT) {
    return runCommand(payload.command, payload.args, {
      cwd: payload.cwd || undefined,
      env: payload.env,
      timeout
    });
  }
  const resolvedHelperPath = hostUserExecHelperPath({
    helperPath
  });
  return runCommand("sudo", ["-n", resolvedHelperPath, "execute"], {
    input: `${JSON.stringify(payload)}\n`,
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
