import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import {
  TargetAdapter,
  adapterActionResult,
  adapterCommand,
  adapterDetection,
  adapterLaunchTarget,
  adapterTerminalToolchainSpec
} from "./adapter.js";
import {
  vibe64Error,
  isMissingPathError,
  normalizeText,
  pathExists
} from "@local/vibe64-core/server/core";
import {
  deepFreeze
} from "@local/vibe64-core/server/deepFreeze";
import {
  PromptRenderer
} from "./promptRenderer.js";
import {
  createVibe64WorkflowCommandTerminalSpec
} from "./workflowCommandTerminal.js";
import {
  runVibe64WorkflowSessionAction
} from "./workflowSessionActions.js";

const VIBE64_WORKFLOW_COMMANDS = deepFreeze([
  {
    id: "commit_changes",
    label: "Commit and push changes"
  },
  {
    id: "create_issue_on_gh",
    label: "Create issue on GH"
  },
  {
    id: "create_pr_on_gh",
    label: "Create PR on GH"
  },
  {
    id: "create_worktree",
    label: "Create worktree"
  },
  {
    id: "finish_session",
    label: "Archive session"
  },
  {
    id: "install_dependencies",
    label: "Install dependencies"
  },
  {
    id: "merge_pr",
    label: "Merge PR"
  },
  {
    id: "run_automated_checks",
    label: "Run automated checks"
  },
  {
    id: "sync_main_checkout",
    label: "Sync main checkout"
  },
  {
    id: "update_code_index",
    label: "Update code index"
  }
]);

const VIBE64_WORKFLOW_SESSION_ACTION_CAPABILITIES = deepFreeze([
  "use_existing_issue",
  "use_existing_pr"
]);

function normalizeWorkflowCommands(commands = []) {
  return commands
    .map(adapterCommand)
    .sort((left, right) => left.id.localeCompare(right.id));
}

function normalizeLaunchTargets(targets = []) {
  return targets
    .map(adapterLaunchTarget)
    .sort((left, right) => left.id.localeCompare(right.id));
}

function vibe64WorkflowCapabilities({
  commands = [],
  extraCapabilities = []
} = {}) {
  return {
    ...Object.fromEntries(normalizeWorkflowCommands(commands).map((command) => [command.id, true])),
    ...Object.fromEntries(VIBE64_WORKFLOW_SESSION_ACTION_CAPABILITIES.map((capability) => [capability, true])),
    ...Object.fromEntries(extraCapabilities.map(normalizeText).filter(Boolean).map((capability) => [capability, true]))
  };
}

class Vibe64WorkflowTargetAdapter extends TargetAdapter {
  constructor({
    commandTerminalSpecFactory = null,
    commands = [],
    id = "generic",
    label = "Generic target",
    prepareWorktreeScriptPath = ""
  } = {}) {
    super({
      id,
      label
    });
    this.commandTerminalSpecFactory = typeof commandTerminalSpecFactory === "function"
      ? commandTerminalSpecFactory
      : null;
    this.commands = normalizeWorkflowCommands(commands);
    this.prepareWorktreeScriptPath = prepareWorktreeScriptPath;
  }

  workflowCapabilities(extra = {}) {
    return vibe64WorkflowCapabilities({
      commands: this.commands,
      ...extra
    });
  }

  async listCommands({ facts = {} } = {}) {
    return (facts.commands || this.commands).map(adapterCommand);
  }

  async getWorkflowCommandHooks() {
    return {};
  }

  async getPrepareWorktreeScriptPath(context = {}) {
    return normalizeText(await resolveValue(this.prepareWorktreeScriptPath, context));
  }

  async createCommandTerminalSpec(commandId, context = {}) {
    if (this.commandTerminalSpecFactory) {
      return this.commandTerminalSpecFactory({
        commandId,
        context,
        targetRoot: context.session?.targetRoot || context.targetRoot || ""
      });
    }
    return createVibe64WorkflowCommandTerminalSpec({
      commandId,
      context,
      hooks: await this.getWorkflowCommandHooks(context),
      prepareWorktreeScriptPath: await this.getPrepareWorktreeScriptPath(context),
      targetRoot: context.session?.targetRoot || context.targetRoot || ""
    });
  }

  async runSessionAction({
    action = {},
    input = {},
    session = {}
  } = {}) {
    return runVibe64WorkflowSessionAction(action.id, {
      input,
      session,
      targetRoot: session.targetRoot || process.cwd()
    });
  }

