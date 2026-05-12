import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { access, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { loadAppConfigFromAppRoot } from "@jskit-ai/kernel/server/support";
import {
  abandonSession,
  createSession,
  inspectSessionDetails,
  listSessions,
  runSessionStep
} from "@jskit-ai/jskit-cli/server";
import {
  closeTerminalSession,
  closeTerminalSessionsForNamespace,
  startTerminalSession,
  subscribeTerminalSession,
  writeTerminalSession
} from "../../../../server/lib/terminalSessions.js";

const execFileAsync = promisify(execFile);
const TOOLCHAIN_IMAGE = "jskit-ai-studio-toolchain:0.1.0";
const TOOL_HOME_VOLUME = "jskit_ai_studio_tool_home";
const TERMINAL_NAMESPACE = "current-app-codex";
const TERMINAL_NAMESPACE_PREFIX = `${TERMINAL_NAMESPACE}:`;
const CODEX_THREAD_ID_FILE = "codex_thread_id";
const CODEX_THREAD_PROBE = "!echo $CODEX_THREAD_ID";
const CODEX_THREAD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const MAX_OPEN_ISSUE_SESSIONS = 3;
const CLOSED_SESSION_STATUSES = new Set(["abandoned", "finished"]);
const STUDIO_DAEMON_ID = crypto.randomUUID();

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

function codexStartupScript(codexThreadId = "") {
  const normalizedThreadId = normalizeCodexThreadId(codexThreadId);
  const codexOptions = "--dangerously-bypass-approvals-and-sandbox";
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
    "-w",
    worktree,
    TOOLCHAIN_IMAGE,
    "bash",
    "-lc",
    codexStartupScript(codexThreadId)
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
      }
      return response;
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
        onClose: ({ id }) => removeDockerContainer(codexContainerName({
          sessionId,
          terminalId: id
        })),
        reuseRunning: true
      }), codexThreadId);
    },

    async subscribeCodexTerminal(sessionId, terminalSessionId, subscriber) {
      const codexThreadId = await readCodexThreadId(inspectionRoot, sessionId);
      return withCodexThreadState(subscribeTerminalSession(terminalSessionId, subscriber, {
        namespace: terminalNamespace(sessionId)
      }), codexThreadId);
    },

    writeCodexTerminal(sessionId, terminalSessionId, data) {
      return writeTerminalSession(terminalSessionId, data, {
        namespace: terminalNamespace(sessionId)
      });
    },

    closeCodexTerminal(sessionId, terminalSessionId) {
      return closeTerminalSession(terminalSessionId, {
        namespace: terminalNamespace(sessionId)
      });
    }
  });
}

export {
  createService,
  inspectCurrentApp,
  resolveCurrentAppRoot
};
