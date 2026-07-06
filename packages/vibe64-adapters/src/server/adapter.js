import {
  vibe64Error,
  isPlainObject,
  normalizeText
} from "@local/vibe64-core/server/core";
import {
  normalizeVibe64ComposerMenuGroupPath
} from "@local/vibe64-core/shared";
import {
  promptContextForAction,
  renderPromptWithOverrides
} from "./promptRenderer.js";
import {
  deploymentDatabaseNotRequiredService,
  deploymentEnvironmentResult,
  unsupportedDeploymentPublishPlan
} from "./deployment.js";
import {
  sourceEditorFilePolicyFromAdapterExclusions
} from "./sourceEditorFilePolicy.js";

const ADAPTER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;
const COMMAND_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;
const LAUNCH_TARGET_ID_PATTERN = COMMAND_ID_PATTERN;
const PREVIEW_ROUTE_PARAM_PATTERN = /:([A-Za-z][A-Za-z0-9_]*)/gu;

function sortedEntries(value = {}) {
  return Object.entries(isPlainObject(value) ? value : {})
    .sort(([left], [right]) => left.localeCompare(right));
}

function assertAdapterId(adapterId) {
  const normalizedAdapterId = normalizeText(adapterId);
  if (!ADAPTER_ID_PATTERN.test(normalizedAdapterId)) {
    throw vibe64Error(`Invalid Vibe64 adapter id: ${normalizedAdapterId || "(empty)"}`, "vibe64_invalid_adapter_id");
  }
  return normalizedAdapterId;
}

function assertCommandId(commandId) {
  const normalizedCommandId = normalizeText(commandId);
  if (!COMMAND_ID_PATTERN.test(normalizedCommandId)) {
    throw vibe64Error(`Invalid Vibe64 adapter command id: ${normalizedCommandId || "(empty)"}`, "vibe64_invalid_adapter_command_id");
  }
  return normalizedCommandId;
}

function assertLaunchTargetId(launchTargetId) {
  const normalizedLaunchTargetId = normalizeText(launchTargetId);
  if (!LAUNCH_TARGET_ID_PATTERN.test(normalizedLaunchTargetId)) {
    throw vibe64Error(`Invalid Vibe64 launch target id: ${normalizedLaunchTargetId || "(empty)"}`, "vibe64_invalid_launch_target_id");
  }
  return normalizedLaunchTargetId;
}

function normalizeLaunchTargetDisplay(value = "") {
  const display = normalizeText(value);
  return display === "minimized" || display === "expanded" ? display : "";
}

function normalizePreviewOption(input = {}) {
  const type = normalizeText(input.type);
  return {
    defaultValue: Array.isArray(input.defaultValue)
      ? input.defaultValue.map(normalizeText).filter(Boolean)
      : normalizeText(input.defaultValue),
    description: normalizeText(input.description),
    id: assertCommandId(input.id),
    label: normalizeText(input.label || input.id),
    placeholder: normalizeText(input.placeholder),
    type: type === "string-list" ? type : "text"
  };
}

