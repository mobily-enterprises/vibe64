import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { loadAppConfigFromAppRoot } from "@jskit-ai/kernel/server/support";
import {
  sessionSourcePath
} from "@local/vibe64-core/server/sessionSourcePath";
import {
  VIBE64_PROJECTS_ROOT_ENV,
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
  reserveAvailableWebLaunchTargetPort,
  tcpReadinessProbeCommand
} from "@local/studio-terminal-core/server/launchTargetTerminal";
import {
  VIBE64_RUNTIME_NAMESPACE_ENV,
  runtimeNamespace
} from "@local/studio-terminal-core/server/studioRuntimeIdentity";
import {
  commandWithStartupArgs,
  launchTargetWithStartupArgsOption,
  startupArgsFromLaunchInput
} from "../../launchPreviewOptions.js";
import {
  nodeRuntimeShellCommand
} from "../../nodePackage.js";
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
const JSKIT_PREVIEW_ROUTE_EXTENSIONS = Object.freeze(new Set([
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".vue"
]));
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
	    ".git/**"
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
	    ".git/**"
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
    "--ensure-workspace=true"
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

function jskitRuntimeCommand(command = "") {
  const normalizedCommand = String(command || "").trim();
  return normalizedCommand ? nodeRuntimeShellCommand(normalizedCommand, "npm") : "";
}

