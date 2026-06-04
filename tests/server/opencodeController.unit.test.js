import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  Vibe64SessionRuntime
} from "@local/vibe64-runtime/server";
import {
  REMOTE_STUDIO_RUNTIME_ENV
} from "@local/vibe64-core/server/studioRuntimeLocation";
import {
  helperSocketHostPath
} from "@local/vibe64-runtime/server/currentStepInputHelperServer";
import {
  _testing as coreMaintenanceTesting
} from "@local/vibe64-runtime/server/workflowModules/coreMaintenance";
import {
  createOpenCodeController,
  normalizeProviderStatus,
  opencodeAuthTypes,
  opencodePromptModel,
  validOpenCodeHandoff
} from "../../packages/vibe64-terminals/src/server/opencodeServer.js";
import { withTemporaryRoot } from "./vibe64TestHelpers.js";

const maintenanceWorkflowDefinitionIds = coreMaintenanceTesting.workflowDefinitionIds;

function fakeSpawn() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.exitCode = null;
  child.kill = () => {
    child.exitCode = 0;
    child.emit("exit", 0);
  };
  return child;
}

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    headers: {
      "Content-Type": "application/json"
    },
    status: 200,
    ...init
  });
}

async function withRemoteStudioRuntime(value, operation) {
  const previousValue = process.env[REMOTE_STUDIO_RUNTIME_ENV];
  if (value == null) {
    delete process.env[REMOTE_STUDIO_RUNTIME_ENV];
  } else {
    process.env[REMOTE_STUDIO_RUNTIME_ENV] = String(value);
  }
  try {
    return await operation();
  } finally {
    if (previousValue == null) {
      delete process.env[REMOTE_STUDIO_RUNTIME_ENV];
    } else {
      process.env[REMOTE_STUDIO_RUNTIME_ENV] = previousValue;
    }
  }
}

test("OpenCode provider status normalizes connected providers and models", () => {
  const providers = normalizeProviderStatus({
    authMethods: {
      openai: [
        {
          type: "api"
        }
      ]
    },
    authCredentialTypes: {
      openai: "oauth"
    },
    providerStatus: {
      all: [
        {
          id: "openai",
          name: "OpenAI",
          models: {
            "gpt-5": {
              name: "GPT-5"
            }
          }
        }
      ],
      connected: ["openai"],
      default: {
        openai: "gpt-5"
      }
    }
  });

  assert.deepEqual(providers, [
    {
      authMethods: [
        {
          type: "api"
        }
      ],
      authType: "oauth",
      connected: true,
      defaultModelId: "gpt-5",
      id: "openai",
      label: "OpenAI",
      modelCount: 1,
      models: [
        {
          id: "gpt-5",
          label: "GPT-5"
        }
      ]
    }
  ]);
});

test("OpenCode auth metadata exposes provider credential types without secrets", () => {
  assert.deepEqual(opencodeAuthTypes({
    openai: {
      access: "secret",
      type: "oauth"
    },
    openrouter: {
      key: "secret",
      type: "api"
    },
    unknown: {
      type: "custom"
    }
  }), {
    openai: "oauth",
    openrouter: "api"
  });
});

test("OpenCode prompt helpers validate runtime and model selection", () => {
  assert.equal(validOpenCodeHandoff({
    kind: "agent_prompt_handoff",
    prompt: "Do the work.",
    runtimeId: "opencode"
  }), true);
  assert.equal(validOpenCodeHandoff({
    kind: "agent_prompt_handoff",
    prompt: "Do the work.",
    runtimeId: "codex"
  }), false);
  assert.deepEqual(opencodePromptModel({
    modelId: "gpt-5",
    providerId: "openai"
  }), {
    modelID: "gpt-5",
    providerID: "openai"
  });
});

test("OpenCode provider OAuth is disabled for remote Studio runtimes", async () => {
  await withRemoteStudioRuntime("1", async () => {
    let requestCount = 0;
    const controller = createOpenCodeController({
      async fetchImplementation() {
        requestCount += 1;
        return jsonResponse({});
      },
      projectService: {
        currentTargetRoot() {
          return "/workspace/project";
        }
      },
      spawnProcess: fakeSpawn
    });

    const result = await controller.startProviderOAuth("openai", {
      methodIndex: 0
    });

    assert.equal(result.ok, false);
    assert.equal(result.code, "opencode_oauth_remote_disabled");
    assert.match(result.error, /--remote/u);
    assert.equal(requestCount, 0);
  });
});

