import assert from "node:assert/strict";
import test from "node:test";

import {
  VIBE64_AGENT_RUN_STATE,
  VIBE64_CONNECTION_PURPOSE_SESSION,
  VIBE64_SESSION_STATUS,
  VIBE64_WORKFLOW_DEFINITION_IDS,
  workflowDefinitionCreationOptions
} from "@local/vibe64-runtime/server";
import {
  createService as createVibe64SessionsService,
  publicSessionResponse,
  publicSessionServiceResponse
} from "../../packages/vibe64-sessions/src/server/service.js";
import {
  _testing as coreMaintenanceTesting
} from "@local/vibe64-runtime/server/workflowModules/coreMaintenance";
const maintenanceWorkflowDefinitionIds = coreMaintenanceTesting.workflowDefinitionIds;

function metadataForSession(metadataBySession, sessionId = "") {
  const key = String(sessionId || "");
  if (!metadataBySession.has(key)) {
    metadataBySession.set(key, {});
  }
  return metadataBySession.get(key);
}

function sessionWithWorkflowDriverMetadata(session = {}, metadataBySession) {
  const sessionId = String(session?.sessionId || "");
  if (!sessionId) {
    return session;
  }
  return {
    ...session,
    metadata: {
      ...(session.metadata || {}),
      ...metadataForSession(metadataBySession, sessionId)
    }
  };
}

function rememberWorkflowDriverTestSession(result, sessionsById) {
  if (result?.sessionId) {
    sessionsById.set(String(result.sessionId), result);
  }
  return result;
}

function workflowDriverTestRuntime(runtime = {}, metadataBySession, sessionsById) {
  const originalStore = runtime.store || {};
  const originalGetSession = runtime.getSession;
  const wrappedRuntime = {
    ...runtime
  };
  for (const name of [
    "abandon",
    "advance",
    "createSession",
    "recoverSessionSource",
    "recoverStuckStep",
    "returnControlFromAgentWait",
    "rewind",
    "runAction",
    "runIntent"
  ]) {
    if (typeof runtime[name] !== "function") {
      continue;
    }
    wrappedRuntime[name] = async (...args) => {
      return rememberWorkflowDriverTestSession(
        await runtime[name](...args),
        sessionsById
      );
    };
  }
  return {
    ...wrappedRuntime,
    async getSession(sessionId) {
      if (typeof originalGetSession === "function") {
        const session = sessionWithWorkflowDriverMetadata(
          await originalGetSession.call(runtime, sessionId),
          metadataBySession
        );
        rememberWorkflowDriverTestSession(session, sessionsById);
        return session;
      }
      return sessionWithWorkflowDriverMetadata(
        sessionsById.get(String(sessionId || "")) || {
          sessionId
        },
        metadataBySession
      );
    },
    store: {
      ...originalStore,
      async mutateSession(sessionId, operation) {
        if (typeof originalStore.mutateSession === "function") {
          return originalStore.mutateSession.call(originalStore, sessionId, operation);
        }
        return operation();
      },
      async writeMetadataValue(sessionId, name, value) {
        metadataForSession(metadataBySession, sessionId)[name] = String(value || "");
        if (typeof originalStore.writeMetadataValue === "function") {
          return originalStore.writeMetadataValue.call(originalStore, sessionId, name, value);
        }
        return undefined;
      }
    }
  };
}

function projectServiceWithWorkflowDriverTestRuntime(projectService = {}) {
  const metadataBySession = new Map();
  const sessionsById = new Map();
  if (typeof projectService?.createRuntime !== "function") {
    return projectService;
  }
  return {
    ...projectService,
    async createRuntime(...args) {
      return workflowDriverTestRuntime(
        await projectService.createRuntime(...args),
        metadataBySession,
        sessionsById
      );
    }
  };
}

function defaultWorkflowOriginInput(input = {}, originId = "test-origin") {
  if (!originId || !input || typeof input !== "object" || Array.isArray(input) || input.originId) {
    return input;
  }
  return {
    ...input,
    originId
  };
}

function serviceWithDefaultWorkflowOrigin(service, originId = "test-origin") {
  if (!originId) {
    return service;
  }
  return {
    ...service,
    abandonSession(sessionId, input = {}) {
      return service.abandonSession(sessionId, defaultWorkflowOriginInput(input, originId));
    },
    advanceSession(sessionId, input = {}) {
      return service.advanceSession(sessionId, defaultWorkflowOriginInput(input, originId));
    },
    buildTerminalFailureFixRequest(sessionId, input = {}) {
      return service.buildTerminalFailureFixRequest(sessionId, defaultWorkflowOriginInput(input, originId));
    },
    createSession(input = {}) {
      return service.createSession(defaultWorkflowOriginInput(input, originId));
    },
    recoverSessionSource(sessionId, input = {}) {
      return service.recoverSessionSource(sessionId, defaultWorkflowOriginInput(input, originId));
    },
    recoverStuckSessionStep(sessionId, input = {}) {
      return service.recoverStuckSessionStep(sessionId, defaultWorkflowOriginInput(input, originId));
    },
    returnAgentControl(sessionId, input = {}) {
      return service.returnAgentControl(sessionId, defaultWorkflowOriginInput(input, originId));
    },
    rewindSession(sessionId, stepId, input = {}) {
      return service.rewindSession(sessionId, stepId, defaultWorkflowOriginInput(input, originId));
    },
    runSessionAction(sessionId, actionId, input = {}) {
      return service.runSessionAction(sessionId, actionId, defaultWorkflowOriginInput(input, originId));
    },
    runSessionIntent(sessionId, intentId, input = {}) {
      return service.runSessionIntent(sessionId, intentId, defaultWorkflowOriginInput(input, originId));
    }
  };
}

function createService(options = {}) {
  const {
    defaultOriginId = "test-origin",
    projectService = {},
    terminalService = {},
    ...rest
  } = options;
  const service = createVibe64SessionsService({
    ...rest,
    projectService: projectServiceWithWorkflowDriverTestRuntime(projectService),
    terminalService: {
      async recordSessionGitCommandActor() {
        return {
          ok: true
        };
      },
      ...terminalService
    }
  });
  return serviceWithDefaultWorkflowOrigin(service, defaultOriginId);
}

test("public session responses omit heavy runtime audit fields", () => {
  const response = publicSessionResponse({
    actionAttempts: [
      {
        output: "x".repeat(1000)
      }
    ],
    actionAttemptsRoot: "/tmp/session/action-attempts",
    actionResults: [
      {
        actionId: "agent_conversation",
        codexPromptHandoff: {
          terminalInput: "large handoff"
        },
        prompt: "large prompt",
        promptContext: {
          rendered: "large context"
        },
        status: "completed"
      }
    ],
    actionResult: {
      actionId: "agent_conversation",
      codexPromptHandoff: {
        terminalInput: "large handoff"
      },
      prompt: "large prompt",
      promptContext: {
        rendered: "large context"
      },
      status: "completed"
    },
    agentRuns: [
      {
        active: true,
        events: [
          {
            kind: "codex-app-server-turn-active",
            state: "active"
          },
          {
            kind: "codex-app-server-live-progress",
            message: "progress"
          }
        ],
        id: "codex_app_server",
        state: VIBE64_AGENT_RUN_STATE.ACTIVE
      }
    ],
    agentRunsRoot: "/tmp/session/agent-runs",
    adapter: {
      composerMenuItems: [
        {
          id: "core.deslop_changes"
        }
      ],
      facts: {
        framework: "JSKIT"
      },
      promptContext: {
        rendered: "large adapter context"
      }
    },
    backgroundTasks: [
      {
        events: [
          {
            kind: "started"
          },
          {
            kind: "ready"
          }
        ],
        id: "codex_app_server",
        status: "ready"
      }
    ],
    metadata: {
      codex_prompt_handoff_echo_input: "large prompt handoff",
      codex_session_briefing_echo_input: "large briefing",
      issue_word: "compas"
    },
    presentation: {
      composerMenu: {
        items: [
          {
            id: "core.deslop_changes",
            label: "Deslop changes"
          },
          {
            id: "core.write_tests",
            label: "Write tests"
          }
        ],
        title: "What would you like to do?"
      }
    },
    promptContextSnapshot: {
      prompt: "large prompt context"
    },
    sessionId: "session-1"
  });

  assert.equal("actionAttempts" in response, false);
  assert.equal("actionAttemptsRoot" in response, false);
  assert.equal("agentRunsRoot" in response, false);
  assert.equal("promptContextSnapshot" in response, false);
  assert.deepEqual(response.actionResults, [
    {
      actionId: "agent_conversation",
      status: "completed"
    }
  ]);
  assert.deepEqual(response.actionResult, {
    actionId: "agent_conversation",
    status: "completed"
  });
  assert.deepEqual(response.metadata, {
    issue_word: "compas"
  });
  assert.equal(response.presentation.composerMenu.items, undefined);
  assert.equal(response.presentation.composerMenu.itemCount, 2);
  assert.equal(typeof response.presentation.composerMenu.signature, "string");
  assert.notEqual(response.presentation.composerMenu.signature, "");
  assert.equal(response.presentation.composerMenu.title, "What would you like to do?");
  assert.deepEqual(response.adapter, {
    facts: {
      framework: "JSKIT"
    }
  });
  assert.deepEqual(response.backgroundTasks, [
    {
      eventCount: 2,
      id: "codex_app_server",
      lastEvent: {
        kind: "ready"
      },
      status: "ready"
    }
  ]);
  assert.equal(response.agentRuns[0].events, undefined);
  assert.equal(response.agentRuns[0].eventCount, 2);
  assert.deepEqual(response.agentRuns[0].lastEvent, {
    kind: "codex-app-server-live-progress",
    message: "progress"
  });
});

test("public session responses include composer menu items only when requested", () => {
  const menuItems = [
    {
      id: "core.deslop_changes",
      label: "Deslop changes"
    }
  ];
  const leanResponse = publicSessionResponse({
    presentation: {
      composerMenu: {
        items: menuItems
      }
    },
    sessionId: "session-1"
  });
  const fullResponse = publicSessionResponse({
    presentation: {
      composerMenu: {
        items: menuItems
      }
    },
    sessionId: "session-1"
  }, {
    includeComposerMenu: true
  });

  assert.equal(leanResponse.presentation.composerMenu.items, undefined);
  assert.equal(leanResponse.presentation.composerMenu.itemCount, 1);
  assert.equal(typeof leanResponse.presentation.composerMenu.signature, "string");
  assert.deepEqual(fullResponse.presentation.composerMenu.items, menuItems);
  assert.equal(fullResponse.presentation.composerMenu.signature, leanResponse.presentation.composerMenu.signature);
});

test("public session composer menu projection preserves signature-only menus", () => {
  const response = publicSessionResponse({
    presentation: {
      composerMenu: {
        itemCount: 3,
        signature: "already-projected-menu",
        title: "What would you like to do?"
      }
    },
    sessionId: "session-1"
  }, {
    includeComposerMenu: true
  });

  assert.deepEqual(response.presentation.composerMenu, {
    itemCount: 3,
    signature: "already-projected-menu",
    title: "What would you like to do?"
  });
});

test("public session service projection only rewrites session-shaped responses", () => {
  const helperResponse = {
    actionAttempts: [
      {
        output: "debug"
      }
    ],
    ok: true,
    sessionId: "session-1",
    terminalFailureFixRequest: {
      outputTail: "debug"
    }
  };

  assert.equal(publicSessionServiceResponse(helperResponse), helperResponse);

  const listResponse = publicSessionServiceResponse({
    ok: true,
    sessions: [
      {
        actionAttempts: [
          {
            output: "debug"
          }
        ],
        currentStep: "maintenance_conversation",
        sessionId: "session-1"
      }
    ]
  });

  assert.equal("actionAttempts" in listResponse.sessions[0], false);
  assert.equal(listResponse.sessions[0].currentStep, "maintenance_conversation");
});

