import assert from "node:assert/strict";
import test from "node:test";

import {
  VIBE64_SESSION_STATUS,
  workflowDefinitionCreationOptions
} from "@local/vibe64-runtime/server";
import {
  createService
} from "../../packages/vibe64-sessions/src/server/service.js";

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

test("session prompt action routes OpenCode handoffs through the agent prompt service", async () => {
  const delivered = [];
  const codexDeliveries = [];
  const handoff = {
    kind: "agent_prompt_handoff",
    prompt: "Ask OpenCode from the server.",
    runtimeId: "opencode"
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
              metadata: {
                agent_runtime_id: "opencode"
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
      async injectAgentPrompt(sessionId, promptHandoff) {
        delivered.push({
          promptHandoff,
          sessionId
        });
        return {
          agentPromptDelivered: true,
          ok: true,
          opencodeSessionId: "opencode-session-1"
        };
      },
      async injectCodexPrompt(sessionId, promptHandoff) {
        codexDeliveries.push({
          promptHandoff,
          sessionId
        });
        return {
          ok: true
        };
      },
      async opencodeSessionState(sessionId) {
        return {
          agentConversationId: "opencode-session-1",
          agentIdentityProvider: "opencode",
          agentIdentityStatus: "ready",
          agentResumeStrategy: "provider-native",
          agentRuntimeId: "opencode",
          agentWorkdir: "/workspace/project",
          ok: true,
          opencodeSessionId: "opencode-session-1",
          sessionId
        };
      }
    }
  });

  const session = await service.runSessionAction("session-1", "agent_conversation", {
    conversationRequest: "Explain this codebase."
  });

  assert.equal(session.status, VIBE64_SESSION_STATUS.ACTIVE);
  assert.equal(session.agentRuntimeId, "opencode");
  assert.equal(session.agentPromptDelivery.opencodeSessionId, "opencode-session-1");
  assert.equal(session.opencodeSessionId, "opencode-session-1");
  assert.deepEqual(delivered, [
    {
      promptHandoff: handoff,
      sessionId: "session-1"
    }
  ]);
  assert.deepEqual(codexDeliveries, []);
});

test("session prompt action returns control when OpenCode delivery is silent", async () => {
  const handoff = {
    kind: "agent_prompt_handoff",
    prompt: "Ask OpenCode from the server.",
    promptId: "agent_conversation",
    runtimeId: "opencode"
  };
  let recoveryInput = null;
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
              currentStep: "maintenance_conversation",
              metadata: {
                agent_runtime_id: "opencode"
              },
              sessionId,
              status: VIBE64_SESSION_STATUS.ACTIVE,
              stepMachine: {
                status: "awaiting_agent_result"
              }
            };
          },
          async returnControlFromAgentWait(sessionId, input) {
            recoveryInput = input;
            return {
              actions: [
                {
                  id: "agent_conversation",
                  inputFields: [
                    {
                      label: "What do you want to ask Codex?",
                      name: "conversationRequest",
                      requiredMessage: "Describe what you want Codex to do."
                    }
                  ],
                  label: "Ask Codex"
                }
              ],
              currentStep: "maintenance_conversation",
              metadata: {
                agent_runtime_id: "opencode"
              },
              presentation: {
                prompt: {
                  state: "needs_user_input"
                }
              },
              sessionId,
              status: VIBE64_SESSION_STATUS.ACTIVE,
              stepMachine: {
                status: "waiting_for_input"
              }
            };
          }
        };
      }
    },
    setupServices: readySetupServices(),
    terminalService: {
      async injectAgentPrompt() {
        return {
          error: "OpenCode accepted the prompt but showed no session activity within 5 seconds.",
          ok: false
        };
      },
      async opencodeSessionState(sessionId) {
        return {
          agentRuntimeId: "opencode",
          ok: true,
          sessionId
        };
      }
    }
  });

  const session = await service.runSessionAction("session-1", "agent_conversation", {
    conversationRequest: "Explain this codebase."
  });

  assert.equal(session.stepMachine.status, "waiting_for_input");
  assert.equal(session.actions[0].label, "Ask OpenCode");
  assert.equal(session.actions[0].inputFields[0].requiredMessage, "Describe what you want OpenCode to do.");
  assert.equal(session.presentation.prompt.state, "needs_user_input");
  assert.equal(session.agentPromptDelivery.ok, false);
  assert.match(session.agentPromptDelivery.error, /no session activity within 5 seconds/u);
  assert.deepEqual(recoveryInput, {
    inputPrompt: "OpenCode did not respond. What would you like to do?",
    message: "OpenCode accepted the prompt but showed no session activity within 5 seconds. Vibe64 returned control so you can retry."
  });
});

