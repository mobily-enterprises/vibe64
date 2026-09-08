import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createSessionPromptHintsService,
  parsePromptHintSuggestions,
  readPromptHintBlueprint,
  visibleConversation
} from "../../packages/vibe64-terminals/src/server/sessionPromptHints.js";
import {
  currentProjectScopeKey,
  runWithProjectRequestContext
} from "../../packages/vibe64-core/src/server/projectRequestContext.js";

const ACCOUNT_SIGNATURE = `sha256:${"a".repeat(64)}`;

function resolvedPromptHintProfile() {
  return {
    limits: {
      maxInputCharacters: 24_000,
      maxOutputCharacters: 2_500,
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
    revision: "codex-economy-luna-low-v2",
    thinking: "low",
    workloadId: "prompt_hint"
  };
}

function projectPromptHints({ promptHints = true } = {}) {
  return { promptHints };
}

function conversationPage({
  assistantText = "The task list is now visible.",
  newestTurnId = "turn-1",
  totalTurnCount = 1,
  userText = "Build a shared team task tracker."
} = {}) {
  return {
    conversationLog: [{
      assistant: assistantText
        ? {
            at: "2026-08-25T00:00:02.000Z",
            messageId: "message-assistant-1",
            text: assistantText
          }
        : null,
      commentary: [{
        at: "2026-08-25T00:00:01.500Z",
        text: "SECRET COMMENTARY MUST NOT REACH PROMPT"
      }],
      system: {
        at: "2026-08-25T00:00:00.000Z",
        text: "SECRET SYSTEM INSTRUCTION MUST NOT REACH PROMPT"
      },
      thinking: [{
        at: "2026-08-25T00:00:01.000Z",
        text: "SECRET REASONING MUST NOT REACH PROMPT"
      }],
      turnId: newestTurnId,
      user: userText
        ? {
            at: "2026-08-25T00:00:01.000Z",
            messageId: "message-user-1",
            text: userText
          }
        : null
    }],
    pagination: {
      count: 1,
      hasMoreBefore: false,
      limit: 8,
      newestTurnId,
      totalTurnCount
    }
  };
}

test("prompt-hint context keeps the newest turns when its character budget is exhausted", () => {
  const conversationLog = Array.from({ length: 8 }, (_value, index) => ({
    assistant: {
      text: `ASSISTANT-${index + 1}-${"a".repeat(1_600)}`
    },
    turnId: `turn-${index + 1}`,
    user: {
      text: `USER-${index + 1}-${"u".repeat(1_600)}`
    }
  }));
  const visible = visibleConversation({ conversationLog });
  assert.equal(visible.length, 8);
  assert.deepEqual(visible.map(({ role, text }) => ({
    role,
    turn: /(?:USER|ASSISTANT)-(\d+)/u.exec(text)?.[1]
  })), [
    { role: "user", turn: "5" },
    { role: "assistant", turn: "5" },
    { role: "user", turn: "6" },
    { role: "assistant", turn: "6" },
    { role: "user", turn: "7" },
    { role: "assistant", turn: "7" },
    { role: "user", turn: "8" },
    { role: "assistant", turn: "8" }
  ]);
});

function deferred() {
  let reject;
  let resolve;
  const promise = new Promise((promiseResolve, promiseReject) => {
    reject = promiseReject;
    resolve = promiseResolve;
  });
  return {
    promise,
    reject,
    resolve
  };
}

async function withTemporaryDirectory(operation) {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-prompt-hints-"));
  try {
    return await operation(temporaryRoot);
  } finally {
    await rm(temporaryRoot, { force: true, recursive: true });
  }
}

function testProjectContext(slug = "project-alpha") {
  return {
    projectRuntimeRoot: `/runtime/${slug}`,
    slug,
    targetRoot: `/projects/${slug}`
  };
}

function promptHint(label, prompt) {
  return { label, prompt };
}

function readyAgentResult({
  suggestions = [
    promptHint("Add task fields", "Add task assignments and due dates"),
    promptHint("Create invitation flow", "Create an invitation flow for teammates"),
    promptHint("Show overdue work", "Show overdue work on the dashboard")
  ],
  threadId = "thread-hints-1",
  turnId = "turn-hints-1"
} = {}) {
  return {
    executionProfile: resolvedPromptHintProfile(),
    ok: true,
    text: JSON.stringify({ suggestions }),
    threadId,
    turnId
  };
}

function createFixture({
  accountIdentitySignature = ACCOUNT_SIGNATURE,
  agentResult = null,
  cacheMaxEntries = 128,
  cacheTtlMs = 300_000,
  conversation = conversationPage(),
  deleteResult = { ok: true, status: "deleted" },
  describeProvider = null,
  now = () => Date.now(),
  promptHints = projectPromptHints(),
  requireAssistantAccess = null,
  readBlueprintText = null,
  resolveExecutionProfile = null,
  runAgentTurn = null,
  sessionSourcePath = () => "/managed/project/sessions/active/session-1/source"
} = {}) {
  const calls = {
    blueprint: [],
    delete: [],
    describe: [],
    diagnostic: [],
    interrupt: [],
    promptHints: [],
    access: [],
    resolve: [],
    run: [],
    session: []
  };
  let currentConversation = conversation;
  let currentPromptHints = promptHints;
  let currentSession = {
    metadata: {
      agent_identity_provider: "codex",
      source_kind: "session_clone",
      source_path: "/managed/project/sessions/active/session-1/source",
      source_path_authority: "managed_session_source"
    },
    revision: "session-revision-1",
    sessionId: "session-1",
    sourceReady: true,
    status: "active"
  };
  const runtime = {
    async getSession(sessionId) {
      calls.session.push(sessionId);
      return typeof currentSession === "function"
        ? currentSession(sessionId)
        : {
            ...currentSession,
            sessionId
          };
    },
    async readConversationLogPage(sessionId, options) {
      assert.ok(Number(options?.limit) > 0);
      return typeof currentConversation === "function"
        ? currentConversation(sessionId)
        : currentConversation;
    }
  };
  const service = createSessionPromptHintsService({
    cacheMaxEntries,
    cacheTtlMs,
    async deleteAgentThread(sessionId, input, options) {
      calls.delete.push({ input, options, sessionId });
      return typeof deleteResult === "function"
        ? deleteResult({ input, options, sessionId })
        : deleteResult;
    },
    async describeProvider(options) {
      calls.describe.push(options);
      if (describeProvider) {
        return describeProvider({ options });
      }
      return {
        accountIdentitySignature: typeof accountIdentitySignature === "function"
          ? accountIdentitySignature()
          : accountIdentitySignature,
        providerId: "codex",
        transportId: "codex_app_server"
      };
    },
    diagnostic(event) {
      calls.diagnostic.push(event);
    },
    async interruptAgentTurn(sessionId, input, options) {
      calls.interrupt.push({
        input,
        options,
        projectScope: currentProjectScopeKey(),
        sessionId
      });
      return {
        ok: true,
        status: "interrupted"
      };
    },
    now,
    async requireAssistantAccess(sessionId, options) {
      calls.access.push({ options, sessionId });
      return requireAssistantAccess
        ? requireAssistantAccess({ options, sessionId })
        : { ok: true };
    },
    projectService: {
      async createRuntime() {
        return runtime;
      },
      async readPromptHints() {
        calls.promptHints.push({});
        return {
          ...currentPromptHints,
          ok: true
        };
      }
    },
    readBlueprintText: readBlueprintText || (async (sourceRoot) => {
      calls.blueprint.push({ sourceRoot });
      return [
        "# Blueprint",
        "",
        "A friendly shared task tracker for small teams.",
        "PRIVATE PATH /home/example/must/not/be-invented"
      ].join("\n");
    }),
    async resolveExecutionProfile(sessionId, input, options) {
      calls.resolve.push({ input, options, sessionId });
      if (resolveExecutionProfile) {
        return resolveExecutionProfile({ input, options, sessionId });
      }
      return resolvedPromptHintProfile();
    },
    async runAgentTurn(sessionId, input, options) {
      calls.run.push({
        input,
        options,
        projectScope: currentProjectScopeKey(),
        sessionId
      });
      if (runAgentTurn) {
        return runAgentTurn({ input, options, sessionId });
      }
      options.onEvent({
        executionProfile: resolvedPromptHintProfile(),
        type: "execution-profile"
      });
      options.onEvent({
        threadId: "thread-hints-1",
        type: "thread"
      });
      options.onEvent({
        threadId: "thread-hints-1",
        turnId: "turn-hints-1",
        type: "turn"
      });
      return agentResult || readyAgentResult();
    },
    sessionSourcePath
  });

  return {
    calls,
    runtime,
    service,
    setConversation(value) {
      currentConversation = value;
    },
    setPromptHints(value) {
      currentPromptHints = value;
    },
    setSession(value) {
      currentSession = value;
    }
  };
}

function generateInput(operationId = "hint:tab-1:1", vibe64User = null) {
  return {
    operationId,
    originId: "tab:1",
    vibe64User: vibe64User || {
      email: "ada@example.test",
      username: "ada"
    }
  };
}

test("prompt hint Blueprint reads only a bounded regular file contained by the session source", async (t) => {
  await t.test("reads and bounds a regular Blueprint", async () => {
    await withTemporaryDirectory(async (temporaryRoot) => {
      const sourceRoot = path.join(temporaryRoot, "source");
      const genesisRoot = path.join(sourceRoot, "genesis");
      await mkdir(genesisRoot, { recursive: true });
      await writeFile(path.join(genesisRoot, "blueprint.md"), `# Blueprint\n${"x".repeat(8_000)}`);

      const blueprint = await readPromptHintBlueprint(sourceRoot);

      assert.equal(Array.from(blueprint).length, 4_000);
      assert.match(blueprint, /^# Blueprint/u);
    });
  });

  await t.test("treats a missing Blueprint as optional", async () => {
    await withTemporaryDirectory(async (temporaryRoot) => {
      const sourceRoot = path.join(temporaryRoot, "source");
      await mkdir(sourceRoot, { recursive: true });

      assert.equal(await readPromptHintBlueprint(sourceRoot), "");
      assert.equal(await readPromptHintBlueprint(path.join(temporaryRoot, "missing-source")), "");
    });
  });

  await t.test("rejects a symbolic-link Blueprint without following it", async () => {
    await withTemporaryDirectory(async (temporaryRoot) => {
      const sourceRoot = path.join(temporaryRoot, "source");
      const genesisRoot = path.join(sourceRoot, "genesis");
      const outsideBlueprint = path.join(temporaryRoot, "outside-blueprint.md");
      await mkdir(genesisRoot, { recursive: true });
      await writeFile(outsideBlueprint, "outside secret");
      await symlink(outsideBlueprint, path.join(genesisRoot, "blueprint.md"));

      await assert.rejects(
        readPromptHintBlueprint(sourceRoot),
        { code: "vibe64_prompt_hint_blueprint_unsafe" }
      );
    });
  });

  await t.test("rejects a Blueprint reached through a parent symlink outside the source", async () => {
    await withTemporaryDirectory(async (temporaryRoot) => {
      const sourceRoot = path.join(temporaryRoot, "source");
      const outsideGenesis = path.join(temporaryRoot, "outside-genesis");
      await mkdir(sourceRoot, { recursive: true });
      await mkdir(outsideGenesis, { recursive: true });
      await writeFile(path.join(outsideGenesis, "blueprint.md"), "outside secret");
      await symlink(outsideGenesis, path.join(sourceRoot, "genesis"), "dir");

      await assert.rejects(
        readPromptHintBlueprint(sourceRoot),
        { code: "vibe64_prompt_hint_blueprint_unsafe" }
      );
    });
  });

  await t.test("rejects an irregular Blueprint path", async () => {
    await withTemporaryDirectory(async (temporaryRoot) => {
      const sourceRoot = path.join(temporaryRoot, "source");
      await mkdir(path.join(sourceRoot, "genesis", "blueprint.md"), { recursive: true });

      await assert.rejects(
        readPromptHintBlueprint(sourceRoot),
        { code: "vibe64_prompt_hint_blueprint_unsafe" }
      );
    });
  });
});

test("unsafe Blueprint filesystem entries fail hints closed before provider work", async (t) => {
  await t.test("missing Blueprint remains an allowed empty context", async () => {
    await withTemporaryDirectory(async (temporaryRoot) => {
      const sourceRoot = path.join(temporaryRoot, "source");
      await mkdir(path.join(sourceRoot, "genesis"), { recursive: true });
      const fixture = createFixture({
        readBlueprintText: readPromptHintBlueprint,
        sessionSourcePath: () => sourceRoot
      });

      const result = await fixture.service.generateSessionPromptHints(
        "session-1",
        generateInput("hint:missing-blueprint")
      );

      assert.equal(result.status, "ready");
      assert.equal(fixture.calls.run.length, 1);
      assert.match(fixture.calls.run[0].input.prompt, /"blueprint":""/u);
    });
  });

  for (const entryKind of ["symlink", "directory"]) {
    await t.test(`${entryKind} Blueprint is rejected before provider work`, async () => {
      await withTemporaryDirectory(async (temporaryRoot) => {
        const sourceRoot = path.join(temporaryRoot, "source");
        const genesisRoot = path.join(sourceRoot, "genesis");
        const blueprintPath = path.join(genesisRoot, "blueprint.md");
        await mkdir(genesisRoot, { recursive: true });
        if (entryKind === "symlink") {
          const outsideBlueprint = path.join(temporaryRoot, "outside-blueprint.md");
          await writeFile(outsideBlueprint, "outside secret");
          await symlink(outsideBlueprint, blueprintPath);
        } else {
          await mkdir(blueprintPath);
        }
        const fixture = createFixture({
          readBlueprintText: readPromptHintBlueprint,
          sessionSourcePath: () => sourceRoot
        });

        const result = await fixture.service.generateSessionPromptHints(
          "session-1",
          generateInput(`hint:unsafe-blueprint:${entryKind}`)
        );

        assert.equal(result.status, "unavailable");
        assert.equal(fixture.calls.describe.length, 0);
        assert.equal(fixture.calls.resolve.length, 0);
        assert.equal(fixture.calls.run.length, 0);
        assert.equal(
          fixture.calls.diagnostic.some((event) => event.code === "vibe64_prompt_hints_context_failed"),
          true
        );
      });
    });
  }
});

test("prompt hints stop at the toggle and use static starters only without any context", async () => {
  const disabled = createFixture({
    promptHints: projectPromptHints({ promptHints: false })
  });
  const disabledResult = await disabled.service.generateSessionPromptHints(
    "session-1",
    generateInput("hint:disabled")
  );
  assert.equal(disabledResult.ok, true);
  assert.equal(disabledResult.status, "disabled");
  assert.equal(disabledResult.cached, false);
  assert.deepEqual(disabledResult.suggestions, []);
  assert.equal(disabledResult.basis.promptHints, false);
  assert.equal(typeof disabledResult.basis.conversationRevision, "string");
  assert.equal(disabled.calls.describe.length, 0);
  assert.equal(disabled.calls.resolve.length, 0);
  assert.equal(disabled.calls.run.length, 0);

  const blank = createFixture({
    readBlueprintText: async () => "",
    conversation: {
      conversationLog: [],
      pagination: {
        count: 0,
        hasMoreBefore: false,
        limit: 8,
        newestTurnId: "",
        totalTurnCount: 0
      }
    }
  });
  const blankResult = await blank.service.generateSessionPromptHints(
    "session-1",
    generateInput("hint:blank")
  );
  assert.equal(blankResult.ok, true);
  assert.equal(blankResult.status, "static");
  assert.equal(blankResult.cached, false);
  assert.equal(blankResult.suggestions.length, 3);
  assert.equal(blankResult.suggestions.every(({ label, prompt }) => label && prompt), true);
  assert.equal(blank.calls.describe.length, 0);
  assert.equal(blank.calls.access.length, 0);
  assert.equal(blank.calls.resolve.length, 0);
  assert.equal(blank.calls.run.length, 0);
});

test("an empty conversation uses its Blueprint or draft instead of generic starters", async (t) => {
  for (const draft of ["", "Make appointments easier to cancel"]) {
    await t.test(draft ? "draft" : "Blueprint", async () => {
      const fixture = createFixture({
        conversation: { conversationLog: [] },
        readBlueprintText: async () => draft ? "" : "A dog grooming appointment manager."
      });
      const result = await fixture.service.generateSessionPromptHints("session-1", {
        ...generateInput("hint:empty-context"),
        draft
      });
      assert.equal(result.status, "ready");
      assert.equal(fixture.calls.run.length, 1);
      assert.match(fixture.calls.run[0].input.prompt, draft ? /Make appointments easier to cancel/u : /dog grooming appointment manager/u);
      assert.equal(fixture.calls.access.length, 1);
    });
  }
});

test("draft intent is primary and participates in cache identity without entering diagnostics", async () => {
  const fixture = createFixture();
  const draft = "Actually keep bookings; only remove payment collection";
  const input = { ...generateInput("hint:draft-first"), draft };
  const first = await fixture.service.generateSessionPromptHints("session-1", input);
  assert.equal(first.status, "ready");
  const prompt = fixture.calls.run[0].input.prompt;
  assert.match(prompt, /highest first: the person's current unsent draft/u);
  assert.match(prompt, /Newer user corrections override older plans/u);
  const context = JSON.parse(prompt.split("<context>\n")[1].split("\n</context>")[0]);
  assert.equal(context.draft, draft);
  assert.match(context.blueprint, /shared task tracker/u);
  assert.deepEqual(context.conversation.map(({ text }) => text), [
    "Build a shared team task tracker.", "The task list is now visible."
  ]);
  const cached = await fixture.service.generateSessionPromptHints("session-1", {
    ...input, operationId: "hint:draft-cached"
  });
  assert.equal(cached.cached, true);
  const changed = await fixture.service.generateSessionPromptHints("session-1", {
    ...input, operationId: "hint:draft-changed", draft: "Keep payment collection too"
  });
  assert.equal(changed.cached, false);
  assert.notEqual(changed.basis.draftRevision, first.basis.draftRevision);
  const cleared = await fixture.service.generateSessionPromptHints("session-1", generateInput("hint:draft-cleared"));
  assert.equal(cleared.cached, false);
  assert.equal(fixture.calls.run.length, 3);
  assert.doesNotMatch(JSON.stringify(first.basis), /remove payment collection/u);
  assert.doesNotMatch(JSON.stringify(fixture.calls.diagnostic), /remove payment collection/u);
});

test("a newer draft supersedes in-flight suggestions for the older intent", async () => {
  const started = deferred();
  const release = deferred();
  let generations = 0;
  const fixture = createFixture({
    async runAgentTurn({ options }) {
      const number = ++generations;
      const threadId = `draft-thread-${number}`;
      options.onEvent({ threadId, turnId: `draft-turn-${number}`, type: "turn" });
      if (number === 1) {
        started.resolve();
        await release.promise;
      }
      return readyAgentResult({ threadId, turnId: `draft-turn-${number}` });
    }
  });
  const first = fixture.service.generateSessionPromptHints("session-1", {
    ...generateInput("hint:draft-old"), draft: "Remove payments"
  });
  await started.promise;
  const second = await fixture.service.generateSessionPromptHints("session-1", {
    ...generateInput("hint:draft-new"), draft: "Actually keep payments"
  });
  release.resolve();
  assert.equal(second.status, "ready");
  assert.equal((await first).status, "cancelled");
  assert.equal(fixture.calls.interrupt.length, 1);
  assert.equal(fixture.calls.interrupt[0].input.threadId, "draft-thread-1");
  const latest = await fixture.service.generateSessionPromptHints("session-1", {
    ...generateInput("hint:draft-latest"), draft: "Actually keep payments"
  });
  assert.equal(latest.cached, true);
  assert.equal(generations, 2);
});

test("restricted prompt hints stop before provider inspection and cannot reuse an authorized cache", async () => {
  let restricted = false;
  const fixture = createFixture({
    requireAssistantAccess({ options, sessionId }) {
      assert.equal(sessionId, "session-1");
      assert.equal(options.vibe64User.username, "member");
      if (restricted) {
        const error = new Error("Only the workspace owner can use this personal AI connection.");
        error.code = "vibe64_assistant_owner_required";
        error.statusCode = 403;
        throw error;
      }
      return { ok: true };
    }
  });
  const vibe64User = { username: "member" };
  const first = await fixture.service.generateSessionPromptHints(
    "session-1",
    generateInput("hint:access-cache:1", vibe64User)
  );
  assert.equal(first.status, "ready");
  assert.equal(fixture.calls.describe.length, 1);
  assert.equal(fixture.calls.resolve.length, 1);
  assert.equal(fixture.calls.run.length, 1);

  restricted = true;
  const denied = await fixture.service.generateSessionPromptHints(
    "session-1",
    generateInput("hint:access-cache:2", vibe64User)
  );

  assert.equal(denied.ok, true);
  assert.equal(denied.status, "unavailable");
  assert.equal(denied.cached, false);
  assert.deepEqual(denied.suggestions, []);
  assert.equal(fixture.calls.access.length, 2);
  assert.equal(fixture.calls.describe.length, 1);
  assert.equal(fixture.calls.resolve.length, 1);
  assert.equal(fixture.calls.run.length, 1);
  assert.equal(
    fixture.calls.diagnostic.some((event) => (
      event.code === "vibe64_prompt_hints_access_restricted"
    )),
    true
  );
});

test("prompt hints use only the selected account's prompt_hint economy profile and clean the detached thread", async () => {
  const fixture = createFixture({
    promptHints: {
      customNote: "Never suggest tests.",
      promptHints: true,
      tone: "military"
    }
  });
  const input = generateInput("hint:profile");
  const result = await fixture.service.generateSessionPromptHints("session-1", input);

  assert.equal(result.ok, true);
  assert.equal(result.status, "ready");
  assert.equal(result.cached, false);
  assert.deepEqual(result.suggestions, [
    promptHint("Add task fields", "Add task assignments and due dates"),
    promptHint("Create invitation flow", "Create an invitation flow for teammates"),
    promptHint("Show overdue work", "Show overdue work on the dashboard")
  ]);
  assert.equal(typeof result.basis.conversationRevision, "string");
  assert.equal(result.basis.conversationRevision.length > 0, true);
  assert.equal(result.basis.promptHints, true);
  assert.doesNotMatch(
    fixture.calls.run[0].input.prompt,
    /Never suggest tests|military/u
  );

  assert.deepEqual(fixture.calls.resolve.map(({ input: profileInput, sessionId }) => ({
    input: profileInput,
    sessionId
  })), [{
    input: {
      profileId: "economy",
      workloadId: "prompt_hint"
    },
    sessionId: "session-1"
  }]);
  assert.equal(fixture.calls.describe.length, 1);
  assert.equal(fixture.calls.describe[0].runtime, fixture.runtime);
  assert.equal(fixture.calls.describe[0].session.sessionId, "session-1");
  assert.deepEqual(fixture.calls.describe[0].vibe64User, input.vibe64User);

  assert.equal(fixture.calls.run.length, 1);
  const agentCall = fixture.calls.run[0];
  assert.equal(agentCall.sessionId, "session-1");
  assert.deepEqual(agentCall.input.executionProfile, resolvedPromptHintProfile());
  assert.equal(agentCall.input.expectedAccountIdentitySignature, ACCOUNT_SIGNATURE);
  assert.equal(agentCall.input.promptLabel, "Vibe64 prompt hints");
  assert.equal(agentCall.input.agentSettings, undefined);
  assert.equal(agentCall.input.outputSchema.type, "object");
  assert.deepEqual(agentCall.input.outputSchema.required, ["suggestions"]);
  assert.equal(agentCall.input.outputSchema.additionalProperties, false);
  assert.equal(agentCall.input.outputSchema.properties.suggestions.minItems, 3);
  assert.equal(agentCall.input.outputSchema.properties.suggestions.maxItems, 3);
  assert.equal(agentCall.input.outputSchema.properties.suggestions.items.type, "object");
  assert.equal(agentCall.input.outputSchema.properties.suggestions.items.additionalProperties, false);
  assert.deepEqual(agentCall.input.outputSchema.properties.suggestions.items.required, [
    "label",
    "prompt"
  ]);
  assert.equal(
    agentCall.input.outputSchema.properties.suggestions.items.properties.label.maxLength,
    24
  );
  assert.equal(
    agentCall.input.outputSchema.properties.suggestions.items.properties.prompt.maxLength,
    108
  );
  assert.match(agentCall.input.prompt, /Build a shared team task tracker\./u);
  assert.match(agentCall.input.prompt, /The task list is now visible\./u);
  assert.doesNotMatch(agentCall.input.prompt, /SECRET SYSTEM|SECRET COMMENTARY|SECRET REASONING/u);
  assert.equal(agentCall.options.runtime, fixture.runtime);
  assert.equal(agentCall.options.session.sessionId, "session-1");
  assert.deepEqual(agentCall.options.vibe64User, input.vibe64User);

  assert.equal(fixture.calls.delete.length, 1);
  assert.deepEqual(fixture.calls.delete[0].input, {
    executionProfile: {
      profileId: "economy",
      workloadId: "prompt_hint"
    },
    threadId: "thread-hints-1"
  });
  assert.equal(fixture.calls.delete[0].options.runtime, fixture.runtime);
  assert.equal(fixture.calls.delete[0].options.session.sessionId, "session-1");
});

test("prompt hint parsing preserves normalized Unicode pairs and rejects noncanonical envelopes", () => {
  const expected = [
    promptHint(`${"😀".repeat(22)} a`, "😀".repeat(108)),
    promptHint("Check next step", "Check the safest useful next step"),
    promptHint("Explain recent work", "Explain the most recent project work")
  ];
  const suggestions = [
    promptHint(`  ${"😀".repeat(22)}   a  `, `  ${"😀".repeat(108)}  `),
    promptHint("  Check   next step  ", "  Check  the safest useful next step  "),
    expected[2]
  ];
  assert.deepEqual(parsePromptHintSuggestions(JSON.stringify({ suggestions })), expected);
  for (const value of [
    "not JSON",
    "null",
    "{}",
    JSON.stringify(suggestions),
    JSON.stringify({ suggestions, explanation: "Not allowed" })
  ]) {
    assert.equal(parsePromptHintSuggestions(value), null);
  }
});

test("prompt hints reject malformed, duplicate, multiline, and overlong model suggestions without caching partial output", async (t) => {
  const validSuggestions = [
    promptHint("Review current plan", "Review the current plan with me"),
    promptHint("Check next step", "Check the safest useful next step"),
    promptHint("Explain recent work", "Explain the most recent project work")
  ];
  const invalidOutputs = [
    {
      name: "not JSON",
      rawText: "One, Two, Three"
    },
    {
      name: "extra property",
      rawText: JSON.stringify({
        explanation: "Not allowed",
        suggestions: validSuggestions
      })
    },
    {
      name: "wrong count",
      suggestions: validSuggestions.slice(0, 2)
    },
    {
      name: "three valid hints plus null",
      suggestions: [...validSuggestions, null]
    },
    {
      name: "three valid hints plus malformed object",
      suggestions: [...validSuggestions, { label: "Incomplete suggestion" }]
    },
    {
      name: "duplicate labels",
      suggestions: [
        validSuggestions[0],
        promptHint(validSuggestions[0].label.toUpperCase(), "Use a different full prompt"),
        validSuggestions[2]
      ]
    },
    {
      name: "duplicate prompts",
      suggestions: [
        validSuggestions[0],
        promptHint(validSuggestions[1].label, validSuggestions[0].prompt.toUpperCase()),
        validSuggestions[2]
      ]
    },
    {
      name: "non-string label",
      suggestions: [
        validSuggestions[0],
        { ...validSuggestions[1], label: 42 },
        validSuggestions[2]
      ]
    },
    {
      name: "multiline",
      suggestions: [
        validSuggestions[0],
        promptHint("Check next step", "Check the next\nstep"),
        validSuggestions[2]
      ]
    },
    {
      name: "overlong prompt",
      suggestions: [
        promptHint("Review current plan", "x".repeat(109)),
        validSuggestions[1],
        validSuggestions[2]
      ]
    },
    {
      name: "verbose label",
      suggestions: [
        promptHint("This label has too many words", "Review the current plan with me"),
        validSuggestions[1],
        validSuggestions[2]
      ]
    },
    {
      name: "extra suggestion property",
      suggestions: [
        { ...validSuggestions[0], icon: "not allowed" },
        validSuggestions[1],
        validSuggestions[2]
      ]
    }
  ];

  for (const invalid of invalidOutputs) {
    await t.test(invalid.name, async () => {
      let agentCalls = 0;
      const fixture = createFixture({
        runAgentTurn({ options }) {
          agentCalls += 1;
          const threadId = `thread-invalid-${agentCalls}`;
          options.onEvent({
            executionProfile: resolvedPromptHintProfile(),
            type: "execution-profile"
          });
          options.onEvent({ threadId, type: "thread" });
          const result = readyAgentResult({
            suggestions: invalid.suggestions,
            threadId,
            turnId: `turn-invalid-${agentCalls}`
          });
          return Object.hasOwn(invalid, "rawText")
            ? {
                ...result,
                text: invalid.rawText
              }
            : result;
        }
      });
      const first = await fixture.service.generateSessionPromptHints(
        "session-1",
        generateInput(`hint:invalid:${invalid.name.replaceAll(" ", "-")}:1`)
      );
      const second = await fixture.service.generateSessionPromptHints(
        "session-1",
        generateInput(`hint:invalid:${invalid.name.replaceAll(" ", "-")}:2`)
      );

      assert.equal(first.ok, true);
      assert.equal(first.status, "unavailable");
      assert.deepEqual(first.suggestions, []);
      assert.equal(second.status, "unavailable");
      assert.equal(agentCalls, 2, "invalid model output must not enter the cache");
      assert.equal(fixture.calls.delete.length, 2);
    });
  }
});

test("prompt hints coalesce identical work, invalidate on conversation, and ignore former policy fields", async () => {
  const started = deferred();
  const release = deferred();
  let agentCalls = 0;
  const fixture = createFixture({
    async runAgentTurn({ options }) {
      agentCalls += 1;
      const threadId = `thread-cache-${agentCalls}`;
      options.onEvent({
        executionProfile: resolvedPromptHintProfile(),
        type: "execution-profile"
      });
      options.onEvent({ threadId, type: "thread" });
      if (agentCalls === 1) {
        started.resolve();
        await release.promise;
      }
      return readyAgentResult({
        threadId,
        turnId: `turn-cache-${agentCalls}`
      });
    }
  });

  const first = fixture.service.generateSessionPromptHints(
    "session-1",
    generateInput("hint:coalesce:1")
  );
  await started.promise;
  const second = fixture.service.generateSessionPromptHints(
    "session-1",
    generateInput("hint:coalesce:2")
  );
  release.resolve();
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(firstResult.status, "ready");
  assert.equal(secondResult.status, "ready");
  assert.deepEqual(firstResult.suggestions, secondResult.suggestions);
  assert.equal(agentCalls, 1);

  const cached = await fixture.service.generateSessionPromptHints(
    "session-1",
    generateInput("hint:cache:3")
  );
  assert.equal(cached.status, "ready");
  assert.equal(cached.cached, true);
  assert.equal(agentCalls, 1);

  fixture.setConversation(conversationPage({
    assistantText: "The task list now includes owners.",
    newestTurnId: "turn-2",
    totalTurnCount: 2
  }));
  const conversationChanged = await fixture.service.generateSessionPromptHints(
    "session-1",
    generateInput("hint:cache:conversation")
  );
  assert.equal(conversationChanged.status, "ready");
  assert.equal(conversationChanged.cached, false);
  assert.equal(agentCalls, 2);

  fixture.setPromptHints({
    promptHints: true,
    revision: 8,
    tone: "military"
  });
  const policyChanged = await fixture.service.generateSessionPromptHints(
    "session-1",
    generateInput("hint:cache:policy")
  );
  assert.equal(policyChanged.status, "ready");
  assert.equal(policyChanged.cached, true);
  assert.equal(agentCalls, 2);
});

test("prompt-hint cache identity follows the selected provider account and expires at its bounded TTL", async () => {
  let accountIdentitySignature = ACCOUNT_SIGNATURE;
  let agentCalls = 0;
  let nowMs = 1_000;
  const fixture = createFixture({
    accountIdentitySignature: () => accountIdentitySignature,
    cacheTtlMs: 50,
    now: () => nowMs,
    runAgentTurn({ options }) {
      agentCalls += 1;
      const threadId = `thread-account-cache-${agentCalls}`;
      options.onEvent({
        executionProfile: resolvedPromptHintProfile(),
        type: "execution-profile"
      });
      options.onEvent({ threadId, type: "thread" });
      return readyAgentResult({
        threadId,
        turnId: `turn-account-cache-${agentCalls}`
      });
    }
  });

  await fixture.service.generateSessionPromptHints(
    "session-1",
    generateInput("hint:account-cache:1")
  );
  const cached = await fixture.service.generateSessionPromptHints(
    "session-1",
    generateInput("hint:account-cache:2")
  );
  assert.equal(cached.cached, true);
  assert.equal(agentCalls, 1);

  accountIdentitySignature = `sha256:${"b".repeat(64)}`;
  const switchedAccount = await fixture.service.generateSessionPromptHints(
    "session-1",
    generateInput("hint:account-cache:3")
  );
  assert.equal(switchedAccount.cached, false);
  assert.equal(agentCalls, 2);

  nowMs += 51;
  const expired = await fixture.service.generateSessionPromptHints(
    "session-1",
    generateInput("hint:account-cache:4")
  );
  assert.equal(expired.cached, false);
  assert.equal(agentCalls, 3);
});

test("prompt-hint cache evicts the least-recently-used entry at its configured bound", async () => {
  let agentCalls = 0;
  const fixture = createFixture({
    cacheMaxEntries: 2,
    runAgentTurn({ options }) {
      agentCalls += 1;
      const threadId = `thread-bounded-cache-${agentCalls}`;
      options.onEvent({ threadId, type: "thread" });
      return readyAgentResult({
        threadId,
        turnId: `turn-bounded-cache-${agentCalls}`
      });
    }
  });
  const conversations = [1, 2, 3].map((number) => conversationPage({
    assistantText: `Conversation version ${number}.`,
    newestTurnId: `turn-${number}`,
    totalTurnCount: number
  }));

  for (const [index, conversation] of conversations.entries()) {
    fixture.setConversation(conversation);
    const result = await fixture.service.generateSessionPromptHints(
      "session-1",
      generateInput(`hint:bounded-cache:${index + 1}`)
    );
    assert.equal(result.cached, false);
  }
  assert.equal(agentCalls, 3);

  fixture.setConversation(conversations[1]);
  const retained = await fixture.service.generateSessionPromptHints(
    "session-1",
    generateInput("hint:bounded-cache:retained")
  );
  assert.equal(retained.cached, true);
  assert.equal(agentCalls, 3);

  fixture.setConversation(conversations[0]);
  const evicted = await fixture.service.generateSessionPromptHints(
    "session-1",
    generateInput("hint:bounded-cache:evicted")
  );
  assert.equal(evicted.cached, false);
  assert.equal(agentCalls, 4);
});

test("prompt hints discard a completed turn when the conversation changes during generation", async () => {
  const started = deferred();
  const release = deferred();
  const fixture = createFixture({
    async runAgentTurn({ options }) {
      options.onEvent({
        executionProfile: resolvedPromptHintProfile(),
        type: "execution-profile"
      });
      options.onEvent({ threadId: "thread-stale", type: "thread" });
      started.resolve();
      await release.promise;
      return readyAgentResult({
        threadId: "thread-stale",
        turnId: "turn-stale"
      });
    }
  });
  const generation = fixture.service.generateSessionPromptHints(
    "session-1",
    generateInput("hint:stale")
  );
  await started.promise;
  fixture.setConversation(conversationPage({
    assistantText: "A newer assistant answer arrived.",
    newestTurnId: "turn-2",
    totalTurnCount: 2
  }));
  release.resolve();

  const result = await generation;
  assert.equal(result.ok, true);
  assert.equal(result.status, "stale");
  assert.deepEqual(result.suggestions, []);
  assert.equal(result.cached, false);
  assert.equal(fixture.calls.delete.length, 1);
});

test("prompt hints ignore the temporary agent lifecycle's opaque session revision changes", async () => {
  const started = deferred();
  const release = deferred();
  const fixture = createFixture({
    async runAgentTurn({ options }) {
      options.onEvent({
        executionProfile: resolvedPromptHintProfile(),
        type: "execution-profile"
      });
      options.onEvent({ threadId: "thread-session-revision", type: "thread" });
      started.resolve();
      await release.promise;
      return readyAgentResult({
        threadId: "thread-session-revision",
        turnId: "turn-session-revision"
      });
    }
  });
  fixture.setSession({
    revision: 100,
    sessionId: "session-1",
    sourceReady: true,
    status: "active"
  });
  const generation = fixture.service.generateSessionPromptHints(
    "session-1",
    generateInput("hint:session-revision")
  );
  await started.promise;
  fixture.setSession({
    revision: 103,
    sessionId: "session-1",
    sourceReady: true,
    status: "active"
  });
  release.resolve();

  const result = await generation;
  assert.equal(result.status, "ready");
  assert.equal(result.cached, false);
  assert.equal(result.suggestions.length, 3);
});

test("prompt hints discard a completed turn when relevant session state changes", async () => {
  const started = deferred();
  const release = deferred();
  const fixture = createFixture({
    async runAgentTurn({ options }) {
      options.onEvent({
        executionProfile: resolvedPromptHintProfile(),
        type: "execution-profile"
      });
      options.onEvent({ threadId: "thread-session-state", type: "thread" });
      started.resolve();
      await release.promise;
      return readyAgentResult({
        threadId: "thread-session-state",
        turnId: "turn-session-state"
      });
    }
  });
  const generation = fixture.service.generateSessionPromptHints(
    "session-1",
    generateInput("hint:session-state")
  );
  await started.promise;
  fixture.setSession({
    revision: 2,
    sessionId: "session-1",
    sourceReady: true,
    status: "blocked"
  });
  release.resolve();

  const result = await generation;
  assert.equal(result.status, "stale");
  assert.deepEqual(result.suggestions, []);
});

test("prompt-hint cancellation can win before preparation starts and never starts Luna", async () => {
  const fixture = createFixture();
  const projectContext = testProjectContext("project-immediate-cancel");
  const input = generateInput("hint:cancel-before-prepare");

  const generation = runWithProjectRequestContext(projectContext, () => (
    fixture.service.generateSessionPromptHints("session-1", input)
  ));
  const cancellation = runWithProjectRequestContext(projectContext, () => (
    fixture.service.cancelSessionPromptHints("session-1", input)
  ));

  assert.equal((await cancellation).status, "cancelled");
  assert.equal((await generation).status, "cancelled");
  assert.equal(fixture.calls.session.length, 0);
  assert.equal(fixture.calls.describe.length, 0);
  assert.equal(fixture.calls.resolve.length, 0);
  assert.equal(fixture.calls.run.length, 0);
});

test("prompt-hint cancellation during context preparation never resolves or starts Luna", async () => {
  const contextStarted = deferred();
  const releaseContext = deferred();
  const fixture = createFixture({
    async conversation() {
      contextStarted.resolve();
      return releaseContext.promise;
    }
  });
  const projectContext = testProjectContext("project-context-cancel");
  const input = generateInput("hint:cancel-during-context");
  const generation = runWithProjectRequestContext(projectContext, () => (
    fixture.service.generateSessionPromptHints("session-1", input)
  ));
  await contextStarted.promise;

  const cancellation = await runWithProjectRequestContext(projectContext, () => (
    fixture.service.cancelSessionPromptHints("session-1", input)
  ));
  releaseContext.resolve(conversationPage());
  const result = await generation;

  assert.equal(cancellation.status, "cancelled");
  assert.equal(result.status, "cancelled");
  assert.equal(fixture.calls.describe.length, 0);
  assert.equal(fixture.calls.resolve.length, 0);
  assert.equal(fixture.calls.run.length, 0);
});

test("prompt-hint cancellation during profile resolution never starts Luna", async () => {
  const profileStarted = deferred();
  const releaseProfile = deferred();
  const fixture = createFixture({
    async resolveExecutionProfile() {
      profileStarted.resolve();
      return releaseProfile.promise;
    }
  });
  const projectContext = testProjectContext("project-profile-cancel");
  const input = generateInput("hint:cancel-during-profile");
  const generation = runWithProjectRequestContext(projectContext, () => (
    fixture.service.generateSessionPromptHints("session-1", input)
  ));
  await profileStarted.promise;

  const cancellation = await runWithProjectRequestContext(projectContext, () => (
    fixture.service.cancelSessionPromptHints("session-1", input)
  ));
  releaseProfile.resolve(resolvedPromptHintProfile());
  const result = await generation;

  assert.equal(cancellation.status, "cancelled");
  assert.equal(result.status, "cancelled");
  assert.equal(fixture.calls.describe.length, 1);
  assert.equal(fixture.calls.resolve.length, 1);
  assert.equal(fixture.calls.run.length, 0);
});

test("prompt-hint cancellation interrupts the exact detached turn, cleans it, and never caches it", async () => {
  const started = deferred();
  const interrupted = deferred();
  let agentCalls = 0;
  const fixture = createFixture({
    async runAgentTurn({ options }) {
      agentCalls += 1;
      options.onEvent({
        executionProfile: resolvedPromptHintProfile(),
        type: "execution-profile"
      });
      options.onEvent({ threadId: "thread-cancel", type: "thread" });
      options.onEvent({
        threadId: "thread-cancel",
        turnId: "turn-cancel",
        type: "turn"
      });
      started.resolve();
      await interrupted.promise;
      return {
        code: "vibe64_agent_turn_cancelled",
        executionProfile: resolvedPromptHintProfile(),
        ok: false,
        threadId: "thread-cancel",
        turnId: "turn-cancel"
      };
    }
  });
  const originalInterrupt = fixture.service.cancelSessionPromptHints.bind(fixture.service);
  const generation = fixture.service.generateSessionPromptHints(
    "session-1",
    generateInput("hint:cancel")
  );
  await started.promise;
  const cancellation = originalInterrupt("session-1", generateInput("hint:cancel"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fixture.calls.interrupt.length, 1);
  assert.deepEqual(fixture.calls.interrupt[0].input, {
    executionProfile: {
      profileId: "economy",
      workloadId: "prompt_hint"
    },
    threadId: "thread-cancel",
    turnId: "turn-cancel"
  });
  interrupted.resolve();
  const [cancelResult, generationResult] = await Promise.all([cancellation, generation]);

  assert.equal(cancelResult.status, "cancelled");
  assert.equal(generationResult.status, "cancelled");
  assert.deepEqual(generationResult.suggestions, []);
  assert.equal(fixture.calls.delete.length, 1);

  await fixture.service.generateSessionPromptHints(
    "session-1",
    generateInput("hint:cancel:retry")
  );
  assert.equal(agentCalls, 2, "cancelled work must not enter the cache");
});

test("cancelling one coalesced subscriber leaves the shared generation available to the other", async () => {
  const started = deferred();
  const release = deferred();
  let agentCalls = 0;
  const fixture = createFixture({
    async runAgentTurn({ options }) {
      agentCalls += 1;
      options.onEvent({
        executionProfile: resolvedPromptHintProfile(),
        type: "execution-profile"
      });
      options.onEvent({ threadId: "thread-shared", type: "thread" });
      options.onEvent({
        threadId: "thread-shared",
        turnId: "turn-shared",
        type: "turn"
      });
      started.resolve();
      await release.promise;
      return readyAgentResult({
        threadId: "thread-shared",
        turnId: "turn-shared"
      });
    }
  });
  const firstInput = generateInput("hint:shared:1");
  const secondInput = generateInput("hint:shared:2");
  const first = fixture.service.generateSessionPromptHints("session-1", firstInput);
  await started.promise;
  const second = fixture.service.generateSessionPromptHints("session-1", secondInput);
  await new Promise((resolve) => setImmediate(resolve));
  const cancellation = await fixture.service.cancelSessionPromptHints("session-1", firstInput);

  assert.equal(cancellation.status, "cancelled");
  assert.equal(fixture.calls.interrupt.length, 0);
  release.resolve();
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(firstResult.status, "cancelled");
  assert.equal(secondResult.status, "ready");
  assert.equal(agentCalls, 1);
  assert.equal(fixture.calls.delete.length, 1);
});

test("cancellation requested before thread ids arrive interrupts as soon as the exact turn is known", async () => {
  const runStarted = deferred();
  const publishIds = deferred();
  const interrupted = deferred();
  const fixture = createFixture({
    async runAgentTurn({ options }) {
      runStarted.resolve();
      await publishIds.promise;
      options.onEvent({
        executionProfile: resolvedPromptHintProfile(),
        type: "execution-profile"
      });
      options.onEvent({ threadId: "thread-late-ids", type: "thread" });
      options.onEvent({
        threadId: "thread-late-ids",
        turnId: "turn-late-ids",
        type: "turn"
      });
      await interrupted.promise;
      return {
        code: "vibe64_agent_turn_cancelled",
        executionProfile: resolvedPromptHintProfile(),
        ok: false,
        threadId: "thread-late-ids",
        turnId: "turn-late-ids"
      };
    }
  });
  const input = generateInput("hint:late-ids");
  const generation = fixture.service.generateSessionPromptHints("session-1", input);
  await runStarted.promise;
  const cancellation = await fixture.service.cancelSessionPromptHints("session-1", input);
  assert.equal(cancellation.status, "cancelled");
  assert.equal(fixture.calls.interrupt.length, 0);

  publishIds.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fixture.calls.interrupt.length, 1);
  assert.deepEqual(fixture.calls.interrupt[0].input, {
    executionProfile: {
      profileId: "economy",
      workloadId: "prompt_hint"
    },
    threadId: "thread-late-ids",
    turnId: "turn-late-ids"
  });
  interrupted.resolve();
  const result = await generation;
  assert.equal(result.status, "cancelled");
  assert.equal(fixture.calls.delete.length, 1);
});

test("prompt hints fail silently and retain no cache entry when detached-thread cleanup is not acknowledged", async () => {
  let agentCalls = 0;
  const fixture = createFixture({
    deleteResult: {
      code: "unit_cleanup_failed",
      error: "Cleanup failed.",
      ok: false
    },
    runAgentTurn({ options }) {
      agentCalls += 1;
      const threadId = `thread-cleanup-${agentCalls}`;
      options.onEvent({
        executionProfile: resolvedPromptHintProfile(),
        type: "execution-profile"
      });
      options.onEvent({ threadId, type: "thread" });
      return readyAgentResult({
        threadId,
        turnId: `turn-cleanup-${agentCalls}`
      });
    }
  });

  const first = await fixture.service.generateSessionPromptHints(
    "session-1",
    generateInput("hint:cleanup:1")
  );
  const second = await fixture.service.generateSessionPromptHints(
    "session-1",
    generateInput("hint:cleanup:2")
  );
  assert.equal(first.ok, true);
  assert.equal(first.status, "unavailable");
  assert.deepEqual(first.suggestions, []);
  assert.equal(second.status, "unavailable");
  assert.equal(agentCalls, 2);
  assert.equal(fixture.calls.delete.length, 2);
});

test("prompt hints require an explicit successful cleanup acknowledgement", async () => {
  let agentCalls = 0;
  const fixture = createFixture({
    deleteResult() {
      return undefined;
    },
    runAgentTurn({ options }) {
      agentCalls += 1;
      const threadId = `thread-cleanup-unacknowledged-${agentCalls}`;
      options.onEvent({
        executionProfile: resolvedPromptHintProfile(),
        type: "execution-profile"
      });
      options.onEvent({ threadId, type: "thread" });
      return readyAgentResult({
        threadId,
        turnId: `turn-cleanup-unacknowledged-${agentCalls}`
      });
    }
  });

  const first = await fixture.service.generateSessionPromptHints(
    "session-1",
    generateInput("hint:cleanup-unacknowledged:1")
  );
  const second = await fixture.service.generateSessionPromptHints(
    "session-1",
    generateInput("hint:cleanup-unacknowledged:2")
  );

  assert.equal(first.status, "unavailable");
  assert.equal(second.status, "unavailable");
  assert.equal(agentCalls, 2, "an unacknowledged cleanup must never produce a cache entry");
});

test("prompt hints fail closed when a successful detached turn exposes no thread to clean up", async () => {
  let agentCalls = 0;
  const fixture = createFixture({
    runAgentTurn() {
      agentCalls += 1;
      return readyAgentResult({
        threadId: "",
        turnId: `turn-without-thread-${agentCalls}`
      });
    }
  });

  const first = await fixture.service.generateSessionPromptHints(
    "session-1",
    generateInput("hint:missing-thread:1")
  );
  const second = await fixture.service.generateSessionPromptHints(
    "session-1",
    generateInput("hint:missing-thread:2")
  );

  assert.equal(first.status, "unavailable");
  assert.equal(second.status, "unavailable");
  assert.equal(agentCalls, 2, "an uncleanable detached turn must never enter the cache");
  assert.equal(fixture.calls.delete.length, 0);
  assert.equal(
    fixture.calls.diagnostic.some((event) => event.code === "vibe64_prompt_hints_cleanup_failed"),
    true
  );
});

test("prompt hints reject a result that does not prove the resolved economy profile was used", async () => {
  let agentCalls = 0;
  const fixture = createFixture({
    runAgentTurn({ options }) {
      agentCalls += 1;
      const threadId = `thread-profile-unverified-${agentCalls}`;
      options.onEvent({ threadId, type: "thread" });
      return {
        ok: true,
        text: JSON.stringify({
          suggestions: [
            promptHint("Review current plan", "Review the current plan with me"),
            promptHint("Check next step", "Check the safest useful next step"),
            promptHint("Explain recent work", "Explain the most recent project work")
          ]
        }),
        threadId,
        turnId: `turn-profile-unverified-${agentCalls}`
      };
    }
  });

  const first = await fixture.service.generateSessionPromptHints(
    "session-1",
    generateInput("hint:profile-unverified:1")
  );
  const second = await fixture.service.generateSessionPromptHints(
    "session-1",
    generateInput("hint:profile-unverified:2")
  );

  assert.equal(first.status, "unavailable");
  assert.equal(second.status, "unavailable");
  assert.equal(agentCalls, 2, "unverified work must not enter the cache");
  assert.equal(fixture.calls.delete.length, 2);
});

test("the same client operation id remains isolated between sessions", async () => {
  const sessionOneStarted = deferred();
  const releaseSessionOne = deferred();
  const agentSessions = [];
  const fixture = createFixture({
    conversation: (sessionId) => conversationPage({
      assistantText: `Assistant context for ${sessionId}.`,
      newestTurnId: `${sessionId}-turn-1`,
      userText: `User context for ${sessionId}.`
    }),
    async runAgentTurn({ options, sessionId }) {
      agentSessions.push(sessionId);
      const threadId = `${sessionId}-thread-hints`;
      options.onEvent({
        executionProfile: resolvedPromptHintProfile(),
        type: "execution-profile"
      });
      options.onEvent({ threadId, type: "thread" });
      if (sessionId === "session-1") {
        sessionOneStarted.resolve();
        await releaseSessionOne.promise;
      }
      return readyAgentResult({
        suggestions: [
          promptHint(`First ${sessionId} step`, `First suggestion for ${sessionId}`),
          promptHint(`Second ${sessionId} step`, `Second suggestion for ${sessionId}`),
          promptHint(`Third ${sessionId} step`, `Third suggestion for ${sessionId}`)
        ],
        threadId,
        turnId: `${sessionId}-turn-hints`
      });
    }
  });
  const sharedClientInput = generateInput("hint:same-client-counter");
  const first = fixture.service.generateSessionPromptHints("session-1", sharedClientInput);
  await sessionOneStarted.promise;
  const second = fixture.service.generateSessionPromptHints("session-2", sharedClientInput);
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(agentSessions, ["session-1", "session-2"]);
  releaseSessionOne.resolve();
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.match(firstResult.suggestions[0].prompt, /session-1/u);
  assert.match(secondResult.suggestions[0].prompt, /session-2/u);
});

test("equal session and operation ids stay isolated by canonical project scope and actor", async () => {
  const allStarted = deferred();
  const release = deferred();
  let startedCount = 0;
  const fixture = createFixture({
    async runAgentTurn({ options }) {
      const projectScope = currentProjectScopeKey();
      const username = options.vibe64User?.username || "local";
      const identity = `${projectScope.replace(":", "-")}-${username}`;
      const threadId = `thread-${identity}`;
      options.onEvent({
        executionProfile: resolvedPromptHintProfile(),
        type: "execution-profile"
      });
      options.onEvent({ threadId, type: "thread" });
      options.onEvent({
        threadId,
        turnId: `turn-${identity}`,
        type: "turn"
      });
      startedCount += 1;
      if (startedCount === 3) {
        allStarted.resolve();
      }
      await release.promise;
      return readyAgentResult({
        suggestions: [
          promptHint("Review first scope", `First suggestion for ${identity}`),
          promptHint("Review second scope", `Second suggestion for ${identity}`),
          promptHint("Review third scope", `Third suggestion for ${identity}`)
        ],
        threadId,
        turnId: `turn-${identity}`
      });
    }
  });
  const alpha = testProjectContext("alpha");
  const beta = testProjectContext("beta");
  const ada = {
    email: "ada@example.test",
    username: "ada"
  };
  const grace = {
    email: "grace@example.test",
    username: "grace"
  };
  const alphaAdaInput = generateInput("hint:shared-operation", ada);
  const alphaGraceInput = generateInput("hint:shared-operation", grace);
  const betaAdaInput = generateInput("hint:shared-operation", ada);

  const alphaAda = runWithProjectRequestContext(alpha, () => (
    fixture.service.generateSessionPromptHints("session-shared", alphaAdaInput)
  ));
  const alphaGrace = runWithProjectRequestContext(alpha, () => (
    fixture.service.generateSessionPromptHints("session-shared", alphaGraceInput)
  ));
  const betaAda = runWithProjectRequestContext(beta, () => (
    fixture.service.generateSessionPromptHints("session-shared", betaAdaInput)
  ));
  await allStarted.promise;

  const cancellation = await runWithProjectRequestContext(alpha, () => (
    fixture.service.cancelSessionPromptHints("session-shared", alphaAdaInput)
  ));
  assert.equal(cancellation.status, "cancelled");
  assert.equal(fixture.calls.interrupt.length, 1);
  assert.equal(fixture.calls.interrupt[0].projectScope, "project:alpha");
  assert.equal(fixture.calls.interrupt[0].options.vibe64User.username, "ada");

  release.resolve();
  const [alphaAdaResult, alphaGraceResult, betaAdaResult] = await Promise.all([
    alphaAda,
    alphaGrace,
    betaAda
  ]);
  assert.equal(alphaAdaResult.status, "cancelled");
  assert.equal(alphaGraceResult.status, "ready");
  assert.equal(betaAdaResult.status, "ready");
  assert.equal(fixture.calls.run.length, 3);
  assert.deepEqual(
    new Set(fixture.calls.run.map((call) => (
      `${call.projectScope}:${call.options.vibe64User.username}`
    ))),
    new Set(["project:alpha:ada", "project:alpha:grace", "project:beta:ada"])
  );

  const cachedAlphaGrace = await runWithProjectRequestContext(alpha, () => (
    fixture.service.generateSessionPromptHints(
      "session-shared",
      generateInput("hint:alpha-grace-cache", grace)
    )
  ));
  const cachedBetaAda = await runWithProjectRequestContext(beta, () => (
    fixture.service.generateSessionPromptHints(
      "session-shared",
      generateInput("hint:beta-ada-cache", ada)
    )
  ));
  const regeneratedAlphaAda = await runWithProjectRequestContext(alpha, () => (
    fixture.service.generateSessionPromptHints(
      "session-shared",
      generateInput("hint:alpha-ada-regenerate", ada)
    )
  ));
  assert.equal(cachedAlphaGrace.cached, true);
  assert.equal(cachedBetaAda.cached, true);
  assert.equal(regeneratedAlphaAda.cached, false);
  assert.equal(fixture.calls.run.length, 4);
});

test("session-wide Send cancellation covers preparing requests only in its canonical project", async () => {
  const allContextsStarted = deferred();
  const releaseContext = deferred();
  let contextCount = 0;
  const fixture = createFixture({
    async conversation() {
      contextCount += 1;
      if (contextCount === 3) {
        allContextsStarted.resolve();
      }
      return releaseContext.promise;
    }
  });
  const alpha = testProjectContext("send-alpha");
  const beta = testProjectContext("send-beta");
  const ada = {
    email: "ada@example.test",
    username: "ada"
  };
  const grace = {
    email: "grace@example.test",
    username: "grace"
  };
  const alphaAda = runWithProjectRequestContext(alpha, () => (
    fixture.service.generateSessionPromptHints(
      "session-shared",
      generateInput("hint:send-alpha-ada", ada)
    )
  ));
  const alphaGrace = runWithProjectRequestContext(alpha, () => (
    fixture.service.generateSessionPromptHints(
      "session-shared",
      generateInput("hint:send-alpha-grace", grace)
    )
  ));
  const betaAda = runWithProjectRequestContext(beta, () => (
    fixture.service.generateSessionPromptHints(
      "session-shared",
      generateInput("hint:send-beta-ada", ada)
    )
  ));
  await allContextsStarted.promise;

  const cancellation = await runWithProjectRequestContext(alpha, () => (
    fixture.service.cancelSessionPromptHintsForSession("session-shared")
  ));
  assert.deepEqual(cancellation, {
    cancelled: 2,
    ok: true
  });
  releaseContext.resolve(conversationPage());

  const [alphaAdaResult, alphaGraceResult, betaAdaResult] = await Promise.all([
    alphaAda,
    alphaGrace,
    betaAda
  ]);
  assert.equal(alphaAdaResult.status, "cancelled");
  assert.equal(alphaGraceResult.status, "cancelled");
  assert.equal(betaAdaResult.status, "ready");
  assert.equal(fixture.calls.run.length, 1);
  assert.equal(fixture.calls.run[0].projectScope, "project:send-beta");
  assert.equal(fixture.calls.resolve.length, 1);
});

test("internal session cancellation settles optional hint generation", async () => {
  const started = deferred();
  const interrupted = deferred();
  const fixture = createFixture({
    async runAgentTurn({ options }) {
      options.onEvent({
        executionProfile: resolvedPromptHintProfile(),
        type: "execution-profile"
      });
      options.onEvent({ threadId: "thread-send-priority", type: "thread" });
      options.onEvent({
        threadId: "thread-send-priority",
        turnId: "turn-send-priority",
        type: "turn"
      });
      started.resolve();
      await interrupted.promise;
      return {
        code: "vibe64_agent_turn_cancelled",
        executionProfile: resolvedPromptHintProfile(),
        ok: false,
        threadId: "thread-send-priority",
        turnId: "turn-send-priority"
      };
    }
  });
  const generation = fixture.service.generateSessionPromptHints(
    "session-1",
    generateInput("hint:send-priority")
  );
  await started.promise;
  const cancellation = fixture.service.cancelSessionPromptHintsForSession("session-1");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fixture.calls.interrupt.length, 1);
  interrupted.resolve();
  await cancellation;
  assert.equal(fixture.calls.delete.length, 1);

  const result = await generation;
  assert.equal(result.status, "cancelled");
  assert.equal(fixture.calls.delete.length, 1);
});