function readySetupServices() {
  const readyService = {
    async getStatus() {
      return {
        ready: true
      };
    }
  };
  return {
    connectionSetupService: readyService,
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

function createComposerDraftTestService() {
  const artifacts = new Map();
  const service = createService({
    projectService: {
      async createRuntime() {
        return {
          store: {
            async readArtifact(sessionId, relativePath) {
              return artifacts.get(`${sessionId}:${relativePath}`) || "";
            },
            async writeArtifact(sessionId, relativePath, text) {
              artifacts.set(`${sessionId}:${relativePath}`, text);
              return relativePath;
            }
          }
        };
      }
    }
  });
  return {
    artifacts,
    service
  };
}

test("composer draft publishing persists a revisioned session draft", async () => {
  const {
    artifacts,
    service
  } = createComposerDraftTestService();

  const first = await service.broadcastComposerDraft("session-1", {
    controlId: "talk_to_codex",
    fieldName: "conversationRequest",
    fields: {
      conversationRequest: "Hello"
    },
    originId: "origin-1",
    projectSlug: "vibe64"
  });
  const second = await service.broadcastComposerDraft("session-1", {
    baseRevision: first.draft.revision,
    controlId: "talk_to_codex",
    fieldName: "conversationRequest",
    fields: {
      conversationRequest: "Hello again"
    },
    originId: "origin-2",
    projectSlug: "vibe64"
  });
  const read = await service.readComposerDraft("session-1", {
    controlId: "talk_to_codex"
  });

  assert.equal(first.ok, true);
  assert.equal(first.draft.revision, 1);
  assert.equal(second.draft.revision, 2);
  assert.equal(
    artifacts.has("session-1:tmp/composer-drafts/talk_to_codex.json"),
    true
  );
  assert.deepEqual(read.draft.fields, {
    conversationRequest: "Hello again"
  });
  assert.equal(read.draft.baseRevision, 1);
  assert.equal(read.draft.revision, 2);
});

test("composer draft publishing refuses to persist stale draft revisions", async () => {
  const {
    service
  } = createComposerDraftTestService();

  const first = await service.broadcastComposerDraft("session-1", {
    controlId: "talk_to_codex",
    fieldName: "conversationRequest",
    fields: {
      conversationRequest: "Existing draft"
    },
    originId: "origin-1",
    projectSlug: "vibe64"
  });
  const stale = await service.broadcastComposerDraft("session-1", {
    baseRevision: 0,
    controlId: "talk_to_codex",
    fieldName: "conversationRequest",
    fields: {
      conversationRequest: "Stale overwrite"
    },
    originId: "origin-2",
    projectSlug: "vibe64"
  });
  const read = await service.readComposerDraft("session-1", {
    controlId: "talk_to_codex"
  });

  assert.equal(first.draft.revision, 1);
  assert.equal(stale.ok, true);
  assert.equal(stale.stale, true);
  assert.equal(stale.currentDraft.revision, 1);
  assert.deepEqual(stale.currentDraft.fields, {
    conversationRequest: "Existing draft"
  });
  assert.deepEqual(read.draft.fields, {
    conversationRequest: "Existing draft"
  });
  assert.equal(read.draft.revision, 1);
});

test("composer draft submission start broadcasts the event but stores an empty draft", async () => {
  const {
    service
  } = createComposerDraftTestService();

  const result = await service.broadcastComposerDraft("session-1", {
    controlId: "conversation_composer",
    fieldName: "conversationRequest",
    fields: {
      conversationRequest: "Submit this"
    },
    kind: "submission_start",
    originId: "origin-1",
    projectSlug: "vibe64",
    text: "Submit this"
  });
  const read = await service.readComposerDraft("session-1", {
    controlId: "conversation_composer"
  });

  assert.equal(result.draft.kind, "submission_start");
  assert.equal(result.draft.text, "Submit this");
  assert.equal(read.draft.kind, "draft");
  assert.equal(read.draft.text, "");
  assert.deepEqual(read.draft.fields, {
    conversationRequest: ""
  });
});

test("session action closes terminals when the action archives the session", async () => {
  const closedSessionIds = [];
  const operations = [];
  const service = createService({
    projectService: {
      async createRuntime() {
        return {
          async markSessionClosing(sessionId, options = {}) {
            operations.push(`closing:${sessionId}:${options.reason}`);
          },
          async runAction(sessionId) {
            operations.push(`run:${sessionId}`);
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
        operations.push(`close:${sessionId}`);
        closedSessionIds.push(sessionId);
      }
    }
  });

  const session = await service.runSessionAction("session-1", "finish_session");

  assert.equal(session.status, VIBE64_SESSION_STATUS.FINISHED);
  assert.deepEqual(session.clientRefresh, {
    includeList: true
  });
  assert.deepEqual(closedSessionIds, ["session-1", "session-1"]);
  assert.deepEqual(operations, [
    "closing:session-1:finished",
    "close:session-1",
    "run:session-1",
    "close:session-1"
  ]);
});

test("session action treats a repeated close request as already archived", async () => {
  let runActionCalled = false;
  const service = createService({
    projectService: {
      async createRuntime() {
        return {
          async getSession(sessionId) {
            return {
              archived: true,
              sessionId,
              status: VIBE64_SESSION_STATUS.FINISHED
            };
          },
          async runAction() {
            runActionCalled = true;
            throw new Error("finish_session should not run twice.");
          }
        };
      }
    },
    setupServices: readySetupServices(),
    terminalService: {
      async closeSessionTerminals() {
        throw new Error("Terminals should already be closed for an archived session.");
      }
    }
  });

  const session = await service.runSessionAction("session-1", "finish_session");

  assert.equal(session.status, VIBE64_SESSION_STATUS.FINISHED);
  assert.equal(session.archived, true);
  assert.equal(runActionCalled, false);
  assert.deepEqual(session.clientRefresh, {
    includeList: true
  });
});

test("session intent asks clients to refresh the session list when it archives the session", async () => {
  const closedSessionIds = [];
  const operations = [];
  const service = createService({
    projectService: {
      async createRuntime() {
        return {
          async markSessionClosing(sessionId, options = {}) {
            operations.push(`closing:${sessionId}:${options.reason}`);
          },
          async runIntent(sessionId) {
            operations.push(`run:${sessionId}`);
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
        operations.push(`close:${sessionId}`);
        closedSessionIds.push(sessionId);
      }
    }
  });

  const session = await service.runSessionIntent("session-1", "archive_session");

  assert.equal(session.status, VIBE64_SESSION_STATUS.FINISHED);
  assert.deepEqual(session.clientRefresh, {
    includeList: true
  });
  assert.deepEqual(closedSessionIds, ["session-1", "session-1"]);
  assert.deepEqual(operations, [
    "closing:session-1:finished",
    "close:session-1",
    "run:session-1",
    "close:session-1"
  ]);
});

test("session intent treats a repeated close request as already archived", async () => {
  let runIntentCalled = false;
  const service = createService({
    projectService: {
      async createRuntime() {
        return {
          async getSession(sessionId) {
            return {
              archived: true,
              sessionId,
              status: VIBE64_SESSION_STATUS.FINISHED
            };
          },
          async runIntent() {
            runIntentCalled = true;
            throw new Error("archive_session should not run twice.");
          }
        };
      }
    },
    setupServices: readySetupServices(),
    terminalService: {
      async closeSessionTerminals() {
        throw new Error("Terminals should already be closed for an archived session.");
      }
    }
  });

  const session = await service.runSessionIntent("session-1", "archive_session");

  assert.equal(session.status, VIBE64_SESSION_STATUS.FINISHED);
  assert.equal(session.archived, true);
  assert.equal(runIntentCalled, false);
  assert.deepEqual(session.clientRefresh, {
    includeList: true
  });
});

test("session intent clears closing marker when terminal cleanup fails before archive", async () => {
  const operations = [];
  let runIntentCalled = false;
  const service = createService({
    projectService: {
      async createRuntime() {
        return {
          async clearSessionClosing(sessionId) {
            operations.push(`clearClosing:${sessionId}`);
          },
          async markSessionClosing(sessionId, options = {}) {
            operations.push(`closing:${sessionId}:${options.reason}`);
          },
          async runIntent() {
            runIntentCalled = true;
            throw new Error("archive_session should not run after cleanup failure.");
          }
        };
      }
    },
    setupServices: readySetupServices(),
    terminalService: {
      async closeSessionTerminals(sessionId) {
        operations.push(`close:${sessionId}`);
        throw new Error("Preview runtime could not stop.");
      }
    }
  });

  const result = await service.runSessionIntent("session-1", "archive_session");

  assert.equal(result.ok, false);
  assert.match(result.error, /Preview runtime could not stop/u);
  assert.equal(runIntentCalled, false);
  assert.deepEqual(operations, [
    "closing:session-1:finished",
    "close:session-1",
    "clearClosing:session-1"
  ]);
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

test("session action is gated by session readiness, not project setup diagnostics", async () => {
  let runActionCalled = false;
  const service = createService({
    projectService: {
      async createRuntime() {
        return {
          async runAction(sessionId) {
            runActionCalled = true;
            return {
              sessionId,
              status: VIBE64_SESSION_STATUS.ACTIVE
            };
          }
        };
      }
    },
    setupServices: {
      ...readySetupServices(),
      projectSetupService: {
        async getStatus() {
          throw new Error("Project setup should not gate session actions.");
        }
      }
    }
  });

  const session = await service.runSessionAction("session-1", "record_action");

  assert.equal(session.sessionId, "session-1");
  assert.equal(session.status, VIBE64_SESSION_STATUS.ACTIVE);
  assert.equal(runActionCalled, true);
});

test("session advance is gated by session readiness", async () => {
  let createRuntimeCalled = false;
  let advanceCalled = false;
  const service = createService({
    projectService: {
      async createRuntime() {
        createRuntimeCalled = true;
        return {
          async advance() {
            advanceCalled = true;
            return {
              sessionId: "session-1",
              status: VIBE64_SESSION_STATUS.ACTIVE
            };
          }
        };
      }
    },
    setupServices: {
      connectionSetupService: {
        async getStatus() {
          return {
            blockedReason: "Codex connection is not ready.",
            ready: false
          };
        }
      },
      studioSetupService: {
        async getStatus() {
          return {
            ready: true
          };
        }
      }
    }
  });

  const result = await service.advanceSession("session-1", {
    vibe64User: {
      email: "owner@example.com"
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "vibe64_session_not_ready");
  assert.equal(result.error, "Codex connection is not ready.");
  assert.equal(createRuntimeCalled, false);
  assert.equal(advanceCalled, false);
});

test("session advance observes duplicate advances that already moved forward before advancing", async () => {
  let advanceCalled = false;
  let getSessionCalled = false;
  let recordGitActorCalled = false;
  const service = createService({
    projectService: {
      async createRuntime() {
        return {
          async advance() {
            advanceCalled = true;
            const error = new Error("Prepared advance state already moved.");
            error.code = "vibe64_advance_state_changed";
            throw error;
          },
          async getSession(sessionId) {
            getSessionCalled = true;
            return {
              currentStep: "maintenance_conversation",
              presentation: {},
              sessionId,
              status: VIBE64_SESSION_STATUS.ACTIVE,
              stepDefinitions: [
                {
                  id: "dependencies_installed",
                  index: 2,
                  status: "done"
                },
                {
                  id: "maintenance_conversation",
                  index: 3,
                  status: "current"
                }
              ]
            };
          },
          store: {
            async mutateSession(_sessionId, operation) {
              return operation();
            },
            async writeMetadataValue() {
              throw new Error("duplicate advance should not claim a workflow driver");
            }
          }
        };
      }
    },
    setupServices: readySetupServices(),
    terminalService: {
      async recordSessionGitCommandActor() {
        recordGitActorCalled = true;
        throw new Error("duplicate advance should not record a Git actor");
      }
    }
  });

  const result = await service.advanceSession("session-1", {
    originId: "tab-dave",
    stepId: "dependencies_installed",
    stepStatus: "done",
    vibe64User: {
      email: "dave.guard@gmail.com"
    }
  });

  assert.equal(advanceCalled, false);
  assert.equal(getSessionCalled, true);
  assert.equal(recordGitActorCalled, false);
  assert.equal(result.sessionId, "session-1");
  assert.equal(result.currentStep, "maintenance_conversation");
  assert.equal(result.ok, undefined);
});

test("session advance rejects changed origins when the existing driver user is unknown", async () => {
  let advanceCalled = false;
  let recordGitActorCalled = false;
  const metadata = {
    workflow_driver_origin_id: "tab-tony"
  };
  const service = createService({
    projectService: {
      async createRuntime() {
        return {
          async advance() {
            advanceCalled = true;
            throw new Error("cross-origin advance should not run");
          },
          async getSession(sessionId) {
            return {
              currentStep: "dependencies_installed",
              metadata: {
                ...metadata
              },
              presentation: {},
              sessionId,
              status: VIBE64_SESSION_STATUS.ACTIVE,
              stepDefinitions: [
                {
                  id: "dependencies_installed",
                  index: 2,
                  status: "current"
                },
                {
                  id: "maintenance_conversation",
                  index: 3,
                  status: "pending"
                }
              ]
            };
          },
          store: {
            async mutateSession(_sessionId, operation) {
              return operation();
            },
            async writeMetadataValue(_sessionId, name, value) {
              metadata[name] = String(value || "");
            }
          }
        };
      }
    },
    setupServices: readySetupServices(),
    terminalService: {
      async recordSessionGitCommandActor() {
        recordGitActorCalled = true;
        throw new Error("cross-origin advance should not record a Git actor");
      }
    }
  });

  const result = await service.advanceSession("session-1", {
    originId: "tab-dave",
    stepId: "dependencies_installed",
    stepStatus: "done",
    vibe64User: {
      email: "dave.guard@gmail.com"
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "vibe64_workflow_driver_origin_mismatch");
  assert.equal(advanceCalled, false);
  assert.equal(recordGitActorCalled, false);
  assert.equal(metadata.workflow_driver_origin_id, "tab-tony");
  assert.equal(metadata.workflow_driver_email, undefined);
});

test("session advance rebinds the workflow driver for the same user after reload", async () => {
  let advanceCalled = false;
  let recordGitActorCalled = false;
  const metadata = {
    workflow_driver_email: "tonymobily@gmail.com",
    workflow_driver_origin_id: "tab-tony",
    workflow_driver_user_key: "tonymobily@gmail.com"
  };
  const service = createService({
    projectService: {
      async createRuntime() {
        return {
          async advance(sessionId) {
            advanceCalled = true;
            return {
              currentStep: "maintenance_conversation",
              metadata: {
                ...metadata
              },
              presentation: {},
              sessionId,
              status: VIBE64_SESSION_STATUS.ACTIVE,
              stepDefinitions: [
                {
                  id: "dependencies_installed",
                  index: 2,
                  status: "done"
                },
                {
                  id: "maintenance_conversation",
                  index: 3,
                  status: "current"
                }
              ]
            };
          },
          async getSession(sessionId) {
            return {
              currentStep: "dependencies_installed",
              metadata: {
                ...metadata
              },
              presentation: {},
              sessionId,
              status: VIBE64_SESSION_STATUS.ACTIVE,
              stepDefinitions: [
                {
                  id: "dependencies_installed",
                  index: 2,
                  status: "current"
                },
                {
                  id: "maintenance_conversation",
                  index: 3,
                  status: "pending"
                }
              ]
            };
          },
          store: {
            async mutateSession(_sessionId, operation) {
              return operation();
            },
            async writeMetadataValue(_sessionId, name, value) {
              metadata[name] = String(value || "");
            }
          }
        };
      }
    },
    setupServices: readySetupServices(),
    terminalService: {
      async recordSessionGitCommandActor(_sessionId, input = {}) {
        recordGitActorCalled = true;
        assert.equal(input.vibe64User?.email, "tonymobily@gmail.com");
        return {
          ok: true
        };
      }
    }
  });

  const result = await service.advanceSession("session-1", {
    originId: "tab-tony-reloaded",
    stepId: "dependencies_installed",
    stepStatus: "done",
    vibe64User: {
      email: "tonymobily@gmail.com"
    }
  });

  assert.equal(result.ok, undefined);
  assert.equal(result.sessionId, "session-1");
  assert.equal(result.currentStep, "maintenance_conversation");
  assert.equal(advanceCalled, true);
  assert.equal(recordGitActorCalled, true);
  assert.equal(metadata.workflow_driver_origin_id, "tab-tony-reloaded");
  assert.equal(metadata.workflow_driver_email, "tonymobily@gmail.com");
  assert.equal(metadata.workflow_driver_user_key, "tonymobily@gmail.com");
});

test("session advance observes duplicate advances after runtime reports changed state", async () => {
  let advanceCalled = false;
  let getSessionCount = 0;
  const readySession = {
    currentStep: "dependencies_installed",
    presentation: {},
    sessionId: "session-1",
    status: VIBE64_SESSION_STATUS.ACTIVE,
    stepDefinitions: [
      {
        id: "dependencies_installed",
        index: 2,
        status: "current"
      },
      {
        id: "maintenance_conversation",
        index: 3,
        status: "pending"
      }
    ]
  };
  const advancedSession = {
    currentStep: "maintenance_conversation",
    presentation: {},
    sessionId: "session-1",
    status: VIBE64_SESSION_STATUS.ACTIVE,
    stepDefinitions: [
      {
        id: "dependencies_installed",
        index: 2,
        status: "done"
      },
      {
        id: "maintenance_conversation",
        index: 3,
        status: "current"
      }
    ]
  };
  const service = createService({
    projectService: {
      async createRuntime() {
        return {
          async advance() {
            advanceCalled = true;
            const error = new Error("Prepared advance state already moved.");
            error.code = "vibe64_advance_state_changed";
            throw error;
          },
          async getSession() {
            getSessionCount += 1;
            return getSessionCount === 1 ? readySession : advancedSession;
          }
        };
      }
    },
    setupServices: readySetupServices()
  });

  const result = await service.advanceSession("session-1", {
    stepId: "dependencies_installed",
    stepStatus: "done"
  });

  assert.equal(advanceCalled, true);
  assert.ok(getSessionCount >= 2);
  assert.equal(result.sessionId, "session-1");
  assert.equal(result.currentStep, "maintenance_conversation");
  assert.equal(result.ok, undefined);
});

test("session advance still rejects stale advances that did not move past the expected step", async () => {
  const service = createService({
    projectService: {
      async createRuntime() {
        return {
          async advance() {
            const error = new Error("Prepared advance state changed.");
            error.code = "vibe64_advance_state_changed";
            throw error;
          },
          async getSession(sessionId) {
            return {
              currentStep: "implementation_reviewed",
              presentation: {},
              sessionId,
              status: VIBE64_SESSION_STATUS.ACTIVE,
              stepDefinitions: [
                {
                  id: "plan_and_execute",
                  index: 5,
                  status: "pending"
                },
                {
                  id: "implementation_reviewed",
                  index: 6,
                  status: "current"
                }
              ]
            };
          }
        };
      }
    },
    setupServices: readySetupServices()
  });

  const result = await service.advanceSession("session-1", {
    stepId: "plan_and_execute",
    stepStatus: "done"
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "vibe64_advance_state_changed");
});

test("session abandon closes terminals before archiving the source", async () => {
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
  const operations = [];
  const service = createService({
    projectService: {
      async createRuntime() {
        return {
          async archiveSessionSource(session, options = {}) {
            operations.push(`archive:${session.sessionId}:${options.reason}`);
            return {
              ok: true
            };
          },
          async getSession(sessionId) {
            return {
              sessionId,
              status: operations.includes(`status:${sessionId}`)
                ? VIBE64_SESSION_STATUS.ABANDONED
                : VIBE64_SESSION_STATUS.ACTIVE
            };
          },
          async markSessionClosing(sessionId, options = {}) {
            operations.push(`closing:${sessionId}:${options.reason}`);
          },
          store: {
            async writeStatus(sessionId, status) {
              operations.push(`status:${sessionId}`);
              assert.equal(status, VIBE64_SESSION_STATUS.ABANDONED);
            }
          }
        };
      }
    },
    setupServices: readySetupServices(),
    terminalService: {
      async closeSessionTerminals() {
        operations.push("close:session-1:start");
        markCleanupStarted();
        const result = await cleanupFinished;
        operations.push("close:session-1:done");
        return result;
      }
    }
  });

  const abandonResultPromise = service.abandonSession("session-1");
  await cleanupStarted;
  const result = await Promise.race([
    abandonResultPromise,
    delay(25).then(() => "timeout")
  ]);

  assert.equal(result, "timeout");
  assert.deepEqual(operations, [
    "closing:session-1:abandoned",
    "close:session-1:start"
  ]);
  finishCleanup();
  const abandonedSession = await abandonResultPromise;
  assert.equal(abandonedSession.status, VIBE64_SESSION_STATUS.ABANDONED);
  assert.deepEqual(operations, [
    "closing:session-1:abandoned",
    "close:session-1:start",
    "close:session-1:done",
    "archive:session-1:abandoned",
    "status:session-1"
  ]);
});

test("session abandon does not mark abandoned when terminal cleanup fails", async () => {
  const operations = [];
  const service = createService({
    projectService: {
      async createRuntime() {
        return {
          async archiveSessionSource(session, options = {}) {
            operations.push(`archive:${session.sessionId}:${options.reason}`);
            return {
              ok: true
            };
          },
          async getSession(sessionId) {
            return {
              sessionId,
              status: VIBE64_SESSION_STATUS.ACTIVE
            };
          },
          async clearSessionClosing(sessionId) {
            operations.push(`clearClosing:${sessionId}`);
          },
          async markSessionClosing(sessionId, options = {}) {
            operations.push(`closing:${sessionId}:${options.reason}`);
          },
          store: {
            async writeStatus(sessionId, status) {
              operations.push(`status:${sessionId}:${status}`);
            }
          }
        };
      }
    },
    setupServices: readySetupServices(),
    terminalService: {
      async closeSessionTerminals(sessionId) {
        operations.push(`close:${sessionId}`);
        throw new Error("Preview runtime could not stop.");
      }
    }
  });

  const result = await service.abandonSession("session-1");

  assert.equal(result.ok, false);
  assert.match(result.error, /Preview runtime could not stop/u);
  assert.deepEqual(operations, [
    "closing:session-1:abandoned",
    "close:session-1",
    "clearClosing:session-1"
  ]);
});

test("session abandon does not require live Codex terminal state after closing", async () => {
  let codexTerminalStateCalls = 0;
  const statusWrites = [];
  const service = createService({
    projectService: {
      async createRuntime() {
        return {
          async archiveSessionSource() {
            return {
              ok: true
            };
          },
          async getSession(sessionId) {
            return {
              sessionId,
              status: VIBE64_SESSION_STATUS.ABANDONED
            };
          },
          async markSessionClosing() {},
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
        return {
          closed: 0,
          ok: true
        };
      },
      async codexTerminalState() {
        codexTerminalStateCalls += 1;
        return {
          error: "Terminal session not found.",
          ok: false
        };
      }
    }
  });

  const result = await service.abandonSession("session-1");

  assert.equal(result.status, VIBE64_SESSION_STATUS.ABANDONED);
  assert.equal(codexTerminalStateCalls, 0);
  assert.deepEqual(statusWrites, [
    {
      sessionId: "session-1",
      status: VIBE64_SESSION_STATUS.ABANDONED
    }
  ]);
});

test("session source recovery delegates to the runtime recovery path", async () => {
  const calls = [];
  const service = createService({
    projectService: {
      async createRuntime() {
        return {
          async recoverSessionSource(sessionId) {
            calls.push(sessionId);
            return {
              metadata: {
                source_removed: "no"
              },
              sessionId,
              status: VIBE64_SESSION_STATUS.ABANDONED
            };
          }
        };
      }
    },
    setupServices: readySetupServices(),
    terminalService: {}
  });

  const result = await service.recoverSessionSource("session-1");

  assert.equal(result.sessionId, "session-1");
  assert.equal(result.metadata.source_removed, "no");
  assert.deepEqual(calls, ["session-1"]);
});

test("session abandon closes terminals, archives the source, then marks abandoned", async () => {
  const operations = [];
  const service = createService({
    projectService: {
      async createRuntime() {
        return {
          async archiveSessionSource(session, options = {}) {
            operations.push(`archive:${session.sessionId}:${options.reason}`);
            return {
              ok: true
            };
          },
          async compactClosedSessionIfNeeded(session) {
            operations.push(`compact:${session.sessionId}:${session.status}`);
          },
          async getSession(sessionId) {
            return {
              sessionId,
              status: operations.includes(`status:${sessionId}`)
                ? VIBE64_SESSION_STATUS.ABANDONED
                : VIBE64_SESSION_STATUS.ACTIVE
            };
          },
          async markSessionClosing(sessionId, options = {}) {
            operations.push(`closing:${sessionId}:${options.reason}`);
          },
          store: {
            async writeStatus(sessionId, status) {
              operations.push(`status:${sessionId}`);
              assert.equal(status, VIBE64_SESSION_STATUS.ABANDONED);
            }
          }
        };
      }
    },
    setupServices: readySetupServices(),
    terminalService: {
      async closeSessionTerminals(sessionId) {
        operations.push(`close:${sessionId}`);
        return {
          closed: 0,
          ok: true
        };
      }
    }
  });

  const result = await service.abandonSession("session-1");

  assert.equal(result.status, VIBE64_SESSION_STATUS.ABANDONED);
  assert.deepEqual(operations.slice(0, 3), [
    "closing:session-1:abandoned",
    "close:session-1",
    "archive:session-1:abandoned"
  ]);
  assert.equal(operations[3], "status:session-1");
  assert.equal(operations[4], "compact:session-1:abandoned");
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
          codexAgentTurn: {
            active: true,
            state: "active",
            status: "inProgress",
            turnId: "codex-app-server-turn-1"
          },
          codexAgentTurnActive: true,
          codexTerminal: {
            commandPreview: "codex",
            id: "codex-terminal-1",
            ...recentTerminalActivity(),
            status: "running"
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
  assert.equal(session.codexTerminal.transmitting, undefined);
  assert.equal(session.codexAgentTurnActive, true);
  assert.equal(session.codexAgentTurn.state, "active");
  assert.equal(session.codexAgentTurn.status, "inProgress");
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

test("session user message action observes an active Codex turn instead of starting another", async () => {
  let runActionCalls = 0;
  let injectCalls = 0;
  let userMessageWrites = 0;
  const activeSession = {
    agentRuns: [
      {
        active: true,
        id: "codex_app_server",
        providerStatus: "inProgress",
        state: "active"
      }
    ],
    codexAgentTurn: {
      active: true,
      state: "active",
      status: "inProgress",
      turnId: "codex-turn-active"
    },
    codexAgentTurnActive: true,
    sessionId: "session-active-agent",
    status: VIBE64_SESSION_STATUS.ACTIVE
  };
  const service = createService({
    projectService: {
      async createRuntime() {
        return {
          async getSession() {
            return activeSession;
          },
          async runAction() {
            runActionCalls += 1;
            return activeSession;
          },
          store: {
            async writeConversationUserMessage() {
              userMessageWrites += 1;
            }
          }
        };
      }
    },
    setupServices: readySetupServices(),
    terminalService: {
      async codexTerminalState(sessionId) {
        return {
          codexAgentTurn: activeSession.codexAgentTurn,
          codexAgentTurnActive: true,
          codexTerminal: null,
          ok: true,
          sessionId
        };
      },
      async injectCodexPrompt() {
        injectCalls += 1;
        return {
          ok: true
        };
      }
    }
  });

  const session = await service.runSessionAction("session-active-agent", "agent_conversation", {
    conversationRequest: "Please do another thing."
  });

  assert.equal(session.sessionId, "session-active-agent");
  assert.equal(session.codexAgentTurnActive, true);
  assert.equal(runActionCalls, 0);
  assert.equal(injectCalls, 0);
  assert.equal(userMessageWrites, 0);
});

test("session prompt action returns the app-server turn state from prompt delivery", async () => {
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
      async injectCodexPrompt() {
        return {
          codexAgentTurn: {
            active: true,
            state: "active",
            status: "inProgress",
            threadId: "codex-app-server-thread-1",
            turnId: "codex-app-server-turn-1"
          },
          codexAgentTurnActive: true,
          codexPromptInjected: true,
          ok: true,
          terminalSessionId: ""
        };
      },
      async codexTerminalState(sessionId) {
        return {
          codexTerminal: null,
          ok: true,
          sessionId
        };
      }
    }
  });

  const session = await service.runSessionAction("session-1", "agent_conversation", {
    conversationRequest: "Explain this codebase."
  });

  assert.equal(session.codexPromptDelivery.codexPromptInjected, true);
  assert.equal(session.codexAgentTurnActive, true);
  assert.equal(session.codexAgentTurn.state, "active");
  assert.equal(session.codexAgentTurn.status, "inProgress");
  assert.equal(session.codexAgentTurn.threadId, "codex-app-server-thread-1");
  assert.equal(session.codexAgentTurn.turnId, "codex-app-server-turn-1");
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

test("session prompt intent uses Vibe64 user for readiness without leaking it to workflow input", async () => {
  const statusInputs = [];
  let runtimeInput = null;
  const setupService = (id) => ({
    async getStatus(input) {
      statusInputs.push({
        id,
        input
      });
      return {
        ready: true
      };
    }
  });
  const vibe64User = {
    email: "owner@example.com"
  };
  const service = createService({
    projectService: {
      async createRuntime() {
        return {
          async runIntent(_sessionId, _intentId, input) {
            runtimeInput = input;
            return {
              sessionId: "session-1",
              status: VIBE64_SESSION_STATUS.FINISHED
            };
          }
        };
      }
    },
    setupServices: {
      connectionSetupService: setupService("connections"),
      projectSetupService: {
        async getStatus() {
          throw new Error("Project setup should not gate session prompt intents.");
        }
      },
      studioSetupService: setupService("studio-setup")
    }
  });

  await service.runSessionIntent("session-1", "accept_changes", {
    fields: {
      accepted: true
    },
    stepId: "implementation_reviewed",
    stepStatus: "done",
    vibe64User
  });

  assert.deepEqual(statusInputs, [
    {
      id: "connections",
      input: {
        connectionPurpose: VIBE64_CONNECTION_PURPOSE_SESSION,
        refresh: false,
        vibe64User
      }
    },
    {
      id: "studio-setup",
      input: {
        refresh: false,
        vibe64User
      }
    }
  ]);
  assert.deepEqual(runtimeInput, {
    fields: {
      accepted: true
    },
    stepId: "implementation_reviewed",
    stepStatus: "done"
  });
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

test("session service reads conversation logs through turn cursor pages", async () => {
  const pageReads = [];
  const service = createService({
    projectService: {
      async createRuntime() {
        return {
          async getSession(sessionId) {
            return {
              revision: 12,
              sessionId,
              status: VIBE64_SESSION_STATUS.ACTIVE
            };
          },
          store: {
            async readConversationLogPage(sessionId, options) {
              pageReads.push({
                options,
                sessionId
              });
              return {
                conversationLog: [
                  {
                    turnId: options.beforeTurnId ? "000004" : "000005",
                    user: {
                      role: "user",
                      text: options.beforeTurnId ? "Older." : "Latest."
                    }
                  }
                ],
                pagination: {
                  beforeTurnId: options.beforeTurnId,
                  count: 1,
                  hasMoreBefore: Boolean(!options.beforeTurnId),
                  limit: options.limit,
                  newestTurnId: options.beforeTurnId ? "000004" : "000005",
                  nextBeforeTurnId: options.beforeTurnId ? "" : "000005",
                  oldestTurnId: options.beforeTurnId ? "000004" : "000005",
                  totalTurnCount: 5
                }
              };
            }
          }
        };
      }
    },
    setupServices: readySetupServices()
  });

  const latest = await service.readSessionConversationLog("session-1");
  const older = await service.readSessionConversationLog("session-1", {
    beforeTurnId: "000005",
    limit: "2"
  });

  assert.deepEqual(pageReads, [
    {
      options: {
        beforeTurnId: "",
        limit: 5
      },
      sessionId: "session-1"
    },
    {
      options: {
        beforeTurnId: "000005",
        limit: 2
      },
      sessionId: "session-1"
    }
  ]);
  assert.equal(latest.pagination.hasMoreBefore, true);
  assert.deepEqual(latest.conversationLog.map((turn) => turn.user.text), ["Latest."]);
  assert.equal(older.pagination.hasMoreBefore, false);
  assert.deepEqual(older.conversationLog.map((turn) => turn.user.text), ["Older."]);
});

test("session service records display fields while preserving runtime attachment references", async () => {
  const codexText = [
    "Please read this.",
    "",
    "Attached files for Codex:",
    "- BP2026011539178.pdf (89.7 KB): /studio-attachments/session/BP2026011539178.pdf"
  ].join("\n");
  const displayText = [
    "Please read this.",
    "",
    "BP2026011539178.pdf"
  ].join("\n");
  let runtimeInput = null;
  const conversationLog = [];
  const service = createService({
    projectService: {
      async createRuntime() {
        return {
          async runIntent(sessionId, intentId, input) {
            runtimeInput = input;
            return {
              actionResult: {
                actionId: intentId,
                input,
                recordsConversationTurn: true,
                status: "completed"
              },
              sessionId,
              status: VIBE64_SESSION_STATUS.ACTIVE
            };
          },
          store: {
            async writeConversationUserMessage(_sessionId, {
              text
            }) {
              conversationLog.push(text);
              return {
                user: {
                  text
                }
              };
            }
          }
        };
      }
    },
    setupServices: readySetupServices()
  });

  await service.runSessionIntent("session-1", "answer_question", {
    displayFields: {
      conversationRequest: displayText
    },
    fields: {
      conversationRequest: codexText
    },
    stepId: "maintenance_conversation",
    stepStatus: "ready"
  });

  assert.deepEqual(runtimeInput, {
    fields: {
      conversationRequest: codexText
    },
    stepId: "maintenance_conversation",
    stepStatus: "ready"
  });
  assert.deepEqual(conversationLog, [displayText]);
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
          error: "Codex app-server control is unavailable.",
          ok: false
        };
      }
    }
  });

  const result = await service.runSessionAction("session-1", "agent_conversation");

  assert.equal(result.ok, false);
  assert.equal(result.error, "Codex app-server control is unavailable.");
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
          codexAgentTurn: {
            active: true,
            state: "active",
            status: "inProgress",
            turnId: "codex-app-server-turn-2"
          },
          codexAgentTurnActive: true,
          codexTerminal: {
            commandPreview: "codex",
            id: "codex-terminal-active",
            ...recentTerminalActivity(),
            status: "running"
          },
          ok: true,
          sessionId
        };
      }
    }
  });

  const session = await service.inspectSession("session-1", {
    includeRuntimeEnrichment: true
  });

  assert.equal(session.codexTerminal.id, "codex-terminal-active");
  assert.equal(session.codexTerminal.transmitting, undefined);
  assert.equal(session.codexAgentTurnActive, true);
  assert.equal(session.codexAgentTurn.turnId, "codex-app-server-turn-2");
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
                source_path: "/workspace/vibe64-local-editor/state/projects/project-test/sessions/active/session-1/source"
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
            status: "running"
          },
          ok: true,
          sessionId
        };
      }
    }
  });

  const session = await service.inspectSession("session-1", {
    includeRuntimeEnrichment: true
  });

  assert.deepEqual(preparedSessions, []);
  assert.equal(session.codexTerminal.id, "codex-terminal-restored");
});

test("session inspect scopes project runtime to the inspected session source", async () => {
  const createRuntimeOptions = [];
  const service = createService({
    projectService: {
      async createRuntime(options = {}) {
        createRuntimeOptions.push(options);
        return {
          async getSession(sessionId) {
            return {
              presentation: {},
              sessionId,
              status: VIBE64_SESSION_STATUS.ACTIVE
            };
          }
        };
      }
    },
    setupServices: readySetupServices()
  });

  const session = await service.inspectSession("session-1");

  assert.equal(session.sessionId, "session-1");
  assert.equal(createRuntimeOptions.length, 1);
  assert.equal(createRuntimeOptions[0].sessionId, "session-1");
});

test("session inspect returns persisted controls without runtime enrichment", async () => {
  let codexTerminalStateCalls = 0;
  const service = createService({
    projectService: {
      async createRuntime() {
        return {
          async getSession(sessionId) {
            return {
              actions: [
                {
                  enabled: true,
                  id: "create_pr_on_gh",
                  label: "Create PR on GH"
                }
              ],
              currentStep: "create_pull_request",
              presentation: {
                screen: {
                  input: {
                    fields: [
                      {
                        kind: "text",
                        name: "title",
                        value: "Seed nbi-tools empty sign-in app"
                      },
                      {
                        kind: "textarea",
                        name: "body",
                        value: "## Summary"
                      }
                    ],
                    submitLabel: "Save draft"
                  },
                  kind: "input"
                }
              },
              sessionId,
              status: VIBE64_SESSION_STATUS.ACTIVE,
              stepMachine: {
                status: "waiting_for_input",
                stepId: "create_pull_request"
              }
            };
          }
        };
      }
    },
    terminalService: {
      async codexTerminalState() {
        codexTerminalStateCalls += 1;
        throw new Error("Default inspect must not wait for Codex terminal state.");
      }
    }
  });

  const session = await service.inspectSession("session-1");

  assert.equal(codexTerminalStateCalls, 0);
  assert.equal(session.currentStep, "create_pull_request");
  assert.equal(session.actions[0].id, "create_pr_on_gh");
  assert.equal(session.presentation.screen.input.fields[0].name, "title");
  assert.equal(session.presentation.screen.input.fields[1].name, "body");
  assert.equal(session.runtimeReadiness.terminalReconnect.state, "idle");
  assert.equal(session.runtimeReadiness.terminalReconnect.source, "persisted_session");
});

test("session inspect returns background task updates from terminal state reconciliation", async () => {
  let getSessionCalls = 0;
  const failedSession = {
    presentation: {
      backgroundTasks: [
        {
          error: "no rollout found for thread id stale-codex-thread",
          id: "codex_context",
          message: "Previous Codex context could not be resumed.",
          status: "failed"
        },
        {
          error: "",
          id: "codex_app_server",
          message: "Codex is ready.",
          status: "ready"
        }
      ],
      screen: {
        kind: "input"
      }
    },
    sessionId: "session-1",
    status: VIBE64_SESSION_STATUS.ACTIVE
  };
  const reconciledSession = {
    ...failedSession,
    presentation: {
      ...failedSession.presentation,
      backgroundTasks: failedSession.presentation.backgroundTasks.map((task) => (
        task.id === "codex_context"
          ? {
              ...task,
              error: "",
              message: "Codex context recovered with a fresh Codex thread.",
              status: "ready"
            }
          : task
      ))
    }
  };
  const service = createService({
    projectService: {
      async createRuntime() {
        return {
          async getSession() {
            getSessionCalls += 1;
            return getSessionCalls === 1 ? failedSession : reconciledSession;
          }
        };
      }
    },
    terminalService: {
      async codexTerminalState(sessionId) {
        return {
          codexTerminal: {
            commandPreview: "codex",
            id: "codex-terminal-restored",
            status: "running"
          },
          ok: true,
          sessionId,
          sessionUpdated: true
        };
      }
    }
  });

  const session = await service.inspectSession("session-1", {
    includeRuntimeEnrichment: true
  });
  const codexContextTask = session.presentation.backgroundTasks.find((task) => task.id === "codex_context");

  assert.equal(getSessionCalls, 2);
  assert.equal(codexContextTask?.status, "ready");
  assert.equal(codexContextTask?.error, "");
});

test("session inspect disables controls when session readiness is blocked", async () => {
  let connectionStatusInput = null;
  let runtimeOptions = null;
  const disabledReason = "Codex connection is not ready.";
  const service = createService({
    projectService: {
      async createRuntime(options = {}) {
        runtimeOptions = options;
        return {
          async getSession(sessionId) {
            return {
              actions: [
                {
                  enabled: true,
                  id: "agent_conversation",
                  label: "Ask Codex"
                }
              ],
              intents: [
                {
                  actionId: "agent_conversation",
                  enabled: true,
                  id: "talk_to_codex",
                  label: "Ask Codex"
                }
              ],
              next: {
                enabled: true,
                label: "Next step",
                stepId: "local_session_finished",
                visible: true
              },
              presentation: {
                auto: {
                  nextOperation: {
                    actionId: "agent_conversation",
                    executable: true,
                    id: "session_action:agent_conversation",
                    kind: "action",
                    label: "Ask Codex",
                    route: "session_action"
                  }
                },
                intents: [
                  {
                    actionId: "agent_conversation",
                    enabled: true,
                    id: "talk_to_codex",
                    label: "Ask Codex"
                  },
                  {
                    enabled: true,
                    id: "continue_step",
                    label: "Next step"
                  }
                ],
                next: {
                  enabled: true,
                  label: "Next step",
                  stepId: "local_session_finished",
                  visible: true
                },
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
    setupServices: {
      connectionSetupService: {
        async getStatus(input = {}) {
          connectionStatusInput = input;
          return {
            blockedReason: disabledReason,
            ready: false
          };
        }
      },
      studioSetupService: {
        async getStatus() {
          return {
            ready: true
          };
        }
      }
    }
  });

  const session = await service.inspectSession("session-1", {
    vibe64User: {
      email: "owner@example.com"
    }
  });

  assert.deepEqual(connectionStatusInput, {
    connectionPurpose: VIBE64_CONNECTION_PURPOSE_SESSION,
    refresh: false,
    vibe64User: {
      email: "owner@example.com"
    }
  });
  assert.equal(typeof runtimeOptions.actionReadiness, "function");
  assert.deepEqual(runtimeOptions.actionReadiness({
    action: {
      id: "agent_conversation"
    },
    session: {}
  }), {
    disabledReason,
    enabled: false
  });
  assert.equal(session.actions[0].enabled, false);
  assert.equal(session.actions[0].disabledReason, disabledReason);
  assert.equal(session.intents[0].enabled, false);
  assert.equal(session.intents[0].disabledReason, disabledReason);
  assert.equal(session.next.enabled, false);
  assert.equal(session.next.disabledReason, disabledReason);
  assert.equal(session.presentation.intents[0].enabled, false);
  assert.equal(session.presentation.intents[0].disabledReason, disabledReason);
  assert.equal(session.presentation.intents[1].enabled, false);
  assert.equal(session.presentation.intents[1].disabledReason, disabledReason);
  assert.equal(session.presentation.next.enabled, false);
  assert.equal(session.presentation.auto.nextOperation.executable, false);
  assert.equal(session.presentation.auto.nextOperation.kind, "stop");
  assert.equal(session.presentation.auto.nextOperation.reason, disabledReason);
});

test("session presentation hides the Codex preview when the app-server turn is idle", async () => {
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
          codexAgentTurn: {
            active: false,
            state: "idle"
          },
          codexAgentTurnActive: false,
          codexTerminal: {
            commandPreview: "codex",
            id: "codex-terminal-idle",
            status: "running"
          },
          ok: true,
          sessionId
        };
      }
    }
  });

  const session = await service.inspectSession("session-1", {
    includeRuntimeEnrichment: true
  });

  assert.deepEqual(session.presentation.terminal.codex, {
    label: "",
    readOnlyInAutopilot: true,
    renderer: "codex_terminal",
    terminalSessionId: "codex-terminal-idle",
    visible: false,
    visibleUntil: ""
  });
});

test("session inspect returns control when an agent wait has no active Codex turn", async () => {
  let returnControlCalls = 0;
  const session = {
    backgroundTasks: [
      {
        id: "codex_app_server",
        status: "ready"
      }
    ],
    presentation: {
      screen: {
        kind: "codex_running"
      }
    },
    sessionId: "session-stale-agent-wait",
    status: VIBE64_SESSION_STATUS.ACTIVE,
    stepMachine: {
      status: "awaiting_agent_result"
    }
  };
  const service = createService({
    projectService: {
      async createRuntime() {
        return {
          async getSession() {
            return session;
          },
          async returnControlFromAgentWait(_sessionId, input = {}) {
            returnControlCalls += 1;
            session.returnControlInput = input;
            session.stepMachine = {
              status: "waiting_for_input"
            };
            return session;
          }
        };
      }
    },
    terminalService: {
      async codexTerminalState(sessionId) {
        return {
          codexAgentTurn: {
            active: false,
            state: "idle",
            status: "completed"
          },
          codexAgentTurnActive: false,
          ok: true,
          sessionId
        };
      }
    }
  });

  const inspected = await service.inspectSession("session-stale-agent-wait", {
    includeRuntimeEnrichment: true
  });

  assert.equal(returnControlCalls, 1);
  assert.equal(inspected.stepMachine.status, "waiting_for_input");
  assert.equal(inspected.returnControlInput.inputPrompt, "What would you like to do next?");
});

test("session inspect does not return control while a prompt handoff run is active", async () => {
  let getSessionCalls = 0;
  let returnControlCalls = 0;
  const staleSession = {
    backgroundTasks: [
      {
        id: "codex_app_server",
        status: "ready"
      }
    ],
    currentStep: "seed_plan_made",
    presentation: {
      screen: {
        kind: "codex_running"
      }
    },
    sessionId: "session-prompt-handoff-race",
    status: VIBE64_SESSION_STATUS.ACTIVE,
    stepMachine: {
      status: "awaiting_agent_result"
    }
  };
  const latestSession = {
    ...staleSession,
    actionResults: [
      {
        actionId: "make_seed_plan",
        at: new Date().toISOString(),
        codexPromptHandoff: {
          kind: "codex_prompt_handoff",
          promptId: "make_seed_plan"
        },
        status: "prompt_ready",
        stepId: "seed_plan_made"
      }
    ],
    agentRuns: [
      {
        active: true,
        id: "codex_app_server",
        state: "starting"
      }
    ]
  };
  const service = createService({
    projectService: {
      async createRuntime() {
        return {
          async getSession() {
            getSessionCalls += 1;
            return getSessionCalls === 1 ? staleSession : latestSession;
          },
          async returnControlFromAgentWait() {
            returnControlCalls += 1;
            return {
              ...latestSession,
              stepMachine: {
                status: "waiting_for_input"
              }
            };
          }
        };
      }
    },
    terminalService: {
      async codexTerminalState(sessionId) {
        return {
          codexAgentTurn: {
            active: false,
            state: "idle",
            status: "completed"
          },
          codexAgentTurnActive: false,
          ok: true,
          sessionId
        };
      }
    }
  });

  const inspected = await service.inspectSession("session-prompt-handoff-race", {
    includeRuntimeEnrichment: true
  });

  assert.equal(returnControlCalls, 0);
  assert.equal(inspected.stepMachine.status, "awaiting_agent_result");
  assert.equal(getSessionCalls, 2);
});

test("session inspect returns control after an abandoned app-server prompt claim", async () => {
  let returnControlCalls = 0;
  let writeAgentRunCalls = 0;
  const session = {
    actionResults: [
      {
        actionId: "make_seed_plan",
        at: "2026-06-25T14:46:18.500Z",
        codexPromptHandoff: {
          kind: "codex_prompt_handoff",
          promptId: "make_seed_plan"
        },
        status: "prompt_ready",
        stepId: "seed_plan_made"
      }
    ],
    agentRuns: [
      {
        active: true,
        id: "codex_app_server",
        provider: "codex",
        providerInterface: "app-server",
        providerStatus: "starting",
        providerThreadId: "",
        providerTurnId: "",
        state: VIBE64_AGENT_RUN_STATE.STARTING,
        stepStatus: "awaiting_agent_result",
        updatedAt: "2026-06-25T14:46:18.757Z"
      }
    ],
    backgroundTasks: [
      {
        id: "codex_app_server",
        status: "ready",
        updatedAt: "2026-06-25T14:47:18.326Z"
      }
    ],
    currentStep: "seed_plan_made",
    presentation: {
      screen: {
        kind: "codex_running"
      }
    },
    sessionId: "session-abandoned-prompt-claim",
    status: VIBE64_SESSION_STATUS.ACTIVE,
    stepMachine: {
      at: "2026-06-25T14:46:18.500Z",
      promptActionId: "make_seed_plan",
      status: "awaiting_agent_result"
    }
  };
  const service = createService({
    projectService: {
      async createRuntime() {
        return {
          async getSession() {
            return session;
          },
          async returnControlFromAgentWait(_sessionId, input = {}) {
            returnControlCalls += 1;
            session.returnControlInput = input;
            session.stepMachine = {
              status: "waiting_for_input"
            };
            return session;
          },
          store: {
            async writeAgentRunEvent(_sessionId, runId, {
              event = {},
              patch = {}
            } = {}) {
              writeAgentRunCalls += 1;
              assert.equal(runId, "codex_app_server");
              const run = session.agentRuns[0];
              Object.assign(run, patch, {
                active: false,
                events: [
                  ...(Array.isArray(run.events) ? run.events : []),
                  event
                ],
                id: runId
              });
              return run;
            }
          }
        };
      }
    },
    terminalService: {
      async codexTerminalState(sessionId) {
        return {
          codexAgentTurn: {
            active: false,
            state: "idle",
            status: "completed"
          },
          codexAgentTurnActive: false,
          ok: true,
          sessionId
        };
      }
    }
  });

  const inspected = await service.inspectSession("session-abandoned-prompt-claim", {
    includeRuntimeEnrichment: true
  });

  assert.equal(writeAgentRunCalls, 1);
  assert.equal(returnControlCalls, 1);
  assert.equal(session.agentRuns[0].state, VIBE64_AGENT_RUN_STATE.FAILED);
  assert.equal(session.agentRuns[0].active, false);
  assert.equal(inspected.stepMachine.status, "waiting_for_input");
  assert.equal(
    inspected.returnControlInput.message,
    "Codex is no longer running for this turn, so Vibe64 returned control to you."
  );
});

test("session inspect reports missing result when a tracked Codex turn completed without control", async () => {
  let returnControlCalls = 0;
  const session = {
    backgroundTasks: [
      {
        id: "codex_app_server",
        status: "ready"
      }
    ],
    presentation: {
      screen: {
        kind: "codex_running"
      }
    },
    sessionId: "session-completed-agent-turn-without-result",
    status: VIBE64_SESSION_STATUS.ACTIVE,
    stepMachine: {
      status: "awaiting_agent_result"
    }
  };
  const service = createService({
    projectService: {
      async createRuntime() {
        return {
          async getSession() {
            return session;
          },
          async returnControlFromAgentWait(_sessionId, input = {}) {
            returnControlCalls += 1;
            session.returnControlInput = input;
            session.stepMachine = {
              status: "waiting_for_input"
            };
            return session;
          }
        };
      }
    },
    terminalService: {
      async codexTerminalState(sessionId) {
        return {
          codexAgentTurn: {
            active: false,
            state: "idle",
            status: "completed",
            threadId: "codex-thread-completed",
            turnId: "codex-turn-completed"
          },
          codexAgentTurnActive: false,
          ok: true,
          sessionId
        };
      }
    }
  });

  const inspected = await service.inspectSession("session-completed-agent-turn-without-result", {
    includeRuntimeEnrichment: true
  });

  assert.equal(returnControlCalls, 1);
  assert.equal(inspected.stepMachine.status, "waiting_for_input");
  assert.match(inspected.returnControlInput.inputPrompt, /did not receive the assistant result text/u);
  assert.match(inspected.returnControlInput.message, /did not receive the assistant result text/u);
});

test("session inspect returns control when Codex terminal state cannot be read", async () => {
  let returnControlCalls = 0;
  const session = {
    backgroundTasks: [
      {
        id: "codex_app_server",
        status: "ready"
      }
    ],
    sessionId: "session-stale-agent-wait-terminal-state-error",
    status: VIBE64_SESSION_STATUS.ACTIVE,
    stepMachine: {
      status: "awaiting_agent_result"
    }
  };
  const service = createService({
    projectService: {
      async createRuntime() {
        return {
          async getSession() {
            return session;
          },
          async returnControlFromAgentWait(_sessionId, input = {}) {
            returnControlCalls += 1;
            session.returnControlInput = input;
            session.stepMachine = {
              status: "waiting_for_input"
            };
            return session;
          }
        };
      }
    },
    terminalService: {
      async codexTerminalState() {
        return {
          error: "Terminal session not found.",
          ok: false
        };
      }
    }
  });

  const inspected = await service.inspectSession("session-stale-agent-wait-terminal-state-error", {
    includeRuntimeEnrichment: true
  });

  assert.equal(returnControlCalls, 1);
  assert.equal(inspected.stepMachine.status, "waiting_for_input");
  assert.equal(inspected.returnControlInput.message, "Codex is no longer running for this turn, so Vibe64 returned control to you.");
});

test("session inspect keeps agent wait while Codex delivery is running", async () => {
  let returnControlCalls = 0;
  const service = createService({
    projectService: {
      async createRuntime() {
        return {
          async getSession(sessionId) {
            return {
              backgroundTasks: [
                {
                  id: "codex_app_server",
                  status: "running"
                }
              ],
              sessionId,
              status: VIBE64_SESSION_STATUS.ACTIVE,
              stepMachine: {
                status: "awaiting_agent_result"
              }
            };
          },
          async returnControlFromAgentWait() {
            returnControlCalls += 1;
          }
        };
      }
    },
    terminalService: {
      async codexTerminalState(sessionId) {
        return {
          codexAgentTurnActive: false,
          ok: true,
          sessionId
        };
      }
    }
  });

  const inspected = await service.inspectSession("session-running-delivery", {
    includeRuntimeEnrichment: true
  });

  assert.equal(returnControlCalls, 0);
  assert.equal(inspected.stepMachine.status, "awaiting_agent_result");
});

test("session inspect keeps agent wait after prompt handoff before Codex turn is visible", async () => {
  let returnControlCalls = 0;
  const service = createService({
    projectService: {
      async createRuntime() {
        return {
          async getSession(sessionId) {
            return {
              actionResults: [
                {
                  actionId: "define_seed_application",
                  codexPromptHandoff: {
                    kind: "codex_prompt_handoff"
                  },
                  status: "prompt_ready",
                  stepId: "seed_application_defined"
                }
              ],
              currentStep: "seed_application_defined",
              sessionId,
              status: VIBE64_SESSION_STATUS.ACTIVE,
              stepMachine: {
                promptActionId: "define_seed_application",
                status: "awaiting_agent_result"
              }
            };
          },
          async returnControlFromAgentWait() {
            returnControlCalls += 1;
          }
        };
      }
    },
    terminalService: {
      async codexTerminalState(sessionId) {
        return {
          codexAgentTurnActive: false,
          ok: true,
          sessionId
        };
      }
    }
  });

  const inspected = await service.inspectSession("session-accepted-prompt-wait", {
    includeRuntimeEnrichment: true
  });

  assert.equal(returnControlCalls, 0);
  assert.equal(inspected.stepMachine.status, "awaiting_agent_result");
});

test("session inspect returns control when prompt handoff fails after the agent wait starts", async () => {
  let returnControlCalls = 0;
  const session = {
    actionResults: [
      {
        actionId: "define_seed_application",
        codexPromptHandoff: {
          kind: "codex_prompt_handoff"
        },
        status: "prompt_ready",
        stepId: "seed_application_defined"
      }
    ],
    backgroundTasks: [
      {
        id: "codex_app_server",
        status: "failed",
        updatedAt: "2026-06-21T04:54:47.835Z"
      }
    ],
    currentStep: "seed_application_defined",
    sessionId: "session-prompt-handoff-failed",
    status: VIBE64_SESSION_STATUS.ACTIVE,
    stepMachine: {
      at: "2026-06-21T04:54:00.000Z",
      promptActionId: "define_seed_application",
      status: "awaiting_agent_result"
    }
  };
  const service = createService({
    projectService: {
      async createRuntime() {
        return {
          async getSession() {
            return session;
          },
          async returnControlFromAgentWait(_sessionId, input = {}) {
            returnControlCalls += 1;
            session.returnControlInput = input;
            session.stepMachine = {
              status: "waiting_for_input"
            };
            return session;
          }
        };
      }
    },
    terminalService: {
      async codexTerminalState(sessionId) {
        return {
          codexAgentTurnActive: false,
          ok: true,
          sessionId
        };
      }
    }
  });

  const inspected = await service.inspectSession("session-prompt-handoff-failed", {
    includeRuntimeEnrichment: true
  });

  assert.equal(returnControlCalls, 1);
  assert.equal(inspected.stepMachine.status, "waiting_for_input");
  assert.equal(inspected.returnControlInput.inputPrompt, "What would you like to do next?");
});

test("session inspect keeps agent wait when only stale Codex failure predates the current prompt", async () => {
  let returnControlCalls = 0;
  const service = createService({
    projectService: {
      async createRuntime() {
        return {
          async getSession(sessionId) {
            return {
              actionResults: [
                {
                  actionId: "define_seed_application",
                  codexPromptHandoff: {
                    kind: "codex_prompt_handoff"
                  },
                  status: "prompt_ready",
                  stepId: "seed_application_defined"
                }
              ],
              backgroundTasks: [
                {
                  id: "codex_app_server",
                  status: "failed",
                  updatedAt: "2026-06-21T04:53:00.000Z"
                }
              ],
              currentStep: "seed_application_defined",
              sessionId,
              status: VIBE64_SESSION_STATUS.ACTIVE,
              stepMachine: {
                at: "2026-06-21T04:54:00.000Z",
                promptActionId: "define_seed_application",
                status: "awaiting_agent_result"
              }
            };
          },
          async returnControlFromAgentWait() {
            returnControlCalls += 1;
          }
        };
      }
    },
    terminalService: {
      async codexTerminalState(sessionId) {
        return {
          codexAgentTurnActive: false,
          ok: true,
          sessionId
        };
      }
    }
  });

  const inspected = await service.inspectSession("session-stale-prompt-handoff-failure", {
    includeRuntimeEnrichment: true
  });

  assert.equal(returnControlCalls, 0);
  assert.equal(inspected.stepMachine.status, "awaiting_agent_result");
});

test("session inspect keeps agent wait after prompt action starts before handoff is visible", async () => {
  let returnControlCalls = 0;
  const service = createService({
    projectService: {
      async createRuntime() {
        return {
          async getSession(sessionId) {
            return {
              currentStep: "seed_application_defined",
              sessionId,
              status: VIBE64_SESSION_STATUS.ACTIVE,
              stepMachine: {
                promptActionId: "define_seed_application",
                status: "awaiting_agent_result"
              }
            };
          },
          async returnControlFromAgentWait() {
            returnControlCalls += 1;
          }
        };
      }
    },
    terminalService: {
      async codexTerminalState(sessionId) {
        return {
          codexAgentTurnActive: false,
          ok: true,
          sessionId
        };
      }
    }
  });

  const inspected = await service.inspectSession("session-started-prompt-wait", {
    includeRuntimeEnrichment: true
  });

  assert.equal(returnControlCalls, 0);
  assert.equal(inspected.stepMachine.status, "awaiting_agent_result");
});

test("session inspect keeps agent wait while a durable agent run is active", async () => {
  let returnControlCalls = 0;
  const service = createService({
    projectService: {
      async createRuntime() {
        return {
          async getSession(sessionId) {
            return {
              agentRuns: [
                {
                  active: true,
                  id: "codex_app_server",
                  provider: "codex",
                  providerInterface: "app-server",
                  state: "active"
                }
              ],
              backgroundTasks: [
                {
                  id: "codex_app_server",
                  status: "ready"
                }
              ],
              sessionId,
              status: VIBE64_SESSION_STATUS.ACTIVE,
              stepMachine: {
                status: "awaiting_agent_result"
              }
            };
          },
          async returnControlFromAgentWait() {
            returnControlCalls += 1;
          }
        };
      }
    },
    terminalService: {
      async codexTerminalState(sessionId) {
        return {
          codexAgentTurn: {
            active: false,
            state: "idle",
            status: "completed"
          },
          codexAgentTurnActive: false,
          ok: true,
          sessionId
        };
      }
    }
  });

  const inspected = await service.inspectSession("session-active-agent-run", {
    includeRuntimeEnrichment: true
  });

  assert.equal(returnControlCalls, 0);
  assert.equal(inspected.stepMachine.status, "awaiting_agent_result");
});

test("session inspect keeps agent wait while Codex app-server result is finalizing", async () => {
  let returnControlCalls = 0;
  const service = createService({
    projectService: {
      async createRuntime() {
        return {
          async getSession(sessionId) {
            return {
              backgroundTasks: [
                {
                  id: "codex_app_server",
                  status: "ready"
                }
              ],
              sessionId,
              status: VIBE64_SESSION_STATUS.ACTIVE,
              stepMachine: {
                status: "awaiting_agent_result"
              }
            };
          },
          async returnControlFromAgentWait() {
            returnControlCalls += 1;
          }
        };
      }
    },
    terminalService: {
      async codexTerminalState(sessionId) {
        return {
          codexAgentTurn: {
            active: true,
            state: "finalizing",
            status: "completed"
          },
          codexAgentTurnActive: true,
          ok: true,
          sessionId
        };
      }
    }
  });

  const inspected = await service.inspectSession("session-finalizing-agent-result", {
    includeRuntimeEnrichment: true
  });

  assert.equal(returnControlCalls, 0);
  assert.equal(inspected.stepMachine.status, "awaiting_agent_result");
});

test("session action returns control when Codex prompt delivery fails", async () => {
  let returnControlCalls = 0;
  const session = {
    actionResult: {
      codexPromptHandoff: {
        kind: "codex_prompt_handoff",
        terminalInput: "Ask Codex this."
      }
    },
    sessionId: "session-delivery-failure",
    status: VIBE64_SESSION_STATUS.ACTIVE,
    stepMachine: {
      status: "awaiting_agent_result"
    }
  };
  const service = createService({
    projectService: {
      async createRuntime() {
        return {
          async runAction() {
            return session;
          },
          async returnControlFromAgentWait(_sessionId, input = {}) {
            returnControlCalls += 1;
            session.returnControlInput = input;
            session.stepMachine = {
              status: "waiting_for_input"
            };
            return session;
          }
        };
      }
    },
    setupServices: readySetupServices(),
    terminalService: {
      async injectCodexPrompt() {
        return {
          error: "Codex app-server preparation failed.",
          ok: false
        };
      }
    }
  });

  const result = await service.runSessionAction("session-delivery-failure", "agent_conversation", {
    fields: {
      conversationRequest: "Hello"
    }
  });

  assert.equal(result.ok, false);
  assert.equal(returnControlCalls, 1);
  assert.equal(session.stepMachine.status, "waiting_for_input");
  assert.equal(session.returnControlInput.inputPrompt, "What would you like to do next?");
});

test("session action observes active Codex turn when prompt delivery is already claimed", async () => {
  let returnControlCalls = 0;
  const session = {
    actionResult: {
      codexPromptHandoff: {
        kind: "codex_prompt_handoff",
        terminalInput: "Ask Codex this."
      }
    },
    agentRuns: [
      {
        active: true,
        id: "codex_app_server",
        state: "active"
      }
    ],
    sessionId: "session-delivery-claimed",
    status: VIBE64_SESSION_STATUS.ACTIVE,
    stepMachine: {
      status: "awaiting_agent_result"
    }
  };
  const activeTurn = {
    active: true,
    state: "active",
    status: "inProgress",
    threadId: "codex-thread-claimed",
    turnId: "codex-turn-claimed"
  };
  const service = createService({
    projectService: {
      async createRuntime() {
        return {
          async getSession() {
            return session;
          },
          async runAction() {
            return session;
          },
          async returnControlFromAgentWait() {
            returnControlCalls += 1;
            session.stepMachine = {
              status: "waiting_for_input"
            };
            return session;
          },
          store: {
            async writeConversationUserMessage() {
              return {};
            }
          }
        };
      }
    },
    setupServices: readySetupServices(),
    terminalService: {
      async codexTerminalState(sessionId) {
        return {
          codexAgentTurn: activeTurn,
          codexAgentTurnActive: true,
          codexTerminal: null,
          ok: true,
          sessionId
        };
      },
      async injectCodexPrompt() {
        return {
          code: "vibe64_agent_turn_already_running",
          codexAgentTurn: activeTurn,
          codexAgentTurnActive: true,
          error: "Codex is already working on this Vibe64 session.",
          ok: false,
          operationOutcome: "agent_already_running",
          refreshRecommended: true
        };
      }
    }
  });

  const result = await service.runSessionAction("session-delivery-claimed", "agent_conversation", {
    fields: {
      conversationRequest: "Hello again"
    }
  });

  assert.equal(result.sessionId, "session-delivery-claimed");
  assert.notEqual(result.ok, false);
  assert.equal(result.codexAgentTurnActive, true);
  assert.equal(result.codexAgentTurn.turnId, "codex-turn-claimed");
  assert.equal(returnControlCalls, 0);
  assert.equal(session.stepMachine.status, "awaiting_agent_result");
});

test("session prompt action observes accepted agent wait before duplicate action runs", async () => {
  let runActionCalls = 0;
  let returnControlCalls = 0;
  const session = {
    actionResults: [
      {
        actionId: "make_seed_plan",
        codexPromptHandoff: {
          kind: "codex_prompt_handoff"
        },
        status: "prompt_ready"
      }
    ],
    sessionId: "session-accepted-prompt-action",
    status: VIBE64_SESSION_STATUS.ACTIVE,
    stepMachine: {
      status: "awaiting_agent_result"
    }
  };
  const service = createService({
    projectService: {
      async createRuntime() {
        return {
          async getSession() {
            return session;
          },
          async runAction() {
            runActionCalls += 1;
            throw new Error("runAction should not be called for an accepted prompt action.");
          },
          async returnControlFromAgentWait() {
            returnControlCalls += 1;
            return session;
          }
        };
      }
    },
    setupServices: readySetupServices(),
    terminalService: {
      async codexTerminalState() {
        throw new Error("codexTerminalState should not recover an accepted prompt action wait.");
      }
    }
  });

  const result = await service.runSessionAction("session-accepted-prompt-action", "make_seed_plan");

  assert.equal(result.sessionId, "session-accepted-prompt-action");
  assert.notEqual(result.ok, false);
  assert.equal(result.stepMachine.status, "awaiting_agent_result");
  assert.equal(runActionCalls, 0);
  assert.equal(returnControlCalls, 0);
});

test("session prompt action observes accepted agent wait after runtime state rejection", async () => {
  let runActionCalls = 0;
  let returnControlCalls = 0;
  const session = {
    actionResults: [],
    sessionId: "session-accepted-prompt-action-after-rejection",
    status: VIBE64_SESSION_STATUS.ACTIVE,
    stepMachine: {
      status: "waiting_for_input"
    }
  };
  const service = createService({
    projectService: {
      async createRuntime() {
        return {
          async getSession() {
            return session;
          },
          async runAction() {
            runActionCalls += 1;
            session.actionResults = [
              {
                actionId: "make_seed_plan",
                codexPromptHandoff: {
                  kind: "codex_prompt_handoff"
                },
                status: "prompt_ready"
              }
            ];
            session.stepMachine = {
              status: "awaiting_agent_result"
            };
            const error = new Error("Wait for Codex to finish this step.");
            error.code = "vibe64_action_disabled";
            error.stepStatus = "awaiting_agent_result";
            throw error;
          },
          async returnControlFromAgentWait() {
            returnControlCalls += 1;
            return session;
          }
        };
      }
    },
    setupServices: readySetupServices(),
    terminalService: {
      async codexTerminalState() {
        throw new Error("codexTerminalState should not recover an accepted prompt action wait.");
      }
    }
  });

  const result = await service.runSessionAction("session-accepted-prompt-action-after-rejection", "make_seed_plan");

  assert.equal(result.sessionId, "session-accepted-prompt-action-after-rejection");
  assert.notEqual(result.ok, false);
  assert.equal(result.stepMachine.status, "awaiting_agent_result");
  assert.equal(runActionCalls, 1);
  assert.equal(returnControlCalls, 0);
});

test("session user message action observes accepted agent wait before Codex turn is visible", async () => {
  let codexTerminalStateCalls = 0;
  let returnControlCalls = 0;
  let runActionCalls = 0;
  const session = {
    sessionId: "session-accepted-agent-wait",
    status: VIBE64_SESSION_STATUS.ACTIVE,
    stepMachine: {
      status: "awaiting_agent_result"
    }
  };
  const service = createService({
    projectService: {
      async createRuntime() {
        return {
          async getSession() {
            return session;
          },
          async runAction() {
            runActionCalls += 1;
            throw new Error("runAction should not be called for an accepted user message.");
          },
          async returnControlFromAgentWait() {
            returnControlCalls += 1;
            session.stepMachine = {
              status: "waiting_for_input"
            };
            return session;
          }
        };
      }
    },
    setupServices: readySetupServices(),
    terminalService: {
      async codexTerminalState() {
        codexTerminalStateCalls += 1;
        return {
          ok: true
        };
      }
    }
  });

  const result = await service.runSessionAction("session-accepted-agent-wait", "draft_issue", {
    conversationRequest: "Duplicate while first prompt is still being delivered."
  });

  assert.equal(result.sessionId, "session-accepted-agent-wait");
  assert.notEqual(result.ok, false);
  assert.equal(result.stepMachine.status, "awaiting_agent_result");
  assert.equal(runActionCalls, 0);
  assert.equal(returnControlCalls, 0);
  assert.equal(codexTerminalStateCalls, 0);
});

test("session user message action observes accepted agent wait after runtime state rejection", async () => {
  let runActionCalls = 0;
  let returnControlCalls = 0;
  const session = {
    sessionId: "session-accepted-agent-wait-after-rejection",
    status: VIBE64_SESSION_STATUS.ACTIVE,
    stepMachine: {
      status: "waiting_for_input"
    }
  };
  const service = createService({
    projectService: {
      async createRuntime() {
        return {
          async getSession() {
            return session;
          },
          async runAction() {
            runActionCalls += 1;
            session.stepMachine = {
              status: "awaiting_agent_result"
            };
            const error = new Error("Wait for Codex to finish this step.");
            error.code = "vibe64_action_disabled";
            error.stepStatus = "awaiting_agent_result";
            throw error;
          },
          async returnControlFromAgentWait() {
            returnControlCalls += 1;
            return session;
          }
        };
      }
    },
    setupServices: readySetupServices(),
    terminalService: {
      async codexTerminalState() {
        throw new Error("codexTerminalState should not recover an accepted user message wait.");
      }
    }
  });

  const result = await service.runSessionAction("session-accepted-agent-wait-after-rejection", "draft_issue", {
    conversationRequest: "Duplicate after the first prompt claimed the workflow state."
  });

  assert.equal(result.sessionId, "session-accepted-agent-wait-after-rejection");
  assert.notEqual(result.ok, false);
  assert.equal(result.stepMachine.status, "awaiting_agent_result");
  assert.equal(runActionCalls, 1);
  assert.equal(returnControlCalls, 0);
});

test("session user message intent observes accepted agent wait before Codex turn is visible", async () => {
  let returnControlCalls = 0;
  let runIntentCalls = 0;
  const session = {
    sessionId: "session-accepted-agent-wait-intent",
    status: VIBE64_SESSION_STATUS.ACTIVE,
    stepMachine: {
      status: "awaiting_agent_result"
    }
  };
  const service = createService({
    projectService: {
      async createRuntime() {
        return {
          async getSession() {
            return session;
          },
          async runIntent() {
            runIntentCalls += 1;
            throw new Error("runIntent should not be called for an accepted user message.");
          },
          async returnControlFromAgentWait() {
            returnControlCalls += 1;
            session.stepMachine = {
              status: "waiting_for_input"
            };
            return session;
          }
        };
      }
    },
    setupServices: readySetupServices(),
    terminalService: {
      async codexTerminalState() {
        throw new Error("codexTerminalState should not recover an accepted user message wait.");
      }
    }
  });

  const result = await service.runSessionIntent("session-accepted-agent-wait-intent", "agent_conversation", {
    fields: {
      conversationRequest: "Duplicate while first prompt is still being delivered."
    }
  });

  assert.equal(result.sessionId, "session-accepted-agent-wait-intent");
  assert.notEqual(result.ok, false);
  assert.equal(result.stepMachine.status, "awaiting_agent_result");
  assert.equal(runIntentCalls, 0);
  assert.equal(returnControlCalls, 0);
});

test("session user message intent observes accepted agent wait after runtime state rejection", async () => {
  let runIntentCalls = 0;
  let returnControlCalls = 0;
  const session = {
    sessionId: "session-accepted-agent-wait-intent-after-rejection",
    status: VIBE64_SESSION_STATUS.ACTIVE,
    stepMachine: {
      status: "waiting_for_input"
    }
  };
  const service = createService({
    projectService: {
      async createRuntime() {
        return {
          async getSession() {
            return session;
          },
          async runIntent() {
            runIntentCalls += 1;
            session.stepMachine = {
              status: "awaiting_agent_result"
            };
            const error = new Error("Wait for Codex to finish this step.");
            error.code = "vibe64_action_disabled";
            error.stepStatus = "awaiting_agent_result";
            throw error;
          },
          async returnControlFromAgentWait() {
            returnControlCalls += 1;
            return session;
          }
        };
      }
    },
    setupServices: readySetupServices(),
    terminalService: {
      async codexTerminalState() {
        throw new Error("codexTerminalState should not recover an accepted user message wait.");
      }
    }
  });

  const result = await service.runSessionIntent("session-accepted-agent-wait-intent-after-rejection", "agent_conversation", {
    fields: {
      conversationRequest: "Duplicate after the first prompt claimed the workflow state."
    }
  });

  assert.equal(result.sessionId, "session-accepted-agent-wait-intent-after-rejection");
  assert.notEqual(result.ok, false);
  assert.equal(result.stepMachine.status, "awaiting_agent_result");
  assert.equal(runIntentCalls, 1);
  assert.equal(returnControlCalls, 0);
});

test("session action returns control without request failure when Codex session worktree is unavailable", async () => {
  let returnControlCalls = 0;
  const session = {
    actionResult: {
      codexPromptHandoff: {
        kind: "codex_prompt_handoff",
        terminalInput: "Ask Codex this."
      }
    },
    sessionId: "session-missing-worktree",
    status: VIBE64_SESSION_STATUS.ACTIVE,
    stepMachine: {
      status: "awaiting_agent_result"
    }
  };
  const service = createService({
    projectService: {
      async createRuntime() {
        return {
          async runAction() {
            return session;
          },
          async returnControlFromAgentWait(_sessionId, input = {}) {
            returnControlCalls += 1;
            session.returnControlInput = input;
            session.stepMachine = {
              status: "waiting_for_input"
            };
            return session;
          }
        };
      }
    },
    setupServices: readySetupServices(),
    terminalService: {
      async injectCodexPrompt() {
        return {
          code: "vibe64_session_worktree_unavailable",
          error: "Session clone was removed. Recover this session before continuing with Codex.",
          ok: false,
          retryable: false
        };
      }
    }
  });

  const result = await service.runSessionAction("session-missing-worktree", "agent_conversation", {
    fields: {
      conversationRequest: "Hello"
    }
  });

  assert.equal(result.sessionId, "session-missing-worktree");
  assert.notEqual(result.ok, false);
  assert.equal(returnControlCalls, 1);
  assert.equal(session.stepMachine.status, "waiting_for_input");
  assert.equal(session.returnControlInput.inputPrompt, "Recover this session before continuing.");
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
            status: "running"
          },
          ok: true,
          sessionId
        };
      }
    }
  });

  const session = await service.inspectSession("session-1", {
    includeRuntimeEnrichment: true
  });

  assert.deepEqual(session.presentation.terminal.codex, {
    label: "",
    readOnlyInAutopilot: true,
    renderer: "codex_terminal",
    terminalSessionId: "codex-terminal-output-only",
    visible: false,
    visibleUntil: ""
  });
});

