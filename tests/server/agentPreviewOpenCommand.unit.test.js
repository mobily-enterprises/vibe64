import assert from "node:assert/strict";
import test from "node:test";

import { silentLogger } from "@jskit-ai/kernel/server/runtime/logger";
import { AGENT_PREVIEW_USAGE } from "../../packages/vibe64-execution/src/server/index.js";
import { createSessionChangedPublisher } from "../../packages/vibe64-core/src/server/sessionRealtimeEvents.js";
import { createAgentPreviewCommandService } from "../../packages/vibe64-terminals/src/server/agentPreviewCommand.js";
import { previewAppPathError } from "../../packages/vibe64-terminals/src/shared/launchPreviewProtocol.js";
import { sessionPreviewStateInputValidator } from "../../packages/vibe64-sessions/src/server/inputSchemas.js";
import { createSessionCatalogue } from "../../packages/vibe64-sessions/src/server/sessionCatalogue.js";

// `vibe64-helper preview open <path>`: the AI asks the session's editors to
// open a page of the running app in the person's Preview, as its address box
// would, and learns how many Previews moved.
const PROJECT = "notes";
const SESSION = "session-open";

function runningStatus() {
  return {
    activeTerminal: { id: "launch-terminal", running: true, status: "running" },
    lastOutputTarget: { id: "dev" },
    previewTarget: { available: true, href: "https://preview.example.test/?vibe64_preview_token=not-for-print" }
  };
}

// The sessions catalogue receives each editor's answer through its Preview state, as the editor posts it.
const catalogue = createSessionCatalogue({
  project: {},
  publishSessionChanged: async () => {},
  sessionPresence: { close() {} },
  terminals: {}
});

function editorAnswer(requestId, fields = {}) {
  return catalogue.broadcastSessionPreviewState(SESSION, {
    openRequestId: requestId,
    originId: "tab:editor-1",
    projectSlug: PROJECT,
    ...fields
  });
}

/**
 * The command service with a running Preview, whose session changes go through
 * the real publisher into `onEvent` (the editors).
 */
function openCommand({ onEvent = () => {}, status = runningStatus, timeoutMs = 2000 } = {}) {
  const events = [];
  const publishSessionChanged = createSessionChangedPublisher({
    events: {
      async publish(event) {
        events.push(event);
        if (event.type === "entity.changed") await onEvent(event.realtime.payload);
        return true;
      }
    }
  });
  const command = createAgentPreviewCommandService({
    launchTarget: { launchStatus: async () => status() },
    logger: silentLogger,
    previewOpenTimeoutMs: timeoutMs,
    publishSessionChanged,
    readSessionUiState: () => ({ preview: { route: "/", title: "Home" }, projectSlug: PROJECT, sessionId: SESSION })
  });
  return {
    events,
    run: (...args) => command.run({ args: ["open", ...args], sessionId: SESSION })
  };
}

test("preview open moves the person's open Previews to an app page and counts them", async () => {
  const delivered = [];
  const { events, run } = openCommand({
    async onEvent(payload) {
      delivered.push(payload);
      const { requestId } = payload.previewOpen;
      // A foreign session, project or request id is no answer.
      await catalogue.broadcastSessionPreviewState("another-session", { openRequestId: requestId, opened: true, originId: "tab:x", projectSlug: PROJECT });
      await editorAnswer(requestId, { projectSlug: "another-project", opened: true });
      await editorAnswer("not-this-request", { opened: true });
      await editorAnswer(requestId, { opened: true, route: "/orders/42?tab=notes" });
      await editorAnswer(requestId, { originId: "tab:editor-2", opened: true, route: "/orders/42?tab=notes" });
    }
  });

  const result = await run("/orders/42?tab=notes");
  assert.equal(result.ok, true, result.error);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "moved: 2 open Previews to /orders/42?tab=notes\n");
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].reason, "preview-open-requested");
  assert.equal(delivered[0].projectSlug, PROJECT);
  assert.equal(delivered[0].sessionId, SESSION);
  assert.equal(delivered[0].previewOpen.path, "/orders/42?tab=notes");
  assert.match(delivered[0].previewOpen.requestId, /^[0-9a-f-]{36}$/u);
  // Only the session's viewers get it, and it invalidates none of their reads.
  assert.deepEqual(events.map((event) => event.realtime.audience), [{ room: `vibe64:project:${PROJECT}:session:${SESSION}` }]);
  assert.deepEqual(delivered[0].clientRefresh, { includeAccess: false, includeDetail: false, includeList: false });
  assert.doesNotMatch(JSON.stringify([result, delivered]), /not-for-print/u);

  const json = await run("/orders/42#history", "--json");
  assert.equal(json.ok, true);
  assert.deepEqual(JSON.parse(json.stdout), { errors: [], moved: 2, path: "/orders/42#history" });
});

