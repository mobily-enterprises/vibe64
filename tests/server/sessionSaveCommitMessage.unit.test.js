import assert from "node:assert/strict";
import test from "node:test";

import {
  generateSessionSaveCommitMessage,
  normalizeSessionSaveCommitMessage,
  sessionSaveCommitMessagePrompt
} from "../../packages/vibe64-terminals/src/server/sessionSaveCommitMessage.js";

const TEST_ACCOUNT_IDENTITY_SIGNATURE = `sha256:${"a".repeat(64)}`;

function resolvedEconomyProfile(workloadId = "commit_title") {
  return {
    limits: {
      maxInputCharacters: 20_000,
      maxOutputCharacters: 200,
      timeoutMs: 30_000
    },
    model: "gpt-5.6-luna",
    policy: {
      environmentAccess: false,
      networkAccess: false,
      repositoryWrite: false,
      tools: "none"
    },
    profileId: "economy",
    providerId: "codex",
    request: {
      allowProviderModelFallback: false,
      reasoning: true,
      summary: false
    },
    revision: "codex-economy-v1",
    thinking: "low",
    workloadId
  };
}

test("commit-message prompt is bounded, specific, and contains only change facts", () => {
  const prompt = sessionSaveCommitMessagePrompt({
    files: Array.from({ length: 45 }, (_, index) => ({
      added: index + 1,
      deleted: index,
      path: `packages/feature-${index}/src/service.js`,
      status: "M"
    })),
    totalCount: 45
  });
  assert.match(prompt, /Changed files: 45/u);
  assert.match(prompt, /M: packages\/feature-0\/src\/service\.js \(\+1 -0\)/u);
  assert.match(prompt, /…and 5 more changed files/u);
  assert.doesNotMatch(prompt, /feature-44/u);
  assert.match(prompt, /do not use tools/iu);
});

test("commit-message generation uses and deletes one ephemeral assistant thread", async () => {
  const calls = [];
  const agentContext = {
    runtime: { runtimeId: "runtime-1" },
    session: { sessionId: "session-1" },
    vibe64User: { username: "ada" }
  };
  const result = await generateSessionSaveCommitMessage({
    agentContext,
    changes: {
      files: [{ added: 12, deleted: 2, path: "src/bookings.js", status: "M" }],
      totalCount: 1
    },
    expectedAccountIdentitySignature: TEST_ACCOUNT_IDENTITY_SIGNATURE,
    async deleteThread(input, options) {
      calls.push(["delete", input, options]);
      return { ok: true };
    },
    async runAgentTurn(input, options) {
      calls.push(["run", input, options]);
      options.onEvent({ threadId: "thread-1", type: "thread" });
      return {
        executionProfile: resolvedEconomyProfile(),
        ok: true,
        text: JSON.stringify({ subject: "Improve booking availability rules" }),
        threadId: "thread-1"
      };
    }
  });
  assert.equal(result.subject, "Improve booking availability rules");
  assert.deepEqual(result.executionProfile, resolvedEconomyProfile());
  assert.equal(calls[0][1].ephemeral, true);
  assert.deepEqual(calls[0][1].executionProfile, {
    profileId: "economy",
    workloadId: "commit_title"
  });
  assert.equal(
    calls[0][1].expectedAccountIdentitySignature,
    TEST_ACCOUNT_IDENTITY_SIGNATURE
  );
  assert.equal(calls[0][1].agentSettings, undefined);
  assert.equal(calls[0][1].timeoutMs, undefined);
  assert.deepEqual(calls[0][1].outputSchema.required, ["subject"]);
  assert.equal(calls[0][2].runtime, agentContext.runtime);
  assert.equal(calls[0][2].session, agentContext.session);
  assert.equal(calls[0][2].vibe64User, agentContext.vibe64User);
  assert.equal(typeof calls[0][2].onEvent, "function");
  assert.deepEqual(calls.slice(1), [[
    "delete",
    {
      executionProfile: resolvedEconomyProfile(),
      threadId: "thread-1"
    },
    agentContext
  ]]);
});

test("commit-message generation requires a verified selected assistant account before work starts", async () => {
  let agentCalls = 0;
  await assert.rejects(generateSessionSaveCommitMessage({
    changes: {},
    async deleteThread() {
      agentCalls += 1;
      return { ok: true };
    },
    async runAgentTurn() {
      agentCalls += 1;
      return { ok: true };
    }
  }), (error) => (
    error.code === "vibe64_session_save_message_account_unverified" &&
    /Sign in to or reconnect/u.test(error.message)
  ));
  assert.equal(agentCalls, 0);
});

