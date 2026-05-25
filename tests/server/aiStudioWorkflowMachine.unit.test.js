import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  AI_STUDIO_SESSION_STATUS,
  AI_STUDIO_WORKFLOW_PROFILE_IDS,
  AiStudioSessionRuntime,
  DEFAULT_AI_STUDIO_WORKFLOW,
  DEFAULT_AI_STUDIO_WORKFLOW_PROFILE_ID,
  FakeTargetAdapter,
  PromptRenderer,
  WorkflowMachine,
  workflowForProfile,
  workflowStepPresentation
} from "../../server/lib/aiStudio/index.js";
import {
  currentStepPromptInputInstruction,
  stepMachineForStep
} from "../../server/lib/aiStudio/workflowStepMachines.js";
import {
  questionBatchLimitInstruction
} from "../../server/lib/aiStudio/promptQuestionPolicy.js";
import { withTemporaryRoot } from "./aiStudioTestHelpers.js";

class PromptRendererFakeAdapter extends FakeTargetAdapter {
  constructor({
    promptPackRoot,
    systemPromptPackRoot,
    ...options
  } = {}) {
    super(options);
    this.renderer = new PromptRenderer({
      promptPackRoot,
      ...(systemPromptPackRoot === undefined ? {} : { systemPromptPackRoot })
    });
  }

  async renderPrompt({
    action = {},
    config = {},
    input = {},
    session = {}
  } = {}) {
    return this.renderer.renderPrompt({
      action,
      config,
      input,
      session
    });
  }
}

class SeedRequiredFakeAdapter extends FakeTargetAdapter {
  async inspect(context = {}) {
    return {
      ...await super.inspect(context),
      workflow: {
        seedRequired: true
      }
    };
  }
}

function presentationSnapshot(session = {}) {
  const nextOperation = session.presentation?.auto?.nextOperation || {};
  const screen = session.presentation?.screen || {};
  return {
    auto: {
      actionId: nextOperation.actionId || "",
      executable: nextOperation.executable === true,
      intentId: nextOperation.intentId || "",
      kind: nextOperation.kind || "",
      reason: nextOperation.reason || "",
      route: nextOperation.route || ""
    },
    enabledIntentIds: (Array.isArray(session.intents) ? session.intents : [])
      .filter((intent) => intent.enabled === true)
      .map((intent) => intent.id),
    intentIds: (Array.isArray(session.intents) ? session.intents : [])
      .map((intent) => intent.id),
    screen: {
      kind: screen.kind || "",
      message: screen.message || "",
      primaryIntentId: screen.primaryIntentId || "",
      sections: (Array.isArray(screen.sections) ? screen.sections : [])
        .map((section) => section.kind),
      title: screen.title || "",
      variant: screen.variant || ""
    },
    step: {
      id: session.presentation?.step?.id || "",
      status: session.presentation?.step?.status || "",
      workflowKind: session.presentation?.step?.workflowKind || ""
    }
  };
}

test("ai-studio runtime session view exposes workflow steps, current actions, and next state", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new AiStudioSessionRuntime({
      clock: () => new Date("2026-05-16T01:02:03.000Z"),
      targetRoot
    });

    const session = await runtime.createSession({
      sessionId: "workflow_view"
    });

    assert.equal(session.workflowId, DEFAULT_AI_STUDIO_WORKFLOW.id);
    assert.equal(session.currentStep, "session_created");
    assert.deepEqual(session.completedSteps, []);
    assert.equal(session.next.visible, true);
    assert.equal(session.next.enabled, true);
    assert.equal(session.next.stepId, "work_source_selected");
    assert.equal(session.stepDefinitions[0].status, "current");
    assert.equal(session.stepDefinitions[1].label, "Choose work source");
    assert.deepEqual(session.actions, []);
  });
});

test("ai-studio runtime read views do not persist default or derived step-machine state", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new AiStudioSessionRuntime({
      targetRoot
    });
    await runtime.createSession({
      initialStep: "issue_file_created",
      sessionId: "read_pure_step_view"
    });
    await Promise.all([
      runtime.store.writeArtifact("read_pure_step_view", "issue_title", "Title\n"),
      runtime.store.writeArtifact("read_pure_step_view", "issue_word", "Title\n"),
      runtime.store.writeArtifact("read_pure_step_view", "issue.md", "Body\n")
    ]);
    const before = await runtime.store.readSession("read_pure_step_view");

    const session = await runtime.getSession("read_pure_step_view");
    const listed = await runtime.listSessionSummaries();
    const after = await runtime.store.readSession("read_pure_step_view");

    assert.equal(session.stepMachine.status, "confirm_files");
    const listedSession = listed.find((candidate) => candidate.sessionId === "read_pure_step_view");
    assert.equal(listedSession?.currentStep, "issue_file_created");
    assert.equal("stepMachine" in listedSession, false);
    assert.equal("presentation" in listedSession, false);
    assert.equal("artifactReadiness" in listedSession, false);
    assert.equal(await runtime.store.readStepState("read_pure_step_view", "issue_file_created"), null);
    assert.equal(after.revision, before.revision);
    assert.equal(after.updatedAt, before.updatedAt);
  });
});

test("ai-studio runtime keeps evaluated Autopilot state in presentation, not raw step definitions", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new AiStudioSessionRuntime({
      adapter: new FakeTargetAdapter({
        capabilities: {
          run_automated_checks: true,
          update_code_index: true
        }
      }),
      targetRoot
    });

    const session = await runtime.createSession({
      initialStep: "project_validated",
      sessionId: "autopilot_stage_view"
    });

    assert.equal("autopilot" in session.currentStepDefinition, false);
    assert.equal("workflowAutopilot" in session, false);
    assert.equal(session.presentation.auto.nextOperation.kind, "command");
    assert.equal(session.presentation.auto.nextOperation.actionId, "update_code_index");
    assert.equal(session.presentation.auto.nextOperation.route, "command-terminal");

    await runtime.store.writeMetadataValue("autopilot_stage_view", "code_index_updated", "yes");
    const afterCodeIndex = await runtime.getSession("autopilot_stage_view");
    assert.equal("autopilot" in afterCodeIndex.currentStepDefinition, false);
    assert.equal("workflowAutopilot" in afterCodeIndex, false);
    assert.equal(afterCodeIndex.presentation.auto.nextOperation.kind, "command");
    assert.equal(afterCodeIndex.presentation.auto.nextOperation.actionId, "run_automated_checks");
    assert.equal(afterCodeIndex.presentation.auto.nextOperation.route, "command-terminal");

    await runtime.store.writeMetadataValue("autopilot_stage_view", "automated_checks_passed", "yes");
    const afterValidation = await runtime.getSession("autopilot_stage_view");
    assert.equal("autopilot" in afterValidation.currentStepDefinition, false);
    assert.equal("workflowAutopilot" in afterValidation, false);
    assert.equal(afterValidation.presentation.auto.nextOperation.kind, "advance");
    assert.equal(afterValidation.presentation.auto.nextOperation.route, "session-advance");
  });
});

test("ai-studio runtime exposes server-owned presentation and intents for Autopilot stops", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new AiStudioSessionRuntime({
      targetRoot
    });

    const session = await runtime.createSession({
      initialStep: "implementation_reviewed",
      sessionId: "presentation_review"
    });

    assert.equal(session.presentation.screen.kind, "review");
    assert.equal(session.presentation.screen.title, "Human review");
    assert.equal(session.presentation.screen.variant, "implementation");
    assert.equal(session.presentation.prompt.state, "idle");
    assert.equal(session.presentation.actions, session.actions);
    assert.equal(session.presentation.next, session.next);
    assert.deepEqual(session.intents.map((intent) => intent.id), [
      "open_diff",
      "accept_review",
      "request_review_tweak"
    ]);
    assert.equal(session.presentation.auto.nextOperation.kind, "wait");
    assert.equal(session.presentation.auto.nextOperation.executable, false);
    assert.equal(session.presentation.auto.nextOperation.reason, "user");
  });
});

