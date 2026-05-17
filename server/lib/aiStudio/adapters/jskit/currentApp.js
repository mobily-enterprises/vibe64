import { execFile } from "node:child_process";
import { statSync } from "node:fs";
import {
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { loadAppConfigFromAppRoot } from "@jskit-ai/kernel/server/support";

import {
  AI_STUDIO_STATE_DIR
} from "../../sessionStore.js";
import {
  pathExists
} from "../../core.js";
import {
  normalizePlainObject
} from "../../serverResponses.js";
import {
  STUDIO_DAEMON_PID_LABEL,
  STUDIO_TOOLCHAIN_IMAGE as TOOLCHAIN_IMAGE
} from "../../../studioRuntimeIdentity.js";
import {
  gitToolchainMountArgs
} from "../../../gitToolchainMounts.js";
import {
  hostUserDockerArgs,
  hostUserIdentityEnvArgs,
  shellQuote,
  stableHash
} from "../../../shellCommands.js";
import {
  containerWorkspacePath,
  removeDockerContainer
} from "../../../containerRuntime.js";

const execFileAsync = promisify(execFile);
const TARGET_TERMINAL_CONFIG_DIR = `${AI_STUDIO_STATE_DIR}/config`;
const TARGET_TERMINAL_HOST_DOCKER_CONFIG = `${TARGET_TERMINAL_CONFIG_DIR}/target_terminal_host_docker`;
const TARGET_SCRIPT_SHORTCUTS_CONFIG = `${TARGET_TERMINAL_CONFIG_DIR}/target_script_shortcuts`;
const DEFAULT_TARGET_SCRIPT_NAMES = Object.freeze([
  "jskit:update",
  "devlinks",
  "build",
  "server",
  "verify"
]);

const JSKIT_CURRENT_APP_MARKERS = Object.freeze([
  { id: "packageJson", label: "package.json", relativePath: "package.json", kind: "file" },
  { id: "publicConfig", label: "config/public.js", relativePath: "config/public.js", kind: "file" },
  { id: "clientEntry", label: "src/main.js", relativePath: "src/main.js", kind: "file" },
  {
    id: "mainDescriptor",
    label: "packages/main/package.descriptor.mjs",
    relativePath: "packages/main/package.descriptor.mjs",
    kind: "file"
  },
  { id: "jskitLock", label: ".jskit/lock.json", relativePath: ".jskit/lock.json", kind: "file" }
]);

const JSKIT_PROJECT_DIRECTORIES = Object.freeze([
  { id: "src", label: "src", relativePath: "src" },
  { id: "packages", label: "packages", relativePath: "packages" },
  { id: "tests", label: "tests", relativePath: "tests" }
]);

function isEnabledConfigValue(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return Boolean(normalized) && !["0", "false", "no", "off"].includes(normalized);
}

function targetTerminalHostDockerArgs(enabled = false) {
  if (!enabled) {
    return [];
  }
  const args = [
    "-e",
    "DOCKER_HOST=unix:///var/run/docker.sock",
    "-e",
    "JSKIT_STUDIO_SKIP_STALE_TERMINAL_CLEANUP=1",
    "-v",
    "/var/run/docker.sock:/var/run/docker.sock"
  ];
  const userArgs = hostUserDockerArgs();
  if (userArgs.length === 2) {
    args.push("--user", userArgs[1]);
  }
  try {
    const socketStats = statSync("/var/run/docker.sock");
    args.push("--group-add", String(socketStats.gid));
  } catch {
    // Docker readiness is reported by the terminal command itself.
  }
  return args;
}

async function readOptionalConfigFile(appRoot, relativePath, fallback) {
  const configPath = path.join(appRoot, relativePath);
  try {
    const value = String(await readFile(configPath, "utf8")).trim();
    return value || fallback;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return fallback;
    }
    throw new Error(`Cannot read ${relativePath}: ${String(error?.message || error)}`);
  }
}

async function resolveTargetTerminalConfig(appRoot) {
  const hostDockerValue = await readOptionalConfigFile(appRoot, TARGET_TERMINAL_HOST_DOCKER_CONFIG, "");
  const hostDocker = isEnabledConfigValue(hostDockerValue);
  return {
    hostDocker,
    hostDockerSource: hostDocker ? TARGET_TERMINAL_HOST_DOCKER_CONFIG : ""
  };
}

