import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  TargetAdapter,
  adapterActionResult,
  adapterCommand,
  adapterDetection,
  adapterProjectFacts
} from "../../adapter.js";
import {
  aiStudioError,
  isMissingPathError,
  normalizeText,
  pathExists
} from "../../core.js";
import { deepFreeze } from "../../deepFreeze.js";
import { PromptRenderer } from "../../promptRenderer.js";
import {
  createJskitTargetScriptTerminalSpec,
  inspectJskitCurrentApp,
  inspectJskitTargetScripts,
  resetJskitStarredTargetScripts,
  saveJskitStarredTargetScripts
} from "./currentApp.js";

const JSKIT_MARKERS = deepFreeze([
  {
    id: "package_json",
    label: "package.json",
    relativePath: "package.json"
  },
  {
    id: "public_config",
    label: "config/public.js",
    relativePath: "config/public.js"
  },
  {
    id: "client_entry",
    label: "src/main.js",
    relativePath: "src/main.js"
  },
  {
    id: "main_descriptor",
    label: "packages/main/package.descriptor.mjs",
    relativePath: "packages/main/package.descriptor.mjs"
  },
  {
    id: "jskit_lock",
    label: ".jskit/lock.json",
    relativePath: ".jskit/lock.json"
  }
]);

const JSKIT_BLUEPRINT_RELATIVE_PATH = ".jskit/APP_BLUEPRINT.md";
const JSKIT_PROMPT_PACK_ROOT = fileURLToPath(new URL("./prompts", import.meta.url));

function commandCapabilities(commands = []) {
  return Object.fromEntries(commands.map((command) => [command.id, true]));
}

function normalizeJskitCommands(commands = []) {
  return commands
    .map(adapterCommand)
    .sort((left, right) => left.id.localeCompare(right.id));
}

async function readJsonIfExists(filePath) {
  let text = "";
  try {
    text = await readFile(filePath, "utf8");
  } catch (error) {
    if (!isMissingPathError(error)) {
      throw error;
    }
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    throw aiStudioError(
      `Invalid JSON in JSKIT project file: ${filePath}`,
      "ai_studio_invalid_jskit_json"
    );
  }
}

async function inspectMarkers(targetRoot) {
  return Promise.all(JSKIT_MARKERS.map(async (marker) => {
    return {
      ...marker,
      exists: await pathExists(path.join(targetRoot, marker.relativePath))
    };
  }));
}

function allMarkersExist(markers) {
  return markers.every((marker) => marker.exists);
}

function missingMarkerLabels(markers) {
  return markers
    .filter((marker) => !marker.exists)
    .map((marker) => marker.label)
    .sort((left, right) => left.localeCompare(right));
}

function packageScripts(packageJson = {}) {
  return Object.keys(packageJson.scripts || {})
    .sort((left, right) => left.localeCompare(right));
}

function setupSummary(markers) {
  const missingLabels = missingMarkerLabels(markers);
  return missingLabels.length === 0
    ? "JSKIT project type selected."
    : `JSKIT project type selected. Missing markers: ${missingLabels.join(", ")}`;
}

function jskitAdapterCapabilities({
  commands = []
} = {}) {
  return commandCapabilities(commands);
}

function jskitPromptContext({
  blueprintExists = false,
  blueprintPath = "",
  markers = [],
  packageJson = {},
  targetRoot = ""
} = {}) {
  const resolvedBlueprintPath = blueprintPath || (targetRoot
    ? path.join(targetRoot, JSKIT_BLUEPRINT_RELATIVE_PATH)
    : JSKIT_BLUEPRINT_RELATIVE_PATH);
  return {
    adapter: "jskit",
    blueprint_exists: String(Boolean(blueprintExists)),
    blueprint_path: normalizeText(resolvedBlueprintPath),
    blueprint_relative_path: JSKIT_BLUEPRINT_RELATIVE_PATH,
    package_name: normalizeText(packageJson.name),
    scripts: packageScripts(packageJson).join(", "),
    target_root: normalizeText(targetRoot),
    valid_jskit_markers: String(allMarkersExist(markers))
  };
}

