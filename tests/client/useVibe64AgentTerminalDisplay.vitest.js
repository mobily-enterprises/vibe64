import { reactive, ref } from "vue";
import { describe, expect, it } from "vitest";

import { useVibe64AgentTerminalDisplay, vibe64ServerAgentTerminal } from "../../src/composables/useVibe64AgentTerminalDisplay.js";

describe("agent terminal display", () => {
  it("streams while shown, and while hidden only for a listened server terminal", () => {
    const props = reactive({ displayMode: "full", listenWhenHidden: false, visible: true });
    const serverTerminalId = ref("");
    const display = useVibe64AgentTerminalDisplay(props, serverTerminalId);
    expect([display.displayActive.value, display.streamActive.value, display.presentation.value])
      .toEqual([true, true, "inline"]);

    props.displayMode = "headless";
    expect([display.displayActive.value, display.streamActive.value, display.presentation.value])
      .toEqual([false, false, "headless"]);
    props.listenWhenHidden = true;
    expect(display.streamActive.value).toBe(false);
    serverTerminalId.value = "terminal-1";
    expect(display.streamActive.value).toBe(true);
    expect(display.presentation.value).toBe("headless");
  });

  it("reads only an object server terminal record", () => {
    expect(vibe64ServerAgentTerminal({ agentSession: { terminal: { id: "t" } } })).toEqual({ id: "t" });
    expect(vibe64ServerAgentTerminal({ agentSession: { terminal: ["t"] } })).toEqual({});
    expect(vibe64ServerAgentTerminal(null)).toEqual({});
  });
});
