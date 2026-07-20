import assert from "node:assert/strict";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  VIBE64_SESSION_STATUS,
  VIBE64_WORKFLOW_DEFINITION_IDS,
  Vibe64SessionRuntime
} from "@local/vibe64-runtime/server";
import {
  JSKIT_PREVIEW_AUTH_KIND
} from "@local/vibe64-core/server/previewAuth";
import {
  buildRuntimeLock,
  writeRuntimeLock
} from "@local/vibe64-core/server/runtimeToolchain";
import {
  JSKIT_AUTH_LOCAL_BACKEND_DB,
  JSKIT_AUTH_LOCAL_BACKEND_FILE,
  JSKIT_AUTH_PROVIDER_LOCAL,
  JSKIT_AUTH_PROVIDER_LOCAL_DB_PACKAGE,
  JSKIT_AUTH_PROVIDER_LOCAL_PACKAGE,
  JSKIT_AUTH_PROVIDER_NONE,
  JSKIT_AUTH_PROVIDER_SUPABASE,
  JSKIT_AUTH_PROVIDER_SUPABASE_PACKAGE,
  JSKIT_USER_MODE_CONFIG,
  JSKIT_USER_MODE_NONE,
  JSKIT_USER_MODE_USERS
} from "@local/vibe64-adapters/server/adapters/jskit/appAuthConfig";
import {
  PREVIEW_PROXY_HOST_ENV,
  PREVIEW_PROXY_PORT_END_ENV,
  PREVIEW_PROXY_PORT_START_ENV,
  PREVIEW_PROXY_PUBLIC_HOST_ENV
} from "@local/vibe64-core/server/launchPreviewProxyEnv";
import {
  VIBE64_PROJECTS_ROOT_ENV,
  VIBE64_SELF_TARGET_SYSTEM_ROOT_ENV,
  VIBE64_SYSTEM_DIR,
  VIBE64_SYSTEM_ROOT_ENV
} from "@local/vibe64-core/server/studioRoots";
import {
  JSKIT_VIBE64_COMMANDS,
  createJskitLaunchTargetTerminalSpec,
  createJskitTargetAdapter,
  listJskitLaunchTargets
} from "@local/vibe64-adapters/server/adapters/jskit/index";
import {
  jskitAutomatedChecksHook,
  jskitCodeIndexHook
} from "@local/vibe64-adapters/server/adapters/jskit/adapter";
import {
  createJskitSetupDoctorPlugin
} from "@local/vibe64-adapters/server/adapters/jskit/setupDoctorPlugin";
import {
  VIBE64_RUNTIME_NAMESPACE_ENV
} from "@local/studio-terminal-core/server/studioRuntimeIdentity";
import {
  startupArgsPreviewOption
} from "@local/vibe64-adapters/server/launchPreviewOptions";
import {
  projectRuntimeRoot,
  sourceMetadata,
  sourcePath,
  withTemporaryRoot
} from "./vibe64TestHelpers.js";

const VIBE64_REPRO_SELF_TARGET_AUTO_SELECT_PROJECT_ENV = "VIBE64_REPRO_SELF_TARGET_AUTO_SELECT_PROJECT";
const JSKIT_PROMPT_ROOT = fileURLToPath(new URL("../../packages/vibe64-adapters/src/server/adapters/jskit/prompts", import.meta.url));
const PREVIEW_AUTH_SECRET_HASH_PLACEHOLDER = "0".repeat(64);

async function runtimePreviewAuthEnvironment(spec, {
  sessionRoot,
  terminalId = "unit-terminal"
} = {}) {
  const fingerprintEnv = spec.env();
  assert.equal(fingerprintEnv.AUTH_DEV_BYPASS_SECRET, PREVIEW_AUTH_SECRET_HASH_PLACEHOLDER);

  const env = spec.env({
    id: terminalId
  });
  assert.match(env.AUTH_DEV_BYPASS_SECRET, /^[a-f0-9]{64}$/u);
  assert.notEqual(env.AUTH_DEV_BYPASS_SECRET, PREVIEW_AUTH_SECRET_HASH_PLACEHOLDER);
  assert.equal(env.VIBE64_PREVIEW_AUTH_PROFILE_FILE, undefined);

  const secretPath = path.join(sessionRoot, "runtime", "preview-auth", terminalId, "exchange-secret");
  assert.equal(await readFile(secretPath, "utf8"), env.AUTH_DEV_BYPASS_SECRET);
  assert.equal((await stat(path.dirname(secretPath))).mode & 0o777, 0o700);
  assert.equal((await stat(secretPath)).mode & 0o777, 0o600);
  return env;
}

async function withRuntimeNamespace(namespace, fn) {
  const previous = process.env[VIBE64_RUNTIME_NAMESPACE_ENV];
  if (namespace) {
    process.env[VIBE64_RUNTIME_NAMESPACE_ENV] = namespace;
  } else {
    delete process.env[VIBE64_RUNTIME_NAMESPACE_ENV];
  }
  try {
    return await fn();
  } finally {
    if (previous === undefined) {
      delete process.env[VIBE64_RUNTIME_NAMESPACE_ENV];
    } else {
      process.env[VIBE64_RUNTIME_NAMESPACE_ENV] = previous;
    }
  }
}

process.env[VIBE64_RUNTIME_NAMESPACE_ENV] = "unit-owner";

async function withSelfTargetAutoSelectProject(slug, fn) {
  const previous = process.env[VIBE64_REPRO_SELF_TARGET_AUTO_SELECT_PROJECT_ENV];
  if (slug) {
    process.env[VIBE64_REPRO_SELF_TARGET_AUTO_SELECT_PROJECT_ENV] = slug;
  } else {
    delete process.env[VIBE64_REPRO_SELF_TARGET_AUTO_SELECT_PROJECT_ENV];
  }
  try {
    return await fn();
  } finally {
    if (previous === undefined) {
      delete process.env[VIBE64_REPRO_SELF_TARGET_AUTO_SELECT_PROJECT_ENV];
    } else {
      process.env[VIBE64_REPRO_SELF_TARGET_AUTO_SELECT_PROJECT_ENV] = previous;
    }
  }
}

async function writeProjectFile(root, relativePath, text = "") {
  const filePath = path.join(root, relativePath);
  await mkdir(path.dirname(filePath), {
    recursive: true
  });
  await writeFile(filePath, text, "utf8");
}

function escapedPattern(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function assertNodeRuntimeCommand(command = "", innerCommand = "") {
  assert.match(command, /^bash -lc /u);
  assert.doesNotMatch(command, /\bnix --extra-experimental-features\b/u);
  assert.doesNotMatch(command, /#nodejs_26/u);
  assert.match(command, new RegExp(escapedPattern(innerCommand), "u"));
}

async function createJskitProject(root, {
  installedPackages = {}
} = {}) {
  await Promise.all([
    writeProjectFile(root, "package.json", JSON.stringify({
      name: "example-jskit-app",
      scripts: {
        build: "vite build",
        test: "node --test"
      }
    }, null, 2)),
    writeProjectFile(root, "config/public.js", "export default {};\n"),
    writeProjectFile(root, "src/main.js", "console.log('app');\n"),
    writeProjectFile(root, "packages/main/package.descriptor.mjs", "export default {};\n"),
    writeProjectFile(root, ".jskit/lock.json", JSON.stringify({
      lockVersion: 1,
      installedPackages
    }, null, 2)),
    writeProjectFile(root, ".jskit/APP_BLUEPRINT.md", "# App blueprint\n")
  ]);
}

function commandIds() {
  return JSKIT_VIBE64_COMMANDS
    .map((command) => command.id)
    .sort((left, right) => left.localeCompare(right));
}

function capabilityIds() {
  return [
    ...commandIds(),
    "use_existing_issue",
    "use_existing_pr"
  ].sort((left, right) => left.localeCompare(right));
}

function enabledByActionId(actions = []) {
  return Object.fromEntries(actions.map((action) => [action.id, action.enabled]));
}

function assertJskitHelperGuardBeforeContract(prompt = "") {
  const helperGuardIndex = prompt.indexOf("generic helpers for JSON:API documents");
  const guideContractIndex = prompt.indexOf("JSKIT guide-first contract");
  assert.notEqual(helperGuardIndex, -1);
  assert.notEqual(guideContractIndex, -1);
  assert.ok(helperGuardIndex < guideContractIndex);
}

function assertJskitUiVerificationContract(prompt = "") {
  assert.match(prompt, /JSKIT UI verification contract/u);
  assert.match(prompt, /npx jskit app verify-ui --command/u);
  assert.match(prompt, /\.jskit\/verification\/ui\.json/u);
  assert.match(prompt, /<none\|dev-auth-login-as\|session-bootstrap\|custom-local>/u);
  assert.match(prompt, /\[ui:verification\]/u);
}

test("jskit adapter exposes selected-project facts, commands, and prompt context", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createJskitProject(targetRoot);
    const adapter = createJskitTargetAdapter();

    const detection = await adapter.detect({
      targetRoot
    });
    const facts = await adapter.inspect({
      targetRoot
    });
    const promptContext = await adapter.getPromptContext({
      targetRoot
    });

    assert.deepEqual(detection, {
      detected: true,
      reason: ""
    });
    assert.equal(facts.summary, "JSKIT project type selected.");
    assert.equal(Object.hasOwn(facts, "promptContext"), false);
    assert.equal(promptContext.package_name, "example-jskit-app");
    assert.equal(promptContext.scripts, "build, test");
    assert.equal(promptContext.blueprint_exists, "true");
    assert.equal(promptContext.blueprint_relative_path, ".jskit/APP_BLUEPRINT.md");
    assert.equal(promptContext.blueprint_path, path.join(targetRoot, ".jskit/APP_BLUEPRINT.md"));
    assert.match(promptContext.agent_guide_contract, /guide\/agent\/index\.md/u);
    assert.match(promptContext.agent_guide_contract, /app-setup\/database-layer\.md/u);
    assert.match(promptContext.agent_guide_contract, /Use individual `npx jskit generate \.\.\. help` commands only/u);
    assert.doesNotMatch(promptContext.tooling_contract, /helper-map update/u);
    assert.doesNotMatch(promptContext.tooling_contract, /generated code index/u);
    assert.doesNotMatch(promptContext.tooling_contract, /helper map/u);
    assert.match(promptContext.tooling_contract, /Client files stay thin/u);
    assert.match(promptContext.tooling_contract, /mostly template plus a short JavaScript section that calls the appropriate JSKIT composable/u);
    assert.match(promptContext.tooling_contract, /Server files must follow JSKIT ownership boundaries/u);
    assert.match(promptContext.tooling_contract, /Repositories own persistence access and row mapping/u);
    assert.match(promptContext.tooling_contract, /New JSKIT-owned files must be created/u);
    assert.match(promptContext.tooling_contract, /Before writing generic helpers for JSON:API documents/u);
    assert.match(promptContext.tooling_contract, /search JSKIT package exports and agent-doc references first/u);
    assert.match(promptContext.tooling_contract, /architectural problem, missing framework capability/u);
    assert.match(promptContext.tooling_contract, /treat it as a showstopper even if the requested work could technically continue/u);
    assert.match(promptContext.tooling_contract, /Do not bypass it, patch around it in the application/u);
    assert.match(promptContext.generator_discovery_commands, /npx jskit list-placements --json/u);
    assert.doesNotMatch(promptContext.generator_discovery_commands, /helper-map update/u);
    assert.doesNotMatch(promptContext.generator_discovery_commands, /helper-map --json/u);
    assert.doesNotMatch(promptContext.generator_discovery_commands, /generate .* help/u);
    assert.match(promptContext.placement_contract, /agent-friendly placement docs/u);
    assert.match(promptContext.placement_contract, /node_modules\/@jskit-ai\/agent-docs\/patterns\/placements\.md/u);
    assert.match(promptContext.ui_verification_contract, /npx jskit app verify-ui --command/u);
    assert.match(promptContext.ui_verification_contract, /\.jskit\/verification\/ui\.json/u);
    assert.match(promptContext.ui_verification_contract, /does not start the app by itself/u);
    assert.match(promptContext.database_contract, /Configured database runtime: mariadb/u);
    assert.equal(promptContext.app_auth_mode, JSKIT_AUTH_PROVIDER_NONE);
    assert.equal(promptContext.app_auth_provider, JSKIT_AUTH_PROVIDER_NONE);
    assert.equal(promptContext.app_user_mode, JSKIT_USER_MODE_NONE);
    assert.match(promptContext.app_auth_contract, /does not have user accounts or app login/u);
    assert.equal(Object.hasOwn(promptContext, "environment_blueprint"), false);
    assert.equal(Object.hasOwn(promptContext, "seed_issue_guidance"), false);
    assert.equal(promptContext.valid_jskit_markers, "true");
    assert.deepEqual(Object.keys(facts.capabilities).sort(), capabilityIds());
    assert.equal(facts.capabilities.update_code_index, true);
    assert.deepEqual(facts.commands.map((command) => command.id), commandIds());
  });
});

