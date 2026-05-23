import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  AI_STUDIO_SESSION_STATUS,
  AI_STUDIO_WORKFLOW_PROFILE_IDS,
  AiStudioSessionRuntime
} from "../../server/lib/aiStudio/index.js";
import {
  JSKIT_AI_STUDIO_COMMANDS,
  JSKIT_ALLOW_SELF_TARGET_CONFIG,
  JSKIT_CONFIG_FIELDS,
  createJskitLaunchTargetTerminalSpec,
  createJskitTargetAdapter,
  listJskitLaunchTargets
} from "../../server/lib/aiStudio/adapters/jskit/index.js";
import {
  JSKIT_ALLOW_SELF_TARGET_CONFIG_PATH
} from "../../server/lib/aiStudio/adapters/jskit/launchTargets.js";
import {
  jskitAutomatedChecksHook,
  jskitCodeIndexHook
} from "../../server/lib/aiStudio/adapters/jskit/adapter.js";
import { withTemporaryRoot } from "./aiStudioTestHelpers.js";

async function writeProjectFile(root, relativePath, text = "") {
  const filePath = path.join(root, relativePath);
  await mkdir(path.dirname(filePath), {
    recursive: true
  });
  await writeFile(filePath, text, "utf8");
}

async function createJskitProject(root) {
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
    writeProjectFile(root, ".jskit/lock.json", "{}\n"),
    writeProjectFile(root, ".jskit/APP_BLUEPRINT.md", "# App blueprint\n")
  ]);
}

function commandIds() {
  return JSKIT_AI_STUDIO_COMMANDS
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

    assert.deepEqual(detection, {
      detected: true,
      reason: ""
    });
    assert.equal(facts.summary, "JSKIT project type selected.");
    assert.equal(facts.promptContext.package_name, "example-jskit-app");
    assert.equal(facts.promptContext.scripts, "build, test");
    assert.equal(facts.promptContext.blueprint_exists, "true");
    assert.equal(facts.promptContext.blueprint_relative_path, ".jskit/APP_BLUEPRINT.md");
    assert.equal(facts.promptContext.blueprint_path, path.join(targetRoot, ".jskit/APP_BLUEPRINT.md"));
    assert.match(facts.promptContext.agent_guide_contract, /guide\/agent\/index\.md/u);
    assert.match(facts.promptContext.agent_guide_contract, /app-setup\/database-layer\.md/u);
    assert.match(facts.promptContext.agent_guide_contract, /Use individual `npx jskit generate \.\.\. help` commands only/u);
    assert.match(facts.promptContext.tooling_contract, /npx jskit helper-map update/u);
    assert.match(facts.promptContext.tooling_contract, /New JSKIT-owned files must be created/u);
    assert.match(facts.promptContext.tooling_contract, /Before writing generic helpers for JSON:API documents/u);
    assert.match(facts.promptContext.tooling_contract, /search JSKIT package exports and agent-doc references first/u);
    assert.match(facts.promptContext.generator_discovery_commands, /npx jskit list-placements --json/u);
    assert.doesNotMatch(facts.promptContext.generator_discovery_commands, /generate .* help/u);
    assert.match(facts.promptContext.placement_contract, /agent-friendly placement docs/u);
    assert.match(facts.promptContext.placement_contract, /node_modules\/@jskit-ai\/agent-docs\/patterns\/placements\.md/u);
    assert.match(facts.promptContext.database_contract, /Configured database runtime: none/u);
    assert.match(facts.promptContext.environment_blueprint, /Use `npx jskit \.\.\.`/u);
    assert.equal(facts.promptContext.valid_jskit_markers, "true");
    assert.deepEqual(Object.keys(facts.capabilities).sort(), capabilityIds());
    assert.equal(facts.capabilities.update_code_index, true);
    assert.deepEqual(facts.commands.map((command) => command.id), commandIds());
  });
});

