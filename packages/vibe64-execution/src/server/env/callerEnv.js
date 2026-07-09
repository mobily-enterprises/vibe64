import {
  envRecord
} from "../normalize.js";
import {
  DATABASE_ENV_NAMES,
  databaseEnv
} from "./databaseEnv.js";
import {
  GIT_AUTHOR_EMAIL_ENV,
  GIT_AUTHOR_NAME_ENV,
  GIT_COMMITTER_EMAIL_ENV,
  GIT_COMMITTER_NAME_ENV
} from "./gitIdentityEnv.js";
import {
  PLAYWRIGHT_BROWSERS_PATH_ENV,
  VIBE64_SHARED_CACHE_ROOT_ENV
} from "./sharedToolEnv.js";

const RESERVED_CALLER_ENV_NAMES = new Set([
  "HOME",
  "LOGNAME",
  "PATH",
  "USER",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_RUNTIME_DIR"
]);

const POLICY_OWNED_CALLER_ENV_NAMES = new Set([
  ...DATABASE_ENV_NAMES,
  GIT_AUTHOR_EMAIL_ENV,
  GIT_AUTHOR_NAME_ENV,
  GIT_COMMITTER_EMAIL_ENV,
  GIT_COMMITTER_NAME_ENV,
  PLAYWRIGHT_BROWSERS_PATH_ENV,
  VIBE64_SHARED_CACHE_ROOT_ENV
]);

function rejectCallerEnvPolicy(env = {}) {
  for (const key of Object.keys(envRecord(env))) {
    if (RESERVED_CALLER_ENV_NAMES.has(key) || key.startsWith("XDG_")) {
      const error = new Error(`Vibe64 command callers cannot provide execution policy env: ${key}.`);
      error.code = "vibe64_command_env_policy_reserved";
      throw error;
    }
  }
}

function commandCallerEnv(env = {}, {
  envPolicy = "session"
} = {}) {
  const callerEnv = envRecord(env);
  rejectCallerEnvPolicy(callerEnv);
  const passthrough = Object.fromEntries(Object.entries(callerEnv)
    .filter(([key]) => !POLICY_OWNED_CALLER_ENV_NAMES.has(key)));
  if (envPolicy === "deployment") {
    return passthrough;
  }
  return {
    ...passthrough,
    ...databaseEnv(callerEnv)
  };
}

export {
  POLICY_OWNED_CALLER_ENV_NAMES,
  RESERVED_CALLER_ENV_NAMES,
  commandCallerEnv,
  rejectCallerEnvPolicy
};
