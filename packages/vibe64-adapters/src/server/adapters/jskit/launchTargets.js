import { mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadAppConfigFromAppRoot } from "@jskit-ai/kernel/server/support";
import {
  sessionWorktreePath
} from "@local/vibe64-core/server/sessionWorktreePath";
import {
  VIBE64_PROJECTS_ROOT_ENV,
  VIBE64_PROVIDER_HOMES_ROOT_ENV,
  VIBE64_SELF_TARGET_SYSTEM_ROOT_ENV,
  VIBE64_SYSTEM_ROOT_ENV
} from "@local/vibe64-core/server/studioRoots";
import {
  PREVIEW_PROXY_HOST_ENV,
  PREVIEW_PROXY_PORT_END_ENV,
  PREVIEW_PROXY_PORT_START_ENV,
  PREVIEW_PROXY_PUBLIC_HOST_ENV
} from "@local/vibe64-core/server/launchPreviewProxyEnv";
import {
  resolveStudioProjectsRoot
} from "@local/vibe64-core/server/studioProjectContext";
import {
  JSKIT_PREVIEW_AUTH_KIND,
  PREVIEW_AUTH_PROFILE,
  VIBE64_SELF_PREVIEW_AUTH_KIND
} from "@local/vibe64-core/server/previewAuth";
import {
  shellQuote
} from "@local/studio-terminal-core/server/shellCommands";

import {
  createVibe64WebLaunchTargetTerminalSpec,
  tcpReadinessProbeCommand
} from "@local/studio-terminal-core/server/launchTargetTerminal";
import {
  VIBE64_RUNTIME_NAMESPACE_ENV,
  runtimeNamespace,
  studioDaemonDockerEnvArgs
} from "@local/studio-terminal-core/server/studioRuntimeIdentity";
import {
  resolveProviderHomesRoot
} from "@local/studio-terminal-core/server/providerHomes";
import {
  commandWithStartupArgs,
  launchTargetWithStartupArgsOption,
  startupArgsFromLaunchInput
} from "../../launchPreviewOptions.js";
import {
  JSKIT_TOOLCHAIN_IMAGE
} from "./toolchainIdentity.js";
import {
  readDatabaseHostFromDotEnv
} from "./setupMariaDbRuntime.js";

const DEFAULT_BUILT_LAUNCH_BUILD_COMMAND = "npm run build";
const DEFAULT_BUILT_LAUNCH_SERVER_COMMAND = "npm run server";
const DEFAULT_DEV_BACKEND_COMMAND = "npm run server";
const DEFAULT_DEV_FRONTEND_COMMAND = "npm run dev -- --host 0.0.0.0 --port \"$PORT\"";
const DEFAULT_MIGRATION_COMMAND = "npm run db:migrate";
const DEFAULT_DEV_BACKEND_PORT = 3000;
const DEFAULT_LAUNCH_PORT = 4100;
const JSKIT_SELF_TARGET_SOURCE = "target_package:vibe64";
const JSKIT_SELF_TARGET_PREVIEW_PROXY_PORT_BASE = 50000;
const JSKIT_SELF_TARGET_PREVIEW_PROXY_PORT_SPAN = 100;
const BUILT_LAUNCH_COMMAND_CONFIG = ".jskit/config/testrun_command";
const BUILT_LAUNCH_PORT_CONFIG = ".jskit/config/server_port_for_user_review";
const DEV_SERVER_COMMAND_CONFIG = "config/dev_server_command";
const MIGRATION_SCRIPT_NAME = "db:migrate";

function previewAuthProfileSeed(vibe64User = null) {
  const email = String(vibe64User?.email || "").trim().toLowerCase();
  if (!email) {
    return PREVIEW_AUTH_PROFILE;
  }
  const username = String(vibe64User?.github?.login || email.split("@")[0] || PREVIEW_AUTH_PROFILE.username)
    .trim()
    .toLowerCase();
  const displayName = String(vibe64User?.displayName || vibe64User?.name || username || email).trim();
  return {
    ...PREVIEW_AUTH_PROFILE,
    email,
    username,
    displayName,
    authProvider: "vibe64-preview",
    authProviderUserSid: `vibe64:${email}`
  };
}