async function defaultAppPath(appRoot) {
  try {
    const appConfig = await loadAppConfigFromAppRoot({
      appRoot
    });
    const surfaceDefaultId = String(appConfig?.surfaceDefaultId || "").trim().replace(/^\/+/u, "");
    return surfaceDefaultId ? `/${surfaceDefaultId}` : "/";
  } catch {
    return "/";
  }
}

function targetScriptCommandPreview(scriptName = "") {
  return `npm run ${String(scriptName || "").trim()}`;
}

function targetScriptStartupScript(scriptName = "") {
  const commandPreview = targetScriptCommandPreview(scriptName);
  const runCommand = [
    "set +e",
    `printf '\\n[studio] $ %s\\n\\n' ${shellQuote(commandPreview)}`,
    `npm run ${shellQuote(scriptName)}`,
    "status=$?",
    "printf '\\n[studio] npm run exited with code %s\\n' \"$status\"",
    "exit \"$status\""
  ].join("\n");
  return [
    "set -e",
    "mkdir -p /tmp/studio-home /tmp/npm-cache",
    "if [ \"$(id -u)\" = \"0\" ] && [ -n \"${AI_STUDIO_HOST_UID:-}\" ] && [ -n \"${AI_STUDIO_HOST_GID:-}\" ] && command -v setpriv >/dev/null 2>&1; then",
    "  chown -R \"$AI_STUDIO_HOST_UID:$AI_STUDIO_HOST_GID\" /tmp/studio-home /tmp/npm-cache",
    "  docker_group_args=\"--clear-groups\"",
    "  if [ -S /var/run/docker.sock ]; then",
    "    docker_sock_gid=\"$(stat -c '%g' /var/run/docker.sock 2>/dev/null || true)\"",
    "    if [ -n \"$docker_sock_gid\" ]; then",
    "      docker_group_args=\"--groups $docker_sock_gid\"",
    "    fi",
    "  fi",
    `  exec setpriv --reuid "$AI_STUDIO_HOST_UID" --regid "$AI_STUDIO_HOST_GID" $docker_group_args env HOME=/tmp/studio-home npm_config_cache=/tmp/npm-cache bash -lc ${shellQuote(runCommand)}`,
    "fi",
    `exec env HOME=/tmp/studio-home npm_config_cache=/tmp/npm-cache bash -lc ${shellQuote(runCommand)}`
  ].join("\n");
}

function targetScriptTerminalArgs({
  containerName,
  hostDocker = false,
  scriptName,
  targetRoot,
  terminalId,
  workdir
}) {
  return [
    "run",
    "--rm",
    "-it",
    "--name",
    containerName,
    "--label",
    "ai-studio.kind=target-script-terminal",
    "--label",
    `${STUDIO_DAEMON_PID_LABEL}=${process.pid}`,
    "--label",
    "ai-studio.session=target",
    "--label",
    `ai-studio.terminal=${terminalId}`,
    "--label",
    `ai-studio.target=${stableHash(targetRoot)}`,
    ...gitToolchainMountArgs(targetRoot),
    "-v",
    `${targetRoot}:/workspace`,
    "-v",
    `${targetRoot}:${targetRoot}`,
    ...targetTerminalHostDockerArgs(hostDocker),
    ...hostUserIdentityEnvArgs(),
    "-w",
    workdir,
    TOOLCHAIN_IMAGE,
    "bash",
    "-lc",
    targetScriptStartupScript(scriptName)
  ];
}

function targetScriptContainerName({ terminalId }) {
  return `ai-studio-target-script-${stableHash(terminalId)}`;
}

function sortTextValues(values = []) {
  return [...values]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));
}

