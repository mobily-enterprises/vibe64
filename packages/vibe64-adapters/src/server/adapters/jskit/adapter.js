import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  adapterProjectFacts
} from "../../adapter.js";
import {
  managedDatabasePromptServiceFacts
} from "@local/studio-terminal-core/server/managedDatabases";
import {
  deploymentDatabaseNotRequiredService,
  deploymentAppEnvironmentEntry,
  deploymentEnvironmentResult,
  deploymentManagedDatabaseService,
  deploymentPublishPlanFromCommands,
  deploymentService,
  relationalDatabaseDeploymentRequirement,
  managedDatabaseEnvironmentEntry,
  publishRootMissingPlan
} from "../../deployment.js";
import {
  deploymentRelationalDatabaseConnection,
  relationalDatabaseConnectionEnvironment
} from "../../managedDatabases/deployment.js";
import {
  detectPackageManager,
  installCommand,
  NODE_RUNTIME_DISPOSABLE_PATHS,
  nodeRuntimeShellCommand,
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
  inspectDescribedProject,
  inspectProjectSourceMarkers
} from "../../workflowAdapter.js";
import {
  defaultConfigFromFields
} from "../../configValues.js";
import {
  normalizeText,
  vibe64Error
} from "@local/vibe64-core/server/core";
import {
  runtimeRequirement
} from "@local/vibe64-core/server/runtimeToolchain";
import {
  JSKIT_AUTH_LOCAL_BACKEND_DB,
  JSKIT_AUTH_LOCAL_BACKEND_FILE,
  JSKIT_AUTH_PROVIDER_LOCAL,
  JSKIT_AUTH_PROVIDER_NONE,
  JSKIT_AUTH_PROVIDER_SUPABASE,
  JSKIT_DATABASE_RUNTIME_CONFIG,
  JSKIT_USER_CONFIG_FIELDS,
  JSKIT_USER_MODE_NONE,
  JSKIT_USER_MODE_USERS,
  inspectJskitAppAuthSource,
  jskitAppAuthEnvironment,
  jskitAppAuthFromProjectState,
  jskitDatabaseRuntime,
  jskitManagedDatabaseEnabled,
  jskitUserMode,
  resolveJskitProjectAppAuth
} from "./appAuthConfig.js";
import {
  RUNTIME_CONFIG_OWNERS,
  RUNTIME_CONFIG_PHASES
} from "@local/vibe64-core/server/runtimeConfig";
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
  jskitManagedMariaDbDevelopmentDatabaseCommandArgs,
  jskitMariaDbDatabaseName
} from "./setupMariaDbRuntime.js";
import {
  resolveBuiltLaunchConfig
} from "./launchTargets.js";
import {
  JSKIT_CREATE_APP_PACKAGE_SPEC,
  JSKIT_CREATE_APP_PLAYWRIGHT_OPTION
} from "./scaffoldToolchain.js";
import {
  JSKIT_APP_AUTH_RUNTIME_ENV,
  JSKIT_LOCAL_AUTH_STORE_DIR,
  createJskitRuntimeConfigProfile,
  jskitManagedDatabaseRuntimeConfigRecords
} from "./runtimeConfigProfile.js";
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
const JSKIT_DEPLOYMENT_AUTH_REQUIRED_PHASES = Object.freeze([
  RUNTIME_CONFIG_PHASES.DEPLOY,
  RUNTIME_CONFIG_PHASES.SERVER
]);
const JSKIT_MANAGED_MARIADB_PREPARATION_PHASES = Object.freeze([
  RUNTIME_CONFIG_PHASES.MIGRATE,
  RUNTIME_CONFIG_PHASES.PREVIEW,
  RUNTIME_CONFIG_PHASES.SEED,
  RUNTIME_CONFIG_PHASES.SERVER
]);
const JSKIT_TOOLING_CONTRACT = [
  "Use `npx jskit ...` from the repository root for JSKIT inspection, modules, generators, and verification.",
  "If you encounter a JSKIT defect, unexpected behavior, architectural problem, missing framework capability, or any other JSKIT issue that would require or tempt you to compensate in application code, treat it as a showstopper even if the requested work could technically continue. Stop, report the exact issue, evidence, and consequence to the user, and wait for direction. Do not bypass it, patch around it in the application, duplicate or replace the JSKIT mechanism, or modify installed JSKIT package code.",
  "Client files stay thin. A JSKIT client page or component must be mostly template plus a short JavaScript section that calls the appropriate JSKIT composable. Do not put long prose, business rules, transport code, persistence code, normalization layers, command orchestration, or large helper blocks in client files.",
  "Server files must follow JSKIT ownership boundaries. Repositories own persistence access and row mapping, services own business operations, providers wire dependencies, route/action handlers expose contracts, and models/resources define durable data and JSON:API shape. Do not bypass those boundaries with direct Knex in feature code, ad hoc repositories, duplicate mappers, or framework-shaped local helpers when a JSKIT generator/runtime seam exists.",
  "New JSKIT-owned files must be created by `npx jskit generate ...`, `npx jskit add ...`, or another documented JSKIT CLI command before manual edits.",
  "Do not hand-create packages, package descriptors, provider entrypoints, route files, resource modules, database modules, migrations, generated client surfaces, page trees, or package glue.",
  "Before writing generic helpers for JSON:API documents, route ownership, workspace params, CRUD repositories, dates, normalization, transport, or generated resource data, search JSKIT package exports and agent-doc references first. Do not implement framework-shaped helpers locally unless no exported JSKIT helper exists and the decision is called out.",
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
  "Login/users: auth-local bundle, @jskit-ai/auth-core, @jskit-ai/auth-web, @jskit-ai/auth-provider-local-core, @jskit-ai/users-core, and @jskit-ai/users-web. Supabase is a later provider migration, not an initial seed choice.",
  "Personal or workspace data ownership: @jskit-ai/workspaces-core and @jskit-ai/workspaces-web exist, but first-seed apps should stay personal unless the user explicitly asks to defer workspace collaboration details.",
  "AI assistant: @jskit-ai/assistant-core, @jskit-ai/assistant-runtime, and the `assistant` generator exist for assistant setup.",
  "Data and CRUD: @jskit-ai/database-runtime, database runtime packages, resource packages, JSON REST API packages, and CRUD generators exist.",
  "Files/images: @jskit-ai/storage-runtime, @jskit-ai/uploads-runtime, and @jskit-ai/uploads-image-web exist.",
  "Realtime: @jskit-ai/realtime exists.",
  "Payments/rewards: @jskit-ai/google-rewarded-core and @jskit-ai/google-rewarded-web exist.",
  "Mobile: @jskit-ai/mobile-capacitor exists.",
  "Pages/UI/server features: ui-generator, feature-server-generator, crud-server-generator, crud-ui-generator, and assistant generator exist."
].join("\n");
const JSKIT_SEED_RECIPE_CONTRACT = [
  "For seed work, the JSKIT seed guidance is authoritative for scaffold, user mode, database runtime, tenancy, package, and generator choices.",
  "On the first execution of an accepted JSKIT seed, `package.json`, the lockfile, and `node_modules` may be absent. That is the expected pre-scaffold state, not a setup failure. Run the accepted scaffold command first and wait for it to finish, then run `npm install` before inspecting installed-package docs or resolving `node_modules` references from the generated `AGENTS.md`. On a retry, preserve any completed root scaffold and rerun `npm install`; never create a nested replacement app just because `node_modules` is absent.",
  "Do not read broad JSKIT manuals, browse the catalog, or run baseline discovery commands to decide the normal seed recipe.",
  "Use the exact mapped seed commands first. Use `npx jskit ... help` only for one selected command whose syntax is genuinely missing from the accepted plan or whose mapped command failed.",
  "If mapped local auth, database, or generator support is unavailable, stop and report the JSKIT/Vibe64 setup gap instead of switching providers or inventing app-local scaffolding."
].join("\n");
const JSKIT_SEED_DESLOP_CONTRACT = [
  "Apply the full Vibe64 deslop pass, but keep JSKIT seed review anchored to the accepted seed recipe and generated runnable foundation.",
  "Treat broad guide/catalog/manual exploration as a finding when it re-decides auth, database, tenancy, package, scaffold, or placement choices already fixed by the seed guidance.",
  "Review whether the mapped JSKIT commands were used, the app was scaffolded at the session source root, user mode and database choices match Vibe64 config, generated ownership boundaries were preserved, and the smallest visible workflow plus verification are present.",
  "Do not turn seed deslop into broad package-internal audits, generated auth implementation review, dependency advisory remediation, or product expansion unless a concrete local failure points there."
].join("\n");
const JSKIT_DATABASE_CONFIG_FIELDS = [
  {
    defaultValue: "mariadb",
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
        description: "Use a managed MariaDB service on the Studio runtime network.",
        label: "MariaDB",
        runtimePackageId: "mariadb",
        value: "mariadb"
      },
      {
        description: "Reserve PostgreSQL as the database preference for JSKIT project setup.",
        label: "Postgres",
        runtimeUnavailable: true,
        runtimeUnavailableReason: "PostgreSQL runtime is not implemented for JSKIT yet.",
        value: "postgres"
      }
    ],
    type: "select"
  }
];
const JSKIT_CONFIG_FIELDS = deepFreeze([
  ...JSKIT_USER_CONFIG_FIELDS,
  ...JSKIT_DATABASE_CONFIG_FIELDS
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

async function isVibe64SelfTarget({
  targetRoot = ""
} = {}) {
  const targetRootValue = normalizeText(targetRoot);
  if (!targetRootValue) {
    return false;
  }
  const packageJson = await readPackageJson(targetRootValue);
  return normalizeText(packageJson?.name) === "vibe64";
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
      "No database does not block local username/password login. If the current JSKIT catalog cannot support local auth without a database, stop and report that JSKIT local auth support is missing instead of switching providers.",
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

function jskitAuthContract(auth = {}) {
  if (auth.provider === JSKIT_AUTH_PROVIDER_NONE) {
    return [
      "This app does not have user accounts or app login.",
      "Do not add authentication, account, user-profile, or workspace behavior unless the user explicitly asks to change that product decision."
    ].join("\n");
  }
  if (auth.provider === JSKIT_AUTH_PROVIDER_SUPABASE) {
    return [
      "Installed app login provider: Supabase.",
      `Use ${JSKIT_APP_AUTH_RUNTIME_ENV.supabaseUrl} and ${JSKIT_APP_AUTH_RUNTIME_ENV.supabasePublishableKey} from the Vibe64 terminal environment when a JSKIT command asks for the Supabase Project URL and publishable key.`,
      "The user owns Supabase project setup, including site URL and redirect URL configuration.",
      "Vibe64 will not create, inspect, or sync this Supabase project. If either environment value is missing, stop and ask the user to save it in Runtime Config.",
      "Do not use Supabase service-role keys for generated app login."
    ].join("\n");
  }
  if (auth.localBackend === JSKIT_AUTH_LOCAL_BACKEND_DB) {
    return [
      "Configured app login provider: local username/password with database-backed storage.",
      "Use JSKIT local auth backed by the Vibe64-managed database. Do not ask for Supabase credentials, URLs, redirect URLs, or a service-role key.",
      "Vibe64 provides AUTH_PROVIDER=local, AUTH_LOCAL_BACKEND=db, and the DB_* environment values. If those values are missing, stop and report the missing Vibe64 setup/configuration fact.",
      "If the current JSKIT catalog cannot install local auth, stop and report the missing JSKIT local auth support. Do not silently fall back to Supabase."
    ].join("\n");
  }
  return [
    "Configured app login provider: local username/password with file-backed storage.",
    "Use JSKIT local auth. Do not ask for Supabase credentials, URLs, redirect URLs, or a service-role key.",
    "If the current JSKIT catalog cannot install local auth, stop and report the missing JSKIT local auth support. Do not silently fall back to Supabase."
  ].join("\n");
}

function jskitSeedLoginGuidance(databaseRuntime = "", userMode = JSKIT_USER_MODE_USERS) {
  if (userMode === JSKIT_USER_MODE_NONE) {
    return [
      "Configured user mode: no users.",
      "Do not ask whether people sign in. This setup decision is already final for the initial seed.",
      "Do not install authentication, users, or workspaces packages. Supabase is a later upgrade, not an initial seed option."
    ].join("\n");
  }
  if (databaseRuntime !== "none") {
    return [
      "Configured user mode: users.",
      "Use JSKIT local username/password login with database-backed storage and the Vibe64-provided DB_* values.",
      "Do not ask whether people sign in or which auth provider/backend to use. Those setup decisions are already final for the initial seed.",
      "Do not collect Supabase credentials. Supabase is a later upgrade, not an initial seed option."
    ].join("\n");
  }
  return [
    "Configured user mode: users.",
    "Use JSKIT local username/password login with file-backed storage.",
    "Do not ask whether people sign in or which auth provider/backend to use. Those setup decisions are already final for the initial seed.",
    "Do not collect Supabase credentials. Supabase is a later upgrade, not an initial seed option."
  ].join("\n");
}

function jskitSeedIssueGuidance(databaseRuntime = "", config = {}) {
  const userMode = jskitUserMode(config);
  const usersEnabled = userMode === JSKIT_USER_MODE_USERS;
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
    "- If teams/workspaces are selected and the requested feature could live either in the main/global app or inside each workspace/team, ask where it belongs before defining the seed. In simple words: `Should this feature be shared across the whole app, or should each workspace have its own copy?` Do not assume `admin` means global admin.",
    "",
    jskitSeedDatabaseGuidance(databaseRuntime),
    "",
    jskitSeedLoginGuidance(databaseRuntime, userMode),
    "",
    "Ask exactly these seed questions, in this order:",
    "1. What should this app do? Ask for one short product description.",
    "2. What should the app be called? Ask only if the app name/title is not already clear.",
    usersEnabled && hasConfiguredDatabase
      ? "3. Ask whether this is a simple account app or whether users should work together in teams/workspaces. Use `Possible answers:` with `- Simple account app: Each signed-in user uses their own account.` first and `- Teams/workspaces: Users can work together in shared spaces.` second."
      : "3. Skip the teams/workspaces question. Teams/workspaces require both users and a configured database.",
    "4. If teams/workspaces are selected and the feature placement is ambiguous, ask whether the feature belongs in the main/global app or inside each workspace/team. Use `Possible answers:` with `- Workspace feature: Each workspace has its own copy.` first and `- Global feature: The whole app shares one copy.` second.",
    "5. Should it include an AI assistant now? If yes, ask where it should appear, what it should help with, and the OpenAI API key to use. This is the one setup key the user may need to provide because Vibe64 does not create it.",
    "6. Ask only for setup-changing extras that the user has not already mentioned: file/image uploads, realtime updates, email/invites/password flows, payments/rewards, mobile packaging, or demo data.",
    "Do not ask for detailed CRUD entities, many screens, styling preferences, data models, deployment details, or production secrets during seed definition.",
    "",
    "Answer-choice syntax sugar:",
    "For one small fixed-choice answer, add possible answers as normal text after the question, exactly as a `Possible answers:` section with bullet lines. Put the short button label before `:` and the exact answer to send back after `:`. Do not use answer choices for API keys, service URLs, app names, free-form feature descriptions, or numbered multi-question batches. Do not put these choices in workflow input field descriptors.",
    "",
    "Command mapping after the questions:",
    `- Public app or no teams/workspaces: \`npx ${JSKIT_CREATE_APP_PACKAGE_SPEC} <app-name> --target . --force --tenancy-mode none --title "<app title>" --initial-bundles none ${JSKIT_CREATE_APP_PLAYWRIGHT_OPTION}\`.`,
    `- Teams/workspaces with a configured database: \`npx ${JSKIT_CREATE_APP_PACKAGE_SPEC} <app-name> --target . --force --tenancy-mode personal --title "<app title>" --initial-bundles none ${JSKIT_CREATE_APP_PLAYWRIGHT_OPTION}\`.`,
    "- Always run `npm install` after scaffolding before `npx jskit add ...` commands.",
    ...(databaseRuntime === "mariadb"
      ? ["- Install the configured database once, before auth or persistent app features that need it: `npx jskit add package database-runtime-mysql --db-host \"$DB_HOST\" --db-port \"$DB_PORT\" --db-name \"$DB_NAME\" --db-user \"$DB_USER\" --db-password \"$DB_PASSWORD\"`."]
      : databaseRuntime === "postgres"
        ? ["- Install the configured database once, before auth or persistent app features that need it: `npx jskit add package database-runtime-postgres --db-host \"$DB_HOST\" --db-port \"$DB_PORT\" --db-name \"$DB_NAME\" --db-user \"$DB_USER\" --db-password \"$DB_PASSWORD\"`."]
        : []),
    ...(usersEnabled
      ? [
          "- Install local login with `npx jskit add bundle auth-local`.",
          ...(hasConfiguredDatabase
            ? [
                "- Install persistent user accounts with `npx jskit add package users-web`.",
                "- If teams/workspaces are selected, run `npx jskit add package workspaces-core` and `npx jskit add package workspaces-web`."
              ]
            : [])
        ]
      : ["- Do not install auth, users, or workspaces packages."]),
    "- If an AI assistant is selected, run the official `npx jskit generate assistant ...` setup/page/settings-page commands for the chosen surface using the provided OpenAI key.",
    "- If the selected extras require JSKIT modules or generators, run the documented `npx jskit add ...` or `npx jskit generate ...` command directly. Use `npx jskit ... help` only for the one command whose syntax is unknown.",
    "- After package/module changes, run `npm install`, `npm run build`, and the generated verification script such as `npm run verify` when present.",
    "",
    "Seed output contract:",
    "The final seed description should be short and command-first. It must list the selected answers, the exact scaffold command, the exact `npx jskit ...` commands to run, the verification commands, and one smallest visible browser workflow.",
    "Do not include `npx jskit list`, `npx jskit list generators`, `npx jskit list-placements --json`, or `npx jskit show <package>` as mandatory seed steps. Those are for unusual uncertainty, not normal seeding.",
    `Do not use \`npx ${JSKIT_CREATE_APP_PACKAGE_SPEC} . --name ...\`, and do not scaffold into a child directory.`,
    `Keep ${JSKIT_CREATE_APP_PLAYWRIGHT_OPTION} on the scaffold command. Vibe64 owns this exact test-browser version; do not replace it, install a browser, or choose a different Playwright version.`,
    "If Vite dev-server dependency optimization fails for JSKIT runtime packages, do not ask Codex to add app-local `optimizeDeps` exclusions for JSKIT internals. Treat it as a JSKIT package metadata/update issue and keep the generated app config framework-owned."
  ].join("\n");
}

async function jskitPromptContext({
  appAuthSource,
  blueprintExists = false,
  blueprintPath = "",
  config = {},
  markers = [],
  packageJson = {},
  session = null,
  targetRoot = ""
} = {}) {
  const resolvedBlueprintPath = blueprintPath || (targetRoot
    ? path.join(targetRoot, JSKIT_BLUEPRINT_RELATIVE_PATH)
    : JSKIT_BLUEPRINT_RELATIVE_PATH);
  const databaseRuntime = jskitDatabaseRuntime(config);
  const databaseContract = jskitDatabaseContract(databaseRuntime);
  const seedRequired = !allMarkersExist(markers);
  const seedWorkflowActive = normalizeText(session?.metadata?.work_source) === "seed";
  const appAuth = seedRequired || seedWorkflowActive
    ? jskitAppAuthFromProjectState({
        projectConfig: config
      })
    : await resolveJskitProjectAppAuth({
        projectConfig: config,
        sourceAuth: appAuthSource,
        targetRoot
      });
  const authContract = jskitAuthContract(appAuth);
  return {
    adapter: "jskit",
    blueprint_exists: String(Boolean(blueprintExists)),
    blueprint_path: normalizeText(resolvedBlueprintPath),
    blueprint_relative_path: JSKIT_BLUEPRINT_RELATIVE_PATH,
    database_contract: databaseContract,
    database_runtime: databaseRuntime,
    create_app_package_spec: JSKIT_CREATE_APP_PACKAGE_SPEC,
    create_app_playwright_option: JSKIT_CREATE_APP_PLAYWRIGHT_OPTION,
    app_auth_contract: authContract,
    app_auth_local_backend: appAuth.localBackend,
    app_auth_mode: appAuth.provider,
    app_auth_provider: appAuth.provider,
    app_user_mode: appAuth.userMode,
    agent_guide_contract: JSKIT_AGENT_GUIDE_CONTRACT,
    generator_discovery_commands: JSKIT_GENERATOR_DISCOVERY_COMMANDS,
    package_name: normalizeText(packageJson.name),
    placement_contract: JSKIT_PLACEMENT_CONTRACT,
    scripts: packageScripts(packageJson).join(", "),
    ...(seedRequired || seedWorkflowActive
      ? {
        seed_deslop_contract: JSKIT_SEED_DESLOP_CONTRACT,
        seed_issue_guidance: jskitSeedIssueGuidance(databaseRuntime, config),
        seed_module_inventory: JSKIT_SEED_MODULE_INVENTORY,
        seed_recipe_contract: JSKIT_SEED_RECIPE_CONTRACT
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
    capabilities: adapter?.workflowCapabilities() || {},
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
    runtimes: ["node26"],
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
    runtimes: ["node26"],
    script: studioCommandScript({
      command,
      intro: "Updating JSKIT code index."
    })
  };
}

function jskitComposerTemplates() {
  return [
    {
      group: "Info",
      icon: "code-review",
      id: "jskit.refresh_app_blueprint",
      label: "Refresh blueprint",
      order: 30,
      promptId: "update_project_knowledge"
    }
  ];
}

async function inspectJskitProject(targetRoot) {
  return inspectDescribedProject(targetRoot, {
    extra: async ({ exists, pathFor, targetRoot: resolvedTargetRoot }) => {
      const blueprintPath = pathFor(JSKIT_BLUEPRINT_RELATIVE_PATH);
      return {
        appAuthSource: await inspectJskitAppAuthSource(resolvedTargetRoot),
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

function jskitDeploymentDatabaseName({
  deployment = {},
  targetRoot = ""
} = {}) {
  return normalizeText(deployment.databaseName) || jskitMariaDbDatabaseName(targetRoot);
}

async function jskitDeploymentDatabaseAppEntries({
  deployment = {},
  serviceDataRoot = "",
  targetRoot = ""
} = {}) {
  const databaseName = jskitDeploymentDatabaseName({
    deployment,
    targetRoot
  });
  const connection = await deploymentRelationalDatabaseConnection({
    databaseName,
    deployment,
    provider: "mariadb",
    serviceDataRoot,
    targetRoot
  });
  return Object.entries(relationalDatabaseConnectionEnvironment(connection))
    .map(([name, value]) => managedDatabaseEnvironmentEntry({
      name,
      value
    }));
}

async function jskitDeploymentAuthAppEntries({
  auth = {},
  deployment = {}
} = {}) {
  if (auth.provider === JSKIT_AUTH_PROVIDER_NONE) {
    return [];
  }
  if (auth.provider === JSKIT_AUTH_PROVIDER_SUPABASE) {
    return [
      jskitDeploymentAuthEntry({
        name: JSKIT_APP_AUTH_RUNTIME_ENV.provider,
        value: JSKIT_AUTH_PROVIDER_SUPABASE
      }),
      jskitDeploymentAuthEntry({
        name: JSKIT_APP_AUTH_RUNTIME_ENV.supabaseUrl,
        owner: RUNTIME_CONFIG_OWNERS.USER,
        required: true,
        source: "jskit_supabase_auth",
        sourceLabel: "JSKIT Supabase auth",
        value: auth.supabase.url
      }),
      jskitDeploymentAuthEntry({
        name: JSKIT_APP_AUTH_RUNTIME_ENV.supabasePublishableKey,
        owner: RUNTIME_CONFIG_OWNERS.USER,
        required: true,
        sensitive: true,
        source: "jskit_supabase_auth",
        sourceLabel: "JSKIT Supabase auth",
        value: auth.supabase.publishableKey
      })
    ];
  }
  const sessionSecret = typeof deployment.secret === "function"
    ? await deployment.secret({
        byteLength: 32,
        key: JSKIT_APP_AUTH_RUNTIME_ENV.localSessionSecret
      })
    : "";
  const fileBackend = auth.localBackend === JSKIT_AUTH_LOCAL_BACKEND_FILE;
  return [
    jskitDeploymentAuthEntry({
      name: JSKIT_APP_AUTH_RUNTIME_ENV.provider,
      value: JSKIT_AUTH_PROVIDER_LOCAL
    }),
    jskitDeploymentAuthEntry({
      name: JSKIT_APP_AUTH_RUNTIME_ENV.localBackend,
      value: auth.localBackend
    }),
    ...(fileBackend
      ? [
          jskitDeploymentAuthEntry({
            name: JSKIT_APP_AUTH_RUNTIME_ENV.localStoreDir,
            value: JSKIT_LOCAL_AUTH_STORE_DIR
          })
        ]
      : []),
    jskitDeploymentAuthEntry({
      name: JSKIT_APP_AUTH_RUNTIME_ENV.localSessionSecret,
      required: true,
      sensitive: true,
      value: sessionSecret,
      valuePresent: Boolean(sessionSecret)
    }),
    ...(fileBackend
      ? [
          jskitDeploymentAuthEntry({
            name: JSKIT_APP_AUTH_RUNTIME_ENV.localFileProductionAck,
            value: "true"
          })
        ]
      : [])
  ];
}

function jskitDeploymentAuthEntry({
  name = "",
  owner,
  required = false,
  sensitive = false,
  source = "jskit_local_auth",
  sourceLabel = "JSKIT local auth",
  value = "",
  valuePresent
} = {}) {
  return deploymentAppEnvironmentEntry({
    group: "app_auth",
    groupLabel: "App login",
    name,
    owner,
    requiredFor: required ? JSKIT_DEPLOYMENT_AUTH_REQUIRED_PHASES : [],
    sensitive,
    source,
    sourceLabel,
    value,
    valuePresent
  });
}

function jskitDeploymentAuthService({
  auth = {},
  authEntries = [],
} = {}) {
  if (auth.provider === JSKIT_AUTH_PROVIDER_NONE) {
    return deploymentService({
      detail: "This app does not use app login.",
      id: "app_auth",
      label: "App login",
      status: "not_required"
    });
  }
  if (auth.provider === JSKIT_AUTH_PROVIDER_SUPABASE) {
    return deploymentService({
      detail: "Published apps use the installed Supabase provider. Production URL and key readiness comes from Runtime Config.",
      id: "app_auth",
      label: "App login",
      status: "ready"
    });
  }
  const sessionSecretReady = authEntries.some((entry) => (
    entry.name === JSKIT_APP_AUTH_RUNTIME_ENV.localSessionSecret &&
    (entry.valuePresent === true || String(entry.value || "").length > 0)
  ));
  return deploymentService({
    detail: sessionSecretReady
      ? `Published apps use JSKIT local ${auth.localBackend === JSKIT_AUTH_LOCAL_BACKEND_DB ? "database" : "file"} auth.`
      : "Production local auth session secret is missing.",
    id: "app_auth",
    label: "App login",
    status: sessionSecretReady ? "ready" : "blocked"
  });
}

function runtimeConfigRecordsTerminalEnv(records = []) {
  return Object.fromEntries((Array.isArray(records) ? records : [])
    .map((record) => [
      normalizeText(record?.key),
      String(record?.value ?? "")
    ])
    .filter(([key, value]) => key && value));
}

function jskitManagedServices({
  config = {},
  projectEnvironment = {},
  serviceDataRoot = "",
  targetRoot = ""
} = {}) {
  const terminalEnv = runtimeConfigRecordsTerminalEnv(jskitManagedDatabaseRuntimeConfigRecords({
    projectConfig: config,
    projectEnvironment,
    serviceDataRoot,
    targetRoot
  }));
  if (!Object.keys(terminalEnv).length) {
    return [];
  }
  return [
    managedDatabasePromptServiceFacts({
      id: "jskit-mariadb",
      label: "MariaDB",
      runtime: "mariadb",
      terminalEnv
    })
  ].filter(Boolean);
}

function jskitRuntimeRequirements({
  config = {}
} = {}) {
  const databaseRuntime = jskitDatabaseRuntime(config);
  if (databaseRuntime === "postgres") {
    throw vibe64Error(
      "JSKIT Postgres runtime orchestration is not implemented in this Vibe64 runtime catalog.",
      "vibe64_runtime_requirement_unsupported"
    );
  }
  return [
    runtimeRequirement("nodejs-26", {
      tool: "node"
    }),
    jskitManagedDatabaseEnabled(config)
      ? runtimeRequirement("mariadb", {
          tool: "mariadbd"
        })
      : null
  ].filter(Boolean);
}

async function jskitProjectEnvironment({
  projectConfig = {},
  targetRoot = ""
} = {}) {
  const auth = await resolveJskitProjectAppAuth({
    projectConfig,
    targetRoot
  });
  return jskitAppAuthEnvironment(auth);
}

function jskitDeploymentNodeCommand(command = "") {
  const normalizedCommand = normalizeText(command);
  return normalizedCommand ? nodeRuntimeShellCommand(normalizedCommand, "npm") : "";
}

function jskitDeploymentPrepareRuntimes(packageManager = "") {
  return normalizeText(packageManager) === "bun" ? ["node26", "bun"] : ["node26"];
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
      configFields: () => JSKIT_CONFIG_FIELDS,
      currentAppInspector: inspectJskitCurrentApp,
      defaultConfig: () => ({ ...JSKIT_DEFAULT_CONFIG }),
      id: "jskit",
      label: "JSKIT target adapter",
      managedServices: jskitManagedServices,
      prepareWorktreeScriptPath: JSKIT_PREPARE_WORKTREE_SCRIPT_PATH,
      projectEnvironment: jskitProjectEnvironment,
      projectFacts: jskitFacts,
      projectInspection: inspectJskitProject,
      promptContext: jskitPromptContext,
      promptPackRoot: JSKIT_PROMPT_PACK_ROOT,
      runtimeRequirements: jskitRuntimeRequirements,
      setupDoctorPlugins: (context) => [
        createJskitSetupDoctorPlugin({
          ...context,
          runtimeRequirements: jskitRuntimeRequirements
        })
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

  async inspectCommittedWorkflow({
    source = {}
  } = {}) {
    const markers = await inspectProjectSourceMarkers(source, JSKIT_MARKERS);
    return {
      seedRequired: !allMarkersExist(markers)
    };
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

  async sourceEditorPreloadDirectories() {
    return [
      "src",
      "packages",
      "config",
      "server",
      "migrations",
      "data",
      "scripts"
    ];
  }

  async sourceEditorPreexpandedDirectories() {
    return [
      "src"
    ];
  }

  async getRuntimeConfigProfile() {
    return createJskitRuntimeConfigProfile();
  }

  async listExecutionEnvironmentPreparations({
    config = {},
    runtimeConfigPhases = [],
    runtimeConfigEnv = {},
    serviceDataRoot = "",
    targetRoot = ""
  } = {}) {
    if (
      !jskitManagedDatabaseEnabled(config) ||
      !normalizeText(serviceDataRoot) ||
      !runtimeConfigPhases.some((phase) => JSKIT_MANAGED_MARIADB_PREPARATION_PHASES.includes(phase))
    ) {
      return [];
    }
    const databaseName = normalizeText(runtimeConfigEnv.DB_NAME) || jskitMariaDbDatabaseName(targetRoot);
    const [command, ...args] = jskitManagedMariaDbDevelopmentDatabaseCommandArgs({
      databaseName,
      serviceDataRoot,
      targetRoot
    });
    return [{
      allowedRoots: [
        serviceDataRoot,
        targetRoot
      ].filter(Boolean),
      args,
      command,
      coalesceKey: JSON.stringify({
        databaseName,
        serviceDataRoot
      }),
      cwd: targetRoot,
      id: "jskit-managed-mariadb",
      label: "prepare the JSKIT managed database",
      runtimes: ["mariadb"],
      timeout: 120_000
    }];
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
    const nodeRuntimes = ["node26"];
    const artifactPath = "dist";
    const databaseEnabled = jskitManagedDatabaseEnabled(config);
    return deploymentPublishPlanFromCommands({
      adapterId: this.id,
      artifacts: {
        disposablePaths: NODE_RUNTIME_DISPOSABLE_PATHS,
        kind: "workspace-build",
        path: artifactPath
      },
      buildCommand: jskitDeploymentNodeCommand(publishConfig.buildCommand),
      buildLabel: "Build JSKIT app.",
      buildRuntimes: nodeRuntimes,
      messageReady: "JSKIT publish plan is ready.",
      messageServeMissing: "JSKIT publish requires a server command.",
      migrateCommand: jskitDeploymentNodeCommand(publishConfig.migrationCommand),
      migrateLabel: "Apply JSKIT database migrations.",
      migrateRuntimes: nodeRuntimes,
      prepareCommand: normalizeText(installCommand(packageManager.name)),
      prepareLabel: "Install JSKIT dependencies.",
      prepareRuntimes: jskitDeploymentPrepareRuntimes(packageManager.name),
      requirements: databaseEnabled
        ? [
            relationalDatabaseDeploymentRequirement({
              databaseName: jskitDeploymentDatabaseName({
                deployment,
                targetRoot: publishRoot
              }),
              provider: "mariadb"
            })
          ]
        : [],
      serveCommand: jskitDeploymentNodeCommand(
        publishConfig.serverCommand || publishConfig.testrunCommand
      ),
      serveLabel: "Start JSKIT app server.",
      serveRuntimes: nodeRuntimes
    });
  }

  async getDeploymentEnvironment({
    config = {},
    context = {},
    deployment = {},
    serviceDataRoot = "",
    targetRoot = ""
  } = {}) {
    const auth = await resolveJskitProjectAppAuth({
      projectConfig: config,
      targetRoot
    });
    const authEntries = await jskitDeploymentAuthAppEntries({
      auth,
      deployment
    });
    const databaseEnabled = jskitManagedDatabaseEnabled(config);
    const deploymentServiceDataRoot = normalizeText(serviceDataRoot || context.serviceDataRoot);
    const databaseEntries = databaseEnabled
      ? await jskitDeploymentDatabaseAppEntries({
          deployment,
          serviceDataRoot: deploymentServiceDataRoot,
          targetRoot
        })
      : [];
    return deploymentEnvironmentResult({
      appEntries: [
        ...databaseEntries,
        ...authEntries
      ],
      services: [
        databaseEnabled
          ? deploymentManagedDatabaseService({
              runtimeLabel: "MariaDB"
            })
          : deploymentDatabaseNotRequiredService(),
        jskitDeploymentAuthService({
          auth,
          authEntries
        })
      ]
    });
  }
}

export {
  JSKIT_DEFAULT_CONFIG,
  JSKIT_MARKERS,
  JSKIT_CONFIG_FIELDS,
  JSKIT_DATABASE_RUNTIME_CONFIG,
  JSKIT_PROMPT_PACK_ROOT,
  JSKIT_PREPARE_WORKTREE_SCRIPT_PATH,
  JskitTargetAdapter,
  jskitCodeIndexHook,
  jskitAutomatedChecksHook,
  jskitRuntimeRequirements,
  createJskitRuntimeConfigProfile,
  inspectJskitProject
};
