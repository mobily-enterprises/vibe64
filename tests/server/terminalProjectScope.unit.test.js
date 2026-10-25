import assert from "node:assert/strict";
import test from "node:test";
import { createService } from "../../packages/vibe64-terminals/src/server/service.js";

import {
  runWithProjectRequestContext
} from "../../packages/vibe64-core/src/server/projectRequestContext.js";
import {
  SESSION_SOURCE_PATH_AUTHORITY_MANAGED,
  sessionSourcePath
} from "../../packages/vibe64-core/src/server/sessionSourcePath.js";
import {
  codexTerminalNamespace,
  globalCodexTerminalNamespace,
  outputTargetTerminalNamespace
} from "../../packages/vibe64-terminals/src/server/terminalShared.js";

test("Vibe64 terminal namespaces include the active project scope", async () => {
  const globalNamespace = codexTerminalNamespace("session-1");

  const alpha = await runWithProjectRequestContext({
    slug: "alpha_1",
    targetRoot: "/tmp/vibe64/alpha_1"
  }, () => ({
    codex: codexTerminalNamespace("session-1"),
    globalCodex: globalCodexTerminalNamespace(),
    output: outputTargetTerminalNamespace("session-1")
  }));

  const beta = await runWithProjectRequestContext({
    slug: "beta-2",
    targetRoot: "/tmp/vibe64/beta-2"
  }, () => ({
    codex: codexTerminalNamespace("session-1"),
    globalCodex: globalCodexTerminalNamespace(),
    output: outputTargetTerminalNamespace("session-1")
  }));

  assert.equal(globalNamespace, "vibe64-codex:global:session-1");
  assert.equal(alpha.codex, "vibe64-codex:project:alpha_1:session-1");
  assert.equal(alpha.globalCodex, "vibe64-global-codex:project:alpha_1");
  assert.equal(alpha.output, "vibe64-output-target:project:alpha_1:session-1");
  assert.notEqual(alpha.codex, beta.codex);
  assert.notEqual(alpha.globalCodex, beta.globalCodex);
  assert.notEqual(alpha.output, beta.output);
});

test("Vibe64 terminal roots prefer the selected session source path", () => {
  const sourcePath = "/tmp/vibe64/managed-source/sessions/active/session-1/source";
  const session = {
    metadata: {
      source_kind: "session_clone",
      source_path: sourcePath,
      source_path_authority: SESSION_SOURCE_PATH_AUTHORITY_MANAGED
    },
    sessionId: "session-1",
    targetRoot: "/srv/vibe64/merc/projects/demo"
  };
  assert.equal(sessionSourcePath(session), sourcePath);
});

test("Vibe64 terminal roots never fall back to the hosted namespace", () => {
  const hostedNamespace = "/srv/vibe64/merc/projects/demo";
  const session = {
    sessionId: "session-without-source",
    targetRoot: hostedNamespace
  };
  assert.equal(sessionSourcePath(session), "");
});

test("shared conversation hosts preserve Claude's native profile lookup", () => {
  for (const env of [{}, { CLAUDE_CONFIG_DIR: "/tmp/selected-claude-profile" }, { CLAUDE_CONFIG_DIR: "" }]) {
    const unused = () => assert.fail("Preparing a shared host must not read or change project state.");
    const service = createService({ env, projectService: { readCurrentProject: unused, readEnv: unused,
      runInProjectContext: unused, saveEnvUserValues: unused, createRuntime: unused, createSessionStore: unused } });
    const host = service.createConversationHost({ id: "colleague-profile", workdir: "/tmp/colleague-profile",
      runtimeRoot: "/tmp/colleague-profile-runtime" });
    assert.equal(host.allowAccountChange, false);
    assert.equal(service.createConversationHost({ id: "authorized-colleague", workdir: "/tmp/colleague-profile",
      runtimeRoot: "/tmp/colleague-profile-runtime", allowAccountChange: true }).allowAccountChange, true);
    assert.equal(host.env.CLAUDE_CONFIG_DIR, env.CLAUDE_CONFIG_DIR,
      "Inventing a config override relocates the CLI's existing account profile.");
  }
});

test("opt-in browser opening timings retain failure boundaries without request or account data", async () => {
  for (const enabled of [false, true]) {
    for (const failSessionRead of [false, true]) {
      const events = [];
      const privateFailure = new Error("private account detail must not enter timing logs");
      const runtime = { async getSession() {
        if (failSessionRead) throw privateFailure;
        return { metadata: {} }; // Selection is unavailable; native opening must still fail.
      } };
      const unused = () => assert.fail("A failed browser read must not start work.");
      const service = createService({ env: { JSKIT_REALTIME_DEBUG: enabled ? "1" : "0" },
        logger: { warn: event => events.push(event) },
        projectService: { readCurrentProject: unused, readEnv: unused, runInProjectContext: unused,
          saveEnvUserValues: unused, createRuntime: async () => runtime, createSessionStore: unused } });
      await assert.rejects(service.openBrowserConversation("session-1", {}), { code: "conversation_forbidden" });
      assert.equal(events.length, 0, "Unadmitted handles do not enter diagnostics");
      await assert.rejects(service.openBrowserConversation("session-1", {
        browserAuthority: { sessionId: "session-1", requestContext: { secret: "private request" } }
      }), failSessionRead ? error => error === privateFailure : error => Boolean(error));
      assert.equal(events.length, enabled ? (failSessionRead ? 1 : 2) : 0);
      if (!enabled) continue;
      assert.equal(events.at(-1).phase, failSessionRead ? "session-read" : "native-open");
      assert.equal(events.at(-1).completed, false);
      for (const event of events) {
        assert.equal(event.event, "vibe64.conversation.browser_timing");
        assert.ok(event.durationMs >= 0 && Number.isFinite(event.durationMs));
        assert.equal(JSON.stringify(event).includes("private"), false);
      }
    }
  }
});