test("ai-studio runtime presentation exposes durable background task status", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new AiStudioSessionRuntime({
      targetRoot
    });

    await runtime.createSession({
      sessionId: "presentation_background_task"
    });
    await runtime.store.writeBackgroundTaskEvent("presentation_background_task", "codex_bootstrap", {
      event: {
        kind: "failed"
      },
      patch: {
        error: "Create the session worktree before starting Codex.",
        kind: "codex_bootstrap",
        label: "Codex bootstrap",
        message: "Codex bootstrap failed.",
        retry: {
          clientAction: "start_codex_terminal",
          label: "Retry Codex"
        },
        status: "failed"
      }
    });

    const session = await runtime.getSession("presentation_background_task");
    assert.deepEqual(session.presentation.backgroundTasks, [
      {
        error: "Create the session worktree before starting Codex.",
        finishedAt: session.presentation.backgroundTasks[0].finishedAt,
        id: "codex_bootstrap",
        kind: "codex_bootstrap",
        label: "Codex bootstrap",
        message: "Codex bootstrap failed.",
        retry: {
          clientAction: "start_codex_terminal",
          label: "Retry Codex"
        },
        startedAt: session.presentation.backgroundTasks[0].startedAt,
        status: "failed",
        terminalSessionId: "",
        updatedAt: session.presentation.backgroundTasks[0].updatedAt
      }
    ]);
  });
});

test("ai-studio runtime presentation snapshots come from workflow step metadata", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    assert.deepEqual(
      workflowStepPresentation("changes_accepted").automation.recheckAfterPrompt,
      {
        intentId: "recheck_after_final_tweak",
        label: "Recheck changes",
        metadataName: "autopilot_final_review_followup",
        metadataValue: "recheck",
        promptComplete: true,
        serverOperation: {
          kind: "delete_metadata_and_rewind",
          metadataName: "autopilot_final_review_followup",
          reviewStepId: "review_run",
          validationStepId: "project_validated"
        },
        statuses: ["ready", "done"]
      }
    );

    const runtime = new AiStudioSessionRuntime({
      adapter: new FakeTargetAdapter({
        capabilities: {
          finish_session: true,
          merge_pr: true
        }
      }),
      targetRoot
    });

    const implementationReview = await runtime.createSession({
      initialStep: "implementation_reviewed",
      sessionId: "presentation_snapshot_implementation_review"
    });
    const maintenanceConversation = await runtime.createSession({
      initialStep: "maintenance_conversation",
      sessionId: "presentation_snapshot_conversation",
      workflowProfile: AI_STUDIO_WORKFLOW_PROFILE_IDS.NON_COMMIT_MAINTENANCE
    });
    const optionalCheck = await runtime.createSession({
      initialStep: "deep_ui_check_run",
      sessionId: "presentation_snapshot_decision"
    });
    const finalReview = await runtime.createSession({
      initialStep: "changes_accepted",
      sessionId: "presentation_snapshot_final_review"
    });
    const mergeReview = await runtime.createSession({
      initialStep: "pr_merged",
      metadata: {
        pr_url: "https://github.com/example/project/pull/3"
      },
      sessionId: "presentation_snapshot_merge"
    });
    const finished = await runtime.createSession({
      initialStep: "local_session_finished",
      sessionId: "presentation_snapshot_finished",
      workflowProfile: AI_STUDIO_WORKFLOW_PROFILE_IDS.NON_COMMIT_MAINTENANCE
    });

    assert.deepEqual({
      finalReview: presentationSnapshot(finalReview),
      finished: presentationSnapshot(finished),
      implementationReview: presentationSnapshot(implementationReview),
      maintenanceConversation: presentationSnapshot(maintenanceConversation),
      mergeReview: presentationSnapshot(mergeReview),
      optionalCheck: presentationSnapshot(optionalCheck)
    }, {
      finalReview: {
        auto: {
          actionId: "",
          executable: false,
          intentId: "",
          kind: "wait",
          reason: "user",
          route: ""
        },
        enabledIntentIds: [
          "open_diff",
          "accept_review",
          "request_review_tweak",
          "reject_and_replan"
        ],
        intentIds: [
          "open_diff",
          "accept_review",
          "request_review_tweak",
          "reject_and_replan"
        ],
        screen: {
          kind: "review",
          message: "Review the validated work before Autopilot writes the report and commits.",
          primaryIntentId: "",
          sections: [
            "launch_controls",
            "report_preview",
            "response_preview"
          ],
          title: "Final review",
          variant: "final"
        },
        step: {
          id: "changes_accepted",
          status: "ready",
          workflowKind: "final_review"
        }
      },
      finished: {
        auto: {
          actionId: "",
          executable: false,
          intentId: "",
          kind: "wait",
          reason: "user",
          route: ""
        },
        enabledIntentIds: ["archive_session"],
        intentIds: ["archive_session"],
        screen: {
          kind: "finished",
          message: "The session is complete.",
          primaryIntentId: "",
          sections: ["report_preview"],
          title: "Congratulations!",
          variant: ""
        },
        step: {
          id: "local_session_finished",
          status: "ready",
          workflowKind: "finished"
        }
      },
      implementationReview: {
        auto: {
          actionId: "",
          executable: false,
          intentId: "",
          kind: "wait",
          reason: "user",
          route: ""
        },
        enabledIntentIds: [
          "open_diff",
          "accept_review",
          "request_review_tweak"
        ],
        intentIds: [
          "open_diff",
          "accept_review",
          "request_review_tweak"
        ],
        screen: {
          kind: "review",
          message: "Try the work now. Ask Codex for small tweaks, or continue when it looks right.",
          primaryIntentId: "",
          sections: [
            "launch_controls",
            "report_preview",
            "response_preview"
          ],
          title: "Human review",
          variant: "implementation"
        },
        step: {
          id: "implementation_reviewed",
          status: "ready",
          workflowKind: "implementation_review"
        }
      },
      maintenanceConversation: {
        auto: {
          actionId: "",
          executable: false,
          intentId: "",
          kind: "wait",
          reason: "user",
          route: ""
        },
        enabledIntentIds: ["talk_to_codex"],
        intentIds: [
          "talk_to_codex",
          "continue_step"
        ],
        screen: {
          kind: "conversation",
          message: "Ask Codex for changes. Continue when the work is ready for the next workflow step.",
          primaryIntentId: "talk_to_codex",
          sections: ["response_preview"],
          title: "Talk to Codex",
          variant: ""
        },
        step: {
          id: "maintenance_conversation",
          status: "ready",
          workflowKind: "agent_conversation"
        }
      },
      mergeReview: {
        auto: {
          actionId: "",
          executable: false,
          intentId: "",
          kind: "wait",
          reason: "user",
          route: ""
        },
        enabledIntentIds: [
          "merge_and_sync",
          "skip_merge"
        ],
        intentIds: [
          "merge_and_sync",
          "skip_merge"
        ],
        screen: {
          kind: "merge",
          message: "The pull request is ready. Merge it and update the main checkout, or finish without merging.",
          primaryIntentId: "",
          sections: ["report_preview"],
          title: "Merge pull request?",
          variant: ""
        },
        step: {
          id: "pr_merged",
          status: "ready",
          workflowKind: "merge_review"
        }
      },
      optionalCheck: {
        auto: {
          actionId: "",
          executable: false,
          intentId: "",
          kind: "wait",
          reason: "decision",
          route: ""
        },
        enabledIntentIds: [
          "run_optional_check",
          "skip_optional_check"
        ],
        intentIds: [
          "run_optional_check",
          "skip_optional_check"
        ],
        screen: {
          kind: "decision",
          message: "This optional check can take a long time. Run it now, or skip it and continue.",
          primaryIntentId: "",
          sections: [],
          title: "Run deep UI check?",
          variant: ""
        },
        step: {
          id: "deep_ui_check_run",
          status: "ready",
          workflowKind: ""
        }
      }
    });
  });
});

test("ai-studio runtime presentation uses the workflow instance metadata as the step contract", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new AiStudioSessionRuntime({
      targetRoot,
      workflow: {
        id: "custom_presentation_contract",
        steps: [
          {
            actions: [
              {
                id: "custom_action",
                label: "Custom action",
                type: "adapter"
              }
            ],
            autopilot: {
              stop: true
            },
            id: "custom_step",
            label: "Custom step",
            next: {
              visible: false
            },
            presentation: {
              stop: {
                intents: [
                  {
                    actionId: "custom_action",
                    id: "custom_action_intent",
                    label: "Run custom action",
                    type: "action"
                  }
                ],
                screen: {
                  kind: "custom_stop",
                  message: "Custom workflow presentation.",
                  title: "Custom workflow"
                }
              }
            }
          }
        ]
      }
    });

    const session = await runtime.createSession({
      sessionId: "custom_presentation_contract"
    });

    assert.equal(session.presentation.screen.kind, "custom_stop");
    assert.equal(session.presentation.screen.title, "Custom workflow");
    assert.equal(session.intents[0].id, "custom_action_intent");
    assert.equal("workflowPresentation" in session, false);
  });
});

