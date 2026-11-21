import os from "node:os";
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
  gitIdentityEnv,
  gitIdentityEnvSync
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
import { loginToolEnv } from "./loginToolEnv.js";
import {
  resolveRuntimePath
} from "../runtime/resolveRuntimePath.js";
import { runtimePackRoot } from "../runtime/runtimePacks.js";
import {
  envRecord
} from "../normalize.js";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEnv} RuntimeEnv */

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

// A framework mode belongs to the project: its Development Env, launch
// settings, Staging Env or the command's own `env NODE_ENV=...`. The
// editor's own mode, such as a host that serves the editor with
// NODE_ENV=production, never reaches what it runs, or npm would leave out
// devDependencies and dev servers, tests and agents would act as production.
// Nor does the editor's own APP_ENV: Vibe64 itself is a production
// application, while everything a session runs is Development.
const EDITOR_ONLY_ENV_NAMES = new Set(["APP_ENV", "NODE_ENV"]);
// Nor do the editor's own sign-in settings. The editor is itself a JSKIT
// application, and a project's JSKIT application reads the same AUTH_* names
// for its own sign-in: the editor's one-time pass key, for one, would turn pass
// sign-in on in a Preview that has nothing to name its accounts. A project's own
// AUTH_* come from its Env, a launch's or terminal's own env, or its Staging Env.
const EDITOR_SIGN_IN_ENV_PREFIX = "AUTH_";

function editorOnlyEnvName(key) {
  return EDITOR_ONLY_ENV_NAMES.has(key) || key.startsWith(EDITOR_SIGN_IN_ENV_PREFIX);
}

// Everything a session runs (its commands, terminals, agents and Preview) is
// Development, whatever the project's own Env says, so nothing it starts acts
// for real; only a host's staging Env names Staging or Production.
function sessionAppEnv(request = {}) {
  const staging = request.envPolicy === "staging" || request.purpose === "staging" || request.stagingAccount;
  return staging ? {} : { APP_ENV: "development" };
}

// Preview runs the application as a developer does. NODE_ENV only picks
// optimised builds, so the project's own Env or launch may still change it.
function previewNodeEnv(request = {}) {
  return request.purpose === "preview" ? { NODE_ENV: "development" } : {};
}

function commandBaseEnv(baseEnv = {}) {
  return Object.fromEntries(Object.entries(baseEnv && typeof baseEnv === "object" && !Array.isArray(baseEnv)
    ? baseEnv
    : {})
    .map(([key, value]) => [String(key || "").trim(), String(value ?? "")])
    .filter(([key]) => key &&
      !BASE_ENV_POLICY_NAMES.has(key) &&
      !editorOnlyEnvName(key) &&
      !key.startsWith("GIT_") &&
      !key.startsWith("GH_") &&
      !key.startsWith("XDG_")));
}

function projectEnvRecordsForPolicy(request = {}) {
  if (request.envPolicy === "staging") {
    return [
      request.project?.stagingEnv,
      request.project?.staging?.env
    ];
  }
  return [
    request.project?.runtimeConfigEnv,
    request.project?.databaseEnv
  ];
}

