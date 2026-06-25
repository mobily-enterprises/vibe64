import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { effectScope, nextTick, ref } from "vue";

const endpointMocks = vi.hoisted(() => ({
  reload: vi.fn(),
  useEndpointResource: vi.fn()
}));

vi.mock("@jskit-ai/users-web/client/composables/useEndpointResource", () => ({
  useEndpointResource: endpointMocks.useEndpointResource
}));

vi.mock("@/composables/useVibe64ProjectScope.js", async () => {
  const vue = await import("vue");
  return {
    useVibe64ProjectSlug: () => vue.ref("alpha_1")
  };
});

import {
  useVibe64ArtifactReadiness
} from "../../src/composables/useVibe64ArtifactReadiness.js";

describe("useVibe64ArtifactReadiness", () => {
  let originalEventSource;
  let originalWebSocket;
  let originalWindow;

  beforeEach(() => {
    originalEventSource = globalThis.EventSource;
    originalWebSocket = globalThis.WebSocket;
    originalWindow = globalThis.window;
    endpointMocks.reload.mockReset();
    endpointMocks.useEndpointResource.mockReset();
    endpointMocks.useEndpointResource.mockReturnValue({
      data: {
        value: null
      },
      reload: endpointMocks.reload
    });
    FakeEventSource.instances.length = 0;
    FakeWebSocket.instances.length = 0;
    globalThis.EventSource = FakeEventSource;
    globalThis.WebSocket = FakeWebSocket;
    globalThis.window = {
      clearTimeout: globalThis.clearTimeout,
      location: {
        host: "127.0.0.1:4000",
        origin: "http://127.0.0.1:4000",
        pathname: "/app/project/alpha_1"
      },
      setTimeout: globalThis.setTimeout
    };
  });

  afterEach(() => {
    globalThis.EventSource = originalEventSource;
    globalThis.WebSocket = originalWebSocket;
    globalThis.window = originalWindow;
  });

  it("prefers WebSocket artifact readiness over EventSource", async () => {
    const active = ref(true);
    const sessionId = ref("session-1");
    const scope = effectScope();
    let readiness;
    scope.run(() => {
      readiness = useVibe64ArtifactReadiness({
        active,
        sessionId
      });
    });

    expect(FakeEventSource.instances).toHaveLength(0);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(FakeWebSocket.instances[0].url)
      .toBe("ws://127.0.0.1:4000/api/app/alpha_1/vibe64/sessions/session-1/artifact-readiness/ws");

    FakeWebSocket.instances[0].open();
    FakeWebSocket.instances[0].emit({
      artifactReadiness: {
        report: true
      },
      ok: true,
      sessionId: "session-1",
      type: "artifact-readiness.updated"
    });
    await nextTick();

    expect(readiness.initialized.value).toBe(true);
    expect(readiness.readiness.value.artifactReadiness).toEqual({
      report: true
    });

    readiness.closeStream();
    scope.stop();
  });
});

class FakeEventSource extends EventTarget {
  static instances = [];

  constructor(url) {
    super();
    this.url = String(url || "");
    FakeEventSource.instances.push(this);
  }

  close() {}
}

class FakeWebSocket extends EventTarget {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances = [];

  readyState = FakeWebSocket.CONNECTING;

  constructor(url) {
    super();
    this.url = String(url || "");
    FakeWebSocket.instances.push(this);
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED;
    this.dispatchEvent(new Event("close"));
  }

  emit(payload) {
    this.dispatchEvent(new MessageEvent("message", {
      data: JSON.stringify(payload)
    }));
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.dispatchEvent(new Event("open"));
  }
}
