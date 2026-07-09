import {
  actorHomeEnv
} from "../actor/userIdentity.js";
import {
  databaseEnv
} from "./databaseEnv.js";
import {
  commandCallerEnv
} from "./callerEnv.js";
import {
  DATABASE_ENV_NAMES
} from "./databaseEnv.js";
import {
  credentialEnv
} from "./credentialEnv.js";
import {
  gitEnv
} from "./gitEnv.js";
import {
  gitIdentityEnv
} from "./gitIdentityEnv.js";
import {
  GIT_AUTHOR_EMAIL_ENV,
  GIT_AUTHOR_NAME_ENV,
  GIT_COMMITTER_EMAIL_ENV,
  GIT_COMMITTER_NAME_ENV
} from "./gitIdentityEnv.js";
import {
  sharedToolEnv
} from "./sharedToolEnv.js";
import {
  npmToolBinDirs,
  npmToolEnv
} from "./npmToolEnv.js";
import {
  resolveRuntimePath
} from "../runtime/resolveRuntimePath.js";

const BASE_ENV_POLICY_NAMES = new Set([
  ...DATABASE_ENV_NAMES,
  GIT_AUTHOR_EMAIL_ENV,
  GIT_AUTHOR_NAME_ENV,
  GIT_COMMITTER_EMAIL_ENV,
  GIT_COMMITTER_NAME_ENV,
  "HOME",
  "LOGNAME",
  "PATH",
  "USER",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_RUNTIME_DIR"
]);

function commandBaseEnv(baseEnv = {}) {
  return Object.fromEntries(Object.entries(baseEnv && typeof baseEnv === "object" && !Array.isArray(baseEnv)
    ? baseEnv
    : {})
    .map(([key, value]) => [String(key || "").trim(), String(value ?? "")])
    .filter(([key]) => key &&
      !BASE_ENV_POLICY_NAMES.has(key) &&
      !key.startsWith("GIT_") &&
      !key.startsWith("GH_") &&
      !key.startsWith("XDG_")));
}

function projectEnvRecordsForPolicy(request = {}) {
  if (request.envPolicy === "deployment") {
    return [
      request.project?.deploymentEnv,
      request.project?.deployment?.env
    ];
  }
  return [
    request.project?.configEnv,
    request.project?.runtimeConfigEnv,
    request.project?.databaseEnv
  ];
}

function commandProjectEnv(request = {}) {
  return projectEnvRecordsForPolicy(request).reduce((env, record) => ({
    ...env,
    ...commandCallerEnv(record, request)
  }), {});
}

function databaseEnvRecordsForPolicy(baseEnv = {}, request = {}) {
  if (request.envPolicy === "deployment") {
    return [
      request.project?.deploymentDatabaseEnv,
      request.project?.deployment?.databaseEnv,
      request.project?.databaseEnv
    ];
  }
  if (request.envPolicy === "project") {
    return projectEnvRecordsForPolicy(request);
  }
  return [
    baseEnv,
    ...projectEnvRecordsForPolicy(request),
    request.project?.databaseEnv,
    request.session?.databaseEnv
  ];
}

function resolveCommandEnv({
  actor = {},
  baseEnv = process.env,
  request = {}
} = {}) {
  const declaredRuntimes = Array.isArray(request.runtimes)
    ? request.runtimes.join(":")
    : "";
  const sharedEnv = sharedToolEnv({ env: baseEnv });
  const callerEnv = commandCallerEnv(request.env, request);
  const env = {
    ...actorHomeEnv(actor.user, commandBaseEnv(baseEnv)),
    ...databaseEnv(...databaseEnvRecordsForPolicy(baseEnv, request)),
    ...commandProjectEnv(request),
    ...gitEnv({ actor, request }),
    ...gitIdentityEnv({
      actor,
      env: baseEnv,
      project: request.project,
      session: request.session,
      userKey: request.userKey
    }),
    ...callerEnv,
    ...credentialEnv({ actor, request }),
    ...sharedEnv
  };
  const finalEnv = {
    ...env,
    ...npmToolEnv({ env }),
    VIBE64_DECLARED_RUNTIMES: declaredRuntimes
  };
  return {
    ...finalEnv,
    PATH: resolveRuntimePath({
      env: finalEnv,
      existingPath: [
        ...npmToolBinDirs({ env: finalEnv }),
        finalEnv.PATH
      ].filter(Boolean).join(":"),
      runtimes: request.runtimes,
      shimDirs: request.shimDirs || []
    })
  };
}

export {
  resolveCommandEnv
};
