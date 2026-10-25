import path from "node:path";
import { processMatchesActor } from "../policy/permissionPolicy.js";
import {
  homeEnvForUser
} from "../actor/userIdentity.js";
import {
  databaseEnv
} from "./databaseEnv.js";
import {
  commandCallerEnv,
  rejectCallerEnvPolicy
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
import { runtimePackRoot } from "../runtime/runtimePacks.js";
import {
  envRecord
} from "../normalize.js";

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
    request.project?.runtimeConfigEnv,
    request.project?.databaseEnv
  ];
}

function commandProjectEnv(request = {}) {
  return projectEnvRecordsForPolicy(request).reduce((env, record) => {
    if (request.envPolicy === "deployment") {
      rejectCallerEnvPolicy(record);
      return {
        ...env,
        ...envRecord(record)
      };
    }
    return {
      ...env,
      ...commandCallerEnv(record, request)
    };
  }, {});
}

function databaseEnvRecordsForPolicy(baseEnv = {}, request = {}) {
  if (request.envPolicy === "deployment") {
    return [];
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
  localPath = "",
  request = {}
} = {}) {
  const declaredRuntimes = Array.isArray(request.runtimes)
    ? request.runtimes.join(":")
    : "";
  const sharedEnv = sharedToolEnv();
  const callerEnv = commandCallerEnv(request.env, request);
  const runtimeDir = String(baseEnv.XDG_RUNTIME_DIR || "").trim();
  const env = {
    ...homeEnvForUser(actor.user, commandBaseEnv(baseEnv)),
    // Runtime sockets belong to the OS identity, not its configurable HOME.
    ...(processMatchesActor(actor) && path.isAbsolute(runtimeDir)
      ? { XDG_RUNTIME_DIR: runtimeDir } : {}),
    ...databaseEnv(...databaseEnvRecordsForPolicy(baseEnv, request)),
    ...commandProjectEnv(request),
    ...gitEnv({ actor, request }),
    ...callerEnv,
    ...credentialEnv({ actor, request }),
    ...sharedEnv
  };
  const finalEnv = {
    ...env,
    ...npmToolEnv({ env }),
    VIBE64_DECLARED_RUNTIMES: declaredRuntimes
  };
  const PATH = resolveRuntimePath({
    env: finalEnv,
    existingPath: [
      ...npmToolBinDirs({ env: finalEnv }),
      finalEnv.PATH
    ].filter(Boolean).join(":"),
    inheritedPath: localPath,
    runtimes: request.runtimes,
    shimDirs: request.shimDirs || []
  });
  // A login shell (Launch runs `bash -lc`) may reorder PATH; with the person's
  // own tools its script restores this one, so Launch finds what setup found.
  const commandEnv = { ...finalEnv, PATH, ...(runtimePackRoot() ? {} : { VIBE64_TOOL_PATH: PATH }) };
  // Resolved last, so the person's Git config is read with the HOME, XDG
  // folders and PATH this command will actually run with.
  return {
    ...commandEnv,
    ...gitIdentityEnv({
      actor,
      env: baseEnv,
      gitConfig: { cwd: request.cwd, env: commandEnv },
      personGitIdentity: request.personGitIdentity,
      project: request.project,
      session: request.session,
      userKey: request.userKey
    })
  };
}

export {
  resolveCommandEnv
};
