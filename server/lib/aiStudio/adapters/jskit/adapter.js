import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  adapterProjectFacts
} from "../../adapter.js";
import {
  AiStudioDescribedWorkflowTargetAdapter,
  inspectDescribedProject
} from "../../workflowAdapter.js";
import {
  normalizeText
} from "../../core.js";
import { deepFreeze } from "../../deepFreeze.js";
import {
  createJskitTargetScriptTerminalSpec,
  inspectJskitCurrentApp,
  inspectJskitTargetScripts
} from "./currentApp.js";
import {
  createJskitSetupDoctorPlugin
} from "./setupDoctorPlugin.js";

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
const JSKIT_CONFIG_FIELDS = deepFreeze([
  {
    defaultValue: "none",
    description: "Future JSKIT database runtime preference.",
    id: "jskit_database_runtime",
    label: "Database runtime",
    options: [
      {
        label: "None",
        value: "none"
      },
      {
        label: "MariaDB",
        value: "mysql"
      },
      {
        label: "Postgres",
        value: "postgres"
      }
    ],
    type: "select"
  },
  {
    defaultValue: "none",
    description: "JSKIT create-app tenancy mode used when Studio seeds a new target.",
    id: "jskit_tenancy_mode",
    label: "Tenancy mode",
    options: [
      {
        label: "None",
        value: "none"
      },
      {
        label: "Personal",
        value: "personal"
      },
      {
        label: "Workspaces",
        value: "workspaces"
      }
    ],
    type: "select"
  }
]);

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
  adapter = null
} = {}) {
  return adapter?.workflowCapabilities() || {};
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
  adapter = null,
  blueprintExists = false,
  commands = [],
  blueprintPath = "",
  markers = [],
  packageJson = {},
  targetRoot = ""
} = {}) {
  return adapterProjectFacts({
    capabilities: jskitAdapterCapabilities({
      adapter
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

async function inspectJskitProject(targetRoot) {
  return inspectDescribedProject(targetRoot, {
    extra: async ({ exists, pathFor }) => {
      const blueprintPath = pathFor(JSKIT_BLUEPRINT_RELATIVE_PATH);
      return {
        blueprintExists: await exists(JSKIT_BLUEPRINT_RELATIVE_PATH),
        blueprintPath
      };
    },
    markers: JSKIT_MARKERS,
    packageJson: {
      defaultValue: {},
      invalidJsonCode: "ai_studio_invalid_jskit_json",
      invalidJsonMessage: (filePath) => `Invalid JSON in JSKIT project file: ${filePath}`
    }
  });
}

class JskitTargetAdapter extends AiStudioDescribedWorkflowTargetAdapter {
  constructor({
    commandTerminalSpecFactory = null,
    commands = [],
    launchTargetTerminalSpecFactory = null,
    launchTargets = () => []
  } = {}) {
    super({
      commandTerminalSpecFactory,
      commands,
      configFields: JSKIT_CONFIG_FIELDS,
      currentAppInspector: inspectJskitCurrentApp,
      defaultConfig: {
        jskit_database_runtime: "none",
        jskit_tenancy_mode: "none"
      },
      id: "jskit",
      label: "JSKIT target adapter",
      projectFacts: jskitFacts,
      projectInspection: inspectJskitProject,
      promptContext: jskitPromptContext,
      promptPackRoot: JSKIT_PROMPT_PACK_ROOT,
      setupDoctorPlugins: (context) => [
        createJskitSetupDoctorPlugin(context)
      ],
      launchTargetTerminalSpecFactory,
      launchTargets,
      targetScriptTerminalSpecFactory: createJskitTargetScriptTerminalSpec,
      targetScriptsInspector: inspectJskitTargetScripts
    });
  }
}

export {
  JSKIT_MARKERS,
  JSKIT_CONFIG_FIELDS,
  JSKIT_PROMPT_PACK_ROOT,
  JskitTargetAdapter,
  inspectJskitProject
};
