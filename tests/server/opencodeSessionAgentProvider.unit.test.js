import assert from "node:assert/strict";
import test from "node:test";
import { createConversationRuntime } from "@jskit-ai/assistant-core/server/conversation";
import { prepareSessionDetachedConversationRun } from "../../packages/vibe64-terminals/src/server/mainConversationBinding.js";

import {
  VIBE64_AGENT_EXECUTION_PROFILE_IDS,
  VIBE64_AGENT_EXECUTION_TOOL_POLICIES,
  VIBE64_AGENT_EXECUTION_WORKLOAD_IDS,
  VIBE64_ASSISTANT_ENGINE_IDS,
  vibe64AgentExecutionProfileAuditSnapshot
} from "../../packages/vibe64-runtime/src/shared/index.js";
import {
  OPENCODE_HELPER_PROFILE_REVISION,
  createOpenCodeSessionAgentProvider,
  resolveOpenCodeHelperExecutionProfile
} from "../../packages/vibe64-terminals/src/server/agent/providers/opencodeSessionAgentProvider.js";

const selection = Object.freeze({
  agentId: "build",
  catalogRevision: `sha256:${"a".repeat(64)}`,
  engineId: VIBE64_ASSISTANT_ENGINE_IDS.OPENCODE,
  modelId: "deepseek-chat",
  modelProviderId: "deepseek",
  schema: "vibe64.assistant-selection.v1",
  variantId: "high"
});
const assistantAccess = Object.freeze({
  defaultModelId: "retired-setting-must-not-override-routing"
});

test("OpenCode resolves every Vibe64 helper workload to the selected model and a deny-all policy", () => {
  for (const workloadId of Object.values(VIBE64_AGENT_EXECUTION_WORKLOAD_IDS)) {
    const profile = resolveOpenCodeHelperExecutionProfile({
      assistantSelection: selection,
      assistantAccess
    }, {
      profileId: VIBE64_AGENT_EXECUTION_PROFILE_IDS.HELPER,
      workloadId
    });
    assert.equal(profile.profileId, VIBE64_AGENT_EXECUTION_PROFILE_IDS.HELPER);
    assert.equal(profile.workloadId, workloadId);
    assert.equal(profile.providerId, VIBE64_ASSISTANT_ENGINE_IDS.OPENCODE);
    assert.equal(profile.model, "deepseek-chat");
    assert.equal(profile.thinking, selection.variantId);
    assert.equal(profile.revision, OPENCODE_HELPER_PROFILE_REVISION);
    assert.deepEqual(profile.policy, {
      environmentAccess: false,
      networkAccess: false,
      repositoryWrite: false,
      tools: VIBE64_AGENT_EXECUTION_TOOL_POLICIES.NONE
    });
    assert.equal(profile.request.allowProviderModelFallback, false);
  }
});

test("OpenCode gives live commit-title and prompt-hint helpers enough bounded time", () => {
  for (const workloadId of [
    VIBE64_AGENT_EXECUTION_WORKLOAD_IDS.COMMIT_TITLE,
    VIBE64_AGENT_EXECUTION_WORKLOAD_IDS.PROMPT_HINT
  ]) {
    const profile = resolveOpenCodeHelperExecutionProfile({
      assistantSelection: selection,
      assistantAccess
    }, {
      profileId: VIBE64_AGENT_EXECUTION_PROFILE_IDS.HELPER,
      workloadId
    });
    assert.equal(profile.limits.timeoutMs, 120_000);
  }
});

test("OpenCode refuses helper profiles without its durable provider and model selection", () => {
  assert.throws(
    () => resolveOpenCodeHelperExecutionProfile({
      assistantAccess,
      assistantSelection: { ...selection, engineId: "codex" }
    }, {
      profileId: VIBE64_AGENT_EXECUTION_PROFILE_IDS.HELPER,
      workloadId: VIBE64_AGENT_EXECUTION_WORKLOAD_IDS.COMMIT_TITLE
    }),
    (error) => error?.code === "vibe64_agent_execution_profile_model_unavailable"
  );
});

// This adapter case preserves its original mocked creation boundary; runtime
// dispatch is exercised by the actual scoped and service owner fixtures.
function creationRequestFixture(options) {
  const provider = createOpenCodeSessionAgentProvider({ accounts: {} });
  return { ...provider, createConversation(context, input = {}) {
    const request = provider.prepareConversationRequest("createConversation", context, input);
    return options.controller.createConversation(context.sessionId, request.input, request.context);
  } };
}

test("OpenCode scoped creation retains its helper profile and original audit snapshot", async () => {
  const calls = [];
  const controller = {
    async createConversation(...args) {
      calls.push(args);
      return {
        ok: true,
        text: '{"subject":"Add multi-AI sessions"}',
        threadId: "ses_helper"
      };
    }
  };
  const provider = creationRequestFixture({ controller });
  const profile = resolveOpenCodeHelperExecutionProfile({
    assistantSelection: selection,
    assistantAccess
  }, {
    profileId: VIBE64_AGENT_EXECUTION_PROFILE_IDS.HELPER,
    workloadId: VIBE64_AGENT_EXECUTION_WORKLOAD_IDS.COMMIT_TITLE
  });
  await provider.createConversation({
    assistantSelection: selection,
    assistantAccess,
    runtime: { stateRoot: "/runtime" },
    session: { sessionId: "session-1" },
    sessionId: "session-1"
  }, {
    executionProfile: profile,
    prompt: "Name this work"
  });
  await provider.createConversation({
    assistantSelection: selection,
    assistantAccess,
    runtime: { stateRoot: "/runtime" },
    session: { sessionId: "session-1" },
    sessionId: "session-1"
  }, {
    executionProfile: profile,
    prompt: "Name streamed work"
  });

  assert.deepEqual(provider.executionProfiles, [VIBE64_AGENT_EXECUTION_PROFILE_IDS.HELPER]);
  assert.equal(calls.length, 2);
  assert.equal(calls[0][0], "session-1");
  assert.equal(calls[0][1].executionProfile, profile);
  assert.equal(calls[1][0], "session-1");
  assert.equal(calls[1][1].executionProfile, profile);
  assert.deepEqual(vibe64AgentExecutionProfileAuditSnapshot(profile), profile);
});