function createJskitPreviewAuthProfileCommand({
  vibe64User = null
} = {}) {
  const script = `
const profileFile = String(process.env.VIBE64_PREVIEW_AUTH_PROFILE_FILE || "").trim();
const profile = ${JSON.stringify(previewAuthProfileSeed(vibe64User))};

function isDuplicateError(error) {
  return ["23505", "ER_DUP_ENTRY", "SQLITE_CONSTRAINT", "SQLITE_CONSTRAINT_UNIQUE"].includes(String(error?.code || "")) ||
    Number(error?.errno) === 1062;
}

function profileFromUser(user, fallback) {
  return {
    authProvider: String(user.auth_provider || fallback.authProvider || "dev").trim().toLowerCase(),
    authProviderUserSid: String(user.auth_provider_user_sid || fallback.authProviderUserSid || user.id || "").trim(),
    displayName: String(user.display_name || fallback.displayName || user.email || "").trim(),
    email: String(user.email || fallback.email || "").trim().toLowerCase(),
    id: String(user.id || ""),
    username: String(user.username || fallback.username || "").trim().toLowerCase()
  };
}

async function main() {
  if (!profileFile) {
    return;
  }
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const { pathToFileURL } = await import("node:url");
  const knexfilePath = path.resolve(process.cwd(), "knexfile.js");
  try {
    await fs.access(knexfilePath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      console.log("[studio] Preview auth profile skipped: knexfile.js was not found.");
      return;
    }
    throw error;
  }
  const knexPackageName = "knex";
  const [{ default: createKnex }, knexfileModule] = await Promise.all([
    import(knexPackageName),
    import(pathToFileURL(knexfilePath).href)
  ]);
  const knexfile = knexfileModule.default || knexfileModule;
  const environment = String(process.env.NODE_ENV || "development");
  const knexConfig = knexfile[environment] || knexfile;
  const db = createKnex(knexConfig);
  try {
    const hasUsersTable = await db.schema.hasTable("users");
    if (!hasUsersTable) {
      console.log("[studio] Preview auth profile skipped: users table was not found.");
      return;
    }
    const record = {
      auth_provider: profile.authProvider,
      auth_provider_user_sid: profile.authProviderUserSid,
      email: profile.email,
      username: profile.username,
      display_name: profile.displayName
    };
    const findByEmail = () => record.email
      ? db("users")
        .where({ email: record.email })
        .first()
      : null;
    const findByIdentity = () => db("users")
      .where({
        auth_provider: record.auth_provider,
        auth_provider_user_sid: record.auth_provider_user_sid
      })
      .first();
    let user = await findByEmail();
    if (!user) {
      user = await findByIdentity();
      if (!user) {
        try {
          await db("users").insert(record);
        } catch (error) {
          if (!isDuplicateError(error)) {
            throw error;
          }
        }
        user = await findByIdentity();
      }
      if (!user) {
        user = await db("users")
          .where({ email: record.email })
          .orWhere({ username: record.username })
          .first();
        if (!user) {
          throw new Error("Preview auth profile could not be inserted or found.");
        }
      }
      await db("users")
        .where({ id: user.id })
        .update(record);
      user = await db("users")
        .where({ id: user.id })
        .first();
    }
    const authProfile = profileFromUser(user, profile);
    await fs.mkdir(path.dirname(profileFile), {
      recursive: true
    });
    await fs.writeFile(profileFile, JSON.stringify(authProfile, null, 2) + "\\n", "utf8");
    console.log(\`[studio] Preview auth user is ready: \${authProfile.email} (\${authProfile.id}).\`);
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  console.error(\`[studio] Preview auth profile failed: \${String(error?.message || error)}\`);
  process.exit(1);
});
`.trim();
  return [
    "node",
    "--input-type=module",
    "-e",
    shellQuote(script)
  ].join(" ");
}