test("OpenCode provider OAuth starts through the local OpenCode server", async () => {
  await withRemoteStudioRuntime(null, async () => {
    await withTemporaryRoot(async (targetRoot) => {
      const requests = [];
      const controller = createOpenCodeController({
        async fetchImplementation(url, options = {}) {
          const parsedUrl = new URL(url);
          const body = options.body ? JSON.parse(options.body) : null;
          requests.push({
            body,
            method: options.method || "GET",
            pathname: parsedUrl.pathname
          });
          if (parsedUrl.pathname === "/global/health") {
            return jsonResponse({
              healthy: true,
              version: "1.15.13"
            });
          }
          if (parsedUrl.pathname === "/provider/openai/oauth/authorize") {
            return jsonResponse({
              instructions: ["Open the URL to continue."],
              method: "oauth",
              url: "https://auth.example/openai"
            });
          }
          return jsonResponse({
            error: "unexpected"
          }, {
            status: 404
          });
        },
        projectService: {
          currentTargetRoot() {
            return targetRoot;
          }
        },
        spawnProcess: fakeSpawn
      });

      const result = await controller.startProviderOAuth("openai", {
        methodIndex: 1
      });

      assert.equal(result.ok, true);
      assert.equal(result.providerId, "openai");
      assert.equal(result.methodIndex, 1);
      assert.deepEqual(result.authorization, {
        instructions: ["Open the URL to continue."],
        method: "oauth",
        url: "https://auth.example/openai"
      });
      assert.deepEqual(
        requests.filter((request) => request.pathname === "/provider/openai/oauth/authorize"),
        [
          {
            body: {
              method: 1
            },
            method: "POST",
            pathname: "/provider/openai/oauth/authorize"
          }
        ]
      );
      controller.closeAll();
    });
  });
});

test("OpenCode controller creates a server session and submits an async prompt", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new Vibe64SessionRuntime({
      targetRoot
    });
    const sessionRoot = path.join(targetRoot, ".vibe64", "sessions", "active", "opencode_delivery");
    const worktree = path.join(sessionRoot, "worktree");
    await runtime.createSession({
      initialStep: "plan_and_execute",
      metadata: {
        agent_runtime_id: "opencode",
        worktree_path: worktree
      },
      sessionId: "opencode_delivery"
    });
    await mkdir(worktree, {
      recursive: true
    });

    const requests = [];
    const spawned = [];
    let startedTerminal = null;
    let promptAccepted = false;
    const recordingSpawn = (command, args, options) => {
      spawned.push({
        args,
        command,
        env: options?.env || {}
      });
      return fakeSpawn();
    };
    const controller = createOpenCodeController({
      async fetchImplementation(url, options = {}) {
        const parsedUrl = new URL(url);
        const body = options.body ? JSON.parse(options.body) : null;
        requests.push({
          body,
          method: options.method || "GET",
          pathname: parsedUrl.pathname
        });
        if (parsedUrl.pathname === "/global/health") {
          return jsonResponse({
            healthy: true,
            version: "1.15.13"
          });
        }
        if (parsedUrl.pathname === "/session") {
          return jsonResponse({
            id: "opencode-session-1"
          });
        }
        if (parsedUrl.pathname === "/session/opencode-session-1/prompt_async") {
          promptAccepted = true;
          return new Response(null, {
            status: 204
          });
        }
        if (parsedUrl.pathname === "/session/opencode-session-1/message") {
          return jsonResponse(promptAccepted
            ? [
                {
                  info: {
                    id: "message-1"
                  },
                  parts: []
                }
              ]
            : []);
        }
        return jsonResponse({
          error: "unexpected"
        }, {
          status: 404
        });
      },
      projectService: {
        currentTargetRoot() {
          return targetRoot;
        },
        async createRuntime() {
          return runtime;
        }
      },
      spawnProcess: recordingSpawn,
      startTerminalSessionImplementation(spec) {
        startedTerminal = spec;
        return {
          commandPreview: spec.commandPreview,
          id: "terminal-1",
          ok: true,
          status: "running"
        };
      }
    });

    const result = await controller.injectPrompt("opencode_delivery", {
      kind: "agent_prompt_handoff",
      modelId: "gpt-5",
      prompt: "Use OpenCode for this step.",
      promptId: "make_plan",
      providerId: "openai",
      runtimeId: "opencode"
    });

    assert.equal(result.ok, true);
    assert.equal(result.opencodeSessionId, "opencode-session-1");
    assert.deepEqual(
      requests.filter((request) => request.pathname === "/session/opencode-session-1/prompt_async").map((request) => request.body),
      [
        {
          model: {
            modelID: "gpt-5",
            providerID: "openai"
          },
          parts: [
            {
              text: "Use OpenCode for this step.",
              type: "text"
            }
          ]
        }
      ]
    );

    const updated = await runtime.getSession("opencode_delivery");
    assert.equal(updated.metadata.agent_identity_provider, "opencode");
    assert.equal(updated.metadata.agent_identity_conversation_id, "opencode-session-1");
    assert.equal(updated.metadata.opencode_session_id, "opencode-session-1");
    assert.equal(spawned[0].env.VIBE64_CURRENT_STEP_INPUT_SOCKET, helperSocketHostPath(targetRoot));
    assert.equal(spawned[0].env.VIBE64_CURRENT_STEP_INPUT_SOCKET.startsWith("/vibe64-helper/"), false);

    requests.length = 0;
    const terminal = await controller.startTerminal("opencode_delivery");
    assert.equal(terminal.ok, true);
    assert.equal(terminal.id, "terminal-1");
    assert.deepEqual(
      requests.filter((request) => request.pathname === "/session").map((request) => request.method),
      []
    );
    assert.deepEqual(startedTerminal.args.slice(4), [
      "--session",
      "opencode-session-1",
      "--replay",
      "--replay-limit",
      "30"
    ]);
    assert.equal(startedTerminal.metadata.agentConversationId, "opencode-session-1");
    controller.closeAll();
  });
});