test("OpenCode provider routes the complete interactive terminal lifecycle", async () => {
  const calls = [];
  const controller = Object.fromEntries([
    "closeTerminal",
    "readTerminal",
    "resizeTerminal",
    "startTerminal",
    "subscribeTerminal",
    "writeTerminal"
  ].map((name) => [name, async (...args) => {
    calls.push({ args, name });
    return { name, ok: true };
  }]));
  const provider = createOpenCodeSessionAgentProvider({ accounts: {}, terminals: controller });
  const context = {
    runtime: { stateRoot: "/runtime" },
    session: { sessionId: "session-1" },
    sessionId: "session-1",
    vibe64User: { username: "ada" }
  };
  const subscriber = () => null;

  await provider.startTerminal(context, { cols: 100 });
  await provider.readTerminal(context, { terminalSessionId: "terminal-1" });
  await provider.resizeTerminal(context, {
    size: { cols: 120, rows: 40 },
    terminalSessionId: "terminal-1"
  });
  await provider.subscribeTerminal(context, {
    subscriber,
    terminalSessionId: "terminal-1"
  });
  await provider.writeTerminal(context, {
    data: "help\r",
    input: { trackGitActor: true },
    terminalSessionId: "terminal-1"
  });
  await provider.closeTerminal(context, { terminalSessionId: "terminal-1" });

  assert.deepEqual(calls.map((call) => call.name), [
    "startTerminal",
    "readTerminal",
    "resizeTerminal",
    "subscribeTerminal",
    "writeTerminal",
    "closeTerminal"
  ]);
  assert.deepEqual(calls[0].args.slice(0, 2), ["session-1", { cols: 100 }]);
  assert.equal(calls[0].args[2].vibe64User.username, "ada");
  assert.deepEqual(calls[4].args.slice(0, 4), [
    "session-1",
    "terminal-1",
    "help\r",
    { trackGitActor: true }
  ]);
  assert.equal(calls[4].args[4].vibe64User.username, "ada");
});

function detachedOpenCodeFixture({ controller }) {
  let provider;
  const conversations = createConversationRuntime({
    authorize: ({ context, conversationId }) => context.sessionId === conversationId,
    host: { conversation: ({ id, context, input, options }) =>
      prepareSessionDetachedConversationRun(provider, id, context, input, options) }
  });
  provider = createOpenCodeSessionAgentProvider({ accounts: {},
    runNativeDetachedConversation: request => conversations.runNativeDetachedConversation(request),
    sharedRuntime: { runPreparedConversationTurn: prepared =>
      controller.runDetachedChatTurn(prepared.sessionId, prepared.input, prepared.options) },
    scopedPreparation: { prepareDetachedChatTurn(sessionId, input, options, policy) {
      assert.equal(policy.waitForCompletion, true);
      return { sessionId, input, options };
    } }
  });
  return provider;
}

test("Restored detached: OpenCode provider advertises and audits its helper execution profile on turns", async () => {
  const events = [];
  const calls = [];
  const controller = {
    async runDetachedChatTurn(...args) {
      calls.push(args);
      return {
        ok: true,
        text: '{"subject":"Add multi-AI sessions"}',
        threadId: "ses_helper"
      };
    },
    async streamDetachedChatTurn(...args) {
      calls.push(args);
      return {
        ok: true,
        text: '{"subject":"Add streamed multi-AI sessions"}',
        threadId: "ses_streamed_helper"
      };
    }
  };
  const provider = detachedOpenCodeFixture({ controller });
  const profile = resolveOpenCodeHelperExecutionProfile({
    assistantSelection: selection,
    assistantAccess
  }, {
    profileId: VIBE64_AGENT_EXECUTION_PROFILE_IDS.HELPER,
    workloadId: VIBE64_AGENT_EXECUTION_WORKLOAD_IDS.COMMIT_TITLE
  });
  const result = await provider.runDetachedChatTurn({
    assistantSelection: selection,
    assistantAccess,
    onEvent: (event) => events.push(event),
    runtime: { stateRoot: "/runtime" },
    session: { sessionId: "session-1" },
    sessionId: "session-1"
  }, {
    executionProfile: profile,
    prompt: "Name this work"
  });
  const streamed = await provider.streamDetachedChatTurn({
    assistantSelection: selection,
    assistantAccess,
    onEvent: (event) => events.push(event),
    runtime: { stateRoot: "/runtime" },
    session: { sessionId: "session-1" },
    sessionId: "session-1"
  }, {
    executionProfile: profile,
    prompt: "Name streamed work"
  });

  assert.deepEqual(provider.executionProfiles, [VIBE64_AGENT_EXECUTION_PROFILE_IDS.HELPER]);
  assert.equal(calls.length, 2);
  assert.equal(calls[0][0], "session-1");
  assert.equal(calls[0][1].executionProfile, profile);
  assert.equal(calls[1][0], "session-1");
  assert.equal(calls[1][1].executionProfile, profile);
  assert.deepEqual(events, [
    {
      executionProfile: profile,
      type: "execution-profile"
    },
    {
      executionProfile: profile,
      type: "execution-profile"
    }
  ]);
  assert.deepEqual(result.executionProfile, profile);
  assert.deepEqual(streamed.executionProfile, profile);
});