async function readJsonFile(absolutePath) {
  try {
    return JSON.parse(await readFile(absolutePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw new Error(`Cannot read ${absolutePath}: ${String(error?.message || error)}`);
  }
}

async function inspectMarkers(appRoot) {
  const markers = await Promise.all(JSKIT_CURRENT_APP_MARKERS.map(async (marker) => {
    const absolutePath = path.join(appRoot, marker.relativePath);
    return {
      ...marker,
      exists: await pathExists(absolutePath),
      path: absolutePath
    };
  }));
  return {
    markers,
    ready: markers.every((marker) => marker.exists)
  };
}

async function inspectDirectories(appRoot) {
  return Promise.all(JSKIT_PROJECT_DIRECTORIES.map(async (directory) => {
    const absolutePath = path.join(appRoot, directory.relativePath);
    return {
      ...directory,
      exists: await pathExists(absolutePath),
      path: absolutePath
    };
  }));
}

async function inspectLocalPackages(appRoot) {
  const packagesRoot = path.join(appRoot, "packages");
  const packageJson = await readJsonFile(path.join(appRoot, "package.json")) || {};
  let packageDirectories = [];
  try {
    packageDirectories = await readdir(packagesRoot, {
      withFileTypes: true
    });
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
  return {
    appPackageName: String(packageJson.name || ""),
    packages: packageDirectories
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right))
  };
}

function normalizeScripts(packageJson) {
  return Object.entries(normalizePlainObject(packageJson?.scripts))
    .map(([name, command]) => ({
      command: String(command || ""),
      name: String(name || "")
    }))
    .filter((script) => script.name)
    .sort((left, right) => left.name.localeCompare(right.name));
}

function targetScriptError(code, message, extra = {}) {
  return {
    ...extra,
    error: message,
    errors: [
      {
        code,
        message
      }
    ],
    ok: false
  };
}

function uniqueTextValues(values = []) {
  return sortTextValues([...new Set(values)]);
}

async function readPackageScripts(appRoot) {
  const packageJsonPath = path.join(appRoot, "package.json");
  const packageJson = await readJsonFile(packageJsonPath);
  if (!packageJson) {
    return targetScriptError("package_json_missing", `Cannot find ${packageJsonPath}.`, {
      scripts: []
    });
  }
  return {
    ok: true,
    packageJsonPath,
    scripts: normalizeScripts(packageJson)
  };
}

async function readTargetScriptShortcutsConfig(appRoot) {
  try {
    const source = await readFile(path.join(appRoot, TARGET_SCRIPT_SHORTCUTS_CONFIG), "utf8");
    return {
      exists: true,
      scriptNames: uniqueTextValues(source.split(/\r?\n/gu))
    };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {
        exists: false,
        scriptNames: []
      };
    }
    throw new Error(`Cannot read ${TARGET_SCRIPT_SHORTCUTS_CONFIG}: ${String(error?.message || error)}`);
  }
}

function defaultTargetScriptNames(scripts = []) {
  const scriptNames = new Set(scripts.map((script) => script.name));
  return DEFAULT_TARGET_SCRIPT_NAMES.filter((scriptName) => scriptNames.has(scriptName));
}

function resolveStarredTargetScriptNames(scripts = [], config = {}) {
  const existingScriptNames = new Set(scripts.map((script) => script.name));
  const configured = uniqueTextValues(config.scriptNames || [])
    .filter((scriptName) => existingScriptNames.has(scriptName));
  return config.exists ? configured : defaultTargetScriptNames(scripts);
}

function targetScriptsResponse({
  config = {},
  packageJsonPath = "",
  scripts = []
} = {}) {
  const starredScriptNames = resolveStarredTargetScriptNames(scripts, config);
  const starredSet = new Set(starredScriptNames);
  return {
    config: {
      exists: config.exists === true,
      path: TARGET_SCRIPT_SHORTCUTS_CONFIG
    },
    ok: true,
    packageJsonPath,
    scriptCount: scripts.length,
    scripts: scripts.map((script) => ({
      ...script,
      starred: starredSet.has(script.name)
    })),
    starredScriptNames
  };
}

async function inspectJskitTargetScripts(appRoot) {
  const [scriptsResult, config] = await Promise.all([
    readPackageScripts(appRoot),
    readTargetScriptShortcutsConfig(appRoot)
  ]);
  if (scriptsResult.ok === false) {
    return scriptsResult;
  }
  return targetScriptsResponse({
    config,
    packageJsonPath: scriptsResult.packageJsonPath,
    scripts: scriptsResult.scripts
  });
}

function validateTargetScriptNames(scriptNames = [], scripts = []) {
  const available = new Set(scripts.map((script) => script.name));
  const normalized = uniqueTextValues(scriptNames);
  const invalid = normalized.filter((scriptName) => !available.has(scriptName));
  if (invalid.length > 0) {
    return targetScriptError(
      "invalid_target_script",
      `Unknown target script${invalid.length === 1 ? "" : "s"}: ${invalid.join(", ")}.`,
      {
        invalidScriptNames: invalid
      }
    );
  }
  return {
    ok: true,
    scriptNames: normalized
  };
}

