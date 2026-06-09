import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";

import {
  Vibe64SessionRuntime
} from "@local/vibe64-runtime/server";
import {
  TargetAdapter,
  adapterProjectFacts
} from "@local/vibe64-adapters/server";
import {
  createService
} from "../../packages/vibe64-terminals/src/server/service.js";
import {
  ACTION_START_SESSION_TERMINAL_FIX,
  ACTION_START_SHELL_TERMINAL,
  featureActions as terminalFeatureActions
} from "../../packages/vibe64-terminals/src/server/actions.js";
import {
  sessionTerminalFixInputValidator
} from "../../packages/vibe64-terminals/src/server/inputSchemas.js";
import {
  sessionTerminalFailureFixInputValidator
} from "../../packages/vibe64-sessions/src/server/inputSchemas.js";
import {
  codexRemoteEndpointForWorkdir,
  createCodexTerminalController,
  codexTerminalArgs
} from "../../packages/vibe64-terminals/src/server/codexTerminal.js";
import {
  createFixCodexJobStore,
  prepareFixCodexReportHelper
} from "../../packages/vibe64-terminals/src/server/fixCodexJobs.js";
import {
  COMMAND_RESULT_ENV
} from "../../packages/vibe64-terminals/src/server/commandTerminalResults.js";
import {
  commandTerminalArgs,
  createCommandTerminalController
} from "../../packages/vibe64-terminals/src/server/commandTerminal.js";
import {
  launchActionsFromOutput
} from "../../packages/vibe64-terminals/src/server/launchTargetTerminal.js";
import {
  codexTerminalNamespace,
  fixCodexTerminalNamespace,
  globalCodexTerminalNamespace
} from "../../packages/vibe64-terminals/src/server/terminalShared.js";
import {
  resolveShellTerminalCwd,
  shellTerminalArgs
} from "../../packages/vibe64-terminals/src/server/shellTerminal.js";
import {
  closeTerminalSession,
  countRunningTerminalSessions,
  startTerminalSession
} from "@local/studio-terminal-core/server/terminalSessions";
import {
  resolveTerminalToolchainImage
} from "../../packages/vibe64-terminals/src/server/terminalToolchainImage.js";
import {
  maskedTerminalDockerArgs,
  projectTerminalEnvironment
} from "../../packages/vibe64-terminals/src/server/terminalEnvironment.js";
import {
  CppTargetAdapter
} from "@local/vibe64-adapters/server/adapters/cpp/adapter";
import {
  CPP_TOOLCHAIN_IMAGE
} from "@local/vibe64-adapters/server/adapters/cpp/toolchainIdentity";
import {
  JskitTargetAdapter
} from "@local/vibe64-adapters/server/adapters/jskit/adapter";
import {
  JSKIT_TOOLCHAIN_IMAGE
} from "@local/vibe64-adapters/server/adapters/jskit/toolchainIdentity";
import {
  JSKIT_MARIADB_HOST,
  JSKIT_MARIADB_ROOT_PASSWORD
} from "@local/vibe64-adapters/server/adapters/jskit/setupMariaDbRuntime";
import {
  LaravelTargetAdapter
} from "@local/vibe64-adapters/server/adapters/laravel/adapter";
import {
  LARAVEL_TOOLCHAIN_IMAGE
} from "@local/vibe64-adapters/server/adapters/laravel/toolchainIdentity";
import {
  STUDIO_BASE_TOOLCHAIN_IMAGE,
  STUDIO_MANAGED_TOOLCHAIN_DOCKER_RUN_PULL_ARGS,
  STUDIO_PLAYWRIGHT_BROWSERS_PATH,
  STUDIO_PLAYWRIGHT_BROWSERS_VOLUME,
  STUDIO_TOOL_HOME_BIN_PATH,
  STUDIO_TOOL_HOME_NPM_PREFIX,
  STUDIO_TOOL_HOME_PATH
} from "@local/studio-terminal-core/server/studioRuntimeIdentity";
import {
  STUDIO_MYSQL_CLIENT_CONFIG_DIR
} from "@local/studio-terminal-core/server/studioToolHome";
import {
  githubSshToHttpsGitEnv
} from "@local/studio-terminal-core/server/gitGithubTransport";
import {
  runtimeNetworkName
} from "@local/studio-terminal-core/server/runtimeContainers";
import { withTemporaryRoot } from "./vibe64TestHelpers.js";
import {
  assertDockerEnv,
  assertDockerVolumeMount,
  dockerEnvValue
} from "./dockerArgsTestHelpers.js";

const POST_COMMIT_TEST_TIMEOUT_MS = 500;

class UnitCommandAdapter extends TargetAdapter {
  constructor() {
    super({
      id: "unit",
      label: "Unit adapter"
    });
  }

  async inspect() {
    return adapterProjectFacts({
      capabilities: {
        unit_command: true
      },
      commands: [
        {
          id: "unit_command",
          label: "Unit command"
        }
      ],
      summary: "Unit adapter"
    });
  }

  async listCommands({ facts = {} } = {}) {
    return facts.commands || [];
  }

  async createCommandTerminalSpec(_commandId, context = {}) {
    return {
      args: [
        "-lc",
        [
          "set -e",
          "printf 'fact:set\\t%s\\t%s\\n' dynamic_done \"$(printf '%s' from-result-file | base64 | tr -d '\\n')\" >> \"$VIBE64_COMMAND_RESULT_FILE\""
        ].join("\n")
      ],
      applySuccessFacts({ facts }) {
        return {
          deleteMetadata: ["stale_value"],
          metadata: {
            dynamic_done: facts.dynamic_done
          }
        };
      },
      command: "bash",
      commandPreview: "bash command result",
      cwd: context.session?.targetRoot,
      ok: true,
      successMessage: "Unit command completed.",
      successMetadata: {
        terminal_done: "yes"
      }
    };
  }
}

test("launch terminal actions are parsed only from the first output lines", () => {
  const output = [
    "\u001b[32m[studio] action:http://127.0.0.1:4100/home\u001b[0m",
    "[studio] action:url:http://127.0.0.1:4100/home",
    "plain log",
    "plain log",
    "plain log",
    "plain log",
    "plain log",
    "plain log",
    "plain log",
    "plain log",
    "[studio] action:http://127.0.0.1:9999/too-late"
  ].join("\n");

  const actions = launchActionsFromOutput(output);

  assert.equal(actions.length, 1);
  assert.equal(actions[0].href, "http://127.0.0.1:4100/home");
  assert.match(actions[0].id, /^url-/u);
  assert.equal(actions[0].kind, "url");
  assert.equal(actions[0].label, "127.0.0.1:4100");
});

function assertPlaywrightBrowserCache(args) {
  assertDockerVolumeMount(args, STUDIO_PLAYWRIGHT_BROWSERS_VOLUME, STUDIO_PLAYWRIGHT_BROWSERS_PATH);
  assertDockerEnv(args, "PLAYWRIGHT_BROWSERS_PATH", STUDIO_PLAYWRIGHT_BROWSERS_PATH);
}

function deferred() {
  let resolve = () => null;
  const promise = new Promise((next) => {
    resolve = next;
  });
  return {
    promise,
    resolve
  };
}

async function waitForArrayLength(entries, expectedLength, timeoutMs = POST_COMMIT_TEST_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (entries.length < expectedLength && Date.now() < deadline) {
    await delay(5);
  }
  assert.equal(entries.length, expectedLength);
}

async function waitForNoRunningTerminals(namespace, timeoutMs = POST_COMMIT_TEST_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (countRunningTerminalSessions({ namespace }) > 0 && Date.now() < deadline) {
    await delay(5);
  }
  assert.equal(countRunningTerminalSessions({ namespace }), 0);
}

function runNodeScript(scriptPath = "", args = [], env = {}, stdin = "") {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      scriptPath,
      ...args
    ], {
      env: {
        ...process.env,
        ...env
      },
      stdio: [
        "pipe",
        "pipe",
        "pipe"
      ]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.stdin.end(stdin);
    child.once("error", reject);
    child.once("exit", (code) => {
      resolve({
        code,
        stderr,
        stdout
      });
    });
  });
}

