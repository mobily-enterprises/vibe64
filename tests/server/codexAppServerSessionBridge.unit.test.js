import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { MINIMUM_CODEX_VERSION } from "@local/vibe64-runtime/server/minimumCodexVersion";
import {
  assertCodexAppServerEconomyCompatibility,
  assertCodexAppServerEconomyOutputWithinLimit,
  codexAppServerEconomyThreadSettings,
  codexAppServerEconomyTurnSettings,
  codexAppServerIdentityMetadata,
  codexAppServerProjectHookTrustConfig,
  codexAppServerThreadStartSettings,
  codexAppServerThreadSettings,
  codexAppServerTurnSettings,
  ensureCodexAppServerThreadForSession,
  prepareCodexAppServerEconomyThreadStartSettings,
  resumeCodexAppServerEconomyThread,
  resumeExactCodexAppServerThreadForSession,
  sendCodexAppServerEconomyTurn,
  sendCodexAppServerPromptForSession,
  startCodexAppServerEconomyThread,
  startFreshCodexAppServerThreadForSession
} from "@local/vibe64-runtime/server/codexAppServerSessionBridge";
import {
  VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES,
  VIBE64_AGENT_EXECUTION_PROFILE_IDS,
  VIBE64_AGENT_EXECUTION_WORKLOAD_IDS,
  VIBE64_CODEX_DEFAULT_MODEL,
  VIBE64_CODEX_SPARK_MODEL,
  defineVibe64AgentExecutionProfileResolution
} from "@local/vibe64-runtime/shared";
import {
  createVibe64SessionStore
} from "@local/vibe64-runtime/server/sessionStore";
import {
  STUDIO_MANAGED_CODEX_COMMAND,
  STUDIO_MANAGED_CODEX_NO_UPDATE_CONFIG
} from "@local/studio-terminal-core/server/studioRuntimeIdentity";
function fakeRuntime({
  conversationLog = []
} = {}) {
  const writes = [];
  const store = {
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
    };
  store.mutateSessionForRenewal = store.mutateSession;
  store.writeMetadataValueForRenewal = store.writeMetadataValue;
  return {
    store,
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

function renewalThreadInventory(threadIds = []) {
  return {
    async listAppServerThreadsForCwd({ cwd }) {
      return {
        cwd,
        threadIds: [...threadIds]
      };
    }
  };
}

function renewalThreadClaim({
  operationId = "renewal:one",
  threadId = "new-successor-thread",
  workdir = "/repo/worktree"
} = {}) {
  return JSON.stringify({
    operationId,
    schemaVersion: "vibe64.codex-renewal-thread-claim.v1",
    threadId,
    workdir
  });
}

function sourceExplanationEconomyProfile(overrides = {}) {
  return defineVibe64AgentExecutionProfileResolution({
    limits: {
      maxInputCharacters: 100_000,
      maxOutputCharacters: 16_000,
      timeoutMs: 180_000
    },
    model: "gpt-5.6-luna",
    policy: {
      environmentAccess: false,
      networkAccess: false,
      repositoryWrite: false,
      tools: "none"
    },
    profileId: VIBE64_AGENT_EXECUTION_PROFILE_IDS.ECONOMY,
    providerId: "codex",
    request: {
      allowProviderModelFallback: false,
      reasoning: true,
      summary: false
    },
    revision: "codex-economy-luna-low-v1",
    thinking: "low",
    workloadId: VIBE64_AGENT_EXECUTION_WORKLOAD_IDS.SOURCE_EXPLANATION,
    ...overrides
  });
}

function sourceExplanationOutputSchema(maxLength = 2_000) {
  return {
    additionalProperties: false,
    properties: {
      answer: {
        maxLength,
        minLength: 1,
        type: "string"
      }
    },
    required: ["answer"],
    type: "object"
  };
}

const ECONOMY_EXECUTION_CWD = "/runtime/vibe64/codex-economy/workspace";
const ECONOMY_ACCOUNT_IDENTITY_SIGNATURE = `sha256:${"a".repeat(64)}`;

function economyExecutionProviderParts() {
  return {
    async currentEconomyExecutionContext() {
      return {
        accountIdentitySignature: ECONOMY_ACCOUNT_IDENTITY_SIGNATURE,
        cwd: ECONOMY_EXECUTION_CWD,
        executionMode: "economy"
      };
    }
  };
}

function economyInventoryProvider({
  generation = 1,
  hooks = [],
  mcpServers = {},
  records = null,
  userAgent = `vibe64/${MINIMUM_CODEX_VERSION} (unit test)`
} = {}) {
  const calls = [];
  return {
    ...economyExecutionProviderParts(),
    calls,
    currentConnectionGeneration() {
      return generation;
    },
    currentServerInfo() {
      return { userAgent };
    },
    async listHooks(cwds) {
      calls.push(["listHooks", cwds]);
      return {
        data: records || [{
          cwd: cwds[0],
          errors: [],
          hooks,
          warnings: []
        }]
      };
    },
    async readConfig(params) {
      calls.push(["readConfig", params]);
      return {
        config: {
          mcp_servers: mcpServers
        }
      };
    }
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
    config: { model_reasoning_effort: "xhigh", model_reasoning_summary: "concise" },
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
      networkAccess: "enabled",
      type: "externalSandbox"
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
      networkAccess: "enabled",
      type: "externalSandbox"
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
      networkAccess: "enabled",
      type: "externalSandbox"
    }
  });
});

test("Codex thread and turn requests preserve Astra and its advertised ultra effort", () => {
  const agentSettings = { model: "gpt-6-astra", thinking: "ultra", providerId: "codex" };
  const thread = codexAppServerThreadSettings({ agentSettings, cwd: "/workspace" });
  assert.equal(thread.model, "gpt-6-astra");
  assert.deepEqual(thread.config, {
    model_reasoning_effort: "ultra", model_reasoning_summary: "concise"
  });
  const turn = codexAppServerTurnSettings({ agentSettings, cwd: "/workspace" });
  assert.equal(turn.model, "gpt-6-astra");
  assert.equal(turn.effort, "ultra");
});

test("Codex thread summary defaults respect model support and explicit isolation settings", () => {
  const spark = codexAppServerThreadSettings({
    agentSettings: { model: VIBE64_CODEX_SPARK_MODEL, thinking: "high" }, cwd: "/workspace"
  });
  assert.equal(spark.config.model_reasoning_effort, "high");
  assert.equal(Object.hasOwn(spark.config, "model_reasoning_summary"), false);
  const isolated = codexAppServerThreadSettings({
    config: { model_reasoning_summary: "none", model_reasoning_effort: "low" }, cwd: "/workspace"
  });
  assert.deepEqual(isolated.config, { model_reasoning_summary: "none", model_reasoning_effort: "low" });
});