async function saveJskitStarredTargetScripts(appRoot, input = {}) {
  const scriptsResult = await readPackageScripts(appRoot);
  if (scriptsResult.ok === false) {
    return scriptsResult;
  }
  const validation = validateTargetScriptNames(input?.scriptNames, scriptsResult.scripts);
  if (validation.ok === false) {
    return validation;
  }
  await mkdir(path.dirname(path.join(appRoot, TARGET_SCRIPT_SHORTCUTS_CONFIG)), {
    recursive: true
  });
  const persistedValue = validation.scriptNames.length > 0
    ? `${validation.scriptNames.join("\n")}\n`
    : "";
  await writeFile(path.join(appRoot, TARGET_SCRIPT_SHORTCUTS_CONFIG), persistedValue, "utf8");
  return targetScriptsResponse({
    config: {
      exists: true,
      scriptNames: validation.scriptNames
    },
    packageJsonPath: scriptsResult.packageJsonPath,
    scripts: scriptsResult.scripts
  });
}

async function resetJskitStarredTargetScripts(appRoot) {
  const scriptsResult = await readPackageScripts(appRoot);
  if (scriptsResult.ok === false) {
    return scriptsResult;
  }
  await rm(path.join(appRoot, TARGET_SCRIPT_SHORTCUTS_CONFIG), {
    force: true
  });
  return targetScriptsResponse({
    config: {
      exists: false,
      scriptNames: []
    },
    packageJsonPath: scriptsResult.packageJsonPath,
    scripts: scriptsResult.scripts
  });
}

function normalizePackageNamesFromManifest(packageJson) {
  const dependencies = normalizePlainObject(packageJson?.dependencies);
  const devDependencies = normalizePlainObject(packageJson?.devDependencies);
  return Object.keys({
    ...dependencies,
    ...devDependencies
  }).sort((left, right) => left.localeCompare(right));
}

function normalizeInstalledPackages(lockJson) {
  const packages = normalizePlainObject(lockJson?.packages);
  return Object.keys(packages)
    .map((packagePath) => String(packagePath || "").replace(/^node_modules\//u, ""))
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));
}

function packageIdMatches(packageId, fragments = []) {
  const normalizedPackageId = String(packageId || "").toLowerCase();
  return fragments.some((fragment) => normalizedPackageId.includes(fragment));
}

function detectRuntimeNeeds({
  installedPackages = [],
  packageNames = []
} = {}) {
  const allPackageNames = [...new Set([...packageNames, ...installedPackages])];
  return {
    needsDatabase: allPackageNames.some((packageId) => {
      return packageIdMatches(packageId, ["mysql", "mariadb", "sequelize", "knex"]);
    }),
    needsRedis: allPackageNames.some((packageId) => {
      return packageIdMatches(packageId, ["redis", "ioredis"]);
    })
  };
}

function normalizeSurfaces(appConfig) {
  const surfaces = normalizePlainObject(appConfig?.surfaces);
  return Object.keys(surfaces).sort((left, right) => left.localeCompare(right));
}

async function inspectConfig(appRoot) {
  const [packageJson, packageLockJson] = await Promise.all([
    readJsonFile(path.join(appRoot, "package.json")),
    readJsonFile(path.join(appRoot, "package-lock.json"))
  ]);
  let appConfig = null;
  try {
    appConfig = await loadAppConfigFromAppRoot({
      appRoot
    });
  } catch {
    appConfig = null;
  }
  const packageNames = normalizePackageNamesFromManifest(packageJson);
  const installedPackages = normalizeInstalledPackages(packageLockJson);
  return {
    appConfigReady: Boolean(appConfig),
    packageNames,
    runtimeNeeds: detectRuntimeNeeds({
      installedPackages,
      packageNames
    }),
    scripts: normalizeScripts(packageJson),
    surfaces: normalizeSurfaces(appConfig)
  };
}

async function runGit(appRoot, args) {
  try {
    const result = await execFileAsync("git", args, {
      cwd: appRoot,
      maxBuffer: 1024 * 1024,
      timeout: 10_000
    });
    return {
      ok: true,
      output: String(result.stdout || "").trim()
    };
  } catch (error) {
    return {
      ok: false,
      output: String(error.stderr || error.stdout || error.message || "").trim()
    };
  }
}