function createVibe64SelfPreviewAuthProfileCommand({
  vibe64User = null
} = {}) {
  const script = `
const profileFile = String(process.env.VIBE64_PREVIEW_AUTH_PROFILE_FILE || "").trim();
const systemRoot = String(process.env.VIBE64_SYSTEM_ROOT || "").trim();
const runtimeNamespace = String(process.env.VIBE64_RUNTIME_NAMESPACE || "").trim().toLowerCase().replace(/[^a-z0-9_.-]+/gu, "-").replace(/^-+|-+$/gu, "");
const profile = ${JSON.stringify(previewAuthProfileSeed(vibe64User))};

function canonicalEmail(value = "") {
  const email = String(value || "").trim().toLowerCase();
  if (!email || !/^[^\\s@/\\\\]+@[^\\s@/\\\\]+\\.[^\\s@/\\\\]+$/u.test(email)) {
    throw new Error("Vibe64 self preview auth requires a valid user email.");
  }
  return email;
}

function scopedAuthCookieName(scope = "") {
  if (!scope) {
    return "vibe64_session";
  }
  const digest = crypto.createHash("sha256").update(scope).digest("hex").slice(0, 16);
  return \`vibe64_session_\${digest}\`;
}

function authCookieName() {
  return runtimeNamespace
    ? scopedAuthCookieName(\`\${runtimeNamespace}:\${path.resolve(systemRoot)}\`)
    : scopedAuthCookieName("");
}

function tokenDigest(token = "") {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

async function readJsonFile(filePath = "") {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function listUsers(usersRoot = "") {
  await fs.mkdir(usersRoot, { recursive: true });
  const entries = await fs.readdir(usersRoot, { withFileTypes: true });
  const users = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }
    const user = await readJsonFile(path.join(usersRoot, entry.name));
    if (user?.email) {
      users.push(user);
    }
  }
  return users;
}

async function ensureUser(usersRoot = "") {
  const email = canonicalEmail(profile.email);
  const users = await listUsers(usersRoot);
  const existing = users.find((user) => String(user.email || "").trim().toLowerCase() === email);
  if (existing?.supabaseUserId) {
    return existing;
  }
  const now = new Date().toISOString();
  const supabaseUserId = crypto.randomUUID();
  const user = {
    acceptedAt: now,
    canceledAt: "",
    createdAt: now,
    email,
    github: profile.username && profile.username !== email.split("@")[0]
      ? {
          connectedAt: now,
          login: profile.username
        }
      : null,
    invitedAt: "",
    revokedAt: "",
    role: "owner",
    status: "active",
    supabaseUserId,
    updatedAt: now,
    version: 2
  };
  await fs.writeFile(path.join(usersRoot, \`\${supabaseUserId}.json\`), JSON.stringify(user, null, 2) + "\\n", "utf8");
  return user;
}

async function createSession(sessionsRoot = "", user = {}) {
  await fs.mkdir(sessionsRoot, { recursive: true });
  const id = crypto.randomUUID();
  const token = crypto.randomBytes(32).toString("base64url");
  const now = new Date();
  const ttlMs = 30 * 24 * 60 * 60 * 1000;
  const record = {
    createdAt: now.toISOString(),
    email: String(user.email || ""),
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
    id,
    supabaseUserId: String(user.supabaseUserId || ""),
    tokenHash: tokenDigest(token),
    version: 1
  };
  await fs.writeFile(path.join(sessionsRoot, \`\${id}.json\`), JSON.stringify(record, null, 2) + "\\n", "utf8");
  return \`\${id}.\${token}\`;
}

async function main() {
  if (!profileFile) {
    return;
  }
  if (!systemRoot) {
    throw new Error("Vibe64 self preview auth requires VIBE64_SYSTEM_ROOT.");
  }
  const usersRoot = path.join(systemRoot, "users");
  const sessionsRoot = path.join(systemRoot, "auth-sessions");
  const user = await ensureUser(usersRoot);
  const cookieValue = await createSession(sessionsRoot, user);
  await fs.mkdir(path.dirname(profileFile), { recursive: true });
  await fs.writeFile(profileFile, JSON.stringify({
    cookieName: authCookieName(),
    cookieValue,
    email: user.email,
    supabaseUserId: user.supabaseUserId
  }, null, 2) + "\\n", "utf8");
  console.log(\`[studio] Vibe64 self preview auth session is ready: \${user.email} (\${user.supabaseUserId}).\`);
}

const fs = await import("node:fs/promises");
const path = await import("node:path");
const crypto = await import("node:crypto");

main().catch((error) => {
  console.error(\`[studio] Vibe64 self preview auth profile failed: \${String(error?.message || error)}\`);
  process.exit(1);
});
`.trim();
  return [
    "node",
    "--input-type=module",
    "-e",
    shellQuote(script)
  ].join(" ");
}

async function readOptionalConfigFile(root, relativePath, fallback = "") {
  try {
    const value = String(await readFile(path.join(root, relativePath), "utf8")).trim();
    return value || fallback;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return fallback;
    }
    throw new Error(`Cannot read ${relativePath}: ${String(error?.message || error)}`);
  }
}

async function readPackageJsonScripts(root) {
  try {
    const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
    return packageJson?.scripts && typeof packageJson.scripts === "object"
      ? packageJson.scripts
      : {};
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {};
    }
    throw new Error(`Cannot read package.json scripts: ${String(error?.message || error)}`);
  }
}

async function configFileHasValue(root, relativePath) {
  return Boolean(await readOptionalConfigFile(root, relativePath, ""));
}

async function resolveMigrationCommand(root) {
  const scripts = await readPackageJsonScripts(root);
  return scripts[MIGRATION_SCRIPT_NAME] ? DEFAULT_MIGRATION_COMMAND : "";
}

