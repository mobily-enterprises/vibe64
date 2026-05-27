import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  adapterProjectFacts
} from "../../adapter.js";
import {
  packageBinCommand,
  packageScript,
  readPackageJson,
  runScriptCommand
} from "../../nodePackage.js";
import {
  VIBE64_CODE_INDEX_SCRIPT_NAME,
  VIBE64_VERIFY_SCRIPT_NAME,
  packageManagerScriptCommand
} from "../../codeIndexCommands.js";
import {
  nodeInstallWorkflowHook,
  nodePackageManagerInspectionExtra,
  studioCommandScript
} from "../../nodeWebProject.js";
import {
  Vibe64DescribedWorkflowTargetAdapter,
  inspectDescribedProject
} from "../../workflowAdapter.js";
import {
  normalizeText
} from "@local/vibe64-core/server/core";
import { deepFreeze } from "@local/vibe64-core/server/deepFreeze";
import {
  createJskitTargetScriptTerminalSpec,
  inspectJskitCurrentApp,
  inspectJskitTargetScripts
} from "./currentApp.js";
import {
  createJskitSetupDoctorPlugin
} from "./setupDoctorPlugin.js";
import {
  createJskitMariaDbRuntimeContainer,
  jskitMariaDbDatabaseName,
  JSKIT_MARIADB_HOST,
  readDatabaseHostFromDotEnv
} from "./setupMariaDbRuntime.js";
import {
  JSKIT_TOOLCHAIN_IMAGE
} from "./toolchainIdentity.js";

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
const JSKIT_PREPARE_WORKTREE_SCRIPT_PATH = fileURLToPath(new URL("./prepareWorktree.sh", import.meta.url));
const JSKIT_ALLOW_SELF_TARGET_CONFIG = "jskit_allow_self_target";
const JSKIT_DATABASE_RUNTIME_CONFIG = "jskit_database_runtime";
const JSKIT_TOOLING_CONTRACT = [
  "Use `npx jskit ...` from the repository root for JSKIT inspection, modules, generators, helper maps, and verification.",
  "New JSKIT-owned files must be created by `npx jskit generate ...`, `npx jskit add ...`, or another documented JSKIT CLI command before manual edits.",
  "Do not hand-create packages, package descriptors, provider entrypoints, route files, resource modules, database modules, migrations, generated client surfaces, page trees, or package glue.",
  "Before adding helpers, composables, service functions, maps, package glue, or provider wiring, run `npx jskit helper-map update` and inspect `.jskit/helper-map.md` or `npx jskit helper-map --json`.",
  "Before writing generic helpers for JSON:API documents, route ownership, workspace params, CRUD repositories, dates, normalization, transport, or generated resource data, search JSKIT package exports and agent-doc references first. Do not implement framework-shaped helpers locally unless no exported JSKIT helper exists and the decision is called out.",
  "For application features, read the agent-friendly JSKIT guide first, then inspect the JSKIT catalog with `npx jskit list`, `npx jskit list generators`, and `npx jskit show <package>`.",
  "After generator output exists, make only narrow manual edits on top of generated files when the generator cannot express the requested behavior."
].join("\n");
const JSKIT_AGENT_GUIDE_CONTRACT = [
  "Read the agent-friendly JSKIT guide before adding features: `node_modules/@jskit-ai/agent-docs/guide/agent/index.md` and the specific guide pages for the work.",
  "For database and CRUD work, read `node_modules/@jskit-ai/agent-docs/guide/agent/app-setup/database-layer.md`, `node_modules/@jskit-ai/agent-docs/guide/agent/generators/crud-generators.md`, and `node_modules/@jskit-ai/agent-docs/patterns/crud-scaffolding.md` before choosing commands.",
  "For UI, pages, links, menus, tabs, outlets, or placement work, read `node_modules/@jskit-ai/agent-docs/guide/agent/generators/ui-generators.md` and `node_modules/@jskit-ai/agent-docs/patterns/placements.md` before implementation.",
  "Use individual `npx jskit generate ... help` commands only when the guide and baseline discovery commands do not provide the exact syntax or option names needed for the current task."
].join("\n");
const JSKIT_PLACEMENT_CONTRACT = [
  "Before creating or changing navigation links, menu entries, tabs, outlets, or placement targets, read the agent-friendly placement docs: `node_modules/@jskit-ai/agent-docs/patterns/placements.md` and `node_modules/@jskit-ai/agent-docs/guide/agent/generators/ui-generators.md`.",
  "Inspect placement state with `npx jskit list-placements --json`; use `--concrete` or `--all` only when concrete outlet details are needed.",
  "Place links through JSKIT generator options and semantic placement conventions first: `ui-generator page`, `crud-ui-generator crud`, `--link-placement`, `--navigation-role`, and `--link-to`.",
  "Do not hand-edit `src/placement.js` for generated links unless the generator cannot express the required placement and the docs plus `jskit list-placements` prove the target semantics.",
  "When a manual `src/placement.js` edit is unavoidable, keep it minimal, target semantic placements by default, and do not use concrete `host:position` outlets unless the placement guide calls for that escape hatch."
].join("\n");
const JSKIT_GENERATOR_DISCOVERY_COMMANDS = [
  "npx jskit list",
  "npx jskit list generators",
  "npx jskit list-placements --json",
  "npx jskit helper-map update",
  "npx jskit helper-map --json"
].join("\n");
const JSKIT_CONFIG_FIELDS = deepFreeze([
  {
    defaultValue: false,
    description: "Only turn this on when developing Vibe64 itself. It lets a Studio instance open another Studio session against this checkout.",
    id: JSKIT_ALLOW_SELF_TARGET_CONFIG,
    label: "Allow Studio self-targeting",
    type: "boolean"
  },
  {
    defaultValue: "none",
    description: "Database service Studio should prepare for local JSKIT runs. Choose None when the app does not need a database.",
    id: JSKIT_DATABASE_RUNTIME_CONFIG,
    label: "Database runtime",
    options: [
      {
        description: "Do not start a managed database service for this target.",
        label: "None",
        value: "none"
      },
      {
        description: "Use a managed MariaDB/MySQL-compatible service on the Studio runtime network.",
        label: "MariaDB",
        value: "mysql"
      },
      {
        description: "Reserve PostgreSQL as the database preference for JSKIT project setup.",
        label: "Postgres",
        value: "postgres"
      }
    ],
    type: "select"
  }
]);
const JSKIT_DEFAULT_CONFIG = deepFreeze(Object.fromEntries(JSKIT_CONFIG_FIELDS.map((field) => [
  field.id,
  field.defaultValue
])));

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

