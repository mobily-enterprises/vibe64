import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  AI_STUDIO_SESSION_STATUS,
  AiStudioSessionRuntime,
  JskitTargetAdapter
} from "../../server/lib/aiStudio/index.js";
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

test("jskit adapter detects a JSKIT target and exposes setup facts", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createJskitProject(targetRoot);
    const adapter = new JskitTargetAdapter();

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
    assert.equal(facts.summary, "JSKIT project detected.");
    assert.equal(facts.promptContext.package_name, "example-jskit-app");
    assert.equal(facts.promptContext.scripts, "build, test");
    assert.equal(facts.promptContext.blueprint_exists, "true");
    assert.equal(facts.promptContext.blueprint_relative_path, ".jskit/APP_BLUEPRINT.md");
    assert.equal(facts.promptContext.blueprint_path, path.join(targetRoot, ".jskit/APP_BLUEPRINT.md"));
    assert.deepEqual(facts.capabilities, {
      accept_changes: true,
      commit_changes: true,
      create_issue_file: true,
      create_issue_on_gh: true,
      create_pr_file: true,
      create_pr_on_gh: true,
      create_worktree: true,
      edit_pr: true,
      edit_issue: true,
      finish_session: true,
      install_dependencies: true,
      merge_pr: true,
      prepare_for_merge: true,
      run_automated_checks: true,
      run_deep_ui_check: true,
      sync_main_checkout: true,
      update_project_knowledge: true,
      send_issue_prompt: true
    });
    assert.deepEqual(facts.commands.map((command) => command.id), [
      "create_worktree",
      "install_dependencies",
      "create_issue_on_gh",
      "run_automated_checks",
      "accept_changes",
      "commit_changes",
      "create_pr_on_gh",
      "merge_pr",
      "sync_main_checkout",
      "finish_session"
    ]);
  });
});

test("jskit adapter leaves capabilities empty when target markers are missing", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await writeProjectFile(targetRoot, "package.json", "{}\n");
    const adapter = new JskitTargetAdapter();

    const detection = await adapter.detect({
      targetRoot
    });
    const facts = await adapter.inspect({
      targetRoot
    });

    assert.equal(detection.detected, false);
    assert.match(detection.reason, /Missing JSKIT markers/u);
    assert.deepEqual(facts.capabilities, {});
    assert.deepEqual(facts.commands, []);
  });
});

test("jskit adapter reports malformed package.json instead of hiding it", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createJskitProject(targetRoot);
    await writeProjectFile(targetRoot, "package.json", "{ not json\n");
    const adapter = new JskitTargetAdapter();

    const detection = await adapter.detect({
      targetRoot
    });
    assert.equal(detection.detected, true);

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

test("jskit adapter command results persist issue metadata and keep Next gated until issue submission", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createJskitProject(targetRoot);
    const calls = [];
    const runtime = new AiStudioSessionRuntime({
      adapter: new JskitTargetAdapter({
        commandRunner: async ({ commandId, targetRoot: commandTargetRoot }) => {
          calls.push({
            commandId,
            targetRoot: commandTargetRoot
          });
          return {
            message: "Created GitHub issue.",
            metadata: {
              issue_url: "https://github.com/example/repo/issues/42"
            },
            status: "completed"
          };
        }
      }),
      clock: () => new Date("2026-05-16T01:02:03.000Z"),
      targetRoot
    });
    await runtime.createSession({
      initialStep: "issue_submitted",
      sessionId: "jskit_issue"
    });

    const beforeSubmit = await runtime.getSession("jskit_issue");
    assert.equal(beforeSubmit.next.enabled, false);
    assert.equal(beforeSubmit.next.disabledReason, "Waiting for metadata: issue_url.");

    const afterSubmit = await runtime.runAction("jskit_issue", "create_issue_on_gh");

    assert.deepEqual(calls, [
      {
        commandId: "create_issue_on_gh",
        targetRoot
      }
    ]);
    assert.equal(afterSubmit.metadata.issue_url, "https://github.com/example/repo/issues/42");
    assert.equal(afterSubmit.next.enabled, true);
    assert.equal(afterSubmit.next.stepId, "plan_made");
    assert.deepEqual(afterSubmit.actionResult.metadata, {
      issue_url: "https://github.com/example/repo/issues/42"
    });
    assert.equal(await runtime.store.readMetadataValue("jskit_issue", "issue_url"), "https://github.com/example/repo/issues/42");
  });
});