test("ai-studio runtime exposes server-owned action icon hints", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new AiStudioSessionRuntime({
      targetRoot
    });

    const session = await runtime.createSession({
      initialStep: "worktree_created",
      sessionId: "presentation_action_icons"
    });

    assert.equal(session.actions.find((action) => action.id === "create_worktree")?.icon, "sync");
    assert.equal(session.actions.find((action) => action.id === "create_worktree")?.dispatchRoute, "command-terminal");
    assert.equal(session.currentStepDefinition.actions.find((action) => action.id === "create_worktree")?.icon, "sync");
    assert.equal(session.currentStepDefinition.actions.find((action) => action.id === "create_worktree")?.dispatchRoute, "command-terminal");
  });
});

test("ai-studio runtime exposes and runs the server-owned conversation intent", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const promptPackRoot = path.join(targetRoot, "prompt-pack");
    await mkdir(promptPackRoot, {
      recursive: true
    });
    await writeFile(
      path.join(promptPackRoot, "agent_conversation.txt"),
      [
        "Agent conversation",
        "",
        "Action input:",
        "{{input.json}}"
      ].join("\n"),
      "utf8"
    );

    const runtime = new AiStudioSessionRuntime({
      adapter: new PromptRendererFakeAdapter({
        promptPackRoot
      }),
      clock: () => new Date("2026-05-16T01:02:03.000Z"),
      targetRoot
    });
    await runtime.createSession({
      initialStep: "maintenance_conversation",
      sessionId: "presentation_conversation_intent",
      workflowProfile: AI_STUDIO_WORKFLOW_PROFILE_IDS.NON_COMMIT_MAINTENANCE
    });

    const session = await runtime.getSession("presentation_conversation_intent");
    assert.equal(session.presentation.screen.kind, "conversation");
    assert.equal(session.presentation.screen.primaryIntentId, "talk_to_codex");
    assert.deepEqual(session.intents.map((intent) => intent.id), [
      "talk_to_codex",
      "continue_step"
    ]);
    assert.equal(
      session.intents.find((intent) => intent.id === "talk_to_codex")?.inputFields[0]?.name,
      "conversationRequest"
    );

    const afterIntent = await runtime.runIntent("presentation_conversation_intent", "talk_to_codex", {
      fields: {
        conversationRequest: "Explain this codebase."
      },
      stepId: session.currentStep,
      stepStatus: session.stepMachine.status
    });

    assert.equal(afterIntent.actionResult.status, "prompt_ready");
    assert.equal(afterIntent.actionResult.promptId, "agent_conversation");
    assert.match(
      afterIntent.actionResult.codexPromptHandoff.terminalInput,
      /^Explain this codebase\.\n\n\[\[AI_STUDIO_CONTEXT_START\]\]/u
    );
  });
});

test("ai-studio runtime runs server-owned intents and rejects stale intent submissions", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new AiStudioSessionRuntime({
      targetRoot
    });

    await runtime.createSession({
      initialStep: "deep_ui_check_run",
      sessionId: "presentation_intents"
    });
    const session = await runtime.getSession("presentation_intents");

    assert.equal(session.presentation.screen.kind, "decision");
    const skipped = await runtime.runIntent("presentation_intents", "skip_optional_check", {
      stepId: session.currentStep,
      stepStatus: session.stepMachine.status
    });
    assert.equal(skipped.currentStep, "review_run");

    await assert.rejects(
      () => runtime.runIntent("presentation_intents", "skip_optional_check", {
        stepId: "deep_ui_check_run",
        stepStatus: session.stepMachine.status
      }),
      /not available|Reload state/u
    );
  });
});

test("ai-studio runtime owns final-review follow-up and merge decision intents", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new AiStudioSessionRuntime({
      targetRoot
    });

    await runtime.createSession({
      initialStep: "changes_accepted",
      sessionId: "presentation_final_review_intents"
    });
    await runtime.store.writeCompletedStep("presentation_final_review_intents", "review_run", {
      message: "Review completed before final tweaks."
    });
    const finalReview = await runtime.getSession("presentation_final_review_intents");
    const tweak = await runtime.runIntent("presentation_final_review_intents", "request_review_tweak", {
      fields: {
        feedback: "Tighten the final copy."
      },
      stepId: finalReview.currentStep,
      stepStatus: finalReview.stepMachine.status
    });
    assert.equal(tweak.actionResult.actionType, "prompt");
    assert.equal(
      await runtime.store.readMetadataValue("presentation_final_review_intents", "autopilot_final_review_followup"),
      "recheck"
    );
    await runtime.store.writeStepState("presentation_final_review_intents", "changes_accepted", {
      promptComplete: true,
      schemaVersion: 1,
      status: "ready"
    });
    const recheckReady = await runtime.getSession("presentation_final_review_intents");
    assert.equal(recheckReady.presentation.auto.nextOperation.kind, "intent");
    assert.equal(recheckReady.presentation.auto.nextOperation.intentId, "recheck_after_final_tweak");
    const rechecked = await runtime.runIntent("presentation_final_review_intents", "recheck_after_final_tweak", {
      stepId: recheckReady.currentStep,
      stepStatus: recheckReady.stepMachine.status
    });
    assert.equal(rechecked.currentStep, "review_run");
    assert.equal(
      await runtime.store.readMetadataValue("presentation_final_review_intents", "autopilot_final_review_followup"),
      ""
    );

    await runtime.createSession({
      initialStep: "pr_merged",
      metadata: {
        pr_url: "https://github.com/example/project/pull/1"
      },
      sessionId: "presentation_merge_intents"
    });
    const mergeReview = await runtime.runIntent("presentation_merge_intents", "merge_and_sync");
    assert.equal(mergeReview.presentation.auto.nextOperation.kind, "action");
    assert.equal(mergeReview.presentation.auto.nextOperation.executable, true);
    assert.equal(mergeReview.presentation.auto.nextOperation.route, "session-action");
    assert.equal(mergeReview.presentation.auto.nextOperation.actionId, "prepare_for_merge");

    await runtime.createSession({
      initialStep: "pr_merged",
      metadata: {
        pr_url: "https://github.com/example/project/pull/2"
      },
      sessionId: "presentation_skip_merge_intent"
    });
    const skipped = await runtime.runIntent("presentation_skip_merge_intent", "skip_merge");
    assert.equal(skipped.currentStep, "session_finished");
    assert.equal(skipped.metadata.merge_skipped, "yes");
  });
});

