import assert from "node:assert/strict";
import test from "node:test";

import {
  codexAppServerIdentityMetadata,
  codexAppServerThreadSettings,
  codexAppServerTurnPrompt,
  codexAppServerTurnSettings,
  ensureCodexAppServerThreadForSession,
  sendCodexAppServerPromptForSession
} from "@local/vibe64-runtime/server/codexAppServerSessionBridge";

function fakeRuntime() {
  const writes = [];
  return {
    store: {
      async mutateSession(sessionId, callback) {
        await callback();
        writes.push({
          kind: "mutate",
          sessionId
        });
      },
      async writeMetadataValue(sessionId, name, value) {
        writes.push({
          kind: "metadata",
          name,
          sessionId,
          value
        });
      }
    },
    writes
  };
}

function metadataValue(runtime, name) {
  return runtime.writes.find((write) => write.kind === "metadata" && write.name === name)?.value;
}

function appServerRuntime() {
  return {
    containerEndpoint: "unix:///vibe64-codex-app-server/app-server.sock",
    containerRuntimeDir: "/vibe64-codex-app-server",
    containerSocketPath: "/vibe64-codex-app-server/app-server.sock",
    endpoint: "unix:///tmp/vibe64/agent-providers/codex-app-server/app-server.sock",
    runtimeDir: "/tmp/vibe64/agent-providers/codex-app-server",
    socketPath: "/tmp/vibe64/agent-providers/codex-app-server/app-server.sock",
    transport: "unix"
  };
}

function bootstrapProviderParts(providerCalls) {
  const subscribers = [];
  return {
    async sendTurn(threadId, input, params) {
      providerCalls.push({
        input,
        method: "sendTurn",
        params,
        threadId
      });
      queueMicrotask(() => {
        for (const callback of subscribers) {
          callback({
            method: "turn/completed",
            params: {
              threadId,
              turn: {
                id: "bootstrap-turn",
                status: "completed"
              },
              turnId: "bootstrap-turn"
            }
          });
        }
      });
      return {
        id: "bootstrap-turn",
        status: "inProgress"
      };
    },
    subscribe(callback) {
      subscribers.push(callback);
      return () => null;
    }
  };
}

test("codex app-server bridge uses the current Vibe64 Codex execution settings", () => {
  assert.deepEqual(codexAppServerThreadSettings({
    cwd: "/repo/.vibe64/sessions/active/session/worktree",
    developerInstructions: "Vibe64 briefing"
  }), {
    approvalPolicy: "never",
    cwd: "/repo/.vibe64/sessions/active/session/worktree",
    developerInstructions: "Vibe64 briefing",
    model: "gpt-5.5",
    sandbox: "danger-full-access"
  });
  assert.deepEqual(codexAppServerTurnSettings({
    cwd: "/repo/.vibe64/sessions/active/session/worktree"
  }), {
    approvalPolicy: "never",
    cwd: "/repo/.vibe64/sessions/active/session/worktree",
    effort: "xhigh",
    model: "gpt-5.5",
    sandboxPolicy: {
      type: "dangerFullAccess"
    },
    summary: "concise"
  });
  assert.deepEqual(codexAppServerTurnSettings({
    agentSettings: {
      thinking: "high"
    },
    cwd: "/repo/.vibe64/sessions/active/session/worktree"
  }), {
    approvalPolicy: "never",
    cwd: "/repo/.vibe64/sessions/active/session/worktree",
    effort: "high",
    model: "gpt-5.5",
    sandboxPolicy: {
      type: "dangerFullAccess"
    },
    summary: "concise"
  });
});

test("codex app-server bridge sends the user prompt unchanged", () => {
  assert.equal(
    codexAppServerTurnPrompt({
      prompt: "Vibe64 interactive conversation turn:\nUser/request input:\n- conversationRequest: Hello"
    }),
    "Vibe64 interactive conversation turn:\nUser/request input:\n- conversationRequest: Hello"
  );
});

test("codex app-server bridge records host and container CLI resume commands for the same thread", () => {
  const metadata = codexAppServerIdentityMetadata({
    appServerRuntime: appServerRuntime(),
    threadId: "019e865d-8108-7740-912b-42ece83a5c73",
    workdir: "/repo/.vibe64/sessions/active/session/worktree"
  });

  assert.equal(metadata.agent_identity_conversation_id, "019e865d-8108-7740-912b-42ece83a5c73");
  assert.equal(metadata.codex_thread_id, "019e865d-8108-7740-912b-42ece83a5c73");
  assert.equal(
    metadata.codex_cli_resume_command,
    "codex --remote unix:///tmp/vibe64/agent-providers/codex-app-server/app-server.sock resume 019e865d-8108-7740-912b-42ece83a5c73"
  );
  assert.equal(
    metadata.codex_container_cli_resume_command,
    "codex --remote unix:///vibe64-codex-app-server/app-server.sock resume 019e865d-8108-7740-912b-42ece83a5c73"
  );
  assert.equal(metadata.codex_app_server_transport, "unix");
  assert.equal(metadata.codex_app_server_socket_path, "/tmp/vibe64/agent-providers/codex-app-server/app-server.sock");
});

