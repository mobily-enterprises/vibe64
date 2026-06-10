import { describe, expect, it, vi } from "vitest";
import {
  resolveRealtimeClientListeners
} from "@jskit-ai/realtime/client/listeners";

import {
  VIBE64_CAPABILITIES_QUERY_LISTENER,
  invalidateVibe64CapabilitiesQueries,
  isVibe64CapabilitiesQuery,
  registerVibe64CapabilitiesRealtimeListener
} from "../../packages/main/src/client/vibe64CapabilitiesRealtime.js";
import {
  VIBE64_ACCOUNTS_CHANGED_EVENT
} from "../../src/lib/studioGateApi.js";

function createClientAppDouble() {
  const instances = new Map();
  const singletons = new Map();
  const tags = new Map();

  return {
    has(token) {
      return instances.has(token) || singletons.has(token);
    },
    instance(token, value) {
      instances.set(token, value);
    },
    make(token) {
      if (instances.has(token)) {
        return instances.get(token);
      }
      if (!singletons.has(token)) {
        throw new Error(`Missing token: ${String(token)}`);
      }
      const resolved = singletons.get(token)(this);
      instances.set(token, resolved);
      return resolved;
    },
    resolveTag(tagName) {
      const tagged = tags.get(String(tagName || "").trim());
      if (!tagged) {
        return [];
      }
      return [...tagged].map((token) => this.make(token));
    },
    singleton(token, factory) {
      singletons.set(token, factory);
    },
    tag(token, tagName) {
      const normalizedTagName = String(tagName || "").trim();
      if (!tags.has(normalizedTagName)) {
        tags.set(normalizedTagName, new Set());
      }
      tags.get(normalizedTagName).add(token);
    }
  };
}

describe("MainClientProvider realtime integration", () => {
  it("registers an app-level account listener that invalidates capability queries", async () => {
    const app = createClientAppDouble();
    const invalidateQueries = vi.fn(async () => null);
    app.instance("jskit.client.query-client", {
      invalidateQueries
    });

    registerVibe64CapabilitiesRealtimeListener(app);
    const listeners = resolveRealtimeClientListeners(app);
    const listener = listeners.find((entry) => entry.listenerId === VIBE64_CAPABILITIES_QUERY_LISTENER);

    expect(listener).toBeTruthy();
    expect(listener.event).toBe(VIBE64_ACCOUNTS_CHANGED_EVENT);

    await listener.handle({
      app,
      event: VIBE64_ACCOUNTS_CHANGED_EVENT,
      payload: {
        accountId: "codex",
        connected: true,
        status: "connected"
      }
    });

    expect(invalidateQueries).toHaveBeenCalledTimes(1);
    const [{ predicate, refetchType }] = invalidateQueries.mock.calls[0];
    expect(refetchType).toBe("all");
    expect(predicate({ queryKey: ["vibe64", "project", "beepollen", "app", "public", "capabilities"] })).toBe(true);
    expect(predicate({ queryKey: ["vibe64", "project", "beepollen", "app", "public", "sessions"] })).toBe(false);
  });

  it("does not refetch inactive capability queries for in-progress auth events", async () => {
    const app = createClientAppDouble();
    const invalidateQueries = vi.fn(async () => null);
    app.instance("jskit.client.query-client", {
      invalidateQueries
    });

    await invalidateVibe64CapabilitiesQueries(app, {
      event: VIBE64_ACCOUNTS_CHANGED_EVENT,
      payload: {
        accountId: "codex",
        connected: false,
        status: "authenticating"
      }
    });

    expect(invalidateQueries).toHaveBeenCalledTimes(1);
    expect(invalidateQueries.mock.calls[0][0].refetchType).toBe("active");
  });

  it("matches only Vibe64 capabilities query keys", () => {
    expect(isVibe64CapabilitiesQuery({
      queryKey: ["vibe64", "project", "beepollen", "app", "public", "capabilities"]
    })).toBe(true);
    expect(isVibe64CapabilitiesQuery({
      queryKey: ["vibe64", "project", "beepollen", "app", "public", "accounts"]
    })).toBe(false);
    expect(isVibe64CapabilitiesQuery({
      queryKey: ["other", "project", "beepollen", "capabilities"]
    })).toBe(false);
  });

  it("does nothing when the query client has not been registered", async () => {
    expect(await Promise.resolve(invalidateVibe64CapabilitiesQueries(createClientAppDouble()))).toBeNull();
  });
});