test("ai-studio workflow profiles are ordered step lists with self-contained step metadata", () => {
  const bigFeature = workflowForProfile(AI_STUDIO_WORKFLOW_PROFILE_IDS.BIG_FEATURE);
  const generalCoding = workflowForProfile(AI_STUDIO_WORKFLOW_PROFILE_IDS.GENERAL_CODING);
  const nonCodeMaintenance = workflowForProfile(AI_STUDIO_WORKFLOW_PROFILE_IDS.NON_CODE_MAINTENANCE);
  const seedApplication = workflowForProfile(AI_STUDIO_WORKFLOW_PROFILE_IDS.SEED_APPLICATION);
  const nonCommitMaintenance = workflowForProfile(AI_STUDIO_WORKFLOW_PROFILE_IDS.NON_COMMIT_MAINTENANCE);

  assert.equal(bigFeature.id, DEFAULT_AI_STUDIO_WORKFLOW_PROFILE_ID);
  assert.ok(bigFeature.steps.find((step) => step.id === "issue_file_created")?.autopilot.stop);
  assert.ok(seedApplication.steps.find((step) => step.id === "seed_application_defined")?.autopilot.stop);
  assert.deepEqual(seedApplication.steps.map((step) => step.id).slice(0, 6), [
    "session_created",
    "work_source_selected",
    "worktree_created",
    "seed_application_defined",
    "seed_plan_made",
    "seed_plan_executed"
  ]);
  assert.equal(
    seedApplication.steps.findIndex((step) => step.id === "dependencies_installed") >
      seedApplication.steps.findIndex((step) => step.id === "seed_plan_executed"),
    true
  );
  assert.equal(generalCoding.profile.label, "General coding");
  assert.equal(generalCoding.profile.sessionWord, "coding");
  assert.deepEqual(generalCoding.steps.map((step) => step.id), [
    "session_created",
    "work_source_selected",
    "worktree_created",
    "dependencies_installed",
    "agent_conversation",
    "deep_ui_check_run",
    "review_run",
    "project_validated",
    "changes_accepted",
    "report_created",
    "project_knowledge_updated",
    "changes_committed",
    "create_pull_request",
    "pr_merged",
    "main_checkout_synced",
    "session_finished"
  ]);
  assert.equal(generalCoding.steps.find((step) => step.id === "agent_conversation").label, "Make changes");
  assert.equal(generalCoding.steps.find((step) => step.id === "agent_conversation").autopilot.kind, "agent_conversation");
  const createPullRequestStep = generalCoding.steps.find((step) => step.id === "create_pull_request");
  const mergeStep = generalCoding.steps.find((step) => step.id === "pr_merged");
  assert.deepEqual(createPullRequestStep.actions.map((action) => action.id), [
    "open_pr",
    "resolve_pull_request",
    "create_pr_on_gh"
  ]);
  assert.deepEqual(createPullRequestStep.autopilot.actionSequence.map((action) => action.actionId), [
    "resolve_pull_request",
    "create_pr_on_gh"
  ]);
  assert.equal(createPullRequestStep.interaction, undefined);
  assert.deepEqual(createPullRequestStep.rewindCleanup.artifacts, [
    "tmp/create_pull_request.body.md",
    "tmp/create_pull_request.title.txt",
    "create_pull_request.url.txt",
    "create_pull_request.number.txt",
    "create_pull_request.source.txt"
  ]);
  assert.deepEqual(
    mergeStep.presentation.stop.intents.find((intent) => intent.id === "skip_merge").serverOperation,
    {
      kind: "sequence",
      operations: [
        {
          actionId: "skip_merge",
          input: "empty",
          kind: "run_action"
        },
        {
          kind: "write_metadata",
          metadataName: "merge_skipped",
          metadataValue: "yes"
        },
        {
          kind: "advance_to_step",
          stepId: "session_finished"
        }
      ]
    }
  );
  assert.equal(generalCoding.steps.some((step) => step.id === "issue_file_created"), false);
  assert.equal(generalCoding.steps.some((step) => step.id === "plan_made"), false);
  assert.equal(generalCoding.steps.some((step) => step.id === "plan_executed"), false);
  assert.equal(nonCodeMaintenance.profile.label, "Documentation/non code maintenance");
  assert.equal(nonCodeMaintenance.profile.sessionWord, "documentation");
  assert.deepEqual(nonCodeMaintenance.steps.map((step) => step.id), [
    "session_created",
    "work_source_selected",
    "worktree_created",
    "dependencies_installed",
    "maintenance_conversation",
    "project_validated",
    "changes_committed",
    "create_pull_request",
    "pr_merged",
    "main_checkout_synced",
    "session_finished"
  ]);
  assert.equal(nonCodeMaintenance.steps.some((step) => step.id === "issue_file_created"), false);
  assert.equal(nonCodeMaintenance.steps.some((step) => step.id === "plan_made"), false);
  assert.equal(nonCodeMaintenance.steps.some((step) => step.id === "review_run"), false);
  assert.equal(nonCodeMaintenance.steps.some((step) => step.id === "changes_accepted"), false);
  assert.equal(nonCodeMaintenance.steps.find((step) => step.id === "maintenance_conversation").autopilot.kind, "agent_conversation");
  assert.equal(nonCodeMaintenance.steps.find((step) => step.id === "maintenance_conversation").label, "Talk to Codex");
  assert.deepEqual(nonCommitMaintenance.profile.initialMetadata, {
    work_source: "new_branch"
  });
  assert.equal(nonCommitMaintenance.profile.sessionWord, "maintenance");
  assert.deepEqual(nonCommitMaintenance.steps.map((step) => step.id), [
    "session_created",
    "worktree_created",
    "checklist_items_installed",
    "maintenance_conversation",
    "local_session_finished"
  ]);
  assert.equal(nonCommitMaintenance.steps.at(-2).autopilot.kind, "agent_conversation");
});

test("ai-studio workflow profiles have an explicit state machine for every step", () => {
  for (const profileId of Object.values(AI_STUDIO_WORKFLOW_PROFILE_IDS)) {
    const workflow = workflowForProfile(profileId);
    assert.deepEqual(
      workflow.steps.map((step) => step.id).filter((stepId) => !stepMachineForStep(stepId)),
      [],
      `${profileId} has workflow steps without state machines`
    );
  }
});

test("ai-studio runtime persists the selected workflow profile per session", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new AiStudioSessionRuntime({
      targetRoot
    });

    const session = await runtime.createSession({
      sessionId: "maintenance_profile",
      workflowProfile: AI_STUDIO_WORKFLOW_PROFILE_IDS.NON_COMMIT_MAINTENANCE
    });

    assert.equal(session.workflowId, AI_STUDIO_WORKFLOW_PROFILE_IDS.NON_COMMIT_MAINTENANCE);
    assert.equal(session.workflowProfile.id, AI_STUDIO_WORKFLOW_PROFILE_IDS.NON_COMMIT_MAINTENANCE);
    assert.equal(session.metadata.workflow_profile, AI_STUDIO_WORKFLOW_PROFILE_IDS.NON_COMMIT_MAINTENANCE);
    assert.equal(session.metadata.work_source, "new_branch");
    assert.equal(session.sessionName, "maintenance");
    assert.equal(session.stepDefinitions.at(-1).id, "local_session_finished");
    assert.equal(await runtime.store.readArtifact("maintenance_profile", "issue_word"), "maintenance\n");

    await assert.rejects(
      () => runtime.createSession({
        sessionId: "bad_profile",
        workflowProfile: "unknown_profile"
      }),
      /Unknown AI Studio workflow profile/u
    );
  });
});

test("ai-studio non-code maintenance profile starts with a reusable session label and skips issue planning", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new AiStudioSessionRuntime({
      targetRoot
    });

    const session = await runtime.createSession({
      sessionId: "docs_profile",
      workflowProfile: AI_STUDIO_WORKFLOW_PROFILE_IDS.NON_CODE_MAINTENANCE
    });

    assert.equal(session.workflowId, AI_STUDIO_WORKFLOW_PROFILE_IDS.NON_CODE_MAINTENANCE);
    assert.equal(session.sessionName, "documentation");
    assert.equal(await runtime.store.readArtifact("docs_profile", "issue_word"), "documentation\n");
    assert.equal(session.stepDefinitions.some((step) => step.id === "issue_file_created"), false);
    assert.equal(session.stepDefinitions.some((step) => step.id === "plan_made"), false);
    assert.equal(session.stepDefinitions.some((step) => step.id === "changes_accepted"), false);

    await runtime.advance("docs_profile");
    await runtime.store.writeMetadataValue("docs_profile", "work_source", "new_branch");
    await runtime.advance("docs_profile");
    await runtime.store.writeMetadataValue("docs_profile", "worktree_path", targetRoot);
    await runtime.advance("docs_profile");
    await runtime.store.writeMetadataValue("docs_profile", "dependencies_installed", "yes");
    await runtime.store.writeMetadataValue("docs_profile", "dependencies_path", targetRoot);
    const conversationStep = await runtime.advance("docs_profile");

    assert.equal(conversationStep.currentStep, "maintenance_conversation");
    assert.equal(conversationStep.next.stepId, "project_validated");
  });
});

test("ai-studio runtime selects the seed profile when the adapter says seeding is required", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new AiStudioSessionRuntime({
      adapter: new SeedRequiredFakeAdapter(),
      targetRoot
    });

    const session = await runtime.createSession({
      sessionId: "seed_profile"
    });

    assert.equal(session.workflowId, AI_STUDIO_WORKFLOW_PROFILE_IDS.SEED_APPLICATION);
    assert.equal(session.metadata.workflow_profile, AI_STUDIO_WORKFLOW_PROFILE_IDS.SEED_APPLICATION);
    assert.equal(session.sessionName, "seeding");
    assert.equal(await runtime.store.readArtifact("seed_profile", "issue_word"), "seeding\n");
    assert.equal(await runtime.store.readMetadataValue("seed_profile", "issue_word"), "");
    assert.ok(session.stepDefinitions.some((step) => step.id === "seed_application_defined"));
    assert.equal(session.stepDefinitions.some((step) => step.id === "issue_file_created"), false);
  });
});

test("ai-studio runtime rejects non-seed profiles while seeding is required", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new AiStudioSessionRuntime({
      adapter: new SeedRequiredFakeAdapter(),
      targetRoot
    });

    await assert.rejects(
      () => runtime.createSession({
        sessionId: "bad_seed_profile",
        workflowProfile: AI_STUDIO_WORKFLOW_PROFILE_IDS.BIG_FEATURE
      }),
      {
        code: "ai_studio_seed_workflow_required"
      }
    );
  });
});

