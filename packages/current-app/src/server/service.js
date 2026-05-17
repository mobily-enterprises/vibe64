import path from "node:path";
import process from "node:process";

import {
  closeTerminalSession,
  closeTerminalSessionsForNamespace,
  startTerminalSession,
  subscribeTerminalSession,
  writeTerminalSession
} from "../../../../server/lib/terminalSessions.js";
import {
  aiStudioResult
} from "../../../../server/lib/aiStudio/serverResponses.js";

const TARGET_SCRIPT_TERMINAL_NAMESPACE = "current-app-target-script";
const TARGET_SCRIPT_TERMINAL_NAMESPACE_PREFIX = `${TARGET_SCRIPT_TERMINAL_NAMESPACE}:`;

function resolveCurrentAppRoot(appRoot) {
  const configuredRoot = String(appRoot || process.env.JSKIT_STUDIO_TARGET_ROOT || "").trim();
  return path.resolve(configuredRoot || process.cwd());
}

function targetScriptTerminalNamespace() {
  return `${TARGET_SCRIPT_TERMINAL_NAMESPACE}:target`;
}

function emptyTargetScripts() {
  return {
    config: {
      exists: false,
      path: ""
    },
    ok: true,
    packageJsonPath: "",
    scriptCount: 0,
    scripts: [],
    starredScriptNames: []
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

function currentAppResult(operation) {
  return aiStudioResult(operation, {
    fallbackCode: "ai_studio_current_app_request_failed",
    fallbackMessage: "Current app request failed."
  });
}

function createService({
  appRoot = "",
  projectService
} = {}) {
  if (!projectService || typeof projectService.createRuntime !== "function") {
    throw new TypeError("createService requires feature.ai-studio-project.service.");
  }

  const targetRoot = resolveCurrentAppRoot(appRoot || projectService.targetRoot);

  async function readProjectTypeState() {
    const response = typeof projectService.readProjectType === "function"
      ? await projectService.readProjectType()
      : null;
    return response?.projectType || {};
  }

  async function createRuntime() {
    return projectService.createRuntime();
  }

  async function adapter() {
    return (await createRuntime()).adapter;
  }

  async function requireAdapterMethod(methodName) {
    const activeAdapter = await adapter();
    if (typeof activeAdapter?.[methodName] !== "function") {
      throw new Error(`Active AI Studio adapter does not implement ${methodName}().`);
    }
    return activeAdapter[methodName].bind(activeAdapter);
  }

  return Object.freeze({
    async inspectCurrentApp(input = {}, options = {}) {
      void options;
      return currentAppResult(async () => {
        const projectType = await readProjectTypeState();
        if (projectType.ready !== true) {
          return currentAppBeforeProjectType(targetRoot, projectType);
        }
        const inspectCurrentApp = await requireAdapterMethod("inspectCurrentApp");
        return inspectCurrentApp({
          includeGit: input?.includeGit !== false,
          targetRoot
        });
      });
    },

    async listTargetScripts() {
      return currentAppResult(async () => {
        const listTargetScripts = await requireAdapterMethod("listCurrentAppTargetScripts");
        return listTargetScripts({
          targetRoot
        });
      });
    },

    async saveStarredTargetScripts(input = {}) {
      return currentAppResult(async () => {
        const saveTargetScripts = await requireAdapterMethod("saveCurrentAppTargetScriptShortcuts");
        return saveTargetScripts({
          input,
          targetRoot
        });
      });
    },

    async resetStarredTargetScripts() {
      return currentAppResult(async () => {
        const resetTargetScripts = await requireAdapterMethod("resetCurrentAppTargetScriptShortcuts");
        return resetTargetScripts({
          targetRoot
        });
      });
    },

    async startTargetScriptTerminal(input = {}) {
      return currentAppResult(async () => {
        const createTerminalSpec = await requireAdapterMethod("createCurrentAppTargetScriptTerminalSpec");
        const spec = await createTerminalSpec({
          input,
          targetRoot
        });
        if (spec?.ok === false) {
          return spec;
        }
        if (!spec || typeof spec !== "object") {
          return targetScriptError(
            "invalid_target_script_terminal_spec",
            "The active AI Studio adapter returned an invalid target script terminal spec."
          );
        }

        const namespace = targetScriptTerminalNamespace();
        if (spec.closeExisting !== false) {
          await closeTerminalSessionsForNamespace(namespace);
        }
        return startTerminalSession({
          args: spec.args,
          command: spec.command,
          commandPreview: spec.commandPreview,
          cwd: spec.cwd || targetRoot,
          maxRunning: spec.maxRunning || 1,
          metadata: spec.metadata || {},
          namespace,
          namespaceLimitPrefix: TARGET_SCRIPT_TERMINAL_NAMESPACE_PREFIX,
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
