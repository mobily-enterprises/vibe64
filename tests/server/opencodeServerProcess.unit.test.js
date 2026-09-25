import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  startSupervisedProcess
} from "../../packages/vibe64-execution/src/server/index.js";

import {
  OPENCODE_ECONOMY_AGENT_ID,
  OPENCODE_EPHEMERAL_AGENT_ID,
  OPENCODE_EXPECTED_VERSION,
  createOpenCodeServerProcess,
  openCodeInlineConfig,
  readOpenCodeCatalog,
  readOpenCodeZenModelIds,
  safeOpenCodeEnvironment,
  verifyOpenCodeApiKey
} from "../../packages/vibe64-terminals/src/server/opencodeServerProcess.js";

test("OpenCode Zen discovery reads its current public model ids without credentials", async () => {
  const requests = [];
  const ids = await readOpenCodeZenModelIds({
    async fetchImpl(url, options = {}) {
      requests.push({ options, url: String(url) });
      return new Response(JSON.stringify({
        data: [
          { id: "mimo-v2.5-free", object: "model" },
          { id: "big-pickle", object: "model" }
        ]
      }), { status: 200 });
    }
  });

  assert.deepEqual(ids, ["big-pickle", "mimo-v2.5-free"]);
  assert.equal(requests[0].url, "https://opencode.ai/zen/v1/models");
  assert.deepEqual(requests[0].options.headers, { accept: "application/json" });
  assert.equal(Object.hasOwn(requests[0].options.headers, "authorization"), false);

  await assert.rejects(
    () => readOpenCodeZenModelIds({
      async fetchImpl() {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
    }),
    (error) => (
      error?.code === "vibe64_opencode_zen_catalog_unavailable" &&
      error?.retryable === true &&
      error?.statusCode === 503
    )
  );
});

test("OpenCode cold catalog unlocks complete Zen metadata with only its public identity", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "v64-opencode-cold-catalog-"));
  const privateRoot = path.join(root, "private");
  const workdir = path.join(root, "workdir");
  const starts = [];
  let stopped = 0;
  t.after(() => rm(root, { force: true, recursive: true }));

  const catalog = await readOpenCodeCatalog({
    async createServerProcess(options) {
      starts.push(options);
      assert.deepEqual(JSON.parse(await readFile(
        path.join(privateRoot, "data", "opencode", "auth.json"),
        "utf8"
      )), {
        opencode: { key: "public", type: "api" }
      });
      return {
        client: {
          async agents({ directory }) {
            assert.equal(directory, workdir);
            return [{ hidden: false, mode: "primary", name: "build" }];
          },
          async providers({ directory }) {
            assert.equal(directory, workdir);
            return {
              all: [{
                id: "zai-coding-plan",
                models: { "glm-5.3": { id: "glm-5.3", name: "GLM-5.3" } },
                name: "Z.AI Coding Plan",
                source: "api"
              }],
              default: { "zai-coding-plan": "glm-5.3" }
            };
          }
        },
        async stop() {
          stopped += 1;
          return { exited: true };
        },
        workdir
      };
    },
    privateRoot,
    workdir
  });

  assert.equal(catalog.providers.all[0].id, "zai-coding-plan");
  assert.equal(catalog.providers.default["zai-coding-plan"], "glm-5.3");
  assert.equal(catalog.agents[0].name, "build");
  assert.equal(starts.length, 1);
  assert.deepEqual(starts[0].providerConnections, []);
  assert.equal(starts[0].execution.operationId, "opencode-catalog");
  assert.equal(stopped, 1);
});

