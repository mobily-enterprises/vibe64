import { effectScope, nextTick, ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

const endpointMocks = vi.hoisted(() => ({
  options: [],
  resources: [],
  useEndpointResource: vi.fn()
}));
vi.mock("@jskit-ai/http-web/client/composables/useEndpointResource", () => ({
  useEndpointResource: endpointMocks.useEndpointResource
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
    endpointMocks.resources = [resource()];
    endpointMocks.useEndpointResource.mockReset();
    endpointMocks.useEndpointResource.mockImplementation((options) => {
      endpointMocks.options.push(options);
      return endpointMocks.resources[endpointMocks.options.length - 1];
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

  it("hydrates access for warm-cache and realtime navigation", async () => {
    endpointMocks.resources = [
      resource({
        accessLabel: "Workspace use",
        available: true,
        canUse: true,
        ok: true
      })
    ];
    const scope = effectScope();
    const sessionId = ref("session-a");
    const access = scope.run(() => useVibe64AssistantAccess({
      sessionId,
      sessionsApiPath: ref("/api/vibe64/sessions")
    }));

    expect(endpointMocks.options).toHaveLength(1);
    expect(endpointMocks.options[0].path.value).toBe(
      "/api/vibe64/sessions/session-a/assistant-access"
    );
    expect(endpointMocks.options[0].queryOptions.refetchOnMount).toBe("always");
    expect(endpointMocks.options[0].queryOptions.refetchOnWindowFocus).toBe(true);
    expect(access.accessLabel.value).toBe("Workspace use");
    expect(access.canUseAi.value).toBe(true);
    expect(access.canUseChat.value).toBe(true);
    expect(endpointMocks.options[0].realtime.events).toEqual([
      "vibe64.session.changed",
      "vibe64.connections.changed",
      "vibe64.accounts.changed"
    ]);
    expect(endpointMocks.options[0].realtime.matches({
      event: "vibe64.connections.changed",
      payload: { connectionId: "openai" }
    })).toBe(true);

    expect(endpointMocks.options[0].realtime.matches({
      event: "vibe64.accounts.changed", payload: { reason: "model-routing-updated" }
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
    })).toBe(true);
    scope.stop();
  });

  it("keeps chat, helpers and Auto availability independent", () => {
    endpointMocks.resources = [resource({
      ok: true, available: true, canUse: true, nativeCanUse: false, canUseAny: true, currentMode: "junior",
      purposes: {
        junior: { available: true, backupUsed: true, effectiveSelection: { engineId: "opencode", modelId: "big-pickle" } },
        auto: { available: false, message: "Choose a compatible Router model." },
        prompt_hint: { available: false, message: "Review the migrated helper settings." }
      }
    })];
    const scope = effectScope();
    const access = scope.run(() => useVibe64AssistantAccess({ sessionId: "session-a", sessionsApiPath: "/api/vibe64/sessions" }));
    expect(access.canUseChat.value).toBe(true);
    expect(access.canUseNative.value).toBe(false);
    expect(access.canRouteChat.value).toBe(true);
    expect(access.canUseAi.value).toBe(true);
    expect(access.canUsePurpose("junior")).toBe(true);
    expect(access.canUsePurpose("auto")).toBe(false);
    expect(access.canUsePurpose("prompt_hint")).toBe(false);
    expect(access.accessLabel.value).toBe("Shared backup");
    expect(access.restrictionMessage.value).toBe("");
    endpointMocks.resources[0].data.value = {
      ...endpointMocks.resources[0].data.value, currentMode: "auto", canUse: false, nativeCanUse: true
    };
    expect(access.canUseChat.value).toBe(false);
    expect(access.canUseNative.value).toBe(true);
    expect(access.canRouteChat.value).toBe(false);
    expect(access.canUseAi.value).toBe(true);
    expect(access.restrictionMessage.value).toContain("compatible Router model");
    scope.stop();
  });

  it("keeps access pending while the active session request path hydrates", async () => {
    const accessResource = resource();
    accessResource.isInitialLoading.value = false;
    accessResource.isLoading.value = false;
    endpointMocks.resources = [accessResource];
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

  it("blocks steering a personal turn while independent helpers remain available", async () => {
    endpointMocks.resources = [resource({
      ok: true, available: true, ownerOnly: true, steering: true, canUse: false, nativeCanUse: false,
      currentMode: "junior", purposes: {
        junior: { available: true }, prompt_hint: { available: true }, source_explanation: { available: true }
      }
    })];
    const scope = effectScope();
    const access = scope.run(() => useVibe64AssistantAccess({ sessionId: "session-a", sessionsApiPath: "/api/vibe64/sessions" }));
    expect(access.canUseChat.value).toBe(false);
    expect(access.canRouteChat.value).toBe(false);
    expect(access.canUsePurpose("prompt_hint")).toBe(true);
    expect(access.canUsePurpose("source_explanation")).toBe(true);
    expect(access.restrictionMessage.value).toContain("Only the owner can steer this turn");
    endpointMocks.resources[0].data.value = { ...endpointMocks.resources[0].data.value, steering: false, canUse: true };
    expect(access.canUseChat.value).toBe(true);
    expect(access.canRouteChat.value).toBe(true);
    expect(access.restrictionMessage.value).toBe("");
    await access.reload();
    expect(endpointMocks.resources[0].reload).toHaveBeenCalledOnce();
    expect(endpointMocks.options).toHaveLength(1);
    scope.stop();
  });
});