function selectedJskitConfigValue(config, fieldId) {
  const field = JSKIT_CONFIG_FIELDS.find((candidate) => candidate.id === fieldId);
  const fallback = normalizeText(JSKIT_DEFAULT_CONFIG[fieldId]);
  const rawValue = normalizeText(config?.values?.[fieldId] ?? fallback);
  const allowedValues = new Set((field?.options || []).map((option) => normalizeText(option.value)));
  if (allowedValues.size > 0 && !allowedValues.has(rawValue)) {
    return fallback;
  }
  return rawValue || fallback;
}

function jskitDatabaseContract(databaseRuntime) {
  if (databaseRuntime === "none") {
    return [
      "Configured database runtime: none.",
      "If the requested feature needs durable persistence, update JSKIT project configuration/setup first or ask for direction.",
      "Do not invent JSON-file, in-memory, or ad hoc filesystem persistence for durable app data unless the user explicitly asks for a temporary non-database prototype."
    ].join("\n");
  }
  return [
    `Configured database runtime: ${databaseRuntime}.`,
    "Use JSKIT database/runtime modules, resource modules, and generated CRUD/persistence scaffolds for durable data.",
    "Never create migration files directly. Create or update the database table first, then run the server-side CRUD generator against that table.",
    "Every table added for application data must have `npx jskit generate crud-server-generator scaffold ...` run for it, even when the first UI is small.",
    "Feature code must access durable data through generated JSKIT/json-rest-api resource and CRUD APIs, not direct Knex queries.",
    "Do not store durable application data in JSON files, in-memory maps, or custom filesystem stores.",
    "Verify available database modules with `npx jskit list` and `npx jskit show @jskit-ai/database-runtime` before adding custom persistence."
  ].join("\n");
}