test("ai-studio runtime rejects the seed profile after seeding is no longer required", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new AiStudioSessionRuntime({
      targetRoot
    });

    await assert.rejects(
      () => runtime.createSession({
        sessionId: "late_seed_profile",
        workflowProfile: AI_STUDIO_WORKFLOW_PROFILE_IDS.SEED_APPLICATION
      }),
      {
        code: "ai_studio_seed_workflow_not_available"
      }
    );
  });
});

test("ai-studio runtime advance records completed steps and moves to the next workflow step", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new AiStudioSessionRuntime({
      clock: () => new Date("2026-05-16T01:02:03.000Z"),
      targetRoot
    });
    await runtime.createSession({
      sessionId: "advance_flow"
    });

    const afterFirstAdvance = await runtime.advance("advance_flow");
    assert.equal(afterFirstAdvance.currentStep, "work_source_selected");
    assert.deepEqual(afterFirstAdvance.completedSteps, ["session_created"]);
    assert.equal(afterFirstAdvance.stepDefinitions[0].status, "done");
    assert.equal(afterFirstAdvance.stepDefinitions[1].status, "current");
    assert.equal(afterFirstAdvance.next.stepId, "worktree_created");
    assert.equal(afterFirstAdvance.next.enabled, false);

    await runtime.store.writeMetadataValue("advance_flow", "work_source", "new_branch");
    const afterSecondAdvance = await runtime.advance("advance_flow");
    assert.equal(afterSecondAdvance.currentStep, "worktree_created");
    assert.deepEqual(afterSecondAdvance.completedSteps, [
      "session_created",
      "work_source_selected"
    ]);
  });
});

test("ai-studio runtime shows current-step actions from the workflow", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new AiStudioSessionRuntime({
      adapter: new FakeTargetAdapter({
        capabilities: {
          create_worktree: true
        }
      }),
      targetRoot
    });
    await runtime.createSession({
      sessionId: "disabled_actions"
    });

    await runtime.advance("disabled_actions");
    await runtime.store.writeMetadataValue("disabled_actions", "work_source", "new_branch");
    const session = await runtime.advance("disabled_actions");
    assert.equal(session.currentStep, "worktree_created");
    assert.deepEqual(session.actions, [
      {
        adapterCapability: "create_worktree",
        disabledReason: "",
        dispatchRoute: "command-terminal",
        enabled: true,
        icon: "sync",
        id: "create_worktree",
        label: "Create worktree",
        type: "command",
        visible: true
      }
    ]);
  });
});

test("ai-studio runtime runAction records non-command action results without advancing", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new AiStudioSessionRuntime({
      clock: () => new Date("2026-05-16T01:02:03.000Z"),
      targetRoot,
      workflow: {
        id: "unit-action",
        steps: [
          {
            actions: [
              {
                id: "record_review",
                label: "Record review",
                type: "record"
              }
            ],
            id: "review",
            label: "Review"
          }
        ]
      }
    });
    await runtime.createSession({
      sessionId: "run_action"
    });

    const afterAction = await runtime.runAction("run_action", "record_review", {
      dryRun: true
    });

    assert.equal(afterAction.currentStep, "review");
    assert.deepEqual(afterAction.completedSteps, []);
    assert.deepEqual(afterAction.actionResult, {
      actionId: "record_review",
      actionLabel: "Record review",
      actionType: "record",
      at: "2026-05-16T01:02:03.000Z",
      input: {
        dryRun: true
      },
      message: "Recorded Record review.",
      status: "completed",
      stepId: "review"
    });
    assert.deepEqual(await runtime.store.readCommandLog("run_action"), [
      {
        actionId: "record_review",
        actionLabel: "Record review",
        actionType: "record",
        at: "2026-05-16T01:02:03.000Z",
        kind: "action",
        status: "completed",
        stepId: "review"
      }
    ]);
  });
});

test("ai-studio runtime rejects command actions because terminals own command execution", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new AiStudioSessionRuntime({
      adapter: new FakeTargetAdapter({
        capabilities: {
          create_worktree: true
        }
      }),
      targetRoot
    });
    await runtime.createSession({
      initialStep: "worktree_created",
      metadata: {
        work_source: "new_branch"
      },
      sessionId: "command_action"
    });

    await assert.rejects(
      () => runtime.runAction("command_action", "create_worktree"),
      {
        code: "ai_studio_command_requires_terminal",
        message: "Command action Create worktree must run in the command terminal."
      }
    );
  });
});

test("ai-studio runtime prompt actions render Codex handoff data without advancing", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new AiStudioSessionRuntime({
      clock: () => new Date("2026-05-16T01:02:03.000Z"),
      targetRoot
    });
    await runtime.createSession({
      initialStep: "plan_made",
      sessionId: "prompt_action"
    });

    const afterAction = await runtime.runAction("prompt_action", "make_plan", {
      scope: "unit test"
    });

    assert.equal(afterAction.currentStep, "plan_made");
    assert.deepEqual(afterAction.completedSteps, []);
    assert.equal(afterAction.actionResult.status, "prompt_ready");
    assert.equal(afterAction.actionResult.promptId, "make_plan");
    assert.match(afterAction.actionResult.prompt, /Run the AI Studio prompt action: Make plan/u);
    assert.match(afterAction.actionResult.prompt, /"scope": "unit test"/u);
    assert.match(afterAction.actionResult.prompt, /AI Studio step completion contract:/u);
    assert.match(afterAction.actionResult.prompt, /"kind": "ready"/u);
    assert.match(afterAction.actionResult.prompt, /"stepStatus": "awaiting_agent_result"/u);
    assert.match(afterAction.actionResult.prompt, /Do not write workflow artifacts directly/u);
    assert.doesNotMatch(afterAction.actionResult.prompt, /AI_STUDIO_AUTOPILOT_DONE/u);
    assert.equal(afterAction.actionResult.codexPromptHandoff.kind, "codex_prompt_handoff");
    assert.equal(afterAction.actionResult.codexPromptHandoff.codex.mode, "inject_prompt");
    assert.equal(afterAction.actionResult.codexPromptHandoff.prompt, afterAction.actionResult.prompt);
    assert.match(afterAction.actionResult.codexPromptHandoff.terminalInput, /Make plan/u);
    assert.match(afterAction.actionResult.codexPromptHandoff.terminalInput, /\[\[AI_STUDIO_CONTEXT_START\]\]/u);

    await runtime.submitCurrentStepInput("prompt_action", {
      kind: "ready",
      source: "codex",
      stepId: "plan_made",
      stepStatus: "awaiting_agent_result"
    });
    const afterAdvance = await runtime.advance("prompt_action");
    assert.equal(afterAdvance.currentStep, "plan_executed");
  });
});

test("ai-studio pull request resolution prompt uses the current-step helper contract", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const promptPackRoot = path.join(targetRoot, "prompt-pack");
    await mkdir(promptPackRoot, {
      recursive: true
    });
    await writeFile(
      path.join(promptPackRoot, "generic.txt"),
      "{{systemStandard}}",
      "utf8"
    );
    const runtime = new AiStudioSessionRuntime({
      adapter: new PromptRendererFakeAdapter({
        promptPackRoot
      }),
      clock: () => new Date("2026-05-16T01:02:03.000Z"),
      targetRoot
    });
    await runtime.createSession({
      initialStep: "create_pull_request",
      metadata: {
        branch_pushed: "origin/ai-studio/test-session"
      },
      sessionId: "pull_request_resolution_prompt"
    });

    const afterAction = await runtime.runAction("pull_request_resolution_prompt", "resolve_pull_request");

    assert.equal(afterAction.currentStep, "create_pull_request");
    assert.equal(afterAction.actionResult.status, "prompt_ready");
    assert.equal(afterAction.actionResult.promptId, "resolve_pull_request");
    assert.match(afterAction.actionResult.prompt, /AI Studio current-step input helper/u);
    assert.match(afterAction.actionResult.prompt, /"kind": "ready"/u);
    assert.match(afterAction.actionResult.prompt, /"stepId": "create_pull_request"/u);
    assert.match(afterAction.actionResult.prompt, /"stepStatus": "awaiting_agent_result"/u);
    assert.match(afterAction.actionResult.prompt, /Do not write workflow artifacts directly/u);
    assert.match(afterAction.actionResult.prompt, /write the same question or blocker in normal Codex response text/u);
    assert.match(afterAction.actionResult.prompt, /Keep the visible question text and the helper `message` equivalent/u);
    assert.ok(afterAction.actionResult.prompt.includes(questionBatchLimitInstruction()));
    assert.match(afterAction.actionResult.prompt, /format each question on its own line as `\[1\] Question text`/u);
  });
});

