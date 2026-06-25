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
  STUDIO_TOOL_HOME_PATH,
  runtimeNamespace,
  studioDaemonDockerEnvArgs
} from "@local/studio-terminal-core/server/studioRuntimeIdentity";
import {
  studioToolHomeVolumeDockerArgs
} from "@local/studio-terminal-core/server/studioToolHome";
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
const JSKIT_SELF_TARGET_CODEX_HOME = path.posix.join(STUDIO_TOOL_HOME_PATH, ".codex");
const VIBE64_REPRO_SELF_TARGET_AUTO_SELECT_PROJECT_ENV = "VIBE64_REPRO_SELF_TARGET_AUTO_SELECT_PROJECT";
const BUILT_LAUNCH_COMMAND_CONFIG = ".jskit/config/testrun_command";
const BUILT_LAUNCH_PORT_CONFIG = ".jskit/config/server_port_for_user_review";
const DEV_SERVER_COMMAND_CONFIG = "config/dev_server_command";
const MIGRATION_SCRIPT_NAME = "db:migrate";
const AGENT_RUNS_DIR_NAME = "agent-runs";
const JSKIT_LAUNCH_RESTART_COMMON_FILES = Object.freeze([
  ".env",
  ".env.*",
  ".jskit/config/**",
  "bun.lockb",
  "config/server_command",
  "config/dev_server_command",
  "config/migration_command",
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "server.js",
  "yarn.lock"
]);
const JSKIT_DEV_RESTART_ON_CHANGE = Object.freeze({
  label: "server-side JSKIT files",
  reason: "server_source_changed",
  include: Object.freeze([
    ...JSKIT_LAUNCH_RESTART_COMMON_FILES,
    "api/**",
    "database/**",
    "db/**",
    "migrations/**",
    "routes/**",
    "server/**",
    "src/**/*.server.js",
    "src/**/*.server.ts",
    "src/**/actions/**",
    "src/**/commands/**",
    "src/**/database/**",
    "src/**/migrations/**",
    "src/**/providers/**",
    "src/**/repositories/**",
    "src/**/resources/**",
    "src/**/routes/**",
    "src/**/server/**",
    "src/**/services/**",
    "src/server/**",
    "packages/**/package.descriptor.mjs",
    "packages/**/server/**",
    "packages/**/src/**/*.server.js",
    "packages/**/src/**/*.server.ts",
    "packages/**/src/**/repositories/**",
    "packages/**/src/**/resources/**",
    "packages/**/src/**/server/**",
    "packages/**/src/**/services/**",
    "packages/**/src/server/**",
    "packages/**/src/shared/**"
  ]),
  exclude: Object.freeze([
    "node_modules/**",
    ".git/**",
    ".vibe64-local/**"
  ])
});
const JSKIT_BUILT_RESTART_ON_CHANGE = Object.freeze({
  label: "built JSKIT app files",
  reason: "server_source_changed",
  include: Object.freeze([
    ...JSKIT_LAUNCH_RESTART_COMMON_FILES,
    "api/**",
    "config/**",
    "database/**",
    "db/**",
    "migrations/**",
    "packages/**",
    "routes/**",
    "server/**",
    "src/**"
  ]),
  exclude: Object.freeze([
    "dist/**",
    "node_modules/**",
    ".git/**",
    ".vibe64-local/**"
  ])
});

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

function jskitPreviewUserEnvironmentCommandPrefix(vibe64User = null) {
  const profile = previewAuthProfileSeed(vibe64User);
  const env = {
    JSKIT_PREVIEW_AUTH_PROVIDER: profile.authProvider,
    JSKIT_PREVIEW_AUTH_PROVIDER_USER_SID: profile.authProviderUserSid,
    JSKIT_PREVIEW_USER_DISPLAY_NAME: profile.displayName,
    JSKIT_PREVIEW_USER_EMAIL: profile.email,
    JSKIT_PREVIEW_USER_USERNAME: profile.username
  };
  return Object.entries(env)
    .filter(([, value]) => String(value || "").trim())
    .map(([key, value]) => `${key}=${shellQuote(value)}`)
    .join(" ");
}