test("codex app-server bridge starts a missing session thread and stores identity metadata", async () => {
  const runtime = fakeRuntime();
  const providerCalls = [];
  const provider = {
    ...bootstrapProviderParts(providerCalls),
    async ensureRuntime() {
      return appServerRuntime();
    },
    async startThread(params) {
      providerCalls.push({
        method: "startThread",
        params
      });
      return {
        id: "thread-started"
      };
    }
  };

  const result = await ensureCodexAppServerThreadForSession({
    developerInstructions: "Vibe64 briefing",
    provider,
    runtime,
    session: {
      metadata: {},
      sessionId: "session-1"
    },
    workdir: "/repo/worktree"
  });

  assert.equal(result.threadId, "thread-started");
  assert.equal(providerCalls.length, 2);
  assert.equal(providerCalls[0].method, "startThread");
  assert.equal(providerCalls[0].params.cwd, "/repo/worktree");
  assert.equal(providerCalls[1].method, "sendTurn");
  assert.equal(providerCalls[1].threadId, "thread-started");
  assert.equal(providerCalls[1].params.cwd, "/repo/worktree");
  assert.match(providerCalls[1].input, /VIBE64_SESSION_BOOTSTRAP/u);
  assert.equal(result.bootstrap.turn.id, "bootstrap-turn");
  assert.equal(metadataValue(runtime, "agent_identity_provider"), "codex");
  assert.equal(metadataValue(runtime, "codex_thread_id"), "thread-started");
  assert.equal(
    metadataValue(runtime, "codex_container_cli_resume_command"),
    "codex --remote unix:///vibe64-codex-app-server/app-server.sock resume thread-started"
  );
  assert.equal(metadataValue(runtime, "codex_app_server_transport"), "unix");
  assert.equal(
    metadataValue(runtime, "codex_app_server_container_socket_path"),
    "/vibe64-codex-app-server/app-server.sock"
  );
});

test("codex app-server bridge resumes an existing session thread", async () => {
  const runtime = fakeRuntime();
  const providerCalls = [];
  const provider = {
    ...bootstrapProviderParts(providerCalls),
    async ensureRuntime() {
      return appServerRuntime();
    },
    async resumeThread(threadId, params) {
      providerCalls.push({
        method: "resumeThread",
        params,
        threadId
      });
      return {
        id: threadId
      };
    }
  };

  const result = await ensureCodexAppServerThreadForSession({
    provider,
    runtime,
    session: {
      metadata: {
        agent_identity_conversation_id: "thread-existing",
        agent_identity_provider: "codex",
        agent_identity_status: "ready",
        agent_identity_workdir: "/repo/worktree",
        codex_app_server_provider: "codex_app_server"
      },
      sessionId: "session-1"
    },
    workdir: "/repo/worktree"
  });

  assert.equal(result.threadId, "thread-existing");
  assert.deepEqual(providerCalls, [
    {
      method: "resumeThread",
      params: {
        approvalPolicy: "never",
        cwd: "/repo/worktree",
        developerInstructions: null,
        model: "gpt-5.5",
        sandbox: "danger-full-access"
      },
      threadId: "thread-existing"
    }
  ]);
});

