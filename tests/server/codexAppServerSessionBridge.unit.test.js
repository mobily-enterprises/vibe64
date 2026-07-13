import assert from "node:assert/strict";
import test from "node:test";

import {
  CODEX_APP_SERVER_WORKFLOW_RESULT_TOOL_NAME,
  CODEX_APP_SERVER_WORKFLOW_RESULT_TRANSPORT,
  codexAppServerIdentityMetadata,
  codexAppServerPromptWithContextRefresh,
  codexAppServerThreadStartSettings,
  codexAppServerThreadSettings,
  codexAppServerTurnPrompt,
  codexAppServerTurnSettings,
  ensureCodexAppServerThreadForSession,
  sendCodexAppServerPromptForSession
} from "@local/vibe64-runtime/server/codexAppServerSessionBridge";
import {
  VIBE64_CODEX_DEFAULT_MODEL,
  VIBE64_CODEX_SPARK_MODEL
} from "@local/vibe64-runtime/shared";
import {
  STUDIO_MANAGED_CODEX_COMMAND,
  STUDIO_MANAGED_CODEX_NO_UPDATE_CONFIG
} from "@local/studio-terminal-core/server/studioRuntimeIdentity";
function fakeRuntime({
  conversationLog = []
} = {}) {
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
      },
      async readConversationLog() {
        return conversationLog;
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
    endpoint: "unix:///tmp/vibe64/agent-providers/codex-app-server/app-server.sock",
    runtimeDir: "/tmp/vibe64/agent-providers/codex-app-server",
    socketPath: "/tmp/vibe64/agent-providers/codex-app-server/app-server.sock",
    transport: "unix"
  };
}

function contextTurnProviderParts(providerCalls) {
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
                id: "context-turn",
                status: "completed"
              },
              turnId: "context-turn"
            }
          });
        }
      });
      return {
        id: "context-turn",
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
    cwd: "/runtime/projects/repo-test/sessions/active/session/source",
    developerInstructions: "Vibe64 briefing"
  }), {
    approvalPolicy: "never",
    cwd: "/runtime/projects/repo-test/sessions/active/session/source",
    developerInstructions: "Vibe64 briefing",
    model: VIBE64_CODEX_DEFAULT_MODEL,
    sandbox: "danger-full-access"
  });
  assert.deepEqual(codexAppServerTurnSettings({
    cwd: "/runtime/projects/repo-test/sessions/active/session/source"
  }), {
    approvalPolicy: "never",
    cwd: "/runtime/projects/repo-test/sessions/active/session/source",
    effort: "xhigh",
    model: VIBE64_CODEX_DEFAULT_MODEL,
    sandboxPolicy: {
      type: "dangerFullAccess"
    },
    summary: "concise"
  });
  assert.deepEqual(codexAppServerTurnSettings({
    agentSettings: {
      thinking: "high"
    },
    cwd: "/runtime/projects/repo-test/sessions/active/session/source"
  }), {
    approvalPolicy: "never",
    cwd: "/runtime/projects/repo-test/sessions/active/session/source",
    effort: "high",
    model: VIBE64_CODEX_DEFAULT_MODEL,
    sandboxPolicy: {
      type: "dangerFullAccess"
    },
    summary: "concise"
  });
  assert.deepEqual(codexAppServerTurnSettings({
    agentSettings: {
      model: VIBE64_CODEX_SPARK_MODEL,
      thinking: "high"
    },
    cwd: "/runtime/projects/repo-test/sessions/active/session/source"
  }), {
    approvalPolicy: "never",
    cwd: "/runtime/projects/repo-test/sessions/active/session/source",
    effort: "high",
    model: VIBE64_CODEX_SPARK_MODEL,
    sandboxPolicy: {
      type: "dangerFullAccess"
    }
  });
});