test("editable artifact review steps preserve user-origin and prompt-origin draft behavior", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new AiStudioSessionRuntime({
      targetRoot
    });

    const issueSession = await runtime.createSession({
      initialStep: "issue_file_created",
      sessionId: "editable_artifact_issue"
    });
    assert.equal(issueSession.stepMachine.status, "waiting_for_input");
    assert.deepEqual(issueSession.presentation.screen.input.fields.map((field) => field.name), [
      "title",
      "word",
      "body"
    ]);

    const confirmedIssue = await runtime.submitCurrentStepInput("editable_artifact_issue", {
      fields: {
        body: "Issue body",
        title: "Issue title",
        word: "issue-word"
      },
      kind: "ready",
      source: "ui",
      stepId: "issue_file_created",
      stepStatus: "waiting_for_input"
    });
    assert.equal(confirmedIssue.stepMachine.status, "confirm_files");
    assert.equal(await runtime.store.readArtifact("editable_artifact_issue", "issue_title"), "Issue title\n");
    assert.equal(await runtime.store.readArtifact("editable_artifact_issue", "issue.md"), "Issue body\n");

    const prSession = await runtime.createSession({
      initialStep: "create_pull_request",
      metadata: {
        branch_pushed: "origin/ai-studio/test-session"
      },
      sessionId: "editable_artifact_pr"
    });
    assert.equal(prSession.stepMachine.status, "awaiting_agent_result");
    assert.equal(prSession.presentation.screen.input, undefined);

    const waitingPr = await runtime.submitCurrentStepInput("editable_artifact_pr", {
      kind: "waiting_for_input",
      message: "Which target branch should this use?",
      source: "codex",
      stepId: "create_pull_request",
      stepStatus: "awaiting_agent_result"
    });
    assert.equal(waitingPr.stepMachine.status, "waiting_for_input");
    assert.equal(waitingPr.next.disabledReason, "Resolve the pull request input request before continuing.");

    const resumedPr = await runtime.submitCurrentStepInput("editable_artifact_pr", {
      fields: {
        response: "Use main."
      },
      kind: "user_response",
      source: "ui",
      stepId: "create_pull_request",
      stepStatus: "waiting_for_input"
    });
    assert.equal(resumedPr.stepMachine.status, "awaiting_agent_result");

    const confirmedPr = await runtime.submitCurrentStepInput("editable_artifact_pr", {
      fields: {
        body: "PR body",
        title: "PR title"
      },
      kind: "ready",
      source: "codex",
      stepId: "create_pull_request",
      stepStatus: "awaiting_agent_result"
    });
    assert.equal(confirmedPr.stepMachine.status, "confirm_files");
    assert.deepEqual(confirmedPr.presentation.screen.input.fields.map((field) => field.name), [
      "title",
      "body"
    ]);
    assert.equal(
      await runtime.store.readArtifact("editable_artifact_pr", "tmp/create_pull_request.title.txt"),
      "PR title\n"
    );
    assert.equal(
      await runtime.store.readArtifact("editable_artifact_pr", "tmp/create_pull_request.body.md"),
      "PR body\n"
    );
  });
});

test("ai-studio runtime prompt handoff shows the action input outside hidden terminal context", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const promptPackRoot = path.join(targetRoot, "prompt-pack");
    await mkdir(promptPackRoot, {
      recursive: true
    });
    await writeFile(
      path.join(promptPackRoot, "agent_conversation.txt"),
      [
        "Agent conversation",
        "",
        "Action input:",
        "{{input.json}}"
      ].join("\n"),
      "utf8"
    );

    const runtime = new AiStudioSessionRuntime({
      adapter: new PromptRendererFakeAdapter({
        promptPackRoot
      }),
      clock: () => new Date("2026-05-16T01:02:03.000Z"),
      targetRoot
    });
    await runtime.createSession({
      initialStep: "maintenance_conversation",
      sessionId: "agent_prompt_visible_input",
      workflowProfile: AI_STUDIO_WORKFLOW_PROFILE_IDS.NON_COMMIT_MAINTENANCE
    });

    const afterAction = await runtime.runAction("agent_prompt_visible_input", "agent_conversation", {
      conversationRequest: "Explain this codebase."
    });

    assert.equal(afterAction.actionResult.status, "prompt_ready");
    assert.equal(afterAction.actionResult.promptId, "agent_conversation");
    assert.match(
      afterAction.actionResult.codexPromptHandoff.terminalInput,
      /^Explain this codebase\.\n\n\[\[AI_STUDIO_CONTEXT_START\]\]/u
    );
    assert.match(afterAction.actionResult.codexPromptHandoff.prompt, /"conversationRequest": "Explain this codebase\."/u);
    assert.equal((await runtime.getSession("agent_prompt_visible_input")).currentStep, "maintenance_conversation");
  });
});

test("ai-studio runtime presents waiting_for_input as the same Codex conversation intent", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new AiStudioSessionRuntime({
      clock: () => new Date("2026-05-16T01:02:03.000Z"),
      targetRoot
    });
    await runtime.createSession({
      initialStep: "maintenance_conversation",
      sessionId: "prompt_response_resume",
      workflowProfile: AI_STUDIO_WORKFLOW_PROFILE_IDS.NON_COMMIT_MAINTENANCE
    });

    await runtime.runAction("prompt_response_resume", "agent_conversation", {
      conversationRequest: "Ask the user what to do."
    });
    await runtime.submitCurrentStepInput("prompt_response_resume", {
      kind: "waiting_for_input",
      message: "What food should I use?",
      source: "codex",
      stepId: "maintenance_conversation",
      stepStatus: "awaiting_agent_result"
    });

    const waiting = await runtime.getSession("prompt_response_resume");
    assert.equal(waiting.stepMachine.status, "waiting_for_input");
    assert.equal(waiting.presentation.screen.kind, "conversation");
    assert.equal(waiting.presentation.screen.input.submitTarget, "intent");
    assert.equal(waiting.presentation.screen.primaryIntentId, "talk_to_codex");
    assert.equal(waiting.presentation.screen.message, "What food should I use?");
    assert.deepEqual(waiting.intents.map((intent) => intent.id), ["talk_to_codex"]);
    assert.equal(waiting.intents[0].actionId, "agent_conversation");
    assert.equal(waiting.intents[0].inputFields[0].name, "conversationRequest");

    const afterAnswer = await runtime.runIntent("prompt_response_resume", "talk_to_codex", {
      fields: {
        conversationRequest: "Use Pescara."
      },
      stepId: waiting.currentStep,
      stepStatus: waiting.stepMachine.status
    });

    assert.equal(afterAnswer.stepMachine.status, "awaiting_agent_result");
    assert.equal(afterAnswer.actionResult.status, "prompt_ready");
    assert.match(afterAnswer.actionResult.codexPromptHandoff.terminalInput, /^Use Pescara\.\n\n\[\[AI_STUDIO_CONTEXT_START\]\]/u);
  });
});

test("chat-with-ai step instructions make completion ownership explicit", () => {
  const userDecidedInstruction = currentStepPromptInputInstruction({
    currentStep: "maintenance_conversation",
    stepMachine: {
      status: "ready"
    }
  });
  const aiDecidedInstruction = currentStepPromptInputInstruction({
    currentStep: "implementation_reviewed",
    stepMachine: {
      status: "ready"
    }
  });
  const finalReviewInstruction = currentStepPromptInputInstruction({
    currentStep: "changes_accepted",
    stepMachine: {
      status: "ready"
    }
  });

  assert.match(
    userDecidedInstruction,
    /The current Codex conversation turn is complete\. The user decides whether to ask another question or continue\./u
  );
  assert.match(
    aiDecidedInstruction,
    /You decide this AI discussion turn is complete only when: the requested focused tweak has either been made/u
  );
  assert.match(
    finalReviewInstruction,
    /You decide this AI discussion turn is complete only when: the requested final tweak has either been made/u
  );
  assert.doesNotMatch(
    aiDecidedInstruction,
    /The user decides whether to ask another question or continue/u
  );
});

