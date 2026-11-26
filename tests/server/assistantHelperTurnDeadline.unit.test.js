import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { VIBE64_AGENT_EXECUTION_PROFILE_IDS, VIBE64_AGENT_EXECUTION_WORKLOAD_IDS } from "@local/vibe64-runtime/shared";
import { runAssistantHelperTurn } from "../../packages/vibe64-terminals/src/server/assistantHelperTurn.js";

const profile = Object.freeze({
  profileId: VIBE64_AGENT_EXECUTION_PROFILE_IDS.HELPER,
  workloadId: VIBE64_AGENT_EXECUTION_WORKLOAD_IDS.PROMPT_HINT
});
// The profile the helper resolves to, as a provider reports it.
const resolvedProfile = Object.freeze({
  limits: { maxInputCharacters: 24_000, maxOutputCharacters: 2_500, timeoutMs: 120_000 },
  model: "gpt-5.6-luna",
  policy: { environmentAccess: false, networkAccess: false, repositoryWrite: false, tools: "none" },
  profileId: "helper",
  providerId: "codex",
  request: { allowProviderModelFallback: false, reasoning: true, summary: false },
  revision: "codex-helper-luna-low-v2",
  thinking: "low",
  workloadId: "prompt_hint"
});

test("a helper's whole turn keeps to its deadline even when its process never answers", { timeout: 10_000 }, async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-helper-deadline-"));
  try {
    let saved = null;
    let turnSignal = null;
    const agent = {
      async resolveEphemeralExecutionProfile() {
        return structuredClone(resolvedProfile);
      },
      // A process that starts and never answers: only the signal it was given can end its turn.
      runEphemeralChatTurn(scope, input, options) {
        turnSignal = options.signal;
        return new Promise((resolve) => {
          options.signal.addEventListener("abort", () => resolve({ ok: false, code: "vibe64_agent_turn_cancelled" }), { once: true });
        });
      },
      async deleteEphemeralConversation() {
        return { ok: true };
      }
    };
    const startedAt = Date.now();
    await assert.rejects(runAssistantHelperTurn({
      agent,
      deadlineMs: 100,
      fail: (message, code, reason) => Object.assign(new Error(message), { code, reason }),
      outputSchema: {},
      prefix: "hints",
      profile,
      prompt: () => "Suggest prompts.",
      promptLabel: "Test hints",
      record: {
        read: async () => saved,
        write: async (helper) => {
          saved = structuredClone(helper);
        },
        retire: async () => {
          saved = null;
        }
      },
      resolveIdentity: async () => ({ connectionIdentity: {}, selection: {} }),
      stableContext: "Test.",
      stateRoot
    }), { reason: "failed" });
    assert.ok(Date.now() - startedAt < 5_000);
    assert.equal(turnSignal.aborted, true);
    assert.equal(turnSignal.reason?.name, "TimeoutError");
  } finally {
    await rm(stateRoot, { force: true, recursive: true });
  }
});
