import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  AI_STUDIO_WORKFLOW_PROFILE_IDS,
  AiStudioSessionRuntime,
  DEFAULT_AI_STUDIO_WORKFLOW,
  DEFAULT_AI_STUDIO_WORKFLOW_PROFILE_ID,
  FakeTargetAdapter,
  PromptRenderer,
  WorkflowMachine,
  workflowForProfile
} from "../../server/lib/aiStudio/index.js";
import { withTemporaryRoot } from "./aiStudioTestHelpers.js";

class PromptRendererFakeAdapter extends FakeTargetAdapter {
  constructor({
    promptPackRoot,
    ...options
  } = {}) {
    super(options);
    this.renderer = new PromptRenderer({
      promptPackRoot,
      systemPromptPackRoot: false
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

test("ai-studio workflow profiles are ordered step lists with self-contained step metadata", () => {
  const bigFeature = workflowForProfile(AI_STUDIO_WORKFLOW_PROFILE_IDS.BIG_FEATURE);
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
  assert.equal(nonCommitMaintenance.steps.at(-1).id, "local_session_finished");
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
    assert.equal(session.stepDefinitions.at(-1).id, "local_session_finished");

    await assert.rejects(
      () => runtime.createSession({
        sessionId: "bad_profile",
        workflowProfile: "unknown_profile"
      }),
      /Unknown AI Studio workflow profile/u
    );
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
        enabled: true,
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
    assert.match(afterAction.actionResult.prompt, /AI Studio prompt completion file contract:/u);
    assert.match(afterAction.actionResult.prompt, /prompt-done\.json/u);
    assert.match(afterAction.actionResult.prompt, /questions\.json/u);
    assert.match(afterAction.actionResult.promptRun.completionToken, /^AI_STUDIO_AUTOPILOT_DONE_[a-f0-9]{32}$/u);
    assert.equal(afterAction.actionResult.promptRun.actionId, "make_plan");
    assert.equal(afterAction.actionResult.promptRun.stepId, "plan_made");
    assert.deepEqual(afterAction.promptRun, afterAction.actionResult.promptRun);
    assert.equal(afterAction.actionResult.codexPromptHandoff.kind, "codex_prompt_handoff");
    assert.equal(afterAction.actionResult.codexPromptHandoff.codex.mode, "inject_prompt");
    assert.equal(afterAction.actionResult.codexPromptHandoff.prompt, afterAction.actionResult.prompt);
    assert.match(afterAction.actionResult.codexPromptHandoff.terminalInput, /Make plan/u);
    assert.match(afterAction.actionResult.codexPromptHandoff.terminalInput, /\[\[AI_STUDIO_CONTEXT_START\]\]/u);

    const actionDuringPromptRun = afterAction.actions.find((action) => action.id === "make_plan");
    assert.equal(actionDuringPromptRun.enabled, false);
    assert.equal(actionDuringPromptRun.disabledReason, "Codex prompt is waiting to continue.");

    const afterAdvance = await runtime.advance("prompt_action");
    assert.equal(afterAdvance.currentStep, "plan_executed");
    assert.equal(afterAdvance.promptRun, null);
  });
});

test("ai-studio runtime prompt handoff uses the rendered prompt title as visible terminal text", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const promptPackRoot = path.join(targetRoot, "prompt-pack");
    await mkdir(promptPackRoot, {
      recursive: true
    });
    await writeFile(
      path.join(promptPackRoot, "send_issue_prompt.txt"),
      [
        "Discuss and define issue",
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
      initialStep: "issue_file_created",
      sessionId: "issue_prompt_visible_title"
    });

    const afterAction = await runtime.runAction("issue_prompt_visible_title", "send_issue_prompt", {
      issueRequest: "Add booking reports"
    });

    assert.equal(afterAction.actionResult.status, "prompt_ready");
    assert.equal(afterAction.actionResult.promptId, "send_issue_prompt");
    assert.match(afterAction.actionResult.prompt, /"issueRequest": "Add booking reports"/u);
    assert.match(
      afterAction.actionResult.codexPromptHandoff.terminalInput,
      /^Discuss and define issue\n\n\[\[AI_STUDIO_CONTEXT_START\]\]/u
    );
    assert.doesNotMatch(afterAction.actionResult.codexPromptHandoff.terminalInput, /^Discuss issue/u);
  });
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
    assert.equal(firstPrompt.actionResult.promptRun.sessionBriefingIncluded, true);

    await runtime.store.writeMetadataValue("session_briefing_once", "codex_session_briefing_delivered", "yes");
    await runtime.advance("session_briefing_once");
    const secondPrompt = await runtime.runAction("session_briefing_once", "execute_plan");

    assert.doesNotMatch(secondPrompt.actionResult.prompt, /AI Studio session briefing\n\nThis briefing is sent once/u);
    assert.doesNotMatch(secondPrompt.actionResult.prompt, /Large static project summary/u);
    assert.doesNotMatch(secondPrompt.actionResult.prompt, /Large static environment blueprint/u);
    assert.doesNotMatch(secondPrompt.actionResult.prompt, /large-static-config/u);
    assert.match(secondPrompt.actionResult.prompt, /Use the AI Studio session briefing already provided/u);
    assert.equal(secondPrompt.actionResult.promptRun.sessionBriefingIncluded, false);
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
        enabled: false,
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
        enabled: false,
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