test("Codex economy settings are Luna-low, bounded, tool-free, and never fall back", async () => {
  const provider = economyInventoryProvider({
    hooks: [{
      currentHash: "sha256:malicious-hook",
      enabled: true,
      handlerType: "command",
      isManaged: false,
      key: "/repo/worktree/.codex/hooks.json:stop:0:0",
      sourcePath: "/repo/worktree/.codex/hooks.json"
    }, {
      currentHash: "sha256:disabled-managed-hook",
      enabled: false,
      handlerType: "command",
      isManaged: true,
      key: "managed:disabled:0",
      sourcePath: "/etc/codex/hooks.json"
    }],
    mcpServers: {
      "danger.server": {
        command: "write-anywhere"
      },
      "quoted\"server": {
        command: "exfiltrate"
      }
    }
  });
  const executionProfile = sourceExplanationEconomyProfile();
  const prepared = await prepareCodexAppServerEconomyThreadStartSettings({
    developerInstructions: "Explain only the bounded excerpt in the prompt.",
    executionProfile,
    provider
  });

  assert.deepEqual(prepared.executionProfile, executionProfile);
  assert.equal(prepared.enforcement.connectionGeneration, 1);
  assert.deepEqual(prepared.enforcement.mcpServerNames, [
    "danger.server",
    "quoted\"server"
  ]);
  assert.deepEqual(prepared.settings, {
    allowProviderModelFallback: false,
    approvalPolicy: "never",
    baseInstructions: "Complete only the bounded structured task in the user input. Return one response matching the supplied JSON schema. Do not use tools, environments, network access, or repository writes.",
    config: prepared.enforcement.config,
    cwd: ECONOMY_EXECUTION_CWD,
    developerInstructions: "Explain only the bounded excerpt in the prompt.",
    dynamicTools: [],
    environments: [],
    model: "gpt-5.6-luna",
    runtimeWorkspaceRoots: [],
    sandbox: "read-only",
    selectedCapabilityRoots: [],
    sessionStartSource: "startup",
    threadSource: "vibe64-economy"
  });
  assert.deepEqual(prepared.settings.config.mcp_servers, {
    "danger.server": {
      enabled: false
    },
    "quoted\"server": {
      enabled: false
    }
  });
  assert.deepEqual(prepared.settings.config.hooks, {
    state: {
      "/repo/worktree/.codex/hooks.json:stop:0:0": {
        enabled: false
      }
    }
  });
  assert.equal(prepared.settings.config.features.shell_tool, false);
  assert.equal(prepared.settings.config.features.plugins, false);
  assert.equal(prepared.settings.config.features.apps, false);
  assert.equal(prepared.settings.config.features.browser_use, false);
  assert.equal(prepared.settings.config.features.computer_use, false);
  assert.equal(prepared.settings.config.features.hooks, false);
  assert.equal(prepared.settings.config.features.multi_agent, false);
  assert.equal(prepared.settings.config.features.tool_suggest, false);
  assert.equal(prepared.settings.config.features.view_image, false);
  assert.equal(prepared.settings.config.features.current_time_reminder, false);
  assert.equal(prepared.settings.config.features.sleep_tool, false);
  assert.equal(prepared.settings.config.features.token_budget, false);
  assert.deepEqual(prepared.settings.config.notify, []);
  assert.equal(prepared.settings.config.orchestrator.mcp.enabled, false);
  assert.equal(prepared.settings.config.orchestrator.skills.enabled, false);
  assert.equal(prepared.settings.config.skills.include_instructions, false);
  assert.equal(prepared.settings.config.include_apps_instructions, false);
  assert.equal(prepared.settings.config.include_permissions_instructions, false);
  assert.equal(prepared.settings.config.include_environment_context, false);
  assert.equal(prepared.settings.config.project_doc_max_bytes, 0);
  assert.equal(Object.isFrozen(prepared.settings.config), true);
  assert.equal(Object.isFrozen(prepared.settings.config.mcp_servers["danger.server"]), true);

  assert.deepEqual(codexAppServerEconomyTurnSettings({
    cwd: "/repo/worktree",
    executionProfile,
    outputSchema: sourceExplanationOutputSchema()
  }), {
    approvalPolicy: "never",
    cwd: "/repo/worktree",
    effort: "low",
    environments: [],
    model: "gpt-5.6-luna",
    outputSchema: sourceExplanationOutputSchema(),
    runtimeWorkspaceRoots: [],
    sandboxPolicy: {
      networkAccess: false,
      type: "readOnly"
    },
    summary: "none"
  });
  assert.deepEqual(provider.calls, [[
    "readConfig",
    {
      cwd: ECONOMY_EXECUTION_CWD,
      includeLayers: false
    }
  ], [
    "listHooks",
    [ECONOMY_EXECUTION_CWD]
  ]]);
});

test("Codex economy accepts the minimum and newer patch, minor and major versions with isolation", async () => {
  const [major, minor, patch] = MINIMUM_CODEX_VERSION.split(".").map(Number);
  for (const version of [
    MINIMUM_CODEX_VERSION,
    `${major}.${minor}.${patch + 1}`,
    `${major}.${minor}.${patch + 10}`,
    `${major}.${minor + 1}.0`,
    `${major}.${minor + 10}.0`,
    `${major + 1}.0.0`
  ]) {
    const provider = economyInventoryProvider({ userAgent: `vibe64/${version} (unit test)` });
    assert.deepEqual(assertCodexAppServerEconomyCompatibility(provider), {
      minimumVersion: MINIMUM_CODEX_VERSION,
      version
    });
    const prepared = await prepareCodexAppServerEconomyThreadStartSettings({
      executionProfile: sourceExplanationEconomyProfile(),
      provider
    });
    assert.equal(prepared.settings.sandbox, "read-only", version);
    assert.deepEqual(prepared.settings.environments, [], version);
    assert.equal(prepared.settings.config.features.shell_tool, false, version);
    assert.equal(prepared.settings.config.features.hooks, false, version);
    assert.equal(provider.calls.length, 2, version);
  }
});

test("Codex economy rejects versions below the minimum before inventory", async () => {
  const minimumParts = MINIMUM_CODEX_VERSION.split(".").map(Number);
  for (const [index, part] of minimumParts.entries()) {
    if (part === 0) {
      continue;
    }
    const olderParts = [...minimumParts];
    olderParts[index] -= 1;
    olderParts.fill(999, index + 1);
    const version = olderParts.join(".");
    const provider = economyInventoryProvider({ userAgent: `vibe64/${version} (unit test)` });
    await assert.rejects(prepareCodexAppServerEconomyThreadStartSettings({
      executionProfile: sourceExplanationEconomyProfile(),
      provider
    }), (error) => {
      assert.equal(error.code, VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.POLICY_UNENFORCEABLE);
      assert.equal(error.minimumVersion, MINIMUM_CODEX_VERSION);
      assert.equal(error.actualVersion, version);
      assert.equal(error.message, `Codex economy execution requires app-server ${MINIMUM_CODEX_VERSION} or newer; current version is ${version}. Update Codex and retry.`);
      return true;
    });
    assert.deepEqual(provider.calls, [], version);
  }
});

test("Codex economy fails closed before inventory when app-server cannot enforce the policy", async () => {
  for (const [label, provider] of [
    ["missing version API", {
      ...economyInventoryProvider(),
      currentServerInfo: undefined
    }],
    ["malformed version", economyInventoryProvider({
      userAgent: "vibe64/development"
    })],
    ["spoofed product", economyInventoryProvider({
      userAgent: `attacker/999.0.0 vibe64/${MINIMUM_CODEX_VERSION}`
    })],
    ["leading zero", economyInventoryProvider({
      userAgent: `vibe64/0${MINIMUM_CODEX_VERSION}`
    })],
    ["control character", economyInventoryProvider({
      userAgent: `vibe64/${MINIMUM_CODEX_VERSION}\nattacker/999.0.0`
    })],
    ["oversized user agent", economyInventoryProvider({
      userAgent: `vibe64/${MINIMUM_CODEX_VERSION} ${"x".repeat(600)}`
    })],
    ["prerelease version", economyInventoryProvider({
      userAgent: `vibe64/${MINIMUM_CODEX_VERSION}-beta.1 (unit test)`
    })],
    ["unsafe version component", economyInventoryProvider({
      userAgent: `vibe64/${Number.MAX_SAFE_INTEGER + 1}.0.0 (unit test)`
    })]
  ]) {
    await assert.rejects(prepareCodexAppServerEconomyThreadStartSettings({
      executionProfile: sourceExplanationEconomyProfile(),
      provider
    }), (error) => {
      assert.equal(
        error.code,
        VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.POLICY_UNENFORCEABLE,
        label
      );
      assert.equal(error.minimumVersion, MINIMUM_CODEX_VERSION, label);
      assert.match(error.message, /Update Codex and retry/u, label);
      return true;
    });
    assert.deepEqual(provider.calls, [], label);
  }

  const supported = economyInventoryProvider();
  await prepareCodexAppServerEconomyThreadStartSettings({
    executionProfile: sourceExplanationEconomyProfile(),
    provider: supported
  });
  assert.equal(supported.calls.length, 2);
});