test("OpenCode sessions expose OpenCode labels in presentation controls", async () => {
  const service = createService({
    projectService: {
      async createRuntime() {
        return {
          async getSession(sessionId) {
            const promptIntent = {
              actionId: "agent_conversation",
              enabled: true,
              id: "agent_conversation",
              input: {
                fields: [
                  {
                    label: "What do you want to ask Codex?",
                    name: "conversationRequest",
                    placeholder: "Tell Codex what to do.",
                    requiredMessage: "Describe what you want Codex to do."
                  }
                ],
                submitLabel: "Ask Codex",
                submitTarget: "intent"
              },
              inputFields: [
                {
                  label: "What do you want to ask Codex?",
                  name: "conversationRequest",
                  placeholder: "Tell Codex what to do.",
                  requiredMessage: "Describe what you want Codex to do."
                }
              ],
              label: "Ask Codex",
              style: "primary"
            };
            return {
              actions: [
                {
                  enabled: true,
                  id: "agent_conversation",
                  inputFields: promptIntent.inputFields,
                  label: "Ask Codex"
                }
              ],
              intents: [promptIntent],
              metadata: {
                agent_runtime_id: "opencode"
              },
              presentation: {
                intents: [promptIntent],
                screen: {
                  input: {
                    fields: promptIntent.input.fields,
                    submitLabel: "Ask Codex",
                    submitTarget: "intent"
                  },
                  message: "Ask Codex for changes.",
                  primaryIntentId: "agent_conversation",
                  title: "Talk to Codex"
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
      async opencodeSessionState(sessionId) {
        return {
          agentRuntimeId: "opencode",
          ok: true,
          sessionId
        };
      }
    }
  });

  const session = await service.inspectSession("session-1");

  assert.equal(session.actions[0].label, "Ask OpenCode");
  assert.equal(session.intents[0].label, "Ask OpenCode");
  assert.equal(session.intents[0].input.submitLabel, "Ask OpenCode");
  assert.equal(session.intents[0].inputFields[0].label, "What do you want to ask OpenCode?");
  assert.equal(session.intents[0].inputFields[0].placeholder, "Tell OpenCode what to do.");
  assert.equal(session.intents[0].inputFields[0].requiredMessage, "Describe what you want OpenCode to do.");
  assert.equal(session.presentation.intents[0].label, "Ask OpenCode");
  assert.equal(session.presentation.screen.input.submitLabel, "Ask OpenCode");
  assert.equal(session.presentation.screen.message, "Ask OpenCode for changes.");
  assert.equal(session.presentation.screen.title, "Talk to OpenCode");
});

test("session creation persists the requested agent runtime", async () => {
  let createdInput = null;
  const service = createService({
    projectService: {
      async createRuntime() {
        return {
          async advance(sessionId) {
            return {
              metadata: createdInput.metadata,
              sessionId,
              status: VIBE64_SESSION_STATUS.ACTIVE
            };
          },
          async createSession(input = {}) {
            createdInput = input;
            return {
              metadata: input.metadata,
              sessionId: "codex-session",
              status: VIBE64_SESSION_STATUS.ACTIVE
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
    agentRuntimeId: "codex"
  });

  assert.equal(result.sessionId, "codex-session");
  assert.equal(createdInput.metadata.agent_runtime_id, "codex");
});
