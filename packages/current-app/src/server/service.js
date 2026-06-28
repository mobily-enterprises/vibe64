import {
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import path from "node:path";

import {
  closeTerminalSession,
  closeTerminalSessionsForNamespace,
  resizeTerminalSession,
  startTerminalSession,
  subscribeTerminalSession,
  writeTerminalSession
} from "@local/studio-terminal-core/server/terminalSessions";
import {
  vibe64Result
} from "@local/vibe64-core/server/serverResponses";
import {
  currentProjectScopeKey
} from "@local/vibe64-core/server/projectRequestContext";
import {
  sessionSourcePath
} from "@local/vibe64-core/server/sessionSourcePath";
import {
  readVibe64CapabilitySetupReadiness,
  readVibe64StudioReadiness,
  readVibe64SetupReadiness
} from "@local/vibe64-runtime/server/setupReadiness";
import {
  vibe64SessionDebugLog
} from "@local/vibe64-runtime/server/sessionDebugLog";
import {
  resolveStudioTargetRoot
} from "@local/vibe64-core/server/studioRoots";
import {
  projectServiceTargetRoot
} from "@local/vibe64-core/server/projectServiceSelection";
import {
  shellQuote
} from "@local/studio-terminal-core/server/shellCommands";
import {
  ensureTargetRuntimeNetwork
} from "@local/studio-terminal-core/server/runtimeContainers";

const PROJECT_SCRIPT_SOURCE = "project";
const ADAPTER_SCRIPT_SOURCE = "adapter";
const PROJECT_SCRIPTS_DIR = ".vibe64/scripts";
const STARRED_TARGET_SCRIPTS_CONFIG = "runtime-config/current-app/starred_scripts";
const TARGET_SCRIPT_TERMINAL_NAMESPACE = "current-app-target-script";
const PROJECT_SCRIPT_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;
const CONNECTIONS_DASHBOARD_ROUTE = "?tab=studio-setup";
const SETUP_DASHBOARD_ROUTE = "?tab=studio-setup";

function resolveCurrentAppRoot(appRoot) {
  return resolveStudioTargetRoot({
    explicitRoot: appRoot
  });
}

function targetScriptTerminalNamespacePrefix() {
  return `${TARGET_SCRIPT_TERMINAL_NAMESPACE}:${currentProjectScopeKey()}:`;
}

function targetScriptTerminalNamespace() {
  return `${targetScriptTerminalNamespacePrefix()}target`;
}

function emptyTargetScripts() {
  return {
    config: {
      exists: false,
      path: STARRED_TARGET_SCRIPTS_CONFIG
    },
    ok: true,
    scriptCount: 0,
    scripts: [],
    starredScriptIds: []
  };
}

function currentAppBeforeProjectType(targetRoot, projectType = {}) {
  return {
    adapter: "",
    adapterReady: false,
    appPath: "/",
    config: {},
    directories: [],
    git: {
      enabled: false
    },
    localPackages: {
      appPackageName: "",
      packages: []
    },
    markers: [],
    ok: true,
    projectType,
    ready: false,
    root: targetRoot,
    targetScripts: emptyTargetScripts()
  };
}

function currentAppBeforeSetup(targetRoot, projectType = {}, setup = {}) {
  return {
    ...currentAppBeforeProjectType(targetRoot, projectType),
    projectType,
    setup
  };
}

function currentAppBeforeProjectConfig(targetRoot, projectType = {}, projectConfig = {}) {
  return {
    ...currentAppBeforeProjectType(targetRoot, projectType),
    projectConfig,
    projectType
  };
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

function dashboardFix(route = "", label = "") {
  return {
    label,
    route
  };
}

function capability(enabled, reason = "", fix = null) {
  return {
    enabled: enabled === true,
    fix,
    reason: enabled === true ? "" : String(reason || "")
  };
}

function connectionRows(connections = {}) {
  if (Array.isArray(connections.connections)) {
    return connections.connections;
  }
  return [];
}

function connectionById(rows = [], connectionId = "", fallbackLabel = "") {
  const connection = rows.find((item) => String(item?.id || "") === connectionId);
  return connection || {
    connected: false,
    id: connectionId,
    label: fallbackLabel || connectionId,
    message: `${fallbackLabel || connectionId} is not connected.`,
    status: "unknown"
  };
}

function connectionRecord(connection = {}) {
  const connected = connection.ready === true || connection.connected === true;
  return {
    connected,
    fix: connection.fix && typeof connection.fix === "object" && !Array.isArray(connection.fix)
      ? {
          label: String(connection.fix.label || ""),
          route: String(connection.fix.route || "")
        }
      : null,
    id: String(connection.id || ""),
    label: String(connection.label || connection.id || ""),
    message: String(connection.message || ""),
    ready: connected,
    scopeLabel: String(connection.scopeLabel || ""),
    status: String(connection.status || (connected ? "connected" : "not_connected")),
    username: String(connection.username || "")
  };
}

function connectionDebugSummary(connection = {}) {
  return {
    connected: connection.connected === true,
    id: String(connection.id || ""),
    message: String(connection.message || ""),
    ready: connection.ready === true,
    status: String(connection.status || ""),
    username: String(connection.username || "")
  };
}

function connectionRowsDebugSummary(rows = []) {
  return Array.isArray(rows)
    ? rows.map((connection) => connectionDebugSummary(connectionRecord(connection)))
    : [];
}

function firstBlockedCapability(capabilities = []) {
  return capabilities.find((item) => item.enabled !== true && item.reason) || null;
}

function automaticSetupReason(setup = {}) {
  return String(setup.message || "Finish automatic setup before using this capability.");
}

function connectionSetupFix(connection = {}) {
  return connection.fix || dashboardFix(CONNECTIONS_DASHBOARD_ROUTE, "Open Setup");
}

function currentAppResult(operation) {
  return vibe64Result(operation, {
    fallbackCode: "vibe64_current_app_request_failed",
    fallbackMessage: "Current app request failed."
  });
}

function targetScriptId(source, name) {
  return `${source}:${String(name || "").trim()}`;
}

function parseScriptId(id = "") {
  const normalizedId = String(id || "").trim();
  const separatorIndex = normalizedId.indexOf(":");
  if (separatorIndex < 1) {
    return null;
  }
  const source = normalizedId.slice(0, separatorIndex);
  const name = normalizedId.slice(separatorIndex + 1);
  if (!source || !name || normalizedId.includes(",") || normalizedId.includes("\n") || normalizedId.includes("\r")) {
    return null;
  }
  return {
    id: normalizedId,
    name,
    source
  };
}

function normalizeScriptId(value) {
  return parseScriptId(value)?.id || "";
}

function isProjectScriptName(value) {
  return PROJECT_SCRIPT_NAME_PATTERN.test(String(value || ""));
}

function normalizeScriptRecord(script = {}, source = "") {
  const normalizedSource = String(source || "").trim();
  const name = String(script.name || "").trim();
  const id = normalizeScriptId(script.id) || targetScriptId(normalizedSource, name);
  const parsed = parseScriptId(id);
  if (!parsed || parsed.source !== normalizedSource || parsed.name !== name || !name) {
    return null;
  }
  return {
    command: String(script.command || ""),
    id,
    label: String(script.label || name),
    name,
    source: normalizedSource,
    starredByDefault: script.starredByDefault === true
  };
}

function sortedUniqueScriptIds(scriptIds = []) {
  return [...new Set(scriptIds.map(normalizeScriptId).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

async function readStarredScriptConfig(projectRuntimeRoot) {
  try {
    const source = await readFile(path.join(projectRuntimeRoot, STARRED_TARGET_SCRIPTS_CONFIG), "utf8");
    return {
      exists: true,
      scriptIds: sortedUniqueScriptIds(source.split(/[,\r\n]+/gu))
    };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {
        exists: false,
        scriptIds: []
      };
    }
    throw new Error(`Cannot read ${STARRED_TARGET_SCRIPTS_CONFIG}: ${String(error?.message || error)}`);
  }
}

async function writeStarredScriptConfig(projectRuntimeRoot, scriptIds = []) {
  const configPath = path.join(projectRuntimeRoot, STARRED_TARGET_SCRIPTS_CONFIG);
  await mkdir(path.dirname(configPath), {
    recursive: true
  });
  const sortedScriptIds = sortedUniqueScriptIds(scriptIds);
  await writeFile(configPath, sortedScriptIds.length > 0 ? `${sortedScriptIds.join(",")}\n` : "", "utf8");
  return {
    exists: true,
    scriptIds: sortedScriptIds
  };
}

async function removeStarredScriptConfig(projectRuntimeRoot) {
  await rm(path.join(projectRuntimeRoot, STARRED_TARGET_SCRIPTS_CONFIG), {
    force: true
  });
  return {
    exists: false,
    scriptIds: []
  };
}

async function readProjectScripts(targetRoot) {
  const scriptsRoot = path.join(targetRoot, PROJECT_SCRIPTS_DIR);
  let entries = [];
  try {
    entries = await readdir(scriptsRoot, {
      withFileTypes: true
    });
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }

  return entries
    .filter((entry) => entry.isFile() && isProjectScriptName(entry.name))
    .map((entry) => {
      const relativePath = path.posix.join(PROJECT_SCRIPTS_DIR, entry.name);
      return {
        command: `bash ${relativePath}`,
        id: targetScriptId(PROJECT_SCRIPT_SOURCE, entry.name),
        label: entry.name,
        name: entry.name,
        path: relativePath,
        source: PROJECT_SCRIPT_SOURCE
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}

function normalizeAdapterScripts(response = {}) {
  return (Array.isArray(response.scripts) ? response.scripts : [])
    .map((script) => normalizeScriptRecord(script, ADAPTER_SCRIPT_SOURCE))
    .filter(Boolean);
}

function mergeTargetScripts(adapterScripts = [], projectScripts = []) {
  return [...adapterScripts, ...projectScripts]
    .sort((left, right) => {
      if (left.source !== right.source) {
        return left.source === ADAPTER_SCRIPT_SOURCE ? -1 : 1;
      }
      return left.name.localeCompare(right.name);
    });
}

function resolveStarredScriptIds(scripts = [], config = {}) {
  const availableIds = new Set(scripts.map((script) => script.id));
  const configuredIds = sortedUniqueScriptIds(config.scriptIds || [])
    .filter((scriptId) => availableIds.has(scriptId));
  if (config.exists) {
    return configuredIds;
  }
  return scripts
    .filter((script) => script.starredByDefault)
    .map((script) => script.id);
}

function targetScriptsResponse({
  config = {},
  scripts = []
} = {}) {
  const starredScriptIds = resolveStarredScriptIds(scripts, config);
  const starredSet = new Set(starredScriptIds);
  return {
    config: {
      exists: config.exists === true,
      path: STARRED_TARGET_SCRIPTS_CONFIG
    },
    ok: true,
    scriptCount: scripts.length,
    scripts: scripts.map((script) => ({
      ...script,
      starred: starredSet.has(script.id)
    })),
    starredScriptIds
  };
}

function validateStarredScriptIds(scriptIds = [], scripts = []) {
  const availableIds = new Set(scripts.map((script) => script.id));
  const requestedScriptIds = Array.isArray(scriptIds) ? scriptIds : [];
  const malformed = requestedScriptIds
    .map((scriptId) => String(scriptId || "").trim())
    .filter((scriptId) => !normalizeScriptId(scriptId));
  const normalized = sortedUniqueScriptIds(requestedScriptIds);
  const invalid = normalized.filter((scriptId) => !availableIds.has(scriptId));
  const rejected = [...malformed, ...invalid];
  if (rejected.length > 0) {
    return targetScriptError(
      "invalid_target_script",
      `Unknown target script${rejected.length === 1 ? "" : "s"}: ${rejected.join(", ")}.`,
      {
        invalidScriptIds: rejected
      }
    );
  }
  return {
    ok: true,
    scriptIds: normalized
  };
}

function normalizeSessionId(value = "") {
  return String(value || "").trim();
}

function projectScriptStartupScript(script = {}) {
  return [
    "set +e",
    `printf '\\n[studio] $ %s\\n\\n' ${shellQuote(script.command)}`,
    `bash ${shellQuote(script.path)}`,
    "status=$?",
    "printf '\\n[studio] project script exited with code %s\\n' \"$status\"",
    "exit \"$status\""
  ].join("\n");
}

function projectScriptTerminalSpec(script = {}, targetRoot = "") {
  return {
    args: ["-lc", projectScriptStartupScript(script)],
    command: "bash",
    commandPreview: script.command,
    cwd: targetRoot,
    metadata: {
      scriptId: script.id,
      scriptSource: PROJECT_SCRIPT_SOURCE
    },
    ok: true
  };
}

function createService({
  appRoot = "",
  projectService,
  setupServices = {}
} = {}) {
  if (!projectService || typeof projectService.createRuntime !== "function") {
    throw new TypeError("createService requires feature.vibe64-project.service.");
  }

  function currentTargetRoot() {
    if (String(appRoot || "").trim()) {
      return resolveCurrentAppRoot(appRoot);
    }
    if (typeof projectService.currentProjectSourceRoot === "function") {
      const sourceRoot = String(projectService.currentProjectSourceRoot() || "").trim();
      if (sourceRoot) {
        return sourceRoot;
      }
    }
    return projectServiceTargetRoot(projectService);
  }

  async function sessionTargetRoot(input = {}) {
    const sessionId = normalizeSessionId(input?.sessionId);
    if (!sessionId) {
      return "";
    }
    const runtime = await createRuntime();
    if (!runtime || typeof runtime.getSession !== "function") {
      return "";
    }
    const session = await runtime.getSession(sessionId);
    return sessionSourcePath(session);
  }

  async function targetRootForInput(input = {}) {
    const targetRoot = await sessionTargetRoot(input) || currentTargetRoot();
    if (!targetRoot) {
      const error = new Error("Choose a project before using current-app tools.");
      error.code = "vibe64_project_not_selected";
      throw error;
    }
    return targetRoot;
  }

  function requireProjectRuntimeRoot() {
    const runtimeRoot = typeof projectService.currentProjectRuntimeRoot === "function"
      ? String(projectService.currentProjectRuntimeRoot() || "").trim()
      : typeof projectService.currentProjectLocalRoot === "function"
        ? String(projectService.currentProjectLocalRoot() || "").trim()
        : "";
    if (!runtimeRoot) {
      const error = new Error("Choose a project before using current-app tools.");
      error.code = "vibe64_project_not_selected";
      throw error;
    }
    return runtimeRoot;
  }

  function noProjectSelectedSetupReadiness() {
    return {
      currentStage: {
        id: "project-selection",
        label: "Project selection"
      },
      message: "Choose a project before checking setup.",
      ready: false,
      stages: []
    };
  }

  async function readProjectTypeState() {
    const readProjectType = typeof projectService.readCommittedProjectType === "function"
      ? projectService.readCommittedProjectType.bind(projectService)
      : typeof projectService.readProjectType === "function"
        ? projectService.readProjectType.bind(projectService)
        : null;
    const response = readProjectType
      ? await readProjectType()
      : null;
    return response?.projectType || {};
  }

  async function readProjectConfigState() {
    const readProjectConfig = typeof projectService.readCommittedProjectConfig === "function"
      ? projectService.readCommittedProjectConfig.bind(projectService)
      : typeof projectService.readProjectConfig === "function"
        ? projectService.readProjectConfig.bind(projectService)
        : null;
    const response = readProjectConfig
      ? await readProjectConfig()
      : null;
    return response?.config || {};
  }

  async function createRuntime() {
    return projectService.createRuntime();
  }

  function setupStageInput(input = {}) {
    return {
      vibe64User: input?.vibe64User || null,
      refresh: input?.refresh === true
    };
  }

  async function setupReadiness(options = {}) {
    if (!currentTargetRoot()) {
      return noProjectSelectedSetupReadiness();
    }
    return readVibe64SetupReadiness(setupServices, {
      ...options,
      input: setupStageInput(options.input || options)
    });
  }

  async function capabilitySetupReadiness(options = {}) {
    if (!currentTargetRoot()) {
      return noProjectSelectedSetupReadiness();
    }
    return readVibe64CapabilitySetupReadiness(setupServices, {
      ...options,
      input: setupStageInput(options.input || options)
    });
  }

  async function connectionReadiness(input = {}) {
    const connectionSetupService = setupServices.connectionSetupService;
    if (!connectionSetupService || typeof connectionSetupService.getStatus !== "function") {
      vibe64SessionDebugLog("server.currentApp.connectionReadiness.unavailable", {
        targetRoot: currentTargetRoot()
      });
      return {
        connections: [],
        blockedReason: "Connection status service is not available.",
        ok: false,
        ready: false,
        targetRoot: currentTargetRoot(),
        updatedAt: new Date().toISOString()
      };
    }
    vibe64SessionDebugLog("server.currentApp.connectionReadiness.start", {
      refresh: input?.refresh === true || String(input?.refresh || "") === "true",
      targetRoot: currentTargetRoot()
    });
    const result = await connectionSetupService.getStatus(setupStageInput(input));
    const rows = connectionRows(result);
    vibe64SessionDebugLog("server.currentApp.connectionReadiness.done", {
      connections: connectionRowsDebugSummary(rows),
      blockedReason: String(result.blockedReason || ""),
      ok: result.ok !== false,
      ready: result.ready === true,
      targetRoot: currentTargetRoot()
    });
    return result;
  }

  function capabilityState({
    connections = {},
    sessionSetup = {},
    setup = {}
  } = {}) {
    const rows = connectionRows(connections);
    const github = connectionRecord(connectionById(rows, "github", "Git"));
    const codex = connectionRecord(connectionById(rows, "codex", "Codex"));
    const selectedAiProvider = {
      ...codex,
      selected: true
    };
    const aiReady = selectedAiProvider.ready === true;
    const githubReady = github.ready === true;
    const setupReady = setup.ready === true;
    const sessionSetupReady = sessionSetup.ready === true;
    const setupFix = dashboardFix(SETUP_DASHBOARD_ROUTE, "Open Setup");
    const aiFix = connectionSetupFix(selectedAiProvider);
    const githubFix = connectionSetupFix(github);
    const chatCapability = capability(
      aiReady && sessionSetupReady,
      aiReady ? automaticSetupReason(sessionSetup) : "Finish local editor connection setup before using chat.",
      aiReady ? setupFix : aiFix
    );
    const createSessionCapability = capability(
      aiReady && githubReady && sessionSetupReady,
      firstBlockedCapability([
        capability(aiReady, "Finish local editor connection setup before starting a session.", aiFix),
        capability(githubReady, "Finish git connection setup before starting Git-backed session work.", githubFix),
        capability(sessionSetupReady, automaticSetupReason(sessionSetup), setupFix)
      ])?.reason || "",
      firstBlockedCapability([
        capability(aiReady, "Finish local editor connection setup before starting a session.", aiFix),
        capability(githubReady, "Finish git connection setup before starting Git-backed session work.", githubFix),
        capability(sessionSetupReady, automaticSetupReason(sessionSetup), setupFix)
      ])?.fix || null
    );

    return {
      capabilities: {
        chat: chatCapability,
        createSession: createSessionCapability,
        githubWorkflow: capability(githubReady, "Finish git connection setup before using Git-backed workflow actions.", githubFix),
        app: capability(true),
        preview: capability(setupReady, automaticSetupReason(setup), setupFix),
        runScripts: capability(true)
      },
      connections: {
        ai: {
          message: aiReady ? "Codex is selected and authenticated." : selectedAiProvider.message,
          providers: [selectedAiProvider],
          ready: aiReady,
          selectedProviderId: "codex"
        },
        github,
        ready: aiReady && githubReady,
        rows
      }
    };
  }

  async function studioReadiness(options = {}) {
    if (!currentTargetRoot()) {
      return noProjectSelectedSetupReadiness();
    }
    return readVibe64StudioReadiness(setupServices, {
      ...options,
      input: setupStageInput(options.input || options)
    });
  }

  async function projectConfigEnvironment() {
    return typeof projectService.projectConfigEnvironment === "function"
      ? projectService.projectConfigEnvironment()
      : {};
  }

  async function adapter() {
    return (await createRuntime()).adapter;
  }

  async function requireAdapterMethod(methodName) {
    const activeAdapter = await adapter();
    if (typeof activeAdapter?.[methodName] !== "function") {
      throw new Error(`Active Vibe64 adapter does not implement ${methodName}().`);
    }
    return activeAdapter[methodName].bind(activeAdapter);
  }

  async function listAdapterScripts(input = {}) {
    const targetRoot = await targetRootForInput(input);
    const runtime = await createRuntime();
    const listTargetScripts = await requireAdapterMethod("listCurrentAppTargetScripts");
    const response = await listTargetScripts({
      config: runtime.projectConfig,
      targetRoot
    });
    if (response?.ok === false) {
      return response;
    }
    return {
      ok: true,
      scripts: normalizeAdapterScripts(response)
    };
  }

  async function listAvailableTargetScripts(input = {}) {
    const targetRoot = await targetRootForInput(input);
    const [adapterScripts, projectScripts] = await Promise.all([
      listAdapterScripts(input),
      readProjectScripts(targetRoot)
    ]);
    if (adapterScripts.ok === false) {
      return adapterScripts;
    }
    return {
      ok: true,
      scripts: mergeTargetScripts(adapterScripts.scripts, projectScripts)
    };
  }

  async function terminalSpecForScript(script, input = {}) {
    const targetRoot = await targetRootForInput(input);
    if (script.source === PROJECT_SCRIPT_SOURCE) {
      return projectScriptTerminalSpec(script, targetRoot);
    }

    const runtime = await createRuntime();
    const createTerminalSpec = await requireAdapterMethod("createCurrentAppTargetScriptTerminalSpec");
    return createTerminalSpec({
      config: runtime.projectConfig,
      input: {
        scriptId: script.id
      },
      targetRoot
    });
  }

  return Object.freeze({
    async inspectCurrentApp(input = {}, options = {}) {
      void options;
      return currentAppResult(async () => {
        const targetRoot = currentTargetRoot();
        const projectType = await readProjectTypeState();
        if (projectType.ready !== true) {
          return currentAppBeforeProjectType(targetRoot, projectType);
        }
        const projectConfig = await readProjectConfigState();
        if (projectConfig.ready !== true) {
          return currentAppBeforeProjectConfig(targetRoot, projectType, projectConfig);
        }
        const setup = await capabilitySetupReadiness({
          input
        });
        if (setup.ready !== true) {
          return currentAppBeforeSetup(targetRoot, projectType, setup);
        }
        const runtime = await createRuntime();
        const projectRuntimeRoot = requireProjectRuntimeRoot();
        const inspectCurrentApp = await requireAdapterMethod("inspectCurrentApp");
        const [currentApp, availableScripts, scriptConfig] = await Promise.all([
          inspectCurrentApp({
            config: runtime.projectConfig,
            includeGit: input?.includeGit !== false,
            targetRoot
          }),
          listAvailableTargetScripts(input),
          readStarredScriptConfig(projectRuntimeRoot)
        ]);
        return {
          ...currentApp,
          targetScripts: availableScripts.ok === false
            ? availableScripts
            : targetScriptsResponse({
                config: scriptConfig,
                scripts: availableScripts.scripts
              })
        };
      });
    },

    async inspectSetupReadiness(input = {}) {
      return currentAppResult(() => setupReadiness({
        input
      }));
    },

    async inspectConnectionSetup(input = {}) {
      return currentAppResult(() => connectionReadiness(input));
    },

    async inspectCapabilities(input = {}) {
      return currentAppResult(async () => {
        vibe64SessionDebugLog("server.currentApp.capabilities.inspect.start", {
          targetRoot: currentTargetRoot()
        });
        const [setup, sessionSetup, connections] = await Promise.all([
          capabilitySetupReadiness({
            input
          }),
          studioReadiness({
            input
          }),
          connectionReadiness(input)
        ]);
        const state = capabilityState({
          connections,
          sessionSetup,
          setup
        });
        vibe64SessionDebugLog("server.currentApp.capabilities.inspect.done", {
          connections: connectionRowsDebugSummary(connectionRows(connections)),
          aiReady: state.connections.ai.ready === true,
          blockedReason: String(connections.blockedReason || ""),
          chatEnabled: state.capabilities.chat.enabled === true,
          createSessionEnabled: state.capabilities.createSession.enabled === true,
          createSessionReason: String(state.capabilities.createSession.reason || ""),
          githubReady: state.connections.github.ready === true,
          previewEnabled: state.capabilities.preview.enabled === true,
          sessionSetupReady: sessionSetup.ready === true,
          setupReady: setup.ready === true,
          targetRoot: currentTargetRoot()
        });
        return {
          ...state,
          ok: true,
          setup,
          targetRoot: currentTargetRoot(),
          updatedAt: new Date().toISOString()
        };
      });
    },

    async streamSetupReadiness(options = {}) {
      return currentAppResult(() => setupReadiness({
        emit: options.emit || null,
        input: setupStageInput(options)
      }));
    },

    async listTargetScripts(input = {}) {
      return currentAppResult(async () => {
        const projectRuntimeRoot = requireProjectRuntimeRoot();
        const [availableScripts, config] = await Promise.all([
          listAvailableTargetScripts(input),
          readStarredScriptConfig(projectRuntimeRoot)
        ]);
        if (availableScripts.ok === false) {
          return availableScripts;
        }
        return targetScriptsResponse({
          config,
          scripts: availableScripts.scripts
        });
      });
    },

    async saveStarredTargetScripts(input = {}) {
      return currentAppResult(async () => {
        const projectRuntimeRoot = requireProjectRuntimeRoot();
        const availableScripts = await listAvailableTargetScripts(input);
        if (availableScripts.ok === false) {
          return availableScripts;
        }
        const validation = validateStarredScriptIds(input?.scriptIds, availableScripts.scripts);
        if (validation.ok === false) {
          return validation;
        }
        const config = await writeStarredScriptConfig(projectRuntimeRoot, validation.scriptIds);
        return targetScriptsResponse({
          config,
          scripts: availableScripts.scripts
        });
      });
    },

    async resetStarredTargetScripts(input = {}) {
      return currentAppResult(async () => {
        const projectRuntimeRoot = requireProjectRuntimeRoot();
        const availableScripts = await listAvailableTargetScripts(input);
        if (availableScripts.ok === false) {
          return availableScripts;
        }
        const config = await removeStarredScriptConfig(projectRuntimeRoot);
        return targetScriptsResponse({
          config,
          scripts: availableScripts.scripts
        });
      });
    },

    async startTargetScriptTerminal(input = {}) {
      return currentAppResult(async () => {
        const targetRoot = await targetRootForInput(input);
        const scriptId = normalizeScriptId(input?.scriptId);
        if (!scriptId) {
          return targetScriptError("missing_target_script", "scriptId must identify a target script.");
        }
        const availableScripts = await listAvailableTargetScripts(input);
        if (availableScripts.ok === false) {
          return availableScripts;
        }
        const script = availableScripts.scripts.find((item) => item.id === scriptId);
        if (!script) {
          return targetScriptError("invalid_target_script", `Unknown target script: ${scriptId}.`);
        }

        const spec = await terminalSpecForScript(script, input);
        if (spec?.ok === false) {
          return spec;
        }
        if (!spec || typeof spec !== "object") {
          return targetScriptError(
            "invalid_target_script_terminal_spec",
            "The active Vibe64 adapter returned an invalid target script terminal spec."
          );
        }

        const namespace = targetScriptTerminalNamespace();
        if (spec.prepareTargetRuntimeNetwork === true) {
          await ensureTargetRuntimeNetwork(spec.targetRoot || targetRoot);
        }
        if (spec.closeExisting !== false) {
          await closeTerminalSessionsForNamespace(namespace);
        }
        const configEnv = await projectConfigEnvironment();
        return startTerminalSession({
          args: spec.args,
          command: spec.command,
          commandPreview: spec.commandPreview,
          cwd: spec.cwd || targetRoot,
          env: {
            ...configEnv,
            ...(spec.env || {})
          },
          maxRunning: spec.maxRunning || 1,
          metadata: spec.metadata || {},
          namespace,
          namespaceLimitPrefix: targetScriptTerminalNamespacePrefix(),
          onClose: spec.onClose,
          reuseRunning: spec.reuseRunning === true
        });
      });
    },

    async subscribeTargetScriptTerminal(terminalSessionId, subscriber) {
      return subscribeTerminalSession(terminalSessionId, subscriber, {
        namespace: targetScriptTerminalNamespace()
      });
    },

    writeTargetScriptTerminal(terminalSessionId, data) {
      return writeTerminalSession(terminalSessionId, data, {
        namespace: targetScriptTerminalNamespace()
      });
    },

    resizeTargetScriptTerminal(terminalSessionId, size) {
      return resizeTerminalSession(terminalSessionId, size, {
        namespace: targetScriptTerminalNamespace()
      });
    },

    closeTargetScriptTerminal(terminalSessionId) {
      return closeTerminalSession(terminalSessionId, {
        namespace: targetScriptTerminalNamespace()
      });
    }
  });
}

export {
  TARGET_SCRIPT_TERMINAL_NAMESPACE,
  createService,
  resolveCurrentAppRoot
};
