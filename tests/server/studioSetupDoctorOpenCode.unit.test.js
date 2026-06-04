import assert from "node:assert/strict";
import test from "node:test";

import {
  REINSTALL_OPENCODE_CLI_TERMINAL_PREVIEW,
  reinstallOpenCodeCliRepair,
  reinstallOpenCodeCliScript,
  reinstallOpenCodeCliTerminalScript
} from "../../packages/studio-setup-doctor/src/server/service.js";

test("Studio Setup Doctor exposes an OpenCode CLI repair contract", () => {
  const repair = reinstallOpenCodeCliRepair();

  assert.equal(repair.actionId, "reinstall-opencode-cli");
  assert.equal(repair.label, "Reinstall OpenCode CLI");
  assert.match(repair.commandPreview, /opencode-ai@latest/u);
});

test("OpenCode CLI repair script reinstalls and verifies opencode", () => {
  const script = reinstallOpenCodeCliScript();

  assert.match(script, /npm install -g opencode-ai@latest/u);
  assert.match(script, /opencode --version/u);
});

test("OpenCode CLI terminal repair script uses the OpenCode preview label", () => {
  const script = reinstallOpenCodeCliTerminalScript();

  assert.equal(REINSTALL_OPENCODE_CLI_TERMINAL_PREVIEW, "Reinstall OpenCode CLI inside the managed Studio toolchain");
  assert.match(script, /Vibe64 setup: reinstalling OpenCode CLI/u);
  assert.match(script, /opencode-ai@latest/u);
});