test("session presentation ignores app-server Codex turn state for preview visibility", async () => {
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
          codexAgentTurn: {
            active: true,
            state: "active",
            status: "inProgress",
            turnId: "codex-app-server-turn-3"
          },
          codexAgentTurnActive: true,
          codexTerminal: {
            commandPreview: "codex",
            id: "codex-terminal-old-input",
            ...oldTerminalActivity(),
            status: "running"
          },
          ok: true,
          sessionId
        };
      }
    }
  });

  const session = await service.inspectSession("session-1", {
    includeRuntimeEnrichment: true
  });

  assert.equal(session.codexTerminal.transmitting, undefined);
  assert.equal(session.codexAgentTurnActive, true);
  assertCodexPreviewHidden(session.presentation.terminal.codex, "codex-terminal-old-input");
});

test("session presentation does not show the Codex terminal preview for stale workflow waits", async () => {
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
            commandPreview: "codex",
            id: "codex-terminal-fresh-wait",
            lastInputAt: waitStartedAt,
            lastInputBytes: 9,
            status: "running"
          },
          ok: true,
          sessionId
        };
      }
    }
  });

  const session = await service.inspectSession("session-1", {
    includeRuntimeEnrichment: true
  });

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

test("session list can read sessions before a source config session is selected", async () => {
  const createRuntimeOptions = [];
  const service = createService({
    projectService: {
      async createRuntime(options = {}) {
        createRuntimeOptions.push(options);
        return {
          async listSessionSummaries() {
            return [
              {
                sessionId: "session-1",
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
      }
    },
    setupServices: readySetupServices()
  });

  const result = await service.listSessions();

  assert.equal(result.ok, true);
  assert.deepEqual(createRuntimeOptions, [
    {
      sourceSetupRequired: false
    }
  ]);
  assert.deepEqual(result.sessions.map((session) => session.sessionId), ["session-1"]);
});

test("session list asks the runtime for open sessions by default", async () => {
  const listCalls = [];
  const preparedSessions = [];
  const reconciledSessionSets = [];
  const terminalStateSessions = [];
  let codexThreadId = "";
  const service = createService({
    projectService: {
      async createRuntime() {
        return {
          async listSessionSummaries(options = {}) {
            listCalls.push(options);
            return [
              {
                currentStep: "source_created",
                metadata: {
                  codex_thread_id: codexThreadId,
                  source_path: "/workspace/vibe64-local-editor/state/projects/project-test/sessions/active/open-session/source"
                },
                sessionId: "open-session",
                status: VIBE64_SESSION_STATUS.ACTIVE,
                targetRoot: "/workspace/project",
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
      },
      async reconcileCodexThreads(sessions = []) {
        reconciledSessionSets.push(sessions.map((session) => session.sessionId));
        return {
          failed: [],
          ok: true,
          sessionCount: sessions.length
        };
      }
    }
  });

  const result = await service.listSessions();
  await delay(0);
  const repeatedResult = await service.listSessions();
  await delay(0);
  codexThreadId = "00000000-0000-4000-8000-000000000001";
  const changedResult = await service.listSessions();
  await delay(0);

  assert.equal(result.ok, true);
  assert.equal(repeatedResult.ok, true);
  assert.equal(changedResult.ok, true);
  assert.deepEqual(listCalls, [
    {
      statusGroup: "open"
    },
    {
      statusGroup: "open"
    },
    {
      statusGroup: "open"
    }
  ]);
  assert.deepEqual(preparedSessions, []);
  assert.deepEqual(reconciledSessionSets, [["open-session"]]);
  assert.deepEqual(terminalStateSessions, []);
  assert.deepEqual(result.sessions.map((session) => session.sessionId), ["open-session"]);
  assert.equal(result.sessions[0].presentation, undefined);
  assert.equal(result.sessions[0].stepDefinitions, undefined);
  assert.equal(result.sessions[0].artifactReadiness, undefined);
  assert.equal(result.sessions[0].commandLifecycles, undefined);
  assert.equal(result.sessions[0].codexTerminal, undefined);
  assert.equal(result.limits.openSessionCount, 1);
});

test("session list periodically refreshes Codex thread reconciliation for unchanged open sessions", async () => {
  const reconciledSessionSets = [];
  let nowMs = 0;
  const service = createService({
    codexThreadReconcileRefreshMs: 100,
    now: () => nowMs,
    projectService: {
      async createRuntime() {
        return {
          async listSessionSummaries() {
            return [
              {
                currentStep: "source_created",
                metadata: {
                  source_path: "/workspace/vibe64-local-editor/state/projects/project-test/sessions/active/open-session/source"
                },
                sessionId: "open-session",
                status: VIBE64_SESSION_STATUS.ACTIVE,
                targetRoot: "/workspace/project",
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
      async reconcileCodexThreads(sessions = []) {
        reconciledSessionSets.push(sessions.map((session) => session.sessionId));
        return {
          failed: [],
          ok: true,
          sessionCount: sessions.length
        };
      }
    }
  });

  await service.listSessions();
  await delay(0);
  nowMs = 50;
  await service.listSessions();
  await delay(0);
  nowMs = 100;
  await service.listSessions();
  await delay(0);

  assert.deepEqual(reconciledSessionSets, [
    ["open-session"],
    ["open-session"]
  ]);
});

test("session list does not reconcile Codex threads before a worktree exists", async () => {
  const reconciledSessionSets = [];
  const service = createService({
    projectService: {
      async createRuntime() {
        return {
          async listSessionSummaries() {
            return [
              {
                currentStep: "work_source_selected",
                metadata: {},
                sessionId: "pre-worktree-session",
                status: VIBE64_SESSION_STATUS.ACTIVE,
                targetRoot: "/workspace/project",
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
      async reconcileCodexThreads(sessions = []) {
        reconciledSessionSets.push(sessions.map((session) => session.sessionId));
        return {
          failed: [],
          ok: true,
          sessionCount: sessions.length
        };
      }
    }
  });

  const result = await service.listSessions();
  await delay(0);

  assert.equal(result.ok, true);
  assert.deepEqual(result.sessions.map((session) => session.sessionId), ["pre-worktree-session"]);
  assert.deepEqual(reconciledSessionSets, []);
});

test("session list does not reconcile Codex threads while a worktree is closing", async () => {
  const reconciledSessionSets = [];
  const service = createService({
    projectService: {
      async createRuntime() {
        return {
          async listSessionSummaries() {
            return [
              {
                currentStep: "source_created",
                metadata: {
                  session_closing_reason: "abandoned",
                  source_path: "/workspace/vibe64-local-editor/state/projects/project-test/sessions/active/closing-session/source"
                },
                sessionId: "closing-session",
                status: VIBE64_SESSION_STATUS.ACTIVE,
                targetRoot: "/workspace/project",
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
      async reconcileCodexThreads(sessions = []) {
        reconciledSessionSets.push(sessions.map((session) => session.sessionId));
        return {
          failed: [],
          ok: true,
          sessionCount: sessions.length
        };
      }
    }
  });

  const result = await service.listSessions();
  await delay(0);

  assert.equal(result.ok, true);
  assert.deepEqual(result.sessions.map((session) => session.sessionId), ["closing-session"]);
  assert.deepEqual(reconciledSessionSets, []);
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

test("open session list reports first seed creation state without starting it", async () => {
  let advanceSessionCalled = false;
  let createSessionCalled = false;
  let requireProjectTypeCalled = false;
  const listCalls = [];
  const service = createService({
    projectService: {
      async createRuntime() {
        return {
          async advance() {
            advanceSessionCalled = true;
            throw new Error("listSessions should not advance seed sessions.");
          },
          async createSession() {
            createSessionCalled = true;
            throw new Error("listSessions should not create seed sessions.");
          },
          async listSessionSummaries(options = {}) {
            listCalls.push(options);
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
        requireProjectTypeCalled = true;
        throw new Error("listSessions should not require project type.");
      }
    },
    setupServices: {
      connectionSetupService: {
        async getStatus() {
          throw new Error("listSessions should not read connection readiness.");
        }
      },
      projectSetupService: {
        async getStatus() {
          throw new Error("listSessions should not read project readiness.");
        }
      },
      studioSetupService: {
        async getStatus() {
          throw new Error("listSessions should not read studio readiness.");
        }
      }
    }
  });

  const result = await service.listSessions();

  assert.equal(result.ok, true);
  assert.equal(createSessionCalled, false);
  assert.equal(advanceSessionCalled, false);
  assert.equal(requireProjectTypeCalled, false);
  assert.deepEqual(listCalls, [
    {
      statusGroup: "open"
    }
  ]);
  assert.deepEqual(result.sessions, []);
  assert.equal(result.creation.mode, "seed_required");
  assert.equal(result.creation.canCreate, true);
  assert.equal(result.creation.defaultWorkflowDefinition, VIBE64_WORKFLOW_DEFINITION_IDS.SEED_APPLICATION);
  assert.equal(result.limits.maxOpenSessions, 1);
  assert.equal(result.limits.openSessionCount, 0);
});

test("concurrent open session list reads do not race to create seed sessions", async () => {
  let advancedCount = 0;
  let createCount = 0;
  let listCount = 0;
  const service = createService({
    projectService: {
      currentTargetRoot() {
        return "/target";
      },
      async createRuntime() {
        return {
          async advance(sessionId) {
            advancedCount += 1;
            throw new Error(`listSessions should not advance ${sessionId}.`);
          },
          async createSession() {
            createCount += 1;
            throw new Error("listSessions should not create seed sessions.");
          },
          async listSessionSummaries() {
            listCount += 1;
            await new Promise((resolve) => {
              setTimeout(resolve, 10);
            });
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
        throw new Error("listSessions should not require project type.");
      }
    },
    setupServices: readySetupServices()
  });

  const [firstResult, secondResult] = await Promise.all([
    service.listSessions(),
    service.listSessions()
  ]);

  assert.equal(createCount, 0);
  assert.equal(advancedCount, 0);
  assert.equal(listCount, 2);
  assert.deepEqual(firstResult.sessions, []);
  assert.deepEqual(secondResult.sessions, []);
  assert.equal(firstResult.creation.canCreate, true);
  assert.equal(secondResult.creation.canCreate, true);
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

test("session list blocks new sessions while a seed session is active after seed detection changes", async () => {
  const service = createService({
    projectService: {
      async createRuntime() {
        return {
          async listSessions() {
            return [
              {
                metadata: {
                  workflow_definition: VIBE64_WORKFLOW_DEFINITION_IDS.SEED_APPLICATION
                },
                sessionId: "seed-session",
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
      }
    },
    setupServices: readySetupServices()
  });

  const result = await service.listSessions();

  assert.equal(result.ok, true);
  assert.equal(result.creation.seedRequired, false);
  assert.equal(result.creation.seedSessionActive, true);
  assert.equal(result.creation.seedSessionId, "seed-session");
  assert.equal(result.creation.canCreate, false);
  assert.equal(result.creation.disabledCode, "seed_session_active");
  assert.match(result.creation.disabledReason, /seed-session/u);
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
  const preparedSessions = [];
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
    setupServices: readySetupServices(),
    terminalService: {
      async ensureCodexThread(sessionId) {
        preparedSessions.push(sessionId);
        return {
          ok: true
        };
      }
    }
  });

  const result = await service.createSession({
    workflowDefinition: maintenanceWorkflowDefinitionIds.NON_COMMIT_MAINTENANCE
  });

  assert.equal(result.ok, true);
  assert.equal(result.workflowDefinition.id, maintenanceWorkflowDefinitionIds.NON_COMMIT_MAINTENANCE);
  assert.equal(selectedWorkflowDefinitionId, maintenanceWorkflowDefinitionIds.NON_COMMIT_MAINTENANCE);
  assert.deepEqual(preparedSessions, []);
});

test("session creation is gated by session readiness, not project setup diagnostics", async () => {
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
    setupServices: {
      ...readySetupServices(),
      projectSetupService: {
        async getStatus() {
          throw new Error("Project setup should not gate session creation.");
        }
      }
    }
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
  assert.equal(result.errors[0].code, "seed_session_active");
  assert.equal(result.creation.seedSessionActive, true);
  assert.equal(result.limits.maxOpenSessions, 1);
  assert.equal(createSessionCalled, false);
});

test("session creation blocks any new session while a seed session is active", async () => {
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
                metadata: {
                  workflow_definition: VIBE64_WORKFLOW_DEFINITION_IDS.SEED_APPLICATION
                },
                sessionId: "seed-session",
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
    workflowDefinition: VIBE64_WORKFLOW_DEFINITION_IDS.BIG_FEATURE
  });

  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, "seed_session_active");
  assert.match(result.errors[0].message, /seed-session/u);
  assert.equal(result.creation.seedRequired, false);
  assert.equal(result.creation.canCreate, false);
  assert.equal(result.creation.seedSessionActive, true);
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