test("jskit adapter contributes composer menu prompts", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createJskitProject(targetRoot);
    const runtime = new Vibe64SessionRuntime({
      adapter: createJskitTargetAdapter(),
      targetRoot
    });
    const session = await runtime.createSession({
      initialStep: "review_and_validate",
      metadata: sourceMetadata(targetRoot, "jskit_composer_menu"),
      sessionId: "jskit_composer_menu"
    });
    const itemIds = session.presentation.composerMenu.items.map((item) => item.id);

    assert.ok(itemIds.includes("core.deslop_changes"));
    assert.ok(itemIds.includes("core.deslop_codebase"));
    assert.ok(itemIds.includes("core.check_ui_changes"));
    assert.ok(itemIds.includes("core.check_ui_codebase"));
    assert.ok(itemIds.includes("core.create_handover"));
    assert.ok(itemIds.includes("core.sync_with_remote"));
    assert.equal(itemIds.includes("core.push_session_to_remote"), false);
    assert.equal(itemIds.includes("jskit.check_ui"), false);
    assert.ok(itemIds.includes("jskit.refresh_app_blueprint"));
    const refreshBlueprint = session.presentation.composerMenu.items.find((item) => item.id === "jskit.refresh_app_blueprint");
    assert.equal(refreshBlueprint?.group, "Info");
    assert.equal(refreshBlueprint?.label, "Refresh blueprint");
    assert.match(
      session.presentation.composerMenu.items.find((item) => item.id === "core.check_ui_codebase")?.text || "",
      /JSKIT UI verification contract/u
    );
    assert.match(
      refreshBlueprint?.text || "",
      /vibe64-blueprint-covered-commit/u
    );
    assert.match(
      refreshBlueprint?.text || "",
      /git status --short/u
    );
    assert.match(
      refreshBlueprint?.text || "",
      /git diff --no-index/u
    );
  });
});

test("jskit adapter exposes source editor meaningful directory hints", async () => {
  const adapter = createJskitTargetAdapter();
  const policy = await adapter.sourceEditorFilePolicy();

  assert.deepEqual(policy.preexpandedDirectories, ["src"]);
  assert.ok(policy.preloadDirectories.includes("src"));
  assert.ok(policy.preloadDirectories.includes("packages"));
  assert.equal(policy.preexpandedDirectories.includes("packages"), false);
  assert.ok(policy.exclude.includes("node_modules"));
});

test("jskit UI verification contract is referenced by code-changing prompt templates", async () => {
  const promptIds = [
    "agent_conversation",
    "define_seed_application",
    "execute_plan",
    "execute_seed_plan",
    "fallback",
    "make_plan",
    "make_seed_plan",
    "prepare_for_merge",
    "run_deep_ui_check",
    "run_deslop",
    "run_seed_deslop"
  ];

  await Promise.all(promptIds.map(async (promptId) => {
    const prompt = await readFile(path.join(JSKIT_PROMPT_ROOT, `${promptId}.txt`), "utf8");

    assert.ok(prompt.includes("{{adapter.promptContext.ui_verification_contract}}"), promptId);
  }));
});

