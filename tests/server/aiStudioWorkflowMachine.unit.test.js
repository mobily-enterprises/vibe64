import assert from "node:assert/strict";
import test from "node:test";

import {
  AiStudioSessionRuntime,
  DEFAULT_AI_STUDIO_WORKFLOW,
  FakeTargetAdapter,
  WorkflowMachine
} from "../../server/lib/aiStudio/index.js";
import { withTemporaryRoot } from "./aiStudioTestHelpers.js";

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
    assert.equal(session.next.stepId, "worktree_created");
    assert.equal(session.stepDefinitions[0].status, "current");
    assert.equal(session.stepDefinitions[1].label, "Create worktree");
    assert.deepEqual(session.actions, []);
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
    assert.equal(afterFirstAdvance.currentStep, "worktree_created");
    assert.deepEqual(afterFirstAdvance.completedSteps, ["session_created"]);
    assert.equal(afterFirstAdvance.stepDefinitions[0].status, "done");
    assert.equal(afterFirstAdvance.stepDefinitions[1].status, "current");
    assert.equal(afterFirstAdvance.next.stepId, "dependencies_installed");
    assert.equal(afterFirstAdvance.next.enabled, false);

    await runtime.store.writeMetadataValue("advance_flow", "worktree_path", targetRoot);
    const afterSecondAdvance = await runtime.advance("advance_flow");
    assert.equal(afterSecondAdvance.currentStep, "dependencies_installed");
    assert.deepEqual(afterSecondAdvance.completedSteps, [
      "session_created",
      "worktree_created"
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
    assert.equal(afterAction.actionResult.codexPromptHandoff.kind, "codex_prompt_handoff");
    assert.equal(afterAction.actionResult.codexPromptHandoff.codex.mode, "inject_prompt");
    assert.equal(afterAction.actionResult.codexPromptHandoff.prompt, afterAction.actionResult.prompt);
    assert.match(afterAction.actionResult.codexPromptHandoff.terminalInput, /Make plan/u);
    assert.match(afterAction.actionResult.codexPromptHandoff.terminalInput, /\[\[AI_STUDIO_CONTEXT_START\]\]/u);
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
