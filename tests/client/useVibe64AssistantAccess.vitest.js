import fs from "node:fs";
import path from "node:path";
import { effectScope, nextTick, ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

const endpointMocks = vi.hoisted(() => ({
  options: [],
  resources: [],
  useEndpointResource: vi.fn()
}));
const commandMocks = vi.hoisted(() => ({
  command: null,
  options: null,
  useCommand: vi.fn()
}));

vi.mock("@jskit-ai/http-web/client/composables/useEndpointResource", () => ({
  useEndpointResource: endpointMocks.useEndpointResource
}));

vi.mock("@jskit-ai/http-web/client/composables/useCommand", () => ({
  useCommand: commandMocks.useCommand
}));

vi.mock("@/composables/useVibe64ProjectScope.js", () => ({
  useVibe64ProjectSlug() {
    return ref("project-a");
  }
}));

vi.mock("@jskit-ai/shell-web/client/navigation/usePaths", () => ({
  usePaths() {
    return {
      api: (suffix) => `/api/${suffix}`
    };
  }
}));

import {
  useVibe64AssistantAccess
} from "../../src/composables/useVibe64AssistantAccess.js";
import {
  useVibe64AssistantCatalog
} from "../../src/composables/useVibe64AssistantCatalog.js";

function resource(data = null) {
  return {
    data: ref(data),
    isInitialLoading: ref(data === null),
    isLoading: ref(data === null),
    loadError: ref(""),
    reload: vi.fn(async () => null)
  };
}

describe("useVibe64AssistantAccess", () => {
  beforeEach(() => {
    endpointMocks.options.length = 0;
    endpointMocks.resources = [resource(), resource()];
    endpointMocks.useEndpointResource.mockReset();
    endpointMocks.useEndpointResource.mockImplementation((options) => {
      endpointMocks.options.push(options);
      return endpointMocks.resources[endpointMocks.options.length - 1];
    });
    commandMocks.command = {
      run: vi.fn(async () => ({ ok: true }))
    };
    commandMocks.options = null;
    commandMocks.useCommand.mockReset();
    commandMocks.useCommand.mockImplementation((options) => {
      commandMocks.options = options;
      return commandMocks.command;
    });
  });

  it("loads configured session choices without provider or model catalogs", () => {
    endpointMocks.resources = [resource({ engines: [] }), resource({ engines: [] }), resource({ engines: [] })];
    const scope = effectScope();
    scope.run(() => useVibe64AssistantCatalog({
      active: ref(true),
      configuredOnly: true
    }));

    expect(endpointMocks.options).toHaveLength(3);
    expect(endpointMocks.options[0].enabled.value).toBe(true);
    expect(endpointMocks.options[0].queryKey.value.at(-1)).toBe("overview:configured:all");
    expect(endpointMocks.options[0].readQuery.value).toEqual({
      configuredOnly: "true",
      limit: "100"
    });
    expect(endpointMocks.options[1].enabled.value).toBe(false);
    expect(endpointMocks.options[2].enabled.value).toBe(false);
    scope.stop();
  });

  it("hydrates access and queue resources for warm-cache and realtime navigation", async () => {
    endpointMocks.resources = [
      resource({
        accessLabel: "Workspace use",
        available: true,
        canRequestMessage: false,
        canUse: true,
        ok: true
      }),
      resource({ canManage: false, ok: true, suggestions: [] })
    ];
    const scope = effectScope();
    const sessionId = ref("session-a");
    const access = scope.run(() => useVibe64AssistantAccess({
      sessionId,
      sessionsApiPath: ref("/api/vibe64/sessions")
    }));

    expect(endpointMocks.options).toHaveLength(2);
    expect(endpointMocks.options[0].path.value).toBe(
      "/api/vibe64/sessions/session-a/assistant-access"
    );
    expect(endpointMocks.options[1].path.value).toBe(
      "/api/vibe64/sessions/session-a/message-suggestions"
    );
    expect(endpointMocks.options[0].queryOptions.refetchOnMount).toBe("always");
    expect(endpointMocks.options[1].queryOptions.refetchOnMount).toBe("always");
    expect(endpointMocks.options[0].queryOptions.refetchOnWindowFocus).toBe(true);
    expect(access.accessLabel.value).toBe("Workspace use");
    expect(access.canUseAi.value).toBe(true);
    expect(access.canSubmitMainChat.value).toBe(true);
    expect(endpointMocks.options[0].realtime.events).toEqual([
      "vibe64.session.changed",
      "vibe64.connections.changed"
    ]);
    expect(endpointMocks.options[0].realtime.matches({
      event: "vibe64.connections.changed",
      payload: { connectionId: "openai" }
    })).toBe(true);

    sessionId.value = "session-b";
    await nextTick();
    expect(endpointMocks.options[0].path.value).toBe(
      "/api/vibe64/sessions/session-b/assistant-access"
    );
    expect(endpointMocks.options[0].realtime.matches({
      payload: { sessionId: "session-b" }
    })).toBe(true);
    expect(endpointMocks.options[0].realtime.matches({
      payload: { sessionId: "session-a" }
    })).toBe(false);
    expect(endpointMocks.options[0].realtime.matches({
      event: "vibe64.session.changed",
      payload: {
        assistantProgress: { type: "tool" },
        reason: "opencode-server-progress",
        sessionId: "session-b"
      }
    })).toBe(false);
    expect(endpointMocks.options[0].realtime.matches({
      event: "vibe64.session.changed",
      payload: {
        reason: "opencode-server-turn-idle",
        sessionId: "session-b"
      }
    })).toBe(false);
    scope.stop();
  });

  it("keeps access pending while the active session request path hydrates", async () => {
    const accessResource = resource();
    accessResource.isInitialLoading.value = false;
    accessResource.isLoading.value = false;
    endpointMocks.resources = [accessResource, resource({
      canManage: false,
      ok: true,
      suggestions: []
    })];
    const scope = effectScope();
    const active = ref(true);
    const sessionId = ref("");
    const access = scope.run(() => useVibe64AssistantAccess({
      active,
      sessionId,
      sessionsApiPath: ref("/api/vibe64/sessions")
    }));

    expect(endpointMocks.options[0].enabled.value).toBe(false);
    expect(access.initialAccessLoading.value).toBe(true);

    sessionId.value = "session-a";
    accessResource.isInitialLoading.value = true;
    accessResource.isLoading.value = true;
    await nextTick();

    expect(endpointMocks.options[0].enabled.value).toBe(true);
    expect(access.initialAccessLoading.value).toBe(true);

    accessResource.data.value = {
      accessLabel: "Workspace use",
      available: true,
      canUse: true,
      ok: true
    };
    accessResource.isInitialLoading.value = false;
    accessResource.isLoading.value = false;
    await nextTick();

    expect(access.initialAccessLoading.value).toBe(false);

    active.value = false;
    accessResource.data.value = null;
    await nextTick();
    expect(access.initialAccessLoading.value).toBe(false);
    scope.stop();
  });

  it("turns a personal member's main-chat message into a suggestion only", async () => {
    endpointMocks.resources = [
      resource({
        accessLabel: "Personal use",
        available: true,
        canRequestMessage: true,
        canUse: false,
        ownerOnly: true,
        ok: true
      }),
      resource({
        canManage: false,
        ok: true,
        suggestions: [{ id: "suggestion-a", status: "pending" }]
      })
    ];
    const scope = effectScope();
    const access = scope.run(() => useVibe64AssistantAccess({
      sessionId: ref("session-a"),
      sessionsApiPath: ref("/api/vibe64/sessions")
    }));

    expect(access.canUseAi.value).toBe(false);
    expect(access.canRequestMessage.value).toBe(true);
    expect(access.canSubmitMainChat.value).toBe(true);
    expect(access.restrictionMessage.value).toContain("request a main-chat message");
    expect(access.pendingSuggestions.value.map(({ id }) => id)).toEqual(["suggestion-a"]);

    const result = await access.suggestMessage({
      attachmentIds: ["attachment-a"],
      message: "Please review this"
    });
    expect(result.suggested).toBe(true);
    expect(commandMocks.command.run).toHaveBeenCalledWith({
      body: {
        attachmentIds: ["attachment-a"],
        message: "Please review this"
      },
      path: "/api/vibe64/sessions/session-a/message-suggestions"
    });
    expect(endpointMocks.resources[1].reload).toHaveBeenCalledTimes(1);
    scope.stop();
  });

  it("approves a request through the session's current AI without route confirmation", async () => {
    endpointMocks.resources = [
      resource({
        accessLabel: "Personal use",
        available: true,
        canRequestMessage: false,
        canUse: true,
        ownerOnly: true,
        ok: true
      }),
      resource({
        canManage: true,
        ok: true,
        suggestions: [{ id: "suggestion-a", status: "pending" }]
      })
    ];
    const scope = effectScope();
    const access = scope.run(() => useVibe64AssistantAccess({
      sessionId: ref("session-a"),
      sessionsApiPath: ref("/api/vibe64/sessions")
    }));

    await access.approveSuggestion("suggestion-a");
    expect(commandMocks.command.run).toHaveBeenCalledWith({
      body: {},
      path: "/api/vibe64/sessions/session-a/message-suggestions/suggestion-a/approve"
    });
    scope.stop();
  });

  it("uses zero normal footer space and opens pending suggestions from an alert", () => {
    const autopilot = fs.readFileSync(path.resolve(
      "src/components/studio/vibe64-session/Vibe64AutopilotView.vue"
    ), "utf8");
    const panel = fs.readFileSync(path.resolve(
      "src/components/studio/vibe64-session/Vibe64AssistantAccessPanel.vue"
    ), "utf8");
    const assistantMenuSource = fs.readFileSync(path.resolve(
      "src/components/studio/vibe64-session/Vibe64SessionAssistantMenu.vue"
    ), "utf8");
    const modelControlSource = fs.readFileSync(path.resolve("node_modules/@jskit-ai/assistant-core/src/client/conversation/AssistantModelControl.vue"), "utf8");
    const assistantDialog = fs.readFileSync(path.resolve(
      "src/components/studio/vibe64-session/Vibe64AssistantSessionDialog.vue"
    ), "utf8");
    const footerStart = autopilot.indexOf('<template #footer="{ attachmentState }">');
    const accessControl = autopilot.indexOf("<Vibe64AssistantAccessPanel");
    const assistantMenu = autopilot.indexOf("<Vibe64SessionAssistantMenu", footerStart);

    expect(footerStart).toBeGreaterThan(-1);
    expect(accessControl).toBeGreaterThan(footerStart);
    expect(accessControl).toBeGreaterThan(assistantMenu);
    expect(assistantMenuSource).toContain('<slot name="access" />');
    expect(panel).toContain('<v-dialog v-model="queueOpen"');
    expect(panel).toContain('@click="queueOpen = true"');
    expect(panel).toContain('v-if="accessError || suggestionsRelevant"');
    expect(panel).toContain("props.suggestionsError ||\n  props.pendingSuggestions.length");
    expect(panel).toMatch(/\.vibe64-assistant-access \{[\s\S]*?display: flex;/u);
    expect(panel).not.toContain("<v-chip");
    expect(panel).not.toContain("Workspace use");
    expect(panel).not.toContain("border-block:");
    expect(autopilot).toContain(':access-label="assistantAccessLabel"');
    expect(autopilot).toContain(':access-loading="assistantAccessLoading"');
    expect(autopilot).toContain(':can-configure="assistantSuggestionsCanManage"');
    expect(autopilot).toContain(':changes-disabled="composerSending || agentActive"');
    expect(modelControlSource).toContain('aria-label="AI session selector"');
    expect(modelControlSource).toContain('AI choices are view-only while the assistant is working.');
    expect(assistantMenuSource).not.toMatch(/aria-label="Choose AI"[\s\S]{0,180}:disabled=/u);
    expect(assistantMenuSource).toContain('providerConnectedOnly: true');
    expect(assistantMenuSource).toContain('active: catalogActive');
    expect(assistantMenuSource).toContain('props.session?.sessionId && engineId.value');
    expect(assistantMenuSource).toContain('provider.connected === true');
    expect(assistantMenuSource).toContain('model.status === "available"');
    expect(assistantMenuSource).toContain('watch([menuOpen, modelProvider, modelRows]');
    expect(assistantMenuSource).toContain('model.id === provider.defaultModelId');
    expect(assistantMenuSource).not.toContain('appendIcon: mdiLockOutline');
    expect(assistantMenuSource).not.toContain('vibe64-session-assistant-menu__option--locked');
    expect(assistantMenuSource).toContain(':icon="mdiLockOutline"');
    expect(assistantMenuSource).toContain('modelAccess.label');
    expect(assistantMenuSource).toContain('Unlock paid models');
    expect(assistantMenuSource).toContain('restoreRecommendedModel');
    expect(assistantMenuSource).toContain('vibe64AssistantModelAccessPath');
    expect(modelControlSource).toContain('aria-label="Model"');
    expect(modelControlSource).toContain('aria-label="Thinking"');
    expect(assistantMenuSource).toContain('watch(assistantSelection, hydrateSelection, { immediate: true });');
    expect(assistantMenuSource).toContain('void reloadCatalog().catch(() => null);');
    expect(assistantMenuSource).not.toContain('<v-select');
    expect(assistantMenuSource).not.toContain('label="Agent"');
    expect(assistantMenuSource).toContain('v-if="canConfigure"');
    expect(assistantMenuSource).toContain('Configure more AIs');
    expect(assistantMenuSource).not.toContain("Vibe64AssistantSessionDialog");
    expect(assistantMenuSource).not.toContain("disabledReason");
    expect(assistantDialog).toContain('configuredOnly: true');
    expect(assistantDialog).toContain('active: true');
    expect(assistantDialog).toContain('aria-label="Connected AI"');
    expect(assistantDialog).toContain('<v-radio-group');
    expect(assistantDialog).toContain('label: engine.engineId === "codex" ? "Codex" : engine.engineId === "claude" ? "Claude" : model.label');
    expect(assistantDialog).toContain('Claude account · ${model.label}');
    expect(assistantDialog).not.toContain('Recommended');
    expect(assistantDialog).toContain('preferred: provider.preferred === true');
    expect(assistantDialog).toContain('Number(right.preferred) - Number(left.preferred)');
    expect(assistantDialog).toContain('available.find((choice) => choice.preferred)?.id');
    expect(assistantDialog).toContain('selectedChoiceId.value = defaultChoiceId();');
    expect(assistantDialog).toContain('type="list-item-two-line"');
    expect(assistantDialog).toContain('No AI is connected');
    expect(assistantDialog).not.toContain('Search providers');
    expect(assistantDialog).not.toContain('Customize');
  });
});