test("jskit adapter reflects configured database runtime in prompt context", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createJskitProject(targetRoot);
    const adapter = createJskitTargetAdapter();

    const mariaDbConfig = {
      values: {
        jskit_database_runtime: "mariadb"
      }
    };
    const promptContext = await adapter.getPromptContext({
      config: mariaDbConfig,
      targetRoot
    });

    assert.equal(promptContext.database_runtime, "mariadb");
    assert.equal(promptContext.app_auth_mode, JSKIT_AUTH_PROVIDER_NONE);
    assert.match(promptContext.app_auth_contract, /does not have user accounts or app login/u);
    assert.match(promptContext.database_contract, /Configured database runtime: mariadb/u);
    assert.match(promptContext.database_contract, /Never create migration files directly/u);
    assert.match(promptContext.database_contract, /Every table added for application data must have `npx jskit generate crud-server-generator scaffold \.\.\.` run for it/u);
    assert.match(promptContext.database_contract, /json-rest-api/u);
    assert.match(promptContext.database_contract, /not direct Knex queries/u);
    assert.match(promptContext.database_contract, /Do not store durable application data in JSON files/u);

    const invalidPromptContext = await adapter.getPromptContext({
      config: {
        values: {
          jskit_database_runtime: "sqlite"
        }
      },
      targetRoot
    });

    assert.equal(invalidPromptContext.database_runtime, "mariadb");
    assert.equal(Object.hasOwn(invalidPromptContext, "seed_issue_guidance"), false);

    await withTemporaryRoot(async (unseededRoot) => {
      const seedPromptContext = await adapter.getPromptContext({
        targetRoot: unseededRoot
      });

      assert.equal(seedPromptContext.valid_jskit_markers, "false");
      assert.equal(seedPromptContext.create_app_package_spec, "@jskit-ai/create-app");
      assert.equal(
        seedPromptContext.create_app_playwright_option,
        '--playwright-version "$VIBE64_PLAYWRIGHT_VERSION"'
      );
      assert.match(seedPromptContext.seed_recipe_contract, /seed guidance is authoritative/u);
      assert.match(seedPromptContext.seed_recipe_contract, /expected pre-scaffold state, not a setup failure/u);
      assert.match(seedPromptContext.seed_recipe_contract, /run `npm install` before inspecting installed-package docs/u);
      assert.match(seedPromptContext.seed_recipe_contract, /preserve any completed root scaffold/u);
      assert.match(seedPromptContext.seed_recipe_contract, /Do not read broad JSKIT manuals/u);
      assert.match(seedPromptContext.seed_recipe_contract, /Use the exact mapped seed commands first/u);
      assert.match(seedPromptContext.seed_recipe_contract, /user mode, database runtime/u);
      assert.match(seedPromptContext.seed_deslop_contract, /full Vibe64 deslop pass/u);
      assert.match(seedPromptContext.seed_deslop_contract, /broad guide\/catalog\/manual exploration/u);
      assert.equal(seedPromptContext.app_user_mode, JSKIT_USER_MODE_USERS);
      assert.match(seedPromptContext.seed_issue_guidance, /Configured user mode: users/u);
      assert.match(seedPromptContext.seed_issue_guidance, /local username\/password login with database-backed storage/u);
      assert.match(seedPromptContext.seed_issue_guidance, /Do not ask whether people sign in/u);
      assert.match(seedPromptContext.seed_issue_guidance, /Supabase is a later upgrade, not an initial seed option/u);
      assert.match(seedPromptContext.seed_issue_guidance, /Possible answers:/u);
      assert.doesNotMatch(seedPromptContext.seed_issue_guidance, /Sign-in: People should sign in with accounts/u);
      assert.match(seedPromptContext.seed_issue_guidance, /Answer-choice syntax sugar/u);
      assert.doesNotMatch(seedPromptContext.seed_issue_guidance, /"name": "supabaseProjectUrl"/u);
      assert.doesNotMatch(seedPromptContext.seed_issue_guidance, /"name": "supabaseAnonKey"/u);
      assert.doesNotMatch(seedPromptContext.seed_issue_guidance, /API-key file references/u);
      assert.match(seedPromptContext.seed_issue_guidance, /Simple account app: Each signed-in user uses their own account/u);
      assert.match(seedPromptContext.seed_issue_guidance, /Teams\/workspaces: Users can work together in shared spaces/u);
      assert.match(seedPromptContext.seed_issue_guidance, /main\/global app or inside each workspace\/team/u);
      assert.match(seedPromptContext.seed_issue_guidance, /Do not assume `admin` means global admin/u);
      assert.match(seedPromptContext.seed_issue_guidance, /Workspace feature: Each workspace has its own copy/u);
      assert.match(seedPromptContext.seed_issue_guidance, /Global feature: The whole app shares one copy/u);
      assert.match(seedPromptContext.seed_issue_guidance, /--tenancy-mode none/u);
      assert.match(seedPromptContext.seed_issue_guidance, /--tenancy-mode personal/u);
      assert.doesNotMatch(seedPromptContext.seed_issue_guidance, /simple personal app/u);
      assert.match(seedPromptContext.seed_issue_guidance, /AI assistant/u);
      assert.match(seedPromptContext.seed_issue_guidance, /OpenAI API key/u);
      assert.match(seedPromptContext.seed_issue_guidance, /Configured database for this seed: mariadb/u);
      assert.match(seedPromptContext.seed_issue_guidance, /Do not ask any database setup questions/u);
      assert.match(seedPromptContext.seed_issue_guidance, /Vibe64 provides the DB_\* terminal environment values/u);
      assert.match(seedPromptContext.seed_issue_guidance, /Do not ask for detailed CRUD entities/u);
      assert.doesNotMatch(seedPromptContext.seed_issue_guidance, /Choice-button syntax sugar/u);
      assert.doesNotMatch(seedPromptContext.seed_issue_guidance, /inputFields\.options/u);
      assert.doesNotMatch(seedPromptContext.seed_issue_guidance, /submitOnSelect/u);
      assert.match(seedPromptContext.seed_module_inventory, /auth-local bundle/u);
      assert.match(seedPromptContext.seed_module_inventory, /@jskit-ai\/auth-provider-local-core/u);
      assert.doesNotMatch(seedPromptContext.seed_module_inventory, /@jskit-ai\/auth-provider-supabase-core/u);
      assert.match(seedPromptContext.seed_module_inventory, /@jskit-ai\/assistant-runtime/u);
      assert.match(seedPromptContext.seed_module_inventory, /@jskit-ai\/workspaces-core/u);
      assert.match(seedPromptContext.seed_issue_guidance, /@jskit-ai\/create-app <app-name> --target \. --force/u);
      assert.match(seedPromptContext.seed_issue_guidance, /--playwright-version "\$VIBE64_PLAYWRIGHT_VERSION"/u);
      assert.match(seedPromptContext.seed_issue_guidance, /npx jskit add bundle auth-local/u);
      assert.match(seedPromptContext.seed_issue_guidance, /Install the configured database once/u);
      assert.match(seedPromptContext.seed_issue_guidance, /Install persistent user accounts/u);
      assert.doesNotMatch(seedPromptContext.seed_issue_guidance, /local, run `npx jskit add bundle auth-base`/u);
      assert.doesNotMatch(seedPromptContext.seed_issue_guidance, /auth-provider-supabase-core/u);
      assert.match(seedPromptContext.seed_issue_guidance, /Do not use `npx @jskit-ai\/create-app \. --name/u);
      assert.match(seedPromptContext.seed_issue_guidance, /do not ask Codex to add app-local `optimizeDeps` exclusions/u);
      assert.match(seedPromptContext.seed_issue_guidance, /Do not include `npx jskit list`/u);
    });

    await withTemporaryRoot(async (unseededNoDatabaseRoot) => {
      const seedPromptContext = await adapter.getPromptContext({
        config: {
          values: {
            jskit_database_runtime: "none"
          }
        },
        targetRoot: unseededNoDatabaseRoot
      });

      assert.equal(seedPromptContext.database_runtime, "none");
      assert.equal(seedPromptContext.app_user_mode, JSKIT_USER_MODE_USERS);
      assert.match(seedPromptContext.seed_issue_guidance, /Configured database for this seed: none/u);
      assert.match(seedPromptContext.seed_issue_guidance, /No database does not block local username\/password login/u);
      assert.match(seedPromptContext.seed_issue_guidance, /Skip the teams\/workspaces question/u);
      assert.match(seedPromptContext.seed_issue_guidance, /file-backed storage/u);
      assert.doesNotMatch(seedPromptContext.seed_issue_guidance, /Teams\/workspaces: Users can work together in shared spaces/u);
    });

    await withTemporaryRoot(async (unseededPublicRoot) => {
      const seedPromptContext = await adapter.getPromptContext({
        config: {
          values: {
            [JSKIT_USER_MODE_CONFIG]: JSKIT_USER_MODE_NONE,
            jskit_database_runtime: "none"
          }
        },
        targetRoot: unseededPublicRoot
      });

      assert.equal(seedPromptContext.app_auth_mode, JSKIT_AUTH_PROVIDER_NONE);
      assert.equal(seedPromptContext.app_user_mode, JSKIT_USER_MODE_NONE);
      assert.match(seedPromptContext.seed_issue_guidance, /Configured user mode: no users/u);
      assert.match(seedPromptContext.seed_issue_guidance, /Do not install authentication, users, or workspaces packages/u);
      assert.doesNotMatch(seedPromptContext.seed_issue_guidance, /npx jskit add bundle auth-local/u);
    });
  });
});

test("jskit adapter infers an installed Supabase provider from JSKIT source", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createJskitProject(targetRoot, {
      installedPackages: {
        [JSKIT_AUTH_PROVIDER_SUPABASE_PACKAGE]: {
          options: {
            "auth-supabase-publishable-key": "pk_source",
            "auth-supabase-url": "https://source.supabase.co"
          }
        }
      }
    });
    const adapter = createJskitTargetAdapter();
    const promptContext = await adapter.getPromptContext({
      config: {
        values: {
          [JSKIT_USER_MODE_CONFIG]: JSKIT_USER_MODE_NONE,
          jskit_database_runtime: "mariadb"
        }
      },
      targetRoot
    });

    assert.equal(promptContext.app_auth_mode, JSKIT_AUTH_PROVIDER_SUPABASE);
    assert.equal(promptContext.app_auth_provider, JSKIT_AUTH_PROVIDER_SUPABASE);
    assert.equal(promptContext.app_user_mode, JSKIT_USER_MODE_USERS);
    assert.match(promptContext.app_auth_contract, /Installed app login provider: Supabase/u);
    assert.match(promptContext.app_auth_contract, /user owns Supabase project setup/u);
    assert.match(promptContext.app_auth_contract, /AUTH_SUPABASE_URL/u);
    assert.match(promptContext.app_auth_contract, /AUTH_SUPABASE_PUBLISHABLE_KEY/u);
    assert.match(promptContext.app_auth_contract, /Runtime Config/u);
    assert.equal(Object.hasOwn(promptContext, "seed_issue_guidance"), false);
  });
});

test("jskit seed uses the configured user mode without asking for an auth implementation", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const adapter = createJskitTargetAdapter();
    const promptContext = await adapter.getPromptContext({
      config: {
        values: {
          [JSKIT_USER_MODE_CONFIG]: JSKIT_USER_MODE_USERS,
          jskit_database_runtime: "mariadb"
        }
      },
      targetRoot
    });

    assert.equal(promptContext.app_auth_mode, JSKIT_AUTH_PROVIDER_LOCAL);
    assert.equal(promptContext.app_auth_local_backend, JSKIT_AUTH_LOCAL_BACKEND_DB);
    assert.match(promptContext.app_auth_contract, /Configured app login provider: local username\/password/u);
    assert.match(promptContext.app_auth_contract, /Do not ask for Supabase credentials/u);
    assert.match(promptContext.seed_issue_guidance, /Configured user mode: users/u);
    assert.match(promptContext.seed_issue_guidance, /Do not ask whether people sign in or which auth provider\/backend to use/u);
    assert.match(promptContext.seed_issue_guidance, /Install local login with `npx jskit add bundle auth-local`/u);
    assert.doesNotMatch(promptContext.seed_issue_guidance, /auth-provider-supabase-core/u);
  });
});

test("jskit derives local auth storage from the database runtime", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const adapter = createJskitTargetAdapter();
    const config = {
      values: {
        [JSKIT_USER_MODE_CONFIG]: JSKIT_USER_MODE_USERS,
        jskit_database_runtime: "none"
      }
    };
    const promptContext = await adapter.getPromptContext({
      config,
      targetRoot
    });
    const requirements = await adapter.getRuntimeRequirements({
      config
    });

    assert.equal(promptContext.app_auth_mode, JSKIT_AUTH_PROVIDER_LOCAL);
    assert.equal(promptContext.app_auth_local_backend, JSKIT_AUTH_LOCAL_BACKEND_FILE);
    assert.match(promptContext.app_auth_contract, /file-backed storage/u);
    assert.match(promptContext.seed_issue_guidance, /Configured database for this seed: none/u);
    assert.doesNotMatch(promptContext.seed_issue_guidance, /database-runtime-mysql/u);
    assert.deepEqual(requirements.map((requirement) => requirement.id), ["nodejs-26"]);
  });
});

test("jskit adapter uses stable config fields regardless of target package identity", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const adapter = createJskitTargetAdapter();

    const missingPackageFields = await adapter.getConfigFields({
      targetRoot
    });
    const missingPackageDefaults = await adapter.getDefaultConfig({
      targetRoot
    });
    assert.equal(missingPackageDefaults[JSKIT_USER_MODE_CONFIG], JSKIT_USER_MODE_USERS);
    assert.equal(missingPackageDefaults.jskit_database_runtime, "mariadb");
    assert.deepEqual(missingPackageFields.map((field) => field.id), [
      JSKIT_USER_MODE_CONFIG,
      "jskit_database_runtime"
    ]);
    await writeProjectFile(targetRoot, "package.json", JSON.stringify({
      name: "vibe64"
    }, null, 2));

    const vibe64Fields = await adapter.getConfigFields({
      targetRoot
    });
    const vibe64Defaults = await adapter.getDefaultConfig({
      targetRoot
    });
    assert.deepEqual(
      vibe64Fields.map((field) => field.id),
      missingPackageFields.map((field) => field.id)
    );
    assert.equal(vibe64Defaults.jskit_database_runtime, "mariadb");
    assert.equal(vibe64Defaults[JSKIT_USER_MODE_CONFIG], JSKIT_USER_MODE_USERS);
  });
});

test("jskit reads foundation auth from installed packages without changing the Users setup default", async () => {
  const adapter = createJskitTargetAdapter();
  const foundations = [
    {
      backend: JSKIT_AUTH_LOCAL_BACKEND_FILE,
      databaseRuntime: "none",
      installedPackages: {},
      provider: JSKIT_AUTH_PROVIDER_NONE,
      userMode: JSKIT_USER_MODE_NONE
    },
    {
      backend: JSKIT_AUTH_LOCAL_BACKEND_FILE,
      databaseRuntime: "none",
      installedPackages: {
        [JSKIT_AUTH_PROVIDER_LOCAL_PACKAGE]: {}
      },
      provider: JSKIT_AUTH_PROVIDER_LOCAL,
      userMode: JSKIT_USER_MODE_USERS
    },
    {
      backend: JSKIT_AUTH_LOCAL_BACKEND_DB,
      databaseRuntime: "mariadb",
      installedPackages: {
        [JSKIT_AUTH_PROVIDER_LOCAL_DB_PACKAGE]: {},
        [JSKIT_AUTH_PROVIDER_LOCAL_PACKAGE]: {}
      },
      provider: JSKIT_AUTH_PROVIDER_LOCAL,
      userMode: JSKIT_USER_MODE_USERS
    },
    {
      backend: JSKIT_AUTH_LOCAL_BACKEND_DB,
      databaseRuntime: "mariadb",
      installedPackages: {
        [JSKIT_AUTH_PROVIDER_LOCAL_DB_PACKAGE]: {},
        [JSKIT_AUTH_PROVIDER_LOCAL_PACKAGE]: {},
        "@jskit-ai/workspaces-core": {}
      },
      provider: JSKIT_AUTH_PROVIDER_LOCAL,
      userMode: JSKIT_USER_MODE_USERS
    }
  ];

  for (const foundation of foundations) {
    await withTemporaryRoot(async (targetRoot) => {
      await createJskitProject(targetRoot, {
        installedPackages: foundation.installedPackages
      });
      const defaults = await adapter.getDefaultConfig({
        targetRoot
      });
      const promptContext = await adapter.getPromptContext({
        config: {
          values: {
            jskit_database_runtime: foundation.databaseRuntime
          }
        },
        targetRoot
      });

      assert.equal(defaults[JSKIT_USER_MODE_CONFIG], JSKIT_USER_MODE_USERS);
      assert.equal(promptContext.app_auth_provider, foundation.provider);
      assert.equal(promptContext.app_auth_local_backend, foundation.backend);
      assert.equal(promptContext.app_user_mode, foundation.userMode);
    });
  }
});

test("jskit keeps the database selection authoritative for installed local auth storage", async () => {
  const adapter = createJskitTargetAdapter();
  const cases = [
    {
      databaseRuntime: "none",
      expectedBackend: JSKIT_AUTH_LOCAL_BACKEND_FILE,
      installedPackages: {
        [JSKIT_AUTH_PROVIDER_LOCAL_DB_PACKAGE]: {},
        [JSKIT_AUTH_PROVIDER_LOCAL_PACKAGE]: {}
      }
    },
    {
      databaseRuntime: "mariadb",
      expectedBackend: JSKIT_AUTH_LOCAL_BACKEND_DB,
      installedPackages: {
        [JSKIT_AUTH_PROVIDER_LOCAL_PACKAGE]: {}
      }
    }
  ];

  for (const testCase of cases) {
    await withTemporaryRoot(async (targetRoot) => {
      await createJskitProject(targetRoot, {
        installedPackages: testCase.installedPackages
      });
      const promptContext = await adapter.getPromptContext({
        config: {
          values: {
            [JSKIT_USER_MODE_CONFIG]: JSKIT_USER_MODE_USERS,
            jskit_database_runtime: testCase.databaseRuntime
          }
        },
        targetRoot
      });

      assert.equal(promptContext.app_auth_provider, JSKIT_AUTH_PROVIDER_LOCAL);
      assert.equal(promptContext.app_auth_local_backend, testCase.expectedBackend);
    });
  }
});

test("jskit adapter allows Studio self-targeting only for the Vibe64 package", async () => {
  const adapter = createJskitTargetAdapter();

  await withTemporaryRoot(async (targetRoot) => {
    assert.equal(await adapter.allowsStudioSelfTarget({
      targetRoot
    }), false);
    await writeProjectFile(targetRoot, "package.json", JSON.stringify({
      name: "vibe64"
    }, null, 2));
    assert.equal(await adapter.allowsStudioSelfTarget({
      targetRoot
    }), true);
  });
});

test("jskit project setup checks project database readiness without owning host database services", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const adapter = createJskitTargetAdapter();
    const plugin = createJskitSetupDoctorPlugin({
      runtimeRequirements: adapter.getRuntimeRequirements.bind(adapter),
      targetRoot
    });
    const checks = await plugin.checks({
      targetRoot
    });
    const checkIds = checks.map((check) => check.id);

    assert.ok(checkIds.includes("runtime-services"));
    assert.ok(checkIds.includes("runtime-lock"));
    assert.equal(checkIds.includes("mariadb"), false);
  });
});

test("jskit setup Doctor validates the source-owned runtime lock", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const adapter = createJskitTargetAdapter();
    const config = {
      projectType: "jskit",
      values: {
        jskit_database_runtime: "mariadb"
      }
    };
    await writeRuntimeLock({
      lock: buildRuntimeLock({
        adapterId: adapter.id,
        createdAt: "2026-07-06T00:00:00.000Z",
        projectType: "jskit",
        runtimeRequirements: await adapter.getRuntimeRequirements({
          config
        })
      }),
      sourceContractRoot: targetRoot
    });
    const plugin = createJskitSetupDoctorPlugin({
      config,
      runtimeRequirements: adapter.getRuntimeRequirements.bind(adapter),
      targetRoot
    });
    const runtimeLockCheck = (await plugin.checks({
      config,
      targetRoot
    })).find((check) => check.id === "runtime-lock");

    const pass = await runtimeLockCheck.run({
      config,
      targetRoot
    });
    assert.equal(pass.status, "pass");
    assert.equal(pass.observed, "mariadb, nodejs-26");

    const stale = await runtimeLockCheck.run({
      config: {
        projectType: "jskit",
        values: {
          jskit_database_runtime: "none"
        }
      },
      targetRoot
    });
    assert.equal(stale.status, "fail");
    assert.match(stale.observed, /does not match/u);
  });
});

test("jskit Vibe64 self-target uses host execution with shared project roots and isolated state", async () => {
  await withSelfTargetAutoSelectProject("beepollen", async () => withRuntimeNamespace("unit-owner", async () => withTemporaryRoot(async (targetRoot) => {
    const projectsRoot = path.dirname(targetRoot);
    const parentSystemRoot = path.join(projectsRoot, VIBE64_SYSTEM_DIR);
    const sessionId = "self_target_studio_launch";
    const sessionRoot = path.join(projectRuntimeRoot(targetRoot), "sessions", "active", sessionId);
    const selfTargetSystemRoot = path.join(sessionRoot, "runtime", "self-target-system-root");
    await writeProjectFile(targetRoot, "package.json", JSON.stringify({
      name: "vibe64",
      scripts: {
        dev: "vite",
        server: "node server.js"
      }
    }, null, 2));

    const spec = await createJskitLaunchTargetTerminalSpec({
      context: {
        projectsRoot
      },
      launchTargetId: "dev",
      session: {
        metadata: {
          dependencies_installed: "yes",
          source_path: targetRoot
        },
        sessionId,
        sessionRoot,
        targetRoot
      },
      targetRoot
    });

    assert.equal(spec.ok, true);
    assert.equal(spec.metadata.selfTarget, true);
    assert.equal(spec.metadata.selfTargetSource, "target_package:vibe64");
    assert.equal(spec.metadata.urlPath, "/app");
    assert.match(spec.metadata.targetUrl, /\/app$/u);
    assert.equal(spec.metadata.runtimeNamespace, "unit-owner");
    const terminalId = "unit-terminal";
    const args = spec.args({
      id: terminalId
    });
    const env = await runtimePreviewAuthEnvironment(spec, {
      sessionRoot,
      terminalId
    });
    assert.equal(env[VIBE64_RUNTIME_NAMESPACE_ENV], "unit-owner");
    assert.equal(env[VIBE64_PROJECTS_ROOT_ENV], projectsRoot);
    assert.equal(env[VIBE64_SYSTEM_ROOT_ENV], selfTargetSystemRoot);
    assert.equal(env[VIBE64_SELF_TARGET_SYSTEM_ROOT_ENV], "1");
    assert.equal(env[VIBE64_REPRO_SELF_TARGET_AUTO_SELECT_PROJECT_ENV], "beepollen");
    assert.equal(env[PREVIEW_PROXY_HOST_ENV], "127.0.0.1");
    assert.equal(env[PREVIEW_PROXY_PUBLIC_HOST_ENV], "127.0.0.1");
    const previewProxyPortStart = env[PREVIEW_PROXY_PORT_START_ENV];
    const previewProxyPortEnd = env[PREVIEW_PROXY_PORT_END_ENV];
    assert.match(previewProxyPortStart, /^\d+$/u);
    assert.match(previewProxyPortEnd, /^\d+$/u);
    assert.equal(Number(previewProxyPortEnd), Number(previewProxyPortStart) + 99);
    assert.equal(env.CODEX_HOME, undefined);
    assert.notEqual(selfTargetSystemRoot, parentSystemRoot);
    const startupScript = args.at(-1);
    assert.doesNotMatch(startupScript, /previewAuthCookieName/u);
    assert.doesNotMatch(startupScript, /ensureCurrentContainerConnectedToRuntimeNetwork/u);
    assert.doesNotMatch(startupScript, /Vibe64 self preview project networks/u);
    assert.equal(
      spec.metadata.vibe64SelfTarget,
      "Vibe64 self-target: shared projects with isolated Studio state"
    );
    assert.equal(spec.metadata.vibe64SelfTargetProjectsRoot, projectsRoot);
    assert.equal(spec.metadata.vibe64SelfTargetRuntimeNamespace, "unit-owner");
    assert.equal(spec.metadata.vibe64SelfTargetSystemRoot, selfTargetSystemRoot);
    assert.equal(
      spec.metadata.vibe64SelfTargetPreviewProxyPortRange,
      `${previewProxyPortStart}-${previewProxyPortEnd}`
    );
  })));
});

test("jskit self-target preserves the current runtime namespace", async () => {
  await withRuntimeNamespace("tonymobily", async () => withTemporaryRoot(async (targetRoot) => {
    const projectsRoot = path.dirname(targetRoot);
    const sessionRoot = path.join(projectRuntimeRoot(targetRoot), "sessions", "active", "self_target_namespaced");
    const selfTargetSystemRoot = path.join(sessionRoot, "runtime", "self-target-system-root");
    await writeProjectFile(targetRoot, "package.json", JSON.stringify({
      name: "vibe64",
      scripts: {
        dev: "vite",
        server: "node server.js"
      }
    }, null, 2));

    const spec = await createJskitLaunchTargetTerminalSpec({
      context: {
        projectsRoot
      },
      launchTargetId: "dev",
      session: {
        metadata: {
          dependencies_installed: "yes",
          source_path: targetRoot
        },
        sessionId: "self_target_studio_launch_namespaced",
        sessionRoot,
        targetRoot
      },
      targetRoot
    });

    assert.equal(spec.ok, true);
    assert.equal(spec.metadata.runtimeNamespace, "tonymobily");
    assert.equal(spec.metadata.vibe64SelfTargetRuntimeNamespace, "tonymobily");
    assert.equal(spec.metadata.vibe64SelfTargetSystemRoot, selfTargetSystemRoot);
    const args = spec.args({
      id: "unit-terminal"
    });
    const env = spec.env({
      id: "unit-terminal"
    });
    assert.equal(env[VIBE64_RUNTIME_NAMESPACE_ENV], "tonymobily");
    assert.doesNotMatch(args.at(-1), /previewAuthCookieName/u);
  }));
});

test("jskit launch targets expose app and built app actions", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await writeProjectFile(targetRoot, "package.json", JSON.stringify({
      scripts: {
        build: "vite build",
        dev: "vite",
        server: "node server.js"
      }
    }, null, 2));

    const launchTargets = await listJskitLaunchTargets({
      session: {
        metadata: {
          dependencies_installed: "yes",
          source_path: targetRoot
        },
        targetRoot
      }
    });

    assert.deepEqual(launchTargets, [
      {
        defaultDisplay: "minimized",
        id: "built",
        label: "Run built app",
        previewOptions: [
          startupArgsPreviewOption()
        ]
      },
      {
        defaultDisplay: "minimized",
        defaultPreview: true,
        id: "dev",
        label: "Run app",
        previewOptions: [
          startupArgsPreviewOption()
        ]
      }
    ]);
  });
});

test("jskit launch targets expose startup argument preview options", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await writeProjectFile(targetRoot, "package.json", JSON.stringify({
      scripts: {
        build: "vite build",
        dev: "vite",
        server: "node server.js"
      }
    }, null, 2));

    const launchTargets = await listJskitLaunchTargets({
      session: {
        metadata: {
          dependencies_installed: "yes",
          source_path: targetRoot
        },
        targetRoot
      }
    });

    assert.deepEqual(launchTargets.find((target) => target.id === "dev").previewOptions, [
      startupArgsPreviewOption()
    ]);
  });
});

test("jskit does not claim the Vibe64 Online package", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await writeProjectFile(targetRoot, "package.json", JSON.stringify({
      name: "vibe64-online",
      scripts: {
        dev: "node ./bin/vibe64-online.js dev"
      }
    }, null, 2));

    const session = {
      metadata: {
        dependencies_installed: "yes",
        source_path: targetRoot
      },
      targetRoot
    };
    assert.deepEqual(await listJskitLaunchTargets({ session }), []);

    const spec = await createJskitLaunchTargetTerminalSpec({
      launchTargetId: "online",
      session,
      targetRoot
    });
    assert.equal(spec.ok, false);
    assert.equal(spec.message, "Unknown JSKIT launch target: online.");
  });
});

test("jskit launch targets expose page picker preview routes", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await writeProjectFile(targetRoot, "package.json", JSON.stringify({
      scripts: {
        dev: "vite",
        server: "node server.js"
      }
    }, null, 2));
    await writeProjectFile(targetRoot, "src/pages/home/index.vue", "<template>Home</template>\n");
    await writeProjectFile(targetRoot, "src/pages/w/[workspaceSlug]/admin/jobs/[jobId]/index.vue", "<template>Job</template>\n");
    await writeProjectFile(targetRoot, "src/pages/_internal.vue", "<template>Internal</template>\n");

    const launchTargets = await listJskitLaunchTargets({
      session: {
        metadata: {
          dependencies_installed: "yes",
          source_path: targetRoot
        },
        targetRoot
      }
    });

    assert.deepEqual(launchTargets.find((target) => target.id === "dev").previewRoutes, [
      {
        id: "page_home",
        label: "Home",
        params: [],
        pathTemplate: "/home"
      },
      {
        id: "page_w_workspaceSlug_admin_jobs_jobId",
        label: "Jobs detail",
        params: [
          {
            defaultValue: "",
            description: "",
            label: "Workspace Slug",
            name: "workspaceSlug",
            placeholder: "workspaceSlug",
            required: true
          },
          {
            defaultValue: "",
            description: "",
            label: "Job Id",
            name: "jobId",
            placeholder: "jobId",
            required: true
          }
        ],
        pathTemplate: "/w/:workspaceSlug/admin/jobs/:jobId"
      }
    ]);
  });
});

test("jskit launch targets wait for dependency installation", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await writeProjectFile(targetRoot, "package.json", JSON.stringify({
      scripts: {
        dev: "vite",
        server: "node server.js"
      }
    }, null, 2));

    const session = {
      metadata: {
        source_path: targetRoot
      },
      sessionId: "jskit_launch_before_dependencies",
      targetRoot
    };
    const launchTargets = await listJskitLaunchTargets({
      session
    });

    assert.deepEqual(launchTargets, [
      {
        available: false,
        defaultDisplay: "minimized",
        defaultPreview: true,
        disabledReason: "Install dependencies before running the app.",
        id: "dev",
        label: "Run app",
        previewOptions: [
          startupArgsPreviewOption()
        ]
      }
    ]);

    const spec = await createJskitLaunchTargetTerminalSpec({
      launchTargetId: "dev",
      session,
      targetRoot
    });

    assert.equal(spec.ok, false);
    assert.equal(spec.message, "Install dependencies before running the app.");
  });
});

test("jskit launch targets accept dependencies installed by the agent", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await writeProjectFile(targetRoot, "package.json", JSON.stringify({
      scripts: {
        dev: "vite",
        server: "node server.js"
      }
    }, null, 2));
    const session = {
      metadata: {
        source_path: targetRoot
      },
      sessionId: "jskit_launch_after_agent_install",
      targetRoot
    };
    const adapter = createJskitTargetAdapter();
    const launchTargetsBeforeInstall = await adapter.listLaunchTargets({
      session
    });
    const previewBeforeInstall = launchTargetsBeforeInstall.find((target) => target.id === "dev");

    assert.equal(previewBeforeInstall?.available, false);
    assert.equal(previewBeforeInstall?.defaultPreview, true);

    await writeProjectFile(targetRoot, "node_modules/.bin/jskit", "#!/usr/bin/env node\n");

    const launchTargetsAfterInstall = await adapter.listLaunchTargets({
      session
    });
    const previewAfterInstall = launchTargetsAfterInstall.find((target) => target.id === "dev");

    assert.equal(previewAfterInstall?.available, true);
    assert.equal(previewAfterInstall?.defaultPreview, true);

    const spec = await createJskitLaunchTargetTerminalSpec({
      launchTargetId: "dev",
      session,
      targetRoot
    });

    assert.equal(spec.ok, true);
  });
});

test("jskit launch targets use the managed session source metadata", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "session-with-managed-source";
    const sessionRoot = path.join(projectRuntimeRoot(targetRoot), "sessions", "active", sessionId);
    const worktreePath = sourcePath(targetRoot, sessionId);
    await writeProjectFile(worktreePath, "package.json", JSON.stringify({
      scripts: {
        dev: "vite",
        server: "node server.js"
      }
    }, null, 2));

    const session = {
      completedSteps: ["session_created", "source_created"],
      metadata: {
        dependencies_installed: "yes",
        ...sourceMetadata(targetRoot, sessionId)
      },
      sessionId,
      sessionRoot,
      targetRoot
    };
    const launchTargets = await listJskitLaunchTargets({
      session
    });

    assert.ok(launchTargets.some((target) => target.id === "dev"));

    const spec = await createJskitLaunchTargetTerminalSpec({
      launchTargetId: "dev",
      session,
      targetRoot
    });

    assert.equal(spec.ok, true);
    assert.equal(spec.metadata.runRoot, worktreePath);
    assert.equal(spec.cwd, worktreePath);
  });
});

test("jskit Vibe64 self-target launch uses the session clone for review", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "self-target-managed-source";
    const sessionRoot = path.join(projectRuntimeRoot(targetRoot), "sessions", "active", sessionId);
    const worktreePath = sourcePath(targetRoot, sessionId);
    await writeProjectFile(targetRoot, "package.json", JSON.stringify({
      name: "vibe64",
      scripts: {
        dev: "vite",
        server: "node current-server.js"
      }
    }, null, 2));
    await writeProjectFile(worktreePath, "package.json", JSON.stringify({
      name: "vibe64",
      scripts: {
        dev: "vite",
        server: "node worktree-server.js"
      }
    }, null, 2));
    await writeProjectFile(targetRoot, "config/server_command", "node current-server.js\n");
    await writeProjectFile(worktreePath, "config/server_command", "node worktree-server.js\n");

    const spec = await createJskitLaunchTargetTerminalSpec({
      context: {
        projectsRoot: path.dirname(targetRoot)
      },
      launchTargetId: "dev",
      session: {
        completedSteps: ["session_created", "source_created"],
        metadata: {
          dependencies_installed: "yes",
          ...sourceMetadata(targetRoot, sessionId)
        },
        sessionId,
        sessionRoot,
        targetRoot
      },
      targetRoot
    });

    assert.equal(spec.ok, true);
    assert.equal(spec.metadata.backendCommand, "node worktree-server.js");
    assert.equal(spec.metadata.runRoot, worktreePath);
    assert.equal(spec.metadata.vibe64SelfTargetProjectsRoot, path.dirname(targetRoot));
    const args = spec.args({
      id: "unit-terminal"
    });
    assert.equal(spec.cwd, worktreePath);
    const startupScript = args.at(-1);
    assert.match(startupScript, /node worktree-server\.js/u);
    assert.doesNotMatch(startupScript, /current-server/u);
  });
});

test("jskit built launch waits for the server readiness marker before opening", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "jskit_built_launch";
    const serviceDataRoot = path.join(path.dirname(targetRoot), "services");
    await writeProjectFile(targetRoot, "package.json", JSON.stringify({
      scripts: {
        build: "vite build",
        "db:migrate": "knex migrate:latest",
        server: "node server.js"
      }
    }, null, 2));

    const spec = await createJskitLaunchTargetTerminalSpec({
      context: {
        config: {
          values: {
            jskit_database_runtime: "mariadb"
          }
        },
        serviceDataRoot
      },
      launchTargetId: "built",
      session: {
        metadata: {
          dependencies_installed: "yes",
          source_path: targetRoot
        },
        sessionRoot: path.join(projectRuntimeRoot(targetRoot), "sessions", "active", sessionId),
        sessionId,
        targetRoot
      },
      targetRoot
    });

    assert.equal(spec.ok, true);
    assert.match(spec.metadata.readinessMarker, /^\[\[VIBE64_LAUNCH_READY_V1:/u);
    assert.equal(spec.metadata.launchReady, false);
    assert.equal(spec.metadata.defaultDisplay, "minimized");
    assert.equal(spec.metadata.buildCommand, "npm run build");
    assert.equal(spec.metadata.managedMariaDbPreparation, undefined);
    assert.equal(spec.metadata.migrationCommand, "npm run db:migrate");
    assert.equal(spec.metadata.serverCommand, "npm run server");
    assert.equal(spec.metadata.previewAuth, JSKIT_PREVIEW_AUTH_KIND);
    assert.ok(spec.restartOnChange.include.includes("src/**"));
    assert.ok(spec.restartOnChange.include.includes("server.js"));
    assert.deepEqual(spec.runtimes, ["node26"]);

    const args = spec.args({
      id: "unit-terminal"
    });
    const previewAuthEnv = await runtimePreviewAuthEnvironment(spec, {
      sessionRoot: path.join(projectRuntimeRoot(targetRoot), "sessions", "active", sessionId)
    });
    assert.equal(previewAuthEnv.JSKIT_SERVER_LOGGER, "false");
    assert.equal(previewAuthEnv.AUTH_DEV_BYPASS_ENABLED, "true");
    assert.equal(previewAuthEnv.AUTH_DEV_ACCESS_TTL_SECONDS, "3600");
    assert.equal(previewAuthEnv.AUTH_DEV_REFRESH_TTL_SECONDS, "43200");
    assert.equal(args.some((arg) => /^AUTH_DEV_BYPASS_SECRET=/u.test(arg)), false);
    assert.doesNotMatch(spec.commandPreview, /AUTH_DEV_BYPASS_SECRET=[a-f0-9]{64}/u);
    assert.doesNotMatch(spec.commandPreview, /AUTH_DEV_BYPASS_SECRET=/u);
    const startupScript = args.at(-1);
    const buildIndex = startupScript.indexOf("npm run build");
    const migrateIndex = startupScript.indexOf("npm run db:migrate");
    const serverIndex = startupScript.indexOf("npm run server");
    assert.notEqual(buildIndex, -1);
    assert.notEqual(migrateIndex, -1);
    assert.notEqual(serverIndex, -1);
    assert.match(startupScript, /export JSKIT_SERVER_LOGGER=false; npm run server/u);
    assert.doesNotMatch(startupScript, /Preparing JSKIT managed database/u);
    assert.doesNotMatch(startupScript, /Vibe64 self preview project networks/u);
    assert.ok(buildIndex < migrateIndex);
    assert.ok(migrateIndex < serverIndex);
    assert.match(startupScript, /action:%s/u);
    assert.match(startupScript, /VIBE64_LAUNCH_READY_V1/u);
    assert.match(startupScript, /fetch\(href/u);
    assert.match(startupScript, /Launch target did not become ready at/u);
  });
});

test("jskit dev launch starts backend and Vite together", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "jskit_dev_launch";
    const serviceDataRoot = path.join(path.dirname(targetRoot), "services");
    let spec;
    await writeProjectFile(targetRoot, "package.json", JSON.stringify({
      scripts: {
        "db:migrate": "knex migrate:latest",
        dev: "vite",
        server: "node server.js"
      }
    }, null, 2));

    try {
      spec = await createJskitLaunchTargetTerminalSpec({
        context: {
          config: {
            values: {
              jskit_database_runtime: "mariadb"
            }
          },
          serviceDataRoot
        },
        launchTargetId: "dev",
        session: {
          metadata: {
            dependencies_installed: "yes",
            source_path: targetRoot
          },
          sessionRoot: path.join(projectRuntimeRoot(targetRoot), "sessions", "active", sessionId),
          sessionId,
          targetRoot
        },
        targetRoot
      });

      assert.equal(spec.ok, true);
      assert.equal(spec.metadata.backendCommand, "npm run server");
      assert.notEqual(spec.metadata.backendPort, 3000);
      assert.ok(Number(spec.metadata.backendPort) > Number(spec.metadata.port));
    assert.equal(spec.metadata.defaultDisplay, "minimized");
    assert.equal(spec.metadata.frontendCommand, "npm run dev -- --host 0.0.0.0 --port \"$PORT\"");
    assert.equal(spec.metadata.managedMariaDbPreparation, undefined);
    assert.equal(spec.metadata.migrationCommand, "npm run db:migrate");
    assert.equal(spec.metadata.previewAuth, JSKIT_PREVIEW_AUTH_KIND);
    assert.match(spec.metadata.readinessMarker, /^\[\[VIBE64_LAUNCH_READY_V1:/u);
    assert.equal(spec.metadata.serverRestartCheck, "active-agent-runs");
    assert.deepEqual(spec.runtimes, ["node26"]);

    const args = spec.args({
      id: "unit-terminal"
    });
    const previewAuthEnv = await runtimePreviewAuthEnvironment(spec, {
      sessionRoot: path.join(projectRuntimeRoot(targetRoot), "sessions", "active", sessionId)
    });
    assert.equal(previewAuthEnv.JSKIT_SERVER_LOGGER, "false");
    assert.equal(previewAuthEnv.AUTH_DEV_BYPASS_ENABLED, "true");
    assert.equal(previewAuthEnv.AUTH_DEV_ACCESS_TTL_SECONDS, "3600");
    assert.equal(previewAuthEnv.AUTH_DEV_REFRESH_TTL_SECONDS, "43200");
    assert.equal(args.some((arg) => /^AUTH_DEV_BYPASS_SECRET=/u.test(arg)), false);
    assert.doesNotMatch(spec.commandPreview, /AUTH_DEV_BYPASS_SECRET=[a-f0-9]{64}/u);
    assert.doesNotMatch(spec.commandPreview, /AUTH_DEV_BYPASS_SECRET=/u);
    const startupScript = args.at(-1);
    assert.match(
      startupScript,
      new RegExp(`VIBE64_JSKIT_BACKEND_PORT=\\\\?"?${spec.metadata.backendPort}`, "u")
    );
    const migrateIndex = startupScript.indexOf("npm run db:migrate");
    const startStackIndex = startupScript.indexOf("trap cleanup_vibe64_jskit_dev EXIT INT TERM\nvibe64_jskit_start_stack");
    assert.notEqual(migrateIndex, -1);
    assert.notEqual(startStackIndex, -1);
    assert.doesNotMatch(startupScript, /Preparing JSKIT managed database/u);
    assert.doesNotMatch(startupScript, /Vibe64 self preview project networks/u);
    assert.ok(migrateIndex < startStackIndex);
    assert.match(startupScript, /npm run server/u);
    assert.match(startupScript, /export JSKIT_SERVER_LOGGER=false; npm run server/u);
    assert.match(startupScript, /VITE_API_PROXY_TARGET="http:\/\/127\.0\.0\.1:\$VIBE64_JSKIT_BACKEND_PORT"/u);
    assert.match(startupScript, /__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS="\$VIBE64_LAUNCH_AGENT_HOST"/u);
    assert.match(startupScript, /vibe64_jskit_agent_runs_root=.*\/sessions\/active\/jskit_dev_launch\/agent-runs/u);
    assert.match(startupScript, /vibe64_jskit_record_server_fingerprint/u);
    assert.match(startupScript, /vibe64_jskit_read_server_fingerprint/u);
    assert.match(startupScript, /vibe64_jskit_server_files_changed/u);
    assert.match(startupScript, /vibe64_jskit_restart_backend/u);
    assert.match(startupScript, /Restarting JSKIT backend after server-side files changed/u);
    assert.match(startupScript, /vibe64_jskit_backend_signal TERM/u);
    assert.match(startupScript, /kill -TERM -- "-\$vibe64_jskit_backend_pid"/u);
    assert.match(startupScript, /vibe64_jskit_report_exited_children/u);
    assert.match(startupScript, /JSKIT %s exited with code %s/u);
    assert.match(startupScript, /exit 1/u);
    assert.doesNotMatch(startupScript, /vibe64_jskit_restart_stack/u);
    assert.doesNotMatch(startupScript, /Restarting JSKIT dev server after agent work finished/u);
    assert.match(startupScript, /stat\.mtimeMs/u);
    assert.match(startupScript, /stat\.size/u);
    assert.equal(spec.commandPreview.match(/function normalizeLaunchRestartPath/gu)?.length, 1);
    assert.equal(spec.commandPreview.match(/function launchRestartGlobToRegExp/gu)?.length, 1);
    assert.doesNotMatch(startupScript, /function globRegex/u);
    assert.match(startupScript, /src\/\*\*\/server\/\*\*/u);
    assert.doesNotMatch(startupScript, /vibe64_jskit_watch_agent_pause/u);
    assert.doesNotMatch(startupScript, /kill -STOP/u);
    assert.doesNotMatch(startupScript, /kill -CONT/u);
    assert.match(startupScript, /grep -Eq/u);
    assert.match(startupScript, /"active"\[\[:space:\]\]\*:\[\[:space:\]\]\*true/u);
    assert.doesNotMatch(startupScript, /Pausing JSKIT frontend while agent work is active/u);
    assert.match(startupScript, /JSKIT frontend is ready/u);
    assert.match(startupScript, /exec setsid bash -lc/u);
    assert.match(startupScript, /npm run dev -- --host 0\.0\.0\.0 --port "\$PORT"/u);
    assert.match(startupScript, /VIBE64_LAUNCH_READY_V1/u);
    assert.match(startupScript, /fetch\(href/u);
    assert.match(startupScript, /Launch target did not become ready at/u);
    } finally {
      spec?.releasePortReservation?.();
    }
  });
});

