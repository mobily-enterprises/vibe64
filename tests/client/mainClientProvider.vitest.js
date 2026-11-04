import { describe, expect, it, vi } from "vitest";
import { createCapabilityRuntime } from "@jskit-ai/kernel/shared/capabilities";

vi.mock("/src/components/menus/MenuLinkItem.vue", () => ({ default: { name: "MenuLinkItem" } }));
vi.mock("/src/components/menus/SurfaceAwareMenuLinkItem.vue", () => ({
  default: { name: "SurfaceAwareMenuLinkItem" }
}));
vi.mock("/src/components/menus/TabLinkItem.vue", () => ({ default: { name: "TabLinkItem" } }));
vi.mock("/src/components/menus/TopActionLinkItem.vue", () => ({ default: { name: "TopActionLinkItem" } }));
vi.mock("/src/components/studio/Vibe64ActiveSessionNavItem.vue", () => ({
  default: { name: "Vibe64ActiveSessionNavItem" }
}));

import {
  attachVibe64RealtimeQueryRecovery
} from "../../packages/main/src/client/vibe64RealtimeQueries.js";
import { MainClientProvider } from "../../packages/main/src/client/providers/MainClientProvider.js";
import {
  isVibe64LiveQuery
} from "../../src/lib/vibe64LiveQueryRecovery.js";

function createRealtimeDouble() {
  const listeners = new Map();

  return {
    socket: {
      on(event, listener) {
        listeners.set(event, listener);
      },
      off(event, listener) {
        if (listeners.get(event) === listener) {
          listeners.delete(event);
        }
      }
    },
    emit(event) {
      return listeners.get(event)?.();
    }
  };
}

describe("MainClientProvider realtime integration", () => {
  it("captures current client capabilities and recovers active Vibe64 queries after reconnect", async () => {
    const registeredComponents = new Map();
    const realtime = createRealtimeDouble();
    const invalidateQueries = vi.fn(async () => null);
    const runtime = createCapabilityRuntime({
      providers: [MainClientProvider],
      inputs: {
        "client.components": {
          register(id, component) {
            registeredComponents.set(id, component);
          }
        },
        "client.query": { invalidateQueries },
        "client.realtime": realtime
      }
    });

    await runtime.start();
    expect(registeredComponents.size).toBe(5);
    await realtime.emit("connect");

    expect(invalidateQueries).toHaveBeenCalledTimes(1);
    const [{ predicate, refetchType }] = invalidateQueries.mock.calls[0];
    expect(refetchType).toBe("active");
    expect(predicate({ queryKey: ["vibe64", "project", "beepollen", "sessions"] })).toBe(true);
    expect(predicate({ queryKey: ["other", "project", "beepollen"] })).toBe(false);

    await runtime.shutdown();
    await realtime.emit("connect");
    expect(invalidateQueries).toHaveBeenCalledTimes(1);
  });

  it("recognises Vibe64 live queries by their key", () => {
    expect(isVibe64LiveQuery({ queryKey: ["vibe64", "sessions"] })).toBe(true);
    expect(isVibe64LiveQuery({ queryKey: ["other", "sessions"] })).toBe(false);
  });

  it("attaches directly to the realtime capability and returns an explicit detach function", () => {
    const realtime = createRealtimeDouble();
    const invalidateQueries = vi.fn();
    const detach = attachVibe64RealtimeQueryRecovery({
      queryClient: { invalidateQueries },
      realtime
    });

    realtime.emit("connect");
    expect(invalidateQueries).toHaveBeenCalledTimes(1);
    detach();
    realtime.emit("connect");
    expect(invalidateQueries).toHaveBeenCalledTimes(1);
  });
});
