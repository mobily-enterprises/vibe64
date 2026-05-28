import assert from "node:assert/strict";
import test from "node:test";

import {
  VIBE64_SESSION_STATUS,
  VIBE64_WORKFLOW_DEFINITION_IDS,
  workflowDefinitionCreationOptions
} from "@local/vibe64-runtime/server";
import {
  createService
} from "../../packages/vibe64-sessions/src/server/service.js";
import {
  _testing as coreMaintenanceTesting
} from "@local/vibe64-runtime/server/workflowModules/coreMaintenance";
import {
  VIBE64_CLIENT_CONTROL_ACTIONS
} from "@local/vibe64-core/shared";

const maintenanceWorkflowDefinitionIds = coreMaintenanceTesting.workflowDefinitionIds;

function readySetupServices() {
  const readyService = {
    async getStatus() {
      return {
        ready: true
      };
    }
  };
  return {
    accountSetupService: readyService,
    adapterSetupService: readyService,
    projectSetupService: readyService,
    studioSetupService: readyService
  };
}

function recentTerminalActivity() {
  return {
    lastInputAt: new Date().toISOString(),
    lastInputBytes: 24
  };
}

function oldTerminalActivity() {
  return {
    lastInputAt: new Date(Date.now() - 10_000).toISOString(),
    lastInputBytes: 24
  };
}

function staleIso(ms = 60_000) {
  return new Date(Date.now() - ms).toISOString();
}

function assertCodexPreviewVisible(presentation = {}, terminalSessionId = "") {
  assert.equal(presentation.label, "Terminal is transmitting...");
  assert.equal(presentation.readOnlyInAutopilot, true);
  assert.equal(presentation.renderer, "codex_terminal");
  assert.equal(presentation.terminalSessionId, terminalSessionId);
  assert.equal(presentation.visible, true);
  assert.ok(Date.parse(presentation.visibleUntil));
}

test("session action closes terminals when the action archives the session", async () => {
  const closedSessionIds = [];
  const service = createService({
    projectService: {
      async createRuntime() {
        return {
          async runAction(sessionId) {
            return {
              sessionId,
              status: VIBE64_SESSION_STATUS.FINISHED
            };
          }
        };
      }
    },
    setupServices: readySetupServices(),
    terminalService: {
      async closeSessionTerminals(sessionId) {
        closedSessionIds.push(sessionId);
      }
    }
  });

  const session = await service.runSessionAction("session-1", "finish_session");

  assert.equal(session.status, VIBE64_SESSION_STATUS.FINISHED);
  assert.deepEqual(closedSessionIds, ["session-1"]);
});

test("session action keeps terminals when the session remains active", async () => {
  const closedSessionIds = [];
  const service = createService({
    projectService: {
      async createRuntime() {
        return {
          async runAction(sessionId) {
            return {
              sessionId,
              status: VIBE64_SESSION_STATUS.ACTIVE
            };
          }
        };
      }
    },
    setupServices: readySetupServices(),
    terminalService: {
      async closeSessionTerminals(sessionId) {
        closedSessionIds.push(sessionId);
      }
    }
  });

  const session = await service.runSessionAction("session-1", "record_action");

  assert.equal(session.status, VIBE64_SESSION_STATUS.ACTIVE);
  assert.deepEqual(closedSessionIds, []);
});