test("jskit dev launch applies preview startup arguments to the backend command", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "jskit_dev_launch_with_startup_args";
    await writeProjectFile(targetRoot, "package.json", JSON.stringify({
      scripts: {
        dev: "vite",
        server: "node server.js"
      }
    }, null, 2));

    const spec = await createJskitLaunchTargetTerminalSpec({
      context: {},
      launchInput: {
        values: {
          startupArgs: [
            ".",
            "--profile local editor"
          ]
        }
      },
      launchTargetId: "dev",
      session: {
        metadata: {
          dependencies_installed: "yes",
          source_path: targetRoot
        },
        sessionRoot: path.join(projectRuntimeRoot(targetRoot), "sessions", "active", sessionId),
        sessionId,
        targetRoot
      },
      targetRoot
    });

    assert.equal(spec.ok, true);
    assert.deepEqual(spec.runtimes, ["node26"]);
    assert.ok(spec.restartOnChange.include.includes("server/**"));
    assert.ok(spec.restartOnChange.include.includes("packages/**/src/shared/**"));
    const startupScript = spec.args({
      id: "unit-terminal"
    }).at(-1);
    assert.doesNotMatch(startupScript, /\bnix --extra-experimental-features\b/u);
    assert.doesNotMatch(startupScript, /#nodejs_26/u);
    assert.match(startupScript, /npm run server -- \. .*--profile local editor/u);
    assert.match(startupScript, /VITE_API_PROXY_TARGET="http:\/\/127\.0\.0\.1:\$VIBE64_JSKIT_BACKEND_PORT"/u);
    assert.match(startupScript, /__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS="\$VIBE64_LAUNCH_AGENT_HOST"/u);
    assert.match(startupScript, /exec setsid bash -lc .*npm run dev -- --host 0\.0\.0\.0 --port "\$PORT"/u);
  });
});

