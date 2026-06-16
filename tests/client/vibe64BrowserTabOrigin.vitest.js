import { describe, expect, it } from "vitest";

import {
  VIBE64_BROWSER_TAB_ORIGIN_KEY,
  normalizeOriginId,
  vibe64BrowserTabOriginId,
  vibe64RealtimeOriginPayload,
  vibe64RealtimePayloadFromCurrentTab
} from "../../src/lib/vibe64BrowserTabOrigin.js";

describe("vibe64BrowserTabOrigin", () => {
  it("keeps one origin id per browser tab runtime", () => {
    const root = {
      crypto: {
        randomUUID: () => "origin-1"
      }
    };

    expect(vibe64BrowserTabOriginId(root)).toBe("tab:origin-1");
    root.crypto.randomUUID = () => "origin-2";
    expect(vibe64BrowserTabOriginId(root)).toBe("tab:origin-1");
    expect(root[VIBE64_BROWSER_TAB_ORIGIN_KEY]).toBe("tab:origin-1");
  });

  it("adds the current tab origin to realtime-producing payloads", () => {
    const root = {
      crypto: {
        randomUUID: () => "payload-origin"
      }
    };

    expect(vibe64RealtimeOriginPayload({
      message: "hello"
    }, root)).toEqual({
      message: "hello",
      originId: "tab:payload-origin"
    });
  });

  it("detects realtime payloads emitted by the current tab", () => {
    expect(normalizeOriginId("  tab-1  ")).toBe("tab-1");
    expect(vibe64RealtimePayloadFromCurrentTab({
      originId: "tab-1"
    }, {
      originId: "tab-1"
    })).toBe(true);
    expect(vibe64RealtimePayloadFromCurrentTab({
      originId: "tab-2"
    }, {
      originId: "tab-1"
    })).toBe(false);
    expect(vibe64RealtimePayloadFromCurrentTab({}, {
      originId: "tab-1"
    })).toBe(false);
  });
});