test("ai-studio runtime reuses the persisted prompt context snapshot for later prompt actions", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new AiStudioSessionRuntime({
      adapter: new FakeTargetAdapter({
        promptContext: {
          helper_map: ".jskit/helper-map.md",
          marker: "first"
        }
      }),
      clock: () => new Date("2026-05-16T01:02:03.000Z"),
      targetRoot
    });
    await runtime.createSession({
      initialStep: "plan_made",
      sessionId: "prompt_context_snapshot"
    });

    const afterFirstPrompt = await runtime.runAction("prompt_context_snapshot", "make_plan");
    assert.equal(afterFirstPrompt.actionResult.promptContext.adapter.promptContext.marker, "first");

    const snapshot = await runtime.store.readPromptContextSnapshot("prompt_context_snapshot");
    assert.equal(snapshot.adapter.promptContext.helper_map, ".jskit/helper-map.md");
    assert.equal(snapshot.adapter.promptContext.marker, "first");
    await runtime.submitCurrentStepInput("prompt_context_snapshot", {
      kind: "ready",
      source: "codex",
      stepId: "plan_made",
      stepStatus: "awaiting_agent_result"
    });
    await runtime.advance("prompt_context_snapshot");

    class ThrowingInspectionAdapter extends FakeTargetAdapter {
      async inspect() {
        throw new Error("Prompt actions should use the persisted snapshot, not live inspection.");
      }

      async getPromptContext() {
        throw new Error("Prompt actions should use the persisted snapshot, not live prompt context.");
      }
    }

    const restartedRuntime = new AiStudioSessionRuntime({
      adapter: new ThrowingInspectionAdapter({
        promptContext: {
          marker: "second"
        }
      }),
      targetRoot
    });

    const afterSecondPrompt = await restartedRuntime.runAction("prompt_context_snapshot", "execute_plan");
    assert.equal(afterSecondPrompt.actionResult.promptContext.adapter.promptContext.marker, "first");
    assert.match(afterSecondPrompt.actionResult.prompt, /"marker": "first"/u);
    assert.doesNotMatch(afterSecondPrompt.actionResult.prompt, /"marker": "second"/u);
  });
});

test("ai-studio runtime sends static adapter context once and references it later", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const promptPackRoot = path.join(targetRoot, "prompt-pack");
    await mkdir(promptPackRoot, {
      recursive: true
    });
    await writeFile(
      path.join(promptPackRoot, "make_plan.txt"),
      [
        "Make plan action.",
        "{{prompt.sessionBriefingReference}}",
        "Facts: {{adapter.facts.json}}",
        "Blueprint: {{adapter.promptContext.environment_blueprint}}",
        "Services: {{adapter.managedServices.json}}",
        "Config: {{config.json}}"
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      path.join(promptPackRoot, "execute_plan.txt"),
      [
        "Execute plan action.",
        "{{prompt.sessionBriefingReference}}",
        "Facts: {{adapter.facts.json}}",
        "Blueprint: {{adapter.promptContext.environment_blueprint}}",
        "Services: {{adapter.managedServices.json}}",
        "Config: {{config.json}}"
      ].join("\n"),
      "utf8"
    );

    const runtime = new AiStudioSessionRuntime({
      adapter: new PromptRendererFakeAdapter({
        facts: {
          summary: "Large static project summary"
        },
        promptContext: {
          environment_blueprint: "Large static environment blueprint"
        },
        promptPackRoot
      }),
      projectConfig: {
        values: {
          static_config: "large-static-config"
        }
      },
      targetRoot
    });
    await runtime.createSession({
      initialStep: "plan_made",
      sessionId: "session_briefing_once"
    });

    const firstPrompt = await runtime.runAction("session_briefing_once", "make_plan");
    assert.match(firstPrompt.actionResult.prompt, /AI Studio session briefing/u);
    assert.match(firstPrompt.actionResult.prompt, /Large static project summary/u);
    assert.match(firstPrompt.actionResult.prompt, /Large static environment blueprint/u);
    assert.match(firstPrompt.actionResult.prompt, /large-static-config/u);

    await runtime.store.writeMetadataValue("session_briefing_once", "codex_session_briefing_delivered", "yes");
    await runtime.submitCurrentStepInput("session_briefing_once", {
      kind: "ready",
      source: "codex",
      stepId: "plan_made",
      stepStatus: "awaiting_agent_result"
    });
    await runtime.advance("session_briefing_once");
    const secondPrompt = await runtime.runAction("session_briefing_once", "execute_plan");

    assert.doesNotMatch(secondPrompt.actionResult.prompt, /AI Studio session briefing\n\nThis briefing is sent once/u);
    assert.doesNotMatch(secondPrompt.actionResult.prompt, /Large static project summary/u);
    assert.doesNotMatch(secondPrompt.actionResult.prompt, /Large static environment blueprint/u);
    assert.doesNotMatch(secondPrompt.actionResult.prompt, /large-static-config/u);
    assert.match(secondPrompt.actionResult.prompt, /Use the AI Studio session briefing already provided/u);
    assert.equal(secondPrompt.actionResult.promptContext.adapter.facts.summary, "Large static project summary");
    assert.equal(
      secondPrompt.actionResult.promptContext.adapter.promptContext.environment_blueprint,
      "Large static environment blueprint"
    );
  });
});

test("ai-studio runtime disables prompt actions while the terminal is active", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new AiStudioSessionRuntime({
      adapter: new FakeTargetAdapter({
        capabilities: {
          create_worktree: true
        }
      }),
      targetRoot
    });
    await runtime.createSession({
      initialStep: "plan_made",
      metadata: {
        terminal_active: "true"
      },
      sessionId: "terminal_active"
    });

    const session = await runtime.getSession("terminal_active");
    assert.deepEqual(session.actions, [
      {
        disabledReason: "Codex terminal is active.",
        dispatchRoute: "session-action",
        enabled: false,
        icon: "codex",
        id: "make_plan",
        label: "Make plan",
        promptId: "make_plan",
        type: "prompt",
        visible: true
      }
    ]);
    await assert.rejects(
      () => runtime.runAction("terminal_active", "make_plan"),
      {
        code: "ai_studio_action_disabled",
        message: "Codex terminal is active."
      }
    );
  });
});

test("ai-studio runtime rejects actions that are not available on the current step", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new AiStudioSessionRuntime({
      targetRoot
    });
    await runtime.createSession({
      initialStep: "worktree_created",
      sessionId: "wrong_action"
    });

    await assert.rejects(
      () => runtime.runAction("wrong_action", "install_dependencies"),
      {
        code: "ai_studio_action_not_available"
      }
    );
  });
});

test("ai-studio runtime recovers a stuck in-flight command step back to ready", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new AiStudioSessionRuntime({
      targetRoot
    });
    await runtime.createSession({
      initialStep: "checklist_items_installed",
      sessionId: "recover_stuck_command",
      workflowProfile: AI_STUDIO_WORKFLOW_PROFILE_IDS.NON_COMMIT_MAINTENANCE
    });
    await runtime.recordCommandActionStarted("recover_stuck_command", "install_dependencies");

    const stuckSession = await runtime.getSession("recover_stuck_command");
    assert.equal(stuckSession.stepMachine.status, "attempting_execution");

    const recoveredSession = await runtime.recoverStuckStep("recover_stuck_command");
    assert.equal(recoveredSession.currentStep, "checklist_items_installed");
    assert.equal(recoveredSession.stepMachine.status, "ready");
    assert.equal(recoveredSession.next.enabled, false);

    const commandLog = await runtime.store.readCommandLog("recover_stuck_command");
    assert.deepEqual(commandLog.at(-1), {
      at: commandLog.at(-1).at,
      fromStatus: "attempting_execution",
      kind: "recover-stuck-step",
      message: "Recovered stuck command execution. Re-run the current step.",
      stepId: "checklist_items_installed",
      toStatus: "ready"
    });
  });
});

test("ai-studio runtime presentation owns command recovery availability", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new AiStudioSessionRuntime({
      targetRoot
    });
    await runtime.createSession({
      initialStep: "checklist_items_installed",
      sessionId: "server_owned_command_recovery",
      workflowProfile: AI_STUDIO_WORKFLOW_PROFILE_IDS.NON_COMMIT_MAINTENANCE
    });
    await runtime.recordCommandActionStarted("server_owned_command_recovery", "install_dependencies");

    const applyingSession = await runtime.getSession("server_owned_command_recovery");
    assert.equal(applyingSession.stepMachine.status, "attempting_execution");
    assert.equal(applyingSession.presentation.command.applying, true);
    assert.equal(applyingSession.presentation.recovery.available, false);

    await runtime.store.writeCommandLifecycleEvent(
      "server_owned_command_recovery",
      `${applyingSession.stepRevision}-install_dependencies`,
      {
        patch: {
          actionId: "install_dependencies",
          phase: "result_written",
          stepId: applyingSession.currentStep,
          stepRevision: applyingSession.stepRevision
        },
        event: {
          kind: "result_written"
        }
      }
    );

    const recoverableSession = await runtime.getSession("server_owned_command_recovery");
    assert.equal(recoverableSession.presentation.command.applying, false);
    assert.equal(recoverableSession.presentation.command.state, "stalled");
    assert.equal(recoverableSession.presentation.recovery.available, true);
    assert.equal(recoverableSession.presentation.recovery.reason, "workflow_state_stalled");
  });
});

