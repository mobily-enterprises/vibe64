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
  resolveStudioProjectsRoot
} from "@local/vibe64-core/server/studioProjectContext";
import {
  JSKIT_PREVIEW_AUTH_KIND,
  PREVIEW_AUTH_PROFILE
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
  runtimeNamespace
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
const BUILT_LAUNCH_COMMAND_CONFIG = ".jskit/config/testrun_command";
const BUILT_LAUNCH_PORT_CONFIG = ".jskit/config/server_port_for_user_review";
const DEV_SERVER_COMMAND_CONFIG = "config/dev_server_command";
const MIGRATION_SCRIPT_NAME = "db:migrate";

function createJskitPreviewAuthProfileCommand() {
  const script = `
const profileFile = String(process.env.VIBE64_PREVIEW_AUTH_PROFILE_FILE || "").trim();
const profile = ${JSON.stringify(PREVIEW_AUTH_PROFILE)};

function isDuplicateError(error) {
  return ["23505", "ER_DUP_ENTRY", "SQLITE_CONSTRAINT", "SQLITE_CONSTRAINT_UNIQUE"].includes(String(error?.code || "")) ||
    Number(error?.errno) === 1062;
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
    const findByIdentity = () => db("users")
      .where({
        auth_provider: record.auth_provider,
        auth_provider_user_sid: record.auth_provider_user_sid
      })
      .first();
    let user = await findByIdentity();
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
    await fs.mkdir(path.dirname(profileFile), {
      recursive: true
    });
    await fs.writeFile(profileFile, JSON.stringify({
      authProvider: record.auth_provider,
      authProviderUserSid: record.auth_provider_user_sid,
      displayName: record.display_name,
      email: record.email,
      id: String(user.id || ""),
      username: record.username
    }, null, 2) + "\\n", "utf8");
    console.log(\`[studio] Preview auth user is ready: \${record.email} (\${user.id}).\`);
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

function jskitSelfTargetRootConfig({
  enabled = false,
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
        : [])
    ],
    enabled: true,
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
    "printf '\\n[studio] Preparing preview auth user.\\n'",
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
  const previewAuthProfileCommand = {
    command: createJskitPreviewAuthProfileCommand(),
    label: "Preparing preview auth user.",
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
    previewAuth: JSKIT_PREVIEW_AUTH_KIND,
    urlPath: await defaultAppPath(worktreePath)
  };
}

async function createJskitDevLaunchDescriptor({
  config,
  databaseHost = "",
  launchInput = {},
  selfTarget = null,
  worktreePath = ""
} = {}) {
  const startupArgs = startupArgsFromLaunchInput(launchInput);
  return {
    command: createJskitDevCommand({
      backendCommand: config.backendCommand,
      backendPort: config.backendPort,
      frontendCommand: config.frontendCommand,
      migrationCommand: config.migrationCommand,
      previewAuthProfileCommand: createJskitPreviewAuthProfileCommand(),
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
    previewAuth: JSKIT_PREVIEW_AUTH_KIND,
    urlPath: await defaultAppPath(worktreePath)
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
  const [databaseHost, config] = await Promise.all([
    readDatabaseHostFromDotEnv(worktreePath),
    launchTargetId === "dev"
      ? resolveDevLaunchConfig(worktreePath, {
          targetRoot: launchTargetRoot
        })
      : resolveBuiltLaunchConfig(worktreePath, {
          targetRoot: launchTargetRoot
        })
  ]);
  const descriptorFactory = launchTargetId === "dev"
    ? createJskitDevLaunchDescriptor
    : createJskitBuiltLaunchDescriptor;
  // Vibe64 self-targeting is special: the inner Studio needs the same project
  // list, provider credentials, and runtime namespace. Keep VIBE64_SYSTEM_ROOT
  // session-private because it owns auth cookies, session stores, and terminal
  // runtime state.
  const selfTarget = jskitSelfTargetRootConfig({
    enabled: config.hostDocker,
    projectsRoot: context.projectsRoot || "",
    systemRoot: jskitSelfTargetSystemRoot({
      session,
      worktreePath
    })
  });

  return createVibe64WebLaunchTargetTerminalSpec({
    adapterId: "jskit",
    image: JSKIT_TOOLCHAIN_IMAGE,
    launchTarget,
    preferredPort: config.preferredPort,
    resolveLaunch: ({ worktreePath: launchWorktreePath }) => descriptorFactory({
      config,
      databaseHost,
      launchInput,
      selfTarget,
      targetRoot: launchTargetRoot,
      worktreePath: launchWorktreePath
    }),
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
