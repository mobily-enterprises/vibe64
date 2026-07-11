import assert from "node:assert/strict";
import path from "node:path";
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
  createService as createVibe64ProjectService
} from "../../packages/vibe64-project/src/server/service.js";
import {
  clearSessionUiSyncState
} from "@local/vibe64-core/server/sessionUiSyncState";
import {
  createStudioProjectContext
} from "../../packages/vibe64-core/src/server/studioProjectContext.js";
import {
  PROJECT_REPOSITORY_MODE_GITHUB,
  PROJECT_REPOSITORY_MODE_MANAGED_GIT,
  WORKFLOW_REPOSITORY_PROFILE_CANONICAL_GIT,
  WORKFLOW_REPOSITORY_PROFILE_GITHUB_PR
} from "../../packages/vibe64-core/src/server/projectRepository.js";
import {
  runWithProjectRequestContext
} from "../../packages/vibe64-core/src/server/projectRequestContext.js";
import {
  JSKIT_AUTH_PROVIDER_CONFIG,
  JSKIT_AUTH_PROVIDER_LOCAL
} from "@local/vibe64-adapters/server/adapters/jskit/appAuthConfig";
import {
  _testing as coreMaintenanceTesting
} from "@local/vibe64-runtime/server/workflowModules/coreMaintenance";
import {
  sourceMetadata,
  withTemporaryRoot
} from "./vibe64TestHelpers.js";
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
      },
      async writeAgentRunEvent(sessionId, runId, input = {}) {
        if (typeof originalStore.writeAgentRunEvent === "function") {
          return originalStore.writeAgentRunEvent.call(originalStore, sessionId, runId, input);
        }
        const session = sessionsById.get(String(sessionId || "")) || {
          sessionId
        };
        const runs = Array.isArray(session.agentRuns) ? session.agentRuns : [];
        const existing = runs.find((run) => run?.id === runId) || {};
        const run = {
          ...existing,
          ...(input.patch || {}),
          id: runId
        };
        sessionsById.set(String(sessionId || ""), {
          ...session,
          agentRuns: [
            ...runs.filter((candidate) => candidate?.id !== runId),
            run
          ]
        });
        return run;
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
    },
    sendAgentMessage(sessionId, input = {}) {
      return service.sendAgentMessage(sessionId, defaultWorkflowOriginInput(input, originId));
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
      describeAgentProvider({ agentSettings = {} } = {}) {
        return {
          providerId: agentSettings.providerId || "codex",
          transportId: "codex_app_server"
        };
      },
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

function composerMessageRuntimeHarness(initialSession = {}) {
  let currentSession = {
    actions: [
      {
        dispatchRoute: "session-message",
        id: "continue_with_assistant"
      }
    ],
    agentRuns: [],
    metadata: {},
    ...initialSession
  };
  return {
    currentSession() {
      return currentSession;
    },
    updateSession(update) {
      currentSession = typeof update === "function"
        ? update(currentSession)
        : update;
      return currentSession;
    },
    runtime: {
      async getSession() {
        return currentSession;
      },
      store: {
        async writeAgentRunEvent(_sessionId, runId, {
          event = {},
          patch = {}
        } = {}) {
          const runs = Array.isArray(currentSession.agentRuns) ? currentSession.agentRuns : [];
          const previous = runs.find((run) => run.id === runId) || {
            events: [],
            id: runId
          };
          const at = event.at || patch.updatedAt || new Date().toISOString();
          const run = {
            ...previous,
            ...patch,
            events: [
              ...previous.events,
              {
                ...event,
                at
              }
            ],
            id: runId,
            updatedAt: at
          };
          currentSession = {
            ...currentSession,
            agentRuns: [
              ...runs.filter((candidate) => candidate.id !== runId),
              run
            ]
          };
          return run;
        }
      }
    }
  };
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
        agentPromptHandoff: {
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
      agentPromptHandoff: {
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

function assertAgentPreviewHidden(presentation = {}, terminalSessionId = "") {
  assert.equal(presentation.label, "");
  assert.equal(presentation.readOnlyInAutopilot, true);
  assert.equal(presentation.renderer, "agent_terminal");
  assert.equal(presentation.terminalSessionId, terminalSessionId);
  assert.equal(presentation.visible, false);
  assert.equal(presentation.visibleUntil, "");
}

function composerHandoffAgentRun({
  at = new Date().toISOString(),
  error = "",
  handoffId = "test-handoff",
  state = "accepted"
} = {}) {
  const failed = state === "failed";
  return {
    error,
    handoffAcceptedAt: at,
    ...(failed ? { handoffFailedAt: at } : {}),
    handoffId,
    handoffState: state,
    id: "composer_handoff",
    provider: "codex",
    providerInterface: "codex_app_server",
    state: failed ? VIBE64_AGENT_RUN_STATE.FAILED : VIBE64_AGENT_RUN_STATE.STARTING,
    updatedAt: at
  };
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

test("session view state broadcasting persists the latest scoped startup snapshot", async () => {
  clearSessionUiSyncState();
  const service = createService({
    projectService: {
      async createRuntime() {
        return {
          async getSession(sessionId) {
            return {
              presentation: {},
              sessionId
            };
          }
        };
      }
    }
  });

  const result = await service.broadcastSessionViewState("session-1", {
    originId: "tab-1",
    projectSlug: "beepollen",
    routeFullPath: "/app/project/beepollen/dashboard/diff?mode=review"
  });
  const invalid = await service.broadcastSessionViewState("session-1", {
    originId: "tab-1",
    projectSlug: "beepollen",
    routeFullPath: "https://example.com/app/project/beepollen/dashboard/diff"
  });
  const wrongProject = await service.broadcastSessionViewState("session-1", {
    originId: "tab-1",
    projectSlug: "beepollen",
    routeFullPath: "/app/project/other/dashboard/diff"
  });

  assert.equal(result.ok, true);
  assert.equal(result.viewState.sessionId, "session-1");
  assert.equal(result.viewState.projectSlug, "beepollen");
  assert.equal(result.viewState.routeFullPath, "/app/project/beepollen/dashboard/diff?mode=review");
  assert.equal(result.viewState.projectPane, "dashboard");
  assert.equal(result.viewState.originId, "tab-1");
  assert.match(result.viewState.updatedAt, /^\d{4}-\d{2}-\d{2}T/u);
  const inspected = await service.inspectSession("session-1", {
    projectSlug: "beepollen"
  });
  assert.deepEqual(inspected.uiSync.viewState, result.viewState);
  assert.equal(inspected.uiSync.sourceEditor, undefined);
  const wrongProjectSnapshot = await service.inspectSession("session-1", {
    projectSlug: "other"
  });
  assert.equal(wrongProjectSnapshot.uiSync, undefined);
  assert.deepEqual(invalid, {
    ok: false,
    error: "Session view updates require a session, project, route, and origin."
  });
  assert.deepEqual(wrongProject, {
    ok: false,
    error: "Session view updates require a session, project, route, and origin."
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
      username: "dave"
    }
  });

  assert.equal(advanceCalled, false);
  assert.equal(getSessionCalled, true);
  assert.equal(recordGitActorCalled, false);
  assert.equal(result.sessionId, "session-1");
  assert.equal(result.currentStep, "maintenance_conversation");
  assert.equal(result.ok, undefined);
});

test("session advance rejects existing workflow origins without an OS username", async () => {
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
            return {
              currentStep: "maintenance_conversation",
              metadata: {
                ...metadata
              },
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
        assert.equal(input.vibe64User?.username, "dave");
        return {
          ok: true
        };
      }
    }
  });

  const result = await service.advanceSession("session-1", {
    originId: "tab-dave",
    stepId: "dependencies_installed",
    stepStatus: "done",
    vibe64User: {
      username: "dave"
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "vibe64_workflow_driver_owner_required");
  assert.equal(advanceCalled, false);
  assert.equal(recordGitActorCalled, false);
  assert.equal(metadata.workflow_driver_origin_id, "tab-tony");
});

test("session advance rebinds the workflow driver for the same user after reload", async () => {
  let advanceCalled = false;
  let recordGitActorCalled = false;
  const metadata = {
    workflow_driver_origin_id: "tab-tony",
    workflow_driver_username: "tony"
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
        assert.equal(input.vibe64User?.username, "tony");
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
      username: "tony"
    }
  });

  assert.equal(result.ok, undefined);
  assert.equal(result.sessionId, "session-1");
  assert.equal(result.currentStep, "maintenance_conversation");
  assert.equal(advanceCalled, true);
  assert.equal(recordGitActorCalled, true);
  assert.equal(metadata.workflow_driver_origin_id, "tab-tony-reloaded");
  assert.equal(metadata.workflow_driver_username, "tony");
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
  let agentSessionStateCalls = 0;
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
      async agentSessionState() {
        agentSessionStateCalls += 1;
        return {
          error: "Terminal session not found.",
          ok: false
        };
      }
    }
  });

  const result = await service.abandonSession("session-1");

  assert.equal(result.status, VIBE64_SESSION_STATUS.ABANDONED);
  assert.equal(agentSessionStateCalls, 0);
  assert.deepEqual(statusWrites, [
    {
      sessionId: "session-1",
      status: VIBE64_SESSION_STATUS.ABANDONED
    }
  ]);
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