test("ai-studio runtime refuses stuck-step recovery unless the step is attempting execution", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new AiStudioSessionRuntime({
      targetRoot
    });
    await runtime.createSession({
      initialStep: "checklist_items_installed",
      sessionId: "recover_not_stuck",
      workflowProfile: AI_STUDIO_WORKFLOW_PROFILE_IDS.NON_COMMIT_MAINTENANCE
    });

    await assert.rejects(
      () => runtime.recoverStuckStep("recover_not_stuck"),
      {
        code: "ai_studio_step_recovery_not_available"
      }
    );
  });
});

test("ai-studio runtime keeps disabled actions visible and rejects execution with the disabled reason", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new AiStudioSessionRuntime({
      targetRoot,
      workflow: {
        id: "disabled_action",
        steps: [
          {
            actions: [
              {
                enabledWhen: ["metadata:ready"],
                id: "blocked_action",
                label: "Blocked action"
              }
            ],
            id: "first",
            label: "First"
          }
        ]
      }
    });
    await runtime.createSession({
      sessionId: "disabled_action"
    });

    const session = await runtime.getSession("disabled_action");
    assert.deepEqual(session.actions, [
      {
        disabledReason: "Waiting for metadata: ready.",
        dispatchRoute: "command-terminal",
        enabled: false,
        icon: "code",
        id: "blocked_action",
        label: "Blocked action",
        type: "command",
        visible: true
      }
    ]);
    await assert.rejects(
      () => runtime.runAction("disabled_action", "blocked_action"),
      {
        code: "ai_studio_action_disabled",
        message: "Waiting for metadata: ready."
      }
    );
  });
});

test("ai-studio runtime blocks advance when workflow next conditions are not met", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const workflow = {
      id: "conditioned",
      steps: [
        {
          id: "first",
          label: "First",
          next: {
            enabledWhen: ["metadata:ready"]
          }
        },
        {
          id: "second",
          label: "Second"
        }
      ]
    };
    const runtime = new AiStudioSessionRuntime({
      targetRoot,
      workflow
    });
    await runtime.createSession({
      sessionId: "conditioned"
    });

    const blocked = await runtime.getSession("conditioned");
    assert.equal(blocked.currentStep, "first");
    assert.equal(blocked.next.visible, true);
    assert.equal(blocked.next.enabled, false);
    assert.equal(blocked.next.label, "Next step");
    assert.equal(blocked.next.disabledReason, "Waiting for metadata: ready.");
    await assert.rejects(
      () => runtime.advance("conditioned"),
      /Waiting for metadata: ready/u
    );

    await runtime.store.writeMetadataValue("conditioned", "ready", "yes");
    const advanced = await runtime.advance("conditioned");
    assert.equal(advanced.currentStep, "second");
    assert.deepEqual(advanced.completedSteps, ["first"]);
  });
});

test("ai-studio project validation requires code index and automated checks", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new AiStudioSessionRuntime({
      adapter: new FakeTargetAdapter({
        capabilities: {
          run_automated_checks: true,
          update_code_index: true
        }
      }),
      targetRoot
    });
    await runtime.createSession({
      initialStep: "project_validated",
      sessionId: "project_validated"
    });

    const beforeIndex = await runtime.getSession("project_validated");
    assert.equal(beforeIndex.next.enabled, false);
    assert.deepEqual(beforeIndex.actions.map((action) => ({
      enabled: action.enabled,
      id: action.id
    })), [
      {
        enabled: true,
        id: "update_code_index"
      },
      {
        enabled: false,
        id: "run_automated_checks"
      }
    ]);

    await runtime.store.writeMetadataValue("project_validated", "code_index_updated", "yes");
    const afterIndex = await runtime.getSession("project_validated");
    assert.equal(afterIndex.next.enabled, false);
    assert.equal(afterIndex.actions[1].enabled, true);

    await runtime.store.writeMetadataValue("project_validated", "automated_checks_passed", "yes");
    const afterChecks = await runtime.getSession("project_validated");
    assert.equal(afterChecks.next.enabled, true);
    assert.equal(afterChecks.next.stepId, "changes_accepted");

    const afterHumanReview = await runtime.advance("project_validated");
    assert.equal(afterHumanReview.currentStep, "changes_accepted");
    assert.equal(afterHumanReview.currentStepDefinition.label, "Final review");
    assert.equal(afterHumanReview.next.stepId, "report_created");

    const reportStep = await runtime.advance("project_validated");
    assert.equal(reportStep.currentStep, "report_created");
    assert.equal(reportStep.next.enabled, false);
    assert.equal(reportStep.next.disabledReason, "Write the session report before updating project knowledge.");

    await runtime.store.writeArtifact("project_validated", "report.md", "# Report\n");
    const afterReport = await runtime.getSession("project_validated");
    assert.equal(afterReport.next.enabled, true);
    assert.equal(afterReport.next.stepId, "project_knowledge_updated");
  });
});

test("ai-studio runtime validates initial workflow steps", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new AiStudioSessionRuntime({
      targetRoot
    });

    const session = await runtime.createSession({
      initialStep: "plan_made",
      sessionId: "starts_at_plan"
    });
    assert.equal(session.currentStep, "plan_made");

    await assert.rejects(
      () => runtime.createSession({
        initialStep: "not_a_step",
        sessionId: "bad_initial_step"
      }),
      /Unknown AI Studio workflow step/u
    );
  });
});

test("ai-studio workflow rejects duplicate action ids inside a step", () => {
  assert.throws(
    () => new WorkflowMachine({
      workflow: {
        id: "bad_actions",
        steps: [
          {
            actions: [
              {
                id: "same",
                label: "First"
              },
              {
                id: "same",
                label: "Second"
              }
            ],
            id: "first",
            label: "First"
          }
        ]
      }
    }),
    /Duplicate AI Studio workflow action id/u
  );
});

test("ai-studio workflow accepts supported condition forms and keeps runtime checks stable", () => {
  const machine = new WorkflowMachine({
    workflow: {
      id: "condition_forms",
      steps: [
        {
          id: "intro",
          label: "Intro"
        },
        {
          actions: [
            {
              enabledWhen: [
                "always",
                "session:active",
                "metadata:ready",
                "any:metadata:missing;metadata:any_ready",
                "artifact:one.md",
                "artifacts:two.md,three.md",
                "action-input:collect.answer",
                "completed:intro"
              ],
              id: "requires_conditions",
              label: "Requires conditions"
            }
          ],
          id: "first",
          label: "First"
        }
      ]
    }
  });

  const session = machine.buildSessionView({
    actionResults: [
      {
        actionId: "collect",
        at: "2026-05-16T01:02:03.000Z",
        input: {
          answer: "yes"
        }
      }
    ],
    artifactReadiness: {
      "one.md": {
        nonEmpty: true
      },
      "three.md": {
        nonEmpty: true
      },
      "two.md": {
        nonEmpty: true
      }
    },
    completedSteps: ["intro"],
    currentStep: "first",
    metadata: {
      any_ready: "yes",
      ready: "yes"
    },
    status: AI_STUDIO_SESSION_STATUS.ACTIVE
  });

  assert.equal(session.actions[0].enabled, true);
});

test("ai-studio workflow rejects unknown nested condition prefixes during construction", () => {
  assert.throws(
    () => new WorkflowMachine({
      workflow: {
        id: "bad_condition_prefix",
        steps: [
          {
            id: "first",
            label: "First",
            next: {
              enabledWhen: ["any:metadata:ready;unknown:ready"]
            }
          },
          {
            id: "second",
            label: "Second"
          }
        ]
      }
    }),
    (error) => {
      assert.equal(error.code, "ai_studio_workflow_unknown_condition");
      assert.match(error.message, /Unknown AI Studio workflow condition/u);
      assert.match(error.message, /unknown:ready/u);
      return true;
    }
  );
});

test("ai-studio workflow rejects malformed condition values during construction", () => {
  assert.throws(
    () => new WorkflowMachine({
      workflow: {
        id: "bad_condition_value",
        steps: [
          {
            actions: [
              {
                enabledWhen: ["action-input:collect"],
                id: "blocked",
                label: "Blocked"
              }
            ],
            id: "first",
            label: "First"
          }
        ]
      }
    }),
    (error) => {
      assert.equal(error.code, "ai_studio_workflow_malformed_condition");
      assert.match(error.message, /Malformed AI Studio workflow condition/u);
      assert.match(error.message, /action-input:collect/u);
      return true;
    }
  );
});