async function readPackageJsonName(root = "") {
  try {
    const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
    return String(packageJson?.name || "").trim();
  } catch (error) {
    if (error?.code === "ENOENT") {
      return "";
    }
    throw new Error(`Cannot read package.json name: ${String(error?.message || error)}`);
  }
}

async function isJskitSelfTargetRoot(root = "") {
  return await readPackageJsonName(root) === "vibe64";
}

async function resolveHostDockerConfig({
  targetRoot = "",
  worktreePath = ""
} = {}) {
  const enabled = await isJskitSelfTargetRoot(targetRoot || worktreePath);
  return {
    enabled,
    runtimeNamespace: enabled ? runtimeNamespace() : "",
    source: enabled ? JSKIT_SELF_TARGET_SOURCE : ""
  };
}

function runtimeNamespaceDockerArgs(namespace = "") {
  const normalizedNamespace = String(namespace || "").trim();
  return normalizedNamespace
    ? [
        "-e",
        `${VIBE64_RUNTIME_NAMESPACE_ENV}=${normalizedNamespace}`
      ]
    : [];
}

function dockerRootEnvArgs(envName = "", rootPath = "", {
  ensure = false
} = {}) {
  const normalizedRoot = String(rootPath || "").trim()
    ? path.resolve(String(rootPath || ""))
    : "";
  if (normalizedRoot && ensure) {
    mkdirSync(normalizedRoot, {
      recursive: true
    });
  }
  return normalizedRoot
    ? [
        "-v",
        `${normalizedRoot}:${normalizedRoot}`,
        "-e",
        `${envName}=${normalizedRoot}`
      ]
    : [];
}

function jskitSelfTargetSystemRoot({
  session = {},
  worktreePath = ""
} = {}) {
  const sessionRoot = String(session.sessionRoot || "").trim();
  const derivedSessionRoot = !sessionRoot && path.basename(worktreePath) === "worktree"
    ? path.dirname(worktreePath)
    : "";
  const root = sessionRoot || derivedSessionRoot;
  return root ? path.join(root, "runtime", "self-target-system-root") : "";
}

function jskitSelfTargetPreviewProxyPortRange(launchPort = DEFAULT_LAUNCH_PORT) {
  const normalizedLaunchPort = normalizePort(launchPort);
  const portOffset = Math.max(0, normalizedLaunchPort - DEFAULT_LAUNCH_PORT);
  const lastStart = 65535 - JSKIT_SELF_TARGET_PREVIEW_PROXY_PORT_SPAN + 1;
  const start = Math.min(
    lastStart,
    JSKIT_SELF_TARGET_PREVIEW_PROXY_PORT_BASE +
      portOffset * JSKIT_SELF_TARGET_PREVIEW_PROXY_PORT_SPAN
  );
  const end = start + JSKIT_SELF_TARGET_PREVIEW_PROXY_PORT_SPAN - 1;
  return {
    end,
    start
  };
}

function jskitSelfTargetPreviewProxyDockerArgs({
  enabled = false,
  launchPort = DEFAULT_LAUNCH_PORT
} = {}) {
  if (!enabled) {
    return [];
  }
  const range = jskitSelfTargetPreviewProxyPortRange(launchPort);
  // Vibe64 self-targeting runs an inner Studio inside this launch container.
  // Publish the inner preview proxy range so browser iframe previews reach the
  // inner proxy, not the outer Studio proxy on its own loopback range.
  return [
    "-p",
    `127.0.0.1:${range.start}-${range.end}:${range.start}-${range.end}`,
    "-e",
    `${PREVIEW_PROXY_HOST_ENV}=0.0.0.0`,
    "-e",
    `${PREVIEW_PROXY_PUBLIC_HOST_ENV}=127.0.0.1`,
    "-e",
    `${PREVIEW_PROXY_PORT_START_ENV}=${range.start}`,
    "-e",
    `${PREVIEW_PROXY_PORT_END_ENV}=${range.end}`
  ];
}