test("Vibe64 Codex terminal joins the target runtime network before the image", () => {
  const targetRoot = "/workspace/project";
  const args = codexTerminalArgs({
    codexThreadId: "",
    containerName: "vibe64-codex-unit",
    sessionId: "unit-session",
    targetRoot,
    terminalId: "unit-terminal",
    worktree: "/workspace/project/.vibe64/sessions/active/unit/worktree"
  });

  assert.deepEqual(args.slice(0, 1 + STUDIO_MANAGED_TOOLCHAIN_DOCKER_RUN_PULL_ARGS.length), [
    "run",
    ...STUDIO_MANAGED_TOOLCHAIN_DOCKER_RUN_PULL_ARGS
  ]);
  assertPlaywrightBrowserCache(args);
  const networkIndex = args.indexOf("--network");
  assert.notEqual(networkIndex, -1);
  assert.deepEqual(args.slice(networkIndex, networkIndex + 2), ["--network", runtimeNetworkName(targetRoot)]);
  assert.ok(networkIndex < args.indexOf(STUDIO_BASE_TOOLCHAIN_IMAGE));

  const startupScript = args.at(-1);
  assert.ok(startupScript.includes(`export HOME=${STUDIO_TOOL_HOME_PATH}`));
  assert.ok(startupScript.includes(`export NPM_CONFIG_PREFIX=${STUDIO_TOOL_HOME_NPM_PREFIX}`));
  assert.ok(startupScript.includes(`export PATH=${STUDIO_TOOL_HOME_BIN_PATH}:$PATH`));
  assert.match(startupScript, /chown -R "\$VIBE64_HOST_UID:\$VIBE64_HOST_GID" "\$HOME"/u);
  assert.ok(args.includes(`NPM_CONFIG_PREFIX=${STUDIO_TOOL_HOME_NPM_PREFIX}`));

  const adapterImageArgs = codexTerminalArgs({
    codexThreadId: "",
    containerName: "vibe64-codex-adapter",
    env: {
      MYSQL_HOST: JSKIT_MARIADB_HOST,
      MYSQL_PWD: JSKIT_MARIADB_ROOT_PASSWORD,
      PLAYWRIGHT_BROWSERS_PATH: "/tmp/project-playwright"
    },
    image: "adapter-toolchain:1.0.0",
    sessionId: "unit-session",
    targetRoot,
    terminalId: "adapter-terminal",
    worktree: "/workspace/project/.vibe64/sessions/active/unit/worktree"
  });
  assertPlaywrightBrowserCache(adapterImageArgs);
  assert.ok(adapterImageArgs.indexOf("--network") < adapterImageArgs.indexOf("adapter-toolchain:1.0.0"));
  assert.ok(adapterImageArgs.includes(`MYSQL_PWD=${JSKIT_MARIADB_ROOT_PASSWORD}`));
  assert.ok(maskedTerminalDockerArgs(adapterImageArgs).includes("MYSQL_PWD=*****"));
  assert.ok(!maskedTerminalDockerArgs(adapterImageArgs).includes(`MYSQL_PWD=${JSKIT_MARIADB_ROOT_PASSWORD}`));
});

test("Vibe64 global Codex terminal args use the project root without a session token", () => {
  const targetRoot = "/workspace/project";
  const args = codexTerminalArgs({
    codexThreadId: "",
    containerName: "vibe64-codex-global",
    sessionId: "",
    targetRoot,
    terminalId: "global-terminal",
    worktree: targetRoot
  });

  assert.notEqual(globalCodexTerminalNamespace(), codexTerminalNamespace("global"));
  assert.equal(args.some((arg) => String(arg).startsWith("vibe64.session=")), false);
  assert.equal(args.at(args.indexOf("-w") + 1), targetRoot);
  assert.doesNotMatch(args.at(-1), /resume [0-9a-f-]{36}/u);
});

test("Vibe64 global Codex terminal state resolves target root from project service APIs", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const terminal = startTerminalSession({
      args: [
        "-e",
        "process.stdin.resume(); setInterval(() => {}, 1000);"
      ],
      command: process.execPath,
      commandPreview: "codex",
      metadata: {
        scope: "global",
        targetRoot,
        workdir: targetRoot
      },
      namespace: globalCodexTerminalNamespace()
    });
    assert.equal(terminal.ok, true);

    const terminalService = createService({
      projectService: {
        async readProjectType() {
          return {
            ok: true,
            projectType: {
              targetRoot
            }
          };
        }
      }
    });

    try {
      const state = await terminalService.globalCodexTerminalState();
      assert.equal(state.ok, true);
      assert.equal(state.globalCodexTerminal.id, terminal.id);
      assert.equal(state.globalCodexTerminal.status, "running");
    } finally {
      await closeTerminalSession(terminal.id, {
        namespace: globalCodexTerminalNamespace()
      });
    }
  });
});

test("Vibe64 Codex terminal startup only renders the resumable CLI", () => {
  const args = codexTerminalArgs({
    codexThreadId: "",
    containerName: "vibe64-codex-startup",
    sessionId: "startup_prompt",
    targetRoot: "/workspace/project",
    terminalId: "startup-terminal",
    worktree: "/workspace/project/.vibe64/sessions/active/startup_prompt/worktree"
  });
  const startupScript = args.at(-1);
  assert.match(startupScript, /codex/u);
  assert.doesNotMatch(startupScript, /Vibe64 session briefing/u);
  assert.doesNotMatch(startupScript, /Unit MariaDB/u);
  assert.doesNotMatch(startupScript, /resume [0-9a-f-]{36}/u);

  const resumedArgs = codexTerminalArgs({
    codexThreadId: "00000000-0000-4000-8000-000000000001",
    containerName: "vibe64-codex-startup-resume",
    sessionId: "startup_prompt",
    targetRoot: "/workspace/project",
    terminalId: "startup-terminal",
    worktree: "/workspace/project/.vibe64/sessions/active/startup_prompt/worktree"
  });
  assert.match(
    resumedArgs.at(-1),
    /resume 00000000-0000-4000-8000-000000000001/u
  );
  assert.doesNotMatch(resumedArgs.at(-1), /Vibe64 session briefing/u);

  const remoteResumedArgs = codexTerminalArgs({
    codexRemoteEndpoint: "unix:///vibe64-codex-app-server/app-server.sock",
    codexThreadId: "00000000-0000-4000-8000-000000000001",
    containerName: "vibe64-codex-startup-remote-resume",
    sessionId: "startup_prompt",
    targetRoot: "/workspace/project",
    terminalId: "startup-terminal",
    mounts: [
      {
        source: "/tmp/vibe64/agent-providers/codex-app-server",
        target: "/vibe64-codex-app-server"
      }
    ],
    worktree: "/workspace/project/.vibe64/sessions/active/startup_prompt/worktree"
  });
  assert.match(
    remoteResumedArgs.at(-1),
    /--remote unix:\/\/\/vibe64-codex-app-server\/app-server\.sock .*resume 00000000-0000-4000-8000-000000000001/u
  );
  assert.ok(remoteResumedArgs.includes("/tmp/vibe64/agent-providers/codex-app-server:/vibe64-codex-app-server"));

  const invalidThreadArgs = codexTerminalArgs({
    codexThreadId: "not-a-thread-id",
    containerName: "vibe64-codex-startup-invalid-thread",
    sessionId: "startup_prompt",
    targetRoot: "/workspace/project",
    terminalId: "startup-terminal",
    worktree: "/workspace/project/.vibe64/sessions/active/startup_prompt/worktree"
  });
  assert.doesNotMatch(invalidThreadArgs.at(-1), /resume [0-9a-f-]{36}/u);
});

test("Vibe64 Codex terminal resumes the app-server thread for the same workdir", () => {
  const workdir = "/workspace/project/.vibe64/sessions/active/session-1/worktree";
  const session = {
    metadata: {
      agent_identity_conversation_id: "00000000-0000-4000-8000-000000000005",
      agent_identity_provider: "codex",
      agent_identity_resume_strategy: "provider-native",
      agent_identity_status: "ready",
      agent_identity_workdir: workdir,
      codex_app_server_container_endpoint: "unix:///vibe64-codex-app-server/app-server.sock",
      codex_app_server_endpoint: "unix:///tmp/vibe64/agent-providers/codex-app-server/app-server.sock",
      codex_thread_id: "00000000-0000-4000-8000-000000000005",
      codex_workdir: workdir
    },
    sessionId: "session-1"
  };

  assert.equal(
    codexRemoteEndpointForWorkdir(session, workdir),
    "unix:///vibe64-codex-app-server/app-server.sock"
  );

  const args = codexTerminalArgs({
    codexRemoteEndpoint: codexRemoteEndpointForWorkdir(session, workdir),
    codexThreadId: session.metadata.agent_identity_conversation_id,
    containerName: "vibe64-codex-app-server-resume",
    sessionId: "session-1",
    targetRoot: "/workspace/project",
    terminalId: "terminal-1",
    worktree: workdir
  });
  assert.match(
    args.at(-1),
    /codex --remote unix:\/\/\/vibe64-codex-app-server\/app-server\.sock .*resume 00000000-0000-4000-8000-000000000005/u
  );

  assert.equal(
    codexRemoteEndpointForWorkdir(session, "/workspace/project/other"),
    ""
  );
});

test("Vibe64 Codex terminal mounts linked git metadata for worktree roots", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const linkedRepository = path.join(path.dirname(targetRoot), "linked-repository");
    await mkdir(path.join(linkedRepository, ".git"), {
      recursive: true
    });
    await writeFile(path.join(targetRoot, ".git"), `gitdir: ${path.join(linkedRepository, ".git")}\n`);

    const args = codexTerminalArgs({
      codexThreadId: "",
      containerName: "vibe64-codex-linked-git",
      sessionId: "unit-session",
      targetRoot,
      terminalId: "unit-terminal",
      worktree: path.join(targetRoot, ".vibe64", "sessions", "active", "unit", "worktree")
    });

    assert.ok(args.includes(`${linkedRepository}:${linkedRepository}`));
  });
});