test("codex app-server bridge sends Spark source explanations at medium effort", () => {
  assert.deepEqual(codexAppServerTurnSettings({
    agentSettings: {
      model: VIBE64_CODEX_SPARK_MODEL,
      thinking: "medium"
    },
    cwd: "/runtime/projects/repo-test/sessions/active/session/source"
  }), {
    approvalPolicy: "never",
    cwd: "/runtime/projects/repo-test/sessions/active/session/source",
    effort: "medium",
    model: VIBE64_CODEX_SPARK_MODEL,
    sandboxPolicy: {
      type: "dangerFullAccess"
    }
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

test("codex app-server bridge keeps the user input before a hidden context refresh", () => {
  const prompt = codexAppServerPromptWithContextRefresh({
    contextRefresh: "Vibe64 session briefing\nJSKIT: use generators.",
    prompt: "Vibe64 interactive conversation turn:\nUser/request input:\n- conversationRequest: Continue.",
    promptLabel: "Real Vibe64 routed turn"
  });

  assert.match(prompt, /^Vibe64 interactive conversation turn:/u);
  assert.match(prompt, /This section is developer\/session context, not a user request\./u);
  assert.match(prompt, /--- BEGIN FRESH VIBE64 SESSION BRIEFING ---\nVibe64 session briefing\nJSKIT: use generators\./u);
  assert.match(prompt, /Real Vibe64 routed turn context refresh:\nVIBE64_CONTEXT_REFRESH:/u);
  assert.match(prompt, /conversationRequest: Continue\./u);
  assert.ok(prompt.indexOf("conversationRequest: Continue.") < prompt.indexOf("VIBE64_CONTEXT_REFRESH:"));
});

test("codex app-server bridge records the host CLI resume command for the same thread", () => {
  const metadata = codexAppServerIdentityMetadata({
    appServerRuntime: appServerRuntime(),
    threadId: "019e865d-8108-7740-912b-42ece83a5c73",
    workdir: "/runtime/projects/repo-test/sessions/active/session/source"
  });

  assert.equal(metadata.agent_identity_conversation_id, "019e865d-8108-7740-912b-42ece83a5c73");
  assert.equal(metadata.agent_workflow_result_transport, CODEX_APP_SERVER_WORKFLOW_RESULT_TRANSPORT);
  assert.equal(
    metadata.agent_resume_command,
    `${STUDIO_MANAGED_CODEX_COMMAND} -c ${STUDIO_MANAGED_CODEX_NO_UPDATE_CONFIG} --remote unix:///tmp/vibe64/agent-providers/codex-app-server/app-server.sock resume 019e865d-8108-7740-912b-42ece83a5c73`
  );
  assert.equal(metadata.agent_transport_kind, "unix");
  assert.equal(metadata.agent_transport_socket_path, "/tmp/vibe64/agent-providers/codex-app-server/app-server.sock");
});

test("codex app-server bridge starts a missing session thread and stores identity metadata", async () => {
  const runtime = fakeRuntime();
  const providerCalls = [];
  const provider = {
    ...contextTurnProviderParts(providerCalls),
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
  assert.equal(providerCalls.length, 1);
  assert.equal(providerCalls[0].method, "startThread");
  assert.equal(providerCalls[0].params.cwd, "/repo/worktree");
  assert.equal(providerCalls[0].params.dynamicTools[0].name, CODEX_APP_SERVER_WORKFLOW_RESULT_TOOL_NAME);
  assert.equal(metadataValue(runtime, "agent_identity_provider"), "codex");
  assert.equal(metadataValue(runtime, "agent_identity_conversation_id"), "thread-started");
  assert.equal(metadataValue(runtime, "agent_transport_kind"), "unix");
  assert.equal(metadataValue(runtime, "agent_transport_socket_path"), "/tmp/vibe64/agent-providers/codex-app-server/app-server.sock");
  assert.equal(metadataValue(runtime, "agent_workflow_result_transport"), CODEX_APP_SERVER_WORKFLOW_RESULT_TRANSPORT);
});

test("codex app-server bridge resumes an existing session thread", async () => {
  const runtime = fakeRuntime();
  const providerCalls = [];
  const provider = {
    ...contextTurnProviderParts(providerCalls),
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
        agent_workflow_result_transport: CODEX_APP_SERVER_WORKFLOW_RESULT_TRANSPORT,
        agent_transport_id: "codex_app_server"
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
        model: VIBE64_CODEX_DEFAULT_MODEL,
        sandbox: "danger-full-access"
      },
      threadId: "thread-existing"
    }
  ]);
});

test("codex app-server bridge replaces unreadable session threads after an invalid resume request", async () => {
  const runtime = fakeRuntime({
    conversationLog: [
      {
        assistant: {
          at: "2026-06-15T01:02:05.000Z",
          text: "Use the archive branch."
        },
        thinking: [
          {
            at: "2026-06-15T01:02:04.000Z",
            text: "Checked the issue draft."
          }
        ],
        user: {
          at: "2026-06-15T01:02:03.000Z",
          text: "Can we talk about archive scope?"
        }
      }
    ]
  });
  const providerCalls = [];
  const provider = {
    ...contextTurnProviderParts(providerCalls),
    async ensureRuntime() {
      return appServerRuntime();
    },
    async resumeThread(threadId, params) {
      providerCalls.push({
        method: "resumeThread",
        params,
        threadId
      });
      throw Object.assign(new Error("invalid request"), {
        code: -32600,
        method: "thread/resume"
      });
    },
    async readThread(threadId) {
      providerCalls.push({
        method: "readThread",
        threadId
      });
      throw Object.assign(new Error("invalid request"), {
        code: -32600,
        method: "thread/read"
      });
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
        agent_workflow_result_transport: CODEX_APP_SERVER_WORKFLOW_RESULT_TRANSPORT,
        agent_transport_id: "codex_app_server"
      },
      sessionId: "session-1"
    },
    workdir: "/repo/worktree"
  });

  assert.equal(result.threadId, "thread-replacement");
  assert.equal(result.replacedThreadId, "thread-stale");
  assert.equal(result.replacedThreadError?.code, -32600);
  assert.deepEqual(providerCalls.map((call) => call.method), [
    "resumeThread",
    "readThread",
    "startThread",
    "sendTurn"
  ]);
  assert.equal(providerCalls[0].threadId, "thread-stale");
  assert.equal(providerCalls[0].params.developerInstructions, "Vibe64 briefing");
  assert.equal(providerCalls[2].params.cwd, "/repo/worktree");
  assert.equal(providerCalls[3].threadId, "thread-replacement");
  assert.match(providerCalls[3].input, /VIBE64_CONTEXT_RECOVERY/u);
  assert.match(providerCalls[3].input, /Previous provider thread:\nthread-stale/u);
  assert.match(providerCalls[3].input, /Fresh provider thread:\nthread-replacement/u);
  assert.match(providerCalls[3].input, /Can we talk about archive scope\?/u);
  assert.match(providerCalls[3].input, /Checked the issue draft/u);
  assert.match(providerCalls[3].input, /Use the archive branch/u);
  assert.equal(metadataValue(runtime, "agent_identity_conversation_id"), "thread-replacement");
  assert.equal(metadataValue(runtime, "codex_app_server_replaced_thread_id"), "thread-stale");
  assert.equal(metadataValue(runtime, "codex_app_server_replaced_thread_error"), "invalid request");
});