test("session prompt action injects the rendered Codex handoff from the server", async () => {
  const deliveries = [];
  const operations = [];
  const handoff = {
    kind: "codex_prompt_handoff",
    terminalInput: "Ask Codex from the server."
  };
  const service = createService({
    projectService: {
      async createRuntime() {
        return {
          async runAction(sessionId, actionId, input) {
            return {
              actionResult: {
                actionId,
                codexPromptHandoff: handoff,
                input,
                status: "prompt_ready"
              },
              presentation: {
                screen: {
                  kind: "codex_running"
                }
              },
              sessionId,
              status: VIBE64_SESSION_STATUS.ACTIVE
            };
          }
        };
      }
    },
    setupServices: readySetupServices(),
    terminalService: {
      async injectCodexPrompt(sessionId, promptHandoff) {
        operations.push({
          kind: "deliver",
          sessionId
        });
        deliveries.push({
          promptHandoff,
          sessionId
        });
        return {
          codexPromptInjected: true,
          ok: true,
          terminalSessionId: "codex-terminal-1"
        };
      },
      async codexTerminalState(sessionId) {
        return {
          codexTerminal: {
            commandPreview: "codex",
            id: "codex-terminal-1",
            ...recentTerminalActivity(),
            status: "running",
            transmitting: true
          },
          ok: true,
          sessionId
        };
      }
    }
  });

  const session = await service.runSessionAction("session-1", "agent_conversation", {
    conversationRequest: "Explain this codebase."
  });

  assert.equal(session.status, VIBE64_SESSION_STATUS.ACTIVE);
  assert.equal(session.codexPromptDelivery.codexPromptInjected, true);
  assert.equal(session.codexTerminal.commandPreview, "codex");
  assert.equal(session.codexTerminal.id, "codex-terminal-1");
  assert.ok(Date.parse(session.codexTerminal.lastInputAt));
  assert.equal(session.codexTerminal.lastInputBytes, 24);
  assert.equal(session.codexTerminal.status, "running");
  assert.equal(session.codexTerminal.transmitting, true);
  assertCodexPreviewVisible(session.presentation.terminal.codex, "codex-terminal-1");
  assert.deepEqual(deliveries, [
    {
      promptHandoff: handoff,
      sessionId: "session-1"
    }
  ]);
  assert.deepEqual(operations, [
    {
      kind: "deliver",
      sessionId: "session-1"
    }
  ]);
});

test("session prompt intent injects the rendered Codex handoff from the server", async () => {
  const deliveries = [];
  const operations = [];
  const handoff = {
    kind: "codex_prompt_handoff",
    terminalInput: "Answer the current step from the server."
  };
  const service = createService({
    projectService: {
      async createRuntime() {
        return {
          async runIntent(sessionId, intentId, input) {
            return {
              actionResult: {
                actionId: "answer_question",
                codexPromptHandoff: handoff,
                input,
                intentId,
                status: "prompt_ready"
              },
              sessionId,
              status: VIBE64_SESSION_STATUS.ACTIVE
            };
          }
        };
      }
    },
    setupServices: readySetupServices(),
    terminalService: {
      async injectCodexPrompt(sessionId, promptHandoff) {
        operations.push({
          kind: "deliver",
          sessionId
        });
        deliveries.push({
          promptHandoff,
          sessionId
        });
        return {
          codexPromptInjected: true,
          ok: true,
          terminalSessionId: "codex-terminal-2"
        };
      }
    }
  });

  const session = await service.runSessionIntent("session-1", "answer_question", {
    fields: {
      response: "Use Pescara."
    },
    stepId: "current_step",
    stepStatus: "waiting_for_input"
  });

  assert.equal(session.status, VIBE64_SESSION_STATUS.ACTIVE);
  assert.equal(session.codexPromptDelivery.terminalSessionId, "codex-terminal-2");
  assert.deepEqual(deliveries, [
    {
      promptHandoff: handoff,
      sessionId: "session-1"
    }
  ]);
  assert.deepEqual(operations, [
    {
      kind: "deliver",
      sessionId: "session-1"
    }
  ]);
});

test("session service records conversation prompts from the action result contract", async () => {
  const conversationLog = [];
  const service = createService({
    projectService: {
      async createRuntime() {
        return {
          async getSession(sessionId) {
            return {
              revision: conversationLog.length + 1,
              sessionId,
              status: VIBE64_SESSION_STATUS.ACTIVE
            };
          },
          async runIntent(sessionId, intentId, input) {
            return {
              actionResult: {
                actionId: "renamed_conversation_action",
                input,
                intentId,
                recordsConversationTurn: true,
                status: "prompt_ready"
              },
              sessionId,
              status: VIBE64_SESSION_STATUS.ACTIVE
            };
          },
          store: {
            async readConversationLog() {
              return conversationLog;
            },
            async writeConversationUserMessage(_sessionId, { text }) {
              const turn = {
                assistant: null,
                messages: [
                  {
                    at: "2026-05-25T01:02:03.000Z",
                    role: "user",
                    text
                  }
                ],
                turnId: "000001",
                user: {
                  at: "2026-05-25T01:02:03.000Z",
                  role: "user",
                  text
                }
              };
              conversationLog.push(turn);
              return turn;
            }
          }
        };
      }
    },
    setupServices: readySetupServices()
  });

  await service.runSessionIntent("session-1", "renamed_conversation_intent", {
    fields: {
      conversationRequest: "Can you tighten the layout?"
    },
    stepId: "maintenance_conversation",
    stepStatus: "ready"
  });
  const read = await service.readSessionConversationLog("session-1");

  assert.equal(read.ok, true);
  assert.deepEqual(read.conversationLog.map((turn) => turn.user.text), [
    "Can you tighten the layout?"
  ]);
});