  async finishSession() {
    return adapterActionResult({
      message: "Finished Vibe64 session.",
      metadata: {
        session_finished: "yes"
      },
      status: "completed"
    });
  }
}

function resolveValue(value, context = {}) {
  return typeof value === "function" ? value(context) : value;
}

function createPromptRenderer({
  promptPackRoot = "",
  promptRenderer = null
} = {}) {
  if (promptRenderer) {
    return promptRenderer;
  }
  return promptPackRoot
    ? new PromptRenderer({
        promptPackRoot
      })
    : null;
}

async function readOptionalProjectJson(filePath, {
  defaultValue = null,
  invalidJsonCode = "vibe64_invalid_project_json",
  invalidJsonMessage = (invalidPath) => `Invalid JSON in project file: ${invalidPath}`
} = {}) {
  let text = "";
  try {
    text = await readFile(filePath, "utf8");
  } catch (error) {
    if (!isMissingPathError(error)) {
      throw error;
    }
    return defaultValue;
  }

  try {
    return JSON.parse(text);
  } catch {
    throw vibe64Error(invalidJsonMessage(filePath), invalidJsonCode);
  }
}

async function inspectProjectMarkers(targetRoot, markers = []) {
  return Promise.all(markers.map(async (marker) => {
    return {
      ...marker,
      exists: await pathExists(path.join(targetRoot, marker.relativePath))
    };
  }));
}

async function inspectDescribedProject(targetRoot, {
  extra = () => ({}),
  markers = [],
  packageJson = {}
} = {}) {
  const resolvedTargetRoot = path.resolve(targetRoot || process.cwd());
  const packageJsonOptions = {
    defaultValue: null,
    invalidJsonCode: "vibe64_invalid_project_json",
    invalidJsonMessage: (filePath) => `Invalid JSON in project file: ${filePath}`,
    key: "packageJson",
    relativePath: "package.json",
    ...packageJson
  };
  const markerResults = await inspectProjectMarkers(resolvedTargetRoot, markers);
  const packageJsonPath = path.join(resolvedTargetRoot, packageJsonOptions.relativePath);
  const packageJsonValue = await readOptionalProjectJson(packageJsonPath, packageJsonOptions);
  const context = {
    exists: (relativePath) => pathExists(path.join(resolvedTargetRoot, relativePath)),
    markers: markerResults,
    packageJson: packageJsonValue,
    packageJsonPath,
    pathFor: (relativePath) => path.join(resolvedTargetRoot, relativePath),
    targetRoot: resolvedTargetRoot
  };
  const extraInspection = await extra(context) || {};

  return {
    markers: markerResults,
    [packageJsonOptions.key]: packageJsonValue,
    targetRoot: resolvedTargetRoot,
    ...extraInspection
  };
}

class Vibe64DescribedWorkflowTargetAdapter extends Vibe64WorkflowTargetAdapter {
  constructor({
    commandTerminalSpecFactory = null,
    commands = [],
    configFields = [],
    currentAppInspector = null,
    defaultConfig = {},
    id = "generic",
    label = "Generic target",
    projectFacts = () => ({}),
    projectInspection = () => ({}),
    promptContext = () => ({}),
    promptPackRoot = "",
    promptRenderer = null,
    prepareWorktreeScriptPath = "",
    runtimeContainers = () => [],
    setupDoctorPlugins = () => [],
    terminalToolchain = null,
    launchTargetTerminalSpecFactory = null,
    launchTargets = () => [],
    targetScriptTerminalSpecFactory = null,
    targetScriptsInspector = null,
    workflowCommandHooks = () => ({})
  } = {}) {
    super({
      commandTerminalSpecFactory,
      commands,
      id,
      label,
      prepareWorktreeScriptPath
    });
    this.configFields = configFields;
    this.currentAppInspector = currentAppInspector;
    this.defaultConfig = defaultConfig;
    this.projectFactsFactory = projectFacts;
    this.projectInspectionFactory = projectInspection;
    this.promptContextFactory = promptContext;
    this.promptRenderer = createPromptRenderer({
      promptPackRoot,
      promptRenderer
    });
    this.runtimeContainersFactory = runtimeContainers;
    this.setupDoctorPluginsFactory = setupDoctorPlugins;
    this.terminalToolchainFactory = terminalToolchain;
    this.launchTargetTerminalSpecFactory = typeof launchTargetTerminalSpecFactory === "function"
      ? launchTargetTerminalSpecFactory
      : null;
    this.launchTargetsFactory = launchTargets;
    this.targetScriptTerminalSpecFactory = targetScriptTerminalSpecFactory;
    this.targetScriptsInspector = targetScriptsInspector;
    this.workflowCommandHooksFactory = workflowCommandHooks;
  }