test("Vibe64 Codex terminal state uses app-server turn state, not terminal metadata", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "codex_turn_state";
    const sessionRoot = path.join(targetRoot, ".vibe64", "sessions", "active", sessionId);
    const worktree = path.join(sessionRoot, "worktree");
    await mkdir(worktree, {
      recursive: true
    });
    const session = {
      completedSteps: ["worktree_created"],
      metadata: {
        codex_app_server_turn_state: "idle",
        worktree_path: worktree
      },
      sessionId,
      sessionRoot,
      targetRoot
    };
    const namespace = codexTerminalNamespace(sessionId);
    const terminal = startTerminalSession({
      args: [
        "-e",
        "process.stdin.resume(); setInterval(() => {}, 1000);"
      ],
      command: process.execPath,
      commandPreview: "codex",
      metadata: {
        codexTurnAttentionMessage: "stale terminal attention",
        codexTurnAttentionReason: "quiet_timeout",
        codexTurnState: "transmitting",
        targetRoot,
        workdir: worktree
      },
      namespace
    });
    assert.equal(terminal.ok, true);

    const terminalService = createService({
      projectService: {
        targetRoot,
        async createRuntime() {
          return {
            async getSession() {
              return session;
            }
          };
        }
      }
    });

    try {
      let state = await terminalService.codexTerminalState(sessionId);
      assert.equal(state.codexTerminal.status, "running");
      assert.equal(state.codexTerminal.transmitting, undefined);
      assert.equal(state.codexTerminal.attentionRequired, undefined);
      assert.equal(state.codexAgentTurnActive, false);
      assert.equal(state.codexAgentTurn.state, "idle");

      session.metadata.codex_app_server_turn_state = "active";
      session.metadata.codex_app_server_turn_status = "inProgress";
      session.metadata.codex_app_server_turn_thread_id = "00000000-0000-4000-8000-000000000010";
      session.metadata.codex_app_server_turn_id = "turn-1";
      state = await terminalService.codexTerminalState(sessionId);
      assert.equal(state.codexAgentTurnActive, true);
      assert.equal(state.codexAgentTurn.state, "active");
      assert.equal(state.codexAgentTurn.status, "inProgress");
      assert.equal(state.codexAgentTurn.turnId, "turn-1");
      assert.equal(state.codexTerminal.transmitting, undefined);
    } finally {
      await closeTerminalSession(terminal.id, {
        namespace
      });
    }
  });
});

test("Vibe64 Codex control has no terminal fallback when app-server control is disabled", async () => {
  const controller = createCodexTerminalController({
    codexAppServerPromptDeliveryEnabled: false,
    projectService: {}
  });

  const startResult = await controller.startTerminal("codex_app_server_disabled");
  assert.equal(startResult.ok, false);
  assert.match(startResult.error, /no terminal fallback/u);

  const promptResult = await controller.injectCodexPrompt("codex_app_server_disabled", {
    kind: "codex_prompt_handoff",
    terminalInput: "This must not be typed into xterm."
  });
  assert.equal(promptResult.ok, false);
  assert.match(promptResult.error, /no terminal fallback/u);
});

test("Vibe64 Codex app-server prompt delivery records the resumable CLI thread", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "codex_app_server_prompt";
    const stateRoot = path.join(targetRoot, "server-state");
    const sessionRoot = path.join(stateRoot, "sessions", "active", sessionId);
    const worktree = path.join(sessionRoot, "worktree");
    await mkdir(worktree, {
      recursive: true
    });
    const session = {
      actionAttempts: [],
      artifactsRoot: path.join(sessionRoot, "artifacts"),
      completedSteps: ["worktree_created"],
      config: {
        projectType: "unit",
        ready: true
      },
      currentStep: "maintenance_conversation",
      metadata: {
        worktree_path: worktree
      },
      presentation: {
        backgroundTasks: []
      },
      sessionId,
      sessionRoot,
      stateRoot,
      status: "active",
      stepMachine: {
        status: "awaiting_agent_result"
      },
      targetRoot
    };
    const backgroundTasks = new Map();
    const conversationLog = [];
    const runtime = {
      stateRoot,
      targetRoot,
      async getSession() {
        return session;
      },
      async promptSessionForAction(currentSession) {
        return {
          ...currentSession,
          adapter: {
            id: "unit",
            label: "Unit adapter",
            managedServices: [],
            promptContext: {
              summary: "Unit prompt context"
            }
          }
        };
      },
      store: {
        async mutateSession(_sessionId, operation) {
          return operation();
        },
        async writeBackgroundTaskEvent(_sessionId, taskId, {
          event = {},
          patch = {}
        } = {}) {
          const previous = backgroundTasks.get(taskId) || {
            events: [],
            id: taskId
          };
          const task = {
            ...previous,
            ...patch,
            events: [
              ...(Array.isArray(previous.events) ? previous.events : []),
              event
            ],
            id: taskId,
            status: patch.status || event.status || previous.status || ""
          };
          backgroundTasks.set(taskId, task);
          session.presentation.backgroundTasks = [...backgroundTasks.values()];
          return task;
        },
        async writeMetadataValue(_sessionId, name, value) {
          session.metadata[name] = String(value || "").trim();
        },
        async writeConversationUserMessage(_sessionId, {
          text = ""
        } = {}) {
          conversationLog.push({
            assistant: null,
            user: {
              text: String(text || "").trim()
            }
          });
          return conversationLog.at(-1);
        },
        async readConversationLog() {
          return conversationLog;
        }
      }
    };
    const providerCalls = {
      close: 0,
      ensureRuntime: 0,
      resumeThread: [],
      sendTurn: [],
      startThread: []
    };
    const providerSubscribers = [];
    const provider = {
      close() {
        providerCalls.close += 1;
      },
      async ensureRuntime() {
        providerCalls.ensureRuntime += 1;
          return {
            containerEndpoint: "unix:///vibe64-codex-app-server/app-server.sock",
            containerRuntimeDir: "/vibe64-codex-app-server",
            containerSocketPath: "/vibe64-codex-app-server/app-server.sock",
          endpoint: `unix://${path.join(stateRoot, "runtime", "codex-app-server", "app-server.sock")}`,
          runtimeDir: path.join(stateRoot, "runtime", "codex-app-server"),
          socketPath: path.join(stateRoot, "runtime", "codex-app-server", "app-server.sock"),
          transport: "unix"
        };
      },
      async resumeThread(threadId, params) {
        providerCalls.resumeThread.push({
          params,
          threadId
        });
        return {
          id: threadId
        };
      },
      async sendTurn(threadId, input, params) {
        providerCalls.sendTurn.push({
          input,
          params,
          threadId
        });
        return {
          id: "codex-app-server-turn-1",
          status: "inProgress"
        };
      },
      async startThread(params) {
        providerCalls.startThread.push(params);
        return {
          id: "00000000-0000-4000-8000-000000000004"
        };
      },
      subscribe(callback) {
        providerSubscribers.push(callback);
        return () => null;
      }
    };
    const publishPromptReasons = [];
    const publishSessionReasons = [];
    const controller = createCodexTerminalController({
      codexAppServerPromptDeliveryEnabled: true,
      codexAppServerProviderFactory: () => provider,
      projectService: {
        targetRoot,
        async createRuntime() {
          return runtime;
        }
      },
      publishPromptInjected: async (_sessionId, event = {}) => {
        publishPromptReasons.push(event.reason);
      },
      publishSessionChanged: async (_sessionId, event = {}) => {
        publishSessionReasons.push(event.reason);
      }
    });

    const result = await controller.injectCodexPrompt(sessionId, {
      handoffId: "000001-maintenance_conversation.json:agent_conversation",
      kind: "codex_prompt_handoff",
      terminalInput: "Vibe64 interactive conversation turn:\nUser/request input:\n- conversationRequest: Verify app-server prompt delivery."
    });

    assert.equal(result.ok, true);
    assert.equal(result.codexAppServerPromptInjected, true);
    assert.equal(result.codexPromptInjected, true);
    assert.equal(result.terminalSessionId, "");
    assert.equal(result.turnId, "codex-app-server-turn-1");
    assert.equal(providerCalls.ensureRuntime, 1);
    assert.equal(providerCalls.resumeThread.length, 0);
    assert.equal(providerCalls.startThread.length, 1);
    assert.equal(providerCalls.sendTurn.length, 1);
    assert.equal(providerCalls.startThread[0].approvalPolicy, "never");
    assert.equal(providerCalls.startThread[0].cwd, worktree);
    assert.equal(providerCalls.startThread[0].model, "gpt-5.5");
    assert.equal(providerCalls.startThread[0].sandbox, "danger-full-access");
    assert.match(providerCalls.startThread[0].developerInstructions, /Vibe64 session briefing/u);
    assert.match(providerCalls.startThread[0].developerInstructions, /Vibe64 app-server helper commands/u);
    assert.match(providerCalls.startThread[0].developerInstructions, /vibe64-terminal-chat-host\.mjs/u);
    assert.equal(providerCalls.sendTurn[0].threadId, "00000000-0000-4000-8000-000000000004");
    assert.equal(providerCalls.sendTurn[0].params.cwd, worktree);
    assert.equal(providerCalls.sendTurn[0].params.effort, "xhigh");
    assert.deepEqual(providerCalls.sendTurn[0].params.sandboxPolicy, {
      type: "dangerFullAccess"
    });
    assert.match(providerCalls.sendTurn[0].input, /Verify app-server prompt delivery/u);
    assert.match(providerCalls.sendTurn[0].input, /Vibe64 app-server helper commands/u);
    assert.match(providerCalls.sendTurn[0].input, /vibe64-current-step-input-host\.mjs/u);
    assert.equal(session.metadata.agent_identity_provider, "codex");
    assert.equal(session.metadata.agent_identity_status, "ready");
    assert.equal(
      session.metadata.agent_identity_conversation_id,
      "00000000-0000-4000-8000-000000000004"
    );
    assert.equal(session.metadata.agent_identity_workdir, worktree);
    assert.equal(session.metadata.agent_identity_resume_strategy, "provider-native");
    assert.equal(session.metadata.codex_thread_id, "00000000-0000-4000-8000-000000000004");
    assert.equal(session.metadata.codex_app_server_endpoint, `unix://${path.join(stateRoot, "runtime", "codex-app-server", "app-server.sock")}`);
    assert.equal(session.metadata.codex_app_server_container_endpoint, "unix:///vibe64-codex-app-server/app-server.sock");
    assert.equal(session.metadata.codex_app_server_transport, "unix");
    assert.equal(
      session.metadata.codex_cli_resume_command,
      `codex --remote unix://${path.join(stateRoot, "runtime", "codex-app-server", "app-server.sock")} resume 00000000-0000-4000-8000-000000000004`
    );
    assert.equal(
      session.metadata.codex_container_cli_resume_command,
      "codex --remote unix:///vibe64-codex-app-server/app-server.sock resume 00000000-0000-4000-8000-000000000004"
    );
    assert.equal(session.metadata.codex_prompt_handoff_delivery, "app_server");
    assert.equal(session.metadata.codex_app_server_turn_id, "codex-app-server-turn-1");
    assert.match(session.metadata.codex_prompt_handoff_echo_input, /vibe64-terminal-chat-host\.mjs/u);
    assert.equal(session.metadata.codex_session_briefing_delivered, "yes");
    assert.equal(session.metadata.codex_session_briefing_delivery, "app_server_developer_instructions");
    assert.equal(
      session.presentation.backgroundTasks.find((task) => task.id === "codex_app_server")?.status,
      "ready"
    );
    assert.deepEqual(publishPromptReasons, ["codex-app-server-prompt-injected"]);
    assert.deepEqual(publishSessionReasons, [
      "codex-app-server-running",
      "codex-app-server-turn-active",
      "codex-app-server-turn-active",
      "codex-app-server-ready"
    ]);
    assert.equal(providerSubscribers.length, 1);
    providerSubscribers[0]({
      method: "item/started",
      params: {
        item: {
          content: [
            {
              text: "This was typed directly into the Codex terminal.",
              type: "text"
            }
          ],
          id: "terminal-user-message-1",
          type: "userMessage"
        },
        threadId: "00000000-0000-4000-8000-000000000004",
        turnId: "terminal-turn-1"
      }
    });
    await delay(5);
    assert.deepEqual((await runtime.store.readConversationLog()).map((turn) => turn.user?.text), [
      "This was typed directly into the Codex terminal."
    ]);
    assert.equal(publishSessionReasons.at(-1), "codex-app-server-terminal-user-message");
    providerSubscribers[0]({
      method: "item/completed",
      params: {
        item: {
          content: [
            {
              text: "This was typed directly into the Codex terminal.",
              type: "text"
            }
          ],
          id: "terminal-user-message-1",
          type: "userMessage"
        },
        threadId: "00000000-0000-4000-8000-000000000004",
        turnId: "terminal-turn-1"
      }
    });
    providerSubscribers[0]({
      method: "item/started",
      params: {
        item: {
          content: [
            {
              text: "Vibe64 interactive conversation turn:\nVIBE64_ROUTED_TURN: yes\nUser/request input:\n- conversationRequest: Already in Vibe64 chat.",
              type: "text"
            }
          ],
          id: "routed-user-message-1",
          type: "userMessage"
        },
        threadId: "00000000-0000-4000-8000-000000000004",
        turnId: "routed-turn-1"
      }
    });
    await delay(5);
    assert.deepEqual((await runtime.store.readConversationLog()).map((turn) => turn.user?.text), [
      "This was typed directly into the Codex terminal."
    ]);
    providerSubscribers[0]({
      method: "thread/status/changed",
      params: {
        status: {
          activeFlags: [],
          type: "active"
        },
        threadId: "00000000-0000-4000-8000-000000000004"
      }
    });
    await delay(5);
    assert.equal(session.metadata.codex_app_server_turn_state, "active");
    assert.equal(session.metadata.codex_app_server_turn_status, "inProgress");
    providerSubscribers[0]({
      method: "thread/status/changed",
      params: {
        status: {
          type: "idle"
        },
        threadId: "00000000-0000-4000-8000-000000000004"
      }
    });
    await delay(5);
    assert.equal(session.metadata.codex_app_server_turn_state, "idle");
    assert.equal(session.metadata.codex_app_server_turn_status, "completed");
    await controller.closeAllForSession(sessionId);
    assert.equal(providerCalls.close, 1);
  });
});