function jskitRuntimeCommandWithStartupArgs(command = "", startupArgs = [], options = {}) {
  return jskitRuntimeCommand(commandWithStartupArgs(command, startupArgs, options));
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

async function resolveSelfTargetConfig({
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

function rootEnvValue(rootPath = "") {
  const normalizedRoot = String(rootPath || "").trim()
    ? path.resolve(String(rootPath || ""))
    : "";
  return normalizedRoot;
}

function jskitSelfTargetSystemRoot({
  session = {},
  worktreePath = ""
} = {}) {
  const sessionRoot = String(session.sessionRoot || "").trim();
  const derivedSessionRoot = !sessionRoot && path.basename(worktreePath) === "source"
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

function jskitSelfTargetPreviewProxyEnv({
  enabled = false,
  launchPort = DEFAULT_LAUNCH_PORT
} = {}) {
  if (!enabled) {
    return {};
  }
  const range = jskitSelfTargetPreviewProxyPortRange(launchPort);
  return {
    [PREVIEW_PROXY_HOST_ENV]: "127.0.0.1",
    [PREVIEW_PROXY_PUBLIC_HOST_ENV]: "127.0.0.1",
    [PREVIEW_PROXY_PORT_START_ENV]: String(range.start),
    [PREVIEW_PROXY_PORT_END_ENV]: String(range.end)
  };
}

function jskitSelfTargetReproEnv(env = process.env) {
  const slug = String(env?.[VIBE64_REPRO_SELF_TARGET_AUTO_SELECT_PROJECT_ENV] || "").trim();
  return slug ? {
    [VIBE64_REPRO_SELF_TARGET_AUTO_SELECT_PROJECT_ENV]: slug
  } : {};
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
      enabled: false,
      env: {},
      projectsRoot: "",
      runtimeNamespace: "",
      systemRoot: ""
    };
  }

  const resolvedProjectsRoot = rootEnvValue(projectsRoot) || resolveStudioProjectsRoot({
    env: process.env
  });
  const resolvedSystemRoot = rootEnvValue(systemRoot);
  const normalizedRuntimeNamespace = String(runtimeNamespaceValue || "").trim();

  return {
    enabled: true,
    env: {
      ...(normalizedRuntimeNamespace
        ? { [VIBE64_RUNTIME_NAMESPACE_ENV]: normalizedRuntimeNamespace }
        : {}),
      ...(resolvedProjectsRoot
        ? { [VIBE64_PROJECTS_ROOT_ENV]: resolvedProjectsRoot }
        : {}),
      ...(resolvedSystemRoot
        ? {
            [VIBE64_SYSTEM_ROOT_ENV]: resolvedSystemRoot,
            [VIBE64_SELF_TARGET_SYSTEM_ROOT_ENV]: "1"
          }
        : {}),
      ...jskitSelfTargetReproEnv(process.env),
      ...jskitSelfTargetPreviewProxyEnv({
        enabled,
        launchPort
      })
    },
    previewProxyPortRange: jskitSelfTargetPreviewProxyPortRange(launchPort),
    projectsRoot: resolvedProjectsRoot,
    runtimeNamespace: normalizedRuntimeNamespace,
    systemRoot: resolvedSystemRoot
  };
}

function jskitSelfTargetEnv(config = {}) {
  return config?.env && typeof config.env === "object" ? config.env : {};
}

function jskitSelfTargetMetadata(config = {}) {
  if (config?.enabled !== true) {
    return {};
  }
  return {
    vibe64SelfTarget: "Vibe64 self-target: shared projects with isolated Studio state",
    vibe64SelfTargetPreviewProxyPortRange: `${config.previewProxyPortRange.start}-${config.previewProxyPortRange.end}`,
    vibe64SelfTargetProjectsRoot: config.projectsRoot,
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

function jskitDevBackendPortStart(frontendPort = DEFAULT_LAUNCH_PORT) {
  const normalizedFrontendPort = normalizePort(frontendPort);
  return normalizedFrontendPort < 65535
    ? normalizedFrontendPort + 1
    : DEFAULT_LAUNCH_PORT + 1;
}

function releasePortReservation(reservation = null) {
  if (typeof reservation?.release === "function") {
    reservation.release();
  }
}

function withBackendPortReservation(spec = {}, backendPortReservation = null) {
  if (!backendPortReservation || spec?.ok === false) {
    return spec;
  }
  const originalReleasePortReservation = spec.releasePortReservation;
  const originalOnClose = spec.onClose;
  const originalOnStop = spec.onStop;
  return {
    ...spec,
    releasePortReservation() {
      if (typeof originalReleasePortReservation === "function") {
        originalReleasePortReservation();
      }
      releasePortReservation(backendPortReservation);
    },
    async onClose(event) {
      try {
        if (typeof originalOnClose === "function") {
          await originalOnClose(event);
        }
      } finally {
        releasePortReservation(backendPortReservation);
      }
    },
    async onStop(event) {
      try {
        if (typeof originalOnStop === "function") {
          await originalOnStop(event);
        }
      } finally {
        releasePortReservation(backendPortReservation);
      }
    }
  };
}

async function resolveBuiltLaunchConfig(worktreePath, {
  targetRoot = ""
} = {}) {
  const [configuredBuiltCommand, selfTarget, migrationCommand, portValue] = await Promise.all([
    readOptionalConfigFile(worktreePath, BUILT_LAUNCH_COMMAND_CONFIG, ""),
    resolveSelfTargetConfig({
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
      migrationCommand,
      preferredPort: normalizePort(portValue),
      runtimeNamespace: selfTarget.runtimeNamespace,
      serverCommand: "",
      selfTarget: selfTarget.enabled,
      selfTargetSource: selfTarget.source,
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
    migrationCommand,
    preferredPort: normalizePort(portValue),
    runtimeNamespace: selfTarget.runtimeNamespace,
    serverCommand,
    selfTarget: selfTarget.enabled,
    selfTargetSource: selfTarget.source,
    testrunCommand: `${buildCommand} && ${serverCommand}`
  };
}

async function resolveDevLaunchConfig(worktreePath, {
  targetRoot = ""
} = {}) {
  const [devCommand, backendCommand, selfTarget, migrationCommand, portValue] = await Promise.all([
    readOptionalConfigFile(worktreePath, DEV_SERVER_COMMAND_CONFIG, ""),
    readOptionalConfigFile(worktreePath, "config/server_command", DEFAULT_DEV_BACKEND_COMMAND),
    resolveSelfTargetConfig({
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
    migrationCommand,
    preferredPort: normalizePort(portValue),
    runtimeNamespace: selfTarget.runtimeNamespace,
    selfTarget: selfTarget.enabled,
    selfTargetSource: selfTarget.source
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

function jskitLaunchTargetWithPreviewOptions(id, label, {
  previewRoutes = []
} = {}) {
  return launchTargetWithStartupArgsOption({
    ...jskitLaunchTarget(id, label),
    ...(previewRoutes.length > 0 ? { previewRoutes } : {})
  });
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

async function listJskitPreviewRoutes(worktreePath = "") {
  const pagesRoot = path.join(worktreePath, "src", "pages");
  const files = await listJskitPageRouteFiles(pagesRoot);
  return files
    .map((relativePath) => jskitPreviewRouteFromPageFile(relativePath))
    .filter(Boolean)
    .sort((left, right) => left.pathTemplate.localeCompare(right.pathTemplate));
}

async function listJskitPageRouteFiles(root = "", prefix = "") {
  let entries = [];
  try {
    entries = await readdir(path.join(root, prefix), {
      withFileTypes: true
    });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    if (!entry.name || entry.name.startsWith(".") || entry.name.startsWith("_")) {
      continue;
    }
    const relativePath = prefix ? path.posix.join(prefix, entry.name) : entry.name;
    if (entry.isDirectory()) {
      files.push(...await listJskitPageRouteFiles(root, relativePath));
      continue;
    }
    if (entry.isFile() && JSKIT_PREVIEW_ROUTE_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(relativePath);
    }
  }
  return files;
}

function jskitPreviewRouteFromPageFile(relativeFilePath = "") {
  const normalizedFilePath = String(relativeFilePath || "").replace(/\\/gu, "/");
  const extension = path.extname(normalizedFilePath);
  if (!JSKIT_PREVIEW_ROUTE_EXTENSIONS.has(extension)) {
    return null;
  }
  const routePath = normalizedFilePath.slice(0, -extension.length);
  const segments = routePath.split("/").filter(Boolean);
  if (segments.at(-1) === "index") {
    segments.pop();
  }
  const routeSegments = [];
  const params = [];
  for (const segment of segments) {
    const routeSegment = jskitPreviewRouteSegment(segment);
    if (!routeSegment) {
      return null;
    }
    routeSegments.push(routeSegment.path);
    if (routeSegment.param) {
      params.push(routeSegment.param);
    }
  }
  const pathTemplate = `/${routeSegments.join("/")}`;
  return {
    id: jskitPreviewRouteId(pathTemplate),
    label: jskitPreviewRouteLabel(routeSegments),
    params,
    pathTemplate: pathTemplate === "/" ? "/" : pathTemplate.replace(/\/+/gu, "/")
  };
}

function jskitPreviewRouteSegment(segment = "") {
  const text = String(segment || "").trim();
  if (!text || text.startsWith("_")) {
    return null;
  }
  const dynamicMatch = text.match(/^\[([A-Za-z][A-Za-z0-9_]*)\]$/u);
  if (dynamicMatch) {
    const name = dynamicMatch[1];
    return {
      param: {
        defaultValue: "",
        description: "",
        label: jskitPreviewRouteParamLabel(name),
        name,
        placeholder: name,
        required: true
      },
      path: `:${name}`
    };
  }
  if (text.includes("[") || text.includes("]")) {
    return null;
  }
  return {
    path: encodeURIComponent(text)
  };
}

function jskitPreviewRouteId(pathTemplate = "") {
  const id = String(pathTemplate || "")
    .replace(/^\/+$/u, "home")
    .replace(/^\/+/u, "")
    .replace(/[^A-Za-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .slice(0, 96);
  return id ? `page_${id}` : "page_home";
}

function jskitPreviewRouteLabel(routeSegments = []) {
  if (!routeSegments.length) {
    return "Home";
  }
  const lastStatic = [...routeSegments]
    .reverse()
    .find((segment) => segment && !segment.startsWith(":") && segment !== "w");
  const base = jskitPreviewTitle(lastStatic || "route");
  return routeSegments.at(-1)?.startsWith(":") ? `${base} detail` : base;
}

function jskitPreviewRouteParamLabel(name = "") {
  return jskitPreviewTitle(String(name || "").replace(/Slug$/u, " slug"));
}

function jskitPreviewTitle(value = "") {
  return String(value || "")
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .replace(/[-_]+/gu, " ")
    .trim()
    .replace(/\b\w/gu, (letter) => letter.toUpperCase());
}

function createJskitDevCommand({
  agentRunsRoot = "",
  backendCommand = DEFAULT_DEV_BACKEND_COMMAND,
  backendPort = DEFAULT_DEV_BACKEND_PORT,
  frontendCommand = DEFAULT_DEV_FRONTEND_COMMAND,
  migrationCommand = "",
  previewAuthProfileCommand = createJskitPreviewAuthProfileCommand(),
  previewAuthProfileLabel = "Preparing preview auth user.",
  startupArgs = []
} = {}) {
  const backendCommandWithArgs = jskitRuntimeCommandWithStartupArgs(backendCommand, startupArgs, {
    separator: "--"
  });
  const frontendRuntimeCommand = jskitRuntimeCommand(frontendCommand);
  const migrationRuntimeCommand = jskitRuntimeCommand(migrationCommand);
  const previewAuthRuntimeCommand = jskitRuntimeCommand(previewAuthProfileCommand);
  return [
    "set -e",
    `export VIBE64_JSKIT_BACKEND_PORT=${shellQuotedNumber(backendPort)}`,
    `vibe64_jskit_agent_runs_root=${shellQuote(agentRunsRoot)}`,
    ...jskitFrontendRestartControlLines({
      backendCommand: backendCommandWithArgs,
      backendPort,
      frontendCommand: frontendRuntimeCommand
    }),
    ...(migrationRuntimeCommand
      ? [
          "printf '\\n[studio] Applying database migrations.\\n'",
          migrationRuntimeCommand
        ]
      : []),
    `printf '\\n[studio] ${previewAuthProfileLabel.replaceAll("'", "'\\''")}\\n'`,
    previewAuthRuntimeCommand,
    "cleanup_vibe64_jskit_dev() {",
    "  vibe64_jskit_stop_frontend",
    "  vibe64_jskit_stop_backend",
    "}",
    "trap cleanup_vibe64_jskit_dev EXIT INT TERM",
    "vibe64_jskit_start_stack",
    "vibe64_jskit_record_server_fingerprint",
    "vibe64_jskit_agent_work_was_active=0",
    "while kill -0 \"$vibe64_jskit_backend_pid\" 2>/dev/null && kill -0 \"$vibe64_jskit_frontend_pid\" 2>/dev/null; do",
    "  if vibe64_jskit_agent_work_active; then",
    "    vibe64_jskit_agent_work_was_active=1",
    "  elif [ \"$vibe64_jskit_agent_work_was_active\" = \"1\" ]; then",
    "    if vibe64_jskit_server_files_changed; then",
    "      printf '\\n[studio] Restarting JSKIT backend after server-side files changed.\\n'",
    "      vibe64_jskit_restart_backend",
    "    fi",
    "    vibe64_jskit_agent_work_was_active=0",
    "  fi",
    "  sleep 1",
    "done",
    "vibe64_jskit_report_exited_children",
    "cleanup_vibe64_jskit_dev",
    "exit 1"
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

function jskitFrontendRestartControlLines({
  backendCommand = "",
  backendPort = "",
  frontendCommand = DEFAULT_DEV_FRONTEND_COMMAND
} = {}) {
  const backendReadinessProbe = tcpReadinessProbeCommand({
    marker: "[studio] JSKIT backend is ready.",
    port: backendPort
  });
  const serverFingerprintCommand = jskitServerFingerprintCommand();
  return [
    "vibe64_jskit_backend_pid=\"\"",
    "vibe64_jskit_frontend_pid=\"\"",
    "vibe64_jskit_server_fingerprint=\"\"",
    "vibe64_jskit_wait_child_exit_code() {",
    "  set +e",
    "  wait \"$1\"",
    "  vibe64_jskit_child_exit_code=$?",
    "  set -e",
    "  return \"$vibe64_jskit_child_exit_code\"",
    "}",
    "vibe64_jskit_start_backend() {",
    `  (export PORT="$VIBE64_JSKIT_BACKEND_PORT"; ${backendCommand}) &`,
    "  vibe64_jskit_backend_pid=$!",
    `  ${backendReadinessProbe}`,
    "}",
    "vibe64_jskit_stop_backend() {",
    "  if [ -n \"${vibe64_jskit_backend_pid:-}\" ]; then",
    "    kill \"$vibe64_jskit_backend_pid\" 2>/dev/null || true",
    "    wait \"$vibe64_jskit_backend_pid\" 2>/dev/null || true",
    "    vibe64_jskit_backend_pid=\"\"",
    "  fi",
    "}",
    "vibe64_jskit_start_frontend() {",
    `  ${jskitFrontendStartCommand(frontendCommand)}`,
    "  vibe64_jskit_frontend_pid=$!",
    `  ${jskitFrontendPortReadinessProbeCommand()}`,
    "}",
    "vibe64_jskit_frontend_signal() {",
    "  if [ -z \"${vibe64_jskit_frontend_pid:-}\" ]; then",
    "    return 0",
    "  fi",
    "  case \"$1\" in",
    "    TERM)",
    "      kill -TERM -- \"-$vibe64_jskit_frontend_pid\" 2>/dev/null || kill -TERM \"$vibe64_jskit_frontend_pid\" 2>/dev/null || true",
    "      ;;",
    "  esac",
    "}",
    "vibe64_jskit_stop_frontend() {",
    "  if [ -n \"${vibe64_jskit_frontend_pid:-}\" ]; then",
    "    vibe64_jskit_frontend_signal TERM",
    "    wait \"$vibe64_jskit_frontend_pid\" 2>/dev/null || true",
    "    vibe64_jskit_frontend_pid=\"\"",
    "  fi",
    "}",
    "vibe64_jskit_start_stack() {",
    "  vibe64_jskit_start_backend",
    "  vibe64_jskit_start_frontend",
    "}",
    "vibe64_jskit_restart_backend() {",
    "  vibe64_jskit_stop_backend",
    "  vibe64_jskit_start_backend",
    "}",
    "vibe64_jskit_report_child_exit() {",
    "  vibe64_jskit_child_label=\"$1\"",
    "  vibe64_jskit_child_pid=\"$2\"",
    "  if vibe64_jskit_wait_child_exit_code \"$vibe64_jskit_child_pid\"; then",
    "    vibe64_jskit_exit_code=0",
    "  else",
    "    vibe64_jskit_exit_code=$?",
    "  fi",
    "  printf '\\n[studio] JSKIT %s exited with code %s.\\n' \"$vibe64_jskit_child_label\" \"$vibe64_jskit_exit_code\" >&2",
    "}",
    "vibe64_jskit_report_exited_children() {",
    "  if [ -n \"${vibe64_jskit_backend_pid:-}\" ] && ! kill -0 \"$vibe64_jskit_backend_pid\" 2>/dev/null; then",
    "    vibe64_jskit_report_child_exit backend \"$vibe64_jskit_backend_pid\"",
    "    vibe64_jskit_backend_pid=\"\"",
    "  fi",
    "  if [ -n \"${vibe64_jskit_frontend_pid:-}\" ] && ! kill -0 \"$vibe64_jskit_frontend_pid\" 2>/dev/null; then",
    "    vibe64_jskit_report_child_exit frontend \"$vibe64_jskit_frontend_pid\"",
    "    vibe64_jskit_frontend_pid=\"\"",
    "  fi",
    "}",
    "vibe64_jskit_record_server_fingerprint() {",
    `  vibe64_jskit_server_fingerprint="$(${serverFingerprintCommand} || true)"`,
    "}",
    "vibe64_jskit_server_files_changed() {",
    `  vibe64_jskit_next_server_fingerprint="$(${serverFingerprintCommand} || true)"`,
    "  if [ -z \"$vibe64_jskit_next_server_fingerprint\" ]; then",
    "    printf '\\n[studio] Could not inspect JSKIT server-side files for restart; leaving backend running.\\n' >&2",
    "    return 1",
    "  fi",
    "  if [ \"$vibe64_jskit_next_server_fingerprint\" != \"$vibe64_jskit_server_fingerprint\" ]; then",
    "    vibe64_jskit_server_fingerprint=\"$vibe64_jskit_next_server_fingerprint\"",
    "    return 0",
    "  fi",
    "  return 1",
    "}",
    "vibe64_jskit_agent_work_active() {",
    "  if [ -z \"${vibe64_jskit_agent_runs_root:-}\" ] || [ ! -d \"$vibe64_jskit_agent_runs_root\" ]; then",
    "    return 1",
    "  fi",
    "  grep -Eq '\"active\"[[:space:]]*:[[:space:]]*true' \"$vibe64_jskit_agent_runs_root\"/*.json 2>/dev/null",
    "}"
  ];
}

function jskitServerFingerprintCommand() {
  const script = [
    "const { createHash } = require('node:crypto');",
    "const { readdirSync, statSync } = require('node:fs');",
    "const path = require('node:path');",
    `const include = ${JSON.stringify(JSKIT_DEV_RESTART_ON_CHANGE.include)};`,
    `const exclude = ${JSON.stringify(JSKIT_DEV_RESTART_ON_CHANGE.exclude)};`,
    "function escapeRegex(value) {",
    "  return value.replace(/[.+^${}()|[\\]\\\\]/gu, '\\\\$&');",
    "}",
    "function globRegex(pattern) {",
    "  let source = '';",
    "  for (let index = 0; index < pattern.length;) {",
    "    if (pattern.startsWith('**/', index)) {",
    "      source += '(?:[^/]+/)*';",
    "      index += 3;",
    "    } else if (pattern.startsWith('**', index)) {",
    "      source += '.*';",
    "      index += 2;",
    "    } else if (pattern[index] === '*') {",
    "      source += '[^/]*';",
    "      index += 1;",
    "    } else if (pattern[index] === '?') {",
    "      source += '[^/]';",
    "      index += 1;",
    "    } else {",
    "      source += escapeRegex(pattern[index]);",
    "      index += 1;",
    "    }",
    "  }",
    "  return new RegExp(`^${source}$`, 'u');",
    "}",
    "const includeRules = include.map(globRegex);",
    "const excludeRules = exclude.map(globRegex);",
    "const topLevelRoots = new Set();",
    "let hasWildcardTopLevel = false;",
    "for (const pattern of include) {",
    "  const [firstSegment] = pattern.split('/');",
    "  if (!firstSegment) {",
    "    hasWildcardTopLevel = true;",
    "  } else if (/[*?]/u.test(firstSegment)) {",
    "    hasWildcardTopLevel = hasWildcardTopLevel || pattern.includes('/');",
    "  } else {",
    "    topLevelRoots.add(firstSegment);",
    "  }",
    "}",
    "function matches(rules, relativePath) {",
    "  return rules.some((rule) => rule.test(relativePath));",
    "}",
    "function isExcluded(relativePath) {",
    "  return matches(excludeRules, relativePath);",
    "}",
    "function shouldSkipDirectory(relativePath) {",
    "  return isExcluded(relativePath) || isExcluded(`${relativePath}/__probe__`);",
    "}",
    "function shouldSkipTopLevel(relativePath, dirent) {",
    "  if (relativePath.includes('/')) {",
    "    return false;",
    "  }",
    "  return dirent.isDirectory() && !topLevelRoots.has(relativePath) && !hasWildcardTopLevel;",
    "}",
    "const entries = [];",
    "function walk(directory, prefix = '') {",
    "  for (const dirent of readdirSync(directory, { withFileTypes: true })) {",
    "    const relativePath = prefix ? `${prefix}/${dirent.name}` : dirent.name;",
    "    const absolutePath = path.join(directory, dirent.name);",
    "    if (shouldSkipTopLevel(relativePath, dirent)) {",
    "      continue;",
    "    }",
    "    if (dirent.isDirectory()) {",
    "      if (!shouldSkipDirectory(relativePath)) {",
    "        walk(absolutePath, relativePath);",
    "      }",
    "      continue;",
    "    }",
    "    if (!dirent.isFile() || isExcluded(relativePath) || !matches(includeRules, relativePath)) {",
    "      continue;",
    "    }",
    "    try {",
    "      const stat = statSync(absolutePath);",
    "      entries.push(`${relativePath}\\t${stat.mtimeMs}\\t${stat.size}`);",
    "    } catch {",
    "      // The file changed while scanning; the next completed agent turn can inspect it again.",
    "    }",
    "  }",
    "}",
    "walk(process.cwd());",
    "entries.sort();",
    "const hash = createHash('sha256');",
    "for (const entry of entries) {",
    "  hash.update(entry);",
    "  hash.update('\\n');",
    "}",
    "console.log(hash.digest('hex'));"
  ].join("\n");
  return [
    "node",
    "-e",
    shellQuote(script)
  ].join(" ");
}

async function listJskitLaunchTargets({
  session = {}
} = {}) {
  const worktreePath = sessionSourcePath(session);
  if (!worktreePath) {
    return [];
  }

  const [
    scripts,
    hasTestrunCommand,
    hasBuildCommandConfig,
    hasServerCommandConfig,
    hasDevCommandConfig,
    previewRoutes
  ] = await Promise.all([
    readPackageJsonScripts(worktreePath),
    configFileHasValue(worktreePath, BUILT_LAUNCH_COMMAND_CONFIG),
    configFileHasValue(worktreePath, "config/build_command"),
    configFileHasValue(worktreePath, "config/server_command"),
    configFileHasValue(worktreePath, DEV_SERVER_COMMAND_CONFIG),
    listJskitPreviewRoutes(worktreePath)
  ]);

  const launchTargets = [];
  if (hasTestrunCommand || (hasBuildCommandConfig && hasServerCommandConfig) || (scripts.build && scripts.server)) {
    launchTargets.push(jskitLaunchTargetWithPreviewOptions("built", "Run built app", {
      previewRoutes
    }));
  }
  if ((hasDevCommandConfig || scripts.dev) && (hasServerCommandConfig || scripts.server)) {
    launchTargets.push(jskitLaunchTargetWithPreviewOptions("dev", "Run app", {
      previewRoutes
    }));
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
        command: jskitRuntimeCommand(config.migrationCommand),
        label: "Applying database migrations.",
        networkEnv: true
      }
    : null;
  const previewAuthKind = JSKIT_PREVIEW_AUTH_KIND;
  const previewAuthProfileCommand = {
    command: jskitRuntimeCommand(createJskitPreviewAuthProfileCommand({
      vibe64User
    })),
    label: "Preparing preview auth user.",
    networkEnv: true
  };

  return {
    commands: config.buildCommand || config.serverCommand
      ? [
          config.buildCommand
            ? {
                command: jskitRuntimeCommand(config.buildCommand),
                label: "Building JSKIT app.",
                networkEnv: false
              }
            : null,
          migrationCommand,
          previewAuthProfileCommand,
          config.serverCommand
            ? {
                command: jskitRuntimeCommandWithStartupArgs(config.serverCommand, startupArgs, {
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
            command: jskitRuntimeCommandWithStartupArgs(config.testrunCommand, startupArgs, {
              separator: "--"
            }),
            label: "Starting JSKIT built app.",
            networkEnv: true
          }
        ].filter(Boolean),
    env: jskitSelfTargetEnv(selfTarget),
    metadata: {
      buildCommand: config.buildCommand,
      commandSource: config.commandSource,
      databaseHost,
      migrationCommand: config.migrationCommand,
      runtimeNamespace: config.runtimeNamespace,
      previewAuthProfileCommand: "enabled",
      serverCommand: config.serverCommand,
      selfTarget: config.selfTarget,
      selfTargetSource: config.selfTargetSource,
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
      startupArgs
    }),
    env: jskitSelfTargetEnv(selfTarget),
    metadata: {
      backendCommand: config.backendCommand,
      backendPort: config.backendPort,
      commandSource: config.commandSource,
      databaseHost,
      frontendCommand: config.frontendCommand,
      migrationCommand: config.migrationCommand,
      mode: "dev",
      runtimeNamespace: config.runtimeNamespace,
      serverRestartCheck: agentRunsRoot ? "active-agent-runs" : "",
      previewAuthProfileCommand: "enabled",
      selfTarget: config.selfTarget,
      selfTargetSource: config.selfTargetSource,
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
  const worktreePath = sessionSourcePath(session);
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
  let backendPortReservation = null;
  try {
    const spec = await createVibe64WebLaunchTargetTerminalSpec({
      adapterId: "jskit",
      launchTarget,
      preferredPort: config.preferredPort,
      resolveLaunch: async ({
        port,
        worktreePath: launchWorktreePath
      }) => {
        const launchConfig = launchTargetId === "dev"
          ? {
              ...config,
              backendPort: (backendPortReservation = await reserveAvailableWebLaunchTargetPort(
                jskitDevBackendPortStart(port)
              )).port
            }
          : config;
        // Vibe64 self-targeting is special: the inner Studio needs the same
        // project list, runtime namespace, and host-reachable preview proxy range.
        // Run the session clone as the inner Studio code, while keeping
        // VIBE64_SYSTEM_ROOT session-private for auth, sessions, and terminal
        // runtime state.
        const selfTarget = jskitSelfTargetRootConfig({
          enabled: launchConfig.selfTarget,
          launchPort: port,
          projectsRoot: context.projectsRoot || "",
          runtimeNamespace: launchConfig.runtimeNamespace,
          systemRoot: jskitSelfTargetSystemRoot({
            session,
            worktreePath: launchWorktreePath
          })
        });
        return descriptorFactory({
          agentRunsRoot: launchTargetId === "dev" ? jskitAgentRunsRoot(session) : "",
          config: launchConfig,
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
    if (spec?.ok === false) {
      releasePortReservation(backendPortReservation);
      return spec;
    }
    return withBackendPortReservation(spec, backendPortReservation);
  } catch (error) {
    releasePortReservation(backendPortReservation);
    throw error;
  }
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
