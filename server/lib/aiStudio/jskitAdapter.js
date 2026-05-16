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
} from "./adapter.js";
import {
  aiStudioError,
  isMissingPathError,
  normalizeText,
  pathExists
} from "./core.js";
import { deepFreeze } from "./deepFreeze.js";
import { PromptRenderer } from "./promptRenderer.js";

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
const JSKIT_PROMPT_PACK_ROOT = fileURLToPath(new URL("./adapters/jskit/prompts", import.meta.url));

const JSKIT_BASE_CAPABILITIES = deepFreeze({
  accept_changes: true,
  commit_changes: true,
  create_issue_file: true,
  create_issue_on_gh: true,
  create_pr_file: true,
  create_pr_on_gh: true,
  create_worktree: true,
  edit_issue: true,
  edit_pr: true,
  finish_session: true,
  install_dependencies: true,
  merge_pr: true,
  prepare_for_merge: true,
  run_automated_checks: true,
  run_deep_ui_check: true,
  send_issue_prompt: true,
  sync_main_checkout: true
});

const JSKIT_BLUEPRINT_CAPABILITIES = deepFreeze({
  update_project_knowledge: true
});

const JSKIT_CAPABILITIES = deepFreeze({
  ...JSKIT_BASE_CAPABILITIES,
  ...JSKIT_BLUEPRINT_CAPABILITIES
});

const JSKIT_COMMANDS = deepFreeze([
  {
    id: "create_worktree",
    label: "Create worktree"
  },
  {
    id: "install_dependencies",
    label: "Install dependencies"
  },
  {
    id: "create_issue_on_gh",
    label: "Create issue on GH"
  },
  {
    id: "run_automated_checks",
    label: "Run automated checks"
  },
  {
    id: "accept_changes",
    label: "Accept changes"
  },
  {
    id: "commit_changes",
    label: "Commit changes"
  },
  {
    id: "create_pr_on_gh",
    label: "Create PR on GH"
  },
  {
    id: "merge_pr",
    label: "Merge PR"
  },
  {
    id: "sync_main_checkout",
    label: "Sync main checkout"
  },
  {
    id: "finish_session",
    label: "Finish session"
  }
]);

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
  return allMarkersExist(markers)
    ? "JSKIT project detected."
    : `Missing JSKIT markers: ${missingMarkerLabels(markers).join(", ")}`;
}

function jskitCapabilities({ blueprintExists = false, detected = false } = {}) {
  if (!detected) {
    return {};
  }
  return {
    ...JSKIT_BASE_CAPABILITIES,
    ...(blueprintExists ? JSKIT_BLUEPRINT_CAPABILITIES : {})
  };
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
  blueprintPath = "",
  markers = [],
  packageJson = {},
  targetRoot = ""
} = {}) {
  const detected = allMarkersExist(markers);
  return adapterProjectFacts({
    capabilities: jskitCapabilities({
      blueprintExists,
      detected
    }),
    commands: detected ? JSKIT_COMMANDS : [],
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

function notConfiguredCommandRunner({ commandId }) {
  return adapterActionResult({
    message: `JSKIT command ${commandId} needs a command runner before it can execute.`,
    status: "blocked"
  });
}

class JskitTargetAdapter extends TargetAdapter {
  constructor({
    commandRunner = notConfiguredCommandRunner,
    promptRenderer = new PromptRenderer({
      promptPackRoot: JSKIT_PROMPT_PACK_ROOT
    })
  } = {}) {
    super({
      id: "jskit",
      label: "JSKIT target adapter"
    });
    this.commandRunner = commandRunner;
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
    const resolvedTargetRoot = path.resolve(targetRoot || process.cwd());
    const markers = await inspectMarkers(resolvedTargetRoot);
    const detected = allMarkersExist(markers);
    return adapterDetection({
      detected,
      reason: detected ? "" : setupSummary(markers)
    });
  }

  async inspect({ targetRoot } = {}) {
    return jskitFacts(await this.projectInspection(targetRoot || process.cwd()));
  }

  async getPromptContext({ facts = {}, targetRoot } = {}) {
    if (facts.promptContext) {
      return facts.promptContext;
    }
    return jskitPromptContext(await this.projectInspection(targetRoot || process.cwd()));
  }

  async listCommands({ facts = {} } = {}) {
    return (facts.commands || []).map(adapterCommand);
  }

  async runCommand(commandId, context = {}) {
    const result = await this.commandRunner({
      commandId,
      context,
      targetRoot: context.session?.targetRoot || context.targetRoot || ""
    });
    return adapterActionResult(result);
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
}

export {
  JSKIT_CAPABILITIES,
  JSKIT_COMMANDS,
  JSKIT_MARKERS,
  JSKIT_PROMPT_PACK_ROOT,
  JskitTargetAdapter
};