test("session prompt action acknowledges the canonical handoff before provider delivery completes", async () => {
  const deliveries = [];
  const operations = [];
  const handoff = {
    handoffId: "handoff-action-1",
    kind: "agent_prompt_handoff",
    terminalInput: "Ask the assistant from the server."
  };
  const service = createService({
    projectService: {
      async createRuntime() {
        return {
          async runAction(sessionId, actionId, input) {
            return {
              actionResult: {
                actionId,
                agentPromptHandoff: handoff,
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
      async deliverAgentPrompt(sessionId, promptHandoff, options = {}) {
        operations.push({
          kind: "deliver",
          sessionId
        });
        deliveries.push({
          promptHandoff,
          sessionId
        });
        await options.lifecycle({
          connectionReused: false,
          state: "connecting"
        });
        await options.lifecycle({
          connectionReused: false,
          state: "delivered",
          threadId: "thread-action-1",
          turnId: "turn-action-1"
        });
        await options.lifecycle({
          connectionReused: false,
          state: "active",
          threadId: "thread-action-1",
          turnId: "turn-action-1"
        });
        return {
          connectionReused: false,
          ok: true,
          thread: {
            id: "thread-action-1"
          },
          turn: {
            active: true,
            id: "turn-action-1",
            status: "inProgress"
          }
        };
      }
    }
  });

  const session = await service.runSessionAction("session-1", "agent_conversation", {
    conversationRequest: "Explain this codebase."
  });

  assert.equal(session.status, VIBE64_SESSION_STATUS.ACTIVE);
  assert.equal(session.composerHandoff.canonical, true);
  assert.equal(session.composerHandoff.id, "handoff-action-1");
  assert.equal(session.composerHandoff.state, "accepted");
  assert.equal("agentPromptHandoff" in session.actionResult, false);
  await new Promise((resolve) => setImmediate(resolve));
  const inspected = await service.inspectSession("session-1");
  assert.equal(inspected.composerHandoff.state, "active");
  assert.equal(inspected.composerHandoff.threadId, "thread-action-1");
  assert.equal(inspected.composerHandoff.turnId, "turn-action-1");
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

test("assistant message preparation failures remain durable and resendable", async () => {
  const harness = composerMessageRuntimeHarness({
    sessionId: "session-message-preparation-failure",
    status: VIBE64_SESSION_STATUS.ACTIVE
  });
  const providerError = Object.assign(new Error("The selected assistant provider is unavailable."), {
    code: "provider_unavailable"
  });
  const service = createService({
    projectService: {
      async createRuntime() {
        return harness.runtime;
      }
    },
    setupServices: readySetupServices(),
    terminalService: {
      async describeAgentProvider() {
        throw providerError;
      }
    }
  });

  const result = await service.sendAgentMessage("session-message-preparation-failure", {
    composerSubmissionId: "durable-message-1",
    message: "Do not lose this message."
  });

  assert.deepEqual(result, {
    accepted: true,
    composerSubmissionId: "durable-message-1",
    delivered: false,
    messageId: "durable-message-1",
    ok: true,
    queued: false,
    sessionId: "session-message-preparation-failure",
    state: "failed"
  });
  const [message] = publicSessionResponse(harness.currentSession()).composerMessages;
  assert.equal(message.id, "durable-message-1");
  assert.equal(message.message, "Do not lose this message.");
  assert.equal(message.operationOutcome, "provider_unavailable");
  assert.equal(message.state, "failed");
});

test("session composer messages let a stale Stop cancel delivery and interrupt the current handoff", async () => {
  const previousHandoffAt = new Date().toISOString();
  let currentSession = {
    agentRuns: [{
      clientSubmissionId: "previous-submission",
      handoffAcceptedAt: previousHandoffAt,
      handoffActiveAt: previousHandoffAt,
      handoffId: "previous-handoff",
      handoffState: "active",
      id: "composer_handoff",
      events: [],
      provider: "future-provider",
      providerInterface: "future-transport",
      state: VIBE64_AGENT_RUN_STATE.COMPLETED,
      updatedAt: previousHandoffAt
    }],
    metadata: {},
    sessionId: "session-queued-steer",
    status: VIBE64_SESSION_STATUS.ACTIVE
  };
  let releaseDelivery;
  const deliveryGate = new Promise((resolve) => {
    releaseDelivery = resolve;
  });
  const interruptCalls = [];
  const messageCalls = [];
  let messageAttempts = 0;
  let markActionStarted;
  let releaseAction;
  const actionStarted = new Promise((resolve) => {
    markActionStarted = resolve;
  });
  const actionGate = new Promise((resolve) => {
    releaseAction = resolve;
  });
  const handoff = {
    handoffId: "handoff-queued-steer",
    kind: "agent_prompt_handoff",
    terminalInput: "Start provider work."
  };
  const runtime = {
    async getSession() {
      return currentSession;
    },
    async runAction(sessionId, actionId, input) {
      markActionStarted();
      await actionGate;
      currentSession = {
        ...currentSession,
        actionResult: {
          actionId,
          agentPromptHandoff: handoff,
          input,
          status: "prompt_ready"
        },
        presentation: {
          screen: {
            kind: "agent_running"
          }
        },
        sessionId
      };
      return currentSession;
    },
    store: {
      async writeAgentRunEvent(_sessionId, runId, {
        event = {},
        patch = {}
      } = {}) {
        const runs = Array.isArray(currentSession.agentRuns) ? currentSession.agentRuns : [];
        const previous = runs.find((run) => run.id === runId) || {
          events: [],
          id: runId
        };
        const at = event.at || patch.updatedAt || new Date().toISOString();
        const run = {
          ...previous,
          ...patch,
          events: [
            ...previous.events,
            {
              ...event,
              at
            }
          ],
          id: runId,
          updatedAt: at
        };
        currentSession = {
          ...currentSession,
          agentRuns: [
            ...runs.filter((candidate) => candidate.id !== runId),
            run
          ]
        };
        return run;
      }
    }
  };
  const service = createService({
    projectService: {
      async createRuntime() {
        return runtime;
      }
    },
    setupServices: readySetupServices(),
    terminalService: {
      describeAgentProvider() {
        return {
          providerId: "future-provider",
          transportId: "future-transport"
        };
      },
      async deliverAgentPrompt(_sessionId, _handoff, options = {}) {
        await deliveryGate;
        await options.lifecycle({
          state: "connecting"
        });
        await options.lifecycle({
          state: "delivered",
          threadId: "future-thread",
          turnId: "future-turn"
        });
        await options.lifecycle({
          state: "active",
          threadId: "future-thread",
          turnId: "future-turn"
        });
        return {
          ok: true,
          thread: {
            id: "future-thread"
          },
          turn: {
            active: true,
            id: "future-turn"
          }
        };
      },
      async sendAgentMessage(sessionId, input) {
        messageAttempts += 1;
        messageCalls.push({
          input,
          sessionId
        });
        if (messageAttempts === 1) {
          return {
            delivered: false,
            error: "The active provider turn is not ready for messages yet.",
            ok: false,
            operationOutcome: "active_turn_not_ready",
            retryable: true,
            thread: {
              id: "future-thread"
            },
            turn: {
              active: true,
              id: "future-turn"
            }
          };
        }
        return {
          delivered: true,
          deliveryMode: "active_turn",
          ok: true,
          operationOutcome: "delivered_to_active_turn",
          thread: {
            id: "future-thread"
          },
          turn: {
            active: true,
            id: "future-turn"
          }
        };
      },
      async interruptAgentTurn(sessionId, input) {
        interruptCalls.push({
          input,
          sessionId
        });
      }
    }
  });

  const initialPromise = service.runSessionAction(
    currentSession.sessionId,
    "agent_conversation",
    {
      composerSubmissionId: "initial-submission",
      conversationRequest: "Start provider work."
    }
  );
  await actionStarted;

  const queued = await service.sendAgentMessage(currentSession.sessionId, {
    afterSubmissionId: "initial-submission",
    composerSubmissionId: "follow-up-submission",
    displayFields: {
      conversationRequest: "Also inspect the tests."
    },
    fields: {
      conversationRequest: "Also inspect the tests."
    },
    message: "Also inspect the tests.",
    originId: "test-origin"
  });
  assert.equal(queued.ok, true);
  assert.equal(queued.queued, true);
  for (let attempt = 0; attempt < 10 && messageCalls.length < 1; attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(messageCalls.length, 1);

  const queuedInterrupt = await service.interruptAgentTurn(currentSession.sessionId, {
    afterSubmissionId: "initial-submission",
    originId: "test-origin",
    reason: "user_interrupt"
  });
  assert.equal(queuedInterrupt.ok, true);
  assert.equal(queuedInterrupt.queued, true);
  assert.equal(interruptCalls.length, 1);

  releaseAction();
  const initial = await initialPromise;
  assert.equal(initial.composerHandoff.state, "accepted");

  releaseDelivery();
  for (let attempt = 0; attempt < 10 && interruptCalls.length < 2; attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(messageCalls.length, 1);
  assert.equal(interruptCalls.length, 2);

  await service.inspectSession(currentSession.sessionId);
  for (let attempt = 0; attempt < 10 && !interruptCalls.length; attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.deepEqual(messageCalls, [
    {
      input: {
        composerSubmissionId: "follow-up-submission",
        displayFields: {
          conversationRequest: "Also inspect the tests."
        },
        fields: {
          conversationRequest: "Also inspect the tests."
        },
        message: "Also inspect the tests.",
        originId: "test-origin",
        text: "Also inspect the tests."
      },
      sessionId: "session-queued-steer"
    }
  ]);
  assert.deepEqual(interruptCalls, [
    {
      input: {
        controlRequestId: "interrupt:previous-submission",
        originId: "test-origin",
        reason: "user_interrupt"
      },
      sessionId: "session-queued-steer"
    },
    {
      input: {
        controlRequestId: "interrupt:initial-submission",
        originId: "test-origin",
        reason: "user_interrupt"
      },
      sessionId: "session-queued-steer"
    }
  ]);
  const inspected = await service.inspectSession(currentSession.sessionId);
  assert.deepEqual(inspected.composerMessages, [
    {
      afterSubmissionId: "initial-submission",
      attempts: 2,
      displayMessage: "Also inspect the tests.",
      error: "Message was not sent because the assistant was stopped.",
      id: "follow-up-submission",
      lastAttemptAt: inspected.composerMessages[0].lastAttemptAt,
      message: "Also inspect the tests.",
      operationOutcome: "cancelled_by_user",
      retryable: false,
      retriedAt: "",
      state: "failed",
      submittedAt: inspected.composerMessages[0].submittedAt,
      threadId: "future-thread",
      turnId: "future-turn"
    }
  ]);
});

test("rapid assistant messages start one new turn and deliver the follow-up after activation", async () => {
  let currentSession = {
    actions: [
      {
        dispatchRoute: "session-message",
        id: "agent_conversation"
      }
    ],
    agentRuns: [],
    metadata: {},
    sessionId: "session-rapid-messages",
    status: VIBE64_SESSION_STATUS.ACTIVE
  };
  let releaseDelivery;
  let markDeliveryStarted;
  const deliveryStarted = new Promise((resolve) => {
    markDeliveryStarted = resolve;
  });
  const deliveryGate = new Promise((resolve) => {
    releaseDelivery = resolve;
  });
  const sendCalls = [];
  let runActionCalls = 0;
  const handoff = {
    handoffId: "rapid-message-handoff",
    kind: "agent_prompt_handoff",
    terminalInput: "First message prompt"
  };
  const runtime = {
    async getSession() {
      return currentSession;
    },
    async runAction(sessionId, actionId, input) {
      runActionCalls += 1;
      currentSession = {
        ...currentSession,
        actionResult: {
          actionId,
          agentPromptHandoff: handoff,
          input,
          status: "prompt_ready"
        },
        sessionId
      };
      return currentSession;
    },
    store: {
      async writeAgentRunEvent(_sessionId, runId, {
        event = {},
        patch: runPatch = {}
      } = {}) {
        const runs = Array.isArray(currentSession.agentRuns) ? currentSession.agentRuns : [];
        const previous = runs.find((run) => run.id === runId) || {
          events: [],
          id: runId
        };
        const at = event.at || runPatch.updatedAt || new Date().toISOString();
        const run = {
          ...previous,
          ...runPatch,
          events: [
            ...previous.events,
            {
              ...event,
              at
            }
          ],
          id: runId,
          updatedAt: at
        };
        currentSession = {
          ...currentSession,
          agentRuns: [
            ...runs.filter((candidate) => candidate.id !== runId),
            run
          ]
        };
        return run;
      }
    }
  };
  const service = createService({
    projectService: {
      async createRuntime() {
        return runtime;
      }
    },
    setupServices: readySetupServices(),
    terminalService: {
      async deliverAgentPrompt(_sessionId, _handoff, options = {}) {
        markDeliveryStarted();
        await deliveryGate;
        await options.lifecycle({
          state: "connecting"
        });
        await options.lifecycle({
          state: "delivered",
          threadId: "rapid-thread",
          turnId: "rapid-turn"
        });
        await options.lifecycle({
          state: "active",
          threadId: "rapid-thread",
          turnId: "rapid-turn"
        });
        return {
          ok: true,
          thread: {
            id: "rapid-thread"
          },
          turn: {
            active: true,
            id: "rapid-turn"
          }
        };
      },
      async sendAgentMessage(_sessionId, input) {
        sendCalls.push(input.message);
        if (sendCalls.length === 1) {
          return {
            delivered: false,
            newTurnRequired: true,
            ok: true,
            operationOutcome: "new_turn_required"
          };
        }
        return {
          delivered: true,
          deliveryMode: "active_turn",
          ok: true,
          operationOutcome: "delivered_to_active_turn",
          threadId: "rapid-thread",
          turnId: "rapid-turn"
        };
      }
    }
  });

  const first = await service.sendAgentMessage(currentSession.sessionId, {
    composerSubmissionId: "rapid-message-1",
    message: "Tell me a short story about a boy.",
    originId: "test-origin"
  });
  const second = await service.sendAgentMessage(currentSession.sessionId, {
    afterSubmissionId: "rapid-message-1",
    composerSubmissionId: "rapid-message-2",
    message: "Actually, make the protagonist a girl.",
    originId: "test-origin"
  });

  assert.equal(first.accepted, true);
  assert.equal(second.accepted, true);
  await deliveryStarted;
  assert.equal(runActionCalls, 1);
  assert.deepEqual(sendCalls, [
    "Tell me a short story about a boy."
  ]);

  releaseDelivery();
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const messages = publicSessionResponse(currentSession).composerMessages;
    if (messages.length === 2 && messages.every((message) => message.state === "delivered")) {
      break;
    }
    await new Promise((resolve) => setImmediate(resolve));
  }

  assert.equal(runActionCalls, 1);
  assert.deepEqual(sendCalls, [
    "Tell me a short story about a boy.",
    "Actually, make the protagonist a girl."
  ]);
  assert.deepEqual(
    publicSessionResponse(currentSession).composerMessages.map((message) => ({
      id: message.id,
      operationOutcome: message.operationOutcome,
      state: message.state
    })),
    [
      {
        id: "rapid-message-1",
        operationOutcome: "started_new_turn",
        state: "delivered"
      },
      {
        id: "rapid-message-2",
        operationOutcome: "delivered_to_active_turn",
        state: "delivered"
      }
    ]
  );
});

test("an assistant message starts a new turn when the previous turn finishes before delivery", async () => {
  const sessionId = "session-message-finished-race";
  const harness = composerMessageRuntimeHarness({
    actions: [
      {
        dispatchRoute: "session-message",
        id: "continue_with_assistant"
      }
    ],
    sessionId,
    status: VIBE64_SESSION_STATUS.ACTIVE
  });
  let runActionCalls = 0;
  const runActionIds = [];
  const sentMessages = [];
  harness.runtime.runAction = async (_sessionId, actionId, input) => {
    runActionCalls += 1;
    runActionIds.push(actionId);
    const handoff = {
      handoffId: `finished-race-handoff-${runActionCalls}`,
      kind: "agent_prompt_handoff",
      terminalInput: input.conversationRequest
    };
    return harness.updateSession((session) => ({
      ...session,
      actionResult: {
        actionId,
        agentPromptHandoff: handoff,
        input,
        status: "prompt_ready"
      }
    }));
  };
  const service = createService({
    projectService: {
      async createRuntime() {
        return harness.runtime;
      }
    },
    setupServices: readySetupServices(),
    terminalService: {
      async deliverAgentPrompt(_sessionId, handoff, options = {}) {
        const suffix = handoff.handoffId.split("-").at(-1);
        await options.lifecycle({
          state: "connecting"
        });
        await options.lifecycle({
          state: "delivered",
          threadId: `finished-race-thread-${suffix}`,
          turnId: `finished-race-turn-${suffix}`
        });
        await options.lifecycle({
          state: "active",
          threadId: `finished-race-thread-${suffix}`,
          turnId: `finished-race-turn-${suffix}`
        });
        return {
          ok: true,
          thread: {
            id: `finished-race-thread-${suffix}`
          },
          turn: {
            active: true,
            id: `finished-race-turn-${suffix}`
          }
        };
      },
      async sendAgentMessage(_sessionId, input) {
        sentMessages.push(input.message);
        return {
          delivered: false,
          newTurnRequired: true,
          ok: true,
          operationOutcome: "new_turn_required"
        };
      }
    }
  });

  const firstResult = await service.sendAgentMessage(sessionId, {
    composerSubmissionId: "finished-race-message-1",
    message: "Tell me a short story about a boy."
  });
  assert.equal(firstResult.queued, true, JSON.stringify({
    firstResult,
    messages: publicSessionResponse(harness.currentSession()).composerMessages
  }));
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const [message] = publicSessionResponse(harness.currentSession()).composerMessages;
    if (message?.state === "delivered") {
      break;
    }
    await new Promise((resolve) => setImmediate(resolve));
  }

  await service.sendAgentMessage(sessionId, {
    afterSubmissionId: "finished-race-message-1",
    composerSubmissionId: "finished-race-message-2",
    message: "Actually, make the protagonist a girl."
  });
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const messages = publicSessionResponse(harness.currentSession()).composerMessages;
    if (messages.length === 2 && messages.every((message) => message.state === "delivered")) {
      break;
    }
    await new Promise((resolve) => setImmediate(resolve));
  }

  assert.equal(runActionCalls, 2);
  assert.deepEqual(runActionIds, [
    "continue_with_assistant",
    "continue_with_assistant"
  ]);
  assert.deepEqual(sentMessages, [
    "Tell me a short story about a boy.",
    "Actually, make the protagonist a girl."
  ]);
  assert.deepEqual(
    publicSessionResponse(harness.currentSession()).composerMessages.map((message) => ({
      id: message.id,
      operationOutcome: message.operationOutcome,
      state: message.state
    })),
    [
      {
        id: "finished-race-message-1",
        operationOutcome: "started_new_turn",
        state: "delivered"
      },
      {
        id: "finished-race-message-2",
        operationOutcome: "started_new_turn",
        state: "delivered"
      }
    ]
  );
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
      async agentSessionState(sessionId) {
        return {
          ok: true,
          sessionId,
          terminal: null,
          thread: {
            id: "thread-active"
          },
          turn: {
            active: true,
            id: "turn-active",
            state: "active",
            status: "inProgress",
            threadId: "thread-active"
          }
        };
      },
      async deliverAgentPrompt() {
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
  assert.equal(session.agentSession.turn.active, true);
  assert.equal(runActionCalls, 0);
  assert.equal(injectCalls, 0);
  assert.equal(userMessageWrites, 0);
});

test("warm session prompt delivery advances accepted directly to delivered and active", async () => {
  const handoff = {
    handoffId: "handoff-warm-1",
    kind: "agent_prompt_handoff",
    terminalInput: "Ask the assistant from the server."
  };
  const service = createService({
    projectService: {
      async createRuntime() {
        return {
          async runAction(sessionId, actionId, input) {
            return {
              actionResult: {
                actionId,
                agentPromptHandoff: handoff,
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
      async deliverAgentPrompt(_sessionId, _handoff, options = {}) {
        await options.lifecycle({
          connectionReused: true,
          state: "delivered",
          threadId: "thread-warm-1",
          turnId: "turn-warm-1"
        });
        await options.lifecycle({
          connectionReused: true,
          state: "active",
          threadId: "thread-warm-1",
          turnId: "turn-warm-1"
        });
        return {
          connectionReused: true,
          ok: true,
          thread: {
            id: "thread-warm-1"
          },
          turn: {
            active: true,
            id: "turn-warm-1",
            status: "inProgress",
            threadId: "thread-warm-1"
          }
        };
      }
    }
  });

  const session = await service.runSessionAction("session-1", "agent_conversation", {
    conversationRequest: "Explain this codebase."
  });

  assert.equal(session.composerHandoff.state, "accepted");
  await new Promise((resolve) => setImmediate(resolve));
  const inspected = await service.inspectSession("session-1");
  assert.equal(inspected.composerHandoff.connectionReused, true);
  assert.equal(inspected.composerHandoff.state, "active");
  assert.equal(inspected.composerHandoff.threadId, "thread-warm-1");
  assert.equal(inspected.composerHandoff.turnId, "turn-warm-1");
});

test("session prompt delivery returns control when the provider turn settles before the handoff", async () => {
  const handoff = {
    handoffId: "handoff-already-complete",
    kind: "agent_prompt_handoff",
    terminalInput: "Answer immediately."
  };
  let returnControlCalls = 0;
  let currentSession = {
    currentStep: "maintenance_conversation",
    sessionId: "session-already-complete",
    status: VIBE64_SESSION_STATUS.ACTIVE,
    stepMachine: {
      status: "waiting_for_input"
    }
  };
  const runtime = {
    async getSession() {
      return currentSession;
    },
    async returnControlFromAgentWait(_sessionId, input = {}) {
      returnControlCalls += 1;
      currentSession = {
        ...currentSession,
        returnControlInput: input,
        stepMachine: {
          status: "waiting_for_input"
        }
      };
      return currentSession;
    },
    async runAction(_sessionId, actionId, input) {
      currentSession = {
        ...currentSession,
        actionResult: {
          actionId,
          agentPromptHandoff: handoff,
          input,
          status: "prompt_ready"
        },
        stepMachine: {
          promptActionId: actionId,
          status: "awaiting_agent_result"
        }
      };
      return currentSession;
    },
    store: {
      async writeAgentRunEvent(_sessionId, runId, {
        event = {},
        patch = {}
      } = {}) {
        const runs = Array.isArray(currentSession.agentRuns) ? currentSession.agentRuns : [];
        const previous = runs.find((run) => run.id === runId) || {
          events: [],
          id: runId
        };
        const run = {
          ...previous,
          ...patch,
          events: [
            ...previous.events,
            event
          ],
          id: runId
        };
        currentSession = {
          ...currentSession,
          agentRuns: [
            ...runs.filter((candidate) => candidate.id !== runId),
            run
          ]
        };
        return run;
      }
    }
  };
  const service = createService({
    projectService: {
      async createRuntime() {
        return runtime;
      }
    },
    setupServices: readySetupServices(),
    terminalService: {
      async deliverAgentPrompt(sessionId, _handoff, options = {}) {
        await options.lifecycle({
          state: "delivered",
          threadId: "thread-already-complete",
          turnId: "turn-already-complete"
        });
        await options.runtime.store.writeAgentRunEvent(sessionId, "codex_app_server", {
          patch: {
            active: false,
            providerStatus: "completed",
            providerThreadId: "thread-already-complete",
            providerTurnId: "turn-already-complete",
            state: VIBE64_AGENT_RUN_STATE.COMPLETED
          }
        });
        return {
          ok: true,
          thread: {
            id: "thread-already-complete"
          },
          turn: {
            active: false,
            id: "turn-already-complete",
            state: "idle",
            status: "completed",
            threadId: "thread-already-complete"
          }
        };
      }
    }
  });

  const accepted = await service.runSessionAction(
    currentSession.sessionId,
    "agent_conversation",
    {
      conversationRequest: "Answer immediately."
    }
  );

  assert.equal(accepted.composerHandoff.state, "accepted");
  for (let attempt = 0; attempt < 10 && returnControlCalls < 1; attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(returnControlCalls, 1);
  assert.equal(currentSession.stepMachine.status, "waiting_for_input");
  assert.equal(
    currentSession.agentRuns.find((run) => run.id === "composer_handoff")?.handoffState,
    "active"
  );
  assert.equal(currentSession.returnControlInput.message, "The assistant is no longer running for this turn, so Vibe64 returned control to you.");
});

test("session prompt intent returns accepted before generic provider delivery", async () => {
  const deliveries = [];
  const operations = [];
  const handoff = {
    handoffId: "handoff-intent-1",
    kind: "agent_prompt_handoff",
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
                agentPromptHandoff: handoff,
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
      async deliverAgentPrompt(sessionId, promptHandoff, options = {}) {
        operations.push({
          kind: "deliver",
          sessionId
        });
        deliveries.push({
          promptHandoff,
          sessionId
        });
        await options.lifecycle({
          connectionReused: true,
          state: "delivered",
          threadId: "thread-intent-1",
          turnId: "turn-intent-1"
        });
        await options.lifecycle({
          connectionReused: true,
          state: "active",
          threadId: "thread-intent-1",
          turnId: "turn-intent-1"
        });
        return {
          connectionReused: true,
          ok: true,
          thread: {
            id: "thread-intent-1"
          },
          turn: {
            active: true,
            id: "turn-intent-1",
            threadId: "thread-intent-1"
          }
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
  assert.equal(session.composerHandoff.state, "accepted");
  await new Promise((resolve) => setImmediate(resolve));
  const inspected = await service.inspectSession("session-1");
  assert.equal(inspected.composerHandoff.state, "active");
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
        limit: 20
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
    "- BP2026011539178.pdf (89.7 KB): /tmp/vibe64-attachments/session/BP2026011539178.pdf"
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

test("session prompt action acknowledges acceptance before asynchronous delivery failure", async () => {
  const service = createService({
    projectService: {
      async createRuntime() {
        return {
          async runAction(sessionId, actionId) {
            return {
              actionResult: {
                actionId,
                agentPromptHandoff: {
                  handoffId: "session-1:agent-conversation",
                  kind: "agent_prompt_handoff",
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
      async deliverAgentPrompt() {
        return {
          error: "Codex app-server control is unavailable.",
          ok: false
        };
      }
    }
  });

  const result = await service.runSessionAction("session-1", "agent_conversation");

  assert.equal(result.composerHandoff.state, "accepted");
  assert.equal(result.composerHandoff.pending, true);

  await delay(0);
  const inspected = await service.inspectSession("session-1");
  assert.equal(inspected.composerHandoff.state, "failed");
  assert.equal(inspected.composerHandoff.error, "Codex app-server control is unavailable.");
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
      async agentSessionState(sessionId) {
        return {
          turn: {
            active: true,
            state: "active",
            status: "inProgress",
            id: "codex-app-server-turn-2"
          },
          terminal: {
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

  assert.equal(session.agentSession.terminal.id, "codex-terminal-active");
  assert.equal(session.agentSession.terminal.transmitting, undefined);
  assert.equal(session.agentSession.turn.active, true);
  assert.equal(session.agentSession.turn.id, "codex-app-server-turn-2");
  assert.ok(Date.parse(session.agentSession.terminal.lastInputAt));
  assertAgentPreviewHidden(session.presentation.terminal.agent, "codex-terminal-active");
});

test("session inspect reads existing Codex terminal state without preparing it", async () => {
  const preparedSessions = [];
  const service = createService({
    projectService: {
      async createRuntime() {
        return {
          async getSession(sessionId) {
            return {
              metadata: sourceMetadata("/workspace/project", "session-1"),
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
      async ensureAgentSession(sessionId) {
        preparedSessions.push(sessionId);
        return {
          ok: true,
          terminalSessionId: "codex-terminal-restored"
        };
      },
      async agentSessionState(sessionId) {
        return {
          terminal: {
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
  assert.equal(session.agentSession.terminal.id, "codex-terminal-restored");
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
  let agentSessionStateCalls = 0;
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
      async agentSessionState() {
        agentSessionStateCalls += 1;
        throw new Error("Default inspect must not wait for Codex terminal state.");
      }
    }
  });

  const session = await service.inspectSession("session-1");

  assert.equal(agentSessionStateCalls, 0);
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
      async agentSessionState(sessionId) {
        return {
          terminal: {
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
      async agentSessionState(sessionId) {
        return {
          turn: {
            active: false,
            state: "idle"
          },
          terminal: {
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

  assert.deepEqual(session.presentation.terminal.agent, {
    label: "",
    readOnlyInAutopilot: true,
    renderer: "agent_terminal",
    terminalSessionId: "codex-terminal-idle",
    visible: false,
    visibleUntil: ""
  });
});

test("default session inspect returns control when an agent wait has no active provider turn", async () => {
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
      async agentSessionState(sessionId) {
        return {
          turn: {
            active: false,
            state: "idle",
            status: "completed"
          },
          ok: true,
          sessionId
        };
      }
    }
  });

  const inspected = await service.inspectSession("session-stale-agent-wait");

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
        agentPromptHandoff: {
          kind: "agent_prompt_handoff",
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
      async agentSessionState(sessionId) {
        return {
          turn: {
            active: false,
            state: "idle",
            status: "completed"
          },
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
      async agentSessionState(sessionId) {
        return {
          turn: {
            active: false,
            state: "idle",
            status: "completed",
            threadId: "codex-thread-completed",
            id: "codex-turn-completed"
          },
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
  assert.match(inspected.returnControlInput.inputPrompt, /did not receive its result text/u);
  assert.match(inspected.returnControlInput.message, /did not receive its result text/u);
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
      async agentSessionState() {
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
  assert.equal(inspected.returnControlInput.message, "The assistant is no longer running for this turn, so Vibe64 returned control to you.");
});

test("session inspect keeps agent wait while canonical composer delivery is running", async () => {
  let returnControlCalls = 0;
  const service = createService({
    projectService: {
      async createRuntime() {
        return {
          async getSession(sessionId) {
            return {
              agentRuns: [
                composerHandoffAgentRun({
                  handoffId: "session-running-delivery:prompt",
                  state: "connecting"
                })
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
      async agentSessionState(sessionId) {
        return {
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
                  agentPromptHandoff: {
                    kind: "agent_prompt_handoff"
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
      async agentSessionState(sessionId) {
        return {
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
        agentPromptHandoff: {
          kind: "agent_prompt_handoff"
        },
        status: "prompt_ready",
        stepId: "seed_application_defined"
      }
    ],
    agentRuns: [
      composerHandoffAgentRun({
        at: "2026-06-21T04:54:47.835Z",
        error: "Assistant prompt delivery failed.",
        handoffId: "session-prompt-handoff-failed:prompt",
        state: "failed"
      })
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
      async agentSessionState(sessionId) {
        return {
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
                  agentPromptHandoff: {
                    kind: "agent_prompt_handoff"
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
      async agentSessionState(sessionId) {
        return {
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
      async agentSessionState(sessionId) {
        return {
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
      async agentSessionState(sessionId) {
        return {
          turn: {
            active: false,
            state: "idle",
            status: "completed"
          },
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
      async agentSessionState(sessionId) {
        return {
          turn: {
            active: true,
            state: "finalizing",
            status: "completed"
          },
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

test("session action returns canonical acceptance before prompt delivery fails", async () => {
  let returnControlCalls = 0;
  const session = {
    actionResult: {
      agentPromptHandoff: {
        handoffId: "session-delivery-failure:agent-conversation",
        kind: "agent_prompt_handoff",
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
      async deliverAgentPrompt() {
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

  assert.equal(result.composerHandoff.state, "accepted");
  assert.equal(result.composerHandoff.pending, true);

  await delay(0);
  assert.equal(returnControlCalls, 1);
  assert.equal(session.stepMachine.status, "waiting_for_input");
  assert.equal(session.returnControlInput.inputPrompt, "What would you like to do next?");
});

test("session action observes active Codex turn when prompt delivery is already claimed", async () => {
  let returnControlCalls = 0;
  const session = {
    actionResult: {
      agentPromptHandoff: {
        handoffId: "session-delivery-claimed:agent-conversation",
        kind: "agent_prompt_handoff",
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
    id: "codex-turn-claimed"
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
      async agentSessionState(sessionId) {
        return {
          turn: activeTurn,
          terminal: null,
          ok: true,
          sessionId
        };
      },
      async deliverAgentPrompt() {
        return {
          code: "vibe64_agent_turn_already_running",
          turn: activeTurn,
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
  assert.equal(result.composerHandoff, undefined);
  assert.equal(result.agentSession.turn.active, true);
  assert.equal(result.agentSession.turn.id, "codex-turn-claimed");
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
        agentPromptHandoff: {
          kind: "agent_prompt_handoff"
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
      async agentSessionState() {
        throw new Error("agentSessionState should not recover an accepted prompt action wait.");
      }
    }
  });

  const result = await service.runSessionAction("session-accepted-prompt-action", "make_seed_plan");

  assert.equal(result.sessionId, "session-accepted-prompt-action");
  assert.equal(result.ok, undefined);
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
                agentPromptHandoff: {
                  kind: "agent_prompt_handoff"
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
      async agentSessionState() {
        throw new Error("agentSessionState should not recover an accepted prompt action wait.");
      }
    }
  });

  const result = await service.runSessionAction("session-accepted-prompt-action-after-rejection", "make_seed_plan");

  assert.equal(result.sessionId, "session-accepted-prompt-action-after-rejection");
  assert.equal(result.ok, undefined);
  assert.equal(result.stepMachine.status, "awaiting_agent_result");
  assert.equal(runActionCalls, 1);
  assert.equal(returnControlCalls, 0);
});

test("session user message action observes accepted agent wait before Codex turn is visible", async () => {
  let agentSessionStateCalls = 0;
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
      async agentSessionState() {
        agentSessionStateCalls += 1;
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
  assert.equal(result.ok, undefined);
  assert.equal(result.stepMachine.status, "awaiting_agent_result");
  assert.equal(runActionCalls, 0);
  assert.equal(returnControlCalls, 0);
  assert.equal(agentSessionStateCalls, 0);
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
      async agentSessionState() {
        throw new Error("agentSessionState should not recover an accepted user message wait.");
      }
    }
  });

  const result = await service.runSessionAction("session-accepted-agent-wait-after-rejection", "draft_issue", {
    conversationRequest: "Duplicate after the first prompt claimed the workflow state."
  });

  assert.equal(result.sessionId, "session-accepted-agent-wait-after-rejection");
  assert.equal(result.ok, undefined);
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
      async agentSessionState() {
        throw new Error("agentSessionState should not recover an accepted user message wait.");
      }
    }
  });

  const result = await service.runSessionIntent("session-accepted-agent-wait-intent", "agent_conversation", {
    fields: {
      conversationRequest: "Duplicate while first prompt is still being delivered."
    }
  });

  assert.equal(result.sessionId, "session-accepted-agent-wait-intent");
  assert.equal(result.ok, undefined);
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
      async agentSessionState() {
        throw new Error("agentSessionState should not recover an accepted user message wait.");
      }
    }
  });

  const result = await service.runSessionIntent("session-accepted-agent-wait-intent-after-rejection", "agent_conversation", {
    fields: {
      conversationRequest: "Duplicate after the first prompt claimed the workflow state."
    }
  });

  assert.equal(result.sessionId, "session-accepted-agent-wait-intent-after-rejection");
  assert.equal(result.ok, undefined);
  assert.equal(result.stepMachine.status, "awaiting_agent_result");
  assert.equal(runIntentCalls, 1);
  assert.equal(returnControlCalls, 0);
});

test("session action returns control without request failure when Codex session worktree is unavailable", async () => {
  let returnControlCalls = 0;
  const session = {
    actionResult: {
      agentPromptHandoff: {
        handoffId: "session-missing-worktree:agent-conversation",
        kind: "agent_prompt_handoff",
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
      async deliverAgentPrompt() {
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
  assert.equal(result.composerHandoff.state, "accepted");

  await delay(0);
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
      async agentSessionState(sessionId) {
        return {
          terminal: {
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

  assert.deepEqual(session.presentation.terminal.agent, {
    label: "",
    readOnlyInAutopilot: true,
    renderer: "agent_terminal",
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
      async agentSessionState(sessionId) {
        return {
          turn: {
            active: true,
            state: "active",
            status: "inProgress",
            id: "codex-app-server-turn-3"
          },
          terminal: {
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

  assert.equal(session.agentSession.terminal.transmitting, undefined);
  assert.equal(session.agentSession.turn.active, true);
  assertAgentPreviewHidden(session.presentation.terminal.agent, "codex-terminal-old-input");
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
      async agentSessionState(sessionId) {
        return {
          terminal: {
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
  assert.deepEqual(session.presentation.terminal.agent, {
    label: "",
    readOnlyInAutopilot: true,
    renderer: "agent_terminal",
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
      maintenanceWorkflowDefinitionIds.NON_COMMIT_MAINTENANCE,
      VIBE64_WORKFLOW_DEFINITION_IDS.BIG_FEATURE
    ]
  );
  assert.deepEqual(
    result.creation.workflowDefinitions.map((definition) => definition.label),
    [
      "Free-form work",
      "Work on issue or PR"
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

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(createRuntimeOptions, [
    {
      sourceSetupRequired: false
    }
  ]);
  assert.deepEqual(result.sessions.map((session) => session.sessionId), ["session-1"]);
});

test("session list keeps bootstrap seed creation policy for zero-source projects", async () => {
  await withTemporaryRoot(async (root) => {
    const projectsRoot = path.join(root, "projects");
    const projectContext = createStudioProjectContext({
      explicitProjectsRoot: projectsRoot,
      env: {},
      home: root
    });
    await projectContext.createWorkspaceProjectRecord({
      repository: {
        github: {
          fullName: "example/clicky"
        },
        mode: PROJECT_REPOSITORY_MODE_GITHUB
      },
      slug: "clicky"
    });
    const projectRoot = path.join(projectsRoot, "clicky");
    const requestContext = {
      projectLocalRoot: projectRoot,
      projectRuntimeRoot: projectRoot,
      projectsRoot,
      slug: "clicky",
      targetRoot: projectRoot
    };
    const projectService = createVibe64ProjectService({
      projectContext
    });
    const service = createVibe64SessionsService({
      projectService,
      setupServices: readySetupServices(),
      terminalService: {
        async recordSessionGitCommandActor() {
          return {
            ok: true
          };
        }
      }
    });

    await runWithProjectRequestContext(requestContext, () => projectService.saveProjectType({
      projectType: "jskit",
      sessionId: "pre-source-session"
    }));
    await runWithProjectRequestContext(requestContext, () => projectService.saveProjectConfig({
      sessionId: "pre-source-session",
      values: {
        [JSKIT_AUTH_PROVIDER_CONFIG]: JSKIT_AUTH_PROVIDER_LOCAL,
        github_pr_merge_method: "merge",
        jskit_database_runtime: "mariadb"
      }
    }));
    const result = await runWithProjectRequestContext(
      requestContext,
      () => service.listSessions()
    );

    assert.equal(result.ok, true);
    assert.equal(result.creation.mode, "seed_required");
    assert.equal(result.creation.seedRequired, true);
    assert.equal(result.creation.defaultWorkflowDefinition, VIBE64_WORKFLOW_DEFINITION_IDS.SEED_APPLICATION);
    assert.deepEqual(result.creation.workflowDefinitions, []);
  });
});

test("session list asks the runtime for open sessions by default", async () => {
  const listCalls = [];
  const preparedSessions = [];
  const reconciledSessionSets = [];
  const terminalStateSessions = [];
  let agentConversationId = "";
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
                  agent_identity_conversation_id: agentConversationId,
                  ...sourceMetadata("/workspace/project", "open-session")
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
      async agentSessionState(sessionId) {
        terminalStateSessions.push(sessionId);
        return {
          ok: true,
          sessionId
        };
      },
      async ensureAgentSession(sessionId) {
        preparedSessions.push(sessionId);
        return {
          ok: true
        };
      },
      async reconcileAgentSessions(sessions = []) {
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
  agentConversationId = "00000000-0000-4000-8000-000000000001";
  const changedResult = await service.listSessions();
  await delay(0);

  assert.equal(result.ok, true, JSON.stringify(result));
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
  assert.deepEqual(reconciledSessionSets, []);
  assert.deepEqual(terminalStateSessions, []);
  assert.deepEqual(result.sessions.map((session) => session.sessionId), ["open-session"]);
  assert.equal(result.sessions[0].presentation, undefined);
  assert.equal(result.sessions[0].stepDefinitions, undefined);
  assert.equal(result.sessions[0].artifactReadiness, undefined);
  assert.equal(result.sessions[0].commandLifecycles, undefined);
  assert.equal(result.sessions[0].agentSession, undefined);
  assert.equal(result.limits.openSessionCount, 1);
});

test("session list does not reconcile Codex threads for unchanged open sessions", async () => {
  const reconciledSessionSets = [];
  const service = createService({
    projectService: {
      async createRuntime() {
        return {
          async listSessionSummaries() {
            return [
              {
                currentStep: "source_created",
                metadata: sourceMetadata("/workspace/project", "open-session"),
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
      async reconcileAgentSessions(sessions = []) {
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
  await service.listSessions();
  await delay(0);
  await service.listSessions();
  await delay(0);

  assert.deepEqual(reconciledSessionSets, []);
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
      async reconcileAgentSessions(sessions = []) {
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
                  ...sourceMetadata("/workspace/project", "closing-session")
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
      async reconcileAgentSessions(sessions = []) {
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
      async ensureAgentSession(sessionId) {
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

test("session creation freezes managed Git repository profile metadata", async () => {
  let createdInput = null;
  const service = createService({
    projectService: {
      async createRuntime() {
        return {
          async advance(sessionId) {
            return {
              ok: true,
              metadata: createdInput.metadata,
              sessionId,
              workflowDefinition: {
                id: createdInput.workflowDefinition
              }
            };
          },
          async createSession(input = {}) {
            createdInput = input;
            return {
              metadata: input.metadata,
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
      async listProjects() {
        return {
          ok: true,
          currentProject: {
            repository: {
              mode: PROJECT_REPOSITORY_MODE_MANAGED_GIT,
              defaultBranch: "main"
            },
            repositoryMode: PROJECT_REPOSITORY_MODE_MANAGED_GIT,
            workflowRepositoryProfile: WORKFLOW_REPOSITORY_PROFILE_CANONICAL_GIT
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
  assert.equal(createdInput.metadata.repository_mode, PROJECT_REPOSITORY_MODE_MANAGED_GIT);
  assert.equal(createdInput.metadata.workflow_repository_profile, WORKFLOW_REPOSITORY_PROFILE_CANONICAL_GIT);
  assert.equal(createdInput.metadata.github_repository, undefined);
  assert.equal(createdInput.metadata.github_issue_mode, "skip");
  assert.equal(result.metadata.repository_mode, PROJECT_REPOSITORY_MODE_MANAGED_GIT);
});

test("session creation freezes GitHub repository profile metadata", async () => {
  let createdInput = null;
  const service = createService({
    projectService: {
      async createRuntime() {
        return {
          async advance(sessionId) {
            return {
              ok: true,
              metadata: createdInput.metadata,
              sessionId,
              workflowDefinition: {
                id: createdInput.workflowDefinition
              }
            };
          },
          async createSession(input = {}) {
            createdInput = input;
            return {
              metadata: input.metadata,
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
      async listProjects() {
        return {
          ok: true,
          currentProject: {
            repository: {
              mode: PROJECT_REPOSITORY_MODE_GITHUB,
              defaultBranch: "main",
              github: {
                fullName: "example/github-app",
                source: "project-record",
                url: "https://github.com/example/github-app"
              }
            }
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
  assert.equal(createdInput.metadata.repository_mode, PROJECT_REPOSITORY_MODE_GITHUB);
  assert.equal(createdInput.metadata.workflow_repository_profile, WORKFLOW_REPOSITORY_PROFILE_GITHUB_PR);
  assert.equal(createdInput.metadata.github_repository, "example/github-app");
  assert.equal(createdInput.metadata.github_repository_source, "project-record");
  assert.equal(createdInput.metadata.github_repository_url, "https://github.com/example/github-app");
  assert.equal(createdInput.metadata.github_issue_mode, undefined);
  assert.equal(result.metadata.workflow_repository_profile, WORKFLOW_REPOSITORY_PROFILE_GITHUB_PR);
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