function parseGitStatus(rawStatus) {
  return String(rawStatus || "")
    .split(/\r?\n/gu)
    .map((line) => line.trimEnd())
    .filter(Boolean);
}

async function inspectGit(appRoot, {
  includeGit = true
} = {}) {
  if (!includeGit) {
    return {
      enabled: false
    };
  }
  const [branch, status] = await Promise.all([
    runGit(appRoot, ["branch", "--show-current"]),
    runGit(appRoot, ["status", "--short"])
  ]);
  return {
    branch: branch.ok ? branch.output : "",
    enabled: true,
    ok: branch.ok && status.ok,
    status: status.ok ? parseGitStatus(status.output) : [],
    statusError: status.ok ? "" : status.output
  };
}

async function inspectJskitCurrentApp(targetRoot, {
  includeGit = true
} = {}) {
  const normalizedTargetRoot = path.resolve(targetRoot || process.cwd());
  const [markers, directories, localPackages, config, git, targetScripts, appPath] = await Promise.all([
    inspectMarkers(normalizedTargetRoot),
    inspectDirectories(normalizedTargetRoot),
    inspectLocalPackages(normalizedTargetRoot),
    inspectConfig(normalizedTargetRoot),
    inspectGit(normalizedTargetRoot, {
      includeGit
    }),
    inspectJskitTargetScripts(normalizedTargetRoot),
    defaultAppPath(normalizedTargetRoot)
  ]);

  return {
    adapter: "jskit",
    appPath,
    config,
    directories,
    git,
    localPackages,
    markers: markers.markers,
    ok: true,
    ready: markers.ready,
    root: normalizedTargetRoot,
    targetScripts
  };
}

async function createJskitTargetScriptTerminalSpec(targetRoot, input = {}) {
  const normalizedTargetRoot = path.resolve(targetRoot || process.cwd());
  const normalizedScriptName = String(input?.scriptName || "").trim();
  if (!normalizedScriptName) {
    return targetScriptError(
      "missing_target_script",
      "scriptName must be a package.json script name."
    );
  }
  const scriptsResult = await readPackageScripts(normalizedTargetRoot);
  if (scriptsResult.ok === false) {
    return scriptsResult;
  }
  const validation = validateTargetScriptNames([normalizedScriptName], scriptsResult.scripts);
  if (validation.ok === false) {
    return validation;
  }
  const [validatedScriptName] = validation.scriptNames;
  const workspacePath = containerWorkspacePath(normalizedTargetRoot, normalizedTargetRoot);
  if (!workspacePath) {
    return {
      error: "The target script directory is outside the target root.",
      ok: false
    };
  }

  const config = await resolveTargetTerminalConfig(normalizedTargetRoot);
  const commandPreview = targetScriptCommandPreview(validatedScriptName);
  return {
    args: ({ id }) => targetScriptTerminalArgs({
      containerName: targetScriptContainerName({
        terminalId: id
      }),
      hostDocker: config.hostDocker,
      scriptName: validatedScriptName,
      targetRoot: normalizedTargetRoot,
      terminalId: id,
      workdir: normalizedTargetRoot
    }),
    closeExisting: true,
    command: "docker",
    commandPreview,
    cwd: normalizedTargetRoot,
    maxRunning: 1,
    metadata: {
      command: commandPreview,
      commandPreview,
      hostDocker: config.hostDocker,
      hostDockerSource: config.hostDockerSource,
      runRoot: normalizedTargetRoot,
      scope: "target",
      scriptName: validatedScriptName
    },
    ok: true,
    onClose: async ({ id }) => {
      await removeDockerContainer(targetScriptContainerName({
        terminalId: id
      }));
    },
    reuseRunning: false
  };
}

export {
  DEFAULT_TARGET_SCRIPT_NAMES,
  TARGET_SCRIPT_SHORTCUTS_CONFIG,
  TARGET_TERMINAL_HOST_DOCKER_CONFIG,
  createJskitTargetScriptTerminalSpec,
  inspectJskitCurrentApp,
  inspectJskitTargetScripts,
  resetJskitStarredTargetScripts,
  saveJskitStarredTargetScripts,
  targetScriptCommandPreview,
  targetScriptTerminalArgs
};
