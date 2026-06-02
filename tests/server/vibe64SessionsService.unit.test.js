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

function assertCodexPreviewHidden(presentation = {}, terminalSessionId = "") {
  assert.equal(presentation.label, "");
  assert.equal(presentation.readOnlyInAutopilot, true);
  assert.equal(presentation.renderer, "codex_terminal");
  assert.equal(presentation.terminalSessionId, terminalSessionId);
  assert.equal(presentation.visible, false);
  assert.equal(presentation.visibleUntil, "");
}

function delay(ms = 0) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
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

test("session abandon does not wait for terminal cleanup", async () => {
  let finishCleanup = null;
  let markCleanupStarted = null;
  const cleanupStarted = new Promise((resolve) => {
    markCleanupStarted = resolve;
  });
  const cleanupFinished = new Promise((resolve) => {
    finishCleanup = () => {
      resolve({
        closed: 1,
        ok: true
      });
    };
  });
  const statusWrites = [];
  const service = createService({
    projectService: {
      async createRuntime() {
        return {
          async getSession(sessionId) {
            return {
              sessionId,
              status: VIBE64_SESSION_STATUS.ABANDONED
            };
          },
          store: {
            async writeStatus(sessionId, status) {
              statusWrites.push({
                sessionId,
                status
              });
            }
          }
        };
      }
    },
    setupServices: readySetupServices(),
    terminalService: {
      async closeSessionTerminals() {
        markCleanupStarted();
        return cleanupFinished;
      }
    }
  });

  const abandonResultPromise = service.abandonSession("session-1");
  await cleanupStarted;
  const result = await Promise.race([
    abandonResultPromise,
    delay(25).then(() => "timeout")
  ]);

  assert.notEqual(result, "timeout");
  assert.equal(result.status, VIBE64_SESSION_STATUS.ABANDONED);
  assert.deepEqual(statusWrites, [
    {
      sessionId: "session-1",
      status: VIBE64_SESSION_STATUS.ABANDONED
    }
  ]);
  finishCleanup();
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
  assertCodexPreviewHidden(session.presentation.terminal.codex, "codex-terminal-1");
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

test("session service records workflow audit messages from action results", async () => {
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
          async runAction(sessionId, actionId) {
            return {
              actionResult: {
                actionId,
                auditMessage: "Pull request draft accepted; creating GitHub pull request.",
                status: "completed"
              },
              sessionId,
              status: VIBE64_SESSION_STATUS.ACTIVE
            };
          },
          store: {
            async readConversationLog() {
              return conversationLog;
            },
            async writeConversationSystemMessage(_sessionId, { text }) {
              const turn = {
                assistant: null,
                messages: [
                  {
                    at: "2026-05-25T01:02:03.000Z",
                    role: "system",
                    text
                  }
                ],
                system: {
                  at: "2026-05-25T01:02:03.000Z",
                  role: "system",
                  text
                },
                turnId: "000001",
                user: null
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

  await service.runSessionAction("session-1", "create_pr_on_gh");
  const read = await service.readSessionConversationLog("session-1");

  assert.equal(read.ok, true);
  assert.deepEqual(read.conversationLog.map((turn) => turn.system.text), [
    "Pull request draft accepted; creating GitHub pull request."
  ]);
});

test("session service records workflow input text before action audit fallback", async () => {
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
                auditMessage: "Make a plan.",
                input,
                intentId,
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

  await service.runSessionIntent("session-1", "reject", {
    fields: {
      feedback: "Revise the implementation before finalizing."
    },
    stepId: "changes_accepted",
    stepStatus: "ready"
  });
  const read = await service.readSessionConversationLog("session-1");

  assert.equal(read.ok, true);
  assert.deepEqual(read.conversationLog.map((turn) => turn.user.text), [
    "Revise the implementation before finalizing."
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

test("session presentation exposes the Codex terminal without using turn state for preview visibility", async () => {
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
  assertCodexPreviewHidden(session.presentation.terminal.codex, "codex-terminal-active");
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

test("session presentation hides the Codex preview when there is no transmitting turn", async () => {
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

test("session presentation ignores Codex turn state for preview visibility", async () => {
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
            activityLabel: "Codex is thinking...",
            commandPreview: "codex",
            id: "codex-terminal-old-input",
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
  assertCodexPreviewHidden(session.presentation.terminal.codex, "codex-terminal-old-input");
});

test("session presentation does not show the Codex terminal preview for stale non-transmitting waits", async () => {
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
                  title: "Codex is thinking..."
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
  assert.equal(session.presentation.screen.title, "Codex is thinking...");
  assert.deepEqual(session.presentation.intents, []);
  assert.deepEqual(session.presentation.terminal.codex, {
    label: "",
    readOnlyInAutopilot: true,
    renderer: "codex_terminal",
    terminalSessionId: "codex-terminal-fresh-wait",
    visible: false,
    visibleUntil: ""
  });
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
  assert.equal(result.limits.maxOpenSessions, 3);
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

test("open session list creates the first seed session automatically when seeding is required", async () => {
  const advancedSessions = [];
  const createdInputs = [];
  const listCalls = [];
  let openSessions = [];
  const service = createService({
    projectService: {
      async createRuntime() {
        return {
          async advance(sessionId) {
            advancedSessions.push(sessionId);
            return {
              currentStep: "worktree_created",
              sessionId,
              status: VIBE64_SESSION_STATUS.ACTIVE
            };
          },
          async createSession(input = {}) {
            createdInputs.push(input);
            openSessions = [
              {
                sessionId: "seed-session",
                status: VIBE64_SESSION_STATUS.ACTIVE
              }
            ];
            return {
              currentStep: "session_created",
              sessionId: "seed-session",
              status: VIBE64_SESSION_STATUS.ACTIVE
            };
          },
          async listSessions(options = {}) {
            listCalls.push(options);
            return openSessions;
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

  const result = await service.listSessions();

  assert.equal(result.ok, true);
  assert.equal(createdInputs.length, 1);
  assert.deepEqual(createdInputs[0], {
    metadata: {
      adapter_id: "jskit",
      project_type: "jskit"
    },
    workflowDefinition: VIBE64_WORKFLOW_DEFINITION_IDS.SEED_APPLICATION
  });
  assert.deepEqual(advancedSessions, ["seed-session"]);
  assert.deepEqual(listCalls, [
    {
      statusGroup: "open"
    },
    {
      statusGroup: "open"
    }
  ]);
  assert.deepEqual(result.sessions.map((session) => session.sessionId), ["seed-session"]);
  assert.equal(result.creation.mode, "seed_required");
  assert.equal(result.creation.canCreate, false);
  assert.equal(result.limits.maxOpenSessions, 1);
  assert.equal(result.limits.openSessionCount, 1);
});

test("open session list serializes automatic seed session creation", async () => {
  let advancedCount = 0;
  let createCount = 0;
  let openSessions = [];
  const service = createService({
    projectService: {
      currentTargetRoot() {
        return "/target";
      },
      async createRuntime() {
        return {
          async advance(sessionId) {
            advancedCount += 1;
            return {
              currentStep: "worktree_created",
              sessionId,
              status: VIBE64_SESSION_STATUS.ACTIVE
            };
          },
          async createSession() {
            createCount += 1;
            await new Promise((resolve) => {
              setTimeout(resolve, 10);
            });
            openSessions = [
              {
                sessionId: "seed-session",
                status: VIBE64_SESSION_STATUS.ACTIVE
              }
            ];
            return {
              currentStep: "session_created",
              sessionId: "seed-session",
              status: VIBE64_SESSION_STATUS.ACTIVE
            };
          },
          async listSessions() {
            return openSessions;
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

  const [firstResult, secondResult] = await Promise.all([
    service.listSessions(),
    service.listSessions()
  ]);

  assert.equal(createCount, 1);
  assert.equal(advancedCount, 1);
  assert.deepEqual(firstResult.sessions.map((session) => session.sessionId), ["seed-session"]);
  assert.deepEqual(secondResult.sessions.map((session) => session.sessionId), ["seed-session"]);
  assert.equal(firstResult.creation.canCreate, false);
  assert.equal(secondResult.creation.canCreate, false);
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

test("session creation blocks a fourth open session", async () => {
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
                sessionId: "session-one",
                status: VIBE64_SESSION_STATUS.ACTIVE
              },
              {
                sessionId: "session-two",
                status: VIBE64_SESSION_STATUS.ACTIVE
              },
              {
                sessionId: "session-three",
                status: VIBE64_SESSION_STATUS.ACTIVE
              }
            ];
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

  assert.equal(result.ok, false);
  assert.equal(result.status, "blocked");
  assert.equal(result.errors[0].code, "open_session_limit");
  assert.equal(result.limits.maxOpenSessions, 3);
  assert.equal(result.limits.openSessionCount, 3);
  assert.equal(createSessionCalled, false);
});