test("an account switch blocks commit-title generation and preserves failed cleanup ownership", async () => {
  let cleanupCalls = 0;
  let titleCalls = 0;
  await assert.rejects(generateSessionSaveCommitMessage({
    changes: {},
    async deleteThread(input) {
      cleanupCalls += 1;
      assert.deepEqual(input, {
        executionProfile: {
          profileId: "economy",
          workloadId: "commit_title"
        },
        threadId: "thread-account-switched"
      });
      return {
        code: "vibe64_codex_economy_ownership_blocked",
        error: "Switch back to the original Codex account and retry cleanup.",
        ok: false
      };
    },
    expectedAccountIdentitySignature: TEST_ACCOUNT_IDENTITY_SIGNATURE,
    async runAgentTurn(input, options) {
      titleCalls += 1;
      assert.equal(
        input.expectedAccountIdentitySignature,
        TEST_ACCOUNT_IDENTITY_SIGNATURE
      );
      options.onEvent({
        threadId: "thread-account-switched",
        type: "thread"
      });
      return {
        code: "vibe64_codex_economy_ownership_blocked",
        error: "The selected Codex account changed before the title was ready.",
        ok: false,
        threadId: "thread-account-switched"
      };
    }
  }), (error) => (
    error.code === "vibe64_codex_economy_ownership_blocked" &&
    /retry cleanup/u.test(error.message) &&
    error.cause?.code === "vibe64_codex_economy_ownership_blocked"
  ));
  assert.equal(titleCalls, 1);
  assert.equal(cleanupCalls, 1);
});

test("invalid, failed, and uncleared assistant results reject AI naming", async () => {
  assert.throws(
    () => normalizeSessionSaveCommitMessage("Save Vibe64 work"),
    (error) => error.code === "vibe64_session_save_message_generic"
  );
  assert.throws(
    () => normalizeSessionSaveCommitMessage("A title\nwith a body"),
    (error) => error.code === "vibe64_session_save_message_invalid"
  );
  await assert.rejects(generateSessionSaveCommitMessage({
    changes: {},
    expectedAccountIdentitySignature: TEST_ACCOUNT_IDENTITY_SIGNATURE,
    async deleteThread() {
      return { ok: true };
    },
    async runAgentTurn() {
      return { code: "provider_failed", error: "Provider failed.", ok: false };
    }
  }), (error) => error.code === "provider_failed");
  await assert.rejects(generateSessionSaveCommitMessage({
    changes: {},
    expectedAccountIdentitySignature: TEST_ACCOUNT_IDENTITY_SIGNATURE,
    async deleteThread() {
      return { code: "delete_failed", error: "Delete failed.", ok: false };
    },
    async runAgentTurn(_input, options) {
      options.onEvent({ threadId: "thread-2", type: "thread" });
      return {
        executionProfile: resolvedEconomyProfile(),
        ok: true,
        text: JSON.stringify({ subject: "Improve booking availability rules" }),
        threadId: "thread-2"
      };
    }
  }), (error) => error.code === "delete_failed");
  await assert.rejects(generateSessionSaveCommitMessage({
    changes: {},
    expectedAccountIdentitySignature: TEST_ACCOUNT_IDENTITY_SIGNATURE,
    async deleteThread() {
      return { ok: true };
    },
    async runAgentTurn() {
      return {
        ok: true,
        text: JSON.stringify({ subject: "Improve booking availability rules" })
      };
    }
  }), (error) => error.code === "vibe64_session_save_message_execution_profile_missing");
  await assert.rejects(generateSessionSaveCommitMessage({
    changes: {},
    expectedAccountIdentitySignature: TEST_ACCOUNT_IDENTITY_SIGNATURE,
    async deleteThread() {
      return { ok: true };
    },
    async runAgentTurn() {
      return {
        executionProfile: resolvedEconomyProfile(),
        ok: true,
        text: JSON.stringify({ extra: true, subject: "Improve booking availability rules" })
      };
    }
  }), (error) => error.code === "vibe64_session_save_message_invalid");
});

test("commit-message cleanup requires an explicit successful deletion result", async () => {
  await assert.rejects(generateSessionSaveCommitMessage({
    changes: {},
    expectedAccountIdentitySignature: TEST_ACCOUNT_IDENTITY_SIGNATURE,
    async deleteThread() {},
    async runAgentTurn(_input, options) {
      options.onEvent({ threadId: "thread-undefined-cleanup", type: "thread" });
      return {
        executionProfile: resolvedEconomyProfile(),
        ok: true,
        text: JSON.stringify({ subject: "Improve booking availability rules" }),
        threadId: "thread-undefined-cleanup"
      };
    }
  }), (error) => (
    error.code === "vibe64_session_save_message_cleanup_failed" &&
    /Cleanup will be retried/u.test(error.message)
  ));
});

test("commit-message cleanup failure takes precedence while retaining the model failure as its cause", async () => {
  await assert.rejects(generateSessionSaveCommitMessage({
    changes: {},
    expectedAccountIdentitySignature: TEST_ACCOUNT_IDENTITY_SIGNATURE,
    async deleteThread() {
      return { code: "cleanup_failed", error: "Cleanup failed.", ok: false };
    },
    async runAgentTurn(_input, options) {
      options.onEvent({ threadId: "thread-model-failure", type: "thread" });
      return {
        code: "model_failed",
        error: "Model failed.",
        ok: false,
        threadId: "thread-model-failure"
      };
    }
  }), (error) => (
    error.code === "cleanup_failed" &&
    error.cause?.code === "model_failed"
  ));
});