test("session prompt action fails visibly when server-side Codex delivery fails", async () => {
  const service = createService({
    projectService: {
      async createRuntime() {
        return {
          async runAction(sessionId, actionId) {
            return {
              actionResult: {
                actionId,
                codexPromptHandoff: {
                  kind: "codex_prompt_handoff",
                  terminalInput: "This should be delivered by the server."
                },
                status: "prompt_ready"
              },
              sessionId,
              status: VIBE64_SESSION_STATUS.ACTIVE
            };
          }
        };
      }
    },
    setupServices: readySetupServices(),
    terminalService: {
      async injectCodexPrompt() {
        return {
          error: "Codex terminal is not running.",
          ok: false
        };
      }
    }
  });

  const result = await service.runSessionAction("session-1", "agent_conversation");

  assert.equal(result.ok, false);
  assert.equal(result.error, "Codex terminal is not running.");
});

test("session presentation keeps the Codex preview while recent terminal input activity is active", async () => {
  const service = createService({
    projectService: {
      async createRuntime() {
        return {
          async getSession(sessionId) {
            return {
              presentation: {
                screen: {
                  kind: "input"
                }
              },
              sessionId,
              status: VIBE64_SESSION_STATUS.ACTIVE
            };
          }
        };
      }
    },
    terminalService: {
      async codexTerminalState(sessionId) {
        return {
          codexTerminal: {
            commandPreview: "codex",
            id: "codex-terminal-active",
            ...recentTerminalActivity(),
            status: "running",
            transmitting: true
          },
          ok: true,
          sessionId
        };
      }
    }
  });

  const session = await service.inspectSession("session-1");

  assert.equal(session.codexTerminal.id, "codex-terminal-active");
  assert.equal(session.codexTerminal.transmitting, true);
  assert.ok(Date.parse(session.codexTerminal.lastInputAt));
  assertCodexPreviewVisible(session.presentation.terminal.codex, "codex-terminal-active");
});

test("session inspect reads existing Codex terminal state without preparing it", async () => {
  const preparedSessions = [];
  const service = createService({
    projectService: {
      async createRuntime() {
        return {
          async getSession(sessionId) {
            return {
              metadata: {
                worktree_path: "/workspace/project/.vibe64/sessions/active/session-1/worktree"
              },
              presentation: {
                screen: {
                  kind: "input"
                }
              },
              sessionId,
              status: VIBE64_SESSION_STATUS.ACTIVE
            };
          }
        };
      }
    },
    terminalService: {
      async ensureCodexThread(sessionId) {
        preparedSessions.push(sessionId);
        return {
          ok: true,
          terminalSessionId: "codex-terminal-restored"
        };
      },
      async codexTerminalState(sessionId) {
        return {
          codexTerminal: {
            commandPreview: "codex",
            id: "codex-terminal-restored",
            status: "running",
            transmitting: false
          },
          ok: true,
          sessionId
        };
      }
    }
  });

  const session = await service.inspectSession("session-1");

  assert.deepEqual(preparedSessions, []);
  assert.equal(session.codexTerminal.id, "codex-terminal-restored");
});

test("session presentation hides the Codex preview when the terminal has no recent byte activity", async () => {
  const service = createService({
    projectService: {
      async createRuntime() {
        return {
          async getSession(sessionId) {
            return {
              presentation: {
                screen: {
                  kind: "codex_running"
                }
              },
              sessionId,
              status: VIBE64_SESSION_STATUS.ACTIVE
            };
          }
        };
      }
    },
    terminalService: {
      async codexTerminalState(sessionId) {
        return {
          codexTerminal: {
            commandPreview: "codex",
            id: "codex-terminal-idle",
            status: "running",
            transmitting: false
          },
          ok: true,
          sessionId
        };
      }
    }
  });

  const session = await service.inspectSession("session-1");

  assert.deepEqual(session.presentation.terminal.codex, {
    label: "",
    readOnlyInAutopilot: true,
    renderer: "codex_terminal",
    terminalSessionId: "codex-terminal-idle",
    visible: false,
    visibleUntil: ""
  });
});