test("jskit adapter reflects configured database runtime in prompt context", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createJskitProject(targetRoot);
    const adapter = createJskitTargetAdapter();

    const facts = await adapter.inspect({
      config: {
        values: {
          jskit_database_runtime: "mysql"
        }
      },
      targetRoot
    });

    assert.equal(facts.promptContext.database_runtime, "mysql");
    assert.match(facts.promptContext.database_contract, /Configured database runtime: mysql/u);
    assert.match(facts.promptContext.database_contract, /Never create migration files directly/u);
    assert.match(facts.promptContext.database_contract, /Every table added for application data must have `npx jskit generate crud-server-generator scaffold \.\.\.` run for it/u);
    assert.match(facts.promptContext.database_contract, /json-rest-api/u);
    assert.match(facts.promptContext.database_contract, /not direct Knex queries/u);
    assert.match(facts.promptContext.database_contract, /Do not store durable application data in JSON files/u);

    const invalidConfigFacts = await adapter.inspect({
      config: {
        values: {
          jskit_database_runtime: "sqlite"
        }
      },
      targetRoot
    });

    assert.equal(invalidConfigFacts.promptContext.database_runtime, "none");
    assert.match(invalidConfigFacts.promptContext.seed_issue_guidance, /tenancy\/workspaces/u);
  });
});

test("jskit adapter exposes explicit self-target config policy", async () => {
  const adapter = createJskitTargetAdapter();
  const selfTargetField = JSKIT_CONFIG_FIELDS.find((field) => field.id === JSKIT_ALLOW_SELF_TARGET_CONFIG);

  assert.equal(selfTargetField.type, "boolean");
  assert.equal(selfTargetField.defaultValue, false);
  assert.equal(await adapter.allowsStudioSelfTarget({
    config: {
      values: {
        [JSKIT_ALLOW_SELF_TARGET_CONFIG]: false
      }
    }
  }), false);
  assert.equal(await adapter.allowsStudioSelfTarget({
    config: {
      values: {
        [JSKIT_ALLOW_SELF_TARGET_CONFIG]: true
      }
    }
  }), true);
});

test("jskit self-target config enables host Docker for recursive Studio launch", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await Promise.all([
      writeProjectFile(targetRoot, "package.json", JSON.stringify({
        scripts: {
          dev: "vite",
          server: "node server.js"
        }
      }, null, 2)),
      writeProjectFile(targetRoot, JSKIT_ALLOW_SELF_TARGET_CONFIG_PATH, "true\n")
    ]);

    const spec = await createJskitLaunchTargetTerminalSpec({
      launchTargetId: "dev",
      session: {
        metadata: {
          worktree_path: targetRoot
        },
        sessionId: "recursive_studio_launch",
        targetRoot
      },
      targetRoot
    });

    assert.equal(spec.ok, true);
    assert.equal(spec.metadata.hostDocker, true);
    assert.equal(spec.metadata.hostDockerSource, JSKIT_ALLOW_SELF_TARGET_CONFIG_PATH);
    const args = spec.args({
      id: "unit-terminal"
    });
    assert.ok(args.includes("DOCKER_HOST=unix:///var/run/docker.sock"));
    assert.ok(args.includes("/var/run/docker.sock:/var/run/docker.sock"));
  });
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
          worktree_path: targetRoot
        }
      }
    });

    assert.deepEqual(launchTargets, [
      {
        defaultDisplay: "minimized",
        id: "built",
        label: "Run built app"
      },
      {
        defaultDisplay: "minimized",
        id: "dev",
        label: "Run app"
      }
    ]);
  });
});

test("jskit built launch waits for the server readiness marker before opening", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await writeProjectFile(targetRoot, "package.json", JSON.stringify({
      scripts: {
        build: "vite build",
        server: "node server.js"
      }
    }, null, 2));

    const spec = await createJskitLaunchTargetTerminalSpec({
      launchTargetId: "built",
      session: {
        metadata: {
          worktree_path: targetRoot
        },
        sessionId: "jskit_built_launch",
        targetRoot
      },
      targetRoot
    });

    assert.equal(spec.ok, true);
    assert.match(spec.metadata.readinessMarker, /^\[\[AI_STUDIO_LAUNCH_READY_V1:/u);
    assert.equal(spec.metadata.launchReady, false);
    assert.equal(spec.metadata.defaultDisplay, "minimized");
    assert.equal(spec.metadata.buildCommand, "npm run build");
    assert.equal(spec.metadata.serverCommand, "npm run server");

    const args = spec.args({
      id: "unit-terminal"
    });
    const startupScript = args.at(-1);
    assert.match(startupScript, /npm run build/u);
    assert.match(startupScript, /npm run server/u);
    assert.match(startupScript, /action:%s/u);
    assert.match(startupScript, /AI_STUDIO_LAUNCH_READY_V1/u);
  });
});

