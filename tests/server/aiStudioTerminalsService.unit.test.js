import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";
import test from "node:test";

import {
  AiStudioSessionRuntime,
  TargetAdapter,
  adapterProjectFacts
} from "../../server/lib/aiStudio/index.js";
import {
  createService
} from "../../packages/ai-studio-terminals/src/server/service.js";
import { withTemporaryRoot } from "./aiStudioTestHelpers.js";

async function waitForExitedTerminal(service, sessionId, terminalSessionId) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const snapshot = service.readCommandTerminal(sessionId, terminalSessionId);
    if (snapshot.status === "exited") {
      return snapshot;
    }
    await delay(25);
  }
  return service.readCommandTerminal(sessionId, terminalSessionId);
}

class UnitCommandAdapter extends TargetAdapter {
  constructor() {
    super({
      id: "unit",
      label: "Unit adapter"
    });
  }

  async inspect() {
    return adapterProjectFacts({
      capabilities: {
        unit_command: true
      },
      commands: [
        {
          id: "unit_command",
          label: "Unit command"
        }
      ],
      summary: "Unit adapter"
    });
  }

  async listCommands({ facts = {} } = {}) {
    return facts.commands || [];
  }

  async createCommandTerminalSpec(_commandId, context = {}) {
    return {
      args: [
        "-lc",
        [
          "set -e",
          "printf 'fact:set\\t%s\\t%s\\n' dynamic_done \"$(printf '%s' from-result-file | base64 | tr -d '\\n')\" >> \"$AI_STUDIO_COMMAND_RESULT_FILE\""
        ].join("\n")
      ],
      applySuccessFacts({ facts }) {
        return {
          deleteMetadata: ["stale_value"],
          metadata: {
            dynamic_done: facts.dynamic_done
          }
        };
      },
      command: "bash",
      commandPreview: "bash command result",
      cwd: context.session?.targetRoot,
      ok: true,
      successMessage: "Unit command completed.",
      successMetadata: {
        terminal_done: "yes"
      }
    };
  }
}

test("AI Studio command terminal records action results and metadata after success", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new AiStudioSessionRuntime({
      adapter: new UnitCommandAdapter(),
      clock: () => new Date("2026-05-16T01:02:03.000Z"),
      targetRoot,
      workflow: {
        id: "unit-terminal",
        steps: [
          {
            actions: [
              {
                adapterCapability: "unit_command",
                id: "unit_command",
                label: "Unit command",
                type: "command"
              }
            ],
            id: "unit_step",
            label: "Unit step"
          }
        ]
      }
    });
    await runtime.createSession({
      metadata: {
        stale_value: "delete me"
      },
      sessionId: "terminal_success"
    });

    const service = createService({
      projectService: {
        targetRoot,
        async createRuntime() {
          return runtime;
        },
        async projectConfigEnvironment() {
          return {
            AI_STUDIO_CONFIG_DIR: path.join(targetRoot, ".ai-studio", "config")
          };
        }
      }
    });

    const terminal = await service.startCommandTerminal("terminal_success", {
      actionId: "unit_command",
      input: {
        dryRun: true
      }
    });
    assert.equal(terminal.ok, true);

    const exited = await waitForExitedTerminal(service, "terminal_success", terminal.id);
    assert.equal(exited.status, "exited");
    assert.equal(exited.exitCode, 0);

    const updatedSession = await runtime.getSession("terminal_success");
    assert.equal(updatedSession.metadata.terminal_done, "yes");
    assert.equal(updatedSession.metadata.dynamic_done, "from-result-file");
    assert.equal(updatedSession.metadata.stale_value, undefined);
    assert.deepEqual(updatedSession.actionResult, undefined);
    assert.deepEqual(updatedSession.actionResults.map((result) => ({
      actionId: result.actionId,
      input: result.input,
      message: result.message,
      metadata: result.metadata,
      status: result.status
    })), [
      {
        actionId: "unit_command",
        input: {
          dryRun: true
        },
        message: "Unit command completed.",
        metadata: {
          dynamic_done: "from-result-file",
          terminal_done: "yes"
        },
        status: "completed"
      }
    ]);
    assert.deepEqual(await runtime.store.readCommandLog("terminal_success"), [
      {
        actionId: "unit_command",
        actionLabel: "Unit command",
        actionType: "command",
        at: "2026-05-16T01:02:03.000Z",
        kind: "terminal-action",
        status: "completed",
        stepId: "unit_step"
      }
    ]);
  });
});

test("AI Studio command terminal refuses prompt actions and disabled command actions", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new AiStudioSessionRuntime({
      adapter: new UnitCommandAdapter(),
      targetRoot,
      workflow: {
        id: "unit-terminal-blocked",
        steps: [
          {
            actions: [
              {
                id: "unit_prompt",
                label: "Unit prompt",
                type: "prompt"
              },
              {
                adapterCapability: "missing_capability",
                id: "blocked_command",
                label: "Blocked command",
                type: "command"
              }
            ],
            id: "unit_step",
            label: "Unit step"
          }
        ]
      }
    });
    await runtime.createSession({
      sessionId: "terminal_blocked"
    });
    const service = createService({
      projectService: {
        targetRoot,
        async createRuntime() {
          return runtime;
        }
      }
    });

    const prompt = await service.startCommandTerminal("terminal_blocked", {
      actionId: "unit_prompt"
    });
    assert.equal(prompt.ok, false);
    assert.match(prompt.error, /does not run in the command terminal/u);

    const disabled = await service.startCommandTerminal("terminal_blocked", {
      actionId: "blocked_command"
    });
    assert.equal(disabled.ok, false);
    assert.match(disabled.error, /does not support capability/u);
  });
});