test("Vibe64 Codex app-server preparation failure is persisted as a visible background task", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "codex_app_server_disabled_after_worktree";
    const sessionRoot = path.join(targetRoot, ".vibe64", "sessions", "active", sessionId);
    const worktree = path.join(sessionRoot, "worktree");
    const runtime = new Vibe64SessionRuntime({
      targetRoot
    });
    await runtime.createSession({
      initialStep: "worktree_created",
      metadata: {
        worktree_path: worktree
      },
      sessionId
    });
    await mkdir(worktree, {
      recursive: true
    });
    const publishReasons = [];
    const terminalService = createService({
      codexTerminalController: {
        codexAppServerPromptDeliveryEnabled: false
      },
      projectService: {
        targetRoot,
        async createRuntime() {
          return runtime;
        }
      },
      publishSessionChanged: {
        codexTerminal: async (sessionId, event = {}) => {
          publishReasons.push({
            reason: event.reason,
            sessionId
          });
        }
      }
    });

    const result = await terminalService.ensureCodexThread(sessionId);
    const session = await runtime.getSession(sessionId);
    const task = session.presentation.backgroundTasks.find((entry) => entry.id === "codex_app_server");

    assert.equal(result.ok, false);
    assert.match(result.error, /no terminal fallback/u);
    assert.equal(task.status, "failed");
    assert.match(task.error, /no terminal fallback/u);
    assert.equal(task.retry, null);
    assert.deepEqual(publishReasons.map((entry) => entry.reason), [
      "codex-app-server-failed"
    ]);
  });
});

test("Vibe64 shell terminal joins the target runtime network before the image", () => {
  const targetRoot = "/workspace/project";
  const worktree = "/workspace/project/.vibe64/sessions/active/unit/worktree";
  const args = shellTerminalArgs({
    containerName: "vibe64-shell-unit",
    env: {
      VIBE64_MYSQL_USER: "root",
      VIBE64_CONFIG_DIR: "/workspace/project/.vibe64/config",
      MYSQL_HOST: JSKIT_MARIADB_HOST,
      MYSQL_PWD: JSKIT_MARIADB_ROOT_PASSWORD,
      MYSQL_TCP_PORT: "3306"
    },
    sessionId: "unit-session",
    target: "worktree",
    targetRoot,
    terminalId: "unit-terminal",
    workdir: worktree
  });

  assertPlaywrightBrowserCache(args);
  const networkIndex = args.indexOf("--network");
  assert.notEqual(networkIndex, -1);
  assert.deepEqual(args.slice(networkIndex, networkIndex + 2), ["--network", runtimeNetworkName(targetRoot)]);
  assert.ok(networkIndex < args.indexOf(STUDIO_BASE_TOOLCHAIN_IMAGE));
  assert.deepEqual(args.slice(args.indexOf("-w"), args.indexOf("-w") + 2), ["-w", worktree]);
  assert.deepEqual(args.slice(args.indexOf("--hostname"), args.indexOf("--hostname") + 2), [
    "--hostname",
    "vibe64-worktree"
  ]);
  assert.ok(args.includes("VIBE64_CONFIG_DIR=/workspace/project/.vibe64/config"));
  assert.ok(args.includes(`MYSQL_HOST=${JSKIT_MARIADB_HOST}`));
  assert.ok(args.includes(`MYSQL_PWD=${JSKIT_MARIADB_ROOT_PASSWORD}`));
  assert.ok(args.includes("MYSQL_TCP_PORT=3306"));
  assert.ok(args.includes("VIBE64_MYSQL_USER=root"));
  assert.ok(args.includes("TERM=xterm-256color"));
  assert.ok(args.includes("COLORTERM=truecolor"));
  assert.ok(args.includes("FORCE_COLOR=1"));
  assert.ok(args.includes("USER=studio"));
  assert.ok(args.includes("VIBE64_PROJECT_ROOT=/workspace/project"));
  assert.ok(args.includes(`VIBE64_SHELL_WORKDIR=${worktree}`));
  assert.ok(args.some((arg) => String(arg).startsWith("VIBE64_SHELL_PROMPT=\\[\\e[38;5;39m\\]studio")));
  assert.ok(args.some((arg) => String(arg).startsWith("PS1=\\[\\e[38;5;39m\\]studio")));

  const startupScript = args.at(-1);
  assert.ok(startupScript.includes(`export HOME=${STUDIO_TOOL_HOME_PATH}`));
  assert.ok(startupScript.includes(`export NPM_CONFIG_PREFIX=${STUDIO_TOOL_HOME_NPM_PREFIX}`));
  assert.ok(startupScript.includes(`export PATH=${STUDIO_TOOL_HOME_BIN_PATH}:$PATH`));
  assert.ok(startupScript.includes(`export MYSQL_HOME=${STUDIO_MYSQL_CLIENT_CONFIG_DIR}`));
  assert.ok(startupScript.includes("printf 'user=%s\\n' \"$VIBE64_MYSQL_USER\""));
  assert.ok(startupScript.includes("printf 'database=%s\\n' \"$MYSQL_DATABASE\""));
  assert.ok(startupScript.includes("PROMPT_DIRTRIM=4"));
  assert.ok(startupScript.includes("alias ls='ls --color=auto'"));
  assert.ok(startupScript.includes("PS1=\"${VIBE64_SHELL_PROMPT:-\\w \\$ }\""));
  assert.match(startupScript, /chown -R "\$VIBE64_HOST_UID:\$VIBE64_HOST_GID" "\$HOME"/u);
  assert.match(startupScript, /setpriv .* bash --rcfile \/tmp\/vibe64-shell\.bashrc -i/u);
});