test("jskit dev launch starts backend and Vite together", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await writeProjectFile(targetRoot, "package.json", JSON.stringify({
      scripts: {
        dev: "vite",
        server: "node server.js"
      }
    }, null, 2));

    const spec = await createJskitLaunchTargetTerminalSpec({
      launchTargetId: "dev",
      session: {
        metadata: {
          worktree_path: targetRoot
        },
        sessionId: "jskit_dev_launch",
        targetRoot
      },
      targetRoot
    });

    assert.equal(spec.ok, true);
    assert.equal(spec.metadata.backendCommand, "npm run server");
    assert.equal(spec.metadata.backendPort, 3000);
    assert.equal(spec.metadata.defaultDisplay, "minimized");
    assert.equal(spec.metadata.frontendCommand, "npm run dev -- --host 0.0.0.0 --port \"$PORT\"");
    assert.match(spec.metadata.readinessMarker, /^\[\[AI_STUDIO_LAUNCH_READY_V1:/u);

    const args = spec.args({
      id: "unit-terminal"
    });
    const startupScript = args.at(-1);
    assert.match(startupScript, /AI_STUDIO_JSKIT_BACKEND_PORT=\\?"?3000/u);
    assert.match(startupScript, /npm run server/u);
    assert.match(startupScript, /VITE_API_PROXY_TARGET="http:\/\/127\.0\.0\.1:\$AI_STUDIO_JSKIT_BACKEND_PORT"/u);
    assert.match(startupScript, /npm run dev -- --host 0\.0\.0\.0 --port "\$PORT"/u);
    assert.match(startupScript, /AI_STUDIO_LAUNCH_READY_V1/u);
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

    assert.equal(detection.detected, true);
    assert.match(facts.summary, /Missing markers/u);
    assert.equal(facts.promptContext.valid_jskit_markers, "false");
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
        code: "ai_studio_invalid_jskit_json"
      }
    );
  });
});

test("jskit prompt actions include JSKIT prompt context", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createJskitProject(targetRoot);
    const runtime = new AiStudioSessionRuntime({
      adapter: createJskitTargetAdapter(),
      targetRoot
    });
    await runtime.createSession({
      initialStep: "plan_made",
      sessionId: "jskit_prompt"
    });

    const afterPrompt = await runtime.runAction("jskit_prompt", "make_plan");

    assert.equal(afterPrompt.actionResult.status, "prompt_ready");
    assert.equal(afterPrompt.actionResult.promptContext.adapter.id, "jskit");
    assert.equal(afterPrompt.actionResult.promptContext.adapter.promptContext.package_name, "example-jskit-app");
    assert.match(afterPrompt.actionResult.prompt, /example-jskit-app/u);
    assert.match(afterPrompt.actionResult.prompt, /Managed services/u);
    assert.match(afterPrompt.actionResult.prompt, /Use the Managed services section as the only source/u);
    assert.doesNotMatch(afterPrompt.actionResult.prompt, /Managed runtime containers/u);
    assert.match(afterPrompt.actionResult.prompt, /JSKIT generated-file contract/u);
    assert.match(afterPrompt.actionResult.prompt, /JSKIT guide-first contract/u);
    assert.match(afterPrompt.actionResult.prompt, /guide\/agent\/generators\/crud-generators\.md/u);
    assert.match(afterPrompt.actionResult.prompt, /Use individual `npx jskit generate \.\.\. help` commands only/u);
    assert.doesNotMatch(afterPrompt.actionResult.prompt, /npx jskit generate crud-server-generator scaffold help/u);
    assert.match(afterPrompt.actionResult.prompt, /Do not plan hand-created packages/u);
    assert.match(afterPrompt.actionResult.prompt, /JSKIT placement contract/u);
    assert.match(afterPrompt.actionResult.prompt, /npx jskit list-placements --json/u);
  });
});