test("session presentation ignores Codex output activity for terminal preview visibility", async () => {
  const service = createService({
    projectService: {
      async createRuntime() {
        return {
          async getSession(sessionId) {
            return {
              presentation: {
                screen: {
                  kind: "input"
                }
              },
              sessionId,
              status: VIBE64_SESSION_STATUS.ACTIVE
            };
          }
        };
      }
    },
    terminalService: {
      async codexTerminalState(sessionId) {
        return {
          codexTerminal: {
            commandPreview: "codex",
            id: "codex-terminal-output-only",
            lastOutputAt: new Date().toISOString(),
            lastOutputBytes: 128,
            status: "running",
            transmitting: false
          },
          ok: true,
          sessionId
        };
      }
    }
  });

  const session = await service.inspectSession("session-1");

  assert.deepEqual(session.presentation.terminal.codex, {
    label: "",
    readOnlyInAutopilot: true,
    renderer: "codex_terminal",
    terminalSessionId: "codex-terminal-output-only",
    visible: false,
    visibleUntil: ""
  });
});

test("session presentation ignores stale Codex turn metadata for terminal preview visibility", async () => {
  const service = createService({
    projectService: {
      async createRuntime() {
        return {
          async getSession(sessionId) {
            return {
              presentation: {
                screen: {
                  kind: "input"
                }
              },
              sessionId,
              status: VIBE64_SESSION_STATUS.ACTIVE
            };
          }
        };
      }
    },
    terminalService: {
      async codexTerminalState(sessionId) {
        return {
          codexTerminal: {
            activityLabel: "Terminal is transmitting...",
            commandPreview: "codex",
            id: "codex-terminal-stale",
            ...oldTerminalActivity(),
            status: "running",
            transmitting: true
          },
          ok: true,
          sessionId
        };
      }
    }
  });

  const session = await service.inspectSession("session-1");

  assert.equal(session.codexTerminal.transmitting, true);
  assert.deepEqual(session.presentation.terminal.codex, {
    label: "",
    readOnlyInAutopilot: true,
    renderer: "codex_terminal",
    terminalSessionId: "codex-terminal-stale",
    visible: false,
    visibleUntil: new Date(Date.parse(session.codexTerminal.lastInputAt) + 2500).toISOString()
  });
});

test("session presentation offers Codex continuation when an awaiting turn is stale", async () => {
  const service = createService({
    projectService: {
      async createRuntime() {
        return {
          async getSession(sessionId) {
            return {
              presentation: {
                auto: {
                  nextOperation: {
                    executable: false,
                    kind: "wait",
                    reason: "codex"
                  }
                },
                intents: [],
                screen: {
                  icon: "progress",
                  kind: "codex_running",
                  message: "Wait for Codex to finish the current step.",
                  sections: [],
                  showProgress: true,
                  title: "Terminal is transmitting..."
                }
              },
              sessionId,
              status: VIBE64_SESSION_STATUS.ACTIVE,
              stepMachine: {
                at: staleIso(),
                status: "awaiting_agent_result",
                stepId: "plan_and_execute"
              }
            };
          }
        };
      }
    },
    terminalService: {
      async codexTerminalState(sessionId) {
        return {
          codexTerminal: {
            commandPreview: "codex",
            id: "codex-terminal-stale-wait",
            lastInputAt: staleIso(),
            lastInputBytes: 9,
            status: "running",
            transmitting: false
          },
          ok: true,
          sessionId
        };
      }
    }
  });

  const session = await service.inspectSession("session-1");

  assert.equal(session.presentation.screen.kind, "codex_attention");
  assert.equal(session.presentation.screen.showProgress, false);
  assert.equal(session.presentation.screen.title, "Codex needs attention");
  const expectedIntents = [
    {
      actionId: "",
      control: {
        action: VIBE64_CLIENT_CONTROL_ACTIONS.CONTINUE_CODEX_TURN,
        disabledWhen: [],
        icon: "",
        loadingWhen: []
      },
      disabledReason: "",
      enabled: true,
      id: "continue_codex_turn",
      inputFields: [],
      label: "Ask Codex to continue",
      style: "primary"
    }
  ];
  assert.deepEqual(session.intents, expectedIntents);
  assert.deepEqual(session.presentation.intents, expectedIntents);
  assert.equal(session.presentation.refreshAt, "");
});

