import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  adapterProjectFacts
} from "../../adapter.js";
import {
  deploymentDatabaseNotRequiredService,
  deploymentEnvironmentResult,
  deploymentManagedDatabaseService,
  deploymentPublishPlanFromCommands,
  managedDatabaseEnvironmentEntry,
  publishRootMissingPlan
} from "../../deployment.js";
import {
  detectPackageManager,
  installCommand,
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
  VIBE64_APP_AUTH_MODE_MANAGED_SUPABASE,
  VIBE64_APP_AUTH_MODE_MANUAL_SUPABASE,
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
  JSKIT_MARIADB_ROOT_PASSWORD,
  readDatabaseHostFromDotEnv
} from "./setupMariaDbRuntime.js";
import {
  resolveBuiltLaunchConfig
} from "./launchTargets.js";
import {
  JSKIT_AUTH_RUNTIME_ENV,
  createJskitRuntimeConfigProfile
} from "./runtimeConfigProfile.js";
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
  "Client files stay thin. A JSKIT client page or component must be mostly template plus a short JavaScript section that calls the appropriate JSKIT composable. Do not put long prose, business rules, transport code, persistence code, normalization layers, command orchestration, or large helper blocks in client files.",
  "Server files must follow JSKIT ownership boundaries. Repositories own persistence access and row mapping, services own business operations, providers wire dependencies, route/action handlers expose contracts, and models/resources define durable data and JSON:API shape. Do not bypass those boundaries with direct Knex in feature code, ad hoc repositories, duplicate mappers, or framework-shaped local helpers when a JSKIT generator/runtime seam exists.",
  "New JSKIT-owned files must be created by `npx jskit generate ...`, `npx jskit add ...`, or another documented JSKIT CLI command before manual edits.",
  "Do not hand-create packages, package descriptors, provider entrypoints, route files, resource modules, database modules, migrations, generated client surfaces, page trees, or package glue.",
  "Before writing generic helpers for JSON:API documents, route ownership, workspace params, CRUD repositories, dates, normalization, transport, or generated resource data, search JSKIT package exports and agent-doc references first. Do not implement framework-shaped helpers locally unless no exported JSKIT helper exists and the decision is called out.",
  "For application features, read the agent-friendly JSKIT guide first, then inspect the JSKIT catalog with `npx jskit list`, `npx jskit list generators`, and `npx jskit show <package>`.",
  "When changing generated route screens, CRUD list/view/form pages, client surfaces, or provider wiring, prefer adapting the existing generated file in place. Do not replace the generated structure with a separate custom implementation unless the generated surface cannot support the requested behavior, and call out that reason.",
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
const JSKIT_UI_VERIFICATION_CONTRACT = [
  "If you change browser-visible UI-owned files, run a targeted Playwright/browser workflow through `npx jskit app verify-ui --command \"<playwright command>\" --feature \"<clear feature label>\" --auth-mode <none|dev-auth-login-as|session-bootstrap|custom-local>`.",
  "Run `npx jskit app verify-ui ...` after the last UI edit and before final automated verification. Confirm `.jskit/verification/ui.json` was updated. If UI files change again after the receipt, rerun `verify-ui`.",
  "The Playwright command must exercise the changed behavior and must start or reuse a reachable app server if needed; `jskit app verify-ui` records the run but does not start the app by itself.",
  "If final verification fails with `[ui:verification]`, do not patch around it. Run the required `npx jskit app verify-ui ...` workflow, confirm the receipt, then rerun the original verifier."
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
  return auth.environment;
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
      "Do not ask any database setup questions. Do not ask whether the database exists, what it should be called, or for DB host, port, user, or password.",
      "No database does not block login. Supabase login can still be selected; JSKIT will use its no-database auth fallback for the app-side profile mirror.",
      "With no database, do not install database-runtime-*, users-web, console-web, workspaces-core, workspaces-web, or persistent CRUD modules unless the user first changes Vibe64 project configuration.",
      "If the seed needs saved product data, keep the first visible workflow browser-local unless the user asks to change project configuration."
    ].join("\n");
  }
  return [
    `Configured database for this seed: ${databaseRuntime}.`,
    "Do not ask any database setup questions. Vibe64 project configuration decides the database runtime, Vibe64 creates/ensures the database, and Vibe64 provides the DB_* terminal environment values.",
    "When JSKIT commands need database options, use the Vibe64-provided environment variables such as DB_HOST, DB_PORT, DB_NAME, DB_USER, and DB_PASSWORD.",
    "If those values are missing, stop and report that Vibe64 Runtime Config or setup is not ready instead of asking the user for credentials.",
    "When the accepted seed needs saved app data, plan JSKIT database/runtime, resource, and CRUD generator work using the configured database."
  ].join("\n");
}