test("jskit seed issue definition uses the current-step input contract before issue creation", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new AiStudioSessionRuntime({
      adapter: createJskitTargetAdapter(),
      targetRoot
    });
    await runtime.createSession({
      initialStep: "seed_application_defined",
      sessionId: "jskit_seed_prompt",
      workflowProfile: AI_STUDIO_WORKFLOW_PROFILE_IDS.SEED_APPLICATION
    });

    const initialSession = await runtime.getSession("jskit_seed_prompt");

    assert.equal(initialSession.currentStep, "seed_application_defined");
    assert.equal(initialSession.stepMachine.status, "need_input");
    assert.equal(initialSession.currentStepDefinition.interaction.submitKind, "ready");

    const afterInput = await runtime.submitCurrentStepInput("jskit_seed_prompt", {
      fields: {
        body: "Seed the JSKIT app foundation.",
        title: "Seed JSKIT application foundation",
        word: "seed"
      },
      kind: "ready",
      stepId: "seed_application_defined",
      stepStatus: "need_input"
    });

    assert.equal(afterInput.stepMachine.status, "confirm_files");
    assert.equal(afterInput.next.enabled, true);
    assert.equal(await runtime.store.readArtifact("jskit_seed_prompt", "issue_title"), "Seed JSKIT application foundation\n");
    assert.equal(await runtime.store.readArtifact("jskit_seed_prompt", "issue_word"), "seed\n");
    assert.equal(await runtime.store.readArtifact("jskit_seed_prompt", "issue.md"), "Seed the JSKIT app foundation.\n");
  });
});

test("jskit execute-plan prompt requires generators, placements, and database modules before hand-built files", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createJskitProject(targetRoot);
    const runtime = new AiStudioSessionRuntime({
      adapter: createJskitTargetAdapter(),
      projectConfig: {
        values: {
          jskit_database_runtime: "mysql"
        }
      },
      targetRoot
    });
    await runtime.createSession({
      initialStep: "plan_executed",
      sessionId: "jskit_execute_prompt"
    });

    const afterPrompt = await runtime.runAction("jskit_execute_prompt", "execute_plan");

    assert.equal(afterPrompt.actionResult.status, "prompt_ready");
    assert.equal(afterPrompt.actionResult.promptContext.adapter.managedServices[0].label, "JSKIT MariaDB");
    assert.equal(afterPrompt.actionResult.promptContext.adapter.managedServices[0].client, "mysql");
    assert.equal(afterPrompt.actionResult.promptContext.adapter.managedServices[0].alternateClient, "mariadb");
    assert.equal(afterPrompt.actionResult.promptContext.adapter.managedServices[0].generatorTokenHints.host, "$MYSQL_HOST");
    assert.equal(afterPrompt.actionResult.promptContext.adapter.managedServices[0].generatorTokenHints.password, "$MYSQL_PWD");
    assert.equal(afterPrompt.actionResult.promptContext.adapter.managedServices[0].generatorTokenHints.database, "$MYSQL_DATABASE");
    assert.match(afterPrompt.actionResult.prompt, /Read the JSKIT agent guide and run the baseline discovery commands before adding new app files/u);
    assert.match(afterPrompt.actionResult.prompt, /Do not hand-create packages, package descriptors, provider entrypoints/u);
    assert.match(afterPrompt.actionResult.prompt, /Before writing generic helpers for JSON:API documents/u);
    assert.match(afterPrompt.actionResult.prompt, /Do not implement framework-shaped helpers locally/u);
    assert.match(afterPrompt.actionResult.prompt, /In the final response, for every hand-written helper/u);
    assert.match(afterPrompt.actionResult.prompt, /why it belongs locally instead of in an existing shared\/global JSKIT location/u);
    assertJskitHelperGuardBeforeContract(afterPrompt.actionResult.prompt);
    assert.match(afterPrompt.actionResult.prompt, /Managed services/u);
    assert.match(afterPrompt.actionResult.prompt, /JSKIT MariaDB/u);
    assert.match(afterPrompt.actionResult.prompt, /mysql --host/u);
    assert.match(afterPrompt.actionResult.prompt, /--execute/u);
    assert.match(afterPrompt.actionResult.prompt, /<SQL>/u);
    assert.match(afterPrompt.actionResult.prompt, /AI_STUDIO_MYSQL_USER/u);
    assert.match(afterPrompt.actionResult.prompt, /MYSQL_DATABASE/u);
    assert.match(afterPrompt.actionResult.prompt, /database host reachable from the terminal/u);
    assert.match(afterPrompt.actionResult.prompt, /database password used by mysql and mariadb clients/u);
    assert.match(afterPrompt.actionResult.prompt, /generatorTokenHints/u);
    assert.match(afterPrompt.actionResult.prompt, /Do not inspect Docker/u);
    assert.match(afterPrompt.actionResult.prompt, /read the agent-friendly placement docs before implementation/u);
    assert.match(afterPrompt.actionResult.prompt, /node_modules\/@jskit-ai\/agent-docs\/patterns\/placements\.md/u);
    assert.match(afterPrompt.actionResult.prompt, /Configured database runtime: mysql/u);
    assert.match(afterPrompt.actionResult.prompt, /Never create migration files directly/u);
    assert.match(afterPrompt.actionResult.prompt, /run the server-side CRUD generator for every added table/u);
    assert.match(afterPrompt.actionResult.prompt, /do not use direct Knex access from feature code/u);
    assert.match(afterPrompt.actionResult.prompt, /Do not store durable application data in JSON files/u);
    assert.match(afterPrompt.actionResult.prompt, /crud-ui-generator crud/u);
  });
});

