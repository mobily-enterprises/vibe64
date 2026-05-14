import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { access, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { loadAppConfigFromAppRoot } from "@jskit-ai/kernel/server/support";
import {
  abandonSession,
  adoptDependenciesInstalled,
  createSession,
  inspectSessionDiff,
  inspectSessionDetails,
  listSessions,
  runSessionStep
} from "@jskit-ai/jskit-cli/server";
import {
  closeTerminalSession,
  closeTerminalSessionsForNamespace,
  readTerminalSession,
  startTerminalSession,
  subscribeTerminalSession,
  writeTerminalSession
} from "../../../../server/lib/terminalSessions.js";
import {
  STUDIO_DAEMON_PID_LABEL
} from "../../../../server/lib/studioTerminalLabels.js";

const execFileAsync = promisify(execFile);
const TOOLCHAIN_IMAGE = "jskit-ai-studio-toolchain:0.1.0";
const TOOL_HOME_VOLUME = "jskit_ai_studio_tool_home";
const DEFAULT_APP_TEST_BUILD_COMMAND = "npm run build";
const DEFAULT_APP_TEST_SERVER_COMMAND = "npm run server";
const DEFAULT_APP_TEST_PORT = 4100;
const APP_TEST_CONFIG_DIR = ".jskit/config";
const APP_TEST_TESTRUN_COMMAND_CONFIG = `${APP_TEST_CONFIG_DIR}/testrun_command`;
const APP_TEST_SERVER_PORT_CONFIG = `${APP_TEST_CONFIG_DIR}/server_port`;
const TERMINAL_NAMESPACE = "current-app-codex";
const TERMINAL_NAMESPACE_PREFIX = `${TERMINAL_NAMESPACE}:`;
const STEP_TERMINAL_NAMESPACE = "current-app-session-step";
const STEP_TERMINAL_NAMESPACE_PREFIX = `${STEP_TERMINAL_NAMESPACE}:`;
const APP_TEST_TERMINAL_NAMESPACE = "current-app-test";
const APP_TEST_TERMINAL_NAMESPACE_PREFIX = `${APP_TEST_TERMINAL_NAMESPACE}:`;
const CODEX_THREAD_ID_FILE = "codex_thread_id";
const CODEX_THREAD_PROBE = "!echo $CODEX_THREAD_ID";
const CODEX_THREAD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const CODEX_SESSION_MODEL = "gpt-5.5";
const CODEX_SESSION_REASONING_EFFORT = "xhigh";
const MAX_OPEN_ISSUE_SESSIONS = 3;
const CLOSED_SESSION_STATUSES = new Set(["abandoned", "finished"]);
const STUDIO_DAEMON_ID = crypto.randomUUID();
const ATTACHMENT_CONTAINER_ROOT = "/studio-attachments";
const ATTACHMENT_HOST_ROOT = path.join(tmpdir(), "jskit-ai-studio", "attachments", STUDIO_DAEMON_ID);
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const ATTACHMENT_TTL_MS = 30 * 60 * 1000;
const attachmentCleanupTimers = new Map();

const JSKIT_APP_MARKERS = Object.freeze([
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

const PROJECT_DIRECTORIES = Object.freeze([
  { id: "src", label: "src", relativePath: "src" },
  { id: "packages", label: "packages", relativePath: "packages" },
  { id: "tests", label: "tests", relativePath: "tests" }
]);

function shellQuote(value) {
  const stringValue = String(value);
  if (/^[A-Za-z0-9_./:=@,+-]+$/.test(stringValue)) {
    return stringValue;
  }
  return `'${stringValue.replaceAll("'", "'\\''")}'`;
}

function dockerCommand(args) {
  return ["docker", ...args].map(shellQuote).join(" ");
}

function stableHash(value) {
  return crypto
    .createHash("sha256")
    .update(String(value || ""))
    .digest("hex")
    .slice(0, 12);
}

function codexContainerName({ sessionId, terminalId }) {
  return `jskit-ai-studio-codex-${stableHash(sessionId)}-${stableHash(terminalId)}`;
}

function normalizeCodexThreadId(value) {
  const threadId = String(value || "").trim();
  if (!CODEX_THREAD_ID_PATTERN.test(threadId)) {
    return "";
  }
  return threadId.toLowerCase();
}

function hostUserIdentityEnvArgs() {
  if (typeof process.getuid !== "function" || typeof process.getgid !== "function") {
    return [];
  }
  return [
    "-e",
    `JSKIT_HOST_UID=${process.getuid()}`,
    "-e",
    `JSKIT_HOST_GID=${process.getgid()}`
  ];
}

function terminalNamespace(sessionId) {
  return `${TERMINAL_NAMESPACE}:${String(sessionId || "")}`;
}

function stepTerminalNamespace(sessionId) {
  return `${STEP_TERMINAL_NAMESPACE}:${String(sessionId || "")}`;
}

function appTestTerminalNamespace(sessionId = "") {
  const normalizedSessionId = String(sessionId || "").trim();
  return normalizedSessionId
    ? `${APP_TEST_TERMINAL_NAMESPACE}:session:${normalizedSessionId}`
    : `${APP_TEST_TERMINAL_NAMESPACE}:target`;
}

function activeSessionDirectory(targetRoot, sessionId) {
  const normalizedSessionId = String(sessionId || "").trim();
  if (
    !normalizedSessionId ||
    normalizedSessionId.includes("/") ||
    normalizedSessionId.includes("\\") ||
    normalizedSessionId === "." ||
    normalizedSessionId === ".."
  ) {
    return "";
  }

  const activeRoot = path.resolve(targetRoot, ".jskit", "sessions", "active");
  const sessionPath = path.resolve(activeRoot, normalizedSessionId);
  if (!(sessionPath === activeRoot || sessionPath.startsWith(`${activeRoot}${path.sep}`))) {
    return "";
  }
  return sessionPath;
}

function codexThreadIdPath(targetRoot, sessionId) {
  const sessionPath = activeSessionDirectory(targetRoot, sessionId);
  return sessionPath ? path.join(sessionPath, CODEX_THREAD_ID_FILE) : "";
}

function isOpenIssueSession(session = {}) {
  return !CLOSED_SESSION_STATUSES.has(String(session.status || ""));
}

function issueSessionLimits(sessions = []) {
  return {
    maxOpenSessions: MAX_OPEN_ISSUE_SESSIONS,
    openSessionCount: sessions.filter(isOpenIssueSession).length
  };
}

function normalizeIssueSessionArchive(value = "") {
  const archive = String(value || "active").trim().toLowerCase() || "active";
  return ["active", "abandoned", "completed", "all"].includes(archive) ? archive : "active";
}

function decoratedIssueSessionList(response = {}, activeSessions = []) {
  const sessions = Array.isArray(response.sessions) ? response.sessions : [];
  return {
    ...response,
    limits: issueSessionLimits(activeSessions),
    sessions
  };
}

function containerWorkspacePath(targetRoot, absolutePath) {
  const relativePath = path.relative(targetRoot, absolutePath);
  if (!relativePath || relativePath === ".") {
    return "/workspace";
  }
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return "";
  }
  return path.posix.join("/workspace", ...relativePath.split(path.sep));
}

function attachmentSessionKey(targetRoot, sessionId) {
  return path.join(stableHash(targetRoot), stableHash(sessionId));
}

function attachmentHostDirectory(targetRoot, sessionId, attachmentId = "") {
  const parts = [
    ATTACHMENT_HOST_ROOT,
    ...attachmentSessionKey(targetRoot, sessionId).split(path.sep)
  ];
  if (attachmentId) {
    parts.push(attachmentId);
  }
  return path.join(...parts);
}

function attachmentContainerPath(targetRoot, sessionId, attachmentId, fileName) {
  return path.posix.join(
    ATTACHMENT_CONTAINER_ROOT,
    ...attachmentSessionKey(targetRoot, sessionId).split(path.sep),
    attachmentId,
    fileName
  );
}

function sanitizeAttachmentFileName(fileName = "") {
  const baseName = path.basename(String(fileName || "attachment").replaceAll("\\", "/"));
  const sanitized = baseName
    .replace(/[^\w .@+-]/gu, "_")
    .replace(/^\.+/u, "")
    .trim()
    .slice(0, 160);
  return sanitized || "attachment";
}

function decodeAttachmentData(value = "") {
  const raw = String(value || "").trim();
  const data = raw.includes(",") && /^data:[^,]+;base64,/iu.test(raw)
    ? raw.slice(raw.indexOf(",") + 1)
    : raw;
  const normalized = data.replace(/\s/gu, "");
  if (!normalized || !/^[A-Za-z0-9+/]*={0,2}$/u.test(normalized)) {
    return null;
  }
  return Buffer.from(normalized, "base64");
}

async function prepareAttachmentRoot() {
  await mkdir(ATTACHMENT_HOST_ROOT, {
    recursive: true
  });
}

async function cleanupCodexAttachments(targetRoot, sessionId, attachmentId = "") {
  const cleanupPath = attachmentId
    ? attachmentHostDirectory(targetRoot, sessionId, attachmentId)
    : attachmentHostDirectory(targetRoot, sessionId);
  const timerKey = `${stableHash(targetRoot)}:${stableHash(sessionId)}:${attachmentId}`;
  const timer = attachmentCleanupTimers.get(timerKey);
  if (timer) {
    clearTimeout(timer);
    attachmentCleanupTimers.delete(timerKey);
  }
  await rm(cleanupPath, {
    force: true,
    recursive: true
  });
}

function scheduleAttachmentCleanup(targetRoot, sessionId, attachmentId) {
  const timerKey = `${stableHash(targetRoot)}:${stableHash(sessionId)}:${attachmentId}`;
  const existingTimer = attachmentCleanupTimers.get(timerKey);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }
  const timer = setTimeout(() => {
    attachmentCleanupTimers.delete(timerKey);
    void cleanupCodexAttachments(targetRoot, sessionId, attachmentId);
  }, ATTACHMENT_TTL_MS);
  timer.unref?.();
  attachmentCleanupTimers.set(timerKey, timer);
}

function codexStartupScript(codexThreadId = "") {
  const normalizedThreadId = normalizeCodexThreadId(codexThreadId);
  const codexReasoningConfig = `model_reasoning_effort="${CODEX_SESSION_REASONING_EFFORT}"`;
  const codexOptions = [
    "--model",
    shellQuote(CODEX_SESSION_MODEL),
    "-c",
    shellQuote(codexReasoningConfig),
    "--dangerously-bypass-approvals-and-sandbox"
  ].join(" ");
  const codexCommand = normalizedThreadId
    ? `codex ${codexOptions} resume ${shellQuote(normalizedThreadId)}`
    : `codex ${codexOptions}`;
  return [
    "set -e",
    "if [ -n \"${JSKIT_HOST_UID:-}\" ] && [ -n \"${JSKIT_HOST_GID:-}\" ] && command -v setpriv >/dev/null 2>&1; then",
    "  mkdir -p /home/studio/.codex /home/studio/.config",
    "  chown -R \"$JSKIT_HOST_UID:$JSKIT_HOST_GID\" /home/studio/.codex /home/studio/.config",
    `  exec setpriv --reuid "$JSKIT_HOST_UID" --regid "$JSKIT_HOST_GID" --clear-groups env HOME=/home/studio ${codexCommand}`,
    "fi",
    `exec env HOME=/home/studio ${codexCommand}`
  ].join("\n");
}

function codexTerminalArgs({
  codexThreadId,
  containerName,
  sessionId,
  targetRoot,
  terminalId,
  worktree
}) {
  return [
    "run",
    "--rm",
    "-it",
    "--name",
    containerName,
    "--label",
    "jskit-ai-studio.kind=codex-terminal",
    "--label",
    `jskit-ai-studio.daemon=${STUDIO_DAEMON_ID}`,
    "--label",
    `${STUDIO_DAEMON_PID_LABEL}=${process.pid}`,
    "--label",
    `jskit-ai-studio.session=${sessionId}`,
    "--label",
    `jskit-ai-studio.terminal=${terminalId}`,
    "--label",
    `jskit-ai-studio.target=${stableHash(targetRoot)}`,
    "-v",
    `${TOOL_HOME_VOLUME}:/home/studio`,
    "-e",
    "HOME=/home/studio",
    ...hostUserIdentityEnvArgs(),
    "-v",
    `${targetRoot}:/workspace`,
    "-v",
    `${targetRoot}:${targetRoot}`,
    "-v",
    `${ATTACHMENT_HOST_ROOT}:${ATTACHMENT_CONTAINER_ROOT}:ro`,
    "-w",
    worktree,
    TOOLCHAIN_IMAGE,
    "bash",
    "-lc",
    codexStartupScript(codexThreadId)
  ];
}

function dependencyInstallScript() {
  const installCommand = [
    "set +e",
    "printf '\\n[studio] Installing dependencies in %s\\n' \"$PWD\"",
    "printf '[studio] $ npm install --foreground-scripts --no-audit --no-fund\\n\\n'",
    "NPM_CONFIG_AUDIT=false NPM_CONFIG_FUND=false NPM_CONFIG_YES=true npm_config_audit=false npm_config_fund=false npm_config_yes=true npm install --foreground-scripts --no-audit --no-fund",
    "status=$?",
    "printf '\\n[studio] npm install exited with code %s\\n' \"$status\"",
    "exit \"$status\""
  ].join("\n");
  return [
    "set -e",
    "mkdir -p /tmp/studio-home /tmp/npm-cache",
    "if [ -n \"${JSKIT_HOST_UID:-}\" ] && [ -n \"${JSKIT_HOST_GID:-}\" ] && command -v setpriv >/dev/null 2>&1; then",
    "  chown -R \"$JSKIT_HOST_UID:$JSKIT_HOST_GID\" /tmp/studio-home /tmp/npm-cache",
    `  exec setpriv --reuid "$JSKIT_HOST_UID" --regid "$JSKIT_HOST_GID" --clear-groups env HOME=/tmp/studio-home npm_config_cache=/tmp/npm-cache bash -lc ${shellQuote(installCommand)}`,
    "fi",
    `exec env HOME=/tmp/studio-home npm_config_cache=/tmp/npm-cache bash -lc ${shellQuote(installCommand)}`
  ].join("\n");
}

function dependencyInstallTerminalArgs({
  sessionId,
  targetRoot,
  terminalId,
  worktree
}) {
  return [
    "run",
    "--rm",
    "-it",
    "--label",
    "jskit-ai-studio.kind=session-step-terminal",
    "--label",
    `jskit-ai-studio.daemon=${STUDIO_DAEMON_ID}`,
    "--label",
    `${STUDIO_DAEMON_PID_LABEL}=${process.pid}`,
    "--label",
    `jskit-ai-studio.session=${sessionId}`,
    "--label",
    `jskit-ai-studio.terminal=${terminalId}`,
    "--label",
    `jskit-ai-studio.target=${stableHash(targetRoot)}`,
    "-v",
    `${targetRoot}:/workspace`,
    "-v",
    `${targetRoot}:${targetRoot}`,
    ...hostUserIdentityEnvArgs(),
    "-w",
    worktree,
    TOOLCHAIN_IMAGE,
    "bash",
    "-lc",
    dependencyInstallScript()
  ];
}

function appTestContainerName({ sessionId = "", terminalId }) {
  const scope = sessionId ? stableHash(sessionId) : "target";
  return `jskit-ai-studio-app-test-${scope}-${stableHash(terminalId)}`;
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

function normalizePreferredPort(value) {
  const port = Number.parseInt(String(value || ""), 10);
  if (Number.isInteger(port) && port >= 1024 && port <= 65535) {
    return port;
  }
  return DEFAULT_APP_TEST_PORT;
}

async function resolveAppTestConfig(appRoot) {
  const [testrunCommandConfig, portValue] = await Promise.all([
    readOptionalConfigFile(appRoot, APP_TEST_TESTRUN_COMMAND_CONFIG, ""),
    readOptionalConfigFile(
      appRoot,
      APP_TEST_SERVER_PORT_CONFIG,
      await readOptionalConfigFile(appRoot, "config/server_port", String(DEFAULT_APP_TEST_PORT))
    )
  ]);
  if (testrunCommandConfig) {
    return {
      buildCommand: "",
      commandSource: APP_TEST_TESTRUN_COMMAND_CONFIG,
      preferredPort: normalizePreferredPort(portValue),
      serverCommand: "",
      testrunCommand: testrunCommandConfig
    };
  }

  const [buildCommand, serverCommand] = await Promise.all([
    readOptionalConfigFile(appRoot, "config/build_command", DEFAULT_APP_TEST_BUILD_COMMAND),
    readOptionalConfigFile(appRoot, "config/server_command", DEFAULT_APP_TEST_SERVER_COMMAND)
  ]);
  return {
    buildCommand,
    commandSource: "legacy_split_commands",
    preferredPort: normalizePreferredPort(portValue),
    serverCommand,
    testrunCommand: `${buildCommand};${serverCommand}`
  };
}

function canListenOnPort(port) {
  return new Promise((resolve) => {
    const server = createNetServer();
    server.once("error", () => {
      resolve(false);
    });
    server.once("listening", () => {
      server.close(() => {
        resolve(true);
      });
    });
    server.listen(port, "127.0.0.1");
  });
}

async function findAvailablePort(preferredPort) {
  const startPort = normalizePreferredPort(preferredPort);
  for (let port = startPort; port <= 65535; port += 1) {
    if (await canListenOnPort(port)) {
      return port;
    }
  }
  throw new Error(`No localhost port is available at or after ${startPort}.`);
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

function appTestScript({
  port,
  testrunCommand
}) {
  const runCommand = [
    "set -e",
    "export HOST=0.0.0.0",
    `export PORT=${shellQuote(String(port))}`,
    `printf '\\n[studio] $ HOST=%s PORT=%s %s\\n\\n' "$HOST" "$PORT" ${shellQuote(testrunCommand)}`,
    testrunCommand
  ].join("\n");
  return [
    "set -e",
    "mkdir -p /tmp/studio-home /tmp/npm-cache",
    "if [ -n \"${JSKIT_HOST_UID:-}\" ] && [ -n \"${JSKIT_HOST_GID:-}\" ] && command -v setpriv >/dev/null 2>&1; then",
    "  chown -R \"$JSKIT_HOST_UID:$JSKIT_HOST_GID\" /tmp/studio-home /tmp/npm-cache",
    `  exec setpriv --reuid "$JSKIT_HOST_UID" --regid "$JSKIT_HOST_GID" --clear-groups env HOME=/tmp/studio-home npm_config_cache=/tmp/npm-cache bash -lc ${shellQuote(runCommand)}`,
    "fi",
    `exec env HOME=/tmp/studio-home npm_config_cache=/tmp/npm-cache bash -lc ${shellQuote(runCommand)}`
  ].join("\n");
}

function appTestTerminalArgs({
  containerName,
  port,
  sessionId = "",
  targetRoot,
  terminalId,
  testrunCommand,
  workdir
}) {
  return [
    "run",
    "--rm",
    "-it",
    "--name",
    containerName,
    "--label",
    "jskit-ai-studio.kind=app-test-terminal",
    "--label",
    `jskit-ai-studio.daemon=${STUDIO_DAEMON_ID}`,
    "--label",
    `${STUDIO_DAEMON_PID_LABEL}=${process.pid}`,
    "--label",
    `jskit-ai-studio.session=${sessionId || "target"}`,
    "--label",
    `jskit-ai-studio.terminal=${terminalId}`,
    "--label",
    `jskit-ai-studio.target=${stableHash(targetRoot)}`,
    "-p",
    `127.0.0.1:${port}:${port}`,
    "-v",
    `${targetRoot}:/workspace`,
    "-v",
    `${targetRoot}:${targetRoot}`,
    ...hostUserIdentityEnvArgs(),
    "-w",
    workdir,
    TOOLCHAIN_IMAGE,
    "bash",
    "-lc",
    appTestScript({
      port,
      testrunCommand
    })
  ];
}

async function removeDockerContainer(containerName) {
  if (!containerName) {
    return;
  }
  await execFileAsync("docker", ["rm", "-f", containerName], {
    timeout: 10000,
    maxBuffer: 1024 * 1024
  }).catch(() => null);
}

async function readCodexThreadId(targetRoot, sessionId) {
  const threadIdFile = codexThreadIdPath(targetRoot, sessionId);
  if (!threadIdFile) {
    return "";
  }
  try {
    return normalizeCodexThreadId(await readFile(threadIdFile, "utf8"));
  } catch {
    return "";
  }
}

async function saveCodexThreadId(targetRoot, sessionId, threadId) {
  const normalizedThreadId = normalizeCodexThreadId(threadId);
  const threadIdFile = codexThreadIdPath(targetRoot, sessionId);
  const sessionPath = activeSessionDirectory(targetRoot, sessionId);
  if (!normalizedThreadId || !threadIdFile || !sessionPath || !(await pathExists(sessionPath))) {
    return {
      ok: false,
      error: "Invalid Codex thread id."
    };
  }

  await writeFile(threadIdFile, `${normalizedThreadId}\n`, "utf8");
  return {
    ok: true,
    codexThreadId: normalizedThreadId
  };
}

function withCodexThreadState(response = {}, codexThreadId = "") {
  return {
    ...response,
    codexThreadId,
    needsThreadCapture: !codexThreadId,
    threadProbe: CODEX_THREAD_PROBE
  };
}

function normalizePlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function sortTextValues(values = []) {
  return [...values]
    .map((entry) => String(entry || "").trim())
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));
}

async function pathExists(absolutePath) {
  try {
    await access(absolutePath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonFile(absolutePath) {
  if (!(await pathExists(absolutePath))) {
    return {
      exists: false,
      data: null,
      error: ""
    };
  }

  try {
    const source = await readFile(absolutePath, "utf8");
    return {
      exists: true,
      data: JSON.parse(source),
      error: ""
    };
  } catch (error) {
    return {
      exists: true,
      data: null,
      error: String(error?.message || error)
    };
  }
}

async function inspectMarkers(appRoot) {
  const markers = [];
  for (const marker of JSKIT_APP_MARKERS) {
    markers.push({
      ...marker,
      exists: await pathExists(path.join(appRoot, marker.relativePath))
    });
  }
  return markers;
}

async function inspectDirectories(appRoot) {
  const directories = [];
  for (const directory of PROJECT_DIRECTORIES) {
    directories.push({
      ...directory,
      exists: await pathExists(path.join(appRoot, directory.relativePath))
    });
  }
  return directories;
}

async function inspectLocalPackages(appRoot) {
  const packagesPath = path.join(appRoot, "packages");
  if (!(await pathExists(packagesPath))) {
    return [];
  }

  try {
    const entries = await readdir(packagesPath, {
      withFileTypes: true
    });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));
  } catch {
    return [];
  }
}

function normalizeScripts(packageJson) {
  return Object.entries(normalizePlainObject(packageJson?.scripts))
    .map(([name, command]) => ({
      name,
      command: String(command || "")
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function normalizePackageNamesFromManifest(packageJson) {
  return sortTextValues([
    ...Object.keys(normalizePlainObject(packageJson?.dependencies)),
    ...Object.keys(normalizePlainObject(packageJson?.devDependencies)),
    ...Object.keys(normalizePlainObject(packageJson?.peerDependencies)),
    ...Object.keys(normalizePlainObject(packageJson?.optionalDependencies))
  ]);
}

function normalizeInstalledPackages(lockJson) {
  const installedPackages = normalizePlainObject(lockJson?.installedPackages);
  return Object.entries(installedPackages)
    .map(([fallbackPackageId, rawRecord]) => {
      const record = normalizePlainObject(rawRecord);
      const source = normalizePlainObject(record.source);
      return {
        packageId: String(record.packageId || fallbackPackageId),
        version: String(record.version || ""),
        sourceType: String(source.type || ""),
        packagePath: String(source.packagePath || "")
      };
    })
    .filter((record) => record.packageId)
    .sort((left, right) => left.packageId.localeCompare(right.packageId));
}

function packageIdMatches(packageId, fragments = []) {
  const normalizedPackageId = String(packageId || "").toLowerCase();
  return fragments.some((fragment) => normalizedPackageId.includes(fragment));
}

function detectRuntimeNeeds({ packageNames = [], installedPackages = [] } = {}) {
  const packageIds = sortTextValues([
    ...packageNames,
    ...installedPackages.map((entry) => entry.packageId)
  ]);

  return {
    auth: packageIds.some((packageId) => packageIdMatches(packageId, ["auth-"])),
    users: packageIds.some((packageId) => packageIdMatches(packageId, ["users-"])),
    workspaces: packageIds.some((packageId) => packageIdMatches(packageId, ["workspaces-"])),
    database: packageIds.some((packageId) => packageIdMatches(packageId, ["database-runtime"]))
  };
}

function normalizeSurfaces(appConfig) {
  const surfaceDefinitions = normalizePlainObject(appConfig?.surfaceDefinitions);
  return Object.values(surfaceDefinitions)
    .map((rawSurface) => {
      const surface = normalizePlainObject(rawSurface);
      return {
        id: String(surface.id || ""),
        label: String(surface.label || ""),
        pagesRoot: String(surface.pagesRoot || ""),
        enabled: surface.enabled === true,
        requiresAuth: surface.requiresAuth === true,
        requiresWorkspace: surface.requiresWorkspace === true,
        accessPolicyId: String(surface.accessPolicyId || "")
      };
    })
    .filter((surface) => surface.id)
    .sort((left, right) => left.id.localeCompare(right.id));
}

async function inspectConfig(appRoot) {
  const publicConfigExists = await pathExists(path.join(appRoot, "config/public.js"));
  const serverConfigExists = await pathExists(path.join(appRoot, "config/server.js"));
  if (!publicConfigExists) {
    return {
      publicConfigExists,
      serverConfigExists,
      loadError: "",
      tenancyMode: "",
      surfaceDefaultId: "",
      surfaces: []
    };
  }

  try {
    const appConfig = await loadAppConfigFromAppRoot({
      appRoot
    });
    return {
      publicConfigExists,
      serverConfigExists,
      loadError: "",
      tenancyMode: String(appConfig?.tenancyMode || ""),
      surfaceDefaultId: String(appConfig?.surfaceDefaultId || ""),
      surfaces: normalizeSurfaces(appConfig)
    };
  } catch (error) {
    return {
      publicConfigExists,
      serverConfigExists,
      loadError: String(error?.message || error),
      tenancyMode: "",
      surfaceDefaultId: "",
      surfaces: []
    };
  }
}

async function runGit(appRoot, args) {
  try {
    const result = await execFileAsync("git", args, {
      cwd: appRoot,
      timeout: 5000,
      maxBuffer: 1024 * 1024
    });
    return {
      ok: true,
      stdout: String(result.stdout || "").trim(),
      stderr: String(result.stderr || "").trim(),
      error: ""
    };
  } catch (error) {
    return {
      ok: false,
      stdout: String(error?.stdout || "").trim(),
      stderr: String(error?.stderr || "").trim(),
      error: String(error?.message || error)
    };
  }
}

function parseGitStatus(rawStatus) {
  return String(rawStatus || "")
    .split(/\r?\n/u)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => ({
      code: line.slice(0, 2).trim() || "??",
      path: line.slice(3).trim() || line.trim()
    }));
}

async function inspectGit(appRoot, { includeGit = true } = {}) {
  if (!includeGit) {
    return {
      checked: false,
      isRepo: false,
      rootPath: "",
      branch: "",
      dirty: false,
      changedFiles: [],
      error: ""
    };
  }

  const repoCheck = await runGit(appRoot, ["rev-parse", "--is-inside-work-tree"]);
  if (!repoCheck.ok || repoCheck.stdout !== "true") {
    return {
      checked: true,
      isRepo: false,
      rootPath: "",
      branch: "",
      dirty: false,
      changedFiles: [],
      error: repoCheck.stderr || repoCheck.error
    };
  }

  const [rootResult, branchResult, statusResult] = await Promise.all([
    runGit(appRoot, ["rev-parse", "--show-toplevel"]),
    runGit(appRoot, ["branch", "--show-current"]),
    runGit(appRoot, ["status", "--short"])
  ]);
  const changedFiles = parseGitStatus(statusResult.stdout);

  return {
    checked: true,
    isRepo: true,
    rootPath: rootResult.stdout,
    branch: branchResult.stdout,
    dirty: changedFiles.length > 0,
    changedFiles,
    error: statusResult.ok ? "" : statusResult.stderr || statusResult.error
  };
}

function resolveCurrentAppRoot(appRoot) {
  const configuredRoot = String(appRoot || process.env.JSKIT_STUDIO_TARGET_ROOT || "").trim();
  return path.resolve(configuredRoot || process.cwd());
}

async function inspectCurrentApp(appRoot, { includeGit = true } = {}) {
  const normalizedAppRoot = resolveCurrentAppRoot(appRoot);
  const [packageResult, lockResult, markers, directories, localPackages, config, git] = await Promise.all([
    readJsonFile(path.join(normalizedAppRoot, "package.json")),
    readJsonFile(path.join(normalizedAppRoot, ".jskit/lock.json")),
    inspectMarkers(normalizedAppRoot),
    inspectDirectories(normalizedAppRoot),
    inspectLocalPackages(normalizedAppRoot),
    inspectConfig(normalizedAppRoot),
    inspectGit(normalizedAppRoot, { includeGit })
  ]);

  const packageJson = normalizePlainObject(packageResult.data);
  const lockJson = normalizePlainObject(lockResult.data);
  const packageNames = normalizePackageNamesFromManifest(packageJson);
  const installedPackages = normalizeInstalledPackages(lockJson);
  const jskitPackagesFromLock = installedPackages.filter((entry) =>
    entry.packageId.startsWith("@jskit-ai/") || entry.packageId.startsWith("@local/")
  );
  const directJskitDependencies = packageNames.filter((packageName) =>
    packageName.startsWith("@jskit-ai/") || packageName.startsWith("@local/")
  );

  return Object.freeze({
    ok: true,
    rootPath: normalizedAppRoot,
    isJskitApp: markers.every((marker) => marker.exists),
    markers,
    directories,
    packageJson: {
      exists: packageResult.exists,
      error: packageResult.error,
      name: String(packageJson.name || ""),
      version: String(packageJson.version || ""),
      private: packageJson.private === true,
      scripts: normalizeScripts(packageJson),
      directJskitDependencies
    },
    jskitLock: {
      exists: lockResult.exists,
      error: lockResult.error,
      installedPackages: jskitPackagesFromLock
    },
    config,
    localPackages,
    runtimeNeeds: detectRuntimeNeeds({
      packageNames,
      installedPackages
    }),
    git
  });
}

async function startAppTestTerminalForRoot({
  inspectionRoot,
  runRoot,
  sessionId = ""
}) {
  const runRootPath = path.resolve(runRoot);
  const workspacePath = containerWorkspacePath(inspectionRoot, runRootPath);
  if (!workspacePath) {
    return {
      ok: false,
      error: "The app-test directory is outside the target root."
    };
  }

  const config = await resolveAppTestConfig(runRootPath);
  const port = await findAvailablePort(config.preferredPort);
  const urlPath = await defaultAppPath(runRootPath);
  const appUrl = `http://127.0.0.1:${port}${urlPath}`;
  const namespace = appTestTerminalNamespace(sessionId);
  const metadata = {
    appUrl,
    buildCommand: config.buildCommand,
    commandSource: config.commandSource,
    port,
    runRoot: runRootPath,
    scope: sessionId ? "session" : "target",
    serverCommand: config.serverCommand,
    sessionId: sessionId || "",
    testrunCommand: config.testrunCommand,
    urlPath
  };

  const response = startTerminalSession({
    args: ({ id }) => appTestTerminalArgs({
      containerName: appTestContainerName({
        sessionId,
        terminalId: id
      }),
      port,
      sessionId,
      targetRoot: inspectionRoot,
      terminalId: id,
      testrunCommand: config.testrunCommand,
      workdir: runRootPath
    }),
    command: "docker",
    commandPreview: ({ args }) => dockerCommand(args),
    cwd: inspectionRoot,
    maxRunning: MAX_OPEN_ISSUE_SESSIONS + 1,
    metadata,
    namespace,
    namespaceLimitPrefix: APP_TEST_TERMINAL_NAMESPACE_PREFIX,
    onClose: async ({ id }) => {
      await removeDockerContainer(appTestContainerName({
        sessionId,
        terminalId: id
      }));
    },
    reuseRunning: true
  });
  const responseMetadata = response.metadata || metadata;
  return {
    ...response,
    appUrl: responseMetadata.appUrl || appUrl,
    buildCommand: responseMetadata.buildCommand || config.buildCommand,
    commandSource: responseMetadata.commandSource || config.commandSource,
    port: responseMetadata.port || port,
    runRoot: responseMetadata.runRoot || runRootPath,
    serverCommand: responseMetadata.serverCommand || config.serverCommand,
    testrunCommand: responseMetadata.testrunCommand || config.testrunCommand,
    urlPath: responseMetadata.urlPath || urlPath
  };
}

function createService({ appRoot = "" } = {}) {
  const inspectionRoot = resolveCurrentAppRoot(appRoot);

  return Object.freeze({
    async inspectCurrentApp(input = {}, options = {}) {
      void options;
      return inspectCurrentApp(inspectionRoot, {
        includeGit: input?.includeGit !== false
      });
    },

    async listIssueSessions(input = {}) {
      const archive = normalizeIssueSessionArchive(input?.archive);
      const [response, activeResponse] = await Promise.all([
        listSessions({
          targetRoot: inspectionRoot,
          archive
        }),
        archive === "active"
          ? Promise.resolve(null)
          : listSessions({
              targetRoot: inspectionRoot,
              archive: "active"
            })
      ]);
      return decoratedIssueSessionList(response, (activeResponse || response).sessions || []);
    },

    async createIssueSession() {
      const existingSessions = await listSessions({
        targetRoot: inspectionRoot,
        archive: "active"
      });
      const limits = issueSessionLimits(existingSessions.sessions || []);
      if (limits.openSessionCount >= limits.maxOpenSessions) {
        return {
          ok: false,
          status: "blocked",
          errors: [
            {
              code: "open_session_limit",
              message: `Studio allows up to ${limits.maxOpenSessions} active sessions at once. Finish or abandon one before creating another.`
            }
          ],
          limits,
          sessions: decoratedIssueSessionList(existingSessions, existingSessions.sessions || []).sessions,
          stepDefinitions: existingSessions.stepDefinitions || []
        };
      }
      return createSession({
        targetRoot: inspectionRoot
      });
    },

    async inspectIssueSession(sessionId) {
      return inspectSessionDetails({
        targetRoot: inspectionRoot,
        sessionId
      });
    },

    async inspectIssueSessionDiff(sessionId) {
      return inspectSessionDiff({
        targetRoot: inspectionRoot,
        sessionId
      });
    },

    async runIssueSessionStep(sessionId, input = {}) {
      const response = await runSessionStep({
        targetRoot: inspectionRoot,
        sessionId,
        options: input || {}
      });
      const details = await inspectSessionDetails({
        targetRoot: inspectionRoot,
        sessionId
      });
      const result = {
        ...details,
        codex: response.codex || details.codex || null,
        currentStepAction: response.currentStepAction || details.currentStepAction || null,
        errors: response.errors || details.errors || [],
        ok: response.ok,
        preconditions: response.preconditions || details.preconditions || [],
        prompt: response.prompt || details.prompt || "",
        stepDefinitions: response.stepDefinitions || details.stepDefinitions || [],
        status: response.status || details.status
      };
      if (CLOSED_SESSION_STATUSES.has(String(result.status || ""))) {
        await closeTerminalSessionsForNamespace(terminalNamespace(sessionId));
        await closeTerminalSessionsForNamespace(stepTerminalNamespace(sessionId));
        await closeTerminalSessionsForNamespace(appTestTerminalNamespace(sessionId));
      }
      return result;
    },

    async abandonIssueSession(sessionId) {
      const response = await abandonSession({
        targetRoot: inspectionRoot,
        sessionId
      });
      if (String(response?.status || "") === "abandoned") {
        await closeTerminalSessionsForNamespace(terminalNamespace(sessionId));
        await closeTerminalSessionsForNamespace(stepTerminalNamespace(sessionId));
        await closeTerminalSessionsForNamespace(appTestTerminalNamespace(sessionId));
      }
      return response;
    },

    async startAppTestTerminal() {
      return startAppTestTerminalForRoot({
        inspectionRoot,
        runRoot: inspectionRoot
      });
    },

    async startIssueSessionAppTestTerminal(sessionId) {
      const session = await inspectSessionDetails({
        targetRoot: inspectionRoot,
        sessionId
      });
      if (session?.ok === false) {
        return session;
      }
      if (!session?.worktree || session.worktreeReady !== true) {
        return {
          ok: false,
          error: "Session worktree is not ready yet."
        };
      }
      return startAppTestTerminalForRoot({
        inspectionRoot,
        runRoot: session.worktree,
        sessionId
      });
    },

    async saveCodexThread(sessionId, input = {}) {
      const session = await inspectSessionDetails({
        targetRoot: inspectionRoot,
        sessionId
      });
      if (session?.ok === false) {
        return session;
      }
      return saveCodexThreadId(inspectionRoot, sessionId, input?.threadId);
    },

    async startCodexTerminal(sessionId) {
      const session = await inspectSessionDetails({
        targetRoot: inspectionRoot,
        sessionId
      });
      if (session?.ok === false) {
        return session;
      }
      if (!session?.worktree || session.worktreeReady !== true) {
        return {
          ok: false,
          error: "Session worktree is not ready yet."
        };
      }
      const worktreePath = path.resolve(session.worktree);
      const workspacePath = containerWorkspacePath(inspectionRoot, worktreePath);
      if (!workspacePath) {
        return {
          ok: false,
          error: "Session worktree is outside the target root."
        };
      }

      await prepareAttachmentRoot();
      const namespace = terminalNamespace(sessionId);
      const codexThreadId = await readCodexThreadId(inspectionRoot, sessionId);
      return withCodexThreadState(startTerminalSession({
        args: ({ id }) => codexTerminalArgs({
          codexThreadId,
          containerName: codexContainerName({
            sessionId,
            terminalId: id
          }),
          sessionId,
          targetRoot: inspectionRoot,
          terminalId: id,
          worktree: worktreePath
        }),
        command: "docker",
        commandPreview: ({ args }) => dockerCommand(args),
        cwd: inspectionRoot,
        maxRunning: MAX_OPEN_ISSUE_SESSIONS,
        namespace,
        namespaceLimitPrefix: TERMINAL_NAMESPACE_PREFIX,
        onClose: async ({ id }) => {
          await removeDockerContainer(codexContainerName({
            sessionId,
            terminalId: id
          }));
          await cleanupCodexAttachments(inspectionRoot, sessionId);
        },
        reuseRunning: true
      }), codexThreadId);
    },

    async startSessionStepTerminal(sessionId) {
      const session = await inspectSessionDetails({
        targetRoot: inspectionRoot,
        sessionId
      });
      if (session?.ok === false) {
        return session;
      }
      if (session?.currentStep !== "dependencies_installed") {
        return {
          ok: false,
          error: "The current session step does not run in the setup terminal."
        };
      }
      if (!session?.worktree || session.worktreeReady !== true) {
        return {
          ok: false,
          error: "Session worktree is not ready yet."
        };
      }
      const worktreePath = path.resolve(session.worktree);
      const workspacePath = containerWorkspacePath(inspectionRoot, worktreePath);
      if (!workspacePath) {
        return {
          ok: false,
          error: "Session worktree is outside the target root."
        };
      }

      const namespace = stepTerminalNamespace(sessionId);
      return startTerminalSession({
        args: ({ id }) => dependencyInstallTerminalArgs({
          sessionId,
          targetRoot: inspectionRoot,
          terminalId: id,
          worktree: worktreePath
        }),
        command: "docker",
        commandPreview: ({ args }) => dockerCommand(args),
        cwd: inspectionRoot,
        maxRunning: MAX_OPEN_ISSUE_SESSIONS,
        namespace,
        namespaceLimitPrefix: STEP_TERMINAL_NAMESPACE_PREFIX,
        onClose: async ({ exitCode }) => {
          if (exitCode === 0) {
            await adoptDependenciesInstalled({
              message: `Installed Node dependencies in ${worktreePath}.`,
              sessionId,
              targetRoot: inspectionRoot
            });
          }
        },
        reuseRunning: true
      });
    },

    async uploadCodexAttachment(sessionId, input = {}) {
      const session = await inspectSessionDetails({
        targetRoot: inspectionRoot,
        sessionId
      });
      if (session?.ok === false) {
        return session;
      }
      if (!session?.worktree || session.worktreeReady !== true) {
        return {
          ok: false,
          error: "Session worktree is not ready yet."
        };
      }

      const fileName = sanitizeAttachmentFileName(input?.fileName);
      const data = decodeAttachmentData(input?.dataBase64);
      if (!data || data.length < 1) {
        return {
          ok: false,
          error: "Attachment data is invalid."
        };
      }
      if (data.length > MAX_ATTACHMENT_BYTES) {
        return {
          ok: false,
          error: `Attachment is too large. Maximum size is ${Math.floor(MAX_ATTACHMENT_BYTES / 1024 / 1024)} MB.`
        };
      }

      const attachmentId = crypto.randomUUID();
      const hostDirectory = attachmentHostDirectory(inspectionRoot, sessionId, attachmentId);
      const hostPath = path.join(hostDirectory, fileName);
      await mkdir(hostDirectory, {
        recursive: true
      });
      await writeFile(hostPath, data);
      scheduleAttachmentCleanup(inspectionRoot, sessionId, attachmentId);

      return {
        ok: true,
        attachmentId,
        containerPath: attachmentContainerPath(inspectionRoot, sessionId, attachmentId, fileName),
        contentType: String(input?.contentType || ""),
        expiresInMs: ATTACHMENT_TTL_MS,
        fileName,
        size: data.length
      };
    },

    async subscribeCodexTerminal(sessionId, terminalSessionId, subscriber) {
      const codexThreadId = await readCodexThreadId(inspectionRoot, sessionId);
      return withCodexThreadState(subscribeTerminalSession(terminalSessionId, subscriber, {
        namespace: terminalNamespace(sessionId)
      }), codexThreadId);
    },

    async readCodexTerminal(sessionId, terminalSessionId) {
      const codexThreadId = await readCodexThreadId(inspectionRoot, sessionId);
      return withCodexThreadState(readTerminalSession(terminalSessionId, {
        namespace: terminalNamespace(sessionId)
      }), codexThreadId);
    },

    async subscribeSessionStepTerminal(sessionId, terminalSessionId, subscriber) {
      return subscribeTerminalSession(terminalSessionId, subscriber, {
        namespace: stepTerminalNamespace(sessionId)
      });
    },

    async subscribeAppTestTerminal(terminalSessionId, subscriber) {
      return subscribeTerminalSession(terminalSessionId, subscriber, {
        namespace: appTestTerminalNamespace()
      });
    },

    async subscribeIssueSessionAppTestTerminal(sessionId, terminalSessionId, subscriber) {
      return subscribeTerminalSession(terminalSessionId, subscriber, {
        namespace: appTestTerminalNamespace(sessionId)
      });
    },

    writeCodexTerminal(sessionId, terminalSessionId, data) {
      return writeTerminalSession(terminalSessionId, data, {
        namespace: terminalNamespace(sessionId)
      });
    },

    writeSessionStepTerminal(sessionId, terminalSessionId, data) {
      return writeTerminalSession(terminalSessionId, data, {
        namespace: stepTerminalNamespace(sessionId)
      });
    },

    writeAppTestTerminal(terminalSessionId, data) {
      return writeTerminalSession(terminalSessionId, data, {
        namespace: appTestTerminalNamespace()
      });
    },

    writeIssueSessionAppTestTerminal(sessionId, terminalSessionId, data) {
      return writeTerminalSession(terminalSessionId, data, {
        namespace: appTestTerminalNamespace(sessionId)
      });
    },

    closeCodexTerminal(sessionId, terminalSessionId) {
      return closeTerminalSession(terminalSessionId, {
        namespace: terminalNamespace(sessionId)
      });
    },

    closeSessionStepTerminal(sessionId, terminalSessionId) {
      return closeTerminalSession(terminalSessionId, {
        namespace: stepTerminalNamespace(sessionId)
      });
    },

    closeAppTestTerminal(terminalSessionId) {
      return closeTerminalSession(terminalSessionId, {
        namespace: appTestTerminalNamespace()
      });
    },

    closeIssueSessionAppTestTerminal(sessionId, terminalSessionId) {
      return closeTerminalSession(terminalSessionId, {
        namespace: appTestTerminalNamespace(sessionId)
      });
    }
  });
}

export {
  APP_TEST_TESTRUN_COMMAND_CONFIG,
  createService,
  inspectCurrentApp,
  resolveAppTestConfig,
  resolveCurrentAppRoot
};