function jskitAuthContract(config = {}) {
  const auth = vibe64ProjectAppAuthConfig(config);
  if (auth.mode === VIBE64_APP_AUTH_MODE_MANAGED_SUPABASE) {
    return [
      `Configured app login: managed Supabase (${selectedJskitAuthEnvironment(config)}).`,
      "Vibe64 manages Supabase project setup, site URL, redirect URL sync, and publishable-key wiring for this mode.",
      `Use ${JSKIT_AUTH_RUNTIME_ENV.supabaseUrl} and ${JSKIT_AUTH_RUNTIME_ENV.supabasePublishableKey} from the Vibe64 terminal environment when a JSKIT command asks for the Supabase Project URL and publishable key.`,
      "Do not ask the user for Supabase credentials during JSKIT setup. If either environment value is missing, stop and report that Vibe64 managed app auth must be set up or synced first.",
      "Do not use Supabase service-role keys for generated app login."
    ].join("\n");
  }
  if (auth.mode === VIBE64_APP_AUTH_MODE_MANUAL_SUPABASE) {
    return [
      "Configured app login: manual Supabase.",
      `Use ${JSKIT_AUTH_RUNTIME_ENV.supabaseUrl} and ${JSKIT_AUTH_RUNTIME_ENV.supabasePublishableKey} from the Vibe64 terminal environment when a JSKIT command asks for the Supabase Project URL and publishable key.`,
      "The user owns Supabase project setup for this mode, including site URL and redirect URL configuration.",
      "Vibe64 will not create, inspect, or sync this Supabase project. If either value is missing, stop and ask the user to save the manual Supabase URL/key in Vibe64 project configuration.",
      "Do not use Supabase service-role keys for generated app login."
    ].join("\n");
  }
  return [
    "Configured app login: none.",
    "Do not add JSKIT login/auth modules during seed setup unless the user first changes Vibe64 project configuration to Managed Supabase or Manual Supabase.",
    "If the user wants login, explain that Managed Supabase lets Vibe64 handle Supabase configuration from a stored PAT, while Manual Supabase means the user must configure the Supabase project and redirects themselves."
  ].join("\n");
}

function jskitSeedLoginGuidance(config = {}) {
  const auth = vibe64ProjectAppAuthConfig(config);
  if (auth.mode === VIBE64_APP_AUTH_MODE_MANAGED_SUPABASE) {
    return [
      "The project is already configured for Vibe64-managed Supabase login.",
      "Ask only whether people should sign in or the app can be public. If the user wants sign-in, say: \"Excellent, Supabase configuration will be handled by Vibe64.\"",
      `When JSKIT needs Supabase credentials, use ${JSKIT_AUTH_RUNTIME_ENV.supabaseUrl} and ${JSKIT_AUTH_RUNTIME_ENV.supabasePublishableKey} from the terminal environment.`,
      "Do not ask for Supabase URL, Supabase publishable key, app public URL, redirect URLs, or service-role keys.",
      "Do not tell the user to configure Supabase redirects for managed Supabase; Vibe64 syncs them."
    ].join("\n");
  }
  if (auth.mode === VIBE64_APP_AUTH_MODE_MANUAL_SUPABASE) {
    return [
      "The project is configured for manually managed Supabase login.",
      "Ask only whether people should sign in or the app can be public. If the user wants sign-in, tell the user: \"Please configure Supabase yourself, including the app site URL and redirect URLs.\"",
      "Do not ask the user for Supabase credentials during the seed conversation; use the Vibe64-provided terminal environment values.",
      "If those values are missing, ask the user to save the manual Supabase URL/key in Vibe64 project configuration before continuing."
    ].join("\n");
  }
  return [
    "The project is configured with no app login credentials.",
    "Ask whether people sign in with accounts or can use the app without logging in.",
    "If the user wants login, explain the two supported paths: Managed Supabase means Vibe64 handles Supabase configuration from a stored PAT; Manual Supabase means the user must configure Supabase, including site URL and redirect URLs.",
    "Do not collect Supabase Project URL/key in the seed conversation."
  ].join("\n");
}