function jskitAdapterCapabilities({
  adapter = null
} = {}) {
  return adapter?.workflowCapabilities() || {};
}

function jskitConfigAllowsStudioSelfTarget(config = {}) {
  return config?.values?.[JSKIT_ALLOW_SELF_TARGET_CONFIG] === true;
}

function jskitPromptContext({
  blueprintExists = false,
  blueprintPath = "",
  config = {},
  markers = [],
  packageJson = {},
  targetRoot = ""
} = {}) {
  const resolvedBlueprintPath = blueprintPath || (targetRoot
    ? path.join(targetRoot, JSKIT_BLUEPRINT_RELATIVE_PATH)
    : JSKIT_BLUEPRINT_RELATIVE_PATH);
  const databaseRuntime = selectedJskitConfigValue(config, JSKIT_DATABASE_RUNTIME_CONFIG);
  return {
    adapter: "jskit",
    blueprint_exists: String(Boolean(blueprintExists)),
    blueprint_path: normalizeText(resolvedBlueprintPath),
    blueprint_relative_path: JSKIT_BLUEPRINT_RELATIVE_PATH,
    database_contract: jskitDatabaseContract(databaseRuntime),
    database_runtime: databaseRuntime,
    environment_blueprint: [
      JSKIT_AGENT_GUIDE_CONTRACT,
      JSKIT_TOOLING_CONTRACT,
      JSKIT_PLACEMENT_CONTRACT,
      jskitDatabaseContract(databaseRuntime)
    ].join("\n\n"),
    agent_guide_contract: JSKIT_AGENT_GUIDE_CONTRACT,
    generator_discovery_commands: JSKIT_GENERATOR_DISCOVERY_COMMANDS,
    package_name: normalizeText(packageJson.name),
    placement_contract: JSKIT_PLACEMENT_CONTRACT,
    scripts: packageScripts(packageJson).join(", "),
    seed_issue_guidance: [
      "Seed a JSKIT application by discovering the framework modules and local development settings needed before product feature work starts.",
      "Ask about JSKIT setup choices, not business entities or detailed screens yet.",
      "Questions should cover: app name/title, auth/users, tenancy/workspaces, database package, assistant/OpenAI usage, file uploads/storage, realtime, email/dev mail, payments, mobile/Capacitor, demo data, and any fake local dev API keys needed by those modules.",
      "Development secrets are allowed in this conversation because they are local fake values for ignored .env files. Ask for them when a selected module needs them.",
      "Create a seed issue whose acceptance criteria include the exact JSKIT commands Codex should run, especially `npx @jskit-ai/create-app ...`, `npx jskit list`, `npx jskit show <package>`, and the `npx jskit add ...` or generator commands needed for the selected modules.",
      "The seed issue should produce a runnable foundation app, .env local development values, installed dependencies, and generated JSKIT metadata."
    ].join("\n"),
    target_root: normalizeText(targetRoot),
    tooling_contract: JSKIT_TOOLING_CONTRACT,
    valid_jskit_markers: String(allMarkersExist(markers))
  };
}

function jskitFacts({
  adapter = null,
  blueprintExists = false,
  commands = [],
  blueprintPath = "",
  config = {},
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
      config,
      markers,
      packageJson,
      targetRoot
    }),
    summary: setupSummary(markers),
    workflow: {
      seedRequired: !allMarkersExist(markers)
    }
  });
}

async function jskitAutomatedChecksHook({ worktreePath = "" } = {}) {
  const [packageJson, { packageManager }] = await Promise.all([
    readPackageJson(worktreePath),
    nodePackageManagerInspectionExtra({
      targetRoot: worktreePath
    })
  ]);
  const command = packageManagerScriptCommand({
    packageJson: packageJson || {},
    packageManager,
    scriptName: VIBE64_VERIFY_SCRIPT_NAME
  }) || (packageScript(packageJson || {}, "verify:local")
    ? runScriptCommand(packageManager.name, "verify:local")
    : packageScript(packageJson || {}, "verify")
      ? runScriptCommand(packageManager.name, "verify")
      : packageBinCommand(packageManager.name, "jskit", ["app", "verify"]));
  return {
    command,
    commandPreview: command,
    metadata: {
      automated_checks_package_manager: packageManager.name
    },
    script: studioCommandScript({
      command,
      intro: "Running JSKIT verification."
    })
  };
}