test("Vibe64 command terminal joins the target runtime network before the image", () => {
  const targetRoot = "/workspace/project";
  const worktree = "/workspace/project/.vibe64/sessions/active/unit/worktree";
  const resultDirectory = "/tmp/vibe64-command-unit";
  const supportDirectory = "/opt/vibe64-support";
  const args = commandTerminalArgs({
    args: [
      "-lc",
      "npm test"
    ],
    command: "bash",
    containerName: "vibe64-command-unit",
    env: {
      [COMMAND_RESULT_ENV]: `${resultDirectory}/result.tsv`,
      MYSQL_HOST: JSKIT_MARIADB_HOST,
      MYSQL_PWD: JSKIT_MARIADB_ROOT_PASSWORD
    },
    image: "adapter-toolchain:1.0.0",
    mounts: [
      {
        readOnly: true,
        source: supportDirectory,
        target: supportDirectory
      }
    ],
    resultFile: {
      directory: resultDirectory,
      path: `${resultDirectory}/result.tsv`
    },
    sessionId: "unit-session",
    targetRoot,
    terminalId: "unit-terminal",
    workdir: worktree
  });

  assertPlaywrightBrowserCache(args);
  const networkIndex = args.indexOf("--network");
  assert.notEqual(networkIndex, -1);
  assert.deepEqual(args.slice(networkIndex, networkIndex + 2), ["--network", runtimeNetworkName(targetRoot)]);
  assert.ok(networkIndex < args.indexOf("adapter-toolchain:1.0.0"));
  assert.ok(args.includes(`${targetRoot}:/workspace`));
  assert.ok(args.includes(`${targetRoot}:${targetRoot}`));
  assert.ok(args.includes(`${resultDirectory}:${resultDirectory}`));
  assert.ok(args.includes(`${supportDirectory}:${supportDirectory}:ro`));
  assert.ok(args.includes(`MYSQL_HOST=${JSKIT_MARIADB_HOST}`));
  assert.ok(args.includes(`MYSQL_PWD=${JSKIT_MARIADB_ROOT_PASSWORD}`));
  for (const [key, value] of Object.entries(githubSshToHttpsGitEnv())) {
    assertDockerEnv(args, key, value);
  }
  assert.equal(dockerEnvValue(args, COMMAND_RESULT_ENV), `${resultDirectory}/result.tsv`);

  const startupScript = args.at(-1);
  assert.ok(startupScript.includes(`export HOME=${STUDIO_TOOL_HOME_PATH}`));
  assert.ok(startupScript.includes(`export NPM_CONFIG_PREFIX=${STUDIO_TOOL_HOME_NPM_PREFIX}`));
  assert.match(startupScript, /setpriv .* bash -lc 'npm test'/u);
});

test("Vibe64 command terminal mounts the session root for worktree creation outside the repo", () => {
  const targetRoot = "/home/tenant/vibe64/beepollen";
  const sessionRoot = "/home/tenant/.vibe64/projects/beepollen/sessions/active/unit";
  const resultDirectory = "/tmp/vibe64-command-unit";
  const args = commandTerminalArgs({
    args: [
      "-lc",
      `git worktree add ${sessionRoot}/worktree`
    ],
    command: "bash",
    containerName: "vibe64-command-unit",
    env: {
      [COMMAND_RESULT_ENV]: `${resultDirectory}/result.tsv`
    },
    image: "adapter-toolchain:1.0.0",
    resultFile: {
      directory: resultDirectory,
      path: `${resultDirectory}/result.tsv`
    },
    session: {
      artifactsRoot: `${sessionRoot}/artifacts`,
      metadataRoot: `${sessionRoot}/metadata`,
      sessionRoot
    },
    sessionId: "unit-session",
    targetRoot,
    terminalId: "unit-terminal",
    workdir: targetRoot
  });

  assert.ok(args.includes(`${targetRoot}:${targetRoot}`));
  assert.ok(args.includes(`${sessionRoot}:${sessionRoot}`));
  assert.equal(args.includes(`${sessionRoot}/artifacts:${sessionRoot}/artifacts`), false);
  assert.equal(args.includes(`${sessionRoot}/metadata:${sessionRoot}/metadata`), false);
});

test("Vibe64 terminals use the base image when the adapter does not declare one", async () => {
  const result = await resolveTerminalToolchainImage({
    imageExists: async (image) => image === STUDIO_BASE_TOOLCHAIN_IMAGE,
    runtime: {
      adapter: new UnitCommandAdapter(),
      projectConfig: {}
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.image, STUDIO_BASE_TOOLCHAIN_IMAGE);
  assert.equal(result.label, "managed base toolchain");
});

test("Vibe64 terminals use declared adapter toolchain images", async () => {
  const result = await resolveTerminalToolchainImage({
    imageExists: async (image) => image === "adapter-toolchain:1.0.0",
    runtime: {
      adapter: {
        async getTerminalToolchainSpec() {
          return {
            image: "adapter-toolchain:1.0.0",
            label: "Adapter toolchain"
          };
        }
      },
      projectConfig: {}
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.image, "adapter-toolchain:1.0.0");
  assert.equal(result.label, "Adapter toolchain");
});

test("Vibe64 terminals fail clearly when a declared adapter image is missing", async () => {
  const result = await resolveTerminalToolchainImage({
    imageExists: async () => false,
    runtime: {
      adapter: {
        async getTerminalToolchainSpec() {
          return {
            image: "missing-adapter-toolchain:1.0.0",
            label: "Missing adapter toolchain"
          };
        }
      },
      projectConfig: {}
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.image, "missing-adapter-toolchain:1.0.0");
  assert.match(result.error, /Missing adapter toolchain image missing-adapter-toolchain:1\.0\.0 is missing/u);
  assert.match(result.error, /host was not provisioned/u);
});

test("adapters with managed toolchains declare their terminal toolchain image", async () => {
  assert.equal((await new JskitTargetAdapter().getTerminalToolchainSpec()).image, JSKIT_TOOLCHAIN_IMAGE);
  assert.equal((await new LaravelTargetAdapter().getTerminalToolchainSpec()).image, LARAVEL_TOOLCHAIN_IMAGE);
  assert.equal((await new CppTargetAdapter().getTerminalToolchainSpec()).image, CPP_TOOLCHAIN_IMAGE);
});

test("Vibe64 terminal env includes JSKIT managed MariaDB client defaults when selected", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await writeFile(path.join(targetRoot, ".env"), `DB_HOST=${JSKIT_MARIADB_HOST}\n`, "utf8");
    const configDir = path.join(targetRoot, ".vibe64", "config");
    const env = await projectTerminalEnvironment({
      projectService: {
        async projectConfigEnvironment() {
          return {
            VIBE64_CONFIG_DIR: configDir
          };
        }
      },
      runtime: {
        adapter: new JskitTargetAdapter(),
        projectConfig: {}
      },
      session: {
        targetRoot
      },
      target: "shell",
      targetRoot
    });

    assert.equal(env.VIBE64_CONFIG_DIR, configDir);
    assert.equal(env.MYSQL_HOST, JSKIT_MARIADB_HOST);
    assert.equal(env.MYSQL_PWD, JSKIT_MARIADB_ROOT_PASSWORD);
    assert.equal(env.MYSQL_TCP_PORT, "3306");
    assert.equal(env.VIBE64_MYSQL_USER, "root");
    assert.equal(env.MYSQL_DATABASE, path.basename(targetRoot).replace(/[^A-Za-z0-9_]+/gu, "_"));
  });
});

test("Vibe64 terminal env includes JSKIT managed MariaDB client defaults when config selects MySQL", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const env = await projectTerminalEnvironment({
      runtime: {
        adapter: new JskitTargetAdapter(),
        projectConfig: {
          values: {
            jskit_database_runtime: "mysql"
          }
        }
      },
      session: {
        targetRoot
      },
      target: "shell",
      targetRoot
    });

    assert.equal(env.MYSQL_HOST, JSKIT_MARIADB_HOST);
    assert.equal(env.MYSQL_PWD, JSKIT_MARIADB_ROOT_PASSWORD);
    assert.equal(env.MYSQL_TCP_PORT, "3306");
    assert.equal(env.VIBE64_MYSQL_USER, "root");
    assert.equal(env.MYSQL_DATABASE, path.basename(targetRoot).replace(/[^A-Za-z0-9_]+/gu, "_"));
  });
});

test("Vibe64 terminal env skips JSKIT MariaDB client defaults when unmanaged", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await writeFile(path.join(targetRoot, ".env"), "DB_HOST=localhost\n", "utf8");
    const env = await projectTerminalEnvironment({
      runtime: {
        adapter: new JskitTargetAdapter(),
        projectConfig: {}
      },
      session: {
        targetRoot
      },
      target: "shell",
      targetRoot
    });

    assert.equal(env.MYSQL_HOST, undefined);
    assert.equal(env.MYSQL_PWD, undefined);
  });
});