test("session presentation keeps a fresh awaiting Codex turn in waiting state", async () => {
  const waitStartedAt = new Date().toISOString();
  const service = createService({
    projectService: {
      async createRuntime() {
        return {
          async getSession(sessionId) {
            return {
              presentation: {
                intents: [],
                screen: {
                  icon: "progress",
                  kind: "codex_running",
                  sections: [],
                  showProgress: true,
                  title: "Terminal is transmitting..."
                }
              },
              sessionId,
              status: VIBE64_SESSION_STATUS.ACTIVE,
              stepMachine: {
                at: waitStartedAt,
                status: "awaiting_agent_result",
                stepId: "plan_and_execute"
              }
            };
          }
        };
      }
    },
    terminalService: {
      async codexTerminalState(sessionId) {
        return {
          codexTerminal: {
            activityStartedAt: waitStartedAt,
            commandPreview: "codex",
            id: "codex-terminal-fresh-wait",
            lastInputAt: waitStartedAt,
            lastInputBytes: 9,
            status: "running",
            transmitting: false
          },
          ok: true,
          sessionId
        };
      }
    }
  });

  const session = await service.inspectSession("session-1");

  assert.equal(session.presentation.screen.kind, "codex_running");
  assert.equal(session.presentation.screen.showProgress, true);
  assert.equal(session.presentation.screen.title, "Terminal is transmitting...");
  assert.deepEqual(session.presentation.intents, []);
  assert.ok(Date.parse(session.presentation.refreshAt));
  assert.equal(session.presentation.refreshReason, "codex_wait");
  assert.equal(session.presentation.terminal.codex.label, "Waiting for Codex...");
  assert.equal(session.presentation.terminal.codex.terminalSessionId, "codex-terminal-fresh-wait");
  assert.equal(session.presentation.terminal.codex.visible, true);
  assert.ok(Date.parse(session.presentation.terminal.codex.visibleUntil));
});

test("session presentation does not treat stale manual terminal input as Codex progress", async () => {
  const stepStartedAt = staleIso();
  const service = createService({
    projectService: {
      async createRuntime() {
        return {
          async getSession(sessionId) {
            return {
              metadata: {
                codex_prompt_handoff_signature: `${sessionId}:${Date.now() - 120_000}`
              },
              presentation: {
                intents: [],
                screen: {
                  icon: "progress",
                  kind: "codex_running",
                  sections: [],
                  showProgress: true,
                  title: "Terminal is transmitting..."
                }
              },
              sessionId,
              status: VIBE64_SESSION_STATUS.ACTIVE,
              stepMachine: {
                at: stepStartedAt,
                status: "awaiting_agent_result",
                stepId: "plan_and_execute"
              }
            };
          }
        };
      }
    },
    terminalService: {
      async codexTerminalState(sessionId) {
        return {
          codexTerminal: {
            activityStartedAt: staleIso(120_000),
            commandPreview: "codex",
            id: "codex-terminal-manual-input",
            lastInputAt: staleIso(10_000),
            lastInputBytes: 1,
            status: "running",
            transmitting: true
          },
          ok: true,
          sessionId
        };
      }
    }
  });

  const session = await service.inspectSession("session-1");

  assert.equal(session.presentation.screen.kind, "codex_attention");
  assert.equal(session.presentation.screen.showProgress, false);
  assert.equal(session.presentation.intents[0].id, "continue_codex_turn");
  assert.equal(session.presentation.intents[0].label, "Ask Codex to continue");
  assert.equal(session.presentation.refreshAt, "");
});

