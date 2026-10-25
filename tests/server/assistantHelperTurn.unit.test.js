import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runAssistantHelperTurn } from "../../packages/vibe64-terminals/src/server/assistantHelperTurn.js";

const profile = { profileId: "helper", workloadId: "session_title", providerId: "codex", revision: "helper-v1", model: "helper-model", thinking: "low",
  limits: { maxInputCharacters: 24000, maxOutputCharacters: 512, timeoutMs: 30000 },
  policy: { environmentAccess: false, networkAccess: false, repositoryWrite: false, tools: "none" },
  request: { allowProviderModelFallback: false, reasoning: true, summary: false } };

async function fixture(t, { events = [], reported = profile } = {}) {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "v64-helper-turn-"));
  t.after(() => rm(stateRoot, { recursive: true, force: true }));
  let saved = null;
  const deleted = [];
  const agent = {
    async resolveEphemeralExecutionProfile() { return profile; },
    async runEphemeralChatTurn(_scope, _input, options) {
      for (const event of events) await options.onEvent(event);
      return { ok: true, text: "done", executionProfile: reported };
    },
    async deleteEphemeralConversation(_scope, input) { deleted.push(input.conversationId); return { ok: true }; }
  };
  const run = () => runAssistantHelperTurn({
    agent,
    fail: (message, code, reason) => Object.assign(new Error(message), { code, reason }),
    prefix: "naming",
    profile: { profileId: "helper", workloadId: "session_title" },
    prompt: "Name it",
    promptLabel: "Name",
    record: {
      read: async () => saved,
      write: async (helper) => { saved = structuredClone(helper); },
      retire: async () => { saved = null; }
    },
    resolveIdentity: async () => ({ connectionIdentity: "connection", selection: { engineId: "codex" } }),
    stableContext: "No tools.",
    stateRoot
  });
  return { deleted, run, stateRoot, saved: () => saved };
}

test("a helper takes its native conversation from either a thread or a turn event", async (t) => {
  const turnOnly = await fixture(t, { events: [{ type: "turn", threadId: "turn-thread", turnId: "turn-1" }] });
  assert.equal((await turnOnly.run()).text, "done");
  assert.deepEqual(turnOnly.deleted, ["turn-thread"]);
  assert.equal(turnOnly.saved(), null);
  assert.deepEqual(await readdir(path.join(turnOnly.stateRoot, "assistant-helpers")), []);

  const threadThenBareTurn = await fixture(t, { events: [{ type: "thread", threadId: "thread-1" }, { type: "turn", turnId: "turn-1" }] });
  await threadThenBareTurn.run();
  assert.deepEqual(threadThenBareTurn.deleted, ["thread-1"], "a turn without a thread id keeps the known conversation");
});

test("a helper must identify its conversation and report exactly its resolved profile", async (t) => {
  const anonymous = await fixture(t);
  await assert.rejects(anonymous.run(), { reason: "conversation_missing" });
  const drifted = await fixture(t, {
    events: [{ type: "thread", threadId: "thread-1" }],
    reported: { ...profile, revision: "helper-v2" }
  });
  await assert.rejects(drifted.run(), { reason: "execution_profile_missing" });
  assert.deepEqual(drifted.deleted, ["thread-1"]);
});