test("Vibe64 command terminal records action results and metadata after success", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new Vibe64SessionRuntime({
      adapter: new UnitCommandAdapter(),
      clock: () => new Date("2026-05-16T01:02:03.000Z"),
      targetRoot,
      workflow: {
        id: "unit-terminal",
        steps: [
          {
            actions: [
              {
                adapterCapability: "unit_command",
                id: "unit_command",
                label: "Unit command",
                type: "command"
              }
            ],
            id: "unit_step",
            label: "Unit step"
          }
        ]
      }
    });
    await runtime.createSession({
      metadata: {
        stale_value: "delete me"
      },
      sessionId: "terminal_success"
    });

    let ensuredTargetRoot = "";
    let closePromise = Promise.resolve();
    let startedCommand = "";
    let startedDockerArgs = [];
    const successfulCommandHooks = [];
    const command = createCommandTerminalController({
      afterSuccessfulCommand: async (event) => {
        successfulCommandHooks.push({
          actionId: event.action?.id,
          currentStep: event.session?.currentStep,
          metadata: event.metadata
        });
      },
      ensureRuntimeNetwork: async (root) => {
        ensuredTargetRoot = root;
      },
      projectService: {
        targetRoot,
        async createRuntime() {
          return runtime;
        },
        async projectConfigEnvironment() {
          return {
            VIBE64_CONFIG_DIR: path.join(targetRoot, ".vibe64", "config")
          };
        }
      },
      resolveToolchainImage: async () => ({
        image: "unit-command-toolchain:1.0.0",
        label: "Unit command toolchain",
        ok: true
      }),
      startTerminal: (options) => {
        const id = "unit-command-terminal";
        assert.equal(options.maxRunning, 1);
        assert.equal(options.reuseRunning, false);
        startedCommand = options.command;
        startedDockerArgs = options.args({
          id,
          namespace: options.namespace
        });
        assert.match(options.metadata.attemptedCommand, /^bash -lc /u);
        assert.match(options.metadata.attemptedCommand, /dynamic_done/u);
        const resultFilePath = dockerEnvValue(startedDockerArgs, COMMAND_RESULT_ENV);
        assert.ok(resultFilePath);
        closePromise = (async () => {
          await writeFile(
            resultFilePath,
            "fact:set\tdynamic_done\tZnJvbS1yZXN1bHQtZmlsZQ==\n",
            "utf8"
          );
          await options.onClose({
            exitCode: 0,
            id
          });
        })();
        return {
          id,
          ok: true,
          status: "running"
        };
      }
    });

    const terminal = await command.startTerminal("terminal_success", {
      actionId: "unit_command",
      input: {
        dryRun: true
      }
    });
    assert.equal(terminal.ok, true);
    await closePromise;
    assert.equal(startedCommand, "docker");
    assert.equal(ensuredTargetRoot, targetRoot);
    assert.ok(startedDockerArgs.includes("--network"));
    assert.deepEqual(startedDockerArgs.slice(startedDockerArgs.indexOf("--network"), startedDockerArgs.indexOf("--network") + 2), [
      "--network",
      runtimeNetworkName(targetRoot)
    ]);
    assert.ok(startedDockerArgs.indexOf("--network") < startedDockerArgs.indexOf("unit-command-toolchain:1.0.0"));

    const updatedSession = await runtime.getSession("terminal_success");
	    assert.equal(updatedSession.metadata.terminal_done, "yes");
	    assert.equal(updatedSession.metadata.dynamic_done, "from-result-file");
	    assert.equal(updatedSession.metadata.stale_value, undefined);
	    await waitForArrayLength(successfulCommandHooks, 1);
	    assert.deepEqual(successfulCommandHooks, [
	      {
        actionId: "unit_command",
        currentStep: "unit_step",
        metadata: {
          dynamic_done: "from-result-file",
          terminal_done: "yes"
        }
      }
    ]);
    assert.deepEqual(updatedSession.actionResult, undefined);
    assert.deepEqual(updatedSession.actionResults.map((result) => ({
      actionId: result.actionId,
      input: result.input,
      message: result.message,
      metadata: result.metadata,
      status: result.status
    })), [
      {
        actionId: "unit_command",
        input: {
          dryRun: true
        },
        message: "Unit command completed.",
        metadata: {
          dynamic_done: "from-result-file",
          terminal_done: "yes"
        },
        status: "completed"
      }
    ]);
	    assert.deepEqual(await runtime.store.readCommandLog("terminal_success"), [
	      {
	        actionId: "unit_command",
        actionLabel: "Unit command",
        actionType: "command",
        at: "2026-05-16T01:02:03.000Z",
        kind: "terminal-action",
        status: "completed",
	        stepId: "unit_step"
	      }
	    ]);
	    let lifecycle = await runtime.store.readCommandLifecycle("terminal_success", "1-unit_command");
	    for (let attempt = 0; attempt < 20 && lifecycle?.phase !== "done"; attempt += 1) {
	      await delay(5);
	      lifecycle = await runtime.store.readCommandLifecycle("terminal_success", "1-unit_command");
	    }
	    const lifecycleEventKinds = lifecycle.events.map((event) => event.kind);
	    assert.deepEqual({
	      actionId: lifecycle.actionId,
	      inputKeys: lifecycle.inputKeys,
	      outcome: lifecycle.outcome,
	      phase: lifecycle.phase,
	      postCommit: lifecycle.postCommit,
	      stepId: lifecycle.stepId,
	      stepRevision: lifecycle.stepRevision,
	      terminalSessionId: lifecycle.terminalSessionId
	    }, {
	      actionId: "unit_command",
	      inputKeys: ["dryRun"],
	      outcome: "completed",
	      phase: "done",
	      postCommit: {
	        afterSuccessfulCommand: "done",
	        afterSuccessfulCommandError: "",
	        publishSessionChanged: "done",
	        publishSessionChangedError: ""
	      },
	      stepId: "unit_step",
	      stepRevision: 1,
	      terminalSessionId: "unit-command-terminal"
	    });
	    assert.deepEqual([...new Set(lifecycleEventKinds)].sort(), [
	      "done",
	      "post_commit_running",
	      "result_writing",
	      "result_written",
	      "started",
	      "starting",
	      "terminal_exited"
	    ]);
	  });
	});

test("Vibe64 command terminal persists failed command context for reload-stable repair", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new Vibe64SessionRuntime({
      adapter: new UnitCommandAdapter(),
      targetRoot,
      workflow: {
        id: "unit-terminal-failure-context",
        steps: [
          {
            actions: [
              {
                adapterCapability: "unit_command",
                id: "unit_command",
                label: "Unit command",
                type: "command"
              }
            ],
            id: "unit_step",
            label: "Unit step"
          }
        ]
      }
    });
    await runtime.createSession({
      sessionId: "terminal_failure_context"
    });

    let closeTerminal = async () => null;
    const command = createCommandTerminalController({
      ensureRuntimeNetwork: async () => null,
      projectService: {
        targetRoot,
        async createRuntime() {
          return runtime;
        },
        async projectConfigEnvironment() {
          return {
            VIBE64_CONFIG_DIR: path.join(targetRoot, ".vibe64", "config")
          };
        }
      },
      resolveToolchainImage: async () => ({
        image: "unit-command-toolchain:1.0.0",
        label: "Unit command toolchain",
        ok: true
      }),
      startTerminal: (options) => {
        const id = "unit-command-failure-terminal";
        closeTerminal = async () => {
          await options.onClose({
            exitCode: 1,
            id,
            output: "first line\neslint failed on unit file"
          });
        };
        return {
          commandPreview: options.commandPreview,
          id,
          ok: true,
          status: "running"
        };
      }
    });

    const terminal = await command.startTerminal("terminal_failure_context", {
      actionId: "unit_command"
    });
    assert.equal(terminal.ok, true);

    await closeTerminal();

    const session = await runtime.getSession("terminal_failure_context");
    assert.match(session.actionResults[0]?.attemptedCommand, /^bash -lc /u);
    assert.match(session.actionResults[0]?.attemptedCommand, /dynamic_done/u);
    assert.deepEqual(session.actionResults.map((result) => ({
      actionId: result.actionId,
      commandPreview: result.commandPreview,
      exitCode: result.exitCode,
      message: result.message,
      output: result.output,
      status: result.status,
      terminalSessionId: result.terminalSessionId
    })), [
      {
        actionId: "unit_command",
        commandPreview: "bash command result",
        exitCode: 1,
        message: "Unit command failed with exit code 1.",
        output: "first line\neslint failed on unit file",
        status: "blocked",
        terminalSessionId: "unit-command-failure-terminal"
      }
    ]);
  });
});

test("Vibe64 command terminal accepts completion after unrelated session metadata changes", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new Vibe64SessionRuntime({
      adapter: new UnitCommandAdapter(),
      targetRoot,
      workflow: {
        id: "unit-terminal-metadata-race",
        steps: [
          {
            actions: [
              {
                adapterCapability: "unit_command",
                id: "unit_command",
                label: "Unit command",
                type: "command"
              }
            ],
            id: "unit_step",
            label: "Unit step"
          }
        ]
      }
    });
    await runtime.createSession({
      sessionId: "terminal_metadata_race"
    });

    let closeTerminal = async () => null;
    const command = createCommandTerminalController({
      ensureRuntimeNetwork: async () => null,
      projectService: {
        targetRoot,
        async createRuntime() {
          return runtime;
        },
        async projectConfigEnvironment() {
          return {
            VIBE64_CONFIG_DIR: path.join(targetRoot, ".vibe64", "config")
          };
        }
      },
      resolveToolchainImage: async () => ({
        image: "unit-command-toolchain:1.0.0",
        label: "Unit command toolchain",
        ok: true
      }),
      startTerminal: (options) => {
        const id = "unit-command-metadata-race-terminal";
        const dockerArgs = options.args({
          id,
          namespace: options.namespace
        });
        const resultFilePath = dockerEnvValue(dockerArgs, COMMAND_RESULT_ENV);
        closeTerminal = async () => {
          await writeFile(
            resultFilePath,
            "fact:set\tdynamic_done\tZnJvbS1yZXN1bHQtZmlsZQ==\n",
            "utf8"
          );
          await options.onClose({
            exitCode: 0,
            id
          });
        };
        return {
          id,
          ok: true,
          status: "running"
        };
      }
    });

    const terminal = await command.startTerminal("terminal_metadata_race", {
      actionId: "unit_command"
    });
    assert.equal(terminal.ok, true);

    const startedSession = await runtime.getSession("terminal_metadata_race");
    await runtime.store.writeMetadataValue("terminal_metadata_race", "background_marker", "done");
    const metadataChangedSession = await runtime.getSession("terminal_metadata_race");
    assert.equal(metadataChangedSession.revision > startedSession.revision, true);
    assert.equal(metadataChangedSession.stepRevision, startedSession.stepRevision);

    await closeTerminal();

    const session = await runtime.getSession("terminal_metadata_race");
    assert.equal(session.metadata.background_marker, "done");
    assert.equal(session.metadata.terminal_done, "yes");
    assert.equal(session.metadata.dynamic_done, "from-result-file");
    assert.equal(session.actionResults[0]?.status, "completed");
    const commandLog = await runtime.store.readCommandLog("terminal_metadata_race");
    assert.equal(commandLog.filter((entry) => entry.kind === "terminal-action").length, 1);
  });
});