function jskitFacts({
  blueprintExists = false,
  commands = [],
  blueprintPath = "",
  markers = [],
  packageJson = {},
  targetRoot = ""
} = {}) {
  return adapterProjectFacts({
    capabilities: jskitAdapterCapabilities({
      commands
    }),
    commands,
    promptContext: jskitPromptContext({
      blueprintExists,
      blueprintPath,
      markers,
      packageJson,
      targetRoot
    }),
    summary: setupSummary(markers)
  });
}

class JskitTargetAdapter extends TargetAdapter {
  constructor({
    commandTerminalSpecFactory = null,
    commands = [],
    promptRenderer = new PromptRenderer({
      promptPackRoot: JSKIT_PROMPT_PACK_ROOT
    })
  } = {}) {
    super({
      id: "jskit",
      label: "JSKIT target adapter"
    });
    this.commandTerminalSpecFactory = typeof commandTerminalSpecFactory === "function"
      ? commandTerminalSpecFactory
      : null;
    this.commands = normalizeJskitCommands(commands);
    this.promptRenderer = promptRenderer;
  }

  async projectInspection(targetRoot) {
    const resolvedTargetRoot = path.resolve(targetRoot);
    const blueprintPath = path.join(resolvedTargetRoot, JSKIT_BLUEPRINT_RELATIVE_PATH);
    const [markers, packageJson, blueprintExists] = await Promise.all([
      inspectMarkers(resolvedTargetRoot),
      readJsonIfExists(path.join(resolvedTargetRoot, "package.json")),
      pathExists(blueprintPath)
    ]);
    return {
      blueprintExists,
      blueprintPath,
      markers,
      packageJson,
      targetRoot: resolvedTargetRoot
    };
  }

  async detect({ targetRoot } = {}) {
    void targetRoot;
    return adapterDetection({
      detected: true,
      reason: ""
    });
  }

  async inspect({ targetRoot } = {}) {
    return jskitFacts({
      ...await this.projectInspection(targetRoot || process.cwd()),
      commands: this.commands
    });
  }

  async getPromptContext({ facts = {}, targetRoot } = {}) {
    if (facts.promptContext) {
      return facts.promptContext;
    }
    return jskitPromptContext(await this.projectInspection(targetRoot || process.cwd()));
  }

  async listCommands({ facts = {} } = {}) {
    return (facts.commands || this.commands).map(adapterCommand);
  }

  async createCommandTerminalSpec(commandId, context = {}) {
    if (!this.commandTerminalSpecFactory) {
      return {
        ok: false,
        message: `JSKIT command ${commandId} does not have a terminal runner.`
      };
    }
    return this.commandTerminalSpecFactory({
      commandId,
      context,
      targetRoot: context.session?.targetRoot || context.targetRoot || ""
    });
  }

  async renderPrompt({
    action,
    input = {},
    session
  } = {}) {
    return this.promptRenderer.renderPrompt({
      action,
      input,
      session
    });
  }

  async finishSession() {
    return adapterActionResult({
      message: "Finished AI Studio session.",
      metadata: {
        session_finished: "yes"
      },
      status: "completed"
    });
  }

  async inspectCurrentApp({
    includeGit = true,
    targetRoot = ""
  } = {}) {
    return inspectJskitCurrentApp(targetRoot || process.cwd(), {
      includeGit
    });
  }

  async listCurrentAppTargetScripts({
    targetRoot = ""
  } = {}) {
    return inspectJskitTargetScripts(targetRoot || process.cwd());
  }

  async saveCurrentAppTargetScriptShortcuts({
    input = {},
    targetRoot = ""
  } = {}) {
    return saveJskitStarredTargetScripts(targetRoot || process.cwd(), input);
  }

  async resetCurrentAppTargetScriptShortcuts({
    targetRoot = ""
  } = {}) {
    return resetJskitStarredTargetScripts(targetRoot || process.cwd());
  }

  async createCurrentAppTargetScriptTerminalSpec({
    input = {},
    targetRoot = ""
  } = {}) {
    return createJskitTargetScriptTerminalSpec(targetRoot || process.cwd(), input);
  }
}

export {
  JSKIT_MARKERS,
  JSKIT_PROMPT_PACK_ROOT,
  JskitTargetAdapter
};