function jskitSelfTargetRootConfig({
  enabled = false,
  launchPort = DEFAULT_LAUNCH_PORT,
  projectsRoot = "",
  systemRoot = ""
} = {}) {
  if (!enabled) {
    return {
      dockerArgs: [],
      enabled: false,
      projectsRoot: "",
      providerHomesRoot: "",
      systemRoot: ""
    };
  }

  const resolvedProjectsRoot = String(projectsRoot || "").trim()
    ? path.resolve(String(projectsRoot || ""))
    : resolveStudioProjectsRoot({
        env: process.env
      });
  const resolvedProviderHomesRoot = resolveProviderHomesRoot({
    env: process.env,
    projectsRoot: resolvedProjectsRoot
  });
  const resolvedSystemRoot = String(systemRoot || "").trim()
    ? path.resolve(String(systemRoot || ""))
    : "";

  return {
    dockerArgs: [
      ...studioDaemonDockerEnvArgs(),
      ...dockerRootEnvArgs(VIBE64_PROJECTS_ROOT_ENV, resolvedProjectsRoot),
      ...dockerRootEnvArgs(VIBE64_PROVIDER_HOMES_ROOT_ENV, resolvedProviderHomesRoot, {
        ensure: true
      }),
      ...dockerRootEnvArgs(VIBE64_SYSTEM_ROOT_ENV, resolvedSystemRoot, {
        ensure: true
      }),
      ...(resolvedSystemRoot
        ? [
            "-e",
            `${VIBE64_SELF_TARGET_SYSTEM_ROOT_ENV}=1`
          ]
        : []),
      ...jskitSelfTargetPreviewProxyDockerArgs({
        enabled,
        launchPort
      })
    ],
    enabled: true,
    previewProxyPortRange: jskitSelfTargetPreviewProxyPortRange(launchPort),
    projectsRoot: resolvedProjectsRoot,
    providerHomesRoot: resolvedProviderHomesRoot,
    systemRoot: resolvedSystemRoot
  };
}

function jskitSelfTargetDockerArgs(config = {}) {
  return Array.isArray(config?.dockerArgs) ? config.dockerArgs : [];
}

function jskitSelfTargetMetadata(config = {}) {
  if (config?.enabled !== true) {
    return {};
  }
  return {
    vibe64SelfTarget: "Vibe64 self-target: shared projects and provider homes with isolated Studio state",
    vibe64SelfTargetPreviewProxyPortRange: `${config.previewProxyPortRange.start}-${config.previewProxyPortRange.end}`,
    vibe64SelfTargetProjectsRoot: config.projectsRoot,
    vibe64SelfTargetProviderHomesRoot: config.providerHomesRoot,
    vibe64SelfTargetSystemRoot: config.systemRoot
  };
}

function normalizePort(value) {
  const port = Number.parseInt(String(value || ""), 10);
  return Number.isInteger(port) && port >= 1024 && port <= 65535
    ? port
    : DEFAULT_LAUNCH_PORT;
}

async function resolveBuiltLaunchConfig(worktreePath, {
  targetRoot = ""
} = {}) {
  const [configuredBuiltCommand, hostDocker, migrationCommand, portValue] = await Promise.all([
    readOptionalConfigFile(worktreePath, BUILT_LAUNCH_COMMAND_CONFIG, ""),
    resolveHostDockerConfig({
      targetRoot,
      worktreePath
    }),
    resolveMigrationCommand(worktreePath),
    readOptionalConfigFile(worktreePath, BUILT_LAUNCH_PORT_CONFIG, String(DEFAULT_LAUNCH_PORT))
  ]);
  if (configuredBuiltCommand) {
    return {
      buildCommand: "",
      commandSource: BUILT_LAUNCH_COMMAND_CONFIG,
      hostDocker: hostDocker.enabled,
      hostDockerSource: hostDocker.source,
      migrationCommand,
      preferredPort: normalizePort(portValue),
      runtimeNamespace: hostDocker.runtimeNamespace,
      serverCommand: "",
      testrunCommand: configuredBuiltCommand
    };
  }

  const [buildCommand, serverCommand] = await Promise.all([
    readOptionalConfigFile(worktreePath, "config/build_command", DEFAULT_BUILT_LAUNCH_BUILD_COMMAND),
    readOptionalConfigFile(worktreePath, "config/server_command", DEFAULT_BUILT_LAUNCH_SERVER_COMMAND)
  ]);
  return {
    buildCommand,
    commandSource: "default_build_and_server_commands",
    hostDocker: hostDocker.enabled,
    hostDockerSource: hostDocker.source,
    migrationCommand,
    preferredPort: normalizePort(portValue),
    runtimeNamespace: hostDocker.runtimeNamespace,
    serverCommand,
    testrunCommand: `${buildCommand} && ${serverCommand}`
  };
}