test("Vibe64 command terminal commits completion before slow post-commit hooks finish", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new Vibe64SessionRuntime({
      adapter: new UnitCommandAdapter(),
      targetRoot,
      workflow: {
        id: "unit-terminal-post-commit",
        steps: [
          {
            actions: [
              {
                adapterCapability: "unit_command",
                id: "unit_command",
                label: "Unit command",
                type: "command"
              }
            ],
            id: "unit_step",
            label: "Unit step"
          }
        ]
      }
    });
    await runtime.createSession({
      sessionId: "terminal_post_commit"
    });

    const hookStarted = deferred();
    const hookReleased = deferred();
    const publishStarted = deferred();
    const publishReleased = deferred();
    let closePromise = Promise.resolve();
    const command = createCommandTerminalController({
      afterSuccessfulCommand: async () => {
        hookStarted.resolve();
        await hookReleased.promise;
      },
      ensureRuntimeNetwork: async () => null,
      projectService: {
        targetRoot,
        async createRuntime() {
          return runtime;
        },
        async projectConfigEnvironment() {
          return {
            VIBE64_CONFIG_DIR: path.join(targetRoot, ".vibe64", "config")
          };
        }
      },
      publishSessionChanged: async () => {
        publishStarted.resolve();
        await publishReleased.promise;
      },
      resolveToolchainImage: async () => ({
        image: "unit-command-toolchain:1.0.0",
        label: "Unit command toolchain",
        ok: true
      }),
      startTerminal: (options) => {
        const id = "unit-command-post-commit-terminal";
        const dockerArgs = options.args({
          id,
          namespace: options.namespace
        });
        const resultFilePath = dockerEnvValue(dockerArgs, COMMAND_RESULT_ENV);
        closePromise = (async () => {
          await writeFile(
            resultFilePath,
            "fact:set\tdynamic_done\tZnJvbS1yZXN1bHQtZmlsZQ==\n",
            "utf8"
          );
          await options.onClose({
            exitCode: 0,
            id
          });
        })();
        return {
          id,
          ok: true,
          status: "running"
        };
      }
    });

    try {
      const terminal = await command.startTerminal("terminal_post_commit", {
        actionId: "unit_command"
      });
      assert.equal(terminal.ok, true);
      assert.equal(await Promise.race([
        closePromise.then(() => true),
        delay(POST_COMMIT_TEST_TIMEOUT_MS).then(() => false)
      ]), true);

      const session = await runtime.getSession("terminal_post_commit");
      assert.equal(session.metadata.terminal_done, "yes");
      assert.equal(session.metadata.dynamic_done, "from-result-file");
      assert.equal(session.actionResults[0]?.status, "completed");
      assert.equal(await Promise.race([
        hookStarted.promise.then(() => true),
        delay(POST_COMMIT_TEST_TIMEOUT_MS).then(() => false)
      ]), true);
      assert.equal(await Promise.race([
        publishStarted.promise.then(() => true),
        delay(POST_COMMIT_TEST_TIMEOUT_MS).then(() => false)
      ]), true);
    } finally {
      hookReleased.resolve();
      publishReleased.resolve();
      await Promise.race([
        closePromise.catch(() => null),
        delay(POST_COMMIT_TEST_TIMEOUT_MS)
      ]);
    }
  });
});

test("Vibe64 command terminal ignores stale close after advance and rewind", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new Vibe64SessionRuntime({
      adapter: new UnitCommandAdapter(),
      targetRoot,
      workflow: {
        id: "unit-terminal-stale-close",
        steps: [
          {
            actions: [
              {
                adapterCapability: "unit_command",
                id: "unit_command",
                label: "Unit command",
                type: "command"
              }
            ],
            id: "unit_step",
            label: "Unit step"
          },
          {
            id: "next_step",
            label: "Next step"
          }
        ]
      }
    });
    await runtime.createSession({
      sessionId: "terminal_stale_close"
    });

    let closeTerminal = async () => null;
    const command = createCommandTerminalController({
      ensureRuntimeNetwork: async () => null,
      projectService: {
        targetRoot,
        async createRuntime() {
          return runtime;
        },
        async projectConfigEnvironment() {
          return {
            VIBE64_CONFIG_DIR: path.join(targetRoot, ".vibe64", "config")
          };
        }
      },
      resolveToolchainImage: async () => ({
        image: "unit-command-toolchain:1.0.0",
        label: "Unit command toolchain",
        ok: true
      }),
      startTerminal: (options) => {
        const id = "unit-command-stale-terminal";
        const dockerArgs = options.args({
          id,
          namespace: options.namespace
        });
        const resultFilePath = dockerEnvValue(dockerArgs, COMMAND_RESULT_ENV);
        closeTerminal = async () => {
          await writeFile(
            resultFilePath,
            "fact:set\tdynamic_done\tZnJvbS1yZXN1bHQtZmlsZQ==\n",
            "utf8"
          );
          await options.onClose({
            exitCode: 0,
            id
          });
        };
        return {
          id,
          ok: true,
          status: "running"
        };
      }
    });

    const terminal = await command.startTerminal("terminal_stale_close", {
      actionId: "unit_command"
    });
    assert.equal(terminal.ok, true);

    await runtime.advance("terminal_stale_close");
    await runtime.rewind("terminal_stale_close", "unit_step");
    await closeTerminal();

    const session = await runtime.getSession("terminal_stale_close");
    assert.equal(session.currentStep, "unit_step");
    assert.equal(session.metadata.terminal_done, undefined);
    assert.equal(session.metadata.dynamic_done, undefined);
    assert.deepEqual(session.actionResults, []);
    const commandLog = await runtime.store.readCommandLog("terminal_stale_close");
    assert.deepEqual(commandLog.filter((entry) => entry.kind === "terminal-action"), []);
  });
});

test("Vibe64 command terminal refuses prompt actions and disabled command actions", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new Vibe64SessionRuntime({
      adapter: new UnitCommandAdapter(),
      targetRoot,
      workflow: {
        id: "unit-terminal-blocked",
        steps: [
          {
            actions: [
              {
                id: "unit_prompt",
                label: "Unit prompt",
                type: "prompt"
              },
              {
                adapterCapability: "missing_capability",
                id: "blocked_command",
                label: "Blocked command",
                type: "command"
              }
            ],
            id: "unit_step",
            label: "Unit step"
          }
        ]
      }
    });
    await runtime.createSession({
      sessionId: "terminal_blocked"
    });
    const service = createService({
      projectService: {
        targetRoot,
        async createRuntime() {
          return runtime;
        }
      }
    });

    const prompt = await service.startCommandTerminal("terminal_blocked", {
      actionId: "unit_prompt"
    });
    assert.equal(prompt.ok, false);
    assert.match(prompt.error, /does not run in the command terminal/u);

    const disabled = await service.startCommandTerminal("terminal_blocked", {
      actionId: "blocked_command"
    });
    assert.equal(disabled.ok, false);
    assert.match(disabled.error, /does not support capability/u);
  });
});

test("Vibe64 command terminal advances workflow when requested after success", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new Vibe64SessionRuntime({
      adapter: new UnitCommandAdapter(),
      targetRoot,
      workflow: {
        id: "unit-terminal-advance",
        steps: [
          {
            actions: [
              {
                adapterCapability: "unit_command",
                id: "unit_command",
                label: "Unit command",
                type: "command"
              }
            ],
            id: "unit_step",
            label: "Unit step"
          },
          {
            id: "next_step",
            label: "Next step"
          }
        ]
      }
    });
    await runtime.createSession({
      sessionId: "terminal_advance"
    });

    let closePromise = Promise.resolve();
    const hookSteps = [];
    const command = createCommandTerminalController({
      afterSuccessfulCommand: async ({ session }) => {
        hookSteps.push(session.currentStep);
      },
      ensureRuntimeNetwork: async () => null,
      projectService: {
        targetRoot,
        async createRuntime() {
          return runtime;
        },
        async projectConfigEnvironment() {
          return {
            VIBE64_CONFIG_DIR: path.join(targetRoot, ".vibe64", "config")
          };
        }
      },
      resolveToolchainImage: async () => ({
        image: "unit-command-toolchain:1.0.0",
        label: "Unit command toolchain",
        ok: true
      }),
      startTerminal: (options) => {
        const id = "unit-command-advance-terminal";
        const dockerArgs = options.args({
          id,
          namespace: options.namespace
        });
        const resultFilePath = dockerEnvValue(dockerArgs, COMMAND_RESULT_ENV);
        closePromise = (async () => {
          await writeFile(resultFilePath, "", "utf8");
          await options.onClose({
            exitCode: 0,
            id
          });
        })();
        return {
          id,
          ok: true,
          status: "running"
        };
      }
    });

    const terminal = await command.startTerminal("terminal_advance", {
      actionId: "unit_command",
      advanceOnSuccess: true
    });
    assert.equal(terminal.ok, true);
    await closePromise;

	    const session = await runtime.getSession("terminal_advance");
	    assert.equal(session.currentStep, "next_step");
	    assert.deepEqual(session.completedSteps, ["unit_step"]);
	    await waitForArrayLength(hookSteps, 1);
	    assert.deepEqual(hookSteps, ["next_step"]);
	  });
	});