test("OpenCode verifies API keys with one bounded pure no-tools turn", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "v64-opencode-verify-key-"));
  const privateRoot = path.join(root, "private");
  const workdir = path.join(root, "workdir");
  const requests = [];
  t.after(() => rm(root, { force: true, recursive: true }));

  const result = await verifyOpenCodeApiKey({
    apiKey: "zai-private-key",
    async commandRunner(request) {
      requests.push(request);
      const auth = JSON.parse(await readFile(
        path.join(request.credentialHome.dataRoot, "opencode", "auth.json"),
        "utf8"
      ));
      assert.deepEqual(auth, {
        zai: { key: "zai-private-key", type: "api" }
      });
      return { ok: true, stdout: '{"type":"text","text":"OK"}\n' };
    },
    modelId: "glm-4.7-flash",
    modelProviderId: "zai",
    privateRoot,
    workdir
  });

  assert.deepEqual(result, { ok: true });
  assert.equal(requests.length, 1);
  const [request] = requests;
  assert.deepEqual(request.args, [
    "run",
    "--pure",
    "--agent",
    OPENCODE_ECONOMY_AGENT_ID,
    "--model",
    "zai/glm-4.7-flash",
    "--format",
    "json",
    "Reply only OK."
  ]);
  assert.equal(request.inheritProcessEnv, false);
  assert.equal(request.maxBuffer, 256 * 1024);
  assert.equal(request.timeout, 30_000);
  assert.equal(request.baseEnv.OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX, "16");
  assert.equal(JSON.stringify(request.baseEnv).includes("zai-private-key"), false);
  assert.equal(request.execution.lifecycle, "finite");
  assert.equal(request.execution.operationId, "opencode-catalog");
  await assert.rejects(access(privateRoot), { code: "ENOENT" });
});

test("OpenCode API-key verification sanitizes provider failures and removes credentials", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "v64-opencode-verify-failure-"));
  const privateRoot = path.join(root, "private");
  t.after(() => rm(root, { force: true, recursive: true }));

  await assert.rejects(
    () => verifyOpenCodeApiKey({
      apiKey: "must-not-surface",
      async commandRunner() {
        return {
          error: "401 key must-not-surface rejected",
          ok: false,
          stderr: "must-not-surface"
        };
      },
      modelId: "glm-4.7-flash",
      modelProviderId: "zai",
      privateRoot,
      workdir: path.join(root, "workdir")
    }),
    (error) => (
      error?.code === "vibe64_opencode_key_verification_failed" &&
      error.statusCode === 422 &&
      !String(error.message).includes("must-not-surface")
    )
  );
  await assert.rejects(access(privateRoot), { code: "ENOENT" });

  await assert.rejects(
    () => verifyOpenCodeApiKey({
      apiKey: "must-not-surface",
      async commandRunner() {
        return {
          error: "managed helper failed with must-not-surface",
          exitCode: 2,
          ok: false
        };
      },
      modelId: "glm-4.7-flash",
      modelProviderId: "zai",
      privateRoot,
      workdir: path.join(root, "workdir")
    }),
    (error) => (
      error?.code === "vibe64_opencode_key_verification_unavailable" &&
      error.statusCode === 503 &&
      error.retryable === true &&
      !String(error.message).includes("must-not-surface")
    )
  );
  await assert.rejects(access(privateRoot), { code: "ENOENT" });
});