test("codex app-server bridge preserves a readable thread after an invalid resume request", async () => {
  const runtime = fakeRuntime();
  const providerCalls = [];
  const provider = {
    ...contextTurnProviderParts(providerCalls),
    async ensureRuntime() {
      return appServerRuntime();
    },
    async resumeThread(threadId) {
      providerCalls.push({
        method: "resumeThread",
        threadId
      });
      throw Object.assign(new Error("invalid request"), {
        code: -32600,
        method: "thread/resume"
      });
    },
    async readThread(threadId) {
      providerCalls.push({
        method: "readThread",
        threadId
      });
      return {
        id: threadId,
        raw: {
          id: threadId,
          turns: []
        }
      };
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
          agent_identity_conversation_id: "thread-readable",
          agent_identity_provider: "codex",
          agent_identity_status: "ready",
          agent_identity_workdir: "/repo/worktree",
          agent_workflow_result_transport: CODEX_APP_SERVER_WORKFLOW_RESULT_TRANSPORT,
          agent_transport_id: "codex_app_server"
        },
        sessionId: "session-1"
      },
      workdir: "/repo/worktree"
    }),
    (error) => error?.code === -32600 && error?.method === "thread/resume"
  );
  assert.deepEqual(providerCalls, [
    {
      method: "resumeThread",
      threadId: "thread-readable"
    },
    {
      method: "readThread",
      threadId: "thread-readable"
    }
  ]);
});

test("codex app-server bridge does not replace transport resume failures", async () => {
  const runtime = fakeRuntime();
  const providerCalls = [];
  const provider = {
    ...contextTurnProviderParts(providerCalls),
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
          agent_workflow_result_transport: CODEX_APP_SERVER_WORKFLOW_RESULT_TRANSPORT,
          agent_transport_id: "codex_app_server"
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
    ...contextTurnProviderParts(providerCalls),
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
  assert.deepEqual(providerCalls.map((call) => call.method), ["startThread"]);
  assert.equal(metadataValue(runtime, "agent_identity_conversation_id"), "app-server-thread");
  assert.equal(metadataValue(runtime, "agent_transport_id"), "codex_app_server");
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
  assert.equal(providerCalls[0].params.outputSchema, undefined);
});

test("codex app-server bridge advertises workflow results as a thread tool, not a turn output schema", () => {
  const settings = codexAppServerThreadStartSettings({
    cwd: "/repo/worktree"
  });
  const tool = settings.dynamicTools[0];

  assert.equal(tool.name, CODEX_APP_SERVER_WORKFLOW_RESULT_TOOL_NAME);
  assert.equal(tool.type, "function");
  assert.deepEqual(tool.inputSchema.properties.kind.enum, ["ready", "waiting_for_input"]);
  assert.deepEqual(tool.inputSchema.required, ["kind", "stepId", "stepStatus", "fields", "inputFields", "message"]);
  assert.match(tool.description, /never print the arguments as JSON/u);
});

test("codex app-server bridge sends context refresh inside the next turn input", async () => {
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
    contextRefresh: "Vibe64 session briefing\nJSKIT: use generators.",
    prompt: "Do the work.",
    provider,
    threadId: "thread-1",
    workdir: "/repo/worktree"
  });

  assert.equal(result.turn.id, "turn-1");
  assert.match(result.input, /^Do the work\./u);
  assert.match(result.input, /JSKIT: use generators\./u);
  assert.match(result.input, /Real Vibe64 routed turn context refresh:/u);
  assert.ok(result.input.indexOf("Do the work.") < result.input.indexOf("VIBE64_CONTEXT_REFRESH:"));
  assert.equal(providerCalls[0].input, result.input);
});