test("Codex economy rejects unsafe profiles and non-strict or unbounded output schemas", () => {
  assert.throws(() => codexAppServerEconomyThreadSettings({
    config: {},
    cwd: "/repo/worktree",
    executionProfile: sourceExplanationEconomyProfile()
  }), (error) => {
    assert.equal(
      error.code,
      VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.POLICY_UNENFORCEABLE
    );
    assert.match(error.message, /verified tool-isolation configuration/u);
    return true;
  });

  assert.throws(() => codexAppServerEconomyTurnSettings({
    cwd: "/repo/worktree",
    executionProfile: sourceExplanationEconomyProfile({
      providerId: "claude"
    }),
    outputSchema: sourceExplanationOutputSchema()
  }), (error) => {
    assert.equal(
      error.code,
      VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.POLICY_UNENFORCEABLE
    );
    return true;
  });

  assert.throws(() => codexAppServerEconomyTurnSettings({
    cwd: "/repo/worktree",
    executionProfile: sourceExplanationEconomyProfile(),
    outputSchema: {
      properties: {
        answer: {
          maxLength: 100,
          type: "string"
        }
      },
      required: ["answer"],
      type: "object"
    }
  }), (error) => {
    assert.equal(
      error.code,
      VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.POLICY_UNENFORCEABLE
    );
    assert.match(error.message, /reject additional properties/u);
    return true;
  });

  assert.throws(() => codexAppServerEconomyTurnSettings({
    cwd: "/repo/worktree",
    executionProfile: sourceExplanationEconomyProfile(),
    outputSchema: sourceExplanationOutputSchema(16_001)
  }), (error) => {
    assert.equal(
      error.code,
      VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.POLICY_UNENFORCEABLE
    );
    assert.match(error.message, /exceed the resolved output limit/u);
    return true;
  });

  assert.throws(() => codexAppServerEconomyTurnSettings({
    cwd: "/repo/worktree",
    executionProfile: sourceExplanationEconomyProfile(),
    outputSchema: {
      additionalProperties: false,
      properties: {
        answer: {
          maxLength: 100,
          pattern: ".*",
          type: "string"
        }
      },
      required: ["answer"],
      type: "object"
    }
  }), (error) => {
    assert.equal(
      error.code,
      VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.POLICY_UNENFORCEABLE
    );
    assert.match(error.message, /unsupported keyword/u);
    return true;
  });

  assert.throws(() => codexAppServerEconomyTurnSettings({
    cwd: "/repo/worktree",
    executionProfile: sourceExplanationEconomyProfile(),
    outputSchema: {
      maximum: 1,
      minimum: 2,
      type: "number"
    }
  }), (error) => {
    assert.equal(
      error.code,
      VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.POLICY_UNENFORCEABLE
    );
    assert.match(error.message, /unsupported type/u);
    return true;
  });

  const escapedStringProfile = sourceExplanationEconomyProfile({
    limits: {
      maxInputCharacters: 100,
      maxOutputCharacters: 18,
      timeoutMs: 1000
    }
  });
  assert.throws(() => codexAppServerEconomyTurnSettings({
    cwd: "/repo/worktree",
    executionProfile: escapedStringProfile,
    outputSchema: sourceExplanationOutputSchema(1)
  }), (error) => {
    assert.equal(
      error.code,
      VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.POLICY_UNENFORCEABLE
    );
    assert.equal(error.maximumCharacters, JSON.stringify({ answer: "\u0000" }).length);
    assert.match(error.message, /exceed the resolved output limit/u);
    return true;
  });
  assert.doesNotThrow(() => codexAppServerEconomyTurnSettings({
    cwd: "/repo/worktree",
    executionProfile: sourceExplanationEconomyProfile({
      limits: {
        maxInputCharacters: 100,
        maxOutputCharacters: JSON.stringify({ answer: "\u0000" }).length,
        timeoutMs: 1000
      }
    }),
    outputSchema: sourceExplanationOutputSchema(1)
  }));

  const cyclicSchema = {
    additionalProperties: false,
    properties: {},
    required: [],
    type: "object"
  };
  cyclicSchema.properties.answer = cyclicSchema;
  cyclicSchema.required.push("answer");
  assert.throws(() => codexAppServerEconomyTurnSettings({
    cwd: "/repo/worktree",
    executionProfile: sourceExplanationEconomyProfile(),
    outputSchema: cyclicSchema
  }), (error) => {
    assert.equal(
      error.code,
      VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.POLICY_UNENFORCEABLE
    );
    assert.match(error.message, /not serializable/u);
    return true;
  });
});

test("Codex economy fails closed for managed hooks and incomplete hook discovery", async () => {
  await assert.rejects(prepareCodexAppServerEconomyThreadStartSettings({
    executionProfile: sourceExplanationEconomyProfile(),
    provider: economyInventoryProvider({
      hooks: [{
        currentHash: "sha256:managed-hook",
        enabled: true,
        handlerType: "command",
        isManaged: true,
        key: "managed:stop:0",
        sourcePath: "/etc/codex/hooks.json"
      }]
    })
  }), (error) => {
    assert.equal(
      error.code,
      VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.POLICY_UNENFORCEABLE
    );
    assert.match(error.message, /cannot disable a managed hook/u);
    return true;
  });

  await assert.rejects(prepareCodexAppServerEconomyThreadStartSettings({
    executionProfile: sourceExplanationEconomyProfile(),
    provider: economyInventoryProvider({
      records: [{
        cwd: ECONOMY_EXECUTION_CWD,
        errors: [{ message: "malformed hook configuration" }],
        hooks: [],
        warnings: []
      }]
    })
  }), (error) => {
    assert.equal(
      error.code,
      VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.POLICY_UNENFORCEABLE
    );
    assert.match(error.message, /hook discovery has errors/u);
    assert.doesNotMatch(JSON.stringify(error), /malformed hook configuration/u);
    return true;
  });
});

test("Codex economy bounds config, hook, and instruction inventories without exposing their payloads", async () => {
  const cases = [{
    label: "too many MCP servers",
    provider: economyInventoryProvider({
      mcpServers: Object.fromEntries(Array.from({ length: 129 }, (_, index) => [
        `server-${index}`,
        { command: "unsafe" }
      ]))
    })
  }, {
    label: "oversized MCP configuration",
    provider: economyInventoryProvider({
      mcpServers: {
        malicious: {
          secret: `config-secret-${"x".repeat(300 * 1024)}`
        }
      }
    })
  }, {
    label: "oversized hook inventory",
    provider: economyInventoryProvider({
      hooks: [{
        currentHash: "hash",
        enabled: false,
        handlerType: "command",
        isManaged: false,
        key: "hook-key",
        sourcePath: `hook-secret-${"x".repeat(520 * 1024)}`
      }]
    })
  }];

  for (const { label, provider } of cases) {
    await assert.rejects(prepareCodexAppServerEconomyThreadStartSettings({
      executionProfile: sourceExplanationEconomyProfile(),
      provider
    }), (error) => {
      assert.equal(
        error.code,
        VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.POLICY_UNENFORCEABLE,
        label
      );
      assert.doesNotMatch(JSON.stringify(error), /config-secret|hook-secret/u, label);
      return true;
    });
  }

  await assert.rejects(prepareCodexAppServerEconomyThreadStartSettings({
    developerInstructions: "x".repeat(8193),
    executionProfile: sourceExplanationEconomyProfile(),
    provider: economyInventoryProvider()
  }), (error) => {
    assert.equal(error.code, VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.UNBOUNDED);
    assert.match(error.message, /developer instructions exceed/u);
    return true;
  });
});

test("Codex economy deletes a new thread when execution surfaces change during startup", async () => {
  const calls = [];
  let inventory = 0;
  const provider = {
    ...economyExecutionProviderParts(),
    currentConnectionGeneration() {
      return 4;
    },
    currentServerInfo() {
      return { userAgent: `vibe64/${MINIMUM_CODEX_VERSION} (unit test)` };
    },
    async deleteThread(threadId) {
      calls.push(["deleteThread", threadId]);
    },
    async listHooks(cwds) {
      calls.push(["listHooks", cwds]);
      return {
        data: [{
          cwd: cwds[0],
          errors: [],
          hooks: [],
          warnings: []
        }]
      };
    },
    async readConfig(params) {
      inventory += 1;
      calls.push(["readConfig", params]);
      return {
        config: {
          mcp_servers: inventory === 1 ? {} : {
            "late-write-tool": {
              command: "write-anywhere"
            }
          }
        }
      };
    },
    async startThread(params) {
      calls.push(["startThread", params]);
      return {
        id: "economy-thread"
      };
    }
  };

  await assert.rejects(startCodexAppServerEconomyThread({
    executionProfile: sourceExplanationEconomyProfile(),
    provider
  }), (error) => {
    assert.equal(
      error.code,
      VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.POLICY_UNENFORCEABLE
    );
    assert.match(error.message, /execution surfaces changed/u);
    return true;
  });
  assert.deepEqual(calls.at(-1), ["deleteThread", "economy-thread"]);
});

test("Codex economy reports retryable ownership when post-start deletion fails", async () => {
  let inventory = 0;
  const provider = economyInventoryProvider();
  provider.readConfig = async () => {
    inventory += 1;
    return {
      config: {
        mcp_servers: inventory === 1 ? {} : {
          "late-write-tool": {
            command: "write-anywhere"
          }
        }
      }
    };
  };
  provider.startThread = async () => ({ id: "unclean-economy-thread" });
  provider.deleteThread = async () => {
    throw new Error("delete transport failed");
  };

  await assert.rejects(startCodexAppServerEconomyThread({
    executionProfile: sourceExplanationEconomyProfile(),
    provider
  }), (error) => {
    assert.equal(
      error.code,
      VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.POLICY_UNENFORCEABLE
    );
    assert.equal(error.codexAppServerEconomyThreadCleanupRequired, true);
    assert.equal(error.codexAppServerEconomyThreadId, "unclean-economy-thread");
    assert.equal(error.cleanupFailed, true);
    assert.match(error.message, /could not retire an economy thread/u);
    assert.equal(error.cause, undefined);
    return true;
  });
});