test("OpenCode process environment is minimal and injects Vibe64's deny-all helper agent", () => {
  const env = safeOpenCodeEnvironment({
    ANTHROPIC_API_KEY: "must-not-leak",
    DEEPSEEK_API_KEY: "must-not-leak",
    LANG: "en_AU.UTF-8",
    npm_config_cache: "/host/npm-cache",
    npm_config_userconfig: "/host/private-npmrc",
    OPENCODE_CONFIG_CONTENT: '{"agent":{"vibe64-economy":{"permission":"allow"}}}',
    PATH: "/usr/bin",
    RANDOM_APPLICATION_SECRET: "must-not-leak"
  }, {
    cacheRoot: "/private/cache",
    dbPath: "/state/opencode.sqlite",
    hostContextResolver: "/managed/vibe64-genesis-host-context",
    managedEnv: {
      PATH: "/must/not/replace/path",
      VIBE64_AGENT_ENV_SOCKET: "/run/vibe64/agent.sock",
      VIBE64_GIT_COMMAND_SOCKET: "/run/vibe64/git.sock"
    },
    password: "loopback-password",
    privateRoot: "/private/session",
    sessionEnvironmentRegistry: "/run/vibe64/opencode-sessions.json",
    shimDirs: ["relative-shim", "/managed/shims"]
  });

  assert.equal(env.ANTHROPIC_API_KEY, undefined);
  assert.equal(env.GENESIS_TURN_CONTEXT_ENABLED, "0");
  assert.equal(env.GENESIS_SESSION_CONTEXT_INSTALLED, undefined);
  assert.equal(env.DEEPSEEK_API_KEY, undefined);
  assert.equal(env.RANDOM_APPLICATION_SECRET, undefined);
  assert.equal(env.LANG, "en_AU.UTF-8");
  assert.equal(env.npm_config_cache, "/private/cache/npm");
  assert.equal(env.npm_config_prefer_offline, "true");
  assert.equal(env.npm_config_userconfig, undefined);
  assert.equal(env.HOME, "/private/session/home");
  assert.equal(env.XDG_CONFIG_HOME, "/private/session/config");
  assert.equal(env.XDG_DATA_HOME, "/private/session/data");
  assert.equal(env.PATH, "/managed/shims:/usr/bin");
  assert.equal(env.VIBE64_AGENT_ENV_SOCKET, "/run/vibe64/agent.sock");
  assert.equal(env.VIBE64_GIT_COMMAND_SOCKET, "/run/vibe64/git.sock");
  assert.equal(env.OPENCODE_DB, "/state/opencode.sqlite");
  assert.equal(env.OPENCODE_SERVER_PASSWORD, "loopback-password");
  assert.equal(env.OPENCODE_DISABLE_PROJECT_CONFIG, undefined);
  assert.equal(env.OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX, "131072");
  assert.equal(env.OPENCODE_PURE, undefined);
  assert.equal(
    env.VIBE64_OPENCODE_SESSION_ENV_REGISTRY,
    "/run/vibe64/opencode-sessions.json"
  );

  const config = JSON.parse(env.OPENCODE_CONFIG_CONTENT);
  assert.equal(config.plugin.length, 1);
  assert.match(config.plugin[0], /^file:.*opencodeSessionEnvironmentPlugin\.js$/u);
  assert.deepEqual(config.agent[OPENCODE_ECONOMY_AGENT_ID], {
    description: "Vibe64 bounded helper turns without tools.",
    hidden: true,
    mode: "primary",
    permission: { "*": "deny" }
  });
  assert.deepEqual(config.permission, {
    doom_loop: "deny",
    external_directory: "deny",
    question: "deny",
    read: {
      "*.env": "deny",
      "*.env.*": "deny",
      "*.env.example": "allow"
    }
  });
  assert.equal(config.snapshot, false);
});

test("non-project OpenCode tools stay behind approval and require the execution guard", () => {
  const unguarded = JSON.parse(openCodeInlineConfig());
  assert.equal(unguarded.agent[OPENCODE_EPHEMERAL_AGENT_ID].permission["*"], "deny");
  assert.equal(unguarded.plugin, undefined);

  const guarded = JSON.parse(openCodeInlineConfig({ sessionEnvironmentRegistry: "/private/sessions.json" }));
  assert.equal(guarded.agent[OPENCODE_EPHEMERAL_AGENT_ID].permission["*"], "ask");
  assert.equal(guarded.plugin.length, 1);
  assert.match(guarded.plugin[0], /opencodeSessionEnvironmentPlugin\.js$/u);
  assert.equal(guarded.agent[OPENCODE_ECONOMY_AGENT_ID].permission["*"], "deny");
});

test("OpenCode forces Z.AI API and Coding Plan through distinct canonical billing routes", () => {
  const standard = JSON.parse(openCodeInlineConfig({
    canonicalUrl: "https://api.z.ai/api/paas/v4",
    modelProviderId: "zai"
  }));
  const codingPlan = JSON.parse(openCodeInlineConfig({
    canonicalUrl: "https://api.z.ai/api/coding/paas/v4",
    modelProviderId: "zai-coding-plan"
  }));

  assert.deepEqual(Object.keys(standard.provider), ["zai"]);
  assert.equal(
    standard.provider.zai.options.baseURL,
    "https://api.z.ai/api/paas/v4"
  );
  assert.deepEqual(Object.keys(codingPlan.provider), ["zai-coding-plan"]);
  assert.equal(
    codingPlan.provider["zai-coding-plan"].options.baseURL,
    "https://api.z.ai/api/coding/paas/v4"
  );
  assert.notDeepEqual(standard.provider, codingPlan.provider);
});