async function resolveDevLaunchConfig(worktreePath, {
  targetRoot = ""
} = {}) {
  const [devCommand, backendCommand, hostDocker, migrationCommand, portValue] = await Promise.all([
    readOptionalConfigFile(worktreePath, DEV_SERVER_COMMAND_CONFIG, ""),
    readOptionalConfigFile(worktreePath, "config/server_command", DEFAULT_DEV_BACKEND_COMMAND),
    resolveHostDockerConfig({
      targetRoot,
      worktreePath
    }),
    resolveMigrationCommand(worktreePath),
    readOptionalConfigFile(worktreePath, BUILT_LAUNCH_PORT_CONFIG, String(DEFAULT_LAUNCH_PORT))
  ]);
  return {
    commandSource: devCommand ? DEV_SERVER_COMMAND_CONFIG : "package_json_dev_script",
    backendCommand,
    backendPort: DEFAULT_DEV_BACKEND_PORT,
    frontendCommand: devCommand || DEFAULT_DEV_FRONTEND_COMMAND,
    hostDocker: hostDocker.enabled,
    hostDockerSource: hostDocker.source,
    migrationCommand,
    preferredPort: normalizePort(portValue),
    runtimeNamespace: hostDocker.runtimeNamespace
  };
}

async function defaultAppPath(worktreePath) {
  try {
    const appConfig = await loadAppConfigFromAppRoot({
      appRoot: worktreePath
    });
    const surfaceDefaultId = String(appConfig?.surfaceDefaultId || "").trim().replace(/^\/+/u, "");
    return surfaceDefaultId ? `/${surfaceDefaultId}` : "/";
  } catch {
    return "/";
  }
}

function jskitLaunchTarget(id, label) {
  return {
    defaultDisplay: "minimized",
    id,
    label
  };
}

function jskitLaunchTargetWithPreviewOptions(id, label) {
  return launchTargetWithStartupArgsOption(jskitLaunchTarget(id, label));
}

function jskitDependenciesReady(session = {}) {
  return String(session.metadata?.dependencies_installed || "").trim().toLowerCase() === "yes";
}

function markLaunchTargetDependencyBlocked(launchTarget) {
  return {
    ...launchTarget,
    available: false,
    disabledReason: "Install dependencies before running the app."
  };
}

function createJskitDevCommand({
  backendCommand = DEFAULT_DEV_BACKEND_COMMAND,
  backendPort = DEFAULT_DEV_BACKEND_PORT,
  frontendCommand = DEFAULT_DEV_FRONTEND_COMMAND,
  migrationCommand = "",
  previewAuthProfileCommand = createJskitPreviewAuthProfileCommand(),
  previewAuthProfileLabel = "Preparing preview auth user.",
  startupArgs = []
} = {}) {
  const backendCommandWithArgs = commandWithStartupArgs(backendCommand, startupArgs, {
    separator: "--"
  });
  return [
    "set -e",
    `export VIBE64_JSKIT_BACKEND_PORT=${shellQuotedNumber(backendPort)}`,
    ...(migrationCommand
      ? [
          "printf '\\n[studio] Applying database migrations.\\n'",
          migrationCommand
        ]
      : []),
    `printf '\\n[studio] ${previewAuthProfileLabel.replaceAll("'", "'\\''")}\\n'`,
    previewAuthProfileCommand,
    "cleanup_vibe64_jskit_dev() {",
    "  kill \"$vibe64_jskit_backend_pid\" \"$vibe64_jskit_frontend_pid\" 2>/dev/null || true",
    "}",
    "trap cleanup_vibe64_jskit_dev EXIT INT TERM",
    `(export PORT="$VIBE64_JSKIT_BACKEND_PORT"; ${backendCommandWithArgs}) &`,
    "vibe64_jskit_backend_pid=$!",
    tcpReadinessProbeCommand({
      marker: "[studio] JSKIT backend is ready.",
      port: backendPort
    }),
    `(export VITE_API_PROXY_TARGET="http://127.0.0.1:$VIBE64_JSKIT_BACKEND_PORT"; ${frontendCommand}) &`,
    "vibe64_jskit_frontend_pid=$!",
    "while kill -0 \"$vibe64_jskit_backend_pid\" 2>/dev/null && kill -0 \"$vibe64_jskit_frontend_pid\" 2>/dev/null; do",
    "  sleep 1",
    "done",
    "cleanup_vibe64_jskit_dev",
    "wait \"$vibe64_jskit_backend_pid\" \"$vibe64_jskit_frontend_pid\""
  ].join("\n");
}

function shellQuotedNumber(value) {
  return JSON.stringify(String(value));
}