test("OpenCode terminal resumes the Vibe64 session conversation id", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new Vibe64SessionRuntime({
      targetRoot
    });
    const sessionRoot = path.join(targetRoot, ".vibe64", "sessions", "active", "opencode_terminal_resume");
    const worktree = path.join(sessionRoot, "worktree");
    await runtime.createSession({
      initialStep: "maintenance_conversation",
      metadata: {
        agent_runtime_id: "opencode",
        worktree_path: worktree
      },
      sessionId: "opencode_terminal_resume",
      workflowDefinition: maintenanceWorkflowDefinitionIds.NON_COMMIT_MAINTENANCE
    });
    await mkdir(worktree, {
      recursive: true
    });

    const requests = [];
    const spawned = [];
    let startedTerminal = null;
    const recordingSpawn = (command, args, options) => {
      spawned.push({
        args,
        command,
        env: options?.env || {}
      });
      return fakeSpawn();
    };
    const controller = createOpenCodeController({
      async fetchImplementation(url, options = {}) {
        const parsedUrl = new URL(url);
        const body = options.body ? JSON.parse(options.body) : null;
        requests.push({
          body,
          method: options.method || "GET",
          pathname: parsedUrl.pathname
        });
        if (parsedUrl.pathname === "/global/health") {
          return jsonResponse({
            healthy: true,
            version: "1.15.13"
          });
        }
        if (parsedUrl.pathname === "/session") {
          return jsonResponse({
            id: "opencode-session-1"
          });
        }
        return jsonResponse({
          error: "unexpected"
        }, {
          status: 404
        });
      },
      projectService: {
        currentTargetRoot() {
          return targetRoot;
        },
        async createRuntime() {
          return runtime;
        }
      },
      spawnProcess: recordingSpawn,
      startTerminalSessionImplementation(spec) {
        startedTerminal = spec;
        return {
          commandPreview: spec.commandPreview,
          id: "terminal-1",
          ok: true,
          status: "running"
        };
      }
    });

    const result = await controller.startTerminal("opencode_terminal_resume");

    assert.equal(result.ok, true);
    assert.equal(result.id, "terminal-1");
    assert.deepEqual(
      requests.filter((request) => request.pathname === "/session").map((request) => request.method),
      ["POST"]
    );
    assert.equal(startedTerminal.command, "opencode");
    assert.deepEqual(startedTerminal.args.slice(0, 3), [
      "run",
      "--interactive",
      "--attach"
    ]);
    assert.match(startedTerminal.args[3], /^http:\/\/127\.0\.0\.1:\d+$/u);
    assert.deepEqual(startedTerminal.args.slice(4), [
      "--session",
      "opencode-session-1",
      "--replay",
      "--replay-limit",
      "30"
    ]);
    assert.match(
      startedTerminal.commandPreview,
      /^opencode run --interactive --attach http:\/\/127\.0\.0\.1:\d+ --session opencode-session-1 --replay --replay-limit 30$/u
    );
    assert.equal(startedTerminal.cwd, worktree);
    assert.equal(startedTerminal.env.VIBE64_CURRENT_STEP_INPUT_SOCKET, helperSocketHostPath(targetRoot));
    assert.equal(startedTerminal.env.OPENCODE_SERVER_USERNAME, "opencode");
    assert.equal(typeof startedTerminal.env.OPENCODE_SERVER_PASSWORD, "string");
    assert.equal(startedTerminal.metadata.agentConversationId, "opencode-session-1");
    assert.equal(startedTerminal.metadata.sessionId, "opencode_terminal_resume");
    assert.equal(startedTerminal.metadata.workdir, worktree);
    assert.equal(spawned[0].command, "opencode");
    assert.deepEqual(spawned[0].args.slice(0, 3), [
      "serve",
      "--hostname",
      "127.0.0.1"
    ]);

    const updated = await runtime.getSession("opencode_terminal_resume");
    assert.equal(updated.metadata.agent_identity_provider, "opencode");
    assert.equal(updated.metadata.agent_identity_conversation_id, "opencode-session-1");
    assert.equal(updated.metadata.opencode_session_id, "opencode-session-1");
    controller.closeAll();
  });
});