test("jskit deslop prompt checks framework-shaped helpers before accepting them", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createJskitProject(targetRoot);
    const runtime = new AiStudioSessionRuntime({
      adapter: createJskitTargetAdapter(),
      targetRoot
    });
    await runtime.createSession({
      initialStep: "review_run",
      sessionId: "jskit_deslop_prompt"
    });

    const afterPrompt = await runtime.runAction("jskit_deslop_prompt", "run_deslop");

    assert.equal(afterPrompt.actionResult.status, "prompt_ready");
    assert.match(afterPrompt.actionResult.prompt, /Before accepting, preserving, or writing generic helpers for JSON:API documents/u);
    assert.match(afterPrompt.actionResult.prompt, /Treat local framework-shaped helpers as findings/u);
    assert.match(afterPrompt.actionResult.prompt, /Treat any new hand-written helper, shared utility, composable/u);
    assert.match(afterPrompt.actionResult.prompt, /local-vs-shared placement as a deslop finding/u);
    assertJskitHelperGuardBeforeContract(afterPrompt.actionResult.prompt);
  });
});

test("jskit issue and pull-request steps are gated by artifacts and metadata", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createJskitProject(targetRoot);
    const runtime = new AiStudioSessionRuntime({
      adapter: createJskitTargetAdapter(),
      targetRoot
    });

    await runtime.createSession({
      initialStep: "issue_submitted",
      sessionId: "jskit_issue"
    });
    const issueBeforeFiles = await runtime.getSession("jskit_issue");
    assert.equal(issueBeforeFiles.next.enabled, false);
    assert.deepEqual(issueBeforeFiles.actions.map((action) => ({
      enabled: action.enabled,
      id: action.id
    })), [
      {
        enabled: false,
        id: "create_issue_on_gh"
      }
    ]);

    await runtime.store.writeArtifact("jskit_issue", "issue_title", "Add reports\n");
    await runtime.store.writeArtifact("jskit_issue", "issue_word", "Reports\n");
    await runtime.store.writeArtifact("jskit_issue", "issue.md", "Body\n");
    const issueReady = await runtime.getSession("jskit_issue");
    assert.deepEqual(issueReady.actions.map((action) => ({
      enabled: action.enabled,
      id: action.id
    })), [
      {
        enabled: true,
        id: "create_issue_on_gh"
      }
    ]);
    assert.equal(issueReady.next.enabled, false);

    await runtime.store.writeMetadataValue("jskit_issue", "issue_url", "https://github.com/example/repo/issues/42");
    const issueSubmitted = await runtime.getSession("jskit_issue");
    assert.equal(issueSubmitted.next.enabled, true);
    assert.deepEqual(issueSubmitted.actions.map((action) => ({
      enabled: action.enabled,
      id: action.id
    })), [
      {
        enabled: false,
        id: "create_issue_on_gh"
      }
    ]);

    await runtime.createSession({
      initialStep: "create_pull_request",
      metadata: {
        branch_pushed: "ai-studio/jskit_pr"
      },
      sessionId: "jskit_pr"
    });
    const prBeforeFile = await runtime.getSession("jskit_pr");
    const prBeforeFileActions = enabledByActionId(prBeforeFile.actions);
    assert.equal(prBeforeFile.next.enabled, false);
    assert.equal(prBeforeFileActions.open_pr, false);
    assert.equal(prBeforeFileActions.create_pr_on_gh, false);

    await runtime.store.writeArtifact("jskit_pr", "tmp/create_pull_request.title.txt", "PR title\n");
    await runtime.store.writeArtifact("jskit_pr", "tmp/create_pull_request.body.md", "PR body\n");
    const prReady = await runtime.getSession("jskit_pr");
    const prReadyActions = enabledByActionId(prReady.actions);
    assert.equal(prReadyActions.open_pr, false);
    assert.equal(prReadyActions.create_pr_on_gh, true);

    await runtime.store.writeMetadataValue("jskit_pr", "pr_url", "https://github.com/example/repo/pull/24");
    const prSubmitted = await runtime.getSession("jskit_pr");
    const prSubmittedActions = enabledByActionId(prSubmitted.actions);
    assert.equal(prSubmitted.next.enabled, true);
    assert.equal(prSubmittedActions.open_pr, true);
    assert.equal(prSubmittedActions.create_pr_on_gh, false);
  });
});