test("Codex economy turn enforces the input bound before contacting the provider", async () => {
  const calls = [];
  const executionProfile = sourceExplanationEconomyProfile({
    limits: {
      maxInputCharacters: 8,
      maxOutputCharacters: 16_000,
      timeoutMs: 180_000
    }
  });
  const provider = {
    ...economyExecutionProviderParts(),
    async sendTurn(...args) {
      calls.push(args);
      return {
        id: "turn-1"
      };
    }
  };

  await assert.rejects(sendCodexAppServerEconomyTurn({
    executionProfile,
    outputSchema: sourceExplanationOutputSchema(),
    prompt: "123456789",
    provider,
    threadId: "economy-thread"
  }), (error) => {
    assert.equal(error.code, VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.UNBOUNDED);
    return true;
  });
  assert.equal(calls.length, 0);

  const result = await sendCodexAppServerEconomyTurn({
    executionProfile,
    outputSchema: sourceExplanationOutputSchema(),
    prompt: "bounded",
    provider,
    threadId: "economy-thread"
  });
  assert.deepEqual(result.executionProfile, executionProfile);
  assert.equal(result.turn.id, "turn-1");
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].slice(0, 2), ["economy-thread", "bounded"]);
  assert.deepEqual(calls[0][2].environments, []);
  assert.equal(calls[0][2].sandboxPolicy.type, "readOnly");
  assert.equal(calls[0][2].sandboxPolicy.networkAccess, false);
});

test("Codex economy rejects raw structured output beyond the resolved bound", () => {
  const executionProfile = sourceExplanationEconomyProfile({
    limits: {
      maxInputCharacters: 100_000,
      maxOutputCharacters: 20,
      timeoutMs: 180_000
    }
  });

  assert.equal(assertCodexAppServerEconomyOutputWithinLimit({
    executionProfile,
    rawOutput: "{\"answer\":\"short\"}"
  }), "{\"answer\":\"short\"}");
  assert.throws(() => assertCodexAppServerEconomyOutputWithinLimit({
    executionProfile,
    rawOutput: "{\"answer\":\"too long\"}"
  }), (error) => {
    assert.equal(error.code, VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.UNBOUNDED);
    assert.equal(error.maxOutputCharacters, 20);
    assert.equal(error.outputCharacters, 21);
    return true;
  });
});

test("Codex economy safely reapplies isolation when resuming a controller-owned thread", async () => {
  const calls = [];
  const provider = {
    ...economyExecutionProviderParts(),
    currentConnectionGeneration() {
      return 7;
    },
    currentServerInfo() {
      return { userAgent: `vibe64/${MINIMUM_CODEX_VERSION} (unit test)` };
    },
    async deleteThread(threadId) {
      calls.push(["deleteThread", threadId]);
    },
    async listHooks(cwds) {
      calls.push(["listHooks", cwds]);
      return {
        data: [{
          cwd: cwds[0],
          errors: [],
          hooks: [],
          warnings: []
        }]
      };
    },
    async readConfig(params) {
      calls.push(["readConfig", params]);
      return {
        config: {
          mcp_servers: {
            filesystem: {
              command: "unsafe-fixture"
            }
          }
        }
      };
    },
    async resumeThread(threadId, params) {
      calls.push(["resumeThread", threadId, params]);
      return {
        id: threadId
      };
    }
  };

  const result = await resumeCodexAppServerEconomyThread({
    developerInstructions: "Continue only this source explanation.",
    executionProfile: sourceExplanationEconomyProfile(),
    provider,
    threadId: "registered-economy-thread"
  });

  assert.equal(result.threadId, "registered-economy-thread");
  assert.equal(calls.filter(([method]) => method === "readConfig").length, 2);
  assert.equal(calls.filter(([method]) => method === "listHooks").length, 2);
  const resumeCall = calls.find(([method]) => method === "resumeThread");
  assert.equal(resumeCall[1], "registered-economy-thread");
  assert.deepEqual(resumeCall[2].runtimeWorkspaceRoots, []);
  assert.equal(resumeCall[2].sandbox, "read-only");
  assert.equal(resumeCall[2].config.mcp_servers.filesystem.enabled, false);
  assert.equal(Object.hasOwn(resumeCall[2], "dynamicTools"), false);
  assert.equal(Object.hasOwn(resumeCall[2], "environments"), false);
  assert.equal(Object.hasOwn(resumeCall[2], "selectedCapabilityRoots"), false);
  assert.equal(calls.some(([method]) => method === "deleteThread"), false);
});

test("codex app-server bridge preserves an explicit Spark interactive turn", () => {
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
      networkAccess: "enabled",
      type: "externalSandbox"
    }
  });
});

test("codex app-server bridge records the host CLI resume command for the same thread", () => {
  const metadata = codexAppServerIdentityMetadata({
    appServerRuntime: appServerRuntime(),
    threadId: "019e865d-8108-7740-912b-42ece83a5c73",
    workdir: "/runtime/projects/repo-test/sessions/active/session/source"
  });

  assert.equal(metadata.agent_identity_conversation_id, "019e865d-8108-7740-912b-42ece83a5c73");
  assert.equal(Object.hasOwn(metadata, "agent_workflow_result_transport"), false);
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
    observeThread() {},
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
  assert.equal(Object.hasOwn(providerCalls[0].params, "dynamicTools"), false);
  assert.equal(metadataValue(runtime, "agent_identity_provider"), "codex");
  assert.equal(metadataValue(runtime, "agent_identity_conversation_id"), "thread-started");
  assert.equal(metadataValue(runtime, "agent_transport_kind"), "unix");
  assert.equal(metadataValue(runtime, "agent_transport_socket_path"), "/tmp/vibe64/agent-providers/codex-app-server/app-server.sock");
  assert.equal(metadataValue(runtime, "agent_workflow_result_transport"), undefined);
});

test("codex app-server bridge reuses an already-available runtime when ensuring a thread", async () => {
  const runtime = fakeRuntime();
  let ensureRuntimeCalls = 0;
  const provider = {
    async ensureAvailable() {
      return {
        runtime: appServerRuntime()
      };
    },
    async ensureRuntime() {
      ensureRuntimeCalls += 1;
      return appServerRuntime();
    },
    async startThread() {
      return {
        id: "thread-started"
      };
    }
  };

  const result = await ensureCodexAppServerThreadForSession({
    observeThread() {},
    provider,
    runtime,
    session: {
      metadata: {},
      sessionId: "session-1"
    },
    workdir: "/repo/worktree"
  });

  assert.equal(result.threadId, "thread-started");
  assert.equal(ensureRuntimeCalls, 0);
});

test("codex app-server bridge activates exact project hooks for each new thread", async () => {
  const runtime = fakeRuntime();
  const providerCalls = [];
  const provider = {
    async ensureRuntime() {
      return appServerRuntime();
    },
    async listHooks(cwds) {
      providerCalls.push({
        cwds,
        method: "listHooks"
      });
      return {
        data: [{
          cwd: "/repo/worktree",
          hooks: [{
            currentHash: "sha256:genesis-begin",
            enabled: true,
            key: "/repo/worktree/.codex/hooks.json:user_prompt_submit:0:0",
            source: "project"
          }, {
            currentHash: "sha256:ignored-plugin",
            enabled: true,
            key: "plugin:other",
            source: "plugin"
          }, {
            currentHash: "sha256:ignored-disabled",
            enabled: false,
            key: "/repo/worktree/.codex/hooks.json:stop:0:0",
            source: "project"
          }]
        }]
      };
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

  await ensureCodexAppServerThreadForSession({
    observeThread() {},
    provider,
    runtime,
    session: {
      metadata: {},
      sessionId: "session-1"
    },
    workdir: "/repo/worktree"
  });

  assert.deepEqual(providerCalls, [{
    cwds: ["/repo/worktree"],
    method: "listHooks"
  }, {
    method: "startThread",
    params: {
      approvalPolicy: "never",
      config: {
        model_reasoning_effort: "xhigh",
        model_reasoning_summary: "concise",
        hooks: {
          state: {
            "/repo/worktree/.codex/hooks.json:user_prompt_submit:0:0": {
              trusted_hash: "sha256:genesis-begin"
            }
          }
        }
      },
      cwd: "/repo/worktree",
      developerInstructions: null,
      model: VIBE64_CODEX_DEFAULT_MODEL,
      sandbox: "danger-full-access",
      sessionStartSource: "startup",
      threadSource: "vibe64"
    }
  }]);
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
    observeThread() {},
    provider,
    runtime,
    session: {
      metadata: {
        agent_identity_conversation_id: "thread-existing",
        agent_identity_provider: "codex",
        agent_identity_status: "ready",
        agent_identity_workdir: "/repo/worktree",
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
        config: { model_reasoning_effort: "xhigh", model_reasoning_summary: "concise" },
        cwd: "/repo/worktree",
        developerInstructions: null,
        model: VIBE64_CODEX_DEFAULT_MODEL,
        sandbox: "danger-full-access"
      },
      threadId: "thread-existing"
    }
  ]);
});

