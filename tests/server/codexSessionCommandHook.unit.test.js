import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const hookPath = fileURLToPath(new URL(
  "../../packages/vibe64-runtime/src/server/agentSessionCommandHook.js",
  import.meta.url
));

function runHook(input = {}) {
  const result = spawnSync(process.execPath, [hookPath], {
    encoding: "utf8",
    input: JSON.stringify(input)
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test("Codex rewrites every Bash tool command through the session-owned command wrapper", () => {
  const command = "/usr/bin/google-chrome --headless https://example.test >/tmp/chrome.log 2>&1 &";
  const output = runHook({
    hook_event_name: "PreToolUse",
    tool_input: { command },
    tool_name: "Bash"
  });

  assert.equal(output.hookSpecificOutput.permissionDecision, "allow");
  const rewritten = output.hookSpecificOutput.updatedInput.command;
  assert.match(rewritten, /VIBE64_WRAPPER/u);
  assert.equal(rewritten, `"$VIBE64_WRAPPER" '${command}'`);
  assert.doesNotMatch(rewritten, /Reconnect the assistant/u);
});

test("Codex denies a Bash tool call without command text", () => {
  const output = runHook({
    hook_event_name: "PreToolUse",
    tool_input: {},
    tool_name: "Bash"
  });

  assert.equal(output.hookSpecificOutput.permissionDecision, "deny");
  assert.match(output.hookSpecificOutput.permissionDecisionReason, /without valid command text/u);
});

test("The shared Claude/Codex shell hook retains native background and timeout settings", () => {
  for (const settings of [
    { run_in_background: true, timeout: 7200000, description: "Run the reference server" },
    { run_in_background: false, timeout: 5000, description: "Read server status" }
  ]) {
    const input = { command: "printf '%s' 'reference server'", ...settings };
    const output = runHook({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: input });
    const { command, ...retained } = output.hookSpecificOutput.updatedInput;
    assert.equal(output.hookSpecificOutput.permissionDecision, "allow");
    assert.deepEqual(retained, settings);
    assert.match(command, /^"\$VIBE64_WRAPPER" /u);
  }
});
