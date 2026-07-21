import { describe, expect, it } from "vitest";
import { validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";

import { agentMessageInputValidator } from "../../packages/vibe64-sessions/src/server/inputSchemas.js";
import {
  artifactPreviewSubresourceActive,
  artifactReadinessChangeRefreshDecision,
  agentTerminalStartAllowed,
  agentTurnControlPayloadFromContext,
  runtimeCapabilitiesState,
  runtimeControlsAreBusy,
  runtimeHostAutopilotPageBusy,
  runtimeHostAgentWorking,
  runtimeHostInteractionBusy,
  runtimeHostToolbarSessions,
  sessionScreenHasAnySection,
  sessionScreenHasSection,
  sessionScreenSections
} from "../../src/composables/useVibe64SessionRuntimeHost.js";

describe("Vibe64 session runtime host", () => {
  it("keeps runtime controls busy until the selected session is stable", () => {
    expect(runtimeControlsAreBusy({
      active: true,
      loading: false,
      sessionReady: true,
      stable: true
    })).toBe(false);

    expect(runtimeControlsAreBusy({
      active: false,
      loading: false,
      sessionReady: true,
      stable: true
    })).toBe(true);
    expect(runtimeControlsAreBusy({
      active: true,
      loading: true,
      sessionReady: true,
      stable: true
    })).toBe(true);
    expect(runtimeControlsAreBusy({
      active: true,
      loading: false,
      sessionReady: false,
      stable: true
    })).toBe(true);
    expect(runtimeControlsAreBusy({
      active: true,
      loading: false,
      sessionReady: true,
      stable: false
    })).toBe(true);
  });

  it("treats first capability load differently from a refresh", () => {
    expect(runtimeCapabilitiesState({
      data: null,
      isLoading: true
    })).toEqual({
      fetching: true,
      initialLoading: true,
      loaded: false
    });

    expect(runtimeCapabilitiesState({
      data: {
        capabilities: {}
      },
      isFetching: true
    })).toEqual({
      fetching: true,
      initialLoading: false,
      loaded: true
    });
  });

  it("allows Codex terminal auto-start while loaded capabilities refresh", () => {
    expect(agentTerminalStartAllowed({
      active: true,
      capabilitiesReady: true,
      sessionReady: true
    })).toBe(true);

    expect(agentTerminalStartAllowed({
      active: true,
      capabilitiesReady: false,
      sessionReady: true
    })).toBe(false);
    expect(agentTerminalStartAllowed({
      active: true,
      capabilitiesReady: true,
      sessionReady: false
    })).toBe(false);
    expect(agentTerminalStartAllowed({
      active: false,
      capabilitiesReady: true,
      sessionReady: true
    })).toBe(false);
  });

  it("uses the provider turn projection as visible assistant activity", () => {
    expect(runtimeHostAgentWorking({
      active: true,
      selectedSession: {
        agentSession: {
          turn: {
            active: true
          }
        },
        sessionId: "session-a"
      }
    })).toBe(true);

    expect(runtimeHostAgentWorking({
      active: false,
      selectedSession: {
        agentSession: {
          turn: {
            active: true
          }
        },
        sessionId: "session-a"
      }
    })).toBe(true);

    expect(runtimeHostAgentWorking({
      active: true,
      selectedSession: {
        agentRuns: [
          {
            active: true,
            id: "codex_app_server",
            state: "active"
          }
        ],
        sessionId: "session-a"
      }
    })).toBe(false);
  });

  it("keeps Codex thinking out of Autopilot page busy while preserving host busy", () => {
    expect(runtimeHostAutopilotPageBusy({
      autopilotBusy: false,
      pageBusy: false
    })).toBe(false);
    expect(runtimeHostInteractionBusy({
      autopilotInteractionLocked: true,
      autopilotPageBusy: false
    })).toBe(true);

    expect(runtimeHostAutopilotPageBusy({
      autopilotBusy: true,
      pageBusy: false
    })).toBe(true);
    expect(runtimeHostAutopilotPageBusy({
      autopilotBusy: false,
      pageBusy: true
    })).toBe(true);
  });

  it("marks the visible runtime toolbar session as thinking from live runtime state", () => {
    expect(runtimeHostToolbarSessions({
      activeAgentThinking: true,
      selectedSession: {
        sessionId: "session-a"
      },
      selectedSessionId: "session-a",
      sessions: [
        {
          sessionId: "session-a",
          sessionName: "Alpha"
        },
        {
          sessionId: "session-b",
          sessionName: "Beta",
          stepMachine: {
            status: "awaiting_agent_result"
          }
        },
        {
          agentThinking: true,
          sessionId: "session-c",
          sessionName: "Gamma"
        }
      ]
    })).toEqual([
      {
        agentThinking: true,
        sessionId: "session-a",
        sessionName: "Alpha"
      },
      {
        sessionId: "session-b",
        sessionName: "Beta",
        stepMachine: {
          status: "awaiting_agent_result"
        }
      },
      {
        agentThinking: false,
        sessionId: "session-c",
        sessionName: "Gamma"
      }
    ]);
  });

  it("derives artifact subresource activity from the current screen sections", () => {
    const session = {
      presentation: {
        screen: {
          sections: [
            {
              kind: "response_preview"
            },
            {
              kind: "conversation"
            }
          ]
        }
      }
    };

    expect(sessionScreenSections(session)).toHaveLength(2);
    expect(sessionScreenHasSection(session, "response_preview")).toBe(true);
    expect(sessionScreenHasSection(session, "report_preview")).toBe(false);
    expect(sessionScreenHasAnySection(session, [
      "report_preview",
      "response_preview"
    ])).toBe(true);
    expect(sessionScreenHasAnySection({
      presentation: {
        screen: {
          sections: []
        }
      }
    }, [
      "report_preview",
      "response_preview"
    ])).toBe(false);
  });

  it("activates declared artifact previews while readiness initializes", () => {
    const session = {
      presentation: {
        screen: {
          sections: [
            {
              kind: "report_preview"
            }
          ]
        }
      }
    };

    expect(artifactPreviewSubresourceActive({
      active: true,
      initialized: false,
      sectionKind: "report_preview",
      session
    })).toBe(true);

    expect(artifactPreviewSubresourceActive({
      active: true,
      initialized: true,
      sectionKind: "report_preview",
      session
    })).toBe(true);
  });

  it("does not refresh selected session data for the initial artifact readiness snapshot", () => {
    expect(artifactReadinessChangeRefreshDecision({
      active: true,
      initialized: true,
      initializedSessionId: "",
      sessionId: "session-1",
      stepStatus: "ready",
      version: "report.md:ready:fingerprint"
    })).toEqual({
      initializedSessionId: "session-1",
      refresh: false
    });

    expect(artifactReadinessChangeRefreshDecision({
      active: true,
      initialized: true,
      initializedSessionId: "session-1",
      sessionId: "session-1",
      stepStatus: "ready",
      version: "report.md:ready:next"
    })).toEqual({
      initializedSessionId: "session-1",
      refresh: true
    });

    expect(artifactReadinessChangeRefreshDecision({
      active: true,
      initialized: true,
      initializedSessionId: "session-1",
      sessionId: "session-1",
      stepStatus: "awaiting_agent_result",
      version: "report.md:ready:next"
    })).toEqual({
      initializedSessionId: "session-1",
      refresh: false
    });
  });

  it("builds assistant control command bodies from command context", () => {
    const payload = agentTurnControlPayloadFromContext({
      fields: {
        conversationRequest: "Especially the drying part"
      },
      message: "Especially the drying part",
      sessionId: "2026-06-22_04-04-58"
    });
    expect(payload).toMatchObject({
      fields: {
        conversationRequest: "Especially the drying part"
      },
      message: "Especially the drying part"
    });
    expect(payload.originId).toMatch(/^tab:/u);

    expect(agentTurnControlPayloadFromContext({
      afterSubmissionId: "composer:initial",
      reason: "user_interrupt",
      sessionId: "2026-06-22_04-04-58"
    })).toMatchObject({
      afterSubmissionId: "composer:initial",
      reason: "user_interrupt"
    });

    expect(agentTurnControlPayloadFromContext({
      agentSettings: {
        model: "gpt-5"
      },
      sessionId: "2026-06-22_04-04-58"
    })).toMatchObject({
      agentSettings: {
        model: "gpt-5"
      }
    });

    const defaultSettingsMessage = agentTurnControlPayloadFromContext({
      agentSettings: null,
      composerSubmissionId: "composer:test",
      displayFields: {
        conversationRequest: "Use the default agent settings"
      },
      fields: {
        conversationRequest: "Use the default agent settings"
      },
      message: "Use the default agent settings",
      sessionId: "2026-06-22_04-04-58"
    });
    expect(defaultSettingsMessage).toMatchObject({
      message: "Use the default agent settings"
    });
    expect(defaultSettingsMessage).not.toHaveProperty("agentSettings");
    expect(() => validateSchemaPayload(
      agentMessageInputValidator,
      defaultSettingsMessage,
      {
        context: "agent message request contract"
      }
    )).not.toThrow();
  });
});