test("jskit merge, sync, and finish steps follow current metadata gates", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createJskitProject(targetRoot);
    const runtime = new AiStudioSessionRuntime({
      adapter: createJskitTargetAdapter(),
      targetRoot
    });

    await runtime.createSession({
      initialStep: "pr_merged",
      sessionId: "jskit_merge"
    });
    const mergeWithoutPr = await runtime.getSession("jskit_merge");
    assert.deepEqual(enabledByActionId(mergeWithoutPr.actions), {
      merge_pr: false,
      prepare_for_merge: false,
      skip_merge: false
    });

    await runtime.store.writeArtifact("jskit_merge", "report.md", "# Report\n");
    await runtime.store.writeMetadataValue("jskit_merge", "pr_url", "https://github.com/example/repo/pull/24");
    const mergeReady = await runtime.getSession("jskit_merge");
    assert.deepEqual(enabledByActionId(mergeReady.actions), {
      merge_pr: true,
      prepare_for_merge: true,
      skip_merge: true
    });

    const afterPrepare = await runtime.runAction("jskit_merge", "prepare_for_merge");
    assert.equal(afterPrepare.actionResult.promptId, "prepare_for_merge");
    assert.match(afterPrepare.actionResult.prompt, /Prepare the JSKIT pull request for merge/u);
    assert.match(afterPrepare.actionResult.prompt, /main checkout is ready to sync/u);
    await assert.rejects(
      () => runtime.runAction("jskit_merge", "merge_pr"),
      {
        code: "ai_studio_command_requires_terminal"
      }
    );

    await runtime.createSession({
      initialStep: "main_checkout_synced",
      metadata: {
        pr_url: "https://github.com/example/repo/pull/24"
      },
      sessionId: "jskit_sync_blocked"
    });
    const syncBlocked = await runtime.getSession("jskit_sync_blocked");
    assert.equal(syncBlocked.actions[0].enabled, false);
    assert.equal(syncBlocked.actions[0].disabledReason, "Merge the pull request before syncing the main checkout.");

    await runtime.createSession({
      initialStep: "main_checkout_synced",
      metadata: {
        pr_merged: "yes",
        pr_url: "https://github.com/example/repo/pull/24"
      },
      sessionId: "jskit_sync"
    });
    const syncReady = await runtime.getSession("jskit_sync");
    assert.equal(syncReady.actions[0].enabled, true);

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
    assert.equal(afterFinish.status, AI_STUDIO_SESSION_STATUS.FINISHED);
    assert.equal(afterFinish.metadata.session_finished, "yes");
    assert.equal(afterFinish.actionResult.sessionStatus, AI_STUDIO_SESSION_STATUS.FINISHED);
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

    const spec = await adapter.createCommandTerminalSpec("create_worktree", {
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
        commandId: "create_worktree",
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

    assert.equal(codeIndex.commandPreview, "npx --no-install jskit helper-map update");
    assert.equal(codeIndex.metadata.code_index_path, ".jskit/helper-map.md");
    assert.equal(checks.commandPreview, "npx --no-install jskit app verify");
  });
});