test("jskit adapter reports missing markers without pretending project type selection failed", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await writeProjectFile(targetRoot, "package.json", "{}\n");
    const adapter = createJskitTargetAdapter();

    const detection = await adapter.detect({
      targetRoot
    });
    const facts = await adapter.inspect({
      targetRoot
    });
    const promptContext = await adapter.getPromptContext({
      targetRoot
    });

    assert.equal(detection.detected, true);
    assert.match(facts.summary, /Missing markers/u);
    assert.equal(promptContext.valid_jskit_markers, "false");
    assert.deepEqual(Object.keys(facts.capabilities).sort(), capabilityIds());
  });
});

test("jskit adapter reports malformed package.json instead of hiding it", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createJskitProject(targetRoot);
    await writeProjectFile(targetRoot, "package.json", "{ not json\n");
    const adapter = createJskitTargetAdapter();

    await assert.rejects(
      () => adapter.inspect({
        targetRoot
      }),
      {
        code: "vibe64_invalid_jskit_json"
      }
    );
  });
});

test("jskit prompt actions include JSKIT prompt context", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createJskitProject(targetRoot);
    const runtime = new Vibe64SessionRuntime({
      adapter: createJskitTargetAdapter(),
      targetRoot
    });
    await runtime.createSession({
      initialStep: "plan_and_execute",
      metadata: sourceMetadata(targetRoot, "jskit_prompt"),
      sessionId: "jskit_prompt"
    });

    const afterPrompt = await runtime.runAction("jskit_prompt", "make_plan");

    assert.equal(afterPrompt.actionResult.status, "prompt_ready");
    assert.equal(afterPrompt.actionResult.agentPromptHandoff.kind, "agent_prompt_handoff");
    assert.match(afterPrompt.actionResult.agentPromptHandoff.handoffId, /:make_plan$/u);
    assert.equal(afterPrompt.agentRuns.some((run) => run.id === "codex_app_server"), false);
    assert.equal(afterPrompt.actionResult.promptContext.adapter.id, "jskit");
    assert.equal(afterPrompt.actionResult.promptContext.adapter.promptContext.package_name, "example-jskit-app");
    assert.match(afterPrompt.actionResult.prompt, /example-jskit-app/u);
    assert.match(afterPrompt.actionResult.prompt, /Managed services/u);
    assert.match(afterPrompt.actionResult.prompt, /Use the Managed services section as the only source/u);
    assert.match(afterPrompt.actionResult.prompt, /JSKIT generated-file contract/u);
    assert.match(afterPrompt.actionResult.prompt, /JSKIT guide-first contract/u);
    assert.match(afterPrompt.actionResult.prompt, /Client files stay thin/u);
    assert.match(afterPrompt.actionResult.prompt, /mostly template plus a short JavaScript section that calls the appropriate JSKIT composable/u);
    assert.match(afterPrompt.actionResult.prompt, /Server files must follow JSKIT ownership boundaries/u);
    assert.match(afterPrompt.actionResult.prompt, /Repositories own persistence access and row mapping/u);
    assert.match(afterPrompt.actionResult.prompt, /architectural problem, missing framework capability/u);
    assert.match(afterPrompt.actionResult.prompt, /Stop, report the exact issue, evidence, and consequence to the user/u);
    assert.match(afterPrompt.actionResult.prompt, /Do not bypass it, patch around it in the application/u);
    assert.match(afterPrompt.actionResult.prompt, /prefer adapting the existing generated file in place/u);
    assert.match(afterPrompt.actionResult.prompt, /Do not replace the generated structure with a separate custom implementation/u);
    assert.match(afterPrompt.actionResult.prompt, /guide\/agent\/generators\/crud-generators\.md/u);
    assert.match(afterPrompt.actionResult.prompt, /Use individual `npx jskit generate \.\.\. help` commands only/u);
    assert.doesNotMatch(afterPrompt.actionResult.prompt, /npx jskit generate crud-server-generator scaffold help/u);
    assert.match(afterPrompt.actionResult.prompt, /Do not plan hand-created packages/u);
    assert.match(afterPrompt.actionResult.prompt, /Work anchor source of truth:/u);
    assert.match(afterPrompt.actionResult.prompt, /work_title/u);
    assert.match(afterPrompt.actionResult.prompt, /work\.md/u);
    assert.match(afterPrompt.actionResult.prompt, /Do not call GitHub to rediscover the issue content/u);
    assert.match(afterPrompt.actionResult.prompt, /JSKIT placement contract/u);
    assert.match(afterPrompt.actionResult.prompt, /npx jskit list-placements --json/u);
    assertJskitUiVerificationContract(afterPrompt.actionResult.prompt);
  });
});