async function listJskitLaunchTargets({
  session = {}
} = {}) {
  const worktreePath = sessionWorktreePath(session);
  if (!worktreePath) {
    return [];
  }

  const [
    scripts,
    hasTestrunCommand,
    hasBuildCommandConfig,
    hasServerCommandConfig,
    hasDevCommandConfig
  ] = await Promise.all([
    readPackageJsonScripts(worktreePath),
    configFileHasValue(worktreePath, BUILT_LAUNCH_COMMAND_CONFIG),
    configFileHasValue(worktreePath, "config/build_command"),
    configFileHasValue(worktreePath, "config/server_command"),
    configFileHasValue(worktreePath, DEV_SERVER_COMMAND_CONFIG)
  ]);

  const launchTargets = [];
  if (hasTestrunCommand || (hasBuildCommandConfig && hasServerCommandConfig) || (scripts.build && scripts.server)) {
    launchTargets.push(jskitLaunchTargetWithPreviewOptions("built", "Run built app"));
  }
  if ((hasDevCommandConfig || scripts.dev) && (hasServerCommandConfig || scripts.server)) {
    launchTargets.push(jskitLaunchTargetWithPreviewOptions("dev", "Run app"));
  }
  return jskitDependenciesReady(session)
    ? launchTargets
    : launchTargets.map(markLaunchTargetDependencyBlocked);
}

async function createJskitBuiltLaunchDescriptor({
  config,
  databaseHost = "",
  launchInput = {},
  selfTarget = null,
  vibe64User = null,
  workdir = "",
  worktreePath = ""
} = {}) {
  const startupArgs = startupArgsFromLaunchInput(launchInput);
  const migrationCommand = config.migrationCommand
    ? {
        command: config.migrationCommand,
        label: "Applying database migrations.",
        networkEnv: true
      }
    : null;
  const previewAuthKind = selfTarget?.enabled === true
    ? VIBE64_SELF_PREVIEW_AUTH_KIND
    : JSKIT_PREVIEW_AUTH_KIND;
  const previewAuthProfileCommand = {
    command: selfTarget?.enabled === true
      ? createVibe64SelfPreviewAuthProfileCommand({
          vibe64User
        })
      : createJskitPreviewAuthProfileCommand({
          vibe64User
        }),
    label: selfTarget?.enabled === true
      ? "Preparing Vibe64 self preview auth session."
      : "Preparing preview auth user.",
    networkEnv: true
  };

  return {
    commands: config.buildCommand || config.serverCommand
      ? [
          config.buildCommand
            ? {
                command: config.buildCommand,
                label: "Building JSKIT app.",
                networkEnv: false
              }
            : null,
          migrationCommand,
          previewAuthProfileCommand,
          config.serverCommand
            ? {
                command: commandWithStartupArgs(config.serverCommand, startupArgs, {
                  separator: "--"
                }),
                label: "Starting JSKIT app server.",
                networkEnv: true
              }
            : null
        ].filter(Boolean)
      : [
          migrationCommand,
          previewAuthProfileCommand,
          {
            command: commandWithStartupArgs(config.testrunCommand, startupArgs, {
              separator: "--"
            }),
            label: "Starting JSKIT built app.",
            networkEnv: true
          }
        ].filter(Boolean),
    extraDockerArgs: [
      ...runtimeNamespaceDockerArgs(config.runtimeNamespace),
      ...jskitSelfTargetDockerArgs(selfTarget)
    ],
    hostDocker: config.hostDocker,
    metadata: {
      buildCommand: config.buildCommand,
      commandSource: config.commandSource,
      databaseHost,
      hostDocker: config.hostDocker,
      hostDockerSource: config.hostDockerSource,
      migrationCommand: config.migrationCommand,
      runtimeNamespace: config.runtimeNamespace,
      previewAuthProfileCommand: "enabled",
      serverCommand: config.serverCommand,
      testrunCommand: config.testrunCommand,
      ...jskitSelfTargetMetadata(selfTarget)
    },
    previewAuth: previewAuthKind,
    urlPath: await defaultAppPath(worktreePath),
    ...(workdir ? { workdir } : {})
  };
}

async function createJskitDevLaunchDescriptor({
  config,
  databaseHost = "",
  launchInput = {},
  selfTarget = null,
  vibe64User = null,
  workdir = "",
  worktreePath = ""
} = {}) {
  const startupArgs = startupArgsFromLaunchInput(launchInput);
  const previewAuthKind = selfTarget?.enabled === true
    ? VIBE64_SELF_PREVIEW_AUTH_KIND
    : JSKIT_PREVIEW_AUTH_KIND;
  return {
    command: createJskitDevCommand({
      backendCommand: config.backendCommand,
      backendPort: config.backendPort,
      frontendCommand: config.frontendCommand,
      migrationCommand: config.migrationCommand,
      previewAuthProfileCommand: selfTarget?.enabled === true
        ? createVibe64SelfPreviewAuthProfileCommand({
            vibe64User
          })
        : createJskitPreviewAuthProfileCommand({
            vibe64User
          }),
      previewAuthProfileLabel: selfTarget?.enabled === true
        ? "Preparing Vibe64 self preview auth session."
        : "Preparing preview auth user.",
      startupArgs
    }),
    extraDockerArgs: [
      ...runtimeNamespaceDockerArgs(config.runtimeNamespace),
      ...jskitSelfTargetDockerArgs(selfTarget)
    ],
    hostDocker: config.hostDocker,
    metadata: {
      backendCommand: config.backendCommand,
      backendPort: config.backendPort,
      commandSource: config.commandSource,
      databaseHost,
      frontendCommand: config.frontendCommand,
      hostDocker: config.hostDocker,
      hostDockerSource: config.hostDockerSource,
      migrationCommand: config.migrationCommand,
      mode: "dev",
      runtimeNamespace: config.runtimeNamespace,
      previewAuthProfileCommand: "enabled",
      ...jskitSelfTargetMetadata(selfTarget)
    },
    previewAuth: previewAuthKind,
    urlPath: await defaultAppPath(worktreePath),
    ...(workdir ? { workdir } : {})
  };
}

