import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadAppConfigFromAppRoot } from "@jskit-ai/kernel/server/support";
import {
  sessionWorktreePath
} from "@local/vibe64-core/server/sessionWorktreePath";
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
  JSKIT_ALLOW_SELF_TARGET_CONFIG
} from "./adapter.js";
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
  const [{ default: createKnex }, knexfileModule] = await Promise.all([
    import("knex"),
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

function resolveHostDockerConfig(config = {}) {
  const enabled = config?.values?.[JSKIT_ALLOW_SELF_TARGET_CONFIG] === true;
  return {
    enabled,
    source: enabled ? JSKIT_ALLOW_SELF_TARGET_CONFIG : ""
  };
}

function normalizePort(value) {
  const port = Number.parseInt(String(value || ""), 10);
  return Number.isInteger(port) && port >= 1024 && port <= 65535
    ? port
    : DEFAULT_LAUNCH_PORT;
}

async function resolveBuiltLaunchConfig(worktreePath, {
  adapterConfig = {}
} = {}) {
  const [configuredBuiltCommand, hostDocker, migrationCommand, portValue] = await Promise.all([
    readOptionalConfigFile(worktreePath, BUILT_LAUNCH_COMMAND_CONFIG, ""),
    resolveHostDockerConfig(adapterConfig),
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
    serverCommand,
    testrunCommand: `${buildCommand} && ${serverCommand}`
  };
}

async function resolveDevLaunchConfig(worktreePath, {
  adapterConfig = {}
} = {}) {
  const [devCommand, backendCommand, hostDocker, migrationCommand, portValue] = await Promise.all([
    readOptionalConfigFile(worktreePath, DEV_SERVER_COMMAND_CONFIG, ""),
    readOptionalConfigFile(worktreePath, "config/server_command", DEFAULT_DEV_BACKEND_COMMAND),
    resolveHostDockerConfig(adapterConfig),
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
    preferredPort: normalizePort(portValue)
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
  previewAuthProfileCommand = createJskitPreviewAuthProfileCommand()
} = {}) {
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
    `(export PORT="$VIBE64_JSKIT_BACKEND_PORT"; ${backendCommand}) &`,
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
    launchTargets.push(jskitLaunchTarget("built", "Run built app"));
  }
  if ((hasDevCommandConfig || scripts.dev) && (hasServerCommandConfig || scripts.server)) {
    launchTargets.push(jskitLaunchTarget("dev", "Run app"));
  }
  return jskitDependenciesReady(session)
    ? launchTargets
    : launchTargets.map(markLaunchTargetDependencyBlocked);
}

async function createJskitBuiltLaunchDescriptor({
  config,
  databaseHost = "",
  worktreePath = ""
} = {}) {
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
                command: config.serverCommand,
                label: "Starting JSKIT app server.",
                networkEnv: true
              }
            : null
        ].filter(Boolean)
      : [
          migrationCommand,
          previewAuthProfileCommand,
          {
            command: config.testrunCommand,
            label: "Starting JSKIT built app.",
            networkEnv: true
          }
        ].filter(Boolean),
    hostDocker: config.hostDocker,
    metadata: {
      buildCommand: config.buildCommand,
      commandSource: config.commandSource,
      databaseHost,
      hostDocker: config.hostDocker,
      hostDockerSource: config.hostDockerSource,
      migrationCommand: config.migrationCommand,
      previewAuthProfileCommand: "enabled",
      serverCommand: config.serverCommand,
      testrunCommand: config.testrunCommand
    },
    previewAuth: JSKIT_PREVIEW_AUTH_KIND,
    urlPath: await defaultAppPath(worktreePath)
  };
}

async function createJskitDevLaunchDescriptor({
  config,
  databaseHost = "",
  worktreePath = ""
} = {}) {
  return {
    command: createJskitDevCommand({
      backendCommand: config.backendCommand,
      backendPort: config.backendPort,
      frontendCommand: config.frontendCommand,
      migrationCommand: config.migrationCommand,
      previewAuthProfileCommand: createJskitPreviewAuthProfileCommand()
    }),
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
      previewAuthProfileCommand: "enabled"
    },
    previewAuth: JSKIT_PREVIEW_AUTH_KIND,
    urlPath: await defaultAppPath(worktreePath)
  };
}

async function createJskitLaunchTargetTerminalSpec({
  context = {},
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
  const launchTarget = context.launchTarget || jskitLaunchTarget(launchTargetId, launchTargetId);
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
    session
  });
  if (!availableLaunchTargets.some((availableTarget) => availableTarget.id === launchTargetId)) {
    return {
      ok: false,
      message: `JSKIT launch target ${launchTargetId} is not configured.`
    };
  }

  const launchTargetRoot = targetRoot || session.targetRoot || "";
  const adapterConfig = context.config || {};
  const [databaseHost, config] = await Promise.all([
    readDatabaseHostFromDotEnv(worktreePath),
    launchTargetId === "dev"
      ? resolveDevLaunchConfig(worktreePath, {
          adapterConfig
        })
      : resolveBuiltLaunchConfig(worktreePath, {
          adapterConfig
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
    resolveLaunch: ({ worktreePath: launchWorktreePath }) => descriptorFactory({
      config,
      databaseHost,
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