function commandProjectEnv(request = {}) {
  return projectEnvRecordsForPolicy(request).reduce((env, record) => {
    if (request.envPolicy === "staging") {
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
  if (request.envPolicy === "staging") {
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

/**
 * A PATH without the ~/.local/bin of these homes: where homes cannot start programs, a program found there would be
 * found first and refuse to start, so no login's ~/.local/bin is on a command's PATH, not even one the server's own
 * PATH inherited from a login shell's profile.
 * @param {string} value @param {string[]} homes
 */
function withoutHomeLocalBins(value, homes) {
  const gone = new Set(homes.filter((home) => path.isAbsolute(String(home || ""))).map((home) => path.join(home, ".local", "bin")));
  return value.split(":").filter((part) => !gone.has(part.replace(/(.)\/+$/u, "$1"))).join(":");
}

function commandEnvWithoutGitIdentity({
  actor = {},
  baseEnv,
  localPath = "",
  request = {}
}) {
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
    ...previewNodeEnv(request),
    ...databaseEnv(...databaseEnvRecordsForPolicy(baseEnv, request)),
    ...commandProjectEnv(request),
    ...gitEnv({ actor, request }),
    ...callerEnv,
    ...credentialEnv({ actor, request }),
    ...sharedEnv,
    ...sessionAppEnv(request)
  };
  // A staging account's home is in its own area, where programs start; a person's and the daemon's may not be, so
  // the host may give their commands tool homes elsewhere (vibe64Host().loginEnvironment). What the command's own
  // environment names wins, as a project's Env does.
  const tools = actor.stagingAccount ? { env: {}, path: [] } : loginToolEnv(env.USER);
  const toolEnv = { ...tools.env, ...env };
  const finalEnv = {
    ...toolEnv,
    ...npmToolEnv({ env: toolEnv }),
    VIBE64_DECLARED_RUNTIMES: declaredRuntimes
  };
  const runtimePath = resolveRuntimePath({
    env: finalEnv,
    existingPath: [
      ...new Set([...tools.path, ...npmToolBinDirs({ env: finalEnv })]),
      finalEnv.PATH
    ].filter(Boolean).join(":"),
    inheritedPath: localPath,
    runtimes: request.runtimes,
    shimDirs: request.shimDirs || []
  });
  // The tool homes' folders take ~/.local/bin's place: the command's login's, and the server's own login's.
  const PATH = tools.path.length ? withoutHomeLocalBins(runtimePath, [finalEnv.HOME, os.homedir()]) : runtimePath;
  // A login shell (Launch runs `bash -lc`) may reorder PATH; with the person's
  // own tools its script restores this one, so Launch finds what setup found.
  return { ...finalEnv, PATH, ...(runtimePackRoot() ? {} : { VIBE64_TOOL_PATH: PATH }) };
}

/**
 * Resolved last, so the person's Git config is read with the HOME, XDG
 * folders and PATH this command will actually run with.
 */
function gitIdentityInput({
  actor = {},
  baseEnv,
  request = {}
}, commandEnv) {
  return {
    actor,
    env: baseEnv,
    gitConfig: { cwd: request.cwd, env: commandEnv },
    personGitIdentity: request.personGitIdentity,
    project: request.project,
    session: request.session,
    userKey: request.userKey
  };
}

/**
 * @typedef {object} CommandEnvOptions
 * @property {RuntimeEnv} baseEnv the environment the command starts from
 * @property {object} [actor]
 * @property {string} [localPath]
 * @property {object} [request]
 * @property {Record<string, string>} [resolvedGitIdentityEnv]
 */

/**
 * The command env, awaiting the person's Git identity without holding the
 * server's thread. The execution gateway resolves every command with this.
 * @param {CommandEnvOptions} options
 */
async function resolveCommandEnvAsync(options) {
  const commandEnv = commandEnvWithoutGitIdentity(options);
  return { ...commandEnv, ...await gitIdentityEnv(gitIdentityInput(options, commandEnv)) };
}

/**
 * The same env for a builder that must stay synchronous (the Codex runtime
 * context). With `resolvedGitIdentityEnv` it applies that identity, as the
 * gateway's per-terminal env factory does; without it, it reads Git's config
 * while the caller waits.
 * @param {CommandEnvOptions} options
 */
function resolveCommandEnv(options) {
  const commandEnv = commandEnvWithoutGitIdentity(options);
  return {
    ...commandEnv,
    ...(options.resolvedGitIdentityEnv || gitIdentityEnvSync(gitIdentityInput(options, commandEnv)))
  };
}

export {
  resolveCommandEnv,
  resolveCommandEnvAsync
};