function jskitSeedIssueGuidance(databaseRuntime = "", config = {}) {
  const hasConfiguredDatabase = databaseRuntime !== "none";
  return [
    "Seed a JSKIT application quickly. Ask the few product/setup questions below, write a small runnable foundation brief, then run the mapped JSKIT commands. Do not start a discovery adventure.",
    "",
    "Hard rules for seed conversations:",
    "- Ask one short question at a time.",
    "- Do not ask for database names, database credentials, Supabase URL/key, app public URL, redirect URLs, or whether the database already exists.",
    "- Do not ask the user to choose JSKIT package names, framework modules, tenancy modes, surfaces, providers, or generators.",
    "- Do not inspect the target like a mature app, browse the JSKIT catalog, read broad docs, or invent local scaffolding before the foundation choices are answered.",
    "- If an infra value that Vibe64 should provide is missing, stop and report the missing Vibe64 setup/configuration fact.",
    "- If teams/workspaces are selected and the requested feature could live either in the main/global app or inside each workspace/team/tenant, ask where it belongs before defining the seed. In simple words: `Should this feature be shared across the whole app, or should each workspace have its own copy?` Do not assume `admin` means global admin.",
    "",
    jskitSeedDatabaseGuidance(databaseRuntime),
    "",
    jskitSeedLoginGuidance(config),
    "",
    "Ask exactly these seed questions, in this order:",
    "1. What should this app do? Ask for one short product description.",
    "2. What should the app be called? Ask only if the app name/title is not already clear.",
    "3. Should people sign in, or can anyone use it without logging in? Use `Possible answers:` with `- Public app: Anyone can use it without logging in.` first and `- Sign-in: People should sign in with accounts.` second.",
    hasConfiguredDatabase
      ? "4. If people should sign in, ask whether this is a simple account app or whether users should work together in teams/workspaces. Use `Possible answers:` with `- Simple account app: Each signed-in user uses their own account.` first and `- Teams/workspaces: Users can work together in shared spaces.` second."
      : "4. Skip the teams/workspaces question. The configured database runtime is none, so this seed cannot honestly install JSKIT users-web/workspaces persistence. Login can still be used without a database.",
    "5. If teams/workspaces are selected and the feature placement is ambiguous, ask whether the feature belongs in the main/global app or inside each workspace/team/tenant. Use `Possible answers:` with `- Workspace feature: Each workspace has its own copy.` first and `- Global feature: The whole app shares one copy.` second.",
    "6. Should it include an AI assistant now? If yes, ask where it should appear, what it should help with, and the OpenAI API key to use. This is the one setup key the user may need to provide because Vibe64 does not create it.",
    "7. Ask only for setup-changing extras that the user has not already mentioned: file/image uploads, realtime updates, email/invites/password flows, payments/rewards, mobile packaging, or demo data.",
    "Do not ask for detailed CRUD entities, many screens, styling preferences, data models, deployment details, or production secrets during seed definition.",
    "",
    "Answer-choice syntax sugar:",
    "For one small fixed-choice answer, add possible answers as normal text after the question, exactly as a `Possible answers:` section with bullet lines. Put the short button label before `:` and the exact answer to send back after `:`. Do not use answer choices for API keys, service URLs, app names, free-form feature descriptions, or numbered multi-question batches. Do not put these choices in workflow input field descriptors.",
    "",
    "Command mapping after the questions:",
    "- Public app or no teams/workspaces: `npx @jskit-ai/create-app <app-name> --target . --force --tenancy-mode none --title \"<app title>\" --initial-bundles none`.",
    "- Teams/workspaces with a configured database: `npx @jskit-ai/create-app <app-name> --target . --force --tenancy-mode personal --title \"<app title>\" --initial-bundles none`.",
    "- Always run `npm install` after scaffolding before `npx jskit add ...` commands.",
    "- If sign-in is selected and app login is configured, run `npx jskit add package auth-provider-supabase-core --auth-supabase-url \"$AUTH_SUPABASE_URL\" --auth-supabase-publishable-key \"$AUTH_SUPABASE_PUBLISHABLE_KEY\" --app-public-url \"$APP_PUBLIC_URL\"`, then `npx jskit add bundle auth-base`.",
    "- If the configured database runtime is mysql and persistent JSKIT data is selected, run `npx jskit add package database-runtime-mysql --db-host \"$DB_HOST\" --db-port \"$DB_PORT\" --db-name \"$DB_NAME\" --db-user \"$DB_USER\" --db-password \"$DB_PASSWORD\"`.",
    "- If the configured database runtime is postgres and persistent JSKIT data is selected, run `npx jskit add package database-runtime-postgres --db-host \"$DB_HOST\" --db-port \"$DB_PORT\" --db-name \"$DB_NAME\" --db-user \"$DB_USER\" --db-password \"$DB_PASSWORD\"`.",
    "- If persistent user accounts are selected with a configured database, run `npx jskit add package users-web`.",
    "- If teams/workspaces are selected with a configured database, run `npx jskit add package workspaces-core` and `npx jskit add package workspaces-web`.",
    "- If an AI assistant is selected, run the official `npx jskit generate assistant ...` setup/page/settings-page commands for the chosen surface using the provided OpenAI key.",
    "- If the selected extras require JSKIT modules or generators, run the documented `npx jskit add ...` or `npx jskit generate ...` command directly. Use `npx jskit ... help` only for the one command whose syntax is unknown.",
    "- After package/module changes, run `npm install`, `npm run build`, and the generated verification script such as `npm run verify` when present.",
    "",
    "Seed output contract:",
    "The final seed description should be short and command-first. It must list the selected answers, the exact scaffold command, the exact `npx jskit ...` commands to run, the verification commands, and one smallest visible browser workflow.",
    "Do not include `npx jskit list`, `npx jskit list generators`, `npx jskit list-placements --json`, or `npx jskit show <package>` as mandatory seed steps. Those are for unusual uncertainty, not normal seeding.",
    "Do not use `npx @jskit-ai/create-app . --name ...`, and do not scaffold into a child directory.",
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
    ui_verification_contract: JSKIT_UI_VERIFICATION_CONTRACT,
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

function jskitComposerTemplates() {
  return [
    {
      group: "Ask Codex",
      icon: "monitor-check",
      id: "jskit.check_ui",
      label: "Check UI",
      order: 30,
      promptId: "run_deep_ui_check"
    },
    {
      group: "Ask Codex",
      icon: "code-review",
      id: "jskit.refresh_app_blueprint",
      label: "Refresh app blueprint",
      order: 40,
      promptId: "update_project_knowledge"
    }
  ];
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

function jskitDeploymentDatabaseName({
  deployment = {},
  targetRoot = ""
} = {}) {
  return normalizeText(deployment.databaseName) || jskitMariaDbDatabaseName(targetRoot);
}

function createJskitDeploymentRuntimeContainers({
  config = {},
  deployment = {},
  targetRoot = ""
} = {}) {
  if (!jskitConfigSelectsManagedMysql(config)) {
    return [];
  }
  return [
    createJskitMariaDbRuntimeContainer({
      databaseName: jskitDeploymentDatabaseName({
        deployment,
        targetRoot
      }),
      targetRoot
    })
  ];
}

function jskitDeploymentDatabaseEntries({
  deployment = {},
  targetRoot = ""
} = {}) {
  const databaseName = jskitDeploymentDatabaseName({
    deployment,
    targetRoot
  });
  return [
    ["DB_CLIENT", "mysql2"],
    ["DB_HOST", JSKIT_MARIADB_HOST],
    ["DB_NAME", databaseName],
    ["DB_PASSWORD", JSKIT_MARIADB_ROOT_PASSWORD],
    ["DB_PORT", "3306"],
    ["DB_USER", "root"],
    ["MYSQL_DATABASE", databaseName],
    ["MYSQL_HOST", JSKIT_MARIADB_HOST],
    ["MYSQL_PWD", JSKIT_MARIADB_ROOT_PASSWORD],
    ["MYSQL_TCP_PORT", "3306"],
    ["VIBE64_MYSQL_USER", "root"]
  ].map(([name, value]) => managedDatabaseEnvironmentEntry({
    name,
    value
  }));
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
      composerTemplates: jskitComposerTemplates,
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

  async getRuntimeConfigProfile() {
    return createJskitRuntimeConfigProfile();
  }

  async createDeploymentPublishPlan({
    config = {},
    deployment = {},
    targetRoot = ""
  } = {}) {
    const publishRoot = normalizeText(targetRoot);
    if (!publishRoot) {
      return publishRootMissingPlan({
        adapterId: this.id,
        label: "JSKIT"
      });
    }

    const publishConfig = await resolveBuiltLaunchConfig(publishRoot, {
      targetRoot: publishRoot
    });
    const packageManager = await detectPackageManager(publishRoot);
    return deploymentPublishPlanFromCommands({
      adapterId: this.id,
      artifacts: {
        kind: "workspace-build",
        path: "dist"
      },
      buildCommand: publishConfig.buildCommand,
      buildLabel: "Build JSKIT app.",
      messageReady: "JSKIT publish plan is ready.",
      messageServeMissing: "JSKIT publish requires a server command.",
      migrateCommand: publishConfig.migrationCommand,
      migrateLabel: "Apply JSKIT database migrations.",
      prepareCommand: installCommand(packageManager.name),
      prepareLabel: "Install JSKIT dependencies.",
      runtimeServices: createJskitDeploymentRuntimeContainers({
        config,
        deployment,
        targetRoot: publishRoot
      }),
      serveCommand: publishConfig.serverCommand || publishConfig.testrunCommand,
      serveLabel: "Start JSKIT app server."
    });
  }

  async getDeploymentEnvironment({
    config = {},
    deployment = {},
    targetRoot = ""
  } = {}) {
    if (!jskitConfigSelectsManagedMysql(config)) {
      return deploymentEnvironmentResult({
        services: [
          deploymentDatabaseNotRequiredService()
        ]
      });
    }
    return deploymentEnvironmentResult({
      entries: jskitDeploymentDatabaseEntries({
        deployment,
        targetRoot
      }),
      services: [
        deploymentManagedDatabaseService({
          runtimeLabel: "MariaDB"
        })
      ]
    });
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
  createJskitRuntimeConfigProfile,
  inspectJskitProject
};