test("session presentation keeps a stale Codex wait running while current-turn output is fresh", async () => {
  const stepStartedAt = staleIso();
  const service = createService({
    projectService: {
      async createRuntime() {
        return {
          async getSession(sessionId) {
            return {
              metadata: {
                codex_prompt_handoff_signature: `${sessionId}:${Date.now() - 120_000}`
              },
              presentation: {
                intents: [],
                screen: {
                  icon: "progress",
                  kind: "codex_running",
                  sections: [],
                  showProgress: true,
                  title: "Terminal is transmitting..."
                }
              },
              sessionId,
              status: VIBE64_SESSION_STATUS.ACTIVE,
              stepMachine: {
                at: stepStartedAt,
                status: "awaiting_agent_result",
                stepId: "plan_and_execute"
              }
            };
          }
        };
      }
    },
    terminalService: {
      async codexTerminalState(sessionId) {
        return {
          codexTerminal: {
            activityStartedAt: staleIso(120_000),
            commandPreview: "codex",
            id: "codex-terminal-output-after-stale",
            lastOutputAt: new Date().toISOString(),
            lastOutputBytes: 512,
            status: "running",
            transmitting: true
          },
          ok: true,
          sessionId
        };
      }
    }
  });

  const session = await service.inspectSession("session-1");

  assert.equal(session.presentation.screen.kind, "codex_running");
  assert.equal(session.presentation.screen.showProgress, true);
  assert.equal(session.presentation.screen.title, "Waiting for Codex...");
  assert.deepEqual(session.presentation.intents, []);
  assert.ok(Date.parse(session.presentation.refreshAt));
  assert.equal(session.presentation.refreshReason, "codex_wait");
  assert.equal(session.presentation.terminal.codex.label, "Waiting for Codex...");
  assert.equal(session.presentation.terminal.codex.terminalSessionId, "codex-terminal-output-after-stale");
  assert.equal(session.presentation.terminal.codex.visible, true);
  assert.ok(Date.parse(session.presentation.terminal.codex.visibleUntil));
});

test("session presentation offers Codex continuation when current-turn output is stale", async () => {
  const stepStartedAt = staleIso();
  const service = createService({
    projectService: {
      async createRuntime() {
        return {
          async getSession(sessionId) {
            return {
              metadata: {
                codex_prompt_handoff_signature: `${sessionId}:${Date.now() - 120_000}`
              },
              presentation: {
                intents: [],
                screen: {
                  icon: "progress",
                  kind: "codex_running",
                  sections: [],
                  showProgress: true,
                  title: "Terminal is transmitting..."
                }
              },
              sessionId,
              status: VIBE64_SESSION_STATUS.ACTIVE,
              stepMachine: {
                at: stepStartedAt,
                status: "awaiting_agent_result",
                stepId: "plan_and_execute"
              }
            };
          }
        };
      }
    },
    terminalService: {
      async codexTerminalState(sessionId) {
        return {
          codexTerminal: {
            activityStartedAt: staleIso(120_000),
            commandPreview: "codex",
            id: "codex-terminal-output-stale",
            lastOutputAt: staleIso(45_000),
            lastOutputBytes: 512,
            status: "running",
            transmitting: true
          },
          ok: true,
          sessionId
        };
      }
    }
  });

  const session = await service.inspectSession("session-1");

  assert.equal(session.presentation.screen.kind, "codex_attention");
  assert.equal(session.presentation.screen.showProgress, false);
  assert.equal(session.presentation.intents[0].label, "Ask Codex to continue");
  assert.equal(session.presentation.refreshAt, "");
  assert.equal(session.presentation.terminal.codex.terminalSessionId, "codex-terminal-output-stale");
  assert.equal(session.presentation.terminal.codex.visible, false);
  assert.equal(session.presentation.terminal.codex.visibleUntil, "");
});

test("session creation waits for an unsynced merged session", async () => {
  let createSessionCalled = false;
  const existingSessions = [
    {
      metadata: {
        pr_merged: "yes"
      },
      sessionId: "session-merged",
      status: VIBE64_SESSION_STATUS.ACTIVE
    }
  ];
  const service = createService({
    projectService: {
      async createRuntime() {
        return {
          async createSession() {
            createSessionCalled = true;
            return {
              sessionId: "new-session"
            };
          },
          async listSessions() {
            return existingSessions;
          }
        };
      },
      async requireProjectType() {
        return {
          adapter: {
            id: "jskit"
          },
          projectType: "jskit"
        };
      }
    },
    setupServices: readySetupServices()
  });

  const result = await service.createSession();

  assert.equal(result.ok, false);
  assert.equal(result.status, "blocked");
  assert.equal(result.errors[0].code, "main_checkout_sync_required");
  assert.equal(createSessionCalled, false);
});