test("preview open accepts only a path inside the app", async () => {
  for (const path of ["/", "/orders/42", "/w/team/contacts/17?tab=notes#history", "/search?q=a%20b", "/a/../b"]) {
    assert.equal(previewAppPathError(path), "", path);
  }
  let published = 0;
  const { run } = openCommand({ onEvent: () => { published += 1; } });
  for (const path of [
    "https://elsewhere.example/orders",
    "http://127.0.0.1:4100/orders",
    "//elsewhere.example/orders",
    "javascript:alert(1)",
    "data:text/html,hi",
    "orders/42",
    "?tab=notes",
    "/\\elsewhere.example/orders",
    "/\t/elsewhere.example/orders",
    "/orders/42 extra",
    "/orders\n/42",
    "/__vibe64/preview-identity",
    "/%5F%5Fvibe64/preview-identity",
    "/orders?vibe64_preview_token=abc",
    `/${"a".repeat(2048)}`
  ]) {
    assert.notEqual(previewAppPathError(path), "", path);
    const result = await run(path);
    assert.equal(result.ok, false, path);
    assert.equal(result.exitCode, 64, path);
    assert.equal(result.code, "vibe64_agent_preview_open_path_invalid", path);
    assert.match(result.error, /Usage: vibe64-helper preview open <path> \[--json\]/u);
  }
  for (const args of [[], ["/a", "/b"], ["--wait", "/a"]]) {
    const result = await run(...args);
    assert.equal(result.code, "vibe64_agent_preview_open_usage", JSON.stringify(args));
    assert.equal(result.exitCode, 64);
  }
  assert.equal(published, 0, "Nothing refused reaches an editor.");
});

test("preview open says when nobody has the session's Preview open, or why it did not move", async () => {
  const nobody = await openCommand({ timeoutMs: 50 }).run("/orders/42");
  assert.equal(nobody.ok, false);
  assert.equal(nobody.exitCode, 1);
  assert.equal(nobody.code, "vibe64_agent_preview_open_not_moved");
  assert.equal(nobody.error,
    "moved: 0 - nobody has this session's Preview open. Give the person the path to type into their Preview address box instead: /orders/42");

  const suspended = await openCommand({
    onEvent: (payload) => editorAnswer(payload.previewOpen.requestId, {
      openError: "The person's Preview is suspended; they can choose Resume preview.",
      opened: false
    })
  }).run("/orders/42", "--json");
  assert.equal(suspended.ok, false);
  assert.match(suspended.error, /^moved: 0 - the person's Preview did not move: The person's Preview is suspended; they can choose Resume preview\. Give the person the path/u);
  assert.deepEqual(JSON.parse(suspended.stdout), {
    errors: ["The person's Preview is suspended; they can choose Resume preview."],
    moved: 0,
    path: "/orders/42"
  });

  let published = 0;
  const stopped = await openCommand({
    onEvent: () => { published += 1; },
    status: () => ({ ...runningStatus(), previewTarget: { available: false, href: "" } })
  }).run("/orders/42");
  assert.equal(stopped.code, "vibe64_agent_preview_open_not_running");
  assert.match(stopped.error, /The Preview is not running, so it cannot show a page; nothing moved\./u);
  assert.equal(published, 0);
});

test("an editor's answer travels in its Preview state, with or without a page", async () => {
  const fields = { openRequestId: "6f1c1f4e-8a43-4d8e-9f10-1f2a3b4c5d6e", originId: "tab:editor-1", projectSlug: PROJECT, sessionId: SESSION };
  assert.deepEqual(sessionPreviewStateInputValidator.schema.create({ ...fields, opened: true, route: "/orders/42" }).errors, {});
  assert.deepEqual(sessionPreviewStateInputValidator.schema.create({ ...fields, openError: "Not ready.", opened: false }).errors, {});
  assert.equal((await catalogue.broadcastSessionPreviewState(SESSION, { originId: "tab:editor-1", projectSlug: PROJECT })).ok, false,
    "A Preview state names a page or answers a request.");
});

test("the AI's preview help lists open and says when to use it", () => {
  assert.match(AGENT_PREVIEW_USAGE, /vibe64-helper preview open <path> \[--json\]/u);
  assert.match(AGENT_PREVIEW_USAGE, /open --json: path, moved/u);
  assert.match(AGENT_PREVIEW_USAGE, /When the person asks to see a page, run preview open/u);
  assert.match(AGENT_PREVIEW_USAGE, /moved: 0, give them the path/u);
});