test("jskit adapter prompt actions include JSKIT prompt context", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createJskitProject(targetRoot);
    const runtime = new AiStudioSessionRuntime({
      adapter: new JskitTargetAdapter(),
      targetRoot
    });
    await runtime.createSession({
      initialStep: "issue_file_created",
      sessionId: "jskit_prompt"
    });

    const afterPrompt = await runtime.runAction("jskit_prompt", "create_issue_file");

    assert.equal(afterPrompt.actionResult.status, "prompt_ready");
    assert.equal(afterPrompt.actionResult.promptContext.adapter.id, "jskit");
    assert.equal(afterPrompt.actionResult.promptContext.adapter.promptContext.package_name, "example-jskit-app");
    assert.match(afterPrompt.actionResult.prompt, /example-jskit-app/u);
  });
});

test("jskit adapter exposes middle-workflow prompt actions through JSKIT capabilities", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createJskitProject(targetRoot);
    const runtime = new AiStudioSessionRuntime({
      adapter: new JskitTargetAdapter(),
      targetRoot
    });
    await runtime.createSession({
      initialStep: "deep_ui_check_run",
      sessionId: "jskit_middle_prompt"
    });

    const deepUiStep = await runtime.getSession("jskit_middle_prompt");
    assert.deepEqual(deepUiStep.actions, [
      {
        adapterCapability: "run_deep_ui_check",
        disabledReason: "",
        enabled: true,
        id: "run_deep_ui_check",
        label: "Run deep UI check",
        promptId: "run_deep_ui_check",
        type: "prompt",
        visible: true
      }
    ]);

    const afterDeepUiPrompt = await runtime.runAction("jskit_middle_prompt", "run_deep_ui_check");
    assert.equal(afterDeepUiPrompt.actionResult.status, "prompt_ready");
    assert.equal(afterDeepUiPrompt.actionResult.promptId, "run_deep_ui_check");
    assert.match(afterDeepUiPrompt.actionResult.prompt, /Run a focused deep UI check/u);

    await runtime.createSession({
      initialStep: "project_knowledge_updated",
      sessionId: "jskit_blueprint_prompt"
    });
    const projectKnowledgeStep = await runtime.getSession("jskit_blueprint_prompt");
    assert.equal(projectKnowledgeStep.actions[0].enabled, true);

    const afterProjectKnowledgePrompt = await runtime.runAction("jskit_blueprint_prompt", "update_project_knowledge");
    assert.equal(afterProjectKnowledgePrompt.actionResult.promptId, "update_project_knowledge");
    assert.match(afterProjectKnowledgePrompt.actionResult.prompt, /Update the JSKIT project knowledge/u);
    assert.match(afterProjectKnowledgePrompt.actionResult.prompt, /\.jskit\/APP_BLUEPRINT\.md/u);
  });
});

test("jskit adapter disables blueprint updates when the blueprint file is missing", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createJskitProject(targetRoot);
    await rm(path.join(targetRoot, ".jskit/APP_BLUEPRINT.md"));
    const runtime = new AiStudioSessionRuntime({
      adapter: new JskitTargetAdapter(),
      targetRoot
    });
    await runtime.createSession({
      initialStep: "project_knowledge_updated",
      sessionId: "jskit_no_blueprint"
    });

    const session = await runtime.getSession("jskit_no_blueprint");
    assert.deepEqual(session.actions, [
      {
        adapterCapability: "update_project_knowledge",
        disabledReason: "JSKIT target adapter does not support capability: update_project_knowledge.",
        enabled: false,
        id: "update_project_knowledge",
        label: "Update project knowledge",
        promptId: "update_project_knowledge",
        type: "prompt",
        visible: true
      }
    ]);
  });
});