test("OpenCode uses native provider routes when no URL override is supplied", () => {
  const native = JSON.parse(openCodeInlineConfig({
    modelProviderId: "zai",
    providerConnections: [{
      apiKey: "not-written-to-config",
      modelProviderId: "zai-coding-plan"
    }]
  }));
  const overridden = JSON.parse(openCodeInlineConfig({
    providerConnections: [
      { modelProviderId: "zai" },
      {
        canonicalUrl: "https://gateway.example.test/v1",
        modelProviderId: "private-zai"
      }
    ]
  }));

  assert.equal(native.provider, undefined);
  assert.deepEqual(Object.keys(overridden.provider), ["private-zai"]);
  assert.equal(
    overridden.provider["private-zai"].options.baseURL,
    "https://gateway.example.test/v1"
  );
  assert.equal(JSON.stringify(native).includes("not-written-to-config"), false);
});

test("OpenCode injects one low-cost subagent per configured provider economy model", () => {
  const config = JSON.parse(openCodeInlineConfig({
    providerConnections: [
      { economyModelId: "glm-5.3-flash", modelProviderId: "zai-coding-plan" },
      { economyModelId: "deepseek-v4-flash", modelProviderId: "deepseek" },
      { modelProviderId: "anthropic" }
    ]
  }));

  assert.deepEqual(config.agent["vibe64-economy-zai-coding-plan"], {
    description: "Vibe64 low-cost helper on the zai-coding-plan connection for delegating simple, inexpensive work.",
    mode: "subagent",
    model: "zai-coding-plan/glm-5.3-flash"
  });
  assert.deepEqual(config.agent["vibe64-economy-deepseek"], {
    description: "Vibe64 low-cost helper on the deepseek connection for delegating simple, inexpensive work.",
    mode: "subagent",
    model: "deepseek/deepseek-v4-flash"
  });
  assert.equal(config.agent["vibe64-economy-anthropic"], undefined);
  assert.equal(config.agent[OPENCODE_ECONOMY_AGENT_ID].hidden, true);
  assert.equal(Object.keys(config.agent).length, 4);
});

test("OpenCode route configuration contains one provider and no inherited provider keys", () => {
  const env = safeOpenCodeEnvironment({
    ANTHROPIC_API_KEY: "must-not-leak",
    DEEPSEEK_API_KEY: "must-not-leak",
    OPENAI_API_KEY: "must-not-leak",
    ZHIPU_API_KEY: "must-not-leak"
  }, {
    canonicalUrl: "https://api.z.ai/api/coding/paas/v4",
    dbPath: "/state/opencode.sqlite",
    modelProviderId: "zai-coding-plan",
    password: "loopback-password",
    privateRoot: "/private/session"
  });
  const config = JSON.parse(env.OPENCODE_CONFIG_CONTENT);

  assert.deepEqual(Object.keys(config.provider), ["zai-coding-plan"]);
  assert.equal(
    config.provider["zai-coding-plan"].options.baseURL,
    "https://api.z.ai/api/coding/paas/v4"
  );
  assert.equal(env.OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX, undefined);
  for (const name of [
    "ANTHROPIC_API_KEY",
    "DEEPSEEK_API_KEY",
    "OPENAI_API_KEY",
    "ZHIPU_API_KEY"
  ]) {
    assert.equal(env[name], undefined);
  }
  assert.equal(JSON.stringify(env).includes("must-not-leak"), false);
});

test("OpenCode child cleanup terminates its detached process group", async () => {
  const supervised = await startSupervisedProcess({
    args: [
      "--input-type=module",
      "--eval",
      "setInterval(() => {}, 1000)"
    ],
    command: process.execPath,
    env: process.env,
    stopTimeoutMs: 2_000
  });
  const result = await supervised.stop();
  assert.equal(result.exited, true);
  assert.equal(result.signal, "SIGTERM");
});