function createJskitPreviewAuthProfileCommand({
  vibe64User = null
} = {}) {
  const envPrefix = jskitPreviewUserEnvironmentCommandPrefix(vibe64User);
  return [
    envPrefix,
    "npx",
    "--no-install",
    "jskit",
    "app",
    "prepare-preview-user",
    "--ensure-workspace"
  ].filter(Boolean).join(" ");
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

function createVibe64SelfTargetRuntimeNetworksCommand() {
  const script = `
const projectsRoot = String(process.env.VIBE64_PROJECTS_ROOT || "").trim();

async function main() {
  const { createStudioProjectContext } = await import("@local/vibe64-core/server/studioProjectContext");
  const { ensureCurrentContainerConnectedToRuntimeNetwork } = await import("@local/studio-terminal-core/server/runtimeContainers");

  if (!projectsRoot) {
    console.log("[studio] Vibe64 self preview project networks skipped: VIBE64_PROJECTS_ROOT is not set.");
    return;
  }

  const projectContext = createStudioProjectContext({
    explicitProjectsRoot: projectsRoot
  });
  const listed = await projectContext.listWorkspaceProjects();
  const projects = Array.isArray(listed?.projects) ? listed.projects : [];
  if (projects.length === 0) {
    console.log("[studio] Vibe64 self preview project networks skipped: no workspace projects found.");
    return;
  }

  let readyCount = 0;
  for (const project of projects) {
    const projectRoot = String(project?.projectRoot || "").trim();
    const slug = String(project?.slug || "").trim() || projectRoot;
    if (!projectRoot) {
      continue;
    }
    const result = await ensureCurrentContainerConnectedToRuntimeNetwork(projectRoot);
    if (result?.reason === "not_container") {
      console.log("[studio] Vibe64 self preview project networks skipped: not running in Docker.");
      return;
    }
    readyCount += 1;
    console.log(\`[studio] Vibe64 self preview project network is ready: \${slug}\${result?.networkName ? \` (\${result.networkName})\` : ""}.\`);
  }

  console.log(\`[studio] Vibe64 self preview project networks are ready: \${readyCount}/\${projects.length}.\`);
}

main().catch((error) => {
  console.error(\`[studio] Vibe64 self preview project networks failed: \${String(error?.message || error)}\`);
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

function jskitSelfTargetReproDockerArgs(env = process.env) {
  const slug = String(env?.[VIBE64_REPRO_SELF_TARGET_AUTO_SELECT_PROJECT_ENV] || "").trim();
  return slug
    ? [
        "-e",
        `${VIBE64_REPRO_SELF_TARGET_AUTO_SELECT_PROJECT_ENV}=${slug}`
      ]
    : [];
}

function jskitSelfTargetCodexDockerArgs() {
  return [
    ...studioToolHomeVolumeDockerArgs(),
    "-e",
    `CODEX_HOME=${JSKIT_SELF_TARGET_CODEX_HOME}`
  ];
}

function jskitSelfTargetRootConfig({
  enabled = false,
  launchPort = DEFAULT_LAUNCH_PORT,
  projectsRoot = "",
  runtimeNamespace: runtimeNamespaceValue = runtimeNamespace(),
  systemRoot = ""
} = {}) {
  if (!enabled) {
    return {
      dockerArgs: [],
      enabled: false,
      projectsRoot: "",
      providerHomesRoot: "",
      runtimeNamespace: "",
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
      ...jskitSelfTargetCodexDockerArgs(),
      ...dockerRootEnvArgs(VIBE64_SYSTEM_ROOT_ENV, resolvedSystemRoot, {
        ensure: true
      }),
      ...(resolvedSystemRoot
        ? [
            "-e",
            `${VIBE64_SELF_TARGET_SYSTEM_ROOT_ENV}=1`
          ]
        : []),
      ...jskitSelfTargetReproDockerArgs(process.env),
      ...jskitSelfTargetPreviewProxyDockerArgs({
        enabled,
        launchPort
      })
    ],
    enabled: true,
    previewProxyPortRange: jskitSelfTargetPreviewProxyPortRange(launchPort),
    projectsRoot: resolvedProjectsRoot,
    providerHomesRoot: resolvedProviderHomesRoot,
    runtimeNamespace: String(runtimeNamespaceValue || "").trim(),
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
    vibe64SelfTargetRuntimeNamespace: config.runtimeNamespace,
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

async function launchDescriptorUrlPath(worktreePath, {
  selfTarget = null
} = {}) {
  return selfTarget?.enabled === true
    ? "/app"
    : await defaultAppPath(worktreePath);
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
  agentRunsRoot = "",
  backendCommand = DEFAULT_DEV_BACKEND_COMMAND,
  backendPort = DEFAULT_DEV_BACKEND_PORT,
  frontendCommand = DEFAULT_DEV_FRONTEND_COMMAND,
  migrationCommand = "",
  previewAuthProfileCommand = createJskitPreviewAuthProfileCommand(),
  previewAuthProfileLabel = "Preparing preview auth user.",
  selfTargetRuntimeNetworksCommand = "",
  startupArgs = []
} = {}) {
  const backendCommandWithArgs = commandWithStartupArgs(backendCommand, startupArgs, {
    separator: "--"
  });
  return [
    "set -e",
    `export VIBE64_JSKIT_BACKEND_PORT=${shellQuotedNumber(backendPort)}`,
    "vibe64_jskit_frontend_pid=\"\"",
    "vibe64_jskit_frontend_pause_pid=\"\"",
    `vibe64_jskit_agent_runs_root=${shellQuote(agentRunsRoot)}`,
    ...jskitFrontendPauseControlLines(),
    ...(selfTargetRuntimeNetworksCommand
      ? [
          "printf '\\n[studio] Preparing Vibe64 self preview project networks.\\n'",
          selfTargetRuntimeNetworksCommand
        ]
      : []),
    ...(migrationCommand
      ? [
          "printf '\\n[studio] Applying database migrations.\\n'",
          migrationCommand
        ]
      : []),
    `printf '\\n[studio] ${previewAuthProfileLabel.replaceAll("'", "'\\''")}\\n'`,
    previewAuthProfileCommand,
    "cleanup_vibe64_jskit_dev() {",
    "  if [ -n \"${vibe64_jskit_frontend_pause_pid:-}\" ]; then",
    "    kill \"$vibe64_jskit_frontend_pause_pid\" 2>/dev/null || true",
    "  fi",
    "  vibe64_jskit_frontend_signal CONT",
    "  vibe64_jskit_frontend_signal TERM",
    "  kill \"$vibe64_jskit_backend_pid\" 2>/dev/null || true",
    "}",
    "trap cleanup_vibe64_jskit_dev EXIT INT TERM",
    `(export PORT="$VIBE64_JSKIT_BACKEND_PORT"; ${backendCommandWithArgs}) &`,
    "vibe64_jskit_backend_pid=$!",
    tcpReadinessProbeCommand({
      marker: "[studio] JSKIT backend is ready.",
      port: backendPort
    }),
    jskitFrontendStartCommand(frontendCommand),
    "vibe64_jskit_frontend_pid=$!",
    jskitFrontendPortReadinessProbeCommand(),
    "if [ -n \"$vibe64_jskit_agent_runs_root\" ]; then",
    "  vibe64_jskit_watch_agent_pause &",
    "  vibe64_jskit_frontend_pause_pid=$!",
    "fi",
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

function jskitAgentRunsRoot(session = {}) {
  const sessionRoot = String(session.sessionRoot || "").trim();
  return sessionRoot ? path.join(sessionRoot, AGENT_RUNS_DIR_NAME) : "";
}

function jskitFrontendPortReadinessProbeCommand() {
  const script = [
    "const net = require('node:net');",
    "const port = Number(process.env.PORT);",
    "const timeoutMs = 90000;",
    "const deadline = Date.now() + timeoutMs;",
    "function retry() {",
    "  if (Date.now() >= deadline) {",
    "    console.error(`[studio] JSKIT frontend did not become ready on 127.0.0.1:${port}.`);",
    "    process.exit(1);",
    "  }",
    "  setTimeout(probe, 250);",
    "}",
    "function probe() {",
    "  const socket = net.connect({ host: '127.0.0.1', port });",
    "  socket.setTimeout(1000);",
    "  socket.once('connect', () => { socket.end(); console.log('[studio] JSKIT frontend is ready.'); });",
    "  socket.once('error', retry);",
    "  socket.once('timeout', () => { socket.destroy(); retry(); });",
    "}",
    "if (!Number.isInteger(port) || port < 1) {",
    "  console.error('[studio] JSKIT frontend port is not configured.');",
    "  process.exit(1);",
    "}",
    "probe();"
  ].join("\n");
  return [
    "node",
    "-e",
    shellQuote(script)
  ].join(" ");
}

function jskitFrontendStartCommand(frontendCommand = DEFAULT_DEV_FRONTEND_COMMAND) {
  const quotedFrontendCommand = shellQuote(frontendCommand);
  return [
    "(export VITE_API_PROXY_TARGET=\"http://127.0.0.1:$VIBE64_JSKIT_BACKEND_PORT\";",
    "export __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=\"$VIBE64_LAUNCH_AGENT_HOST\";",
    "if command -v setsid >/dev/null 2>&1;",
    `then exec setsid bash -lc ${quotedFrontendCommand};`,
    `else exec bash -lc ${quotedFrontendCommand};`,
    "fi) &"
  ].join(" ");
}

function jskitFrontendPauseControlLines() {
  return [
    "vibe64_jskit_frontend_signal() {",
    "  if [ -z \"${vibe64_jskit_frontend_pid:-}\" ]; then",
    "    return 0",
    "  fi",
    "  case \"$1\" in",
    "    CONT)",
    "      kill -CONT -- \"-$vibe64_jskit_frontend_pid\" 2>/dev/null || kill -CONT \"$vibe64_jskit_frontend_pid\" 2>/dev/null || true",
    "      ;;",
    "    STOP)",
    "      kill -STOP -- \"-$vibe64_jskit_frontend_pid\" 2>/dev/null || kill -STOP \"$vibe64_jskit_frontend_pid\" 2>/dev/null || true",
    "      ;;",
    "    TERM)",
    "      kill -TERM -- \"-$vibe64_jskit_frontend_pid\" 2>/dev/null || kill -TERM \"$vibe64_jskit_frontend_pid\" 2>/dev/null || true",
    "      ;;",
    "  esac",
    "}",
    "vibe64_jskit_agent_work_active() {",
    "  if [ -z \"${vibe64_jskit_agent_runs_root:-}\" ] || [ ! -d \"$vibe64_jskit_agent_runs_root\" ]; then",
    "    return 1",
    "  fi",
    "  grep -Eq '\"active\"[[:space:]]*:[[:space:]]*true' \"$vibe64_jskit_agent_runs_root\"/*.json 2>/dev/null",
    "}",
    "vibe64_jskit_watch_agent_pause() {",
    "  vibe64_jskit_frontend_paused=0",
    "  while kill -0 \"$vibe64_jskit_frontend_pid\" 2>/dev/null; do",
    "    if vibe64_jskit_agent_work_active; then",
    "      if [ \"$vibe64_jskit_frontend_paused\" != \"1\" ]; then",
    "        printf '\\n[studio] Pausing JSKIT frontend while agent work is active.\\n'",
    "        vibe64_jskit_frontend_signal STOP",
    "        vibe64_jskit_frontend_paused=1",
    "      fi",
    "    elif [ \"$vibe64_jskit_frontend_paused\" = \"1\" ]; then",
    "      vibe64_jskit_frontend_signal CONT",
    "      printf '\\n[studio] Resuming JSKIT frontend after agent work finished.\\n'",
    "      vibe64_jskit_frontend_paused=0",
    "    fi",
    "    sleep 0.5",
    "  done",
    "}"
  ];
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
  const previewAuthKind = JSKIT_PREVIEW_AUTH_KIND;
  const previewAuthProfileCommand = {
    command: createJskitPreviewAuthProfileCommand({
      vibe64User
    }),
    label: "Preparing preview auth user.",
    networkEnv: true
  };
  const selfTargetRuntimeNetworksCommand = selfTarget?.enabled === true
    ? {
        command: createVibe64SelfTargetRuntimeNetworksCommand(),
        label: "Preparing Vibe64 self preview project networks.",
        networkEnv: true
      }
    : null;

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
          selfTargetRuntimeNetworksCommand,
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
          selfTargetRuntimeNetworksCommand,
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
    restartOnChange: JSKIT_BUILT_RESTART_ON_CHANGE,
    urlPath: await launchDescriptorUrlPath(worktreePath, {
      selfTarget
    }),
    ...(workdir ? { workdir } : {})
  };
}

async function createJskitDevLaunchDescriptor({
  agentRunsRoot = "",
  config,
  databaseHost = "",
  launchInput = {},
  selfTarget = null,
  vibe64User = null,
  workdir = "",
  worktreePath = ""
} = {}) {
  const startupArgs = startupArgsFromLaunchInput(launchInput);
  const previewAuthKind = JSKIT_PREVIEW_AUTH_KIND;
  return {
    command: createJskitDevCommand({
      agentRunsRoot,
      backendCommand: config.backendCommand,
      backendPort: config.backendPort,
      frontendCommand: config.frontendCommand,
      migrationCommand: config.migrationCommand,
      previewAuthProfileCommand: createJskitPreviewAuthProfileCommand({
        vibe64User
      }),
      previewAuthProfileLabel: "Preparing preview auth user.",
      selfTargetRuntimeNetworksCommand: selfTarget?.enabled === true
        ? createVibe64SelfTargetRuntimeNetworksCommand()
        : "",
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
      frontendWatchPause: agentRunsRoot ? "active-agent-runs" : "",
      hostDocker: config.hostDocker,
      hostDockerSource: config.hostDockerSource,
      migrationCommand: config.migrationCommand,
      mode: "dev",
      runtimeNamespace: config.runtimeNamespace,
      previewAuthProfileCommand: "enabled",
      ...jskitSelfTargetMetadata(selfTarget)
    },
    previewAuth: previewAuthKind,
    restartOnChange: JSKIT_DEV_RESTART_ON_CHANGE,
    urlPath: await launchDescriptorUrlPath(worktreePath, {
      selfTarget
    }),
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
      message: "Create the session clone before running the app."
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
  const launchConfigRoot = worktreePath;
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
      // Vibe64 self-targeting is special: the inner Studio needs the same project
      // list, provider credentials, runtime namespace, and host-reachable preview
      // proxy range. Run the session clone as the inner Studio code, while
      // keeping VIBE64_SYSTEM_ROOT session-private for auth, sessions, and
      // terminal runtime state.
      const selfTarget = jskitSelfTargetRootConfig({
        enabled: config.hostDocker,
        launchPort: port,
        projectsRoot: context.projectsRoot || "",
        runtimeNamespace: config.runtimeNamespace,
        systemRoot: jskitSelfTargetSystemRoot({
          session,
          worktreePath: launchWorktreePath
        })
      });
      return descriptorFactory({
        agentRunsRoot: launchTargetId === "dev" ? jskitAgentRunsRoot(session) : "",
        config,
        databaseHost,
        launchInput,
        selfTarget,
        targetRoot: launchTargetRoot,
        vibe64User: context.vibe64User || null,
        workdir: launchWorktreePath,
        worktreePath: launchWorktreePath
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
  resolveBuiltLaunchConfig,
  BUILT_LAUNCH_COMMAND_CONFIG,
  BUILT_LAUNCH_PORT_CONFIG,
  DEV_SERVER_COMMAND_CONFIG
};
