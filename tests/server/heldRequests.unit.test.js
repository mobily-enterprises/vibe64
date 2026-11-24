import assert from "node:assert/strict";
import test from "node:test";
import { silentLogger } from "@jskit-ai/kernel/server/runtime/logger";
import { createHeldRequests } from "@local/vibe64-core/server/heldRequests";

// Session create, archive, Create pull request and the database copilot's question gained a request id the page
// sends; a script, the helper, Colleague's tools or a page cached before the release send none.
test("a held request with no request id waits for its work, is never joined or replayed, and a repeat of one starts nothing", async () => {
  const notFollowed = { code: "test_not_followed", error: "Not followed." };
  const held = createHeldRequests({ component: "test.held_requests", heldAs: "creating", logger: silentLogger, notFollowed });
  const runs = [];
  const work = async (request, { stage, signal }) => {
    stage("making");
    assert.equal(signal.aborted, false);
    runs.push(request);
    return { ok: true, run: runs.length };
  };
  try {
    assert.deepEqual(await held.run(["session-1"], { name: "first" }, work), { ok: true, run: 1 });
    assert.deepEqual(await held.run(["session-1"], { name: "second" }, work), { ok: true, run: 2 },
      "A second request without an id was answered from the first one's outcome.");
    assert.deepEqual(runs, [{ name: "first" }, { name: "second" }]);
    assert.deepEqual(await held.run(["session-1"], { name: "repeat", repeat: true }, work), { ...notFollowed, ok: false });
    assert.equal(runs.length, 2, "A repeat without an id started its work.");
    // A named request still replays its outcome to its repeat.
    const named = { requestId: "11111111-2222-4333-8444-555555555555", name: "named" };
    assert.deepEqual(await held.run(["session-1"], named, work), { ok: true, run: 3 });
    assert.deepEqual(await held.run(["session-1"], { ...named, repeat: true }, work), { ok: true, run: 3 });
    assert.equal(runs.length, 3);
  } finally {
    await held.close();
  }
});
