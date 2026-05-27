import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  Vibe64SessionRuntime
} from "@local/vibe64-runtime/server";
import {
  FakeTargetAdapter
} from "@local/vibe64-adapters/server";
import { withTemporaryRoot } from "./vibe64TestHelpers.js";

function worktreeMetadata(targetRoot, sessionId = "session") {
  return {
    worktree_path: path.join(targetRoot, ".vibe64/sessions/active", sessionId, "worktree")
  };
}

function toyWorkflow() {
  return {
    id: "toy",
    steps: [
      {
        actions: [
          {
            adapterCapability: "toy_command",
            id: "toy_command",
            label: "Toy command",
            type: "command"
          }
        ],
        id: "toy_step",
        label: "Toy step"
      }
    ]
  };
}

test("vibe64 runtime exposes fake adapter facts, commands, and enabled actions", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new Vibe64SessionRuntime({
      adapter: new FakeTargetAdapter({
        actionResults: {
          toy_command: {
            message: "Toy command completed.",
            status: "completed"
          }
        },
        capabilities: {
          toy_command: true
        },
        commands: [
          {
            id: "toy_command",
            label: "Toy command"
          }
        ],
        facts: {
          summary: "Toy project"
        },
        promptContext: {
          language: "ToyLang"
        }
      }),
      clock: () => new Date("2026-05-16T01:02:03.000Z"),
      targetRoot,
      workflow: toyWorkflow()
    });
    await runtime.createSession({
      sessionId: "toy_session"
    });

    const session = await runtime.getSession("toy_session");
    assert.equal(session.adapter.id, "fake");
    assert.equal(session.adapter.label, "Fake adapter");
    assert.equal(session.adapter.facts.summary, "Toy project");
    assert.deepEqual(session.adapter.facts.capabilities, {
      toy_command: true
    });
    assert.deepEqual(session.adapter.promptContext, {
      language: "ToyLang"
    });
    assert.deepEqual(session.adapter.commands, [
      {
        available: true,
        disabledReason: "",
        id: "toy_command",
        label: "Toy command"
      }
    ]);
    assert.deepEqual(session.actions, [
      {
        adapterCapability: "toy_command",
        disabledReason: "",
        dispatchRoute: "command-terminal",
        enabled: true,
        icon: "code",
        id: "toy_command",
        label: "Toy command",
        type: "command",
        visible: true
      }
    ]);

    await assert.rejects(
      () => runtime.runAction("toy_session", "toy_command"),
      {
        code: "vibe64_command_requires_terminal",
        message: "Command action Toy command must run in the command terminal."
      }
    );
  });
});

test("vibe64 runtime disables actions when the adapter lacks a required capability", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new Vibe64SessionRuntime({
      adapter: new FakeTargetAdapter({
        capabilities: {}
      }),
      targetRoot,
      workflow: toyWorkflow()
    });
    await runtime.createSession({
      sessionId: "missing_capability"
    });

    const session = await runtime.getSession("missing_capability");
    assert.deepEqual(session.actions, [
      {
        adapterCapability: "toy_command",
        disabledReason: "Fake adapter does not support capability: toy_command.",
        dispatchRoute: "command-terminal",
        enabled: false,
        icon: "code",
        id: "toy_command",
        label: "Toy command",
        type: "command",
        visible: true
      }
    ]);
    await assert.rejects(
      () => runtime.runAction("missing_capability", "toy_command"),
      {
        code: "vibe64_action_disabled",
        message: "Fake adapter does not support capability: toy_command."
      }
    );
  });
});

test("vibe64 prompt actions include adapter facts in rendered prompt context", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new Vibe64SessionRuntime({
      adapter: new FakeTargetAdapter({
        capabilities: [
          "planning"
        ],
        facts: {
          summary: "Prompt-aware toy project"
        },
        promptContext: {
          framework: "toy-web"
        }
      }),
      targetRoot
    });
    await runtime.createSession({
      initialStep: "plan_made",
      metadata: worktreeMetadata(targetRoot, "adapter_prompt"),
      sessionId: "adapter_prompt"
    });

    const afterAction = await runtime.runAction("adapter_prompt", "make_plan");

    assert.equal(afterAction.actionResult.promptContext.adapter.id, "fake");
    assert.equal(afterAction.actionResult.promptContext.adapter.facts.summary, "Prompt-aware toy project");
    assert.deepEqual(afterAction.actionResult.promptContext.adapter.promptContext, {
      framework: "toy-web"
    });
    assert.match(afterAction.actionResult.prompt, /Prompt-aware toy project/u);
    assert.match(afterAction.actionResult.prompt, /toy-web/u);
  });
});