test("OpenCode servers run and drain through one managed execution id", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "v64-opencode-managed-"));
  const privateRoot = path.join(root, "private");
  const requests = [];
  const stops = [];
  const executionId = "11111111-1111-4111-8111-111111111111";
  t.after(() => rm(root, { force: true, recursive: true }));

  const server = await createOpenCodeServerProcess({
    commandRunner: async (request) => {
      requests.push(request);
      if (request.mode === "pty") {
        return {
          commandPreview: request.terminal.commandPreview,
          id: "opencode-terminal-1",
          ok: true,
          status: "running"
        };
      }
      return {
        execution: { ...request.execution, id: executionId },
        ok: true,
        pid: 4242
      };
    },
    dbPath: path.join(root, "state", "opencode.db"),
    env: {
      ANTHROPIC_API_KEY: "must-not-leak",
      GENESIS_PARSER_ROOT: "/release/genesis-parsers",
      GENESIS_PARSER_AUTO_INSTALL: "0",
      LANG: "en_AU.UTF-8",
      PATH: "/usr/bin"
    },
    execution: {
      ownerId: "session-1",
      projectSlug: "catalogue",
      sessionId: "session-1"
    },
    expectedVersion: OPENCODE_EXPECTED_VERSION,
    fetchImpl: async (url) => {
      assert.equal(new URL(url).pathname, "/global/health");
      return new Response(JSON.stringify({
        healthy: true,
        version: OPENCODE_EXPECTED_VERSION
      }), {
        headers: { "content-type": "application/json" },
        status: 200
      });
    },
    port: 43210,
    privateRoot,
    stopExecution: async (id, options) => {
      stops.push({ id, options });
      return { executionId: id, ok: true, scopeEmpty: true, stopped: true };
    },
    workdir: root
  });

  assert.equal(requests.length, 1);
  const [request] = requests;
  assert.equal(request.mode, "detached");
  assert.equal(request.purpose, "assistant");
  assert.equal(request.inheritProcessEnv, false);
  assert.equal(request.execution.kind, "assistant");
  assert.equal(request.execution.lifecycle, "service");
  assert.equal(request.execution.ownerId, "session-1");
  assert.equal(request.execution.projectSlug, "catalogue");
  assert.equal(request.execution.sessionId, "session-1");
  assert.equal(request.args.includes("--pure"), false);
  assert.equal(request.baseEnv.OPENCODE_DISABLE_PROJECT_CONFIG, undefined);
  assert.equal(request.baseEnv.OPENCODE_PURE, undefined);
  assert.match(
    request.args[1],
    /export VIBE64_CODEX_GIT_COMMAND_NO_STDIN_PARENT_PID=\$\$/u
  );
  assert.match(request.args[1], /exec "\$@" <\/dev\/null/u);
  assert.equal(request.baseEnv.ANTHROPIC_API_KEY, undefined);
  assert.equal(request.baseEnv.GENESIS_PARSER_ROOT, "/release/genesis-parsers");
  assert.equal(request.baseEnv.GENESIS_PARSER_AUTO_INSTALL, "0");
  assert.equal(request.baseEnv.OPENCODE_DB, path.join(root, "state", "opencode.db"));
  assert.equal(request.baseEnv.npm_config_cache, path.join(privateRoot, "cache", "npm"));
  assert.equal(request.credentialHome.home, path.join(privateRoot, "home"));
  assert.equal(server.executionId, executionId);

  const attached = await server.startAttachedTerminal({
    metadata: { sessionId: "session-1" },
    namespace: "vibe64-opencode:project:session-1",
    session: { sessionId: "session-1" },
    upstreamSessionId: "ses_vibe64_session_1",
    workdir: root
  });
  assert.equal(attached.id, "opencode-terminal-1");
  assert.equal(requests.length, 2);
  const terminalRequest = requests[1];
  assert.equal(terminalRequest.mode, "pty");
  assert.equal(terminalRequest.command, "opencode");
  assert.deepEqual(terminalRequest.args, [
    "attach",
    "http://127.0.0.1:43210",
    "--dir",
    root,
    "--session",
    "ses_vibe64_session_1",
    "--pure"
  ]);
  assert.equal(terminalRequest.baseEnv.OPENCODE_SERVER_PASSWORD, request.baseEnv.OPENCODE_SERVER_PASSWORD);
  assert.equal(terminalRequest.args.includes(terminalRequest.baseEnv.OPENCODE_SERVER_PASSWORD), false);
  assert.equal(terminalRequest.inheritProcessEnv, false);
  assert.equal(terminalRequest.execution.kind, "terminal");
  assert.equal(terminalRequest.execution.lifecycle, "interactive");
  assert.equal(terminalRequest.execution.sessionId, "session-1");
  assert.equal(terminalRequest.terminal.namespace, "vibe64-opencode:project:session-1");
  assert.equal(terminalRequest.terminal.reuseRunning, true);

  const proof = await server.stop();
  assert.equal(proof.exited, true);
  assert.deepEqual(stops, [{
    id: executionId,
    options: {
      allowMissingRecordScopeRecovery: true,
      reason: "opencode-server-stop",
      termTimeoutMs: 3000
    }
  }]);
  await assert.rejects(access(privateRoot), { code: "ENOENT" });
});
