import assert from "node:assert/strict";
import test from "node:test";

import {
  AI_STUDIO_SESSION_STATUS,
  AI_STUDIO_WORKFLOW_PROFILE_IDS,
  workflowProfileCreationOptions
} from "../../server/lib/aiStudio/index.js";
import {
  createService
} from "../../packages/ai-studio-sessions/src/server/service.js";

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

test("session action closes terminals when the action archives the session", async () => {
  const closedSessionIds = [];
  const service = createService({
    projectService: {
      async createRuntime() {
        return {
          async runAction(sessionId) {
            return {
              sessionId,
              status: AI_STUDIO_SESSION_STATUS.FINISHED
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

  assert.equal(session.status, AI_STUDIO_SESSION_STATUS.FINISHED);
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
              status: AI_STUDIO_SESSION_STATUS.ACTIVE
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

  assert.equal(session.status, AI_STUDIO_SESSION_STATUS.ACTIVE);
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
              status: AI_STUDIO_SESSION_STATUS.ACTIVE
            };
          }
        };
      }
    },
    publishSessionChanged: {
      async action(sessionId, event = {}) {
        operations.push({
          kind: "publish",
          reason: event.reason,
          sessionId
        });
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

  assert.equal(session.status, AI_STUDIO_SESSION_STATUS.ACTIVE);
  assert.equal(session.codexPromptDelivery.codexPromptInjected, true);
  assert.deepEqual(session.codexTerminal, {
    commandPreview: "codex",
    id: "codex-terminal-1",
    status: "running",
    transmitting: true
  });
  assert.deepEqual(session.presentation.terminal.codex, {
    label: "Terminal is transmitting...",
    readOnlyInAutopilot: true,
    renderer: "codex_terminal",
    terminalSessionId: "codex-terminal-1",
    visible: true
  });
  assert.deepEqual(deliveries, [
    {
      promptHandoff: handoff,
      sessionId: "session-1"
    }
  ]);
  assert.deepEqual(operations, [
    {
      kind: "publish",
      reason: "codex-prompt-state-updated",
      sessionId: "session-1"
    },
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
              status: AI_STUDIO_SESSION_STATUS.ACTIVE
            };
          }
        };
      }
    },
    publishSessionChanged: {
      async intent(sessionId, event = {}) {
        operations.push({
          kind: "publish",
          reason: event.reason,
          sessionId
        });
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

  assert.equal(session.status, AI_STUDIO_SESSION_STATUS.ACTIVE);
  assert.equal(session.codexPromptDelivery.terminalSessionId, "codex-terminal-2");
  assert.deepEqual(deliveries, [
    {
      promptHandoff: handoff,
      sessionId: "session-1"
    }
  ]);
  assert.deepEqual(operations, [
    {
      kind: "publish",
      reason: "codex-prompt-state-updated",
      sessionId: "session-1"
    },
    {
      kind: "deliver",
      sessionId: "session-1"
    }
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
              status: AI_STUDIO_SESSION_STATUS.ACTIVE
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

test("session presentation hides the Codex preview while a user input screen is active", async () => {
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
              status: AI_STUDIO_SESSION_STATUS.ACTIVE
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

  assert.deepEqual(session.codexTerminal, {
    commandPreview: "codex",
    id: "codex-terminal-active",
    status: "running",
    transmitting: true
  });
  assert.deepEqual(session.presentation.terminal.codex, {
    label: "",
    readOnlyInAutopilot: true,
    renderer: "codex_terminal",
    terminalSessionId: "codex-terminal-active",
    visible: false
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
      status: AI_STUDIO_SESSION_STATUS.ACTIVE
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

test("session list exposes selectable workflow profiles after seeding", async () => {
  const service = createService({
    projectService: {
      async createRuntime() {
        return {
          async listSessions() {
            return [];
          },
          async workflowProfileCreationOptions() {
            return workflowProfileCreationOptions({
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
    result.creation.workflowProfiles.map((profile) => profile.id),
    [
      AI_STUDIO_WORKFLOW_PROFILE_IDS.BIG_FEATURE,
      AI_STUDIO_WORKFLOW_PROFILE_IDS.GENERAL_CODING,
      AI_STUDIO_WORKFLOW_PROFILE_IDS.NON_CODE_MAINTENANCE,
      AI_STUDIO_WORKFLOW_PROFILE_IDS.NON_COMMIT_MAINTENANCE
    ]
  );
  assert.equal(result.creation.workflowProfiles.some((profile) => profile.id === AI_STUDIO_WORKFLOW_PROFILE_IDS.SEED_APPLICATION), false);
  assert.equal(result.limits.maxOpenSessions, 5);
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
                status: AI_STUDIO_SESSION_STATUS.ACTIVE
              }
            ];
          },
          async workflowProfileCreationOptions() {
            return workflowProfileCreationOptions({
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
  assert.equal(result.creation.defaultWorkflowProfile, AI_STUDIO_WORKFLOW_PROFILE_IDS.SEED_APPLICATION);
  assert.deepEqual(result.creation.workflowProfiles, []);
  assert.equal(result.limits.maxOpenSessions, 1);
  assert.equal(result.limits.openSessionCount, 1);
});

test("session creation blocks non-seed profiles while seeding is required", async () => {
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
          async workflowProfileCreationOptions() {
            return workflowProfileCreationOptions({
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
    workflowProfile: AI_STUDIO_WORKFLOW_PROFILE_IDS.BIG_FEATURE
  });

  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, "workflow_profile_not_available");
  assert.equal(createSessionCalled, false);
});

test("session creation uses the selected workflow profile after seeding", async () => {
  let selectedWorkflowProfile = "";
  const service = createService({
    projectService: {
      async createRuntime() {
        return {
          async advance(sessionId) {
            return {
              ok: true,
              sessionId,
              workflowProfile: {
                id: selectedWorkflowProfile
              }
            };
          },
          async createSession(input = {}) {
            selectedWorkflowProfile = input.workflowProfile;
            return {
              sessionId: "new-session"
            };
          },
          async listSessions() {
            return [];
          },
          async workflowProfileCreationOptions() {
            return workflowProfileCreationOptions({
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
    workflowProfile: AI_STUDIO_WORKFLOW_PROFILE_IDS.NON_COMMIT_MAINTENANCE
  });

  assert.equal(result.ok, true);
  assert.equal(result.workflowProfile.id, AI_STUDIO_WORKFLOW_PROFILE_IDS.NON_COMMIT_MAINTENANCE);
  assert.equal(selectedWorkflowProfile, AI_STUDIO_WORKFLOW_PROFILE_IDS.NON_COMMIT_MAINTENANCE);
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
                status: AI_STUDIO_SESSION_STATUS.ACTIVE
              }
            ];
          },
          async workflowProfileCreationOptions() {
            return workflowProfileCreationOptions({
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