test("jskit seed issue definition uses the Codex conversation contract before issue creation", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new Vibe64SessionRuntime({
      adapter: createJskitTargetAdapter(),
      targetRoot
    });
    await runtime.createSession({
      initialStep: "seed_application_defined",
      metadata: sourceMetadata(targetRoot, "jskit_seed_prompt"),
      sessionId: "jskit_seed_prompt",
      workflowDefinition: VIBE64_WORKFLOW_DEFINITION_IDS.SEED_APPLICATION
    });

    const initialSession = await runtime.getSession("jskit_seed_prompt");

    assert.equal(initialSession.currentStep, "seed_application_defined");
    assert.equal(initialSession.stepMachine.status, "waiting_for_input");
    assert.equal(initialSession.currentStepDefinition.interaction.kind, "conversation");
    assert.equal(initialSession.currentStepDefinition.interaction.actionId, "define_seed_application");

    const afterPrompt = await runtime.runAction("jskit_seed_prompt", "define_seed_application", {
      conversationRequest: "Ask me the JSKIT setup choices you need."
    });

    assert.equal(afterPrompt.stepMachine.status, "awaiting_agent_result");
    assert.equal(afterPrompt.actionResult.status, "prompt_ready");
    assert.equal(afterPrompt.actionResult.promptId, "define_seed_application");
    assert.match(afterPrompt.actionResult.prompt, /defining the initial seed work/u);
    assert.match(afterPrompt.actionResult.prompt, /JSKIT seed recipe contract/u);
    assert.match(afterPrompt.actionResult.prompt, /seed guidance is authoritative/u);
    assert.match(afterPrompt.actionResult.prompt, /JSKIT seed guidance/u);
    assert.match(afterPrompt.actionResult.prompt, /Ask exactly these seed questions/u);
    assert.match(afterPrompt.actionResult.prompt, /What should this app do/u);
    assert.match(afterPrompt.actionResult.prompt, /What should the app be called/u);
    assert.match(afterPrompt.actionResult.prompt, /Should people sign in/u);
    assert.match(afterPrompt.actionResult.prompt, /Do not ask for database names/u);
    assert.match(afterPrompt.actionResult.prompt, /Do not ask the user to choose JSKIT package names/u);
    assert.match(afterPrompt.actionResult.prompt, /OpenAI API key/u);
    assert.match(afterPrompt.actionResult.prompt, /Do not start a discovery adventure/u);
    assert.match(afterPrompt.actionResult.prompt, /smallest visible app workflow/u);
    assert.match(afterPrompt.actionResult.prompt, /browser-local state/u);
    assert.match(afterPrompt.actionResult.prompt, /@jskit-ai\/create-app <app-name> --target \. --force/u);
    assert.match(afterPrompt.actionResult.prompt, /--playwright-version "\$VIBE64_PLAYWRIGHT_VERSION"/u);
    assert.match(afterPrompt.actionResult.prompt, /Do not include `npx jskit list`/u);
    assert.match(afterPrompt.actionResult.prompt, /do not ask Codex to add app-local `optimizeDeps` exclusions/u);
    assert.doesNotMatch(afterPrompt.actionResult.prompt, /JSKIT guide-first contract/u);
    assert.doesNotMatch(afterPrompt.actionResult.prompt, /Read the agent-friendly JSKIT guide/u);
    assert.doesNotMatch(afterPrompt.actionResult.prompt, /Generator discovery commands:/u);
    assert.doesNotMatch(afterPrompt.actionResult.prompt, /Inspect placement state with `npx jskit list-placements --json`/u);
    assertJskitUiVerificationContract(afterPrompt.actionResult.prompt);
    assert.match(afterPrompt.actionResult.prompt, /Vibe64 agent result routing/u);
    assert.match(afterPrompt.actionResult.prompt, /Use `inputFields` only for structured text, textarea, or password values/u);
    assert.match(afterPrompt.actionResult.prompt, /Every item needs `name`, `label`, `kind`, `privacy`, and `required`/u);
    assert.doesNotMatch(afterPrompt.actionResult.prompt, /"name": "supabaseProjectUrl"/u);
    assert.doesNotMatch(afterPrompt.actionResult.prompt, /"name": "supabaseAnonKey"/u);
    assert.match(afterPrompt.actionResult.prompt, /Possible answers:/u);
    assert.match(afterPrompt.actionResult.prompt, /For a small fixed choice, ask in Markdown and list the exact choices; do not create inputFields/u);
    assert.doesNotMatch(afterPrompt.actionResult.prompt, /input field may include `options/u);
    assert.doesNotMatch(afterPrompt.actionResult.prompt, /submitOnSelect/u);

    const afterInput = await runtime.submitCurrentStepInput("jskit_seed_prompt", {
      fields: {
        body: "Seed the JSKIT app foundation.",
        title: "Seed JSKIT application foundation",
        word: "seed"
      },
      kind: "ready",
      source: "codex",
      stepId: "seed_application_defined",
      stepStatus: "awaiting_agent_result"
    });

    assert.equal(afterInput.stepMachine.status, "confirm_files");
    assert.equal(afterInput.next.enabled, true);
    assert.equal(await runtime.store.readArtifact("jskit_seed_prompt", "issue_title"), "Seed JSKIT application foundation\n");
    assert.equal(await runtime.store.readArtifact("jskit_seed_prompt", "issue_word"), "seed\n");
    assert.equal(await runtime.store.readArtifact("jskit_seed_prompt", "issue.md"), "Seed the JSKIT app foundation.\n");
    assert.equal(await runtime.store.readArtifact("jskit_seed_prompt", "work_title"), "Seed JSKIT application foundation\n");
    assert.equal(await runtime.store.readArtifact("jskit_seed_prompt", "work_word"), "seed\n");
    assert.equal(await runtime.store.readArtifact("jskit_seed_prompt", "work.md"), "Seed the JSKIT app foundation.\n");
  });
});

test("jskit execute-plan prompt requires generators, placements, and database modules before hand-built files", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createJskitProject(targetRoot);
    const runtime = new Vibe64SessionRuntime({
      adapter: createJskitTargetAdapter(),
      projectConfig: {
        values: {
          jskit_database_runtime: "mariadb"
        }
      },
      targetRoot
    });
    await runtime.createSession({
      initialStep: "plan_and_execute",
      metadata: {
        ...sourceMetadata(targetRoot, "jskit_execute_prompt"),
        plan_ready: "yes"
      },
      sessionId: "jskit_execute_prompt"
    });

    const afterPrompt = await runtime.runAction("jskit_execute_prompt", "execute_plan");

    assert.equal(afterPrompt.actionResult.status, "prompt_ready");
    assert.equal(afterPrompt.actionResult.promptContext.adapter.managedServices[0].label, "MariaDB");
    assert.equal(afterPrompt.actionResult.promptContext.adapter.managedServices[0].client, "mariadb");
    assert.equal(Object.hasOwn(afterPrompt.actionResult.promptContext.adapter.managedServices[0], "alternateClient"), false);
    assert.equal(afterPrompt.actionResult.promptContext.adapter.managedServices[0].generatorTokenHints.host, "$DB_HOST");
    assert.equal(afterPrompt.actionResult.promptContext.adapter.managedServices[0].generatorTokenHints.password, "$DB_PASSWORD");
    assert.equal(afterPrompt.actionResult.promptContext.adapter.managedServices[0].generatorTokenHints.database, "$DB_NAME");
    assert.match(afterPrompt.actionResult.prompt, /Read the JSKIT agent guide and run the baseline discovery commands before adding new app files/u);
    assert.match(afterPrompt.actionResult.prompt, /Client files stay thin/u);
    assert.match(afterPrompt.actionResult.prompt, /Server files must follow JSKIT ownership boundaries/u);
    assert.match(afterPrompt.actionResult.prompt, /Do not hand-create packages, package descriptors, provider entrypoints/u);
    assert.match(afterPrompt.actionResult.prompt, /Before writing generic helpers for JSON:API documents/u);
    assert.match(afterPrompt.actionResult.prompt, /Do not implement framework-shaped helpers locally/u);
    assert.match(afterPrompt.actionResult.prompt, /In the final response, for every hand-written helper/u);
    assert.match(afterPrompt.actionResult.prompt, /why it belongs locally instead of in an existing shared\/global JSKIT location/u);
    assertJskitHelperGuardBeforeContract(afterPrompt.actionResult.prompt);
    assert.match(afterPrompt.actionResult.prompt, /Managed services/u);
    assert.match(afterPrompt.actionResult.prompt, /MariaDB/u);
    assert.match(afterPrompt.actionResult.prompt, /mariadb --skip-ssl --host/u);
    assert.match(afterPrompt.actionResult.prompt, /tenant-local endpoint does not offer TLS/u);
    assert.match(afterPrompt.actionResult.prompt, /derive each name from `\$DB_NAME`/u);
    assert.match(afterPrompt.actionResult.prompt, /Do not hardcode an unscoped database prefix/u);
    assert.match(afterPrompt.actionResult.prompt, /--execute/u);
    assert.match(afterPrompt.actionResult.prompt, /<SQL>/u);
    assert.match(afterPrompt.actionResult.prompt, /DB_USER/u);
    assert.match(afterPrompt.actionResult.prompt, /DB_NAME/u);
    assert.match(afterPrompt.actionResult.prompt, /env vars: DB_CLIENT, DB_HOST, DB_NAME, DB_PASSWORD, DB_PORT, DB_USER/u);
    assert.match(afterPrompt.actionResult.prompt, /generator tokens: database=\$DB_NAME/u);
    assert.match(afterPrompt.actionResult.prompt, /Do not discover replacement credentials/u);
    assert.match(afterPrompt.actionResult.prompt, /read the agent-friendly placement docs before implementation/u);
    assert.match(afterPrompt.actionResult.prompt, /node_modules\/@jskit-ai\/agent-docs\/patterns\/placements\.md/u);
    assert.match(afterPrompt.actionResult.prompt, /Configured database runtime: mariadb/u);
    assert.match(afterPrompt.actionResult.prompt, /Never create migration files directly/u);
    assert.match(afterPrompt.actionResult.prompt, /run the server-side CRUD generator for every added table/u);
    assert.match(afterPrompt.actionResult.prompt, /do not use direct Knex access from feature code/u);
    assert.match(afterPrompt.actionResult.prompt, /Do not store durable application data in JSON files/u);
    assert.match(afterPrompt.actionResult.prompt, /crud-ui-generator crud/u);
    assertJskitUiVerificationContract(afterPrompt.actionResult.prompt);
  });
});

test("jskit deslop prompt checks framework-shaped helpers before accepting them", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createJskitProject(targetRoot);
    const runtime = new Vibe64SessionRuntime({
      adapter: createJskitTargetAdapter(),
      targetRoot
    });
    await runtime.createSession({
      initialStep: "review_and_validate",
      metadata: sourceMetadata(targetRoot, "jskit_deslop_prompt"),
      sessionId: "jskit_deslop_prompt"
    });

    const afterPrompt = await runtime.runAction("jskit_deslop_prompt", "run_deslop");

    assert.equal(afterPrompt.actionResult.status, "prompt_ready");
    assert.match(afterPrompt.actionResult.prompt, /Before accepting, preserving, or writing generic helpers for JSON:API documents/u);
    assert.match(afterPrompt.actionResult.prompt, /Treat local framework-shaped helpers as findings/u);
    assert.match(afterPrompt.actionResult.prompt, /Treat any new hand-written helper, shared utility, composable/u);
    assert.match(afterPrompt.actionResult.prompt, /local-vs-shared placement as a deslop finding/u);
    assert.match(afterPrompt.actionResult.prompt, /Client files stay thin/u);
    assert.match(afterPrompt.actionResult.prompt, /Server files must follow JSKIT ownership boundaries/u);
    assertJskitUiVerificationContract(afterPrompt.actionResult.prompt);
    assertJskitHelperGuardBeforeContract(afterPrompt.actionResult.prompt);
  });
});

test("jskit seed deslop prompt uses seed recipe guidance instead of guide-first discovery", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new Vibe64SessionRuntime({
      adapter: createJskitTargetAdapter(),
      targetRoot
    });
    await runtime.createSession({
      initialStep: "review_and_validate",
      metadata: sourceMetadata(targetRoot, "jskit_seed_deslop_prompt"),
      sessionId: "jskit_seed_deslop_prompt",
      workflowDefinition: VIBE64_WORKFLOW_DEFINITION_IDS.SEED_APPLICATION
    });

    const afterPrompt = await runtime.runAction("jskit_seed_deslop_prompt", "run_deslop");

    assert.equal(afterPrompt.actionResult.status, "prompt_ready");
    assert.equal(afterPrompt.actionResult.promptId, "run_deslop");
    assert.match(afterPrompt.actionResult.prompt, /Seed work profile:/u);
    assert.match(afterPrompt.actionResult.prompt, /JSKIT seed review\/deslop contract/u);
    assert.match(afterPrompt.actionResult.prompt, /accepted seed recipe/u);
    assert.match(afterPrompt.actionResult.prompt, /full Vibe64 deslop pass/u);
    assert.match(afterPrompt.actionResult.prompt, /mapped JSKIT commands were used/u);
    assert.match(afterPrompt.actionResult.prompt, /JSKIT generated-file contract/u);
    assertJskitUiVerificationContract(afterPrompt.actionResult.prompt);
    assert.doesNotMatch(afterPrompt.actionResult.prompt, /JSKIT guide-first contract/u);
    assert.doesNotMatch(afterPrompt.actionResult.prompt, /Read the agent-friendly JSKIT guide/u);
    assert.doesNotMatch(afterPrompt.actionResult.prompt, /JSKIT placement contract/u);
    assert.doesNotMatch(afterPrompt.actionResult.prompt, /Inspect placement state with `npx jskit list-placements --json`/u);
  });
});

test("jskit issue and pull-request steps are gated by artifacts and metadata", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createJskitProject(targetRoot);
    const runtime = new Vibe64SessionRuntime({
      adapter: createJskitTargetAdapter(),
      targetRoot
    });

    await runtime.createSession({
      initialStep: "issue_file_created",
      metadata: {
        github_issue_mode: "create",
        work_source: "new_issue"
      },
      sessionId: "jskit_issue"
    });
    const issueBeforeFiles = await runtime.getSession("jskit_issue");
    assert.equal(issueBeforeFiles.next.enabled, false);
    assert.equal(issueBeforeFiles.actions.find((action) => action.id === "create_issue_on_gh")?.enabled, false);

    await runtime.store.writeArtifact("jskit_issue", "issue_title", "Add reports\n");
    await runtime.store.writeArtifact("jskit_issue", "issue_word", "Reports\n");
    await runtime.store.writeArtifact("jskit_issue", "issue.md", "Body\n");
    const issueReady = await runtime.getSession("jskit_issue");
    assert.equal(issueReady.actions.find((action) => action.id === "create_issue_on_gh")?.enabled, true);
    assert.equal(issueReady.next.enabled, false);

    await runtime.store.writeMetadataValue("jskit_issue", "issue_url", "https://github.com/example/repo/issues/42");
    const issueSubmitted = await runtime.getSession("jskit_issue");
    assert.equal(issueSubmitted.next.enabled, true);
    assert.equal(issueSubmitted.actions.find((action) => action.id === "create_issue_on_gh")?.enabled, false);

    await runtime.createSession({
      initialStep: "create_and_merge_pull_request",
      metadata: {
        ...sourceMetadata(targetRoot, "jskit_pr"),
        branch_pushed: "vibe64/jskit_pr"
      },
      sessionId: "jskit_pr"
    });
    const prBeforeFile = await runtime.getSession("jskit_pr");
    const prBeforeFileActions = enabledByActionId(prBeforeFile.actions);
    assert.equal(prBeforeFile.next.enabled, false);
    assert.equal(prBeforeFileActions.open_pr, false);
    assert.equal(prBeforeFileActions.create_pr_on_gh, false);

    await runtime.store.writeArtifact("jskit_pr", "tmp/create_and_merge_pull_request.title.txt", "PR title\n");
    await runtime.store.writeArtifact("jskit_pr", "tmp/create_and_merge_pull_request.body.md", "PR body\n");
    const prReady = await runtime.getSession("jskit_pr");
    const prReadyActions = enabledByActionId(prReady.actions);
    assert.equal(prReadyActions.open_pr, false);
    assert.equal(prReadyActions.create_pr_on_gh, true);

    await runtime.store.writeMetadataValue("jskit_pr", "pr_url", "https://github.com/example/repo/pull/24");
    const prSubmitted = await runtime.getSession("jskit_pr");
    const prSubmittedActions = enabledByActionId(prSubmitted.actions);
    assert.equal(prSubmitted.next.enabled, false);
    assert.equal(prSubmittedActions.open_pr, true);
    assert.equal(prSubmittedActions.resolve_pull_request, false);
    assert.equal(prSubmittedActions.create_pr_on_gh, false);
    assert.equal(prSubmittedActions.prepare_for_merge, true);
    assert.equal(prSubmittedActions.merge_pr, true);
    assert.equal(prSubmittedActions.sync_main_checkout, false);
    assert.equal(prSubmittedActions.skip_merge, true);
  });
});

test("jskit merge, sync, and finish steps follow current metadata gates", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createJskitProject(targetRoot);
    const runtime = new Vibe64SessionRuntime({
      adapter: createJskitTargetAdapter(),
      targetRoot
    });

    await runtime.createSession({
      initialStep: "create_and_merge_pull_request",
      metadata: sourceMetadata(targetRoot, "jskit_merge"),
      sessionId: "jskit_merge"
    });
    const mergeWithoutPr = await runtime.getSession("jskit_merge");
    assert.deepEqual(enabledByActionId(mergeWithoutPr.actions), {
      create_pr_on_gh: false,
      merge_pr: false,
      open_pr: false,
      prepare_for_merge: false,
      resolve_pull_request: true,
      sync_main_checkout: false,
      skip_merge: false
    });

    await runtime.store.writeArtifact("jskit_merge", "report.md", "# Report\n");
    await runtime.store.writeMetadataValue("jskit_merge", "pr_url", "https://github.com/example/repo/pull/24");
    const mergeReady = await runtime.getSession("jskit_merge");
    assert.deepEqual(enabledByActionId(mergeReady.actions), {
      create_pr_on_gh: false,
      merge_pr: true,
      open_pr: true,
      prepare_for_merge: true,
      resolve_pull_request: false,
      sync_main_checkout: false,
      skip_merge: true
    });

    const afterPrepare = await runtime.runAction("jskit_merge", "prepare_for_merge");
    assert.equal(afterPrepare.actionResult.promptId, "prepare_for_merge");
    assert.match(afterPrepare.actionResult.prompt, /Prepare the JSKIT pull request for merge/u);
    assert.match(afterPrepare.actionResult.prompt, /Git cache can be refreshed/u);
    await assert.rejects(
      () => runtime.runAction("jskit_merge", "merge_pr"),
      {
        code: "vibe64_action_disabled",
        message: "Wait for Codex to finish this step."
      }
    );

    await runtime.createSession({
      initialStep: "create_and_merge_pull_request",
      metadata: {
        pr_url: "https://github.com/example/repo/pull/24"
      },
      sessionId: "jskit_sync_blocked"
    });
    const syncBlocked = await runtime.getSession("jskit_sync_blocked");
    const syncBlockedAction = syncBlocked.actions.find((action) => action.id === "sync_main_checkout");
    assert.equal(syncBlockedAction.enabled, false);
    assert.equal(syncBlockedAction.disabledReason, "Merge the pull request before refreshing the Git cache.");
    assert.equal(syncBlocked.next.enabled, false);

    await runtime.createSession({
      initialStep: "create_and_merge_pull_request",
      metadata: {
        pr_merged: "yes",
        pr_url: "https://github.com/example/repo/pull/24"
      },
      sessionId: "jskit_sync"
    });
    const syncReady = await runtime.getSession("jskit_sync");
    assert.equal(syncReady.actions.find((action) => action.id === "sync_main_checkout").enabled, true);
    assert.equal(syncReady.next.enabled, false);

    await runtime.createSession({
      initialStep: "session_finished",
      metadata: {
        pr_url: "https://github.com/example/repo/pull/24"
      },
      sessionId: "jskit_finish_blocked"
    });
    const finishBlocked = await runtime.getSession("jskit_finish_blocked");
    assert.equal(finishBlocked.actions.find((action) => action.id === "finish_session").enabled, false);

    await runtime.createSession({
      initialStep: "session_finished",
      metadata: {
        main_checkout_synced: "yes",
        pr_url: "https://github.com/example/repo/pull/24"
      },
      sessionId: "jskit_finish"
    });
    const afterFinish = await runtime.runAction("jskit_finish", "finish_session");
    assert.equal(afterFinish.status, VIBE64_SESSION_STATUS.FINISHED);
    assert.equal(afterFinish.metadata.session_finished, "yes");
    assert.equal(afterFinish.actionResult.sessionStatus, VIBE64_SESSION_STATUS.FINISHED);
  });
});

test("jskit command actions expose terminal specs instead of direct runners", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createJskitProject(targetRoot);
    const calls = [];
    const adapter = createJskitTargetAdapter({
      commandTerminalSpecFactory: async ({ commandId, context, targetRoot: commandTargetRoot }) => {
        calls.push({
          commandId,
          input: context.input,
          targetRoot: commandTargetRoot
        });
        return {
          args: ["-lc", "printf ok"],
          command: "bash",
          commandPreview: "printf ok",
          cwd: commandTargetRoot,
          ok: true,
          successMetadata: {
            example_done: "yes"
          },
          successMessage: "Example command completed."
        };
      }
    });

    const spec = await adapter.createCommandTerminalSpec("create_source", {
      input: {
        dryRun: true
      },
      session: {
        targetRoot
      }
    });

    assert.equal(spec.ok, true);
    assert.equal(spec.command, "bash");
    assert.deepEqual(spec.successMetadata, {
      example_done: "yes"
    });
    assert.deepEqual(calls, [
      {
        commandId: "create_source",
        input: {
          dryRun: true
        },
        targetRoot
      }
    ]);
  });
});

test("jskit validation hooks expose code index and verification commands", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createJskitProject(targetRoot);

    const codeIndex = await jskitCodeIndexHook({
      worktreePath: targetRoot
    });
    const checks = await jskitAutomatedChecksHook({
      worktreePath: targetRoot
    });

    assertNodeRuntimeCommand(codeIndex.commandPreview, "npx --no-install jskit helper-map update");
    assert.equal(codeIndex.metadata.code_index_path, ".jskit/helper-map.md");
    assertNodeRuntimeCommand(checks.commandPreview, "npx --no-install jskit app verify");
  });
});