test("Codex changeover restores its saved conversation and pauses its goal before native resume", async () => {
  const runtime = fakeRuntime();
  const calls = [];
  const provider = {
    async ensureRuntime() { return appServerRuntime(); },
    async readGoal(id) { calls.push(["goal", id]); return { goal: { status: "active" } }; },
    async setGoalStatus(id, status) { calls.push(["pause", id, status]); },
    async resumeThread(id) { calls.push(["resume", id]); return { id }; }
  };
  const result = await ensureCodexAppServerThreadForSession({ provider, runtime, workdir: "/repo/worktree",
    observeThread(id) { calls.push(["observe", id]); },
    session: { sessionId: "session-1", metadata: {
      agent_identity_provider: "opencode", agent_identity_conversation_id: "ses_other",
      agent_transport_id: "opencode_server", codex_conversation_id: "original-codex",
      codex_conversation_workdir: "/repo/worktree", codex_changeover_pause_goal: "yes"
    } }
  });
  assert.equal(result.threadId, "original-codex");
  assert.deepEqual(calls, [["goal", "original-codex"], ["pause", "original-codex", "paused"],
    ["observe", "original-codex"], ["resume", "original-codex"]]);
  assert.ok(runtime.writes.some((write) => write.name === "codex_changeover_pause_goal" && write.value === ""));
});