test("codex app-server bridge replaces stale missing-rollout session threads", async () => {
  const runtime = fakeRuntime();
  const providerCalls = [];
  const provider = {
    ...bootstrapProviderParts(providerCalls),
    async ensureRuntime() {
      return appServerRuntime();
    },
    async resumeThread(threadId, params) {
      providerCalls.push({
        method: "resumeThread",
        params,
        threadId
      });
      throw new Error(`no rollout found for thread id ${threadId}`);
    },
    async startThread(params) {
      providerCalls.push({
        method: "startThread",
        params
      });
      return {
        id: "thread-replacement"
      };
    }
  };

  const result = await ensureCodexAppServerThreadForSession({
    developerInstructions: "Vibe64 briefing",
    provider,
    runtime,
    session: {
      metadata: {
        agent_identity_conversation_id: "thread-stale",
        agent_identity_provider: "codex",
        agent_identity_status: "ready",
        agent_identity_workdir: "/repo/worktree",
        codex_app_server_provider: "codex_app_server"
      },
      sessionId: "session-1"
    },
    workdir: "/repo/worktree"
  });

  assert.equal(result.threadId, "thread-replacement");
  assert.deepEqual(providerCalls.map((call) => call.method), [
    "resumeThread",
    "startThread",
    "sendTurn"
  ]);
  assert.equal(providerCalls[0].threadId, "thread-stale");
  assert.equal(providerCalls[0].params.developerInstructions, "Vibe64 briefing");
  assert.equal(providerCalls[1].params.cwd, "/repo/worktree");
  assert.equal(providerCalls[2].threadId, "thread-replacement");
  assert.match(providerCalls[2].input, /VIBE64_SESSION_BOOTSTRAP/u);
  assert.equal(metadataValue(runtime, "codex_thread_id"), "thread-replacement");
  assert.equal(metadataValue(runtime, "agent_identity_conversation_id"), "thread-replacement");
  assert.equal(metadataValue(runtime, "codex_app_server_replaced_thread_id"), "thread-stale");
  assert.match(
    metadataValue(runtime, "codex_app_server_replaced_thread_error"),
    /no rollout found for thread id thread-stale/u
  );
});

test("codex app-server bridge does not replace transport resume failures", async () => {
  const runtime = fakeRuntime();
  const providerCalls = [];
  const provider = {
    ...bootstrapProviderParts(providerCalls),
    async ensureRuntime() {
      return appServerRuntime();
    },
    async resumeThread(threadId) {
      providerCalls.push({
        method: "resumeThread",
        threadId
      });
      throw new Error("failed to connect to remote app server");
    },
    async startThread() {
      providerCalls.push({
        method: "startThread"
      });
      return {
        id: "thread-replacement"
      };
    }
  };

  await assert.rejects(
    () => ensureCodexAppServerThreadForSession({
      provider,
      runtime,
      session: {
        metadata: {
          agent_identity_conversation_id: "thread-existing",
          agent_identity_provider: "codex",
          agent_identity_status: "ready",
          agent_identity_workdir: "/repo/worktree",
          codex_app_server_provider: "codex_app_server"
        },
        sessionId: "session-1"
      },
      workdir: "/repo/worktree"
    }),
    /failed to connect to remote app server/u
  );
  assert.deepEqual(providerCalls, [
    {
      method: "resumeThread",
      threadId: "thread-existing"
    }
  ]);
});

test("codex app-server bridge starts a new thread instead of resuming old terminal identity", async () => {
  const runtime = fakeRuntime();
  const providerCalls = [];
  const provider = {
    ...bootstrapProviderParts(providerCalls),
    async ensureRuntime() {
      return appServerRuntime();
    },
    async resumeThread(threadId) {
      providerCalls.push({
        method: "resumeThread",
        threadId
      });
      return {
        id: threadId
      };
    },
    async startThread(params) {
      providerCalls.push({
        method: "startThread",
        params
      });
      return {
        id: "app-server-thread"
      };
    }
  };

  const result = await ensureCodexAppServerThreadForSession({
    provider,
    runtime,
    session: {
      metadata: {
        agent_identity_conversation_id: "old-terminal-thread",
        agent_identity_provider: "codex",
        agent_identity_status: "ready",
        agent_identity_workdir: "/repo/worktree"
      },
      sessionId: "session-1"
    },
    workdir: "/repo/worktree"
  });

  assert.equal(result.threadId, "app-server-thread");
  assert.deepEqual(providerCalls.map((call) => call.method), ["startThread", "sendTurn"]);
  assert.equal(metadataValue(runtime, "codex_thread_id"), "app-server-thread");
  assert.equal(metadataValue(runtime, "codex_app_server_provider"), "codex_app_server");
});

test("codex app-server bridge sends turns with app-server text input only", async () => {
  const providerCalls = [];
  const provider = {
    async sendTurn(threadId, input, params) {
      providerCalls.push({
        input,
        params,
        threadId
      });
      return {
        id: "turn-1"
      };
    }
  };

  const result = await sendCodexAppServerPromptForSession({
    prompt: "Do the work.",
    provider,
    threadId: "thread-1",
    workdir: "/repo/worktree"
  });

  assert.equal(result.turn.id, "turn-1");
  assert.equal(result.input, "Do the work.");
  assert.equal(providerCalls[0].threadId, "thread-1");
  assert.deepEqual(providerCalls[0].params.sandboxPolicy, {
    type: "dangerFullAccess"
  });
});