function fallbackPreviewRouteId(pathTemplate = "") {
  const normalized = normalizeText(pathTemplate)
    .replace(/^\/+/u, "")
    .replace(/[^A-Za-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .slice(0, 96);
  return normalized ? `route_${normalized}` : "route_home";
}

function previewRouteParamNames(pathTemplate = "") {
  return [...String(pathTemplate || "").matchAll(PREVIEW_ROUTE_PARAM_PATTERN)]
    .map((match) => normalizeText(match[1]))
    .filter(Boolean);
}

function normalizePreviewRouteParam(input = {}, fallbackName = "") {
  const source = isPlainObject(input) ? input : {};
  const name = normalizeText(source.name || fallbackName);
  if (!/^[A-Za-z][A-Za-z0-9_]*$/u.test(name)) {
    return null;
  }
  return {
    defaultValue: normalizeText(source.defaultValue),
    description: normalizeText(source.description),
    label: normalizeText(source.label || name.replace(/([a-z0-9])([A-Z])/gu, "$1 $2")),
    name,
    placeholder: normalizeText(source.placeholder),
    required: source.required !== false
  };
}

function normalizePreviewRoute(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const pathTemplate = normalizeText(source.pathTemplate || source.path);
  if (!pathTemplate.startsWith("/")) {
    return null;
  }
  const declaredParams = new Map(
    (Array.isArray(source.params) ? source.params : [])
      .map((param) => normalizePreviewRouteParam(param))
      .filter(Boolean)
      .map((param) => [param.name, param])
  );
  const params = previewRouteParamNames(pathTemplate)
    .map((name) => declaredParams.get(name) || normalizePreviewRouteParam({}, name))
    .filter(Boolean);
  return {
    id: assertCommandId(source.id || fallbackPreviewRouteId(pathTemplate)),
    label: normalizeText(source.label || pathTemplate),
    params,
    pathTemplate
  };
}

function normalizePreviewRoutes(input = []) {
  return (Array.isArray(input) ? input : [])
    .map(normalizePreviewRoute)
    .filter(Boolean)
    .sort((left, right) => left.label.localeCompare(right.label) || left.pathTemplate.localeCompare(right.pathTemplate));
}

function normalizeCapabilityMap(capabilities = {}) {
  if (Array.isArray(capabilities)) {
    return Object.fromEntries(
      capabilities
        .map(normalizeText)
        .filter(Boolean)
        .sort((left, right) => left.localeCompare(right))
        .map((capability) => [capability, true])
    );
  }
  return Object.fromEntries(
    sortedEntries(capabilities).map(([capability, enabled]) => [normalizeText(capability), Boolean(enabled)])
  );
}

function normalizeStringMap(value = {}) {
  return Object.fromEntries(
    sortedEntries(value).map(([key, entry]) => [normalizeText(key), normalizeText(entry)])
  );
}

function normalizeWorkflowFacts(value = {}) {
  const facts = isPlainObject(value) ? value : {};
  return {
    seedRequired: facts.seedRequired === true
  };
}

function adapterDetection(input = {}) {
  return {
    detected: input.detected !== false,
    reason: normalizeText(input.reason)
  };
}

function adapterCommand(input = {}) {
  return {
    available: input.available !== false,
    disabledReason: normalizeText(input.disabledReason),
    id: assertCommandId(input.id),
    label: normalizeText(input.label || input.id)
  };
}

function adapterLaunchTarget(input = {}) {
  const previewOptions = Array.isArray(input.previewOptions)
    ? input.previewOptions.map(normalizePreviewOption)
    : [];
  const previewRoutes = normalizePreviewRoutes(input.previewRoutes);
  return {
    available: input.available !== false,
    defaultDisplay: normalizeLaunchTargetDisplay(input.defaultDisplay),
    disabledReason: normalizeText(input.disabledReason),
    id: assertLaunchTargetId(input.id),
    label: normalizeText(input.label || input.id),
    ...(previewOptions.length > 0 ? { previewOptions } : {}),
    ...(previewRoutes.length > 0 ? { previewRoutes } : {})
  };
}

function adapterComposerMenuItem(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const kind = normalizeText(source.kind || "template");
  const mode = normalizeText(source.mode || "prefill");
  const id = normalizeText(source.id);
  const label = normalizeText(source.label || id);
  const when = isPlainObject(source.when) ? source.when : null;
  const inputValue = isPlainObject(source.input) ? source.input : null;
  const groupPath = normalizeVibe64ComposerMenuGroupPath(source.groupPath);
  return {
    ...(normalizeText(source.actionId) ? { actionId: normalizeText(source.actionId) } : {}),
    disabledReason: normalizeText(source.disabledReason),
    enabled: source.enabled !== false,
    group: normalizeText(source.group) || groupPath[0] || "",
    ...(groupPath.length ? { groupPath } : {}),
    icon: normalizeText(source.icon),
    id,
    ...(inputValue ? { input: inputValue } : {}),
    ...(normalizeText(source.intentId) ? { intentId: normalizeText(source.intentId) } : {}),
    kind,
    label,
    mode,
    order: Number.isFinite(source.order) ? source.order : 0,
    ...(normalizeText(source.promptId) ? { promptId: normalizeText(source.promptId) } : {}),
    source: normalizeText(source.source),
    ...(normalizeText(source.systemPromptId) ? { systemPromptId: normalizeText(source.systemPromptId) } : {}),
    text: normalizeText(source.text),
    visible: source.visible !== false,
    ...(when ? { when } : {})
  };
}

function adapterComposerMenuItems(input = []) {
  return (Array.isArray(input) ? input : [])
    .map(adapterComposerMenuItem)
    .filter((item) => item.id && item.label);
}

function adapterActionResult(input = {}) {
  return {
    artifacts: normalizeStringMap(input.artifacts),
    metadata: normalizeStringMap(input.metadata),
    message: normalizeText(input.message),
    status: normalizeText(input.status || "completed")
  };
}

function adapterPromptResult(input = {}) {
  return {
    context: isPlainObject(input.context) ? input.context : {},
    originalPrompt: normalizeText(input.originalPrompt),
    prompt: normalizeText(input.prompt),
    promptId: normalizeText(input.promptId),
    promptOverridePath: normalizeText(input.promptOverridePath)
  };
}

function adapterProjectFacts(input = {}) {
  return {
    capabilities: normalizeCapabilityMap(input.capabilities),
    commands: Array.isArray(input.commands) ? input.commands.map(adapterCommand) : [],
    summary: normalizeText(input.summary),
    workflow: normalizeWorkflowFacts(input.workflow)
  };
}

function emptyTargetScripts() {
  return {
    config: {
      exists: false,
      path: ""
    },
    ok: true,
    scriptCount: 0,
    scripts: [],
    starredScriptIds: []
  };
}

function promptIdForAction(action = {}) {
  return normalizeText(action.promptId || action.id);
}

function promptJson(value = {}) {
  return JSON.stringify(value ?? {}, null, 2);
}

function defaultPromptText(action = {}) {
  return `Run the Vibe64 prompt action: ${normalizeText(action.label || promptIdForAction(action))}.`;
}

function adapterView({
  adapter,
  composerMenuItems = [],
  commands = [],
  detection = {},
  facts = {},
  managedServices = [],
  promptContext = {}
} = {}) {
  const normalizedFacts = adapterProjectFacts(facts);
  return {
    composerMenuItems: adapterComposerMenuItems(composerMenuItems),
    commands: commands.map(adapterCommand),
    detection: adapterDetection(detection),
    facts: normalizedFacts,
    id: adapter.id,
    label: adapter.label,
    managedServices: Array.isArray(managedServices) ? managedServices : [],
    promptContext: normalizeStringMap(promptContext)
  };
}

class TargetAdapter {
  constructor({
    id = "generic",
    label = "Generic target"
  } = {}) {
    this.id = assertAdapterId(id);
    this.label = normalizeText(label || id);
  }

  async detect() {
    return adapterDetection({
      detected: true
    });
  }

  async inspect() {
    return adapterProjectFacts();
  }

  async getPromptContext() {
    return {};
  }

  async listCommands() {
    return [];
  }

  async getConfigFields() {
    return [];
  }

  async getDefaultConfig() {
    return {};
  }

  async listComposerMenuItems() {
    return [];
  }

  async listComposerTemplates() {
    return [];
  }

  async listProjectTools() {
    return [];
  }

  async createCommandTerminalSpec(commandId) {
    return {
      ok: false,
      message: `Command ${assertCommandId(commandId)} does not have a terminal runner.`
    };
  }

  async listLaunchTargets() {
    return [];
  }

  async createLaunchTargetTerminalSpec({
    launchInput = {},
    launchTargetId = ""
  } = {}) {
    void launchInput;
    return {
      ok: false,
      message: `${this.label} does not provide launch target ${assertLaunchTargetId(launchTargetId)}.`
    };
  }

  async worktreeArchiveExclusions() {
    return [];
  }

  async sourceEditorPreloadDirectories() {
    return [];
  }

  async sourceEditorPreexpandedDirectories() {
    return [];
  }

  async sourceEditorFilePolicy(context = {}) {
    return sourceEditorFilePolicyFromAdapterExclusions({
      adapterId: this.id,
      preexpandedDirectories: await this.sourceEditorPreexpandedDirectories(context),
      preloadDirectories: await this.sourceEditorPreloadDirectories(context),
      worktreeArchiveExclusions: await this.worktreeArchiveExclusions(context)
    });
  }

  async getRuntimeConfigProfile() {
    return null;
  }

  async createDeploymentPublishPlan() {
    return unsupportedDeploymentPublishPlan({
      adapterId: this.id,
      label: this.label
    });
  }

  async getDeploymentEnvironment() {
    return deploymentEnvironmentResult({
      services: [
        deploymentDatabaseNotRequiredService()
      ]
    });
  }

  async runSessionAction({
    action = {}
  } = {}) {
    return adapterActionResult({
      message: `${this.label} does not provide action ${normalizeText(action.id) || "(unknown)"}.`,
      status: "blocked"
    });
  }

  async finishSession() {
    return adapterActionResult({
      message: "Finished Vibe64 session."
    });
  }

  async renderPrompt({
    action = {},
    config = {},
    input = {},
    session = {}
  } = {}) {
    const promptId = promptIdForAction(action);
    const context = promptContextForAction({
      action,
      config,
      input,
      session
    });
    return adapterPromptResult({
      context,
      ...await renderPromptWithOverrides({
        context,
        originalPrompt: defaultPromptText(action, input)
      }),
      promptId
    });
  }

  async getEditableArtifacts() {
    return [];
  }

  async getSetupDoctorPlugins() {
    return [];
  }

  async allowsStudioSelfTarget() {
    return false;
  }

  async inspectCurrentApp({ targetRoot = "" } = {}) {
    return {
      adapter: this.id,
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
      ready: true,
      root: normalizeText(targetRoot)
    };
  }

  async listCurrentAppTargetScripts() {
    return emptyTargetScripts();
  }

  async createCurrentAppTargetScriptTerminalSpec() {
    return {
      message: `${this.label} does not provide target script terminals.`,
      ok: false
    };
  }
}

export {
  TargetAdapter,
  adapterActionResult,
  adapterCommand,
  adapterDetection,
  adapterLaunchTarget,
  adapterPromptResult,
  adapterProjectFacts,
  adapterView,
  normalizeStringMap,
  promptIdForAction,
  promptJson
};