test("Vibe64 shell terminal resolves only declared session targets", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const worktreePath = path.join(targetRoot, ".vibe64", "sessions", "active", "shell_success", "worktree");
    const session = {
      metadata: {
        worktree_path: worktreePath
      },
      targetRoot
    };
    await mkdir(worktreePath, {
      recursive: true
    });

    const worktree = await resolveShellTerminalCwd({
      projectService: {
        targetRoot
      },
      session,
      target: "worktree"
    });
    assert.equal(worktree.ok, true);
    assert.equal(worktree.cwd, worktreePath);

    const main = await resolveShellTerminalCwd({
      projectService: {
        targetRoot
      },
      session,
      target: "main"
    });
    assert.equal(main.ok, true);
    assert.equal(main.cwd, path.resolve(targetRoot));

    const canonicalWorktreePath = path.join(targetRoot, ".vibe64", "sessions", "active", "canonical_shell", "worktree");
    await mkdir(canonicalWorktreePath, {
      recursive: true
    });
    const canonicalWorktree = await resolveShellTerminalCwd({
      projectService: {
        targetRoot
      },
      session: {
        completedSteps: ["session_created", "worktree_created"],
        metadata: {},
        sessionRoot: path.dirname(canonicalWorktreePath),
        targetRoot
      },
      target: "worktree"
    });
    assert.equal(canonicalWorktree.ok, true);
    assert.equal(canonicalWorktree.cwd, canonicalWorktreePath);

    const outside = await resolveShellTerminalCwd({
      projectService: {
        targetRoot
      },
      session: {
        metadata: {
          worktree_path: "/tmp/outside"
        },
        targetRoot
      },
      target: "worktree"
    });
    assert.equal(outside.ok, false);
    assert.match(outside.error, /outside the target root/u);
  });
});

test("Vibe64 shell terminal blocks unavailable worktree targets", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const missingWorktree = await resolveShellTerminalCwd({
      projectService: {
        targetRoot
      },
      session: {
        metadata: {},
        targetRoot
      },
      target: "worktree"
    });
    assert.equal(missingWorktree.ok, false);
    assert.match(missingWorktree.error, /Create the session worktree/u);
  });
});

test("Vibe64 shell terminal service rejects invalid targets before Docker startup", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new Vibe64SessionRuntime({
      adapter: new UnitCommandAdapter(),
      targetRoot,
      workflow: {
        id: "unit-shell-invalid",
        steps: [
          {
            id: "unit_step",
            label: "Unit step"
          }
        ]
      }
    });
    await runtime.createSession({
      sessionId: "shell_invalid"
    });
    const service = createService({
      projectService: {
        targetRoot,
        async createRuntime() {
          return runtime;
        }
      }
    });

    const invalid = await service.startShellTerminal("shell_invalid", {
      target: "/tmp"
    });
    assert.equal(invalid.ok, false);
    assert.match(invalid.error, /worktree or main/u);
  });
});

test("Vibe64 shell terminal action preserves reuseRunning", async () => {
  const action = terminalFeatureActions.find((item) => item.id === ACTION_START_SHELL_TERMINAL);
  const calls = [];

  const result = await action.execute({
    reuseRunning: false,
    sessionId: "shell_action",
    target: "worktree"
  }, {}, {
    featureService: {
      startShellTerminal(sessionId, input) {
        calls.push({
          input,
          sessionId
        });
        return {
          id: "terminal-1",
          ok: true
        };
      }
    }
  });

  assert.deepEqual(result, {
    id: "terminal-1",
    ok: true
  });
  assert.deepEqual(calls, [
    {
      input: {
        reuseRunning: false,
        target: "worktree"
      },
      sessionId: "shell_action"
    }
  ]);
});

test("Vibe64 session terminal fix action starts an ephemeral Fix Codex job", async () => {
  const action = terminalFeatureActions.find((item) => item.id === ACTION_START_SESSION_TERMINAL_FIX);
  const calls = [];

  const result = await action.execute({
    actionId: "build",
    attemptedCommand: "bash -lc 'npm run build'",
    commandPreview: "npm run build",
    output: "failed",
    sessionId: "fix-session",
    terminalSessionId: "terminal-1"
  }, {}, {
    featureService: {
      startSessionTerminalFixJob(sessionId, input) {
        calls.push({
          input,
          sessionId
        });
        return {
          fixJob: {
            id: "job-1",
            scope: "session"
          },
          id: "fix-terminal-1",
          ok: true
        };
      }
    }
  });

  assert.deepEqual(result, {
    fixJob: {
      id: "job-1",
      scope: "session"
    },
    id: "fix-terminal-1",
    ok: true
  });
  assert.deepEqual(calls, [
    {
      input: {
        actionId: "build",
        attemptedCommand: "bash -lc 'npm run build'",
        commandPreview: "npm run build",
        output: "failed",
        sessionId: "fix-session",
        terminalSessionId: "terminal-1"
      },
      sessionId: "fix-session"
    }
  ]);
});

test("Fix Codex report closes the ephemeral Codex terminal", async () => {
  const fixJobStore = createFixCodexJobStore();
  const { job, token } = fixJobStore.createJob({
    scope: "project",
    subject: "Failing deploy",
    targetRoot: "/workspace/project"
  });
  const namespace = fixCodexTerminalNamespace(job.id);
  const terminal = startTerminalSession({
    args: [
      "-e",
      "process.stdin.resume(); setInterval(() => {}, 1000);"
    ],
    command: process.execPath,
    commandPreview: "codex fix",
    namespace
  });
  assert.equal(terminal.ok, true);
  fixJobStore.attachTerminal(job.id, terminal.id);

  const controller = createCodexTerminalController({
    fixJobStore,
    projectService: {}
  });

  try {
    const report = await controller.reportFixJob(job.id, {
      message: "Configuration intentionally fails.",
      status: "blocked",
      token,
      verificationSummary: "No repository-owned fix available."
    });

    assert.equal(report.ok, true);
    assert.equal(report.fixJob.status, "blocked");
    assert.equal(report.fixJob.terminalSessionId, terminal.id);
    await waitForNoRunningTerminals(namespace);
  } finally {
    await closeTerminalSession(terminal.id, {
      namespace
    });
  }
});

test("Fix Codex helper report closes the ephemeral Codex terminal", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const stateRoot = path.join(targetRoot, "server-state");
    const fixJobStore = createFixCodexJobStore();
    const { job, token } = fixJobStore.createJob({
      scope: "project",
      subject: "Failing deploy",
      targetRoot
    });
    const namespace = fixCodexTerminalNamespace(job.id);
    const terminal = startTerminalSession({
      args: [
        "-e",
        "process.stdin.resume(); setInterval(() => {}, 1000);"
      ],
      command: process.execPath,
      commandPreview: "codex fix",
      namespace
    });
    assert.equal(terminal.ok, true);
    fixJobStore.attachTerminal(job.id, terminal.id);

    const helper = await prepareFixCodexReportHelper({
      fixJobStore,
      jobId: job.id,
      stateRoot,
      token
    });
    const socketPath = path.join(
      helper.mount.source,
      path.basename(helper.env.VIBE64_FIX_CODEX_REPORT_SOCKET)
    );

    try {
      const result = await runNodeScript(helper.env.VIBE64_FIX_CODEX_REPORT_HELPER, [
        "--json"
      ], {
        ...helper.env,
        VIBE64_FIX_CODEX_REPORT_SOCKET: socketPath
      }, JSON.stringify({
        message: "Configuration intentionally fails.",
        status: "blocked",
        verificationSummary: "No repository-owned fix available."
      }));

      assert.equal(result.code, 0, result.stderr || result.stdout);
      const response = JSON.parse(result.stdout);
      assert.equal(response.ok, true);
      assert.equal(response.fixJob.status, "blocked");
      assert.equal(response.fixJob.terminalSessionId, terminal.id);
      await waitForNoRunningTerminals(namespace);
    } finally {
      await closeTerminalSession(terminal.id, {
        namespace
      });
    }
  });
});

test("Vibe64 terminal failure fix schemas accept the browser terminal-failure context", () => {
  const context = {
    actionId: "run_automated_checks",
    actionLabel: "Run automated checks",
    attemptedCommand: "npm run verify",
    closeError: "Run automated checks failed with exit code 1.",
    commandPreview: "npm run verify",
    currentStep: "review_and_validate",
    exitCode: "1",
    output: "eslint failed",
    sessionId: "2026-05-28_16-18-28",
    stepStatus: "waiting_for_input",
    terminalKind: "command",
    terminalSessionId: "terminal-1",
    terminalStatus: "exited",
    userMessage: ""
  };

  const directFixResult = sessionTerminalFixInputValidator.schema.create(context);
  assert.deepEqual(directFixResult.errors, {});
  assert.equal(directFixResult.validatedObject.currentStep, "review_and_validate");
  assert.equal(directFixResult.validatedObject.stepStatus, "waiting_for_input");

  const promptRequestResult = sessionTerminalFailureFixInputValidator.schema.create(context);
  assert.deepEqual(promptRequestResult.errors, {});
  assert.equal(promptRequestResult.validatedObject.attemptedCommand, "npm run verify");
});
