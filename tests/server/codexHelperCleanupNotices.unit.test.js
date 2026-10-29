import assert from "node:assert/strict";
import test from "node:test";
import { createCodexHelperPreparation } from "../../packages/vibe64-terminals/src/server/codexHelperPreparation.js";

function sessionError(code) {
  return Object.assign(new Error(`Refused: ${code}`), { code });
}

function helperPreparation() {
  return createCodexHelperPreparation({
    runtimeHost: { codexAppServerProviderKey() {}, codexAppServerProviderKeyFields() {} },
    sessionRuntimeHost: { createRuntimeForSession: async () => assert.fail("the runtime is supplied") },
    accountPreparation: { codexToolHomeResult: async () => assert.fail("publishing reads no account") },
    providerHost: {},
    runOwner: {
      runtimeLifecycle: { assertOpen() {}, resources() {} },
      helperThreads: { ownershipError: (message) => new Error(message) }
    }
  });
}

test("low-cost assistant cleanup notices are written per session past one that is refused", async () => {
  const written = [];
  const refusals = new Map([
    ["archived", sessionError("vibe64_session_archived")],
    ["deleted", sessionError("vibe64_session_not_found")],
    ["renewing", sessionError("vibe64_session_renewal_quiesced")]
  ]);
  const runtime = {
    stateRoot: "/project/runtime",
    store: {
      async writeBackgroundTaskEvent(sessionId, taskId, { patch }) {
        if (refusals.has(sessionId)) throw refusals.get(sessionId);
        written.push({ sessionId, taskId, status: patch.status });
      }
    }
  };
  const { context } = await helperPreparation().restoration({ runtime });
  const records = ["archived", "renewing", "deleted", "open"].map((sessionId) => ({ sessionId, threadId: `thread-${sessionId}` }));
  const retiredBySession = new Map(records.map(({ sessionId, threadId }) => [sessionId, [threadId]]));

  await assert.rejects(context.publish({ records, failed: [], retiredBySession, normalizedSessionId: "" }), (error) => {
    assert.equal(error.code, "vibe64_session_renewal_quiesced");
    assert.equal(error.retryable, true);
    assert.match(error.message, /session renewing \(Refused: vibe64_session_renewal_quiesced\)/u);
    assert.doesNotMatch(error.message, /archived|deleted/u, "an archived or missing session has no one to tell");
    return true;
  });
  assert.deepEqual(written, [{ sessionId: "open", taskId: "codex-helper-cleanup", status: "ready" }],
    "the refused notice does not hide the next session's");
});