  async projectInspection(targetRoot, context = {}) {
    return this.projectInspectionFactory(targetRoot || process.cwd(), {
      adapter: this,
      ...context
    });
  }

  async detect({ targetRoot } = {}) {
    void targetRoot;
    return adapterDetection({
      detected: true,
      reason: ""
    });
  }

  async inspect({ targetRoot, ...context } = {}) {
    return this.projectFactsFactory({
      adapter: this,
      ...await this.projectInspection(targetRoot || process.cwd(), context),
      commands: this.commands,
      config: context.config || {}
    });
  }

  async getPromptContext({ facts = {}, targetRoot, ...context } = {}) {
    if (facts.promptContext) {
      return facts.promptContext;
    }
    return this.promptContextFactory({
      ...await this.projectInspection(targetRoot || process.cwd(), context),
      config: context.config || {}
    });
  }

  async getSetupDoctorPlugins(context = {}) {
    return resolveValue(this.setupDoctorPluginsFactory, context) || [];
  }

  async getConfigFields() {
    return resolveValue(this.configFields) || [];
  }

  async getDefaultConfig() {
    return resolveValue(this.defaultConfig) || {};
  }

  async getTerminalToolchainSpec(context = {}) {
    return adapterTerminalToolchainSpec(await resolveValue(this.terminalToolchainFactory, context) || {});
  }

  async listRuntimeContainers(context = {}) {
    const descriptors = await resolveValue(this.runtimeContainersFactory, context);
    return Array.isArray(descriptors) ? descriptors.filter(Boolean) : [];
  }

  async getWorkflowCommandHooks(context = {}) {
    return resolveValue(this.workflowCommandHooksFactory, context) || {};
  }

  async listLaunchTargets(context = {}) {
    return normalizeLaunchTargets(await resolveValue(this.launchTargetsFactory, context) || []);
  }

  async createLaunchTargetTerminalSpec({
    context = {},
    launchTargetId = ""
  } = {}) {
    if (!this.launchTargetTerminalSpecFactory) {
      return super.createLaunchTargetTerminalSpec({
        launchTargetId
      });
    }
    return this.launchTargetTerminalSpecFactory({
      context,
      launchTargetId,
      session: context.session || {},
      targetRoot: context.session?.targetRoot || context.targetRoot || ""
    });
  }

  async renderPrompt(options = {}) {
    if (!this.promptRenderer) {
      return super.renderPrompt(options);
    }
    return this.promptRenderer.renderPrompt(options);
  }

  async inspectCurrentApp({
    config = {},
    includeGit = true,
    targetRoot = ""
  } = {}) {
    if (!this.currentAppInspector) {
      return super.inspectCurrentApp({
        targetRoot
      });
    }
    return this.currentAppInspector(targetRoot || process.cwd(), {
      config,
      includeGit
    });
  }

  async listCurrentAppTargetScripts({
    config = {},
    targetRoot = ""
  } = {}) {
    if (!this.targetScriptsInspector) {
      return super.listCurrentAppTargetScripts({
        config,
        targetRoot
      });
    }
    return this.targetScriptsInspector(targetRoot || process.cwd(), {
      config
    });
  }

  async createCurrentAppTargetScriptTerminalSpec({
    config = {},
    input = {},
    targetRoot = ""
  } = {}) {
    if (!this.targetScriptTerminalSpecFactory) {
      return super.createCurrentAppTargetScriptTerminalSpec({
        config,
        input,
        targetRoot
      });
    }
    return this.targetScriptTerminalSpecFactory(targetRoot || process.cwd(), input, {
      config
    });
  }
}

export {
  VIBE64_WORKFLOW_COMMANDS,
  VIBE64_WORKFLOW_SESSION_ACTION_CAPABILITIES,
  Vibe64DescribedWorkflowTargetAdapter,
  Vibe64WorkflowTargetAdapter,
  vibe64WorkflowCapabilities,
  createVibe64WorkflowCommandTerminalSpec,
  inspectDescribedProject,
  normalizeWorkflowCommands
};