async function createJskitLaunchTargetTerminalSpec({
  context = {},
  launchInput = {},
  launchTargetId = "",
  session = {},
  targetRoot = ""
} = {}) {
  if (!["built", "dev"].includes(launchTargetId)) {
    return {
      ok: false,
      message: `Unknown JSKIT launch target: ${launchTargetId || "(empty)"}.`
    };
  }
  const launchTarget = context.launchTarget || jskitLaunchTargetWithPreviewOptions(launchTargetId, launchTargetId, {
    config: context.config || {}
  });
  const worktreePath = sessionWorktreePath(session);
  if (!worktreePath) {
    return {
      ok: false,
      message: "Create the worktree before running the app."
    };
  }
  if (!jskitDependenciesReady(session)) {
    return {
      ok: false,
      message: "Install dependencies before running the app."
    };
  }
  const availableLaunchTargets = await listJskitLaunchTargets({
    config: context.config || {},
    session
  });
  if (!availableLaunchTargets.some((availableTarget) => availableTarget.id === launchTargetId)) {
    return {
      ok: false,
      message: `JSKIT launch target ${launchTargetId} is not configured.`
    };
  }

  const launchTargetRoot = targetRoot || session.targetRoot || "";
  const selfTargetCodeRoot = await isJskitSelfTargetRoot(launchTargetRoot)
    ? launchTargetRoot
    : "";
  const launchConfigRoot = selfTargetCodeRoot || worktreePath;
  const [databaseHost, config] = await Promise.all([
    readDatabaseHostFromDotEnv(launchConfigRoot),
    launchTargetId === "dev"
      ? resolveDevLaunchConfig(launchConfigRoot, {
          targetRoot: launchTargetRoot
        })
      : resolveBuiltLaunchConfig(launchConfigRoot, {
          targetRoot: launchTargetRoot
        })
  ]);
  const descriptorFactory = launchTargetId === "dev"
    ? createJskitDevLaunchDescriptor
    : createJskitBuiltLaunchDescriptor;
  return createVibe64WebLaunchTargetTerminalSpec({
    adapterId: "jskit",
    image: JSKIT_TOOLCHAIN_IMAGE,
    launchTarget,
    preferredPort: config.preferredPort,
    resolveLaunch: ({
      port,
      worktreePath: launchWorktreePath
    }) => {
      const descriptorWorktreePath = selfTargetCodeRoot || launchWorktreePath;
      // Vibe64 self-targeting is special: the inner Studio needs the same project
      // list, provider credentials, runtime namespace, and host-reachable preview
      // proxy range. Run the selected checkout as the inner Studio code, while
      // keeping VIBE64_SYSTEM_ROOT session-private for auth, sessions, and
      // terminal runtime state.
      const selfTarget = jskitSelfTargetRootConfig({
        enabled: config.hostDocker,
        launchPort: port,
        projectsRoot: context.projectsRoot || "",
        systemRoot: jskitSelfTargetSystemRoot({
          session,
          worktreePath: launchWorktreePath
        })
      });
      return descriptorFactory({
        config,
        databaseHost,
        launchInput,
        selfTarget,
        targetRoot: launchTargetRoot,
        vibe64User: context.vibe64User || null,
        workdir: selfTargetCodeRoot,
        worktreePath: descriptorWorktreePath
      });
    },
    session,
    targetRoot: launchTargetRoot
  });
}

export {
  createJskitLaunchTargetTerminalSpec,
  createJskitBuiltLaunchDescriptor,
  createJskitDevLaunchDescriptor,
  listJskitLaunchTargets,
  BUILT_LAUNCH_COMMAND_CONFIG,
  BUILT_LAUNCH_PORT_CONFIG,
  DEV_SERVER_COMMAND_CONFIG
};
