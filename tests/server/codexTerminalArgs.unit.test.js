import assert from "node:assert/strict";
import test from "node:test";
import { effectiveVibe64AgentExecutionSettings } from "@local/vibe64-runtime/shared";

import {
  codexTerminalArgs
} from "../../packages/vibe64-terminals/src/server/codexTerminal.js";

test("managed Codex terminals pass the hook-trust bypass to Codex", () => {
  const [, startupScript] = codexTerminalArgs({
    codexThreadId: "11111111-1111-4111-8111-111111111111"
  });
  const codexCommands = startupScript
    .split("\n")
    .filter((line) => line.includes("/codex "));

  assert.equal(codexCommands.length, 2);
  for (const command of codexCommands) {
    assert.match(
      command,
      /--dangerously-bypass-approvals-and-sandbox --dangerously-bypass-hook-trust resume/u
    );
  }
});

test("curated Codex terminals and app-server turns agree on automatic reasoning defaults", () => {
  for (const [model, thinking] of [["deepseek-flash", "high"], ["glm-5.3", "max"]]) {
    for (const requested of ["", "low"]) {
      const agentSettings = { providerId: "codex", model, thinking: requested };
      const expected = requested || thinking;
      const [, script] = codexTerminalArgs({ agentSettings });
      assert.ok(script.includes(`model_reasoning_effort="${expected}"`), script);
      assert.equal(script.includes('model_reasoning_effort="xhigh"'), false);
      assert.equal(effectiveVibe64AgentExecutionSettings(agentSettings).thinking, expected);
    }
  }
});