test("jskit adapter runs middle-workflow commands and stores accepted commit metadata", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createJskitProject(targetRoot);
    const calls = [];
    const commandResponses = {
      accept_changes: {
        message: "Accepted changes.",
        metadata: {
          changes_accepted: "yes"
        },
        status: "completed"
      },
      commit_changes: {
        message: "Committed accepted changes.",
        metadata: {
          accepted_commit: "abc1234"
        },
        status: "completed"
      },
      run_automated_checks: {
        message: "Automated checks passed.",
        metadata: {
          automated_checks_status: "passed"
        },
        status: "completed"
      }
    };
    const runtime = new AiStudioSessionRuntime({
      adapter: new JskitTargetAdapter({
        commandRunner: async ({ commandId }) => {
          calls.push(commandId);
          return commandResponses[commandId] || {
            message: `Unexpected command ${commandId}.`,
            status: "blocked"
          };
        }
      }),
      clock: () => new Date("2026-05-16T01:02:03.000Z"),
      targetRoot
    });

    await runtime.createSession({
      initialStep: "automated_checks_run",
      sessionId: "jskit_checks"
    });
    const afterChecks = await runtime.runAction("jskit_checks", "run_automated_checks");
    assert.equal(afterChecks.metadata.automated_checks_status, "passed");

    await runtime.createSession({
      initialStep: "changes_accepted",
      sessionId: "jskit_accept"
    });
    const beforeAccept = await runtime.getSession("jskit_accept");
    assert.equal(beforeAccept.next.enabled, false);
    assert.equal(beforeAccept.next.disabledReason, "Accept changes before continuing.");

    const afterAccept = await runtime.runAction("jskit_accept", "accept_changes");
    assert.equal(afterAccept.metadata.changes_accepted, "yes");
    assert.equal(afterAccept.next.enabled, true);

    await runtime.createSession({
      initialStep: "changes_committed",
      sessionId: "jskit_commit"
    });
    const beforeCommit = await runtime.getSession("jskit_commit");
    assert.equal(beforeCommit.next.enabled, false);
    assert.equal(beforeCommit.next.disabledReason, "Commit changes before continuing.");

    const afterCommit = await runtime.runAction("jskit_commit", "commit_changes");
    assert.equal(afterCommit.metadata.accepted_commit, "abc1234");
    assert.equal(afterCommit.next.enabled, true);
    assert.equal(await runtime.store.readMetadataValue("jskit_commit", "accepted_commit"), "abc1234");
    assert.deepEqual(calls, [
      "run_automated_checks",
      "accept_changes",
      "commit_changes"
    ]);
  });
});

test("jskit adapter creates PR metadata and gates merge preparation on pr_url", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createJskitProject(targetRoot);
    const runtime = new AiStudioSessionRuntime({
      adapter: new JskitTargetAdapter({
        commandRunner: async ({ commandId }) => {
          if (commandId === "create_pr_on_gh") {
            return {
              message: "Created GitHub pull request.",
              metadata: {
                pr_url: "https://github.com/example/repo/pull/24"
              },
              status: "completed"
            };
          }
          return {
            message: `Unexpected command ${commandId}.`,
            status: "blocked"
          };
        }
      }),
      targetRoot
    });
    await runtime.createSession({
      initialStep: "pr_created",
      sessionId: "jskit_pr"
    });

    const beforePr = await runtime.getSession("jskit_pr");
    assert.equal(beforePr.next.enabled, false);
    assert.equal(beforePr.next.disabledReason, "Create the pull request before continuing.");
    assert.deepEqual(beforePr.actions.map((action) => {
      return {
        enabled: action.enabled,
        id: action.id
      };
    }), [
      {
        enabled: true,
        id: "edit_pr"
      },
      {
        enabled: true,
        id: "create_pr_on_gh"
      }
    ]);

    const afterPr = await runtime.runAction("jskit_pr", "create_pr_on_gh");

    assert.equal(afterPr.metadata.pr_url, "https://github.com/example/repo/pull/24");
    assert.equal(afterPr.next.enabled, true);
    assert.equal(afterPr.next.stepId, "pr_merged");
    assert.equal(await runtime.store.readMetadataValue("jskit_pr", "pr_url"), "https://github.com/example/repo/pull/24");

    await runtime.createSession({
      initialStep: "pr_merged",
      sessionId: "jskit_prepare_without_pr"
    });
    const mergeWithoutPr = await runtime.getSession("jskit_prepare_without_pr");
    assert.deepEqual(mergeWithoutPr.actions.map((action) => {
      return {
        disabledReason: action.disabledReason,
        enabled: action.enabled,
        id: action.id
      };
    }), [
      {
        disabledReason: "Create the pull request before preparing for merge.",
        enabled: false,
        id: "prepare_for_merge"
      },
      {
        disabledReason: "Create the pull request before merging.",
        enabled: false,
        id: "merge_pr"
      }
    ]);
  });
});

