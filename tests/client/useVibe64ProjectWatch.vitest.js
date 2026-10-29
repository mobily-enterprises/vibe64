import { describe, expect, it, vi } from "vitest";
import { effectScope, nextTick, ref } from "vue";

const harness = vi.hoisted(() => ({ socket: null }));

vi.mock("@jskit-ai/realtime/client/composables/useRealtimeEvent", () => ({
  useRealtimeSocket: () => harness.socket
}));

const { useVibe64ProjectWatch } = await import("../../src/composables/useVibe64ProjectWatch.js");

function fakeSocket() {
  const listeners = new Map();
  return {
    connected: true,
    emitted: [],
    listeners,
    emit(name, input) { this.emitted.push([name.split(".").at(-1), input]); },
    on(name, listener) { listeners.set(name, listener); },
    off(name) { listeners.delete(name); }
  };
}

// A page receives a session's changes in full only while it shows the
// session, and its project's summaries while it has the project open.
describe("useVibe64ProjectWatch", () => {
  it("watches the session a page shows, renews after reconnecting and releases when it goes", async () => {
    const socket = harness.socket = fakeSocket();
    const projectSlug = ref("alpha");
    const sessionId = ref("");
    const scope = effectScope();
    scope.run(() => useVibe64ProjectWatch({ projectSlug, sessionId }));
    expect(socket.emitted).toEqual([], "no session is shown yet");
    sessionId.value = "s1";
    await nextTick();
    socket.listeners.get("connect")();
    sessionId.value = "s2";
    await nextTick();
    const watchId = socket.emitted[0][1].watchId;
    expect(socket.emitted).toEqual([
      ["watch", { watchId, projectSlug: "alpha", sessionId: "s1" }],
      ["watch", { watchId, projectSlug: "alpha", sessionId: "s1" }],
      ["watch", { watchId, projectSlug: "alpha", sessionId: "s2" }]
    ]);
    scope.stop();
    expect(socket.emitted.at(-1)).toEqual(["release", { watchId }]);
    expect(socket.listeners.has("connect")).toBe(false);
  });

  it("watches a project without naming a session", async () => {
    const socket = harness.socket = fakeSocket();
    const projectSlug = ref("alpha");
    const scope = effectScope();
    scope.run(() => useVibe64ProjectWatch({ projectSlug }));
    projectSlug.value = "";
    await nextTick();
    expect(socket.emitted.map(([name, input]) => [name, input.projectSlug || ""])).toEqual([["watch", "alpha"], ["release", ""]]);
    scope.stop();
  });
});