async function jskitCodeIndexHook({ worktreePath = "" } = {}) {
  const [packageJson, { packageManager }] = await Promise.all([
    readPackageJson(worktreePath),
    nodePackageManagerInspectionExtra({
      targetRoot: worktreePath
    })
  ]);
  const packageScriptCommand = packageManagerScriptCommand({
    packageJson: packageJson || {},
    packageManager,
    scriptName: VIBE64_CODE_INDEX_SCRIPT_NAME
  });
  const command = packageScriptCommand || packageBinCommand(packageManager.name, "jskit", ["helper-map", "update"]);
  return {
    command,
    commandPreview: command,
    metadata: {
      code_index_command_source: packageScriptCommand ? "package-script" : "jskit-helper-map",
      code_index_package_manager: packageManager.name,
      code_index_path: ".jskit/helper-map.md"
    },
    script: studioCommandScript({
      command,
      intro: "Updating JSKIT code index."
    })
  };
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
      invalidJsonCode: "vibe64_invalid_jskit_json",
      invalidJsonMessage: (filePath) => `Invalid JSON in JSKIT project file: ${filePath}`
    }
  });
}

function jskitConfigSelectsManagedMysql(config = {}) {
  return selectedJskitConfigValue(config, JSKIT_DATABASE_RUNTIME_CONFIG) === "mysql";
}

function createJskitRuntimeContainers({
  config = {},
  targetRoot = ""
} = {}) {
  return [
    createJskitMariaDbRuntimeContainer({
      databaseName: jskitMariaDbDatabaseName(targetRoot),
      required: async ({ targetRoot = "" } = {}) => {
        return jskitConfigSelectsManagedMysql(config) ||
          (Boolean(targetRoot) && await readDatabaseHostFromDotEnv(targetRoot) === JSKIT_MARIADB_HOST);
      },
      targetRoot
    })
  ];
}

class JskitTargetAdapter extends Vibe64DescribedWorkflowTargetAdapter {
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
      defaultConfig: JSKIT_DEFAULT_CONFIG,
      id: "jskit",
      terminalToolchain: {
        image: JSKIT_TOOLCHAIN_IMAGE,
        label: "JSKIT toolchain",
        setupActionLabel: "Build JSKIT toolchain"
      },
      label: "JSKIT target adapter",
      prepareWorktreeScriptPath: JSKIT_PREPARE_WORKTREE_SCRIPT_PATH,
      projectFacts: jskitFacts,
      projectInspection: inspectJskitProject,
      promptContext: jskitPromptContext,
      promptPackRoot: JSKIT_PROMPT_PACK_ROOT,
      runtimeContainers: createJskitRuntimeContainers,
      setupDoctorPlugins: (context) => [
        createJskitSetupDoctorPlugin(context)
      ],
      launchTargetTerminalSpecFactory,
      launchTargets,
      targetScriptTerminalSpecFactory: createJskitTargetScriptTerminalSpec,
      targetScriptsInspector: inspectJskitTargetScripts,
      workflowCommandHooks: {
        automatedChecks: jskitAutomatedChecksHook,
        installDependencies: nodeInstallWorkflowHook,
        updateCodeIndex: jskitCodeIndexHook
      }
    });
  }

  async allowsStudioSelfTarget({
    config = {}
  } = {}) {
    return jskitConfigAllowsStudioSelfTarget(config);
  }
}

export {
  JSKIT_ALLOW_SELF_TARGET_CONFIG,
  JSKIT_DEFAULT_CONFIG,
  JSKIT_MARKERS,
  JSKIT_CONFIG_FIELDS,
  JSKIT_PROMPT_PACK_ROOT,
  JSKIT_PREPARE_WORKTREE_SCRIPT_PATH,
  JskitTargetAdapter,
  jskitCodeIndexHook,
  jskitConfigAllowsStudioSelfTarget,
  jskitAutomatedChecksHook,
  inspectJskitProject
};