test("OpenCode controller rejects accepted prompts that show no activity", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new Vibe64SessionRuntime({
      targetRoot
    });
    const sessionRoot = path.join(targetRoot, ".vibe64", "sessions", "active", "opencode_silent_delivery");
    const worktree = path.join(sessionRoot, "worktree");
    await runtime.createSession({
      initialStep: "maintenance_conversation",
      metadata: {
        agent_runtime_id: "opencode",
        worktree_path: worktree
      },
      sessionId: "opencode_silent_delivery",
      workflowDefinition: maintenanceWorkflowDefinitionIds.NON_COMMIT_MAINTENANCE
    });
    await mkdir(worktree, {
      recursive: true
    });
    await runtime.runAction("opencode_silent_delivery", "agent_conversation", {
      conversationRequest: "Explain this codebase."
    });

    const controller = createOpenCodeController({
      activityTimeoutMs: 20,
      async fetchImplementation(url) {
        const parsedUrl = new URL(url);
        if (parsedUrl.pathname === "/global/health") {
          return jsonResponse({
            healthy: true,
            version: "1.15.13"
          });
        }
        if (parsedUrl.pathname === "/session") {
          return jsonResponse({
            id: "opencode-session-1"
          });
        }
        if (parsedUrl.pathname === "/session/opencode-session-1/prompt_async") {
          return new Response(null, {
            status: 204
          });
        }
        if (parsedUrl.pathname === "/session/opencode-session-1/message") {
          return jsonResponse([]);
        }
        return jsonResponse({
          error: "unexpected"
        }, {
          status: 404
        });
      },
      projectService: {
        currentTargetRoot() {
          return targetRoot;
        },
        async createRuntime() {
          return runtime;
        }
      },
      spawnProcess: fakeSpawn
    });

    const result = await controller.injectPrompt("opencode_silent_delivery", {
      kind: "agent_prompt_handoff",
      prompt: "Use OpenCode for this step.",
      promptId: "make_plan",
      runtimeId: "opencode"
    });

    assert.equal(result.ok, false);
    assert.match(result.error, /no session activity/u);
    assert.equal(result.opencodeSessionId, "opencode-session-1");
    controller.closeAll();
  });
});