test("session list exposes selectable workflow definitions after seeding", async () => {
  const service = createService({
    projectService: {
      async createRuntime() {
        return {
          async listSessions() {
            return [];
          },
          async workflowDefinitionCreationOptions() {
            return workflowDefinitionCreationOptions({
              seedRequired: false
            });
          }
        };
      }
    },
    setupServices: readySetupServices()
  });

  const result = await service.listSessions();

  assert.equal(result.ok, true);
  assert.equal(result.creation.mode, "select");
  assert.equal(result.creation.seedRequired, false);
  assert.deepEqual(
    result.creation.workflowDefinitions.map((definition) => definition.id),
    [
      VIBE64_WORKFLOW_DEFINITION_IDS.BIG_FEATURE,
      maintenanceWorkflowDefinitionIds.NON_COMMIT_MAINTENANCE
    ]
  );
  assert.equal(result.creation.workflowDefinitions.some((definition) => definition.id === VIBE64_WORKFLOW_DEFINITION_IDS.SEED_APPLICATION), false);
  assert.equal(result.limits.maxOpenSessions, 5);
});

test("session list asks the runtime for open sessions by default", async () => {
  const listCalls = [];
  const preparedSessions = [];
  const terminalStateSessions = [];
  const service = createService({
    projectService: {
      async createRuntime() {
        return {
          async listSessionSummaries(options = {}) {
            listCalls.push(options);
            return [
              {
                currentStep: "worktree_created",
                sessionId: "open-session",
                status: VIBE64_SESSION_STATUS.ACTIVE,
                updatedAt: "2026-05-25T00:00:00.000Z"
              }
            ];
          },
          async listSessions() {
            throw new Error("listSessions should not be used for the session list.");
          },
          async workflowDefinitionCreationOptions() {
            return workflowDefinitionCreationOptions({
              seedRequired: false
            });
          }
        };
      }
    },
    setupServices: readySetupServices(),
    terminalService: {
      async codexTerminalState(sessionId) {
        terminalStateSessions.push(sessionId);
        return {
          ok: true,
          sessionId
        };
      },
      async ensureCodexThread(sessionId) {
        preparedSessions.push(sessionId);
        return {
          ok: true
        };
      }
    }
  });

  const result = await service.listSessions();

  assert.equal(result.ok, true);
  assert.deepEqual(listCalls, [
    {
      statusGroup: "open"
    }
  ]);
  assert.deepEqual(preparedSessions, []);
  assert.deepEqual(terminalStateSessions, []);
  assert.deepEqual(result.sessions.map((session) => session.sessionId), ["open-session"]);
  assert.equal(result.sessions[0].presentation, undefined);
  assert.equal(result.sessions[0].stepDefinitions, undefined);
  assert.equal(result.sessions[0].artifactReadiness, undefined);
  assert.equal(result.sessions[0].commandLifecycles, undefined);
  assert.equal(result.sessions[0].codexTerminal, undefined);
  assert.equal(result.limits.openSessionCount, 1);
});

test("archived session list asks for archived sessions and computes creation limits from open sessions", async () => {
  const listCalls = [];
  const service = createService({
    projectService: {
      async createRuntime() {
        return {
          async listSessionSummaries(options = {}) {
            listCalls.push(options);
            if (options.statusGroup === "closed") {
              return [
                {
                  completedStepCount: 3,
                  sessionId: "abandoned-session",
                  status: VIBE64_SESSION_STATUS.ABANDONED
                }
              ];
            }
            return [
              {
                sessionId: "open-session",
                status: VIBE64_SESSION_STATUS.ACTIVE
              }
            ];
          },
          async listSessions() {
            throw new Error("listSessions should not be used for archived session lists.");
          },
          async workflowDefinitionCreationOptions() {
            return workflowDefinitionCreationOptions({
              seedRequired: false
            });
          }
        };
      }
    },
    setupServices: readySetupServices()
  });

  const result = await service.listSessions({
    archive: "abandoned"
  });

  assert.equal(result.ok, true);
  assert.deepEqual(listCalls, [
    {
      statusGroup: "closed",
      statuses: [VIBE64_SESSION_STATUS.ABANDONED]
    },
    {
      statusGroup: "open"
    }
  ]);
  assert.deepEqual(result.sessions.map((session) => session.sessionId), ["abandoned-session"]);
  assert.equal(result.limits.openSessionCount, 1);
});