test("jskit adapter merges PRs, gates sync on merge metadata, and finishes sessions", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createJskitProject(targetRoot);
    const calls = [];
    const commandResponses = {
      finish_session: {
        message: "Finished JSKIT session cleanup.",
        metadata: {
          cleanup_done: "yes"
        },
        status: "completed"
      },
      merge_pr: {
        message: "Merged pull request.",
        metadata: {
          pr_merged: "yes"
        },
        status: "completed"
      },
      sync_main_checkout: {
        message: "Synced main checkout.",
        metadata: {
          main_checkout_synced: "yes"
        },
        status: "completed"
      }
    };
    const runtime = new AiStudioSessionRuntime({
      adapter: new JskitTargetAdapter({
        commandRunner: async ({ commandId }) => {
          calls.push(commandId);
          return commandResponses[commandId] || {
            message: `Unexpected command ${commandId}.`,
            status: "blocked"
          };
        }
      }),
      clock: () => new Date("2026-05-16T01:02:03.000Z"),
      targetRoot
    });

    await runtime.createSession({
      initialStep: "pr_merged",
      metadata: {
        pr_url: "https://github.com/example/repo/pull/24"
      },
      sessionId: "jskit_merge"
    });
    const mergeStep = await runtime.getSession("jskit_merge");
    assert.deepEqual(mergeStep.actions.map((action) => {
      return {
        enabled: action.enabled,
        id: action.id
      };
    }), [
      {
        enabled: true,
        id: "prepare_for_merge"
      },
      {
        enabled: true,
        id: "merge_pr"
      }
    ]);

    const afterPrepare = await runtime.runAction("jskit_merge", "prepare_for_merge");
    assert.equal(afterPrepare.actionResult.promptId, "prepare_for_merge");
    assert.match(afterPrepare.actionResult.prompt, /Prepare the JSKIT pull request for merge/u);

    const afterMerge = await runtime.runAction("jskit_merge", "merge_pr");
    assert.equal(afterMerge.metadata.pr_merged, "yes");

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
    const afterSync = await runtime.runAction("jskit_sync", "sync_main_checkout");
    assert.equal(afterSync.metadata.main_checkout_synced, "yes");

    await runtime.createSession({
      initialStep: "session_finished",
      metadata: {
        pr_url: "https://github.com/example/repo/pull/24"
      },
      sessionId: "jskit_finish"
    });
    const afterFinish = await runtime.runAction("jskit_finish", "finish_session");
    assert.equal(afterFinish.status, AI_STUDIO_SESSION_STATUS.FINISHED);
    assert.equal(afterFinish.metadata.cleanup_done, "yes");
    assert.equal(afterFinish.metadata.session_finished, "yes");
    assert.equal(afterFinish.actionResult.sessionStatus, AI_STUDIO_SESSION_STATUS.FINISHED);
    assert.deepEqual(calls, [
      "merge_pr",
      "sync_main_checkout",
      "finish_session"
    ]);
  });
});
