import os from "node:os";
import path from "node:path";
import { hostIsManaged, processMatchesActor } from "../policy/permissionPolicy.js";
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
import { connectedGradleEnv, withoutStaleConnectedGradleHome } from "./connectedGradleEnv.js";
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
// application, while everything a session runs is Development. Nor do the
// editor's own address (HOST, PORT), the proxies it believes and the surfaces it
// serves, which a project's server reads under the same names: its dev server
// would try the editor's own port. A Preview gives the application its own
// address, and a project's own come from its Env or the command's own env.
const EDITOR_ONLY_ENV_NAMES = new Set([
  "APP_ENV",
  "HOST",
  "JSKIT_SERVER_SURFACE",
  "NODE_ENV",
  "PORT",
  "SERVER_SURFACE",
  "TRUSTED_PROXIES"
]);
// Nor do the editor's own sign-in settings. The editor is itself a JSKIT
// application, and a project's JSKIT application reads the same AUTH_* names
// for its own sign-in: the editor's one-time pass key, for one, would turn pass
// sign-in on in a Preview that has nothing to name its accounts. A project's own
// AUTH_* come from its Env, a launch's or terminal's own env, or its Staging Env.
const EDITOR_SIGN_IN_ENV_PREFIX = "AUTH_";

function editorOnlyEnvName(key) {
  return EDITOR_ONLY_ENV_NAMES.has(key) || key.startsWith(EDITOR_SIGN_IN_ENV_PREFIX);
}

// On a managed host the editor is the host's service and its environment is the
// service's, not a person's: the host's variables for the app, the editor's
// settings, addresses, database and keys. Of it, what a session runs keeps only
// what any program there needs. Everything else a command has comes from its
// login, the host's tool homes and packs, its project's Env and its own env,
// each added after this. A standalone editor's environment is its person's own
// shell, so it is kept as it was (but for the editor-only names above).
const MANAGED_EDITOR_ENV_KEPT = new Set([
  // Language, time and terminal.
  "COLORTERM",
  "LANG",
  "LANGUAGE",
  "TERM",
  "TZ",
  // How the host reaches the network.
  "ALL_PROXY",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "all_proxy",
  "http_proxy",
  "https_proxy",
  "no_proxy",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_DIR",
  "SSL_CERT_FILE",
  // Where temporary files may start programs, when the command has no folder of its own.
  "TMPDIR",
  // The parsers a session's Genesis commands read.
  "GENESIS_PARSER_AUTO_INSTALL",
  "GENESIS_PARSER_ROOT",
  // The host PHP's scan folder, which a usage recording's own folder joins rather than replaces.
  "PHP_INI_SCAN_DIR",
  // The workspace's name, which its folders already carry: a Git identity of last resort names it.
  "VIBE64_WORKSPACE"
]);
// A Preview may be an editor itself (public Vibe64's own, tooling/dev-example.mjs), served behind this one: it takes
// the addresses this editor's people and Previews are reached at, and its speech service, as a terminal never does.
const MANAGED_EDITOR_PREVIEW_ENV_KEPT = new Set([
  "VIBE64_PREVIEW_PROXY_SOCKET_DIR",
  "VIBE64_PREVIEW_PUBLIC_DOMAIN",
  "VIBE64_PREVIEW_PUBLIC_NAMESPACE",
  "VIBE64_PREVIEW_PUBLIC_PROTOCOL",
  "VIBE64_PUBLIC_PROTOCOL",
  "VIBE64_PUBLIC_USER_DOMAIN",
  "VIBE64_VOICE_ACCESS_TOKEN_FILE",
  "VIBE64_VOICE_ENDPOINT"
]);

/**
 * `baseEnv` without what it holds of the managed editor's own environment: an entry the editor's process has with
 * the same value, whichever caller passed it on (one that started from the editor's environment, or an agent's
 * command whose agent got it so), unless a session needs it. A value the caller set itself stays. The command's
 * own env (request.env) is never filtered here.
 * @param {RuntimeEnv} baseEnv @param {object} request
 */
function withoutManagedEditorEnv(baseEnv = {}, request = {}) {
  if (!hostIsManaged()) return baseEnv;
  const editorEnv = process.env;
  return Object.fromEntries(Object.entries(envRecord(baseEnv)).filter(([key, value]) =>
    editorEnv[key] === undefined ||
    editorEnv[key] !== value ||
    MANAGED_EDITOR_ENV_KEPT.has(key) ||
    key.startsWith("LC_") ||
    (request.purpose === "preview" && MANAGED_EDITOR_PREVIEW_ENV_KEPT.has(key))));
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
  // The login's HOME, LOGNAME and USER, and its home's own folders (~/.cache, ~/.config, ~/.local/share), which are
  // only the fallback. A staging account's home is in its own area, where programs start; a person's and the daemon's
  // may not be, so the host may give their commands tool homes elsewhere (vibe64Host().loginEnvironment): what those
  // name wins over the home's folders and over the server's own environment, which may carry its own login's, and
  // what the command's own environment names wins over all of them, as a project's Env does. The server's own
  // environment never names HOME, USER or XDG folders (commandBaseEnv).
  const login = homeEnvForUser(actor.user);
  const tools = actor.stagingAccount ? { env: {}, path: [] } : loginToolEnv(login.USER);
  const ownBaseEnv = withoutManagedEditorEnv(baseEnv, request);
  const env = withoutStaleConnectedGradleHome({
    ...login,
    ...commandBaseEnv(ownBaseEnv),
    ...tools.env,
    // Runtime sockets belong to the OS identity, not its configurable HOME.
    ...(processMatchesActor(actor) && path.isAbsolute(runtimeDir)
      ? { XDG_RUNTIME_DIR: runtimeDir } : {}),
    ...previewNodeEnv(request),
    ...databaseEnv(...databaseEnvRecordsForPolicy(ownBaseEnv, request)),
    ...commandProjectEnv(request),
    ...gitEnv({ actor, request }),
    // A session with a gradle connection runs Gradle in its own user home; a command's own env still wins.
    ...connectedGradleEnv(request.cwd),
    ...callerEnv,
    ...credentialEnv({ actor, request }),
    ...sharedEnv,
    // A session's own temporary folder, which the gateway owns as it owns HOME.
    ...(request.tempDirectory ? { TMPDIR: request.tempDirectory } : {}),
    ...sessionAppEnv(request)
  });
  const finalEnv = {
    ...env,
    ...npmToolEnv({ env }),
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
 * Plain local Git (`gitIdentity: "none"`) names no one: its commits take the
 * GIT_AUTHOR_* and GIT_COMMITTER_* its own Env gives, or Git's own configuration.
 * @param {CommandEnvOptions} options
 */
function commandHasOwnGitIdentity(options) {
  return options.request?.gitIdentity === "none";
}

/**
 * The command env, awaiting the person's Git identity without holding the
 * server's thread. The execution gateway resolves every command with this.
 * @param {CommandEnvOptions} options
 */
async function resolveCommandEnvAsync(options) {
  const commandEnv = commandEnvWithoutGitIdentity(options);
  if (commandHasOwnGitIdentity(options)) return commandEnv;
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
  if (commandHasOwnGitIdentity(options)) return commandEnv;
  return {
    ...commandEnv,
    ...(options.resolvedGitIdentityEnv || gitIdentityEnvSync(gitIdentityInput(options, commandEnv)))
  };
}

export {
  resolveCommandEnv,
  resolveCommandEnvAsync
};