test("session list limits unseeded targets to one open seed session", async () => {
  const service = createService({
    projectService: {
      async createRuntime() {
        return {
          async listSessions() {
            return [
              {
                sessionId: "seed-session",
                status: VIBE64_SESSION_STATUS.ACTIVE
              }
            ];
          },
          async workflowDefinitionCreationOptions() {
            return workflowDefinitionCreationOptions({
              seedRequired: true
            });
          }
        };
      }
    },
    setupServices: readySetupServices()
  });

  const result = await service.listSessions();

  assert.equal(result.ok, true);
  assert.equal(result.creation.mode, "seed_required");
  assert.equal(result.creation.canCreate, false);
  assert.equal(result.creation.defaultWorkflowDefinition, VIBE64_WORKFLOW_DEFINITION_IDS.SEED_APPLICATION);
  assert.deepEqual(result.creation.workflowDefinitions, []);
  assert.equal(result.limits.maxOpenSessions, 1);
  assert.equal(result.limits.openSessionCount, 1);
});

test("session creation blocks non-seed definitions while seeding is required", async () => {
  let createSessionCalled = false;
  const service = createService({
    projectService: {
      async createRuntime() {
        return {
          async createSession() {
            createSessionCalled = true;
            return {
              sessionId: "new-session"
            };
          },
          async listSessions() {
            return [];
          },
          async workflowDefinitionCreationOptions() {
            return workflowDefinitionCreationOptions({
              seedRequired: true
            });
          }
        };
      },
      async requireProjectType() {
        return {
          adapter: {
            id: "jskit"
          },
          projectType: "jskit"
        };
      }
    },
    setupServices: readySetupServices()
  });

  const result = await service.createSession({
    workflowDefinition: VIBE64_WORKFLOW_DEFINITION_IDS.BIG_FEATURE
  });

  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, "workflow_definition_not_available");
  assert.equal(createSessionCalled, false);
});

test("session creation uses the selected workflow definition after seeding", async () => {
  let selectedWorkflowDefinitionId = "";
  const service = createService({
    projectService: {
      async createRuntime() {
        return {
          async advance(sessionId) {
            return {
              ok: true,
              sessionId,
              workflowDefinition: {
                id: selectedWorkflowDefinitionId
              }
            };
          },
          async createSession(input = {}) {
            selectedWorkflowDefinitionId = input.workflowDefinition;
            return {
              sessionId: "new-session"
            };
          },
          async listSessions() {
            return [];
          },
          async workflowDefinitionCreationOptions() {
            return workflowDefinitionCreationOptions({
              seedRequired: false
            });
          }
        };
      },
      async requireProjectType() {
        return {
          adapter: {
            id: "jskit"
          },
          projectType: "jskit"
        };
      }
    },
    setupServices: readySetupServices()
  });

  const result = await service.createSession({
    workflowDefinition: maintenanceWorkflowDefinitionIds.NON_COMMIT_MAINTENANCE
  });

  assert.equal(result.ok, true);
  assert.equal(result.workflowDefinition.id, maintenanceWorkflowDefinitionIds.NON_COMMIT_MAINTENANCE);
  assert.equal(selectedWorkflowDefinitionId, maintenanceWorkflowDefinitionIds.NON_COMMIT_MAINTENANCE);
});

test("session creation blocks a second open seed session", async () => {
  let createSessionCalled = false;
  const service = createService({
    projectService: {
      async createRuntime() {
        return {
          async createSession() {
            createSessionCalled = true;
            return {
              sessionId: "new-session"
            };
          },
          async listSessions() {
            return [
              {
                sessionId: "seed-session",
                status: VIBE64_SESSION_STATUS.ACTIVE
              }
            ];
          },
          async workflowDefinitionCreationOptions() {
            return workflowDefinitionCreationOptions({
              seedRequired: true
            });
          }
        };
      },
      async requireProjectType() {
        return {
          adapter: {
            id: "jskit"
          },
          projectType: "jskit"
        };
      }
    },
    setupServices: readySetupServices()
  });

  const result = await service.createSession();

  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, "open_session_limit");
  assert.equal(result.limits.maxOpenSessions, 1);
  assert.equal(createSessionCalled, false);
});
