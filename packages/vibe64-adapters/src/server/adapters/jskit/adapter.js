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
  defaultConfigFromFields
} from "../../configValues.js";
import {
  normalizeText
} from "@local/vibe64-core/server/core";
import {
  VIBE64_APP_AUTH_ENV,
  VIBE64_APP_AUTH_MODE_MANAGED_SUPABASE,
  VIBE64_APP_AUTH_MODE_MANUAL_SUPABASE,
  normalizeVibe64AppAuthEnvironment,
  vibe64ProjectAppAuthConfig
} from "@local/vibe64-core/shared";
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
const JSKIT_DATABASE_RUNTIME_CONFIG = "jskit_database_runtime";
const JSKIT_TOOLING_CONTRACT = [
  "Use `npx jskit ...` from the repository root for JSKIT inspection, modules, generators, and verification.",
  "New JSKIT-owned files must be created by `npx jskit generate ...`, `npx jskit add ...`, or another documented JSKIT CLI command before manual edits.",
  "Do not hand-create packages, package descriptors, provider entrypoints, route files, resource modules, database modules, migrations, generated client surfaces, page trees, or package glue.",
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
  "npx jskit list-placements --json"
].join("\n");
const JSKIT_SEED_MODULE_INVENTORY = [
  "Login/users: @jskit-ai/auth-core, @jskit-ai/auth-web, @jskit-ai/auth-provider-supabase-core, @jskit-ai/users-core, and @jskit-ai/users-web.",
  "Personal or workspace data ownership: @jskit-ai/workspaces-core and @jskit-ai/workspaces-web exist, but first-seed apps should stay personal unless the user explicitly asks to defer workspace collaboration details.",
  "AI assistant: @jskit-ai/assistant-core, @jskit-ai/assistant-runtime, and the `assistant` generator exist for assistant setup.",
  "Data and CRUD: @jskit-ai/database-runtime, mysql/postgres database runtime packages, resource packages, JSON REST API packages, and CRUD generators exist.",
  "Files/images: @jskit-ai/storage-runtime, @jskit-ai/uploads-runtime, and @jskit-ai/uploads-image-web exist.",
  "Realtime: @jskit-ai/realtime exists.",
  "Payments/rewards: @jskit-ai/google-rewarded-core and @jskit-ai/google-rewarded-web exist.",
  "Mobile: @jskit-ai/mobile-capacitor exists.",
  "Pages/UI/server features: ui-generator, feature-server-generator, crud-server-generator, crud-ui-generator, and assistant generator exist."
].join("\n");
const JSKIT_CONFIG_FIELDS = deepFreeze([
  {
    defaultValue: "mysql",
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
const JSKIT_DEFAULT_CONFIG = deepFreeze(defaultConfigFromFields(JSKIT_CONFIG_FIELDS));

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

function selectedJskitAuthEnvironment(config) {
  const auth = vibe64ProjectAppAuthConfig(config);
  return normalizeVibe64AppAuthEnvironment(auth.environment);
}

async function jskitTargetPackageName({
  targetRoot = ""
} = {}) {
  const targetRootValue = normalizeText(targetRoot);
  if (!targetRootValue) {
    return "";
  }
  const packageJson = await readPackageJson(targetRootValue);
  return normalizeText(packageJson?.name);
}

async function isVibe64SelfTarget({
  targetRoot = ""
} = {}) {
  return await jskitTargetPackageName({
    targetRoot
  }) === "vibe64";
}

async function jskitConfigFields() {
  return JSKIT_CONFIG_FIELDS;
}

async function jskitDefaultConfig(context = {}) {
  return defaultConfigFromFields(await jskitConfigFields(context));
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

function jskitSeedDatabaseGuidance(databaseRuntime = "") {
  if (databaseRuntime === "none") {
    return [
      "Configured database for this seed: none.",
      "Do not ask the user whether the app needs a database during seed definition.",
      "This does not mean the app cannot have login; Supabase login can still be selected without an app-owned database.",
      "If the seed needs saved product data, keep it small and use browser-local state unless the user asks to change project configuration."
    ].join("\n");
  }
  return [
    `Configured database for this seed: ${databaseRuntime}.`,
    "Do not ask the user whether the app has a database; the project configuration already answers that.",
    "When the accepted seed needs saved app data, plan JSKIT database/runtime, resource, and CRUD generator work using the configured database."
  ].join("\n");
}

function jskitAuthContract(config = {}) {
  const auth = vibe64ProjectAppAuthConfig(config);
  if (auth.mode === VIBE64_APP_AUTH_MODE_MANAGED_SUPABASE) {
    return [
      `Configured app login: managed Supabase (${selectedJskitAuthEnvironment(config)}).`,
      `Use ${VIBE64_APP_AUTH_ENV.supabaseUrl} and ${VIBE64_APP_AUTH_ENV.supabasePublishableKey} from the Vibe64 terminal environment when a JSKIT command asks for the Supabase Project URL and publishable key.`,
      "Do not ask the user for Supabase credentials during JSKIT setup. If either environment value is missing, stop and report that Vibe64 managed app auth must be set up or synced first.",
      "Do not use Supabase service-role keys for generated app login."
    ].join("\n");
  }
  if (auth.mode === VIBE64_APP_AUTH_MODE_MANUAL_SUPABASE) {
    return [
      "Configured app login: manual Supabase.",
      `Use ${VIBE64_APP_AUTH_ENV.supabaseUrl} and ${VIBE64_APP_AUTH_ENV.supabasePublishableKey} from the Vibe64 terminal environment when a JSKIT command asks for the Supabase Project URL and publishable key.`,
      "Vibe64 will not create, inspect, or sync this Supabase project. If either value is missing, stop and ask the user to save the manual Supabase URL/key in Vibe64 project configuration.",
      "Do not use Supabase service-role keys for generated app login."
    ].join("\n");
  }
  return [
    "Configured app login: none.",
    "Do not add JSKIT login/auth modules during seed setup unless the user first changes Vibe64 project configuration to Managed Supabase or Manual Supabase.",
    "If the user asks for login, tell them to change App login in Vibe64 project configuration before continuing."
  ].join("\n");
}

function jskitSeedLoginGuidance(config = {}) {
  const auth = vibe64ProjectAppAuthConfig(config);
  if (auth.mode === VIBE64_APP_AUTH_MODE_MANAGED_SUPABASE) {
    return [
      "The project is already configured for Vibe64-managed Supabase login.",
      "Do not ask whether the app should have login; include login/accounts by default for the seed unless the user explicitly asks for a public no-login app.",
      `When JSKIT needs Supabase credentials, use ${VIBE64_APP_AUTH_ENV.supabaseUrl} and ${VIBE64_APP_AUTH_ENV.supabasePublishableKey} from the terminal environment.`
    ].join("\n");
  }
  if (auth.mode === VIBE64_APP_AUTH_MODE_MANUAL_SUPABASE) {
    return [
      "The project is configured for manually managed Supabase login.",
      "Do not ask the user for Supabase credentials during the seed conversation; use the Vibe64-provided terminal environment values.",
      "If those values are missing, ask the user to save the manual Supabase URL/key in Vibe64 project configuration before continuing."
    ].join("\n");
  }
  return [
    "The project is configured with no app login credentials.",
    "Ask whether people sign in with accounts or can use the app without logging in.",
    "If the user wants login, ask them to change Vibe64 project configuration to Managed Supabase or Manual Supabase first; do not collect Supabase Project URL/key in the seed conversation."
  ].join("\n");
}

function jskitSeedIssueGuidance(databaseRuntime = "", config = {}) {
  return [
    "Seed a JSKIT application by asking plain-language setup questions in the right order, then saving a small runnable foundation app brief.",
    "",
    "Available JSKIT modules you may map answers to:",
    JSKIT_SEED_MODULE_INVENTORY,
    "",
    jskitSeedDatabaseGuidance(databaseRuntime),
    "",
    jskitSeedLoginGuidance(config),
    "",
    "Question order:",
    "1. Follow the configured app-login guidance above before asking any login question.",
    "2. If app login is configured as none, first ask: \"Will people sign in with accounts, or can anyone use the app without logging in?\" Explain that login requires changing Vibe64 project configuration first. For this fixed-choice question, write normal question text followed by `Possible answers:` with `- No, no users: I do not want login for this app.` first and `- Yes, users: I want people to sign in and have accounts.` second.",
    "3. If app login is configured as managed or manual Supabase, do not ask for Supabase credentials. If the app has login, use the terminal environment values from the configured app-login contract.",
    "4. If the app has login, next ask whether this is a simple personal app or eventually a workspace/team app where one person invites others. For this first seed, only build personal mode; if the user wants workspaces/invites, record that as later scope and keep the seed personal.",
    "5. Ask whether the app should include an AI assistant. If yes, ask where it appears in the app, what it should help with, whether it can see user/app data, and which provider/key should be used. Include a short hint such as: \"For an OpenAI key, use your OpenAI dashboard API keys page.\"",
    "6. After those foundation questions, ask only for selected optional needs that materially change setup: file/image uploads, realtime updates, email/invites/password flows, payments/rewards, mobile app packaging, and demo data.",
    "7. Ask for an app name/title only if it is still missing after the foundation choices. The title question should be simple, such as: \"What should this app be called?\"",
    "8. Keep each visible question simple enough for a non-technical app owner. Write as if explaining it to a smart 80-year-old: short, ordinary words, no jargon. Avoid package names, config keys, secret names, and framework jargon in the question itself; keep the technical mapping in the seed description.",
    "9. Ask one question at a time unless one answer naturally needs two small values. Do not ask for detailed product CRUD entities or many screens during seed definition.",
    "",
    "Answer-choice syntax sugar:",
    "For one small fixed-choice answer, add possible answers as normal text after the question, exactly as a `Possible answers:` section with bullet lines. Put the short button label before `:` and the exact answer to send back after `:`. Do not use answer choices for API keys, service URLs, app names, free-form feature descriptions, or numbered multi-question batches. Do not put these choices in workflow input field descriptors.",
    "",
    "Seed output contract:",
    "The final seed description should be short, command-first, and framework-owned. It should include selected setup choices, required local development environment values, selected JSKIT modules by technical name, generated metadata/helper-map work, verification path, and one smallest visible browser workflow.",
    "Create a seed issue whose acceptance criteria include the exact current-directory scaffold command: `npx @jskit-ai/create-app <app-name> --target . --force --tenancy-mode none --title \"<app title>\" --initial-bundles none`. Do not use `npx @jskit-ai/create-app . --name ...`, and do not scaffold into a child directory.",
    "Include the baseline JSKIT commands Codex should run after scaffolding: `npx jskit list`, `npx jskit list generators`, `npx jskit list-placements --json`, `npx jskit show <package>`, and the `npx jskit add ...` or generator commands needed for selected modules.",
    "If Vite dev-server dependency optimization fails for JSKIT runtime packages, do not ask Codex to add app-local `optimizeDeps` exclusions for JSKIT internals. Treat it as a JSKIT package metadata/update issue and keep the generated app config framework-owned."
  ].join("\n");
}

function jskitAdapterCapabilities({
  adapter = null
} = {}) {
  return adapter?.workflowCapabilities() || {};
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
  const databaseContract = jskitDatabaseContract(databaseRuntime);
  const appAuth = vibe64ProjectAppAuthConfig(config);
  const authContract = jskitAuthContract(config);
  const seedRequired = !allMarkersExist(markers);
  return {
    adapter: "jskit",
    blueprint_exists: String(Boolean(blueprintExists)),
    blueprint_path: normalizeText(resolvedBlueprintPath),
    blueprint_relative_path: JSKIT_BLUEPRINT_RELATIVE_PATH,
    database_contract: databaseContract,
    database_runtime: databaseRuntime,
    app_auth_contract: authContract,
    app_auth_environment: appAuth.environment,
    app_auth_mode: appAuth.mode,
    agent_guide_contract: JSKIT_AGENT_GUIDE_CONTRACT,
    generator_discovery_commands: JSKIT_GENERATOR_DISCOVERY_COMMANDS,
    package_name: normalizeText(packageJson.name),
    placement_contract: JSKIT_PLACEMENT_CONTRACT,
    scripts: packageScripts(packageJson).join(", "),
    ...(seedRequired
      ? {
        seed_issue_guidance: jskitSeedIssueGuidance(databaseRuntime, config),
        seed_module_inventory: JSKIT_SEED_MODULE_INVENTORY
      }
      : {}),
    target_root: normalizeText(targetRoot),
    tooling_contract: JSKIT_TOOLING_CONTRACT,
    valid_jskit_markers: String(!seedRequired)
  };
}

function jskitFacts({
  adapter = null,
  commands = [],
  markers = []
} = {}) {
  return adapterProjectFacts({
    capabilities: jskitAdapterCapabilities({
      adapter
    }),
    commands,
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
      configFields: jskitConfigFields,
      currentAppInspector: inspectJskitCurrentApp,
      defaultConfig: jskitDefaultConfig,
      id: "jskit",
      terminalToolchain: {
        image: JSKIT_TOOLCHAIN_IMAGE,
        label: "JSKIT toolchain"
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
    targetRoot = ""
  } = {}) {
    return isVibe64SelfTarget({
      targetRoot
    });
  }

  async worktreeArchiveExclusions() {
    return [
      ".jskit/cache",
      ".turbo",
      "coverage",
      "dist",
      "node_modules"
    ];
  }
}

export {
  JSKIT_DEFAULT_CONFIG,
  JSKIT_MARKERS,
  JSKIT_CONFIG_FIELDS,
  JSKIT_PROMPT_PACK_ROOT,
  JSKIT_PREPARE_WORKTREE_SCRIPT_PATH,
  JskitTargetAdapter,
  jskitCodeIndexHook,
  jskitAutomatedChecksHook,
  createJskitRuntimeContainers,
  inspectJskitProject
};
