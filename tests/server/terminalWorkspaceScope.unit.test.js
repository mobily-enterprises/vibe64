import assert from "node:assert/strict";
import test from "node:test";

import {
  runWithWorkspaceRequestContext
} from "../../packages/vibe64-core/src/server/workspaceRequestContext.js";
import {
  codexTerminalNamespace,
  commandTerminalNamespace,
  fixCodexTerminalNamespace,
  globalCodexTerminalNamespace,
  launchTargetTerminalNamespace,
  shellTerminalNamespace,
  toolTerminalNamespace
} from "../../packages/vibe64-terminals/src/server/terminalShared.js";

test("Vibe64 terminal namespaces include the active workspace scope", async () => {
  const globalNamespace = codexTerminalNamespace("session-1");

  const alpha = await runWithWorkspaceRequestContext({
    slug: "alpha_1",
    targetRoot: "/tmp/vibe64/alpha_1"
  }, () => ({
    codex: codexTerminalNamespace("session-1"),
    command: commandTerminalNamespace("session-1"),
    fix: fixCodexTerminalNamespace("job-1"),
    globalCodex: globalCodexTerminalNamespace(),
    launch: launchTargetTerminalNamespace("session-1"),
    shell: shellTerminalNamespace("session-1"),
    tool: toolTerminalNamespace("doctor")
  }));

  const beta = await runWithWorkspaceRequestContext({
    slug: "beta-2",
    targetRoot: "/tmp/vibe64/beta-2"
  }, () => ({
    codex: codexTerminalNamespace("session-1"),
    command: commandTerminalNamespace("session-1"),
    fix: fixCodexTerminalNamespace("job-1"),
    globalCodex: globalCodexTerminalNamespace(),
    launch: launchTargetTerminalNamespace("session-1"),
    shell: shellTerminalNamespace("session-1"),
    tool: toolTerminalNamespace("doctor")
  }));

  assert.equal(globalNamespace, "vibe64-codex:global:session-1");
  assert.equal(alpha.codex, "vibe64-codex:workspace:alpha_1:session-1");
  assert.equal(alpha.command, "vibe64-command:workspace:alpha_1:session-1");
  assert.equal(alpha.fix, "vibe64-fix-codex:workspace:alpha_1:job-1");
  assert.equal(alpha.globalCodex, "vibe64-global-codex:workspace:alpha_1");
  assert.equal(alpha.launch, "vibe64-launch-target:workspace:alpha_1:session-1");
  assert.equal(alpha.shell, "vibe64-shell:workspace:alpha_1:session-1");
  assert.equal(alpha.tool, "vibe64-tool:workspace:alpha_1:doctor");
  assert.notEqual(alpha.codex, beta.codex);
  assert.notEqual(alpha.command, beta.command);
  assert.notEqual(alpha.fix, beta.fix);
  assert.notEqual(alpha.globalCodex, beta.globalCodex);
  assert.notEqual(alpha.launch, beta.launch);
  assert.notEqual(alpha.shell, beta.shell);
  assert.notEqual(alpha.tool, beta.tool);
});