test("codex app-server bridge refreshes project hook trust when resuming a thread", async () => {
  const runtime = fakeRuntime();
  const providerCalls = [];
  const provider = {
    async ensureRuntime() {
      return appServerRuntime();
    },
    async listHooks(cwds) {
      providerCalls.push({
        cwds,
        method: "listHooks"
      });
      return {
        data: [{
          cwd: "/repo/worktree",
          hooks: [{
            currentHash: "sha256:current-stop-hook",
            enabled: true,
            key: "/repo/worktree/.codex/hooks.json:stop:0:0",
            source: "project"
          }]
        }]
      };
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

  await ensureCodexAppServerThreadForSession({
    observeThread() {},
    provider,
    runtime,
    session: {
      metadata: {
        agent_identity_conversation_id: "thread-existing",
        agent_identity_provider: "codex",
        agent_identity_status: "ready",
        agent_identity_workdir: "/repo/worktree",
        agent_transport_id: "codex_app_server"
      },
      sessionId: "session-1"
    },
    workdir: "/repo/worktree"
  });

  assert.equal(providerCalls[1].method, "resumeThread");
  assert.equal(providerCalls[1].threadId, "thread-existing");
  assert.deepEqual(providerCalls[1].params.config, {
    model_reasoning_effort: "xhigh",
    model_reasoning_summary: "concise",
    hooks: {
      state: {
        "/repo/worktree/.codex/hooks.json:stop:0:0": {
          trusted_hash: "sha256:current-stop-hook"
        }
      }
    }
  });
});

test("visible Codex terminals persist trust for the project hooks they already run", async () => {
  const calls = [];
  const provider = {
    async listHooks(cwds) {
      calls.push({ cwds, method: "listHooks" });
      return {
        data: [{
          cwd: "/repo/worktree",
          hooks: [{
            currentHash: "sha256:session-start",
            enabled: true,
            key: "/repo/worktree/.codex/hooks.json:session_start:0:0",
            source: "project",
            trustStatus: "untrusted"
          }, {
            currentHash: "sha256:user-prompt",
            enabled: true,
            key: "/repo/worktree/.codex/hooks.json:user_prompt_submit:0:0",
            source: "project",
            trustStatus: "trusted"
          }]
        }]
      };
    },
    async writeHookTrustState(state) {
      calls.push({ method: "writeHookTrustState", state });
    }
  };

  const config = await codexAppServerProjectHookTrustConfig(
    provider,
    "/repo/worktree",
    { persist: true }
  );

  assert.deepEqual(config, {
    hooks: {
      state: {
        "/repo/worktree/.codex/hooks.json:session_start:0:0": {
          trusted_hash: "sha256:session-start"
        },
        "/repo/worktree/.codex/hooks.json:user_prompt_submit:0:0": {
          trusted_hash: "sha256:user-prompt"
        }
      }
    }
  });
  assert.deepEqual(calls, [{
    cwds: ["/repo/worktree"],
    method: "listHooks"
  }, {
    method: "writeHookTrustState",
    state: config.hooks.state
  }]);
});

test("codex app-server bridge replaces unreadable session threads after an invalid resume request", async () => {
  const runtime = fakeRuntime({
    conversationLog: [
      {
        assistant: {
          at: "2026-06-15T01:02:05.000Z",
          role: "assistant",
          text: "Use the archive branch."
        },
        commentary: [
          {
            at: "2026-06-15T01:02:04.500Z",
            role: "commentary",
            text: "I found the archive branch and I’m checking its scope."
          }
        ],
        thinking: [
          {
            at: "2026-06-15T01:02:04.000Z",
            role: "thinking",
            text: "Checked the issue draft."
          }
        ],
        user: {
          attachments: [{
            fileName: "archive-map.png",
            path: "/tmp/vibe64-attachments/session/archive-map.png",
            size: 2048
          }],
          at: "2026-06-15T01:02:03.000Z",
          role: "user",
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
    observeThread() {},
    developerInstructions: "Vibe64 briefing",
    provider,
    runtime,
    session: {
      metadata: {
        agent_identity_conversation_id: "thread-stale",
        agent_identity_provider: "codex",
        agent_identity_status: "ready",
        agent_identity_workdir: "/repo/worktree",
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
  assert.match(providerCalls[3].input, /Attached files:\n- archive-map\.png/u);
  assert.doesNotMatch(providerCalls[3].input, /\/tmp\/vibe64-attachments/u);
  assert.match(providerCalls[3].input, /Checked the issue draft/u);
  assert.match(providerCalls[3].input, /Assistant Commentary 1/u);
  assert.match(providerCalls[3].input, /I found the archive branch and I’m checking its scope/u);
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
      observeThread() {},
      provider,
      runtime,
      session: {
        metadata: {
          agent_identity_conversation_id: "thread-readable",
          agent_identity_provider: "codex",
          agent_identity_status: "ready",
          agent_identity_workdir: "/repo/worktree",
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
      observeThread() {},
      provider,
      runtime,
      session: {
        metadata: {
          agent_identity_conversation_id: "thread-existing",
          agent_identity_provider: "codex",
          agent_identity_status: "ready",
          agent_identity_workdir: "/repo/worktree",
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

test("codex app-server bridge resumes an existing provider thread without workflow metadata", async () => {
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
    observeThread() {},
    provider,
    runtime,
    session: {
      metadata: {
        agent_identity_conversation_id: "old-terminal-thread",
        agent_identity_provider: "codex",
        agent_identity_status: "ready",
        agent_identity_workdir: "/repo/worktree",
        agent_transport_id: "codex_app_server"
      },
      sessionId: "session-1"
    },
    workdir: "/repo/worktree"
  });

  assert.equal(result.threadId, "old-terminal-thread");
  assert.deepEqual(providerCalls.map((call) => call.method), ["resumeThread"]);
  assert.equal(metadataValue(runtime, "agent_identity_conversation_id"), "old-terminal-thread");
  assert.equal(metadataValue(runtime, "agent_transport_id"), "codex_app_server");
});

test("codex app-server bridge sends the authored text as its own unchanged input item", async () => {
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

  const authoredText = "  Do the work.\n";
  const result = await sendCodexAppServerPromptForSession({
    prompt: authoredText,
    provider,
    threadId: "thread-1",
    workdir: "/repo/worktree"
  });

  assert.equal(result.turn.id, "turn-1");
  assert.deepEqual(result.input, [authoredText]);
  assert.deepEqual(providerCalls[0].input, [authoredText]);
  assert.equal(providerCalls[0].threadId, "thread-1");
  assert.deepEqual(providerCalls[0].params.sandboxPolicy, {
    networkAccess: "enabled",
    type: "externalSandbox"
  });
  assert.equal(providerCalls[0].params.outputSchema, undefined);
});

test("codex app-server bridge applies an output schema only for focused task turns", async () => {
  let params = null;
  const outputSchema = {
    properties: {
      kind: {
        enum: ["continue", "complete"],
        type: "string"
      }
    },
    required: ["kind"],
    type: "object"
  };
  const provider = {
    async sendTurn(_threadId, _input, turnParams) {
      params = turnParams;
      return {
        id: "task-turn"
      };
    }
  };

  await sendCodexAppServerPromptForSession({
    outputSchema,
    prompt: "Do the focused task.",
    provider,
    threadId: "task-thread",
    workdir: "/repo/worktree"
  });

  assert.equal(params.outputSchema, outputSchema);
});

test("codex app-server bridge starts plain threads without workflow tools", () => {
  const settings = codexAppServerThreadStartSettings({
    cwd: "/repo/worktree"
  });

  assert.equal(Object.hasOwn(settings, "dynamicTools"), false);
  assert.equal(settings.sessionStartSource, "startup");
  assert.equal(settings.threadSource, "vibe64");
});

test("session renewal resumes and reads only the exact persisted main thread with normal settings", async () => {
  const calls = [];
  const provider = {
    async ensureRuntime() {
      calls.push(["ensureRuntime"]);
      return appServerRuntime();
    },
    async readThread(threadId) {
      calls.push(["readThread", threadId]);
      return {
        id: threadId,
        raw: {
          id: threadId,
          turns: [{ id: "old-turn" }]
        }
      };
    },
    async resumeThread(threadId, settings) {
      calls.push(["resumeThread", threadId, settings]);
      return { id: threadId };
    },
    async startThread() {
      calls.push(["startThread"]);
      return { id: "forbidden-replacement" };
    }
  };
  const result = await resumeExactCodexAppServerThreadForSession({
    agentSettings: {
      model: "gpt-5.6-sol",
      thinking: "high"
    },
    developerInstructions: "Ordinary Vibe64 Genesis work semantics.",
    expectedThreadId: "old-main-thread",
    provider,
    session: {
      metadata: {
        agent_identity_conversation_id: "old-main-thread",
        agent_identity_provider: "codex",
        agent_identity_status: "ready",
        agent_identity_workdir: "/repo/worktree",
        agent_transport_id: "codex_app_server"
      },
      sessionId: "session-old"
    },
    workdir: "/repo/worktree"
  });

  assert.equal(result.threadId, "old-main-thread");
  assert.deepEqual(calls.map(([method]) => method), [
    "ensureRuntime",
    "resumeThread",
    "readThread"
  ]);
  assert.equal(calls[1][2].model, "gpt-5.6-sol");
  assert.equal(calls[1][2].developerInstructions, "Ordinary Vibe64 Genesis work semantics.");
  assert.equal(Object.hasOwn(calls[1][2], "allowProviderModelFallback"), false);
});

test("session renewal reports an unreadable old thread distinctly and never replaces it", async () => {
  const calls = [];
  const provider = {
    async ensureRuntime() {
      return appServerRuntime();
    },
    async readThread(threadId) {
      calls.push(["readThread", threadId]);
      const error = new Error("thread not found");
      error.code = -32600;
      error.method = "thread/read";
      throw error;
    },
    async resumeThread(threadId) {
      calls.push(["resumeThread", threadId]);
      return { id: threadId };
    },
    async startThread() {
      calls.push(["startThread"]);
      return { id: "replacement" };
    }
  };

  await assert.rejects(
    () => resumeExactCodexAppServerThreadForSession({
      expectedThreadId: "old-main-thread",
      provider,
      session: {
        metadata: {
          agent_identity_conversation_id: "old-main-thread",
          agent_identity_provider: "codex",
          agent_identity_status: "ready",
          agent_identity_workdir: "/repo/worktree",
          agent_transport_id: "codex_app_server"
        },
        sessionId: "session-old"
      },
      workdir: "/repo/worktree"
    }),
    (error) => (
      error?.code === "vibe64_session_renewal_thread_unreadable" &&
      /manually/u.test(error.message)
    )
  );
  assert.deepEqual(calls.map(([method]) => method), ["resumeThread", "readThread"]);
});

test("session renewal starts a genuinely fresh successor thread and persists its operation identity", async () => {
  const runtime = fakeRuntime();
  const calls = [];
  const provider = {
    ...renewalThreadInventory(),
    async ensureRuntime() {
      calls.push(["ensureRuntime"]);
      return appServerRuntime();
    },
    async readThread(threadId) {
      calls.push(["readThread", threadId]);
      return { id: threadId, raw: { cwd: "/repo/worktree", id: threadId, turns: [] } };
    },
    async resumeThread(threadId) {
      calls.push(["resumeThread", threadId]);
      return { id: threadId };
    },
    async startThread(settings) {
      calls.push(["startThread", settings]);
      return { id: "new-successor-thread" };
    }
  };
  const result = await startFreshCodexAppServerThreadForSession({
    additionalMetadata: {
      agent_renewal_seed_handover_hash: "a".repeat(64),
      ordinary_metadata_is_rejected: "yes"
    },
    agentSettings: {
      model: "gpt-5.6-sol",
      thinking: "xhigh"
    },
    developerInstructions: "Ordinary Vibe64 Genesis work semantics.",
    forbiddenThreadId: "old-main-thread",
    operationId: "renewal:one",
    provider,
    runtime,
    session: {
      metadata: {},
      sessionId: "session-successor"
    },
    workdir: "/repo/worktree"
  });

  assert.equal(result.fresh, true);
  assert.equal(result.threadId, "new-successor-thread");
  assert.deepEqual(calls.map(([method]) => method), [
    "ensureRuntime",
    "startThread",
    "readThread"
  ]);
  assert.equal(metadataValue(runtime, "agent_renewal_seed_operation_id"), "renewal:one");
  assert.equal(metadataValue(runtime, "agent_renewal_seed_thread_id"), "new-successor-thread");
  assert.equal(metadataValue(runtime, "agent_renewal_seed_handover_hash"), "a".repeat(64));
  assert.equal(metadataValue(runtime, "ordinary_metadata_is_rejected"), undefined);
  assert.equal(metadataValue(runtime, "agent_identity_conversation_id"), "new-successor-thread");
});

test("session renewal accepts the exact pre-message thread/read state after verifying thread status", async () => {
  const runtime = fakeRuntime();
  const calls = [];
  const provider = {
    ...renewalThreadInventory(),
    async ensureRuntime() {
      return appServerRuntime();
    },
    async readThread(threadId) {
      calls.push(["readThread", threadId]);
      const error = new Error(
        `thread ${threadId} is not materialized yet; includeTurns is unavailable before first user message`
      );
      error.code = -32600;
      error.method = "thread/read";
      throw error;
    },
    async readThreadStatus(threadId) {
      calls.push(["readThreadStatus", threadId]);
      return {
        id: threadId,
        raw: { cwd: "/repo/worktree", id: threadId }
      };
    },
    async resumeThread(threadId) {
      calls.push(["resumeThread", threadId]);
      return { id: threadId };
    },
    async startThread() {
      calls.push(["startThread"]);
      return { id: "new-successor-thread" };
    }
  };

  const result = await startFreshCodexAppServerThreadForSession({
    forbiddenThreadId: "old-main-thread",
    operationId: "renewal:unmaterialized",
    provider,
    runtime,
    session: { metadata: {}, sessionId: "session-successor" },
    workdir: "/repo/worktree"
  });

  assert.equal(result.fresh, true);
  assert.equal(result.threadId, "new-successor-thread");
  assert.deepEqual(calls, [
    ["startThread"],
    ["readThread", "new-successor-thread"],
    ["readThreadStatus", "new-successor-thread"]
  ]);
  assert.equal(result.threadSnapshot.raw.cwd, "/repo/worktree");
});

test("session renewal verifies thread status when Codex cannot list turns before the first message", async () => {
  const runtime = fakeRuntime();
  const calls = [];
  const provider = {
    ...renewalThreadInventory(),
    async ensureRuntime() {
      return appServerRuntime();
    },
    async readThread(threadId) {
      calls.push(["readThread", threadId]);
      const error = new Error("list_turns is not supported yet");
      error.code = -32601;
      error.method = "thread/read";
      throw error;
    },
    async readThreadStatus(threadId) {
      calls.push(["readThreadStatus", threadId]);
      return {
        id: threadId,
        raw: { cwd: "/repo/worktree", id: threadId }
      };
    },
    async resumeThread(threadId) {
      calls.push(["resumeThread", threadId]);
      return { id: threadId };
    },
    async startThread() {
      calls.push(["startThread"]);
      return { id: "new-successor-thread" };
    }
  };

  const result = await startFreshCodexAppServerThreadForSession({
    forbiddenThreadId: "old-main-thread",
    operationId: "renewal:turn-list-unavailable",
    provider,
    runtime,
    session: { metadata: {}, sessionId: "session-successor" },
    workdir: "/repo/worktree"
  });

  assert.equal(result.threadId, "new-successor-thread");
  assert.deepEqual(calls, [
    ["startThread"],
    ["readThread", "new-successor-thread"],
    ["readThreadStatus", "new-successor-thread"]
  ]);
  assert.equal(result.threadSnapshot.raw.cwd, "/repo/worktree");
});

test("session renewal rejects every other invalid pre-message thread/read response", async () => {
  let statusReads = 0;
  const provider = {
    ...renewalThreadInventory(),
    async ensureRuntime() {
      return appServerRuntime();
    },
    async readThread() {
      const error = new Error("thread is temporarily unavailable");
      error.code = -32600;
      error.method = "thread/read";
      throw error;
    },
    async readThreadStatus() {
      statusReads += 1;
      return { id: "new-successor-thread", raw: { cwd: "/repo/worktree" } };
    },
    async resumeThread(threadId) {
      return { id: threadId };
    },
    async startThread() {
      return { id: "new-successor-thread" };
    }
  };

  await assert.rejects(
    () => startFreshCodexAppServerThreadForSession({
      operationId: "renewal:wrong-invalid-request",
      provider,
      runtime: fakeRuntime(),
      session: { metadata: {}, sessionId: "session-successor" },
      workdir: "/repo/worktree"
    }),
    (error) => (
      error?.code === "vibe64_session_renewal_fresh_thread_required" &&
      error?.retryable === true
    )
  );
  assert.equal(statusReads, 0);
});

test("session renewal rejects the exact pre-message state when status belongs to another source", async () => {
  const provider = {
    ...renewalThreadInventory(),
    async ensureRuntime() {
      return appServerRuntime();
    },
    async readThread(threadId) {
      const error = new Error(
        `thread ${threadId} is not materialized yet; includeTurns is unavailable before first user message`
      );
      error.code = -32600;
      error.method = "thread/read";
      throw error;
    },
    async readThreadStatus(threadId) {
      return {
        id: threadId,
        raw: { cwd: "/another/worktree", id: threadId }
      };
    },
    async resumeThread(threadId) {
      return { id: threadId };
    },
    async startThread() {
      return { id: "new-successor-thread" };
    }
  };

  await assert.rejects(
    () => startFreshCodexAppServerThreadForSession({
      operationId: "renewal:wrong-status-source",
      provider,
      runtime: fakeRuntime(),
      session: { metadata: {}, sessionId: "session-successor" },
      workdir: "/repo/worktree"
    }),
    (error) => (
      error?.code === "vibe64_session_renewal_fresh_thread_required" &&
      error?.retryable === true &&
      /cannot be read/u.test(error.message)
    )
  );
});

test("session renewal starts a fresh successor when the unreadable predecessor has no recorded thread id", async () => {
  const runtime = fakeRuntime();
  const calls = [];
  const provider = {
    ...renewalThreadInventory(),
    async ensureRuntime() {
      calls.push(["ensureRuntime"]);
      return appServerRuntime();
    },
    async readThread(threadId) {
      calls.push(["readThread", threadId]);
      return { id: threadId, raw: { cwd: "/repo/worktree", id: threadId, turns: [] } };
    },
    async resumeThread(threadId) {
      calls.push(["resumeThread", threadId]);
      return { id: threadId };
    },
    async startThread() {
      calls.push(["startThread"]);
      return { id: "new-successor-thread" };
    }
  };

  const result = await startFreshCodexAppServerThreadForSession({
    operationId: "renewal:manual-handover",
    provider,
    runtime,
    session: {
      metadata: {},
      sessionId: "session-successor"
    },
    workdir: "/repo/worktree"
  });

  assert.equal(result.fresh, true);
  assert.equal(result.threadId, "new-successor-thread");
  assert.deepEqual(calls.map(([method]) => method), [
    "ensureRuntime",
    "startThread",
    "readThread"
  ]);
});

test("session renewal retries only its already-persisted fresh successor thread", async () => {
  const runtime = fakeRuntime();
  const calls = [];
  const provider = {
    async ensureRuntime() {
      return appServerRuntime();
    },
    async readThread(threadId) {
      calls.push(["readThread", threadId]);
      return { id: threadId, raw: { cwd: "/repo/worktree", id: threadId, turns: [] } };
    },
    async resumeThread(threadId) {
      calls.push(["resumeThread", threadId]);
      return { id: threadId };
    },
    async startThread() {
      calls.push(["startThread"]);
      return { id: "wrong-new-thread" };
    }
  };
  const result = await startFreshCodexAppServerThreadForSession({
    forbiddenThreadId: "old-main-thread",
    operationId: "renewal:one",
    provider,
    runtime,
    session: {
      metadata: {
        agent_identity_conversation_id: "new-successor-thread",
        agent_identity_provider: "codex",
        agent_identity_status: "ready",
        agent_identity_workdir: "/repo/worktree",
        agent_renewal_seed_operation_id: "renewal:one",
        agent_renewal_seed_thread_claim: renewalThreadClaim(),
        agent_transport_id: "codex_app_server"
      },
      sessionId: "session-successor"
    },
    workdir: "/repo/worktree"
  });

  assert.equal(result.fresh, false);
  assert.equal(result.threadId, "new-successor-thread");
  assert.deepEqual(calls.map(([method]) => method), ["resumeThread", "readThread"]);
});

test("session renewal durably records a fresh thread before an unreadable snapshot and never replaces it", async () => {
  const runtime = fakeRuntime();
  let starts = 0;
  const provider = {
    ...renewalThreadInventory(),
    async ensureRuntime() {
      return appServerRuntime();
    },
    async readThread() {
      throw new Error("temporarily unreadable");
    },
    async resumeThread(threadId) {
      return { id: threadId };
    },
    async startThread() {
      starts += 1;
      return { id: "new-successor-thread" };
    }
  };

  await assert.rejects(
    () => startFreshCodexAppServerThreadForSession({
      forbiddenThreadId: "old-main-thread",
      operationId: "renewal:one",
      provider,
      runtime,
      session: {
        metadata: {},
        sessionId: "session-successor"
      },
      workdir: "/repo/worktree"
    }),
    (error) => (
      error?.code === "vibe64_session_renewal_fresh_thread_required" &&
      error?.retryable === true
    )
  );

  assert.equal(starts, 1);
  assert.equal(metadataValue(runtime, "agent_renewal_seed_thread_id"), "new-successor-thread");
  assert.deepEqual(
    JSON.parse(metadataValue(runtime, "agent_renewal_seed_thread_claim")),
    JSON.parse(renewalThreadClaim())
  );
  assert.equal(metadataValue(runtime, "agent_identity_conversation_id"), "new-successor-thread");
});

test("session renewal adopts the one thread started before an identity-persistence crash", async () => {
  const runtime = fakeRuntime();
  const originalMutation = runtime.store.mutateSessionForRenewal;
  let renewalMutations = 0;
  runtime.store.mutateSessionForRenewal = async (...args) => {
    renewalMutations += 1;
    if (renewalMutations === 1) {
      const error = new Error("simulated process crash before identity persistence");
      error.code = "simulated_process_crash";
      throw error;
    }
    return originalMutation(...args);
  };
  const discoveredThreadIds = [];
  let starts = 0;
  const provider = {
    async ensureRuntime() {
      return appServerRuntime();
    },
    async listAppServerThreadsForCwd({ cwd }) {
      return {
        cwd,
        threadIds: [...discoveredThreadIds]
      };
    },
    async readThread(threadId) {
      return {
        id: threadId,
        raw: { cwd: "/repo/worktree", id: threadId, turns: [] }
      };
    },
    async resumeThread(threadId) {
      return { id: threadId };
    },
    async startThread() {
      starts += 1;
      discoveredThreadIds.push("crash-window-thread");
      return { id: "crash-window-thread" };
    }
  };

  await assert.rejects(
    () => startFreshCodexAppServerThreadForSession({
      operationId: "renewal:crash-window",
      provider,
      runtime,
      session: {
        metadata: {},
        sessionId: "session-successor"
      },
      workdir: "/repo/worktree"
    }),
    (error) => error?.code === "simulated_process_crash"
  );

  assert.equal(starts, 1);
  assert.deepEqual(
    JSON.parse(metadataValue(runtime, "agent_renewal_seed_thread_baseline")),
    {
      operationId: "renewal:crash-window",
      schemaVersion: "vibe64.codex-renewal-thread-baseline.v1",
      threadIds: [],
      workdir: "/repo/worktree"
    }
  );
  assert.equal(metadataValue(runtime, "agent_identity_conversation_id"), undefined);
  assert.deepEqual(
    JSON.parse(metadataValue(runtime, "agent_renewal_seed_thread_claim")),
    JSON.parse(renewalThreadClaim({
      operationId: "renewal:crash-window",
      threadId: "crash-window-thread"
    }))
  );

  runtime.store.mutateSessionForRenewal = originalMutation;
  const metadata = Object.fromEntries(runtime.writes
    .filter((write) => write.kind === "metadata")
    .map((write) => [write.name, write.value]));
  const recovered = await startFreshCodexAppServerThreadForSession({
    operationId: "renewal:crash-window",
    provider,
    runtime,
    session: {
      metadata,
      sessionId: "session-successor"
    },
    workdir: "/repo/worktree"
  });

  assert.equal(starts, 1);
  assert.equal(recovered.fresh, false);
  assert.equal(recovered.threadId, "crash-window-thread");
  assert.equal(metadataValue(runtime, "agent_identity_conversation_id"), "crash-window-thread");
});

test("session renewal adopts its atomic claim after partial identity persistence and a disk restart", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-renewal-thread-restart-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const projectContextRoot = path.join(root, "authority");
  const projectRuntimeRoot = path.join(root, "runtime");
  const workdir = path.join(root, "successor-source");
  await Promise.all([
    mkdir(projectContextRoot, { recursive: true }),
    mkdir(projectRuntimeRoot, { recursive: true }),
    mkdir(workdir, { recursive: true })
  ]);
  const store = createVibe64SessionStore({
    projectContextRoot,
    projectRuntimeRoot,
    projectSessionSourceRoot: path.join(root, "session-sources")
  });
  await store.createSession({ runtimeKind: "genesis", sessionId: "predecessor" });
  await store.quiesceSessionForRenewal({
    renewalId: "renewal-disk-restart",
    sourceSessionId: "predecessor"
  });
  await store.createRenewalPendingSession({
    actorId: "renewal-test-actor",
    confirmedAt: "2026-08-25T00:00:00.000Z",
    renewalId: "renewal-disk-restart",
    renewedFrom: "predecessor",
    runtimeKind: "genesis",
    sessionId: "successor"
  });
  const discoveredThreadIds = [];
  let starts = 0;
  const provider = {
    async ensureRuntime() {
      return appServerRuntime();
    },
    async listAppServerThreadsForCwd({ cwd }) {
      return { cwd, threadIds: [...discoveredThreadIds] };
    },
    async readThread(threadId) {
      return { id: threadId, raw: { cwd: workdir, id: threadId, turns: [] } };
    },
    async resumeThread(threadId) {
      return { id: threadId };
    },
    async startThread() {
      starts += 1;
      discoveredThreadIds.push("durable-crash-window-thread");
      return { id: "durable-crash-window-thread" };
    }
  };
  let failPartialIdentity = true;
  let resolvePartialIdentity;
  const partialIdentityWritten = new Promise((resolve) => {
    resolvePartialIdentity = resolve;
  });
  const crashingStore = {
    ...store,
    async writeMetadataValueForRenewal(sessionId, name, value) {
      if (!failPartialIdentity || [
        "agent_renewal_seed_thread_baseline",
        "agent_renewal_seed_thread_claim"
      ].includes(name)) {
        return store.writeMetadataValueForRenewal(sessionId, name, value);
      }
      if (name === "agent_identity_conversation_id") {
        await store.writeMetadataValueForRenewal(sessionId, name, value);
        resolvePartialIdentity();
        return;
      }
      await partialIdentityWritten;
      const error = new Error("simulated controller death during identity metadata persistence");
      error.code = "simulated_controller_death";
      throw error;
    }
  };

  const successorBeforeCrash = await store.readSessionForRenewal("successor");
  await assert.rejects(
    () => startFreshCodexAppServerThreadForSession({
      operationId: "renewal:disk-restart",
      provider,
      runtime: { store: crashingStore },
      session: successorBeforeCrash,
      workdir
    }),
    (error) => error?.code === "simulated_controller_death"
  );
  assert.equal(starts, 1);
  failPartialIdentity = false;

  const restartedStore = createVibe64SessionStore({
    projectContextRoot,
    projectRuntimeRoot,
    projectSessionSourceRoot: path.join(root, "session-sources")
  });
  const restartedSession = await restartedStore.readSessionForRenewal("successor");
  assert.equal(
    restartedSession.metadata.agent_identity_conversation_id,
    "durable-crash-window-thread"
  );
  assert.equal(restartedSession.metadata.agent_identity_workdir, undefined);
  assert.equal(
    JSON.parse(restartedSession.metadata.agent_renewal_seed_thread_baseline).operationId,
    "renewal:disk-restart"
  );
  assert.deepEqual(
    JSON.parse(restartedSession.metadata.agent_renewal_seed_thread_claim),
    JSON.parse(renewalThreadClaim({
      operationId: "renewal:disk-restart",
      threadId: "durable-crash-window-thread",
      workdir
    }))
  );
  const recovered = await startFreshCodexAppServerThreadForSession({
    operationId: "renewal:disk-restart",
    provider,
    runtime: { store: restartedStore },
    session: restartedSession,
    workdir
  });

  assert.equal(starts, 1);
  assert.equal(recovered.fresh, false);
  assert.equal(recovered.threadId, "durable-crash-window-thread");
  assert.equal(
    (await restartedStore.readSessionForRenewal("successor"))
      .metadata.agent_identity_conversation_id,
    "durable-crash-window-thread"
  );
});

test("session renewal can restart cleanly when its one atomic baseline write fails", async () => {
  const failedRuntime = fakeRuntime();
  failedRuntime.store.writeMetadataValueForRenewal = async () => {
    const error = new Error("simulated atomic metadata write failure");
    error.code = "simulated_atomic_write_failure";
    throw error;
  };
  let starts = 0;
  const provider = {
    ...renewalThreadInventory(),
    async ensureRuntime() {
      return appServerRuntime();
    },
    async readThread(threadId) {
      return { id: threadId, raw: { cwd: "/repo/worktree", id: threadId, turns: [] } };
    },
    async resumeThread(threadId) {
      return { id: threadId };
    },
    async startThread() {
      starts += 1;
      return { id: "thread-after-restart" };
    }
  };

  await assert.rejects(
    () => startFreshCodexAppServerThreadForSession({
      operationId: "renewal:atomic-baseline",
      provider,
      runtime: failedRuntime,
      session: { metadata: {}, sessionId: "session-successor" },
      workdir: "/repo/worktree"
    }),
    (error) => error?.code === "simulated_atomic_write_failure"
  );
  assert.equal(starts, 0);
  assert.equal(metadataValue(failedRuntime, "agent_renewal_seed_thread_baseline"), undefined);

  const restartedRuntime = fakeRuntime();
  const restarted = await startFreshCodexAppServerThreadForSession({
    operationId: "renewal:atomic-baseline",
    provider,
    runtime: restartedRuntime,
    session: { metadata: {}, sessionId: "session-successor" },
    workdir: "/repo/worktree"
  });
  assert.equal(starts, 1);
  assert.equal(restarted.threadId, "thread-after-restart");
  assert.equal(metadataValue(restartedRuntime, "agent_identity_conversation_id"), "thread-after-restart");
});

test("session renewal fails closed when more than one thread appeared after its baseline", async () => {
  let starts = 0;
  const provider = {
    async ensureRuntime() {
      return appServerRuntime();
    },
    async listAppServerThreadsForCwd({ cwd }) {
      return {
        cwd,
        threadIds: ["candidate-one", "candidate-two"]
      };
    },
    async readThread(threadId) {
      return { id: threadId, raw: { cwd: "/repo/worktree", id: threadId, turns: [] } };
    },
    async resumeThread(threadId) {
      return { id: threadId };
    },
    async startThread() {
      starts += 1;
      return { id: "forbidden-extra-thread" };
    }
  };

  await assert.rejects(
    () => startFreshCodexAppServerThreadForSession({
      operationId: "renewal:ambiguous",
      provider,
      runtime: fakeRuntime(),
      session: {
        metadata: {
          agent_renewal_seed_thread_baseline: JSON.stringify({
            operationId: "renewal:ambiguous",
            schemaVersion: "vibe64.codex-renewal-thread-baseline.v1",
            threadIds: [],
            workdir: "/repo/worktree"
          })
        },
        sessionId: "session-successor"
      },
      workdir: "/repo/worktree"
    }),
    (error) => (
      error?.code === "vibe64_session_renewal_fresh_thread_required" &&
      /More than one/u.test(error.message)
    )
  );
  assert.equal(starts, 0);
});

test("session renewal never resumes the predecessor or an unrelated successor thread", async () => {
  const provider = {
    async ensureRuntime() {
      return appServerRuntime();
    },
    async readThread(threadId) {
      return { id: threadId, raw: { cwd: "/repo/worktree", turns: [] } };
    },
    async resumeThread(threadId) {
      return { id: threadId };
    },
    async startThread() {
      return { id: "unused" };
    }
  };
  const runtime = fakeRuntime();

  await assert.rejects(
    () => startFreshCodexAppServerThreadForSession({
      expectedThreadId: "old-main-thread",
      forbiddenThreadId: "old-main-thread",
      operationId: "renewal:one",
      provider,
      runtime,
      session: {
        metadata: {
          agent_identity_conversation_id: "old-main-thread",
          agent_identity_provider: "codex",
          agent_identity_status: "ready",
          agent_identity_workdir: "/repo/worktree",
          agent_renewal_seed_operation_id: "renewal:one",
          agent_transport_id: "codex_app_server"
        },
        sessionId: "session-successor"
      },
      workdir: "/repo/worktree"
    }),
    (error) => error?.code === "vibe64_session_renewal_fresh_thread_required"
  );
  await assert.rejects(
    () => startFreshCodexAppServerThreadForSession({
      expectedThreadId: "expected-successor",
      forbiddenThreadId: "old-main-thread",
      operationId: "renewal:one",
      provider,
      runtime,
      session: {
        metadata: {
          agent_identity_conversation_id: "unrelated-successor",
          agent_identity_provider: "codex",
          agent_identity_status: "ready",
          agent_identity_workdir: "/repo/worktree",
          agent_renewal_seed_operation_id: "renewal:one",
          agent_transport_id: "codex_app_server"
        },
        sessionId: "session-successor"
      },
      workdir: "/repo/worktree"
    }),
    (error) => error?.code === "vibe64_session_renewal_fresh_thread_required"
  );
});
