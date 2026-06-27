import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { promisify } from "node:util";

import {
  VIBE64_AGENT_RUN_STATE,
  VIBE64_SESSION_STATUS,
  vibe64AgentRunStateIsActive,
  Vibe64SessionRuntime
} from "@local/vibe64-runtime/server";
import {
  CODEX_ATTACHMENT_CONTAINER_ROOT,
  VIBE64_CODEX_ATTACHMENTS_ROOT_ENV
} from "@local/vibe64-runtime/server/codexAttachmentPaths";
import {
  VIBE64_CODEX_GIT_COMMAND_SYSTEM_ACTOR_SCOPE_ENV,
  VIBE64_CODEX_GIT_COMMAND_SYSTEM_ACTOR_TARGET_ROOT_ENV,
  VIBE64_CODEX_GIT_COMMAND_SYSTEM_ACTOR_USER_KEY_ENV,
  VIBE64_CODEX_GIT_COMMAND_SYSTEM_ACTOR_WORKDIR_ENV
} from "@local/vibe64-terminals/server/codexGitCommand";
import {
  AGENT_TURN_RESULT_BEGIN,
  AGENT_TURN_RESULT_END,
  AGENT_TURN_RESULT_SCHEMA
} from "@local/vibe64-runtime/server/agentTurnResults";
import {
  TargetAdapter,
  adapterProjectFacts
} from "@local/vibe64-adapters/server";
import {
  runWithProjectRequestContext
} from "@local/vibe64-core/server/projectRequestContext";
import {
  readProjectRuntimeOpenState,
  writeProjectRuntimeOpenState
} from "@local/vibe64-core/server/projectRuntimeOpenState";
import {
  CODEX_RECONNECT_REQUIRED_CODE,
  CODEX_RECONNECT_REQUIRED_MESSAGE
} from "@local/vibe64-core/shared";
import {
  RUNTIME_CONFIG_PHASES
} from "@local/vibe64-core/server/runtimeConfig";
import {
  readCodexAuthStatus
} from "@local/vibe64-core/server/codexAuthState";
import {
  createService,
  startProjectRuntimeDormancyCleanupSchedule,
  terminalNamespaceMatchesProjectScope
} from "../../packages/vibe64-terminals/src/server/service.js";
import {
  ACTION_START_COMMAND_TERMINAL,
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
  classifyCodexAppServerEvent,
  createCodexTerminalController,
  codexTerminalArgs
} from "../../packages/vibe64-terminals/src/server/codexTerminal.js";
import {
  AGENT_PREVIEW_COMMAND_NAME,
  VIBE64_AGENT_PREVIEW_COMMAND_SESSION_ID_ENV,
  VIBE64_AGENT_PREVIEW_COMMAND_SOCKET_ENV,
  VIBE64_AGENT_PREVIEW_COMMAND_TOKEN_ENV
} from "../../packages/vibe64-terminals/src/server/agentPreviewCommand.js";
import {
  createFixCodexJobStore,
  prepareFixCodexReportHelper
} from "../../packages/vibe64-terminals/src/server/fixCodexJobs.js";
import {
  COMMAND_RESULT_ENV
} from "../../packages/vibe64-terminals/src/server/commandTerminalResults.js";
import {
  commandTerminalArgs,
  createCommandTerminalController,
  createProjectToolTerminalController,
  resolveCommandTerminalToolHome
} from "../../packages/vibe64-terminals/src/server/commandTerminal.js";
import {
  createLaunchRestartBaseline,
  createLaunchTargetTerminalController,
  launchActionsFromOutput,
  launchReadinessMarkerLineSeen
} from "../../packages/vibe64-terminals/src/server/launchTargetTerminal.js";
import {
  codexTerminalNamespace,
  commandTerminalNamespace,
  fixCodexTerminalNamespace,
  globalCodexTerminalNamespace,
  launchTargetTerminalNamespace,
  shellTerminalNamespace,
  toolTerminalNamespace
} from "../../packages/vibe64-terminals/src/server/terminalShared.js";
import {
  createShellTerminalController,
  resolveShellTerminalCwd,
  resolveShellTerminalToolHome,
  shellTerminalArgs
} from "../../packages/vibe64-terminals/src/server/shellTerminal.js";
import {
  closeTerminalSession,
  closeTerminalSessionsForNamespacePrefix,
  countRunningTerminalSessions,
  readTerminalSession,
  startTerminalSession
} from "@local/studio-terminal-core/server/terminalSessions";
import {
  TERMINAL_OWNER_MISMATCH_CODE,
  terminalOwnerForGithubActor,
  terminalOwnerMetadata
} from "@local/studio-terminal-core/server/terminalOwnership";
import {
  resolveTerminalToolchainImage
} from "../../packages/vibe64-terminals/src/server/terminalToolchainImage.js";
import {
  maskedTerminalDockerArgs,
  projectTerminalEnvironment,
  runtimeConfigPhasesForCommand,
  runtimeConfigPhasesForTerminalContext
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
  STUDIO_GITHUB_PROVIDER_GH_CONFIG_DIR,
  STUDIO_GITHUB_PROVIDER_GIT_CONFIG_GLOBAL,
  STUDIO_GITHUB_PROVIDER_HOME_PATH,
  STUDIO_MANAGED_CODEX_COMMAND,
  STUDIO_MANAGED_CODEX_NO_UPDATE_CONFIG,
  STUDIO_MANAGED_TOOLCHAIN_DOCKER_RUN_PULL_ARGS,
  STUDIO_PLAYWRIGHT_BROWSERS_PATH,
  STUDIO_PLAYWRIGHT_BROWSERS_VOLUME,
  STUDIO_TOOL_HOME_BIN_PATH,
  STUDIO_TOOL_HOME_NPM_PREFIX,
  STUDIO_TOOL_HOME_PATH,
  VIBE64_LOCAL_RUNTIME_NAMESPACE,
  VIBE64_RUNTIME_NAMESPACE_ENV
} from "@local/studio-terminal-core/server/studioRuntimeIdentity";
import {
  STUDIO_MYSQL_CLIENT_CONFIG_DIR
} from "@local/studio-terminal-core/server/studioToolHome";
import {
  githubSshToHttpsGitEnv
} from "@local/studio-terminal-core/server/gitGithubTransport";
import {
  VIBE64_GITHUB_ACCOUNT_MODE_ENV,
  VIBE64_PROVIDER_HOMES_ROOT_ENV
} from "@local/studio-terminal-core/server/providerHomes";
import {
  runtimeNetworkName
} from "@local/studio-terminal-core/server/runtimeContainers";
import {
  VIBE64_SELF_TARGET_SYSTEM_ROOT_ENV
} from "@local/vibe64-core/server/studioRoots";
import { withTemporaryRoot } from "./vibe64TestHelpers.js";
import {
  assertDockerEnv,
  assertDockerVolumeMount,
  dockerEnvValue
} from "./dockerArgsTestHelpers.js";

const POST_COMMIT_TEST_TIMEOUT_MS = 500;
const CODEX_APP_SERVER_AGENT_RUN_ID = "codex_app_server";
const execFileAsync = promisify(execFile);

process.env[VIBE64_RUNTIME_NAMESPACE_ENV] = "unit-tenant";

test("Vibe64 Codex app-server event classifier keeps final answers explicit", () => {
  assert.deepEqual(classifyCodexAppServerEvent({
    method: "codex/event",
    params: {
      event: {
        payload: {
          message: "Working through the verification.",
          phase: "progress",
          type: "agent_message"
        },
        type: "event_msg"
      },
      threadId: "thread-1",
      turnId: "turn-1"
    }
  }), {
    itemId: "",
    kind: "live_progress",
    source: "event_msg",
    text: "Working through the verification.",
    threadId: "thread-1",
    turnId: "turn-1"
  });

  assert.deepEqual(classifyCodexAppServerEvent({
    method: "codex/event",
    params: {
      event: {
        payload: {
          message: "Ambiguous assistant text must not become final.",
          type: "agent_message"
        },
        type: "event_msg"
      },
      threadId: "thread-1",
      turnId: "turn-1"
    }
  }), {
    itemId: "",
    kind: "ignored",
    source: "event_msg",
    text: "",
    threadId: "thread-1",
    turnId: "turn-1"
  });

  assert.equal(classifyCodexAppServerEvent({
    method: "codex/event",
    params: {
      event: {
        payload: {
          message: "Final result.",
          phase: "final_answer",
          type: "agent_message"
        },
        type: "event_msg"
      },
      threadId: "thread-1",
      turnId: "turn-1"
    }
  }).kind, "final_assistant_result");
});

test("Vibe64 Codex app-server event classifier recognizes task completion final text", () => {
  assert.deepEqual(classifyCodexAppServerEvent({
    method: "codex/event",
    params: {
      event: {
        payload: {
          last_agent_message: "Task complete final result.",
          turn_id: "turn-1"
        },
        type: "task_complete"
      },
      threadId: "thread-1"
    }
  }), {
    itemId: "",
    kind: "final_assistant_result",
    source: "task_complete",
    text: "Task complete final result.",
    threadId: "thread-1",
    turnId: "turn-1"
  });

  assert.deepEqual(classifyCodexAppServerEvent({
    method: "task_complete",
    params: {
      lastAgentMessage: "Direct task completion final result.",
      thread_id: "thread-2",
      turn_id: "turn-2"
    }
  }), {
    itemId: "",
    kind: "final_assistant_result",
    source: "task_complete",
    text: "Direct task completion final result.",
    threadId: "thread-2",
    turnId: "turn-2"
  });
});

async function runGit(cwd, args) {
  await execFileAsync("git", args, {
    cwd
  });
}

async function noopCodexAuthPreflight() {
  return {
    ok: true
  };
}

function codexAppServerAgentRun({
  error = "",
  finishedAt = "",
  providerStatus = "inProgress",
  providerThreadId = "",
  providerTurnId = "",
  startedAt = "",
  state = VIBE64_AGENT_RUN_STATE.ACTIVE,
  stepId = "",
  stepStatus = "",
  updatedAt = ""
} = {}) {
  return {
    active: vibe64AgentRunStateIsActive(state),
    error,
    events: [],
    finishedAt,
    id: CODEX_APP_SERVER_AGENT_RUN_ID,
    provider: "codex",
    providerInterface: "app-server",
    providerStatus,
    providerThreadId,
    providerTurnId,
    startedAt,
    stepId,
    stepStatus,
    updatedAt,
    state
  };
}

function codexAppServerAgentRunSnapshot(session = {}) {
  return (Array.isArray(session.agentRuns) ? session.agentRuns : [])
    .find((run) => run.id === CODEX_APP_SERVER_AGENT_RUN_ID) || null;
}

function assertCodexSteerProviderInput(input = "", userText = "", {
  stepId = "",
  stepStatus = ""
} = {}) {
  assert.match(input, /Vibe64 steering update for the active Codex turn/u);
  assert.match(input, /Do not stop the turn just to answer this steering text/u);
  assert.match(input, /finish with the normal Vibe64 agent result envelope/u);
  assert.ok(input.includes(AGENT_TURN_RESULT_BEGIN));
  assert.ok(input.includes(AGENT_TURN_RESULT_END));
  assert.ok(input.includes(`"schema": "${AGENT_TURN_RESULT_SCHEMA}"`));
  assert.match(input, /"stepStatus": "(?!\{\{)[^"]+"/u);
  assert.ok(input.includes(userText));
  if (stepId) {
    assert.ok(input.includes(`"stepId": "${stepId}"`));
  }
  if (stepStatus) {
    assert.ok(input.includes(`"stepStatus": "${stepStatus}"`));
  }
}

function writeAgentRunEventToSession(session = {}, runId = "", {
  event = {},
  patch = {}
} = {}) {
  const runs = Array.isArray(session.agentRuns) ? session.agentRuns : [];
  const existing = runs.find((run) => run.id === runId) || {
    events: [],
    id: runId
  };
  const state = String(patch.state || existing.state || "");
  const updated = {
    ...existing,
    ...patch,
    active: vibe64AgentRunStateIsActive(state),
    events: [
      ...(Array.isArray(existing.events) ? existing.events : []),
      {
        ...event,
        createdAt: event.createdAt || "2000-01-01T00:00:00.000Z"
      }
    ],
    id: runId
  };
  session.agentRuns = [
    ...runs.filter((run) => run.id !== runId),
    updated
  ];
  return updated;
}

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

class MissingToolchainCommandAdapter extends UnitCommandAdapter {
  async getTerminalToolchainSpec() {
    return {
      image: "vibe64-service-test-missing-toolchain:never",
      label: "Service test missing toolchain"
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

test("launch readiness markers must be emitted as standalone output lines", () => {
  const marker = "[[VIBE64_LAUNCH_READY_V1:unit-test]]";

  assert.equal(
    launchReadinessMarkerLineSeen(`[studio] $ node -e 'console.log("${marker}")'\n`, marker),
    false
  );
  assert.equal(
    launchReadinessMarkerLineSeen(`[studio] Starting app\n\u001b[32m${marker}\u001b[0m\n`, marker),
    true
  );
});

test("launch terminal stop treats a missing terminal session as recovered stale state", async () => {
  const controller = createLaunchTargetTerminalController({});
  const stopped = await controller.stopTerminal("session-1", "missing-terminal");

  assert.equal(stopped.ok, true);
  assert.equal(stopped.id, "missing-terminal");
  assert.equal(stopped.running, false);
  assert.equal(stopped.stale, true);
  assert.equal(stopped.status, "exited");
});

test("launch terminal close removes stale launch containers for the session", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "launch-close-stale-containers";
    const removedLaunchContainers = [];
    const controller = createLaunchTargetTerminalController({
      projectService: {
        currentTargetRoot() {
          return targetRoot;
        },
        targetRoot,
        async createRuntime() {
          return {
            async getSession() {
              return {
                sessionId
              };
            }
          };
        }
      },
      removeLaunchTargetContainersImpl: async (options) => {
        removedLaunchContainers.push(options);
        return ["container-1"];
      }
    });

    const result = await controller.closeAllForSession(sessionId);

    assert.equal(result.ok, true);
    assert.deepEqual(result.removedContainers, ["container-1"]);
    assert.deepEqual(removedLaunchContainers, [
      {
        sessionId,
        targetRoot
      }
    ]);
  });
});

test("launch status does not expose a preview for an exited launch terminal", async () => {
  const sessionId = "launch-exited-session";
  const namespace = launchTargetTerminalNamespace(sessionId);
  startTerminalSession({
    command: "node",
    args: [
      "-e",
      "process.exit(0)"
    ],
    metadata: {
      launchTargetId: "dev",
      openTarget: {
        href: "http://127.0.0.1:4100/app",
        kind: "url",
        label: "Open browser"
      }
    },
    namespace
  });
  await waitForNoRunningTerminals(namespace);

  const controller = createLaunchTargetTerminalController({
    projectService: {
      async createRuntime() {
        return {
          adapter: {
            async listLaunchTargets() {
              return [
                {
                  id: "dev",
                  label: "Run app"
                }
              ];
            }
          },
          async getSession() {
            return {
              id: sessionId,
              metadata: {
                launch_target_id: "dev",
                launch_target_label: "Run app",
                launch_target_open_href: "http://127.0.0.1:4100/app",
                launch_target_open_kind: "url",
                launch_target_open_label: "Open browser"
              },
              targetRoot: "/tmp/vibe64-launch-exited"
            };
          },
          projectConfig: {}
        };
      }
    }
  });

  const status = await controller.launchStatus(sessionId);

  assert.equal(status.ok, true);
  assert.equal(status.activeTerminal.running, false);
  assert.equal(status.preview.state, "stopped");
  assert.equal(status.preview.message, "The preview process exited.");
  assert.equal(status.preview.href, "");
  assert.equal(status.preview.targetHref, "http://127.0.0.1:4100/app");
  assert.equal(status.previewTarget.available, false);
  assert.equal(status.previewTarget.href, "");
  assert.equal(status.previewTarget.targetHref, "http://127.0.0.1:4100/app");
  assert.equal(status.openTarget.previewHref, "");
});

test("launch status returns idle when no launch terminal or metadata exists", async () => {
  const sessionId = "launch-status-idle-empty-session";
  const controller = createLaunchTargetTerminalController({
    listRunningLaunchTargetContainersImpl: async () => [],
    projectService: {
      async createRuntime() {
        return {
          adapter: {
            async listLaunchTargets() {
              return [
                {
                  id: "dev",
                  label: "Run app"
                }
              ];
            }
          },
          async getSession() {
            return {
              id: sessionId,
              metadata: {},
              targetRoot: "/tmp/vibe64-launch-status-idle-empty"
            };
          },
          projectConfig: {}
        };
      }
    }
  });

  const status = await controller.launchStatus(sessionId);

  assert.equal(status.ok, true);
  assert.equal(status.activeTerminal, null);
  assert.equal(status.preview.state, "idle");
  assert.equal(status.preview.message, "Run a launch target first.");
  assert.equal(status.preview.canStart, true);
  assert.equal(status.previewTarget.available, false);
  assert.equal(status.openTarget.available, false);
});

test("launch status does not expose a preview before launch readiness", async () => {
  const sessionId = "launch-starting-session";
  const namespace = launchTargetTerminalNamespace(sessionId);
  const terminal = startTerminalSession({
    args: [
      "-e",
      "setInterval(() => {}, 1000)"
    ],
    command: process.execPath,
    metadata: {
      launchReady: false,
      launchTargetId: "dev",
      openTarget: {
        href: "http://127.0.0.1:4100/app",
        kind: "url",
        label: "Open browser"
      }
    },
    namespace
  });
  assert.equal(terminal.ok, true);

  const controller = createLaunchTargetTerminalController({
    projectService: {
      async createRuntime() {
        return {
          adapter: {
            async listLaunchTargets() {
              return [
                {
                  id: "dev",
                  label: "Run app"
                }
              ];
            }
          },
          async getSession() {
            return {
              id: sessionId,
              metadata: {
                launch_target_id: "dev",
                launch_target_label: "Run app",
                launch_target_open_href: "http://127.0.0.1:4100/app",
                launch_target_open_kind: "url",
                launch_target_open_label: "Open browser"
              },
              targetRoot: "/tmp/vibe64-launch-starting"
            };
          },
          projectConfig: {}
        };
      }
    }
  });

  try {
    const status = await controller.launchStatus(sessionId);

    assert.equal(status.ok, true);
    assert.equal(status.activeTerminal.running, true);
    assert.equal(status.preview.state, "starting");
    assert.equal(status.preview.message, "Preparing preview.");
    assert.equal(status.preview.href, "");
    assert.equal(status.preview.targetHref, "http://127.0.0.1:4100/app");
    assert.equal(status.previewTarget.available, false);
    assert.equal(status.previewTarget.disabledReason, "Preparing preview.");
    assert.equal(status.previewTarget.href, "");
    assert.equal(status.previewTarget.targetHref, "http://127.0.0.1:4100/app");
    assert.equal(status.openTarget.previewHref, "");
  } finally {
    await closeTerminalSession(terminal.id, {
      namespace
    });
  }
});

test("launch status repairs a running preview when the readiness marker was missed", async () => {
  const sessionId = "launch-ready-probe-repair";
  const namespace = launchTargetTerminalNamespace(sessionId);
  const writtenMetadata = {};
  const published = [];
  const probed = [];
  const store = {
    async mutateSession(_sessionId, operation) {
      return operation();
    },
    async writeMetadataValue(_sessionId, name, value) {
      writtenMetadata[name] = value;
    }
  };
  const terminal = startTerminalSession({
    args: [
      "-e",
      "process.stdin.resume(); setInterval(() => {}, 1000);"
    ],
    command: process.execPath,
    metadata: {
      launchReady: false,
      launchTargetId: "dev",
      launchTargetLabel: "Run app",
      openTarget: {
        href: "http://127.0.0.1:4100/app",
        kind: "url",
        label: "Open browser"
      },
      previewAuth: "",
      sessionRoot: "/tmp/vibe64-launch-ready-probe/session",
      targetRoot: "/tmp/vibe64-launch-ready-probe",
      targetUrl: "http://127.0.0.1:4100/app"
    },
    namespace
  });
  assert.equal(terminal.ok, true);
  const controller = createLaunchTargetTerminalController({
    probeLaunchTargetImpl: async (href, options) => {
      probed.push({
        href,
        targetHref: options.targetHref,
        terminalSessionId: options.terminal.id,
        timeoutMs: options.timeoutMs
      });
      return true;
    },
    projectService: {
      async createRuntime() {
        return {
          adapter: {
            async listLaunchTargets() {
              return [
                {
                  id: "dev",
                  label: "Run app"
                }
              ];
            }
          },
          async getSession() {
            return {
              id: sessionId,
              metadata: {},
              targetRoot: "/tmp/vibe64-launch-ready-probe"
            };
          },
          projectConfig: {},
          store
        };
      }
    },
    publishSessionChanged: async (publishedSessionId, payload) => {
      published.push({
        payload,
        sessionId: publishedSessionId
      });
    }
  });

  try {
    const status = await controller.launchStatus(sessionId);

    assert.equal(status.ok, true);
    assert.equal(status.preview.state, "ready");
    assert.match(status.preview.href, /^http:\/\/127\.0\.0\.1:/u);
    assert.equal(status.preview.targetHref, "http://127.0.0.1:4100/app");
    assert.equal(status.preview.terminalId, terminal.id);
    assert.equal(status.previewTarget.available, true);
    assert.equal(status.openTarget.previewHref, status.preview.href);
    assert.deepEqual(probed, [
      {
        href: "http://127.0.0.1:4100/app",
        targetHref: "http://127.0.0.1:4100/app",
        terminalSessionId: terminal.id,
        timeoutMs: 1500
      }
    ]);
    assert.equal(readTerminalSession(terminal.id, {
      namespace
    }).metadata.launchReady, true);
    assert.equal(readTerminalSession(terminal.id, {
      namespace
    }).metadata.launchReadySource, "target-probe");
    assert.equal(writtenMetadata.launch_target_id, "dev");
    assert.equal(writtenMetadata.launch_target_open_href, "http://127.0.0.1:4100/app");
    assert.equal(writtenMetadata.launch_target_terminal_id, terminal.id);
    assert.deepEqual(published, [
      {
        payload: {
          reason: "launch-target-ready"
        },
        sessionId
      }
    ]);
  } finally {
    await controller.closeAllForSession(sessionId);
  }
});

test("launch status keeps a running preview in starting state when readiness repair probe fails", async () => {
  const sessionId = "launch-ready-probe-fails";
  const namespace = launchTargetTerminalNamespace(sessionId);
  const writtenMetadata = {};
  const published = [];
  const terminal = startTerminalSession({
    args: [
      "-e",
      "process.stdin.resume(); setInterval(() => {}, 1000);"
    ],
    command: process.execPath,
    metadata: {
      launchReady: false,
      launchTargetId: "dev",
      launchTargetLabel: "Run app",
      openTarget: {
        href: "http://127.0.0.1:4100/app",
        kind: "url",
        label: "Open browser"
      },
      targetUrl: "http://127.0.0.1:4100/app"
    },
    namespace
  });
  assert.equal(terminal.ok, true);
  const controller = createLaunchTargetTerminalController({
    probeLaunchTargetImpl: async () => false,
    projectService: {
      async createRuntime() {
        return {
          adapter: {
            async listLaunchTargets() {
              return [
                {
                  id: "dev",
                  label: "Run app"
                }
              ];
            }
          },
          async getSession() {
            return {
              id: sessionId,
              metadata: {},
              targetRoot: "/tmp/vibe64-launch-ready-probe-fails"
            };
          },
          projectConfig: {},
          store: {
            async mutateSession(_sessionId, operation) {
              return operation();
            },
            async writeMetadataValue(_sessionId, name, value) {
              writtenMetadata[name] = value;
            }
          }
        };
      }
    },
    publishSessionChanged: async (publishedSessionId, payload) => {
      published.push({
        payload,
        sessionId: publishedSessionId
      });
    }
  });

  try {
    const status = await controller.launchStatus(sessionId);

    assert.equal(status.ok, true);
    assert.equal(status.preview.state, "starting");
    assert.equal(status.preview.href, "");
    assert.equal(status.preview.targetHref, "http://127.0.0.1:4100/app");
    assert.equal(status.previewTarget.available, false);
    assert.equal(status.previewTarget.disabledReason, "Preparing preview.");
    assert.deepEqual(writtenMetadata, {});
    assert.deepEqual(published, []);
    assert.equal(readTerminalSession(terminal.id, {
      namespace
    }).metadata.launchReady, false);
  } finally {
    await controller.closeAllForSession(sessionId);
  }
});

test("launch status reports exit code 137 as failed preview state", async () => {
  const sessionId = "launch-exited-137-session";
  const namespace = launchTargetTerminalNamespace(sessionId);
  startTerminalSession({
    args: [
      "-e",
      "process.exit(137)"
    ],
    command: process.execPath,
    metadata: {
      launchTargetId: "dev",
      openTarget: {
        href: "http://127.0.0.1:4100/app",
        kind: "url",
        label: "Open browser"
      }
    },
    namespace
  });
  await waitForNoRunningTerminals(namespace);
  const controller = createLaunchTargetTerminalController({
    projectService: {
      async createRuntime() {
        return {
          adapter: {
            async listLaunchTargets() {
              return [
                {
                  id: "dev",
                  label: "Run app"
                }
              ];
            }
          },
          async getSession() {
            return {
              id: sessionId,
              metadata: {
                launch_target_id: "dev",
                launch_target_label: "Run app",
                launch_target_open_href: "http://127.0.0.1:4100/app",
                launch_target_open_kind: "url",
                launch_target_open_label: "Open browser"
              },
              targetRoot: "/tmp/vibe64-launch-exited-137"
            };
          },
          projectConfig: {}
        };
      }
    }
  });

  const status = await controller.launchStatus(sessionId);

  assert.equal(status.ok, true);
  assert.equal(status.preview.state, "failed");
  assert.match(status.preview.message, /137/u);
  assert.equal(status.previewTarget.available, false);
  assert.match(status.previewTarget.disabledReason, /137/u);
});

test("launch status recovers preview from a running launch container after terminal memory is lost", async () => {
  const sessionId = "launch-restart-reattach";
  const targetRoot = "/tmp/vibe64-launch-reattach";
  const containersSeen = [];
  const controller = createLaunchTargetTerminalController({
    listRunningLaunchTargetContainersImpl: async (options) => {
      containersSeen.push(options);
      return [
        {
          id: "container-reattach",
          name: "vibe64-launch-reattach",
          status: "Up 1 minute",
          terminalId: "terminal-reattach"
        }
      ];
    },
    projectService: {
      async createRuntime() {
        return {
          adapter: {
            async listLaunchTargets() {
              return [
                {
                  id: "dev",
                  label: "Run app"
                }
              ];
            }
          },
          async getSession() {
            return {
              id: sessionId,
              metadata: {
                launch_target_id: "dev",
                launch_target_label: "Run app",
                launch_target_open_href: "http://127.0.0.1:4100/app",
                launch_target_open_kind: "url",
                launch_target_open_label: "Open browser",
                launch_target_started_at: "2026-06-25T00:00:00.000Z"
              },
              targetRoot
            };
          },
          projectConfig: {}
        };
      }
    }
  });

  try {
    const status = await controller.launchStatus(sessionId);

    assert.equal(status.ok, true);
    assert.equal(containersSeen.length, 1);
    assert.equal(containersSeen[0].sessionId, sessionId);
    assert.equal(containersSeen[0].targetRoot, targetRoot);
    assert.equal(status.activeTerminal, null);
    assert.equal(status.preview.state, "ready");
    assert.match(status.preview.href, /^http:\/\/127\.0\.0\.1:/u);
    assert.equal(status.preview.targetHref, "http://127.0.0.1:4100/app");
    assert.equal(status.preview.terminalId, "terminal-reattach");
    assert.equal(status.previewTarget.available, true);
    assert.match(status.previewTarget.href, /^http:\/\/127\.0\.0\.1:/u);
    assert.equal(status.previewTarget.targetHref, "http://127.0.0.1:4100/app");
    assert.equal(status.openTarget.previewHref, status.previewTarget.href);
  } finally {
    await controller.closeAllForSession(sessionId);
  }
});

test("launch status detects stale server files after reattaching preview container", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "launch-restart-reattach-stale";
    await mkdir(path.join(targetRoot, "server"), {
      recursive: true
    });
    await writeFile(path.join(targetRoot, "server", "app.js"), "export const value = 1;\n");
    await runGit(targetRoot, ["init", "--initial-branch=main"]);
    await runGit(targetRoot, ["config", "user.email", "vibe64@example.test"]);
    await runGit(targetRoot, ["config", "user.name", "Vibe64 Test"]);
    await runGit(targetRoot, ["add", "."]);
    await runGit(targetRoot, ["commit", "-m", "Initial app"]);
    const baseline = await createLaunchRestartBaseline({
      restartOnChange: {
        include: ["server/**"],
        label: "server files"
      },
      worktreePath: targetRoot
    });
    await writeFile(path.join(targetRoot, "server", "app.js"), "export const value = 2;\n");

    const controller = createLaunchTargetTerminalController({
      listRunningLaunchTargetContainersImpl: async () => [
        {
          id: "container-reattach-stale",
          name: "vibe64-launch-reattach-stale",
          status: "Up 1 minute",
          terminalId: "terminal-reattach-stale"
        }
      ],
      projectService: {
        async createRuntime() {
          return {
            adapter: {
              async listLaunchTargets() {
                return [
                  {
                    id: "dev",
                    label: "Run app"
                  }
                ];
              }
            },
            async getSession() {
              return {
                id: sessionId,
                metadata: {
                  launch_target_id: "dev",
                  launch_target_label: "Run app",
                  launch_target_open_href: "http://127.0.0.1:4100/app",
                  launch_target_open_kind: "url",
                  launch_target_open_label: "Open browser",
                  launch_target_restart_baseline: JSON.stringify(baseline),
                  launch_target_started_at: "2026-06-25T00:00:00.000Z"
                },
                targetRoot
              };
            },
            projectConfig: {}
          };
        }
      }
    });

    try {
      const status = await controller.launchStatus(sessionId);

      assert.equal(status.ok, true);
      assert.equal(status.activeTerminal, null);
      assert.equal(status.preview.state, "stale");
      assert.equal(status.preview.reason, "server_source_changed");
      assert.deepEqual(status.preview.recovery.changedFiles, ["server/app.js"]);
      assert.equal(status.previewTarget.available, true);
      assert.equal(status.previewTarget.stale, true);
      assert.deepEqual(status.previewTarget.recovery.changedFiles, ["server/app.js"]);
      assert.equal(status.previewTarget.recovery.label, "server files");
      assert.equal(status.previewTarget.recovery.reason, "server_source_changed");
    } finally {
      await controller.closeAllForSession(sessionId);
    }
  });
});

test("launch status surfaces stale preview recovery when restart reconciliation cannot reattach", async () => {
  const sessionId = "launch-restart-stale";
  const targetRoot = "/tmp/vibe64-launch-stale";
  const controller = createLaunchTargetTerminalController({
    listRunningLaunchTargetContainersImpl: async () => [
      {
        id: "container-stale",
        name: "vibe64-launch-stale",
        status: "Up 2 minutes",
        terminalId: ""
      }
    ],
    projectService: {
      async createRuntime() {
        return {
          adapter: {
            async listLaunchTargets() {
              return [
                {
                  id: "dev",
                  label: "Run app"
                }
              ];
            }
          },
          async getSession() {
            return {
              id: sessionId,
              metadata: {
                launch_target_id: "dev",
                launch_target_label: "Run app",
                launch_target_open_href: "http://127.0.0.1:4100/app",
                launch_target_open_kind: "url",
                launch_target_open_label: "Open browser"
              },
              targetRoot
            };
          },
          projectConfig: {}
        };
      }
    }
  });

  const status = await controller.launchStatus(sessionId);

  assert.equal(status.ok, true);
  assert.equal(status.activeTerminal, null);
  assert.equal(status.preview.state, "failed");
  assert.equal(status.preview.reason, "server_restart_state_lost");
  assert.equal(status.preview.canRestart, true);
  assert.equal(status.preview.recovery.canStopStale, true);
  assert.equal(status.previewTarget.available, false);
  assert.equal(status.previewTarget.href, "");
  assert.equal(
    status.previewTarget.disabledReason,
    "Preview state was lost after a server restart. Restart preview to recover."
  );
  assert.equal(status.previewTarget.targetHref, "http://127.0.0.1:4100/app");
  assert.deepEqual(status.previewTarget.recovery, {
    canRestart: true,
    canStopStale: true,
    containerId: "container-stale",
    containerName: "vibe64-launch-stale",
    reason: "server_restart_state_lost",
    terminalSessionId: ""
  });
});

test("launch status clears stale launch metadata when the launch container is gone", async () => {
  const sessionId = "launch-restart-missing-container";
  const targetRoot = "/tmp/vibe64-launch-missing-container";
  const deletedMetadata = [];
  const published = [];
  const containerLookups = [];
  const metadata = {
    launch_target_agent_href: "http://vibe64-launch-deadbeef0000:4100/app",
    launch_target_id: "dev",
    launch_target_label: "Run app",
    launch_target_open_href: "http://127.0.0.1:4100/app",
    launch_target_open_kind: "url",
    launch_target_open_label: "Open browser",
    launch_target_preview_auth: "jskit-dev",
    launch_target_restart_baseline: "{\"version\":1}",
    launch_target_session_root: "/tmp/vibe64-launch-missing-container/session",
    launch_target_started_at: "2026-06-25T00:00:00.000Z",
    launch_target_terminal_id: "terminal-dead"
  };
  const store = {
    async deleteMetadataValue(_sessionId, name) {
      deletedMetadata.push(name);
      delete metadata[name];
    },
    async mutateSession(_sessionId, operation) {
      return operation();
    }
  };
  const controller = createLaunchTargetTerminalController({
    listRunningLaunchTargetContainersImpl: async (options) => {
      containerLookups.push(options);
      return [];
    },
    projectService: {
      async createRuntime() {
        return {
          adapter: {
            async listLaunchTargets() {
              return [
                {
                  id: "dev",
                  label: "Run app"
                }
              ];
            }
          },
          async getSession() {
            return {
              id: sessionId,
              metadata: {
                ...metadata
              },
              targetRoot
            };
          },
          projectConfig: {},
          store
        };
      }
    },
    publishSessionChanged: async (publishedSessionId, payload) => {
      published.push({
        payload,
        sessionId: publishedSessionId
      });
    }
  });

  const status = await controller.launchStatus(sessionId);

  assert.equal(status.ok, true);
  assert.equal(containerLookups.length, 1);
  assert.deepEqual(containerLookups[0], {
    sessionId,
    targetRoot
  });
  assert.equal(status.activeTerminal, null);
  assert.equal(status.lastLaunchTarget, null);
  assert.equal(status.openTarget.available, false);
  assert.equal(status.preview.state, "failed");
  assert.equal(status.preview.reason, "server_restart_state_lost");
  assert.equal(status.preview.canRestart, true);
  assert.equal(status.preview.targetHref, "http://127.0.0.1:4100/app");
  assert.equal(status.previewTarget.available, false);
  assert.equal(
    status.previewTarget.disabledReason,
    "Preview state was lost after a server restart. Restart preview to recover."
  );
  assert.equal(status.previewTarget.targetHref, "http://127.0.0.1:4100/app");
  assert.deepEqual(status.previewTarget.recovery, {
    canRestart: true,
    canStopStale: false,
    containerId: "",
    containerName: "",
    reason: "server_restart_state_lost",
    terminalSessionId: ""
  });
  assert.deepEqual(deletedMetadata.sort(), [
    "launch_target_agent_href",
    "launch_target_id",
    "launch_target_input",
    "launch_target_label",
    "launch_target_open_href",
    "launch_target_open_kind",
    "launch_target_open_label",
    "launch_target_preview_auth",
    "launch_target_restart_baseline",
    "launch_target_session_root",
    "launch_target_started_at",
    "launch_target_terminal_id"
  ].sort());
  assert.deepEqual(published, [
    {
      payload: {
        reason: "launch-target-stale-cleared"
      },
      sessionId
    }
  ]);
});

test("launch terminal close clears prompt-visible launch metadata for that terminal", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "launch-close-clears-metadata";
    const namespace = launchTargetTerminalNamespace(sessionId);
    const metadata = {};
    const deletedMetadata = [];
    const published = [];
    const session = {
      metadata: {},
      sessionId,
      sessionRoot: path.join(targetRoot, ".vibe64", "sessions", "active", sessionId),
      targetRoot
    };
    const controller = createLaunchTargetTerminalController({
      ensureLaunchTargetRuntimeImpl: async () => null,
      projectService: {
        targetRoot,
        async createRuntime() {
          return {
            adapter: {
              async createLaunchTargetTerminalSpec() {
                return {
                  args: [
                    "-e",
                    "setInterval(() => {}, 1000)"
                  ],
                  command: process.execPath,
                  cwd: targetRoot,
                  metadata: {
                    agentTargetHref: "http://vibe64-launch-agent:4100/app",
                    launchTargetId: "dev",
                    openTarget: {
                      href: "http://127.0.0.1:4100/app",
                      kind: "url",
                      label: "Open browser"
                    },
                    previewAuth: "jskit-dev",
                    targetUrl: "http://127.0.0.1:4100/app",
                    targetRoot
                  },
                  ok: true,
                  reuseRunning: true
                };
              },
              async listLaunchTargets() {
                return [
                  {
                    id: "dev",
                    label: "Run app"
                  }
                ];
              }
            },
            async getSession() {
              return session;
            },
            projectConfig: {},
            store: {
              async deleteMetadataValue(_sessionId, key) {
                deletedMetadata.push(key);
                delete metadata[key];
              },
              async mutateSession(_sessionId, operation) {
                await operation();
              },
              async readMetadataValue(_sessionId, key) {
                return metadata[key] || "";
              },
              async writeMetadataValue(_sessionId, key, value) {
                metadata[key] = value;
              }
            }
          };
        },
        async projectConfigEnvironment() {
          return {};
        }
      },
      publishSessionChanged: async (publishedSessionId, payload) => {
        published.push({
          payload,
          sessionId: publishedSessionId
        });
      }
    });

    const terminal = await controller.startTerminal(sessionId, {
      launchTargetId: "dev"
    });
    assert.equal(terminal.ok, true);
    assert.equal(metadata.launch_target_terminal_id, terminal.id);
    assert.equal(metadata.launch_target_agent_href, "http://vibe64-launch-agent:4100/app");

    await closeTerminalSession(terminal.id, {
      namespace
    });
    for (let attempt = 0; attempt < 20 && metadata.launch_target_terminal_id; attempt += 1) {
      await delay(10);
    }

    assert.equal(metadata.launch_target_terminal_id, undefined);
    assert.ok(deletedMetadata.includes("launch_target_agent_href"));
    assert.ok(deletedMetadata.includes("launch_target_terminal_id"));
    assert.deepEqual(published, [
      {
        payload: {
          reason: "launch-target-stale-cleared"
        },
        sessionId
      }
    ]);
  });
});

test("launch readiness waits for the terminal to survive the stability gate", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "launch-ready-stability";
    const namespace = launchTargetTerminalNamespace(sessionId);
    const readinessMarker = "[[VIBE64_LAUNCH_READY_V1:stable]]";
    const metadata = {};
    const published = [];
    const session = {
      metadata: {},
      sessionId,
      sessionRoot: path.join(targetRoot, ".vibe64", "sessions", "active", sessionId),
      targetRoot
    };
    const controller = createLaunchTargetTerminalController({
      ensureLaunchTargetRuntimeImpl: async () => null,
      launchReadyStabilityDelayMs: 80,
      projectService: {
        targetRoot,
        async createRuntime() {
          return {
            adapter: {
              async createLaunchTargetTerminalSpec() {
                return {
                  args: [
                    "-e",
                    `console.log(${JSON.stringify(readinessMarker)}); setInterval(() => {}, 1000);`
                  ],
                  command: process.execPath,
                  cwd: targetRoot,
                  metadata: {
                    launchReady: false,
                    launchTargetId: "dev",
                    openTarget: {
                      href: "http://127.0.0.1:4100/app",
                      kind: "url",
                      label: "Open browser"
                    },
                    readinessMarker,
                    targetRoot
                  },
                  ok: true,
                  readinessMarker,
                  reuseRunning: true
                };
              },
              async listLaunchTargets() {
                return [
                  {
                    id: "dev",
                    label: "Run app"
                  }
                ];
              }
            },
            async getSession() {
              return session;
            },
            projectConfig: {},
            store: {
              async deleteMetadataValue(_sessionId, key) {
                delete metadata[key];
              },
              async mutateSession(_sessionId, operation) {
                await operation();
              },
              async readMetadataValue(_sessionId, key) {
                return metadata[key] || "";
              },
              async writeMetadataValue(_sessionId, key, value) {
                metadata[key] = value;
              }
            }
          };
        },
        async projectConfigEnvironment() {
          return {};
        }
      },
      publishSessionChanged: async (publishedSessionId, payload) => {
        published.push({
          payload,
          sessionId: publishedSessionId
        });
      }
    });

    const terminal = await controller.startTerminal(sessionId, {
      launchTargetId: "dev"
    });

    try {
      assert.equal(terminal.ok, true);
      await delay(20);
      assert.equal(metadata.launch_target_id, undefined);
      for (let attempt = 0; attempt < 20 && !metadata.launch_target_id; attempt += 1) {
        await delay(10);
      }
      assert.equal(metadata.launch_target_id, "dev");
      assert.equal(metadata.launch_target_terminal_id, terminal.id);
      assert.deepEqual(published, [
        {
          payload: {
            reason: "launch-target-ready"
          },
          sessionId
        }
      ]);
    } finally {
      await closeTerminalSession(terminal.id, {
        namespace
      });
    }
  });
});

test("launch readiness is not published when the terminal exits during the stability gate", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "launch-ready-dies-before-stable";
    const readinessMarker = "[[VIBE64_LAUNCH_READY_V1:unstable]]";
    const metadata = {};
    const published = [];
    const session = {
      metadata: {},
      sessionId,
      sessionRoot: path.join(targetRoot, ".vibe64", "sessions", "active", sessionId),
      targetRoot
    };
    const controller = createLaunchTargetTerminalController({
      ensureLaunchTargetRuntimeImpl: async () => null,
      launchReadyStabilityDelayMs: 80,
      projectService: {
        targetRoot,
        async createRuntime() {
          return {
            adapter: {
              async createLaunchTargetTerminalSpec() {
                return {
                  args: [
                    "-e",
                    `console.log(${JSON.stringify(readinessMarker)});`
                  ],
                  command: process.execPath,
                  cwd: targetRoot,
                  metadata: {
                    launchReady: false,
                    launchTargetId: "dev",
                    openTarget: {
                      href: "http://127.0.0.1:4100/app",
                      kind: "url",
                      label: "Open browser"
                    },
                    readinessMarker,
                    targetRoot
                  },
                  ok: true,
                  readinessMarker,
                  reuseRunning: true
                };
              },
              async listLaunchTargets() {
                return [
                  {
                    id: "dev",
                    label: "Run app"
                  }
                ];
              }
            },
            async getSession() {
              return session;
            },
            projectConfig: {},
            store: {
              async deleteMetadataValue(_sessionId, key) {
                delete metadata[key];
              },
              async mutateSession(_sessionId, operation) {
                await operation();
              },
              async readMetadataValue(_sessionId, key) {
                return metadata[key] || "";
              },
              async writeMetadataValue(_sessionId, key, value) {
                metadata[key] = value;
              }
            }
          };
        },
        async projectConfigEnvironment() {
          return {};
        }
      },
      publishSessionChanged: async (publishedSessionId, payload) => {
        published.push({
          payload,
          sessionId: publishedSessionId
        });
      }
    });

    const terminal = await controller.startTerminal(sessionId, {
      launchTargetId: "dev"
    });

    assert.equal(terminal.ok, true);
    await delay(160);
    assert.equal(metadata.launch_target_id, undefined);
    assert.deepEqual(published, []);
    assert.equal(readTerminalSession(terminal.id, {
      namespace: launchTargetTerminalNamespace(sessionId)
    }).status, "exited");
  });
});

test("launch start closes superseded terminals before replacing a non-reusable preview", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "launch-replace-session";
    const namespace = launchTargetTerminalNamespace(sessionId);
    const metadataWrites = [];
    const removedLaunchContainers = [];
    await mkdir(path.join(targetRoot, "server"), {
      recursive: true
    });
    await writeFile(path.join(targetRoot, "server", "app.js"), "export const value = 1;\n");
    await runGit(targetRoot, ["init", "--initial-branch=main"]);
    await runGit(targetRoot, ["config", "user.email", "vibe64@example.test"]);
    await runGit(targetRoot, ["config", "user.name", "Vibe64 Test"]);
    await runGit(targetRoot, ["add", "."]);
    await runGit(targetRoot, ["commit", "-m", "Initial app"]);
    const session = {
      metadata: {},
      sessionId,
      sessionRoot: path.join(targetRoot, ".vibe64", "sessions", "active", sessionId),
      targetRoot
    };
    const controller = createLaunchTargetTerminalController({
      ensureLaunchTargetRuntimeImpl: async () => null,
      projectService: {
        targetRoot,
        async createRuntime() {
          return {
            adapter: {
              async createLaunchTargetTerminalSpec() {
                return {
                  args: [
                    "-e",
                    "setInterval(() => {}, 1000)"
                  ],
                  command: process.execPath,
                  cwd: targetRoot,
                  metadata: {
                    agentTargetHref: "http://vibe64-launch-agent:4100/app",
                    launchTargetId: "dev",
                    openTarget: {
                      href: "http://127.0.0.1:4100/app",
                      kind: "url",
                      label: "Open browser"
                    },
                    previewProxyTargetHref: "http://preview-proxy-target:4100/app",
                    targetUrl: "http://127.0.0.1:4100/app",
                    targetRoot
                  },
                  ok: true,
                  restartOnChange: {
                    include: ["server/**"],
                    label: "server files"
                  },
                  reuseRunning: true
                };
              },
              async listLaunchTargets() {
                return [
                  {
                    id: "dev",
                    label: "Run app"
                  }
                ];
              }
            },
            async getSession() {
              return session;
            },
            projectConfig: {},
            store: {
              async mutateSession(_sessionId, operation) {
                await operation();
              },
              async writeMetadataValue(_sessionId, key, value) {
                metadataWrites.push({
                  key,
                  value
                });
              }
            }
          };
        },
        async projectConfigEnvironment() {
          return {};
        }
      },
      removeLaunchTargetContainersImpl: async (options) => {
        removedLaunchContainers.push(options);
        return [];
      }
    });

    let secondTerminal = null;
    try {
      const firstTerminal = await controller.startTerminal(sessionId, {
        launchInput: {
          variant: "first"
        },
        launchTargetId: "dev"
      });
      assert.equal(firstTerminal.ok, true);
      assert.equal(countRunningTerminalSessions({ namespace }), 1);

      secondTerminal = await controller.startTerminal(sessionId, {
        launchInput: {
          variant: "second"
        },
        launchTargetId: "dev"
      });

      assert.equal(secondTerminal.ok, true);
      assert.notEqual(secondTerminal.id, firstTerminal.id);
      assert.equal(countRunningTerminalSessions({ namespace }), 1);
      assert.equal(readTerminalSession(firstTerminal.id, { namespace }).ok, false);
      assert.equal(removedLaunchContainers.length, 2);
      assert.deepEqual(removedLaunchContainers.at(-1).exceptTerminalIds, []);
      assert.equal(removedLaunchContainers.at(-1).sessionId, sessionId);
      assert.equal(removedLaunchContainers.at(-1).targetRoot, targetRoot);
      assert.ok(metadataWrites.some((entry) => entry.key === "launch_target_open_href"));
      assert.deepEqual(
        JSON.parse([...metadataWrites].reverse().find((entry) => entry.key === "launch_target_input").value),
        {
          variant: "second"
        }
      );
      const restartBaselineWrite = metadataWrites.find((entry) => entry.key === "launch_target_restart_baseline");
      assert.equal(JSON.parse(restartBaselineWrite.value).rules.label, "server files");
      assert.deepEqual(
        metadataWrites.find((entry) => entry.key === "launch_target_agent_href"),
        {
          key: "launch_target_agent_href",
          value: "http://vibe64-launch-agent:4100/app"
        }
      );
    } finally {
      if (secondTerminal?.id) {
        await closeTerminalSession(secondTerminal.id, {
          namespace
        });
      }
    }
  });
});

test("launch start keeps the current terminal when the launch can be reused", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "launch-reuse-session";
    const namespace = launchTargetTerminalNamespace(sessionId);
    const removedLaunchContainers = [];
    const session = {
      metadata: {},
      sessionId,
      sessionRoot: path.join(targetRoot, ".vibe64", "sessions", "active", sessionId),
      targetRoot
    };
    const controller = createLaunchTargetTerminalController({
      ensureLaunchTargetRuntimeImpl: async () => null,
      projectService: {
        targetRoot,
        async createRuntime() {
          return {
            adapter: {
              async createLaunchTargetTerminalSpec() {
                return {
                  args: [
                    "-e",
                    "setInterval(() => {}, 1000)"
                  ],
                  command: process.execPath,
                  cwd: targetRoot,
                  metadata: {
                    launchTargetId: "dev",
                    openTarget: {
                      href: "http://127.0.0.1:4100/app",
                      kind: "url",
                      label: "Open browser"
                    },
                    targetRoot
                  },
                  ok: true,
                  reuseRunning: true
                };
              },
              async listLaunchTargets() {
                return [
                  {
                    id: "dev",
                    label: "Run app"
                  }
                ];
              }
            },
            async getSession() {
              return session;
            },
            projectConfig: {},
            store: {
              async mutateSession(_sessionId, operation) {
                await operation();
              },
              async writeMetadataValue() {}
            }
          };
        },
        async projectConfigEnvironment() {
          return {};
        }
      },
      removeLaunchTargetContainersImpl: async (options) => {
        removedLaunchContainers.push(options);
        return [];
      }
    });

    let firstTerminal = null;
    try {
      firstTerminal = await controller.startTerminal(sessionId, {
        launchInput: {
          variant: "same"
        },
        launchTargetId: "dev"
      });
      const secondTerminal = await controller.startTerminal(sessionId, {
        launchInput: {
          variant: "same"
        },
        launchTargetId: "dev"
      });

      assert.equal(firstTerminal.ok, true);
      assert.equal(secondTerminal.ok, true);
      assert.equal(secondTerminal.id, firstTerminal.id);
      assert.equal(countRunningTerminalSessions({ namespace }), 1);
      assert.deepEqual(removedLaunchContainers.at(-1).exceptTerminalIds, [firstTerminal.id]);
    } finally {
      if (firstTerminal?.id) {
        await closeTerminalSession(firstTerminal.id, {
          namespace
        });
      }
    }
  });
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
    await delay(30);
  }
  assert.equal(entries.length, expectedLength);
}

async function waitForCondition(predicate, message = "Timed out waiting for condition.", timeoutMs = POST_COMMIT_TEST_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await delay(30);
  }
  assert.fail(message);
}

async function waitForNoRunningTerminals(namespace, timeoutMs = POST_COMMIT_TEST_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (countRunningTerminalSessions({ namespace }) > 0 && Date.now() < deadline) {
    await delay(30);
  }
  assert.equal(countRunningTerminalSessions({ namespace }), 0);
}

async function commandTerminalTestEnv(root) {
  const providerHomesRoot = path.join(root, "provider-homes");
  await mkdir(path.join(providerHomesRoot, "github", "local"), {
    recursive: true
  });
  return {
    [VIBE64_PROVIDER_HOMES_ROOT_ENV]: providerHomesRoot
  };
}

function createTestTerminalService(options = {}) {
  return createService({
    ...options,
    codexTerminalController: {
      codexAuthPreflight: noopCodexAuthPreflight,
      codexToolHomeRequired: false,
      ...(options.codexTerminalController || {})
    }
  });
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
    worktree: "/workspace/project/.vibe64-local/sessions/active/unit/worktree"
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
    worktree: "/workspace/project/.vibe64-local/sessions/active/unit/worktree"
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

test("Vibe64 Codex terminal args mount the Codex provider home as the tool home", () => {
  const targetRoot = "/workspace/project";
  const toolHomeSource = "/srv/vibe64/tenants/chiara/provider-homes/codex";
  const args = codexTerminalArgs({
    codexThreadId: "",
    containerName: "vibe64-codex-provider-home",
    sessionId: "provider-home-session",
    targetRoot,
    terminalId: "provider-home-terminal",
    toolHomeSource,
    worktree: targetRoot
  });

  assert.ok(args.includes(`${toolHomeSource}:${STUDIO_TOOL_HOME_PATH}`));
  assert.ok(!args.includes(`vibe64_tool_home:${STUDIO_TOOL_HOME_PATH}`));
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

    const terminalService = createTestTerminalService({
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
    worktree: "/workspace/project/.vibe64-local/sessions/active/startup_prompt/worktree"
  });
  const startupScript = args.at(-1);
  assert.match(startupScript, /codex/u);
  assert.doesNotMatch(startupScript, /Vibe64 session briefing/u);
  assert.doesNotMatch(startupScript, /Unit MariaDB/u);
  assert.doesNotMatch(startupScript, /resume [0-9a-f-]{36}/u);
  assert.match(
    startupScript,
    /ln -sfn "\$VIBE64_CODEX_GIT_COMMAND_WRAPPER_DIR\/\$VIBE64_CODEX_GIT_COMMAND_NAME" "\/usr\/local\/bin\/\$VIBE64_CODEX_GIT_COMMAND_NAME"/u
  );

  const resumedArgs = codexTerminalArgs({
    codexThreadId: "00000000-0000-4000-8000-000000000001",
    containerName: "vibe64-codex-startup-resume",
    sessionId: "startup_prompt",
    targetRoot: "/workspace/project",
    terminalId: "startup-terminal",
    worktree: "/workspace/project/.vibe64-local/sessions/active/startup_prompt/worktree"
  });
  assert.match(
    resumedArgs.at(-1),
    /resume 00000000-0000-4000-8000-000000000001/u
  );
  assert.doesNotMatch(resumedArgs.at(-1), /Vibe64 session briefing/u);

  const customReasoningArgs = codexTerminalArgs({
    agentSettings: {
      thinking: "medium"
    },
    codexThreadId: "",
    containerName: "vibe64-codex-startup-custom-reasoning",
    sessionId: "startup_prompt",
    targetRoot: "/workspace/project",
    terminalId: "startup-terminal",
    worktree: "/workspace/project/.vibe64-local/sessions/active/startup_prompt/worktree"
  });
  assert.match(
    customReasoningArgs.at(-1),
    /model_reasoning_effort="medium"/u
  );

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
    worktree: "/workspace/project/.vibe64-local/sessions/active/startup_prompt/worktree"
  });
  assert.match(
    remoteResumedArgs.at(-1),
    new RegExp(`${STUDIO_MANAGED_CODEX_COMMAND} -c ${STUDIO_MANAGED_CODEX_NO_UPDATE_CONFIG} --remote unix:\\/\\/\\/vibe64-codex-app-server\\/app-server\\.sock .*resume 00000000-0000-4000-8000-000000000001`, "u")
  );
  assert.ok(remoteResumedArgs.includes("/tmp/vibe64/agent-providers/codex-app-server:/vibe64-codex-app-server"));

  const invalidThreadArgs = codexTerminalArgs({
    codexThreadId: "not-a-thread-id",
    containerName: "vibe64-codex-startup-invalid-thread",
    sessionId: "startup_prompt",
    targetRoot: "/workspace/project",
    terminalId: "startup-terminal",
    worktree: "/workspace/project/.vibe64-local/sessions/active/startup_prompt/worktree"
  });
  assert.doesNotMatch(invalidThreadArgs.at(-1), /resume [0-9a-f-]{36}/u);
});

test("Vibe64 Codex terminal resumes the app-server thread for the same workdir", () => {
  const workdir = "/workspace/project/.vibe64-local/sessions/active/session-1/worktree";
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
    new RegExp(`${STUDIO_MANAGED_CODEX_COMMAND} -c ${STUDIO_MANAGED_CODEX_NO_UPDATE_CONFIG} --remote unix:\\/\\/\\/vibe64-codex-app-server\\/app-server\\.sock .*resume 00000000-0000-4000-8000-000000000005`, "u")
  );

  assert.equal(
    codexRemoteEndpointForWorkdir(session, "/workspace/project/other"),
    ""
  );
});

test("Vibe64 Codex visible terminal uses the session Codex provider home", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "visible-terminal-provider-home";
    const threadId = "00000000-0000-4000-8000-000000000015";
    const sessionRoot = path.join(targetRoot, ".vibe64", "sessions", "active", sessionId);
    const worktree = path.join(sessionRoot, "worktree");
    const toolHomeSource = path.join(targetRoot, "provider-homes", "codex");
    await mkdir(worktree, {
      recursive: true
    });
    await mkdir(toolHomeSource, {
      recursive: true
    });
    const adapterImage = "unit-codex-adapter-toolchain:latest";

    const runtime = new Vibe64SessionRuntime({
      targetRoot
    });
    await runtime.createSession({
      initialStep: "worktree_created",
      metadata: {
        agent_identity_conversation_id: threadId,
        agent_identity_provider: "codex",
        agent_identity_resume_strategy: "provider-native",
        agent_identity_status: "ready",
        agent_identity_workdir: worktree,
        codex_app_server_provider: "codex_app_server",
        codex_thread_id: threadId,
        codex_workdir: worktree,
        worktree_path: worktree
      },
      sessionId
    });

    const providerFactoryOptions = [];
    let ensureRuntimeCalls = 0;
    const controller = createCodexTerminalController({
      codexAuthPreflight: noopCodexAuthPreflight,
      codexAppServerPromptDeliveryEnabled: true,
      codexAppServerProviderFactory: (options = {}) => {
        providerFactoryOptions.push(options);
        return {
          async ensureAvailable() {
            return true;
          },
          async ensureRuntime() {
            ensureRuntimeCalls += 1;
            if (ensureRuntimeCalls > 1) {
              throw new Error("Stop before launching the visible terminal container.");
            }
            return {
              containerEndpoint: "unix:///vibe64-codex-app-server/app-server.sock",
              containerRuntimeDir: "/vibe64-codex-app-server",
              containerSocketPath: "/vibe64-codex-app-server/app-server.sock",
              endpoint: `unix://${path.join(targetRoot, ".vibe64", "runtime", "agent-providers", "codex-app-server", "app-server.sock")}`,
              runtimeDir: path.join(targetRoot, ".vibe64", "runtime", "agent-providers", "codex-app-server"),
              socketPath: path.join(targetRoot, ".vibe64", "runtime", "agent-providers", "codex-app-server", "app-server.sock"),
              transport: "unix"
            };
          },
          async resumeThread(id) {
            return {
              id
            };
          },
          subscribe() {
            return () => {};
          }
        };
      },
      codexToolHomeRequired: true,
      codexToolHomeSource: toolHomeSource,
      projectService: {
        targetRoot,
        async createRuntime() {
          return runtime;
        },
        async projectConfigEnvironment() {
          return {};
        }
      },
      async resolveTerminalToolchainImageImpl() {
        return {
          image: adapterImage,
          label: "Unit Codex adapter toolchain",
          ok: true
        };
      }
    });

    const result = await controller.startTerminal(sessionId);

    assert.equal(result.ok, false);
    assert.match(result.error, /Stop before launching the visible terminal container/u);
    assert.equal(providerFactoryOptions.length, 1);
    assert.equal(providerFactoryOptions[0].image, adapterImage);
    assert.equal(providerFactoryOptions[0].toolHomeSource, toolHomeSource);
    assert.equal(ensureRuntimeCalls, 2);
  });
});

test("Vibe64 Codex visible terminal returns reconnect-required when Codex auth is rejected", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "visible-terminal-codex-reconnect";
    const threadId = "00000000-0000-4000-8000-000000000216";
    const sessionRoot = path.join(targetRoot, ".vibe64", "sessions", "active", sessionId);
    const worktree = path.join(sessionRoot, "worktree");
    const toolHomeSource = path.join(targetRoot, "provider-homes", "codex");
    await mkdir(worktree, {
      recursive: true
    });
    await mkdir(toolHomeSource, {
      recursive: true
    });

    const runtime = new Vibe64SessionRuntime({
      targetRoot
    });
    await runtime.createSession({
      initialStep: "worktree_created",
      metadata: {
        agent_identity_conversation_id: threadId,
        agent_identity_provider: "codex",
        agent_identity_resume_strategy: "provider-native",
        agent_identity_status: "ready",
        agent_identity_workdir: worktree,
        codex_app_server_provider: "codex_app_server",
        codex_thread_id: threadId,
        codex_workdir: worktree,
        worktree_path: worktree
      },
      sessionId
    });

    const controller = createCodexTerminalController({
      codexAppServerPromptDeliveryEnabled: true,
      codexAppServerProviderFactory: () => ({
        async ensureAvailable() {
          const error = new Error(CODEX_RECONNECT_REQUIRED_MESSAGE);
          error.code = CODEX_RECONNECT_REQUIRED_CODE;
          throw error;
        },
        async startThread() {
          throw new Error("Codex app-server should not start a thread when auth is rejected.");
        }
      }),
      codexToolHomeRequired: true,
      codexToolHomeSource: toolHomeSource,
      projectService: {
        targetRoot,
        async createRuntime() {
          return runtime;
        },
        async projectConfigEnvironment() {
          return {};
        }
      }
    });

    const result = await controller.startTerminal(sessionId);

    assert.equal(result.ok, false);
    assert.equal(result.code, CODEX_RECONNECT_REQUIRED_CODE, JSON.stringify(result, null, 2));
    assert.equal(result.error, CODEX_RECONNECT_REQUIRED_MESSAGE);
    assert.equal(result.errors[0].code, CODEX_RECONNECT_REQUIRED_CODE);

    const authStatus = await readCodexAuthStatus(targetRoot, {
      providerHomesRoot: path.join(targetRoot, "provider-homes")
    });
    assert.equal(authStatus.status, "reconnect_required");
    assert.equal(authStatus.code, CODEX_RECONNECT_REQUIRED_CODE);
    assert.equal(authStatus.reason, "codex-app-server-thread-ready");
  });
});

test("Vibe64 terminal service passes captured provider env to Codex app-server providers", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "captured-provider-env-session";
    const threadId = "00000000-0000-4000-8000-000000000116";
    const sessionRoot = path.join(targetRoot, ".vibe64", "sessions", "active", sessionId);
    const worktree = path.join(sessionRoot, "worktree");
    const providerHomesRoot = path.join(targetRoot, "provider-homes");
    const codexToolHomeSource = path.join(providerHomesRoot, "codex");
    await mkdir(worktree, {
      recursive: true
    });
    await mkdir(codexToolHomeSource, {
      recursive: true
    });

    const attachmentRoot = path.join(targetRoot, "online-state", "attachments");
    const previousAttachmentRoot = process.env[VIBE64_CODEX_ATTACHMENTS_ROOT_ENV];
    const previousRuntimeNamespace = process.env[VIBE64_RUNTIME_NAMESPACE_ENV];
    process.env[VIBE64_RUNTIME_NAMESPACE_ENV] = VIBE64_LOCAL_RUNTIME_NAMESPACE;
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

    const providerFactoryOptions = [];
    const providerCalls = {
      stopRuntime: 0
    };
    try {
      process.env[VIBE64_CODEX_ATTACHMENTS_ROOT_ENV] = attachmentRoot;
      const terminalService = createTestTerminalService({
        env: {
          [VIBE64_PROVIDER_HOMES_ROOT_ENV]: providerHomesRoot
        },
        codexTerminalController: {
          codexAppServerProviderFactory(options = {}) {
            providerFactoryOptions.push(options);
            return {
              async ensureRuntime() {
                return {
                  containerEndpoint: "unix:///vibe64-codex-app-server/app-server.sock",
                  containerRuntimeDir: "/vibe64-codex-app-server",
                  containerSocketPath: "/vibe64-codex-app-server/app-server.sock",
                  endpoint: `unix://${path.join(targetRoot, ".vibe64", "runtime", "agent-providers", "codex-app-server", "app-server.sock")}`,
                  runtimeDir: path.join(targetRoot, ".vibe64", "runtime", "agent-providers", "codex-app-server"),
                  socketPath: path.join(targetRoot, ".vibe64", "runtime", "agent-providers", "codex-app-server", "app-server.sock"),
                  transport: "unix"
                };
              },
              async sendTurn() {
                return {
                  id: "captured-provider-env-turn",
                  status: "completed"
                };
              },
              async startThread() {
                return {
                  id: threadId
                };
              },
              async stopRuntime() {
                providerCalls.stopRuntime += 1;
                return {
                  removed: true
                };
              },
              subscribe() {
                return () => {};
              }
            };
          },
          codexAppServerProviderOptions: {
            useDocker: false
          }
        },
        projectService: {
          targetRoot,
          async projectConfigEnvironment() {
            return {};
          },
          async createRuntime() {
            return runtime;
          }
        }
      });

      const ensureResult = await terminalService.ensureCodexThread(sessionId);

      assert.equal(ensureResult.ok, true, ensureResult.error || "Codex thread should be ready.");
      assert.equal(providerFactoryOptions.length, 1);
      assert.equal(
        providerFactoryOptions[0].env[VIBE64_PROVIDER_HOMES_ROOT_ENV],
        providerHomesRoot
      );
      assert.equal(
        providerFactoryOptions[0].env[VIBE64_CODEX_ATTACHMENTS_ROOT_ENV],
        attachmentRoot
      );
      assert.equal(providerFactoryOptions[0].terminalEnv.VIBE64_CODEX_GIT_COMMAND_SESSION_ID, sessionId);
      assert.match(providerFactoryOptions[0].terminalEnv.VIBE64_CODEX_GIT_COMMAND_SOCKET, /command\.sock$/u);
      assert.match(providerFactoryOptions[0].terminalEnv.VIBE64_CODEX_GIT_COMMAND_TOKEN, /^[a-f0-9]{16}$/u);
      assert.ok(providerFactoryOptions[0].terminalEnv.VIBE64_CODEX_GIT_COMMAND_WRAPPER_DIR.startsWith(`${CODEX_ATTACHMENT_CONTAINER_ROOT}/`));
      assert.equal(providerFactoryOptions[0].terminalEnv[VIBE64_AGENT_PREVIEW_COMMAND_SESSION_ID_ENV], sessionId);
      assert.match(providerFactoryOptions[0].terminalEnv[VIBE64_AGENT_PREVIEW_COMMAND_SOCKET_ENV], /preview-command\.sock$/u);
      assert.match(providerFactoryOptions[0].terminalEnv[VIBE64_AGENT_PREVIEW_COMMAND_TOKEN_ENV], /^[a-f0-9]{16}$/u);
      assert.equal(providerFactoryOptions[0].terminalEnv[VIBE64_CODEX_GIT_COMMAND_SYSTEM_ACTOR_SCOPE_ENV], "local");
      assert.equal(providerFactoryOptions[0].terminalEnv[VIBE64_CODEX_GIT_COMMAND_SYSTEM_ACTOR_TARGET_ROOT_ENV], targetRoot);
      assert.equal(providerFactoryOptions[0].terminalEnv[VIBE64_CODEX_GIT_COMMAND_SYSTEM_ACTOR_USER_KEY_ENV], "local");
      assert.equal(providerFactoryOptions[0].terminalEnv[VIBE64_CODEX_GIT_COMMAND_SYSTEM_ACTOR_WORKDIR_ENV], worktree);
      assert.equal(providerFactoryOptions[0].toolHomeSource, codexToolHomeSource);

      const wrapperContainerPath = providerFactoryOptions[0].terminalEnv.VIBE64_CODEX_GIT_COMMAND_WRAPPER_DIR;
      const wrapperHostDir = path.join(
        attachmentRoot,
        path.relative(CODEX_ATTACHMENT_CONTAINER_ROOT, wrapperContainerPath)
      );
      assert.equal((await stat(path.join(wrapperHostDir, "git"))).isFile(), true);
      assert.equal((await stat(path.join(wrapperHostDir, "gh"))).isFile(), true);
      assert.equal((await stat(path.join(wrapperHostDir, AGENT_PREVIEW_COMMAND_NAME))).isFile(), true);

      const invalidateResult = await terminalService.invalidateAgentRuntimes({
        provider: "codex",
        toolHomeSource: codexToolHomeSource
      });

      assert.equal(invalidateResult.ok, true);
      assert.equal(invalidateResult.providerCount, 1);
      assert.equal(invalidateResult.stopped, 1);
      assert.equal(providerCalls.stopRuntime, 1);
    } finally {
      if (previousAttachmentRoot === undefined) {
        delete process.env[VIBE64_CODEX_ATTACHMENTS_ROOT_ENV];
      } else {
        process.env[VIBE64_CODEX_ATTACHMENTS_ROOT_ENV] = previousAttachmentRoot;
      }
      if (previousRuntimeNamespace === undefined) {
        delete process.env[VIBE64_RUNTIME_NAMESPACE_ENV];
      } else {
        process.env[VIBE64_RUNTIME_NAMESPACE_ENV] = previousRuntimeNamespace;
      }
    }
  });
});

test("Vibe64 Codex app-server reconciliation starts open session threads and unsubscribes on close", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new Vibe64SessionRuntime({
      targetRoot
    });
    const sessions = [
      {
        sessionId: "reconcile-session-one",
        threadId: "00000000-0000-4000-8000-000000000101"
      },
      {
        sessionId: "reconcile-session-two",
        threadId: "00000000-0000-4000-8000-000000000102"
      }
    ];
    for (const session of sessions) {
      const worktree = path.join(targetRoot, ".vibe64", "sessions", "active", session.sessionId, "worktree");
      await runtime.createSession({
        initialStep: "worktree_created",
        metadata: {
          worktree_path: worktree
        },
        sessionId: session.sessionId
      });
      await mkdir(worktree, {
        recursive: true
      });
    }

    const providerCalls = {
      activeSubscriptions: 0,
      close: 0,
      sendTurn: [],
      startThread: [],
      stopRuntime: 0,
      subscribe: 0,
      unsubscribe: 0,
      unsubscribeThread: []
    };
    const terminalService = createTestTerminalService({
      codexTerminalController: {
        codexAppServerProviderFactory(options = {}) {
          const session = sessions.find((entry) => String(options.workdir || "").includes(entry.sessionId));
          if (!session) {
            throw new Error(`Unexpected Codex provider workdir: ${options.workdir}`);
          }
          const provider = {
            close() {
              providerCalls.close += 1;
            },
            async stopRuntime() {
              providerCalls.stopRuntime += 1;
              providerCalls.close += 1;
              return {
                removed: true
              };
            },
            async ensureRuntime() {
              return {
                containerEndpoint: "unix:///vibe64-codex-app-server/app-server.sock",
                containerRuntimeDir: "/vibe64-codex-app-server",
                containerSocketPath: "/vibe64-codex-app-server/app-server.sock",
                endpoint: `unix://${path.join(targetRoot, ".vibe64", "runtime", "agent-providers", "codex-app-server", "app-server.sock")}`,
                runtimeDir: path.join(targetRoot, ".vibe64", "runtime", "agent-providers", "codex-app-server"),
                socketPath: path.join(targetRoot, ".vibe64", "runtime", "agent-providers", "codex-app-server", "app-server.sock"),
                transport: "unix"
              };
            },
            async startThread(params) {
              providerCalls.startThread.push(params);
              return {
                id: session.threadId
              };
            },
            async sendTurn(threadId, input, params) {
              providerCalls.sendTurn.push({
                input,
                params,
                threadId
              });
              return {
                id: `${session.sessionId}-bootstrap-turn`,
                status: "completed"
              };
            },
            subscribe() {
              providerCalls.subscribe += 1;
              providerCalls.activeSubscriptions += 1;
              return () => {
                providerCalls.unsubscribe += 1;
                providerCalls.activeSubscriptions -= 1;
              };
            },
            async unsubscribeThread(threadId) {
              providerCalls.unsubscribeThread.push(threadId);
              return {
                status: "unsubscribed"
              };
            }
          };
          return provider;
        },
        codexAppServerProviderOptions: {
          useDocker: false
        }
      },
      projectService: {
        targetRoot,
        async projectConfigEnvironment() {
          return {
            MYSQL_HOST: JSKIT_MARIADB_HOST,
            MYSQL_PWD: JSKIT_MARIADB_ROOT_PASSWORD
          };
        },
        async createRuntime() {
          return runtime;
        }
      }
    });

    const reconcileResult = await terminalService.reconcileCodexThreads(sessions);

    assert.equal(reconcileResult.ok, true, JSON.stringify(reconcileResult));
    assert.equal(reconcileResult.sessionCount, 2);
    assert.equal(providerCalls.startThread.length, 2);
    assert.equal(providerCalls.sendTurn.length, 2);
    assert.equal(providerCalls.activeSubscriptions, 2);
    const firstSession = await runtime.getSession("reconcile-session-one");
    assert.equal(
      firstSession.metadata.agent_identity_conversation_id,
      "00000000-0000-4000-8000-000000000101"
    );

    await terminalService.closeSessionTerminals("reconcile-session-one");

    assert.deepEqual(providerCalls.unsubscribeThread, [
      "00000000-0000-4000-8000-000000000101"
    ]);
    assert.equal(providerCalls.activeSubscriptions, 1);
    assert.equal(providerCalls.close, 1);
    assert.equal(providerCalls.stopRuntime, 1);
  });
});

test("Vibe64 Codex app-server close does not cold-start from session metadata after provider cache loss", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "cached-provider-lost-session";
    const threadId = "00000000-0000-4000-8000-000000000109";
    const worktree = path.join(targetRoot, ".vibe64", "sessions", "active", sessionId, "worktree");
    const runtime = new Vibe64SessionRuntime({
      targetRoot
    });
    await runtime.createSession({
      initialStep: "worktree_created",
      metadata: {
        agent_identity_conversation_id: threadId,
        agent_identity_provider: "codex",
        agent_identity_resume_strategy: "provider-native",
        agent_identity_status: "ready",
        agent_identity_workdir: worktree,
        codex_app_server_provider: "codex_app_server",
        codex_app_server_runtime_dir: path.join(targetRoot, ".vibe64", "runtime", "agent-providers", "codex-app-server"),
        codex_thread_id: threadId,
        codex_workdir: worktree,
        worktree_path: worktree
      },
      sessionId
    });
    await mkdir(worktree, {
      recursive: true
    });

    const providerCalls = {
      close: 0,
      factory: 0,
      stopRuntime: 0,
      unsubscribeThread: []
    };
    const terminalService = createTestTerminalService({
      codexTerminalController: {
        codexAppServerProviderFactory() {
          providerCalls.factory += 1;
          return {
            close() {
              providerCalls.close += 1;
            },
            async stopRuntime() {
              providerCalls.stopRuntime += 1;
              providerCalls.close += 1;
              return {
                removed: true
              };
            },
            async unsubscribeThread(unsubscribedThreadId) {
              providerCalls.unsubscribeThread.push(unsubscribedThreadId);
              return {
                status: "unsubscribed"
              };
            }
          };
        },
        codexAppServerProviderOptions: {
          useDocker: false
        }
      },
      projectService: {
        targetRoot,
        async projectConfigEnvironment() {
          return {};
        },
        async createRuntime() {
          return runtime;
        }
      }
    });

    await terminalService.closeSessionTerminals(sessionId);

    assert.equal(providerCalls.factory, 0);
    assert.deepEqual(providerCalls.unsubscribeThread, []);
    assert.equal(providerCalls.close, 0);
    assert.equal(providerCalls.stopRuntime, 0);
  });
});

test("Vibe64 Codex app-server close tolerates stale metadata without a live provider", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "close-only-provider-session";
    const threadId = "00000000-0000-4000-8000-000000000122";
    const worktree = path.join(targetRoot, ".vibe64", "sessions", "active", sessionId, "worktree");
    const runtime = new Vibe64SessionRuntime({
      targetRoot
    });
    await runtime.createSession({
      initialStep: "worktree_created",
      metadata: {
        agent_identity_conversation_id: threadId,
        agent_identity_provider: "codex",
        agent_identity_resume_strategy: "provider-native",
        agent_identity_status: "ready",
        agent_identity_workdir: worktree,
        codex_app_server_provider: "codex_app_server",
        codex_app_server_runtime_dir: path.join(targetRoot, ".vibe64", "runtime", "agent-providers", "codex-app-server"),
        codex_thread_id: threadId,
        codex_workdir: worktree,
        worktree_path: worktree
      },
      sessionId
    });
    await mkdir(worktree, {
      recursive: true
    });

    const providerCalls = {
      close: 0,
      factory: 0,
      unsubscribeThread: []
    };
    const terminalService = createTestTerminalService({
      codexTerminalController: {
        codexAppServerProviderFactory() {
          providerCalls.factory += 1;
          return {
            close() {
              providerCalls.close += 1;
            },
            async unsubscribeThread(unsubscribedThreadId) {
              providerCalls.unsubscribeThread.push(unsubscribedThreadId);
              return {
                status: "unsubscribed"
              };
            }
          };
        },
        codexAppServerProviderOptions: {
          useDocker: false
        }
      },
      projectService: {
        targetRoot,
        async projectConfigEnvironment() {
          return {};
        },
        async createRuntime() {
          return runtime;
        }
      }
    });

    await terminalService.closeSessionTerminals(sessionId);

    assert.equal(providerCalls.factory, 0);
    assert.deepEqual(providerCalls.unsubscribeThread, []);
    assert.equal(providerCalls.close, 0);
  });
});

test("Vibe64 Codex app-server reconciliation reset does not cold-start persisted runtimes", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new Vibe64SessionRuntime({
      targetRoot
    });
    const sessions = [
      {
        sessionId: "known-active-thread",
        status: VIBE64_SESSION_STATUS.ACTIVE,
        threadId: "00000000-0000-4000-8000-000000000119"
      },
      {
        sessionId: "known-finished-thread",
        status: VIBE64_SESSION_STATUS.FINISHED,
        threadId: "00000000-0000-4000-8000-000000000120"
      }
    ];
    for (const session of sessions) {
      const worktree = path.join(targetRoot, ".vibe64", "sessions", "active", session.sessionId, "worktree");
      await runtime.createSession({
        initialStep: "worktree_created",
        metadata: {
          agent_identity_conversation_id: session.threadId,
          agent_identity_provider: "codex",
          agent_identity_resume_strategy: "provider-native",
          agent_identity_status: "ready",
          agent_identity_workdir: worktree,
          codex_app_server_provider: "codex_app_server",
          codex_app_server_runtime_dir: path.join(targetRoot, ".vibe64", "runtime", "agent-providers", "codex-app-server"),
          codex_thread_id: session.threadId,
          codex_workdir: worktree,
          worktree_path: worktree
        },
        sessionId: session.sessionId,
        status: session.status
      });
      await mkdir(worktree, {
        recursive: true
      });
    }

    const providerCalls = {
      close: 0,
      factory: 0,
      stopRuntime: 0,
      unsubscribeThread: []
    };
    const terminalService = createTestTerminalService({
      codexTerminalController: {
        codexAppServerProviderFactory() {
          providerCalls.factory += 1;
          return {
            close() {
              providerCalls.close += 1;
            },
            async stopRuntime() {
              providerCalls.stopRuntime += 1;
              providerCalls.close += 1;
              return {
                removed: true
              };
            },
            async unsubscribeThread(threadId) {
              providerCalls.unsubscribeThread.push(threadId);
              return {
                status: "unsubscribed"
              };
            }
          };
        },
        codexAppServerProviderOptions: {
          useDocker: false
        }
      },
      projectService: {
        targetRoot,
        async projectConfigEnvironment() {
          return {};
        },
        async createRuntime() {
          return runtime;
        }
      }
    });

    const firstResult = await terminalService.reconcileCodexThreads([]);
    const secondResult = await terminalService.reconcileCodexThreads([]);

    assert.equal(firstResult.ok, true);
    assert.equal(secondResult.ok, true);
    assert.equal(providerCalls.factory, 0);
    assert.deepEqual(providerCalls.unsubscribeThread, []);
    assert.equal(providerCalls.close, 0);
    assert.equal(providerCalls.stopRuntime, 0);
  });
});

test("Vibe64 Codex app-server reconciliation subscribes an already loaded thread without resuming it", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "loaded-thread-session";
    const threadId = "00000000-0000-4000-8000-000000000111";
    const worktree = path.join(targetRoot, ".vibe64", "sessions", "active", sessionId, "worktree");
    const runtime = new Vibe64SessionRuntime({
      targetRoot
    });
    await runtime.createSession({
      initialStep: "worktree_created",
      metadata: {
        agent_identity_conversation_id: threadId,
        agent_identity_provider: "codex",
        agent_identity_resume_strategy: "provider-native",
        agent_identity_status: "ready",
        agent_identity_workdir: worktree,
        codex_app_server_provider: "codex_app_server",
        codex_thread_id: threadId,
        codex_workdir: worktree,
        worktree_path: worktree
      },
      sessionId
    });
    await mkdir(worktree, {
      recursive: true
    });

    const providerCalls = {
      listLoadedThreads: 0,
      resumeThread: 0,
      startThread: 0,
      subscribe: 0
    };
    const terminalService = createTestTerminalService({
      codexTerminalController: {
        codexAppServerProviderFactory() {
          return {
            async ensureAvailable() {
              return {
                ok: true
              };
            },
            async ensureRuntime() {
              return {
                endpoint: `unix://${path.join(targetRoot, ".vibe64", "runtime", "agent-providers", "codex-app-server", "app-server.sock")}`,
                runtimeDir: path.join(targetRoot, ".vibe64", "runtime", "agent-providers", "codex-app-server"),
                socketPath: path.join(targetRoot, ".vibe64", "runtime", "agent-providers", "codex-app-server", "app-server.sock"),
                transport: "unix"
              };
            },
            async listLoadedThreads() {
              providerCalls.listLoadedThreads += 1;
              return {
                data: [threadId],
                nextCursor: null
              };
            },
            async resumeThread() {
              providerCalls.resumeThread += 1;
              throw new Error("loaded thread should not be resumed");
            },
            async startThread() {
              providerCalls.startThread += 1;
              throw new Error("loaded thread should not be recreated");
            },
            subscribe() {
              providerCalls.subscribe += 1;
              return () => null;
            }
          };
        },
        codexAppServerProviderOptions: {
          useDocker: false
        }
      },
      projectService: {
        targetRoot,
        async createRuntime() {
          return runtime;
        }
      }
    });

    const result = await terminalService.reconcileCodexThreads([{ sessionId }]);

    assert.equal(result.ok, true);
    assert.equal(result.results[0].status, "loaded");
    assert.equal(providerCalls.listLoadedThreads, 1);
    assert.equal(providerCalls.resumeThread, 0);
    assert.equal(providerCalls.startThread, 0);
    assert.equal(providerCalls.subscribe, 1);

    await runtime.store.writeBackgroundTaskEvent(sessionId, "codex_app_server", {
      event: {
        error: "stale startup timeout",
        kind: "failed",
        message: "Codex app-server preparation failed.",
        status: "failed"
      },
      patch: {
        error: "stale startup timeout",
        kind: "codex_app_server",
        message: "Codex app-server preparation failed.",
        status: "failed"
      }
    });

    const secondResult = await terminalService.reconcileCodexThreads([{ sessionId }]);

    assert.equal(secondResult.ok, true);
    assert.equal(secondResult.results[0].status, "alreadySubscribed");
    assert.equal(providerCalls.listLoadedThreads, 2);
    assert.equal(providerCalls.resumeThread, 0);
    assert.equal(providerCalls.startThread, 0);
    assert.equal(providerCalls.subscribe, 1);
    const healedSession = await runtime.getSession(sessionId);
    const appServerTask = healedSession.presentation.backgroundTasks.find((task) => task.id === "codex_app_server");
    assert.equal(appServerTask?.status, "ready");
    assert.equal(appServerTask?.error || "", "");
  });
});

test("Vibe64 Codex app-server reconciliation resubscribes a loaded thread after provider reconnect", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "loaded-thread-reconnected-session";
    const threadId = "00000000-0000-4000-8000-000000000123";
    const worktree = path.join(targetRoot, ".vibe64", "sessions", "active", sessionId, "worktree");
    const runtime = new Vibe64SessionRuntime({
      targetRoot
    });
    await runtime.createSession({
      initialStep: "worktree_created",
      metadata: {
        agent_identity_conversation_id: threadId,
        agent_identity_provider: "codex",
        agent_identity_resume_strategy: "provider-native",
        agent_identity_status: "ready",
        agent_identity_workdir: worktree,
        codex_app_server_provider: "codex_app_server",
        codex_thread_id: threadId,
        codex_workdir: worktree,
        worktree_path: worktree
      },
      sessionId
    });
    await mkdir(worktree, {
      recursive: true
    });

    const providerCalls = {
      listLoadedThreads: 0,
      readThread: 0,
      subscribe: 0,
      unsubscribe: 0
    };
    let connectionGeneration = 1;
    let threadStatus = {
      type: "idle"
    };
    let threadTurnId = "";
    const terminalService = createTestTerminalService({
      codexTerminalController: {
        codexAppServerProviderFactory() {
          return {
            currentConnectionGeneration() {
              return connectionGeneration;
            },
            async ensureAvailable() {
              return {
                ok: true
              };
            },
            async listLoadedThreads() {
              providerCalls.listLoadedThreads += 1;
              return {
                data: [threadId],
                nextCursor: null
              };
            },
            async readThread() {
              providerCalls.readThread += 1;
              return {
                raw: {
                  activeTurnId: threadTurnId,
                  status: threadStatus
                }
              };
            },
            subscribe() {
              providerCalls.subscribe += 1;
              return () => {
                providerCalls.unsubscribe += 1;
              };
            }
          };
        },
        codexAppServerProviderOptions: {
          useDocker: false
        }
      },
      projectService: {
        targetRoot,
        async createRuntime() {
          return runtime;
        }
      }
    });

    const result = await terminalService.reconcileCodexThreads([{ sessionId }]);
    const secondResult = await terminalService.reconcileCodexThreads([{ sessionId }]);
    connectionGeneration += 1;
    threadStatus = "active";
    threadTurnId = "terminal-turn-after-reconnect";
    const thirdResult = await terminalService.reconcileCodexThreads([{ sessionId }]);
    const session = await runtime.getSession(sessionId);

    assert.equal(result.ok, true);
    assert.equal(result.results[0].status, "loaded");
    assert.equal(secondResult.ok, true);
    assert.equal(secondResult.results[0].status, "alreadySubscribed");
    assert.equal(thirdResult.ok, true);
    assert.equal(thirdResult.results[0].status, "resubscribed");
    assert.equal(providerCalls.listLoadedThreads, 3);
    assert.equal(providerCalls.readThread, 3);
    assert.equal(providerCalls.subscribe, 2);
    assert.equal(providerCalls.unsubscribe, 1);
    assert.equal(codexAppServerAgentRunSnapshot(session).state, "active");
    assert.equal(codexAppServerAgentRunSnapshot(session).providerStatus, "inProgress");
    assert.equal(codexAppServerAgentRunSnapshot(session).providerThreadId, threadId);
    assert.equal(codexAppServerAgentRunSnapshot(session).providerTurnId, threadTurnId);
  });
});

test("Vibe64 Codex app-server reconciliation prunes listeners from the previously selected project", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "same-session-id";
    const projectA = path.join(targetRoot, "project-a");
    const projectB = path.join(targetRoot, "project-b");
    await mkdir(projectA, {
      recursive: true
    });
    await mkdir(projectB, {
      recursive: true
    });
    const runtimeA = new Vibe64SessionRuntime({
      targetRoot: projectA
    });
    const runtimeB = new Vibe64SessionRuntime({
      targetRoot: projectB
    });
    const worktreeA = path.join(projectA, ".vibe64", "sessions", "active", sessionId, "worktree");
    const worktreeB = path.join(projectB, ".vibe64", "sessions", "active", sessionId, "worktree");
    await runtimeA.createSession({
      initialStep: "worktree_created",
      metadata: {
        worktree_path: worktreeA
      },
      sessionId
    });
    await runtimeB.createSession({
      initialStep: "worktree_created",
      metadata: {
        worktree_path: worktreeB
      },
      sessionId
    });
    await mkdir(worktreeA, {
      recursive: true
    });
    await mkdir(worktreeB, {
      recursive: true
    });

    const providerState = new Map();
    function stateForTarget(projectRoot) {
      const key = projectRoot === projectA ? "a" : "b";
      if (!providerState.has(key)) {
        providerState.set(key, {
          activeSubscriptions: 0,
          close: 0,
          stopRuntime: 0,
          subscribe: 0,
          unsubscribe: 0
        });
      }
      return providerState.get(key);
    }
    function threadIdForTarget(projectRoot) {
      return projectRoot === projectA
        ? "00000000-0000-4000-8000-000000000201"
        : "00000000-0000-4000-8000-000000000202";
    }
    let activeTargetRoot = projectA;
    let activeRuntime = runtimeA;
    const terminalService = createTestTerminalService({
      codexTerminalController: {
        codexAppServerProviderFactory(options = {}) {
          const state = stateForTarget(options.targetRoot);
          return {
            close() {
              state.close += 1;
            },
            async stopRuntime() {
              state.stopRuntime += 1;
              state.close += 1;
              return {
                removed: true
              };
            },
            async ensureRuntime() {
              return {
                endpoint: `unix://${path.join(options.targetRoot, ".vibe64", "runtime", "agent-providers", "codex-app-server", "app-server.sock")}`,
                runtimeDir: path.join(options.targetRoot, ".vibe64", "runtime", "agent-providers", "codex-app-server"),
                socketPath: path.join(options.targetRoot, ".vibe64", "runtime", "agent-providers", "codex-app-server", "app-server.sock"),
                transport: "unix"
              };
            },
            async startThread() {
              return {
                id: threadIdForTarget(options.targetRoot)
              };
            },
            async sendTurn() {
              return {
                id: `${path.basename(options.targetRoot)}-bootstrap-turn`,
                status: "completed"
              };
            },
            subscribe() {
              state.subscribe += 1;
              state.activeSubscriptions += 1;
              return () => {
                state.unsubscribe += 1;
                state.activeSubscriptions -= 1;
              };
            }
          };
        },
        codexAppServerProviderOptions: {
          useDocker: false
        }
      },
      projectService: {
        get targetRoot() {
          return activeTargetRoot;
        },
        async createRuntime() {
          return activeRuntime;
        }
      }
    });

    await runWithProjectRequestContext({
      slug: "project-a",
      targetRoot: projectA
    }, async () => {
      activeTargetRoot = projectA;
      activeRuntime = runtimeA;
      const result = await terminalService.reconcileCodexThreads([{ sessionId }]);
      assert.equal(result.ok, true);
    });
    assert.equal(stateForTarget(projectA).activeSubscriptions, 1);
    assert.equal(stateForTarget(projectB).activeSubscriptions, 0);

    await runWithProjectRequestContext({
      slug: "project-b",
      targetRoot: projectB
    }, async () => {
      activeTargetRoot = projectB;
      activeRuntime = runtimeB;
      const result = await terminalService.reconcileCodexThreads([{ sessionId }]);
      assert.equal(result.ok, true);
    });

    assert.equal(stateForTarget(projectA).activeSubscriptions, 0);
    assert.equal(stateForTarget(projectA).close, 1);
    assert.equal(stateForTarget(projectB).activeSubscriptions, 1);
    assert.equal(stateForTarget(projectB).close, 0);
  });
});

test("Vibe64 Codex app-server reconciliation waits before pruning an in-flight project", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "same-session-id";
    const projectA = path.join(targetRoot, "project-a");
    const projectB = path.join(targetRoot, "project-b");
    await mkdir(projectA, {
      recursive: true
    });
    await mkdir(projectB, {
      recursive: true
    });
    const runtimeA = new Vibe64SessionRuntime({
      targetRoot: projectA
    });
    const runtimeB = new Vibe64SessionRuntime({
      targetRoot: projectB
    });
    const worktreeA = path.join(projectA, ".vibe64", "sessions", "active", sessionId, "worktree");
    const worktreeB = path.join(projectB, ".vibe64", "sessions", "active", sessionId, "worktree");
    const threadA = "00000000-0000-4000-8000-000000000301";
    const threadB = "00000000-0000-4000-8000-000000000302";
    await runtimeA.createSession({
      initialStep: "worktree_created",
      metadata: {
        agent_identity_conversation_id: threadA,
        agent_identity_provider: "codex",
        agent_identity_resume_strategy: "provider-native",
        agent_identity_status: "ready",
        agent_identity_workdir: worktreeA,
        codex_app_server_provider: "codex_app_server",
        codex_thread_id: threadA,
        codex_workdir: worktreeA,
        worktree_path: worktreeA
      },
      sessionId
    });
    await runtimeB.createSession({
      initialStep: "worktree_created",
      metadata: {
        worktree_path: worktreeB
      },
      sessionId
    });
    await mkdir(worktreeA, {
      recursive: true
    });
    await mkdir(worktreeB, {
      recursive: true
    });

    const providerState = new Map();
    function stateForTarget(projectRoot) {
      const key = projectRoot === projectA ? "a" : "b";
      if (!providerState.has(key)) {
        providerState.set(key, {
          close: 0,
          listLoadedThreads: 0,
          startThread: 0,
          stopRuntime: 0,
          subscribe: 0,
          unsubscribe: 0
        });
      }
      return providerState.get(key);
    }

    let allowProjectAListLoadedThreads = null;
    let projectAListLoadedThreadsStarted = null;
    const projectAListLoadedThreadsReady = new Promise((resolve) => {
      projectAListLoadedThreadsStarted = resolve;
    });
    const projectAListLoadedThreadsCanContinue = new Promise((resolve) => {
      allowProjectAListLoadedThreads = resolve;
    });

    let activeTargetRoot = projectA;
    let activeRuntime = runtimeA;
    const terminalService = createTestTerminalService({
      codexTerminalController: {
        codexAppServerProviderFactory(options = {}) {
          const state = stateForTarget(options.targetRoot);
          const threadId = options.targetRoot === projectA ? threadA : threadB;
          return {
            close() {
              state.close += 1;
            },
            async stopRuntime() {
              state.stopRuntime += 1;
              state.close += 1;
              return {
                removed: true
              };
            },
            async ensureAvailable() {
              return {
                ok: true
              };
            },
            async ensureRuntime() {
              return {
                endpoint: `unix://${path.join(options.targetRoot, ".vibe64", "runtime", "agent-providers", "codex-app-server", "app-server.sock")}`,
                runtimeDir: path.join(options.targetRoot, ".vibe64", "runtime", "agent-providers", "codex-app-server"),
                socketPath: path.join(options.targetRoot, ".vibe64", "runtime", "agent-providers", "codex-app-server", "app-server.sock"),
                transport: "unix"
              };
            },
            async listLoadedThreads() {
              state.listLoadedThreads += 1;
              if (options.targetRoot === projectA) {
                projectAListLoadedThreadsStarted();
                await projectAListLoadedThreadsCanContinue;
              }
              return {
                data: [threadId],
                nextCursor: null
              };
            },
            async startThread() {
              state.startThread += 1;
              return {
                id: threadId
              };
            },
            async sendTurn() {
              return {
                id: `${path.basename(options.targetRoot)}-bootstrap-turn`,
                status: "completed"
              };
            },
            subscribe() {
              state.subscribe += 1;
              return () => {
                state.unsubscribe += 1;
              };
            }
          };
        },
        codexAppServerProviderOptions: {
          useDocker: false
        }
      },
      projectService: {
        get targetRoot() {
          return activeTargetRoot;
        },
        async createRuntime() {
          return activeRuntime;
        }
      }
    });

    const projectAReconcile = runWithProjectRequestContext({
      slug: "project-a",
      targetRoot: projectA
    }, async () => {
      activeTargetRoot = projectA;
      activeRuntime = runtimeA;
      return terminalService.reconcileCodexThreads([{ sessionId }]);
    });

    await projectAListLoadedThreadsReady;

    const projectBReconcile = runWithProjectRequestContext({
      slug: "project-b",
      targetRoot: projectB
    }, async () => {
      activeTargetRoot = projectB;
      activeRuntime = runtimeB;
      return terminalService.reconcileCodexThreads([{ sessionId }]);
    });

    await delay(25);
    assert.equal(stateForTarget(projectA).close, 0);

    allowProjectAListLoadedThreads();
    const [resultA, resultB] = await Promise.all([
      projectAReconcile,
      projectBReconcile
    ]);

    assert.equal(resultA.ok, true);
    assert.equal(resultB.ok, true);
    assert.equal(stateForTarget(projectA).close, 1);
    assert.equal(stateForTarget(projectB).close, 0);
    assert.equal(stateForTarget(projectA).unsubscribe, 1);
  });
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

test("Vibe64 Codex terminal state uses durable app-server agent run state", async () => {
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

    const terminalService = createTestTerminalService({
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

      session.agentRuns = [
        codexAppServerAgentRun({
          providerThreadId: "00000000-0000-4000-8000-000000000010",
          providerTurnId: "turn-1"
        })
      ];
      state = await terminalService.codexTerminalState(sessionId);
      assert.equal(state.codexAgentTurnActive, true);
      assert.equal(state.codexAgentTurn.state, "active");
      assert.equal(state.codexAgentTurn.status, "inProgress");
      assert.equal(state.codexAgentTurn.turnId, "turn-1");
      assert.equal(state.codexTerminal.transmitting, undefined);

      session.agentRuns = [
        codexAppServerAgentRun({
          providerStatus: "inProgress",
          providerThreadId: "00000000-0000-4000-8000-000000000011",
          providerTurnId: "turn-2",
          state: "active"
        })
      ];
      state = await terminalService.codexTerminalState(sessionId);
      assert.equal(state.codexAgentTurnActive, true);
      assert.equal(state.codexAgentTurn.state, "active");
      assert.equal(state.codexAgentTurn.status, "inProgress");
      assert.equal(state.codexAgentTurn.threadId, "00000000-0000-4000-8000-000000000011");
      assert.equal(state.codexAgentTurn.turnId, "turn-2");
    } finally {
      await closeTerminalSession(terminal.id, {
        namespace
      });
    }
  });
});

test("Vibe64 Codex terminal state reconciles stale active app-server turns", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "codex_turn_reconcile";
    const sessionRoot = path.join(targetRoot, ".vibe64", "sessions", "active", sessionId);
    const worktree = path.join(sessionRoot, "worktree");
    const runtimeDir = path.join(targetRoot, ".vibe64", "runtime", "codex-app-server");
    await mkdir(worktree, {
      recursive: true
    });
    const session = {
      agentRuns: [
        codexAppServerAgentRun({
          providerThreadId: "thread-1",
          providerTurnId: "turn-1"
        })
      ],
      completedSteps: ["worktree_created"],
      metadata: {
        codex_app_server_endpoint: `unix://${path.join(runtimeDir, "app-server.sock")}`,
        codex_app_server_runtime_dir: runtimeDir,
        codex_app_server_socket_path: path.join(runtimeDir, "app-server.sock"),
        worktree_path: worktree
      },
      sessionId,
      sessionRoot,
      targetRoot
    };
    const runtime = {
      async getSession() {
        return session;
      },
      store: {
        async mutateSession(_sessionId, operation) {
          return operation();
        },
        async writeAgentRunEvent(_sessionId, runId, event) {
          writeAgentRunEventToSession(session, runId, event);
        },
        async writeMetadataValue(_sessionId, name, value) {
          session.metadata[name] = String(value || "");
        }
      }
    };
    const readThreadCalls = [];
    let providerOptions = null;
    const controller = createCodexTerminalController({
      codexAuthPreflight: noopCodexAuthPreflight,
      codexAppServerProviderOptions: {
        useDocker: false
      },
      codexAppServerProviderFactory: (options = {}) => {
        providerOptions = options;
        return {
          async readThread(threadId) {
            readThreadCalls.push(threadId);
            return {
              id: threadId,
              raw: {
                status: {
                  type: "idle"
                }
              }
            };
          }
        };
      },
      projectService: {
        targetRoot,
        async createRuntime() {
          return runtime;
        }
      }
    });

    const state = await controller.terminalState(sessionId);

    assert.equal(state.ok, true);
    assert.deepEqual(readThreadCalls, ["thread-1"]);
    assert.equal(providerOptions.runtimeDir, "");
    assert.deepEqual({
      providerStatus: codexAppServerAgentRunSnapshot(session).providerStatus,
      providerThreadId: codexAppServerAgentRunSnapshot(session).providerThreadId,
      providerTurnId: codexAppServerAgentRunSnapshot(session).providerTurnId,
      state: codexAppServerAgentRunSnapshot(session).state
    }, {
      providerStatus: "completed",
      providerThreadId: "thread-1",
      providerTurnId: "turn-1",
      state: "finalizing"
    });
    assert.equal(state.codexAgentTurnActive, true);
    assert.equal(state.codexAgentTurn.state, "finalizing");
    assert.equal(state.codexAgentTurn.status, "completed");
  });
});

test("Vibe64 Codex app-server active turns self-reconcile without another session refresh", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "codex_turn_active_watchdog";
    const sessionRoot = path.join(targetRoot, ".vibe64", "sessions", "active", sessionId);
    const worktree = path.join(sessionRoot, "worktree");
    const runtimeDir = path.join(targetRoot, ".vibe64", "runtime", "codex-app-server");
    await mkdir(worktree, {
      recursive: true
    });
    const session = {
      agentRuns: [
        codexAppServerAgentRun({
          providerThreadId: "thread-1",
          providerTurnId: "turn-1"
        })
      ],
      completedSteps: ["worktree_created"],
      metadata: {
        codex_app_server_endpoint: `unix://${path.join(runtimeDir, "app-server.sock")}`,
        codex_app_server_runtime_dir: runtimeDir,
        codex_app_server_socket_path: path.join(runtimeDir, "app-server.sock"),
        worktree_path: worktree
      },
      sessionId,
      sessionRoot,
      targetRoot
    };
    const runtime = {
      async getSession() {
        return session;
      },
      store: {
        async mutateSession(_sessionId, operation) {
          return operation();
        },
        async writeAgentRunEvent(_sessionId, runId, event) {
          writeAgentRunEventToSession(session, runId, event);
        },
        async writeMetadataValue(_sessionId, name, value) {
          session.metadata[name] = String(value || "");
        }
      }
    };
    const readThreadStatuses = ["inProgress", "completed"];
    const readThreadCalls = [];
    const controller = createCodexTerminalController({
      codexAuthPreflight: noopCodexAuthPreflight,
      codexAppServerActiveReconcileMs: 5,
      codexAppServerProviderOptions: {
        useDocker: false
      },
      codexAppServerProviderFactory: () => ({
        async readThread(threadId) {
          readThreadCalls.push(threadId);
          const status = readThreadStatuses.shift() || "completed";
          return {
            id: threadId,
            raw: {
              status
            }
          };
        }
      }),
      projectService: {
        targetRoot,
        async createRuntime() {
          return runtime;
        }
      }
    });

    const state = await controller.terminalState(sessionId);

    assert.equal(state.ok, true);
    assert.deepEqual(readThreadCalls, ["thread-1"]);
    assert.equal(codexAppServerAgentRunSnapshot(session).state, "active");

    await waitForCondition(
      () => codexAppServerAgentRunSnapshot(session).state === "finalizing",
      "Timed out waiting for Codex app-server active turn reconciliation."
    );

    assert.deepEqual(readThreadCalls, ["thread-1", "thread-1"]);
    assert.deepEqual({
      providerStatus: codexAppServerAgentRunSnapshot(session).providerStatus,
      providerThreadId: codexAppServerAgentRunSnapshot(session).providerThreadId,
      providerTurnId: codexAppServerAgentRunSnapshot(session).providerTurnId,
      state: codexAppServerAgentRunSnapshot(session).state
    }, {
      providerStatus: "completed",
      providerThreadId: "thread-1",
      providerTurnId: "turn-1",
      state: "finalizing"
    });
  });
});

test("Vibe64 Codex terminal state recovers stale finalizing app-server turns from the provider transcript", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "codex_turn_stale_finalizing_recovered";
    const sessionRoot = path.join(targetRoot, ".vibe64", "sessions", "active", sessionId);
    const worktree = path.join(sessionRoot, "worktree");
    const runtimeDir = path.join(targetRoot, ".vibe64", "runtime", "codex-app-server");
    const threadId = "thread-1";
    const turnId = "turn-1";
    await mkdir(worktree, {
      recursive: true
    });
    const assistantText = [
      "Recovered provider transcript result.",
      "",
      AGENT_TURN_RESULT_BEGIN,
      JSON.stringify({
        fields: {
          response: "Recovered provider transcript result."
        },
        kind: "ready",
        schema: AGENT_TURN_RESULT_SCHEMA,
        stepId: "implementation_reviewed",
        stepStatus: "awaiting_agent_result"
      }),
      AGENT_TURN_RESULT_END
    ].join("\n");
    const session = {
      agentRuns: [
        codexAppServerAgentRun({
          providerStatus: "completed",
          providerThreadId: threadId,
          providerTurnId: turnId,
          state: "finalizing",
          updatedAt: "2000-01-01T00:00:00.000Z"
        })
      ],
      completedSteps: ["worktree_created"],
      currentStep: "implementation_reviewed",
      currentStepDefinition: {
        autopilot: {
          kind: "agent_conversation"
        }
      },
      metadata: {
        codex_app_server_endpoint: `unix://${path.join(runtimeDir, "app-server.sock")}`,
        codex_app_server_runtime_dir: runtimeDir,
        codex_app_server_socket_path: path.join(runtimeDir, "app-server.sock"),
        worktree_path: worktree
      },
      sessionId,
      sessionRoot,
      stepMachine: {
        status: "awaiting_agent_result"
      },
      targetRoot
    };
    const runtime = {
      async getSession() {
        return session;
      },
      async submitCurrentStepInput(_sessionId, input = {}) {
        session.lastStepInput = input;
        session.stepMachine.status = "done";
        return session;
      },
      store: {
        async mutateSession(_sessionId, operation) {
          return operation();
        },
        async writeAgentRunEvent(_sessionId, runId, event) {
          writeAgentRunEventToSession(session, runId, event);
        },
        async writeMetadataValue(_sessionId, name, value) {
          session.metadata[name] = String(value || "");
        }
      }
    };
    const resumeThreadCalls = [];
    const controller = createCodexTerminalController({
      codexAuthPreflight: noopCodexAuthPreflight,
      codexAppServerProviderOptions: {
        useDocker: false
      },
      codexAppServerProviderFactory: () => ({
        async ensureAvailable() {
          return {
            ok: true
          };
        },
        async resumeThread(resumedThreadId, params) {
          resumeThreadCalls.push({
            params,
            threadId: resumedThreadId
          });
          return {
            raw: {
              turns: [
                {
                  id: turnId,
                  items: [
                    {
                      id: "assistant-message-1",
                      phase: "final_answer",
                      text: assistantText,
                      type: "agentMessage"
                    }
                  ],
                  status: "completed"
                }
              ]
            }
          };
        }
      }),
      projectService: {
        targetRoot,
        async createRuntime() {
          return runtime;
        }
      }
    });

    const state = await controller.terminalState(sessionId);

    assert.equal(state.ok, true);
    assert.deepEqual(resumeThreadCalls, [
      {
        params: {
          cwd: worktree
        },
        threadId
      }
    ]);
    assert.deepEqual(session.lastStepInput, {
      conversationText: "Recovered provider transcript result.",
      fields: {
        response: "Recovered provider transcript result."
      },
      inputFields: [],
      kind: "ready",
      message: "",
      source: "codex",
      stepId: "implementation_reviewed",
      stepStatus: "awaiting_agent_result",
      text: ""
    });
    assert.equal(session.stepMachine.status, "done");
    assert.equal(codexAppServerAgentRunSnapshot(session).state, "completed");
    assert.equal(codexAppServerAgentRunSnapshot(session).providerStatus, "completed");
    assert.equal(codexAppServerAgentRunSnapshot(session).error, "");
    assert.equal(state.codexAgentTurnActive, false);
    assert.equal(state.codexAgentTurn.state, "idle");
  });
});

test("Vibe64 Codex app-server accepts plain text for agent conversation turns", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "codex_turn_plain_agent_conversation";
    const sessionRoot = path.join(targetRoot, ".vibe64", "sessions", "active", sessionId);
    const worktree = path.join(sessionRoot, "worktree");
    const runtimeDir = path.join(targetRoot, ".vibe64", "runtime", "codex-app-server");
    const threadId = "thread-1";
    const turnId = "turn-1";
    await mkdir(worktree, {
      recursive: true
    });
    const assistantText = "Done. I adjusted the jobs screen and ran the focused checks.";
    const session = {
      agentRuns: [
        codexAppServerAgentRun({
          providerStatus: "completed",
          providerThreadId: threadId,
          providerTurnId: turnId,
          state: "finalizing",
          updatedAt: "2000-01-01T00:00:00.000Z"
        })
      ],
      completedSteps: ["worktree_created"],
      currentStep: "maintenance_conversation",
      currentStepDefinition: {
        actions: [],
        id: "maintenance_conversation",
        label: "Talk to Codex"
      },
      metadata: {
        codex_app_server_endpoint: `unix://${path.join(runtimeDir, "app-server.sock")}`,
        codex_app_server_runtime_dir: runtimeDir,
        codex_app_server_socket_path: path.join(runtimeDir, "app-server.sock"),
        worktree_path: worktree
      },
      sessionId,
      sessionRoot,
      stepMachine: {
        status: "awaiting_agent_result"
      },
      targetRoot,
      workflowAutopilot: {
        kind: "agent_conversation"
      }
    };
    const runtime = {
      async getSession() {
        return session;
      },
      async submitCurrentStepInput(_sessionId, input = {}) {
        session.lastStepInput = input;
        session.stepMachine.status = "done";
        return session;
      },
      async returnControlFromAgentWait(_sessionId, input = {}) {
        session.returnedControl = input;
        session.stepMachine.status = "waiting_for_input";
        return session;
      },
      store: {
        async mutateSession(_sessionId, operation) {
          return operation();
        },
        async writeAgentRunEvent(_sessionId, runId, event) {
          writeAgentRunEventToSession(session, runId, event);
        },
        async writeMetadataValue(_sessionId, name, value) {
          session.metadata[name] = String(value || "");
        }
      }
    };
    const resumeThreadCalls = [];
    const controller = createCodexTerminalController({
      codexAuthPreflight: noopCodexAuthPreflight,
      codexAppServerProviderOptions: {
        useDocker: false
      },
      codexAppServerProviderFactory: () => ({
        async ensureAvailable() {
          return {
            ok: true
          };
        },
        async resumeThread(resumedThreadId, params) {
          resumeThreadCalls.push({
            params,
            threadId: resumedThreadId
          });
          return {
            raw: {
              turns: [
                {
                  id: turnId,
                  items: [
                    {
                      id: "assistant-message-1",
                      phase: "final_answer",
                      text: assistantText,
                      type: "agentMessage"
                    }
                  ],
                  status: "completed"
                }
              ]
            }
          };
        }
      }),
      projectService: {
        targetRoot,
        async createRuntime() {
          return runtime;
        }
      }
    });

    const state = await controller.terminalState(sessionId);

    assert.equal(state.ok, true);
    assert.deepEqual(resumeThreadCalls, [
      {
        params: {
          cwd: worktree
        },
        threadId
      }
    ]);
    assert.deepEqual(session.lastStepInput, {
      fields: {
        response: assistantText
      },
      kind: "ready",
      source: "codex",
      stepId: "maintenance_conversation",
      stepStatus: "awaiting_agent_result"
    });
    assert.equal(session.returnedControl, undefined);
    assert.equal(session.stepMachine.status, "done");
    assert.equal(codexAppServerAgentRunSnapshot(session).state, "completed");
    assert.equal(codexAppServerAgentRunSnapshot(session).providerStatus, "completed");
    assert.equal(codexAppServerAgentRunSnapshot(session).error, "");
    assert.equal(state.codexAgentTurnActive, false);
    assert.equal(state.codexAgentTurn.state, "idle");
  });
});

test("Vibe64 Codex terminal state explains unprocessable app-server results", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "codex_turn_stale_finalizing_unprocessable";
    const sessionRoot = path.join(targetRoot, ".vibe64", "sessions", "active", sessionId);
    const worktree = path.join(sessionRoot, "worktree");
    const runtimeDir = path.join(targetRoot, ".vibe64", "runtime", "codex-app-server");
    const threadId = "thread-1";
    const turnId = "turn-1";
    await mkdir(worktree, {
      recursive: true
    });
    const assistantText = [
      "For login, JSKIT uses Supabase here.",
      "",
      AGENT_TURN_RESULT_BEGIN,
      JSON.stringify({
        inputFields: [
          {
            id: "supabase_project_url",
            kind: "text",
            label: "Project URL"
          }
        ],
        kind: "waiting_for_input",
        message: "For login, JSKIT uses Supabase here.",
        schema: AGENT_TURN_RESULT_SCHEMA,
        stepId: "seed_application_defined",
        stepStatus: "awaiting_agent_result"
      }),
      AGENT_TURN_RESULT_END
    ].join("\n");
    const session = {
      agentRuns: [
        codexAppServerAgentRun({
          providerStatus: "completed",
          providerThreadId: threadId,
          providerTurnId: turnId,
          state: "finalizing",
          updatedAt: "2000-01-01T00:00:00.000Z"
        })
      ],
      completedSteps: ["worktree_created"],
      currentStep: "seed_application_defined",
      currentStepDefinition: {
        autopilot: {
          kind: "agent_conversation"
        }
      },
      metadata: {
        codex_app_server_endpoint: `unix://${path.join(runtimeDir, "app-server.sock")}`,
        codex_app_server_runtime_dir: runtimeDir,
        codex_app_server_socket_path: path.join(runtimeDir, "app-server.sock"),
        worktree_path: worktree
      },
      sessionId,
      sessionRoot,
      stepMachine: {
        status: "awaiting_agent_result"
      },
      targetRoot
    };
    const runtime = {
      async getSession() {
        return session;
      },
      async submitCurrentStepInput() {
        throw new Error("Vibe64 waiting input field is missing a name.");
      },
      async returnControlFromAgentWait(_sessionId, input = {}) {
        session.returnedControl = input;
        session.stepMachine.status = "waiting_for_input";
        return session;
      },
      store: {
        async mutateSession(_sessionId, operation) {
          return operation();
        },
        async writeAgentRunEvent(_sessionId, runId, event) {
          writeAgentRunEventToSession(session, runId, event);
        },
        async writeMetadataValue(_sessionId, name, value) {
          session.metadata[name] = String(value || "");
        }
      }
    };
    const resumeThreadCalls = [];
    const controller = createCodexTerminalController({
      codexAuthPreflight: noopCodexAuthPreflight,
      codexAppServerProviderOptions: {
        useDocker: false
      },
      codexAppServerProviderFactory: () => ({
        async ensureAvailable() {
          return {
            ok: true
          };
        },
        async resumeThread(resumedThreadId, params) {
          resumeThreadCalls.push({
            params,
            threadId: resumedThreadId
          });
          return {
            raw: {
              turns: [
                {
                  id: turnId,
                  items: [
                    {
                      id: "assistant-message-1",
                      phase: "final_answer",
                      text: assistantText,
                      type: "agentMessage"
                    }
                  ],
                  status: "completed"
                }
              ]
            }
          };
        }
      }),
      projectService: {
        targetRoot,
        async createRuntime() {
          return runtime;
        }
      }
    });

    const state = await controller.terminalState(sessionId);
    const agentRunError = codexAppServerAgentRunSnapshot(session).error;

    assert.equal(state.ok, true);
    assert.deepEqual(resumeThreadCalls, [
      {
        params: {
          cwd: worktree
        },
        threadId
      }
    ]);
    assert.equal(codexAppServerAgentRunSnapshot(session).state, "completed");
    assert.equal(codexAppServerAgentRunSnapshot(session).providerStatus, "completed");
    assert.match(agentRunError, /returned an assistant result, but Vibe64 could not process it/u);
    assert.match(agentRunError, /Vibe64 waiting input field is missing a name/u);
    assert.match(agentRunError, /Input field descriptors must include `name`; `id` is not accepted/u);
    assert.doesNotMatch(agentRunError, /did not receive the assistant result text/u);
    assert.equal(session.stepMachine.status, "waiting_for_input");
    assert.equal(session.returnedControl?.message, agentRunError);
    assert.equal(session.returnedControl?.inputPrompt, agentRunError);
    assert.equal(state.codexAgentTurnActive, false);
    assert.equal(state.codexAgentTurn.state, "idle");
  });
});

test("Vibe64 Codex terminal state returns control for stale finalizing app-server turns", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "codex_turn_stale_finalizing";
    const sessionRoot = path.join(targetRoot, ".vibe64", "sessions", "active", sessionId);
    const worktree = path.join(sessionRoot, "worktree");
    const runtimeDir = path.join(targetRoot, ".vibe64", "runtime", "codex-app-server");
    await mkdir(worktree, {
      recursive: true
    });
    const session = {
      agentRuns: [
        codexAppServerAgentRun({
          providerStatus: "completed",
          providerThreadId: "thread-1",
          providerTurnId: "turn-1",
          state: "finalizing",
          updatedAt: "2000-01-01T00:00:00.000Z"
        })
      ],
      completedSteps: ["worktree_created"],
      currentStep: "plan_and_execute",
      metadata: {
        codex_app_server_endpoint: `unix://${path.join(runtimeDir, "app-server.sock")}`,
        codex_app_server_runtime_dir: runtimeDir,
        codex_app_server_socket_path: path.join(runtimeDir, "app-server.sock"),
        worktree_path: worktree
      },
      sessionId,
      sessionRoot,
      stepMachine: {
        status: "awaiting_agent_result"
      },
      targetRoot
    };
    const runtime = {
      async getSession() {
        return session;
      },
      async returnControlFromAgentWait(_sessionId, input = {}) {
        session.returnedControl = input;
        session.stepMachine.status = "waiting_for_input";
        return session;
      },
      store: {
        async mutateSession(_sessionId, operation) {
          return operation();
        },
        async writeAgentRunEvent(_sessionId, runId, event) {
          writeAgentRunEventToSession(session, runId, event);
        },
        async writeMetadataValue(_sessionId, name, value) {
          session.metadata[name] = String(value || "");
        }
      }
    };
    let readThreadCalls = 0;
    const controller = createCodexTerminalController({
      codexAuthPreflight: noopCodexAuthPreflight,
      codexAppServerProviderFactory: () => ({
        async readThread() {
          readThreadCalls += 1;
          return {
            raw: {
              status: {
                type: "idle"
              }
            }
          };
        }
      }),
      projectService: {
        targetRoot,
        async createRuntime() {
          return runtime;
        }
      }
    });

    const state = await controller.terminalState(sessionId);

    assert.equal(state.ok, true);
    assert.equal(readThreadCalls, 0);
    assert.equal(codexAppServerAgentRunSnapshot(session).state, "completed");
    assert.equal(codexAppServerAgentRunSnapshot(session).providerStatus, "completed");
    assert.match(codexAppServerAgentRunSnapshot(session).error, /did not receive the assistant result text/u);
    assert.equal(session.stepMachine.status, "waiting_for_input");
    assert.match(session.returnedControl?.message || "", /did not receive the assistant result text/u);
    assert.equal(state.codexAgentTurnActive, false);
    assert.equal(state.codexAgentTurn.state, "idle");
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
    const toolHomeSource = path.join(stateRoot, "provider-homes", "codex");
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
      currentStepDefinition: {
        autopilot: {
          kind: "agent_conversation"
        }
      },
      metadata: {
        agent_identity_conversation_id: "stale-codex-thread",
        agent_identity_provider: "codex",
        agent_identity_status: "ready",
        agent_identity_workdir: worktree,
        codex_app_server_provider: "codex_app_server",
        codex_app_server_runtime_dir: path.join(stateRoot, "runtime", "legacy-codex-app-server"),
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
    function fakeConversationTurn(record = {}) {
      return {
        ...record,
        turnId: String(conversationLog.length + 1).padStart(6, "0")
      };
    }
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
      async submitCurrentStepInput(_sessionId, input = {}, options = {}) {
        session.lastStepInput = input;
        session.stepMachine.status = "done";
        const text = input.conversationText || input.fields?.response || input.text || input.message || "";
        if (text && options.recordConversationMessage !== false) {
          conversationLog.push(fakeConversationTurn({
            assistant: {
              text: String(text || "").trim()
            },
            user: null
          }));
        }
        return session;
      },
      async returnControlFromAgentWait(_sessionId, input = {}) {
        session.stepMachine.status = "waiting_for_input";
        session.returnedControl = input;
        return session;
      },
      store: {
        async mutateSession(_sessionId, operation) {
          return operation();
        },
        async writeBackgroundTaskEvent(_sessionId, taskId, {
          event = {},
          patch = {},
          shouldWrite = null
        } = {}) {
          const previous = backgroundTasks.get(taskId) || {
            events: [],
            id: taskId
          };
          if (typeof shouldWrite === "function" && !shouldWrite({
            event,
            patch,
            previous,
            status: patch.status || event.status || previous.status || ""
          })) {
            return previous;
          }
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
          if (task.status !== "failed" && !Object.hasOwn(patch, "error")) {
            task.error = "";
          }
          backgroundTasks.set(taskId, task);
          session.presentation.backgroundTasks = [...backgroundTasks.values()];
          return task;
        },
        async writeAgentRunEvent(_sessionId, runId, event) {
          return writeAgentRunEventToSession(session, runId, event);
        },
        async writeStepState(_sessionId, _stepId, state = {}) {
          session.stepMachine = {
            ...state
          };
          return session.stepMachine;
        },
        async writeMetadataValue(_sessionId, name, value) {
          session.metadata[name] = String(value || "").trim();
        },
        async deleteMetadataValue(_sessionId, name) {
          delete session.metadata[name];
        },
        async deleteMetadataValues(_sessionId, names = []) {
          for (const name of names) {
            delete session.metadata[name];
          }
        },
        async writeConversationUserMessage(_sessionId, {
          text = ""
        } = {}) {
          conversationLog.push(fakeConversationTurn({
            assistant: null,
            user: {
              text: String(text || "").trim()
            }
          }));
          return conversationLog.at(-1);
        },
        async writeConversationAssistantMessage(_sessionId, {
          text = ""
        } = {}) {
          conversationLog.push(fakeConversationTurn({
            assistant: {
              text: String(text || "").trim()
            },
            user: null
          }));
          return conversationLog.at(-1);
        },
        async writeConversationSystemMessage(_sessionId, {
          text = ""
        } = {}) {
          conversationLog.push(fakeConversationTurn({
            assistant: null,
            system: {
              text: String(text || "").trim()
            },
            user: null
          }));
          return conversationLog.at(-1);
        },
        async writeConversationThinkingMessage(_sessionId, {
          at = "",
          requireOpenTurn = false,
          text = ""
        } = {}) {
          const messageText = String(text || "").trim();
          const messageAt = String(at || "").trim();
          const lastTurn = conversationLog.at(-1) || null;
          let turn = lastTurn?.user && !lastTurn.assistant ? lastTurn : null;
          if (!turn && !requireOpenTurn && messageAt) {
            if (
              lastTurn &&
              !lastTurn.system &&
              !lastTurn.user &&
              !lastTurn.assistant &&
              Array.isArray(lastTurn.thinking) &&
              lastTurn.thinking.some((message) => message.at === messageAt)
            ) {
              turn = lastTurn;
            }
          }
          if (!turn) {
            if (requireOpenTurn) {
              return null;
            }
            turn = fakeConversationTurn({
              assistant: null,
              thinking: [],
              user: null
            });
            conversationLog.push(turn);
          }
          const thinking = Array.isArray(turn.thinking) ? turn.thinking : [];
          const existing = messageAt
            ? thinking.find((message) => message.at === messageAt)
            : null;
          if (existing) {
            existing.text = messageText;
          } else {
            thinking.push({
              ...(messageAt ? { at: messageAt } : {}),
              text: messageText
            });
          }
          turn.thinking = thinking;
          return turn;
        },
        async readConversationLog() {
          return conversationLog;
        }
      }
    };
    const providerCalls = {
      close: 0,
      ensureAvailable: 0,
      ensureRuntime: 0,
      resumeThread: [],
      sendTurn: [],
      startThread: [],
      steerTurn: [],
      stopRuntime: 0
    };
    const providerFactoryOptions = [];
    const providerSubscribers = [];
    let appServerPromptTurnCount = 0;
    const provider = {
      close() {
        providerCalls.close += 1;
      },
      async stopRuntime() {
        providerCalls.stopRuntime += 1;
        providerCalls.close += 1;
        return {
          removed: true
        };
      },
      async ensureAvailable() {
        providerCalls.ensureAvailable += 1;
        return {
          ok: true
        };
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
        if (threadId !== "stale-codex-thread") {
          return {
            id: threadId
          };
        }
        throw new Error(`no rollout found for thread id ${threadId}`);
      },
      async sendTurn(threadId, input, params) {
        const bootstrapTurn = /VIBE64_SESSION_BOOTSTRAP/u.test(input);
        const recoveryTurn = /VIBE64_CONTEXT_RECOVERY/u.test(input);
        if (!bootstrapTurn && !recoveryTurn) {
          appServerPromptTurnCount += 1;
        }
        providerCalls.sendTurn.push({
          input,
          params,
          threadId
        });
        return {
          id: bootstrapTurn
            ? "codex-bootstrap-turn-1"
            : recoveryTurn
              ? "codex-context-recovery-turn-1"
              : `codex-app-server-turn-${appServerPromptTurnCount}`,
          status: bootstrapTurn || recoveryTurn ? "completed" : "inProgress"
        };
      },
      async steerTurn(threadId, turnId, input) {
        providerCalls.steerTurn.push({
          input,
          threadId,
          turnId
        });
        return {
          ok: true,
          turnId
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
        return () => {
          const index = providerSubscribers.indexOf(callback);
          if (index >= 0) {
            providerSubscribers.splice(index, 1);
          }
        };
      }
    };
    const publishPromptReasons = [];
    const publishSessionReasons = [];
    const publishSessionEvents = [];
    const controller = createCodexTerminalController({
      agentPreviewCommand: {
        run: async () => ({
          ok: true
        })
      },
      codexAuthPreflight: noopCodexAuthPreflight,
      codexAppServerProviderOptions: {
        useDocker: false
      },
      codexAppServerPromptDeliveryEnabled: true,
      codexAppServerProviderFactory: (options = {}) => {
        providerFactoryOptions.push(options);
        return provider;
      },
      codexToolHomeSource: toolHomeSource,
      codexGitCommand: {
        run: async () => ({
          ok: true
        })
      },
      projectService: {
        targetRoot,
        async projectConfigEnvironment() {
          return {
            MYSQL_HOST: JSKIT_MARIADB_HOST,
            MYSQL_PWD: JSKIT_MARIADB_ROOT_PASSWORD
          };
        },
        async createRuntime() {
          return runtime;
        }
      },
      publishPromptInjected: async (_sessionId, event = {}) => {
        publishPromptReasons.push(event.reason);
      },
      publishSessionChanged: async (_sessionId, event = {}) => {
        publishSessionEvents.push(event);
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
    assert.equal(providerCalls.ensureAvailable, 1);
    assert.equal(providerCalls.ensureRuntime, 1);
    assert.equal(providerFactoryOptions.length, 1);
    assert.equal(providerFactoryOptions[0].targetRoot, targetRoot);
    assert.equal(providerFactoryOptions[0].runtimeDir, "");
    assert.equal(providerFactoryOptions[0].terminalEnv.MYSQL_HOST, JSKIT_MARIADB_HOST);
    assert.equal(providerFactoryOptions[0].terminalEnv.MYSQL_PWD, JSKIT_MARIADB_ROOT_PASSWORD);
    assert.equal(providerFactoryOptions[0].terminalEnv.VIBE64_CODEX_GIT_COMMAND_SESSION_ID, sessionId);
    assert.match(providerFactoryOptions[0].terminalEnv.VIBE64_CODEX_GIT_COMMAND_SOCKET, /command\.sock$/u);
    assert.match(providerFactoryOptions[0].terminalEnv.VIBE64_CODEX_GIT_COMMAND_TOKEN, /^[a-f0-9]{16}$/u);
    assert.ok(providerFactoryOptions[0].terminalEnv.VIBE64_CODEX_GIT_COMMAND_WRAPPER_DIR.startsWith(`${CODEX_ATTACHMENT_CONTAINER_ROOT}/`));
    assert.equal(providerFactoryOptions[0].terminalEnv[VIBE64_AGENT_PREVIEW_COMMAND_SESSION_ID_ENV], sessionId);
    assert.match(providerFactoryOptions[0].terminalEnv[VIBE64_AGENT_PREVIEW_COMMAND_SOCKET_ENV], /preview-command\.sock$/u);
    assert.match(providerFactoryOptions[0].terminalEnv[VIBE64_AGENT_PREVIEW_COMMAND_TOKEN_ENV], /^[a-f0-9]{16}$/u);
    assert.equal(providerFactoryOptions[0].terminalEnv[VIBE64_CODEX_GIT_COMMAND_SYSTEM_ACTOR_SCOPE_ENV], "local");
    assert.equal(providerFactoryOptions[0].terminalEnv[VIBE64_CODEX_GIT_COMMAND_SYSTEM_ACTOR_TARGET_ROOT_ENV], targetRoot);
    assert.equal(providerFactoryOptions[0].terminalEnv[VIBE64_CODEX_GIT_COMMAND_SYSTEM_ACTOR_USER_KEY_ENV], "local");
    assert.equal(providerFactoryOptions[0].terminalEnv[VIBE64_CODEX_GIT_COMMAND_SYSTEM_ACTOR_WORKDIR_ENV], worktree);
    assert.equal(providerFactoryOptions[0].toolHomeSource, toolHomeSource);
    assert.equal(providerFactoryOptions[0].workdir, worktree);
    assert.equal(providerCalls.resumeThread.length, 1);
    assert.equal(providerCalls.resumeThread[0].threadId, "stale-codex-thread");
    assert.equal(providerCalls.startThread.length, 1);
    assert.equal(providerCalls.sendTurn.length, 3);
    assert.equal(providerCalls.startThread[0].approvalPolicy, "never");
    assert.equal(providerCalls.startThread[0].cwd, worktree);
    assert.equal(providerCalls.startThread[0].model, "gpt-5.5");
    assert.equal(providerCalls.startThread[0].sandbox, "danger-full-access");
    assert.match(providerCalls.startThread[0].developerInstructions, /Vibe64 session briefing/u);
    assert.match(providerCalls.startThread[0].developerInstructions, /Vibe64 agent result contract/u);
    assert.match(providerCalls.startThread[0].developerInstructions, /Live progress instruction/u);
    assert.match(providerCalls.startThread[0].developerInstructions, /`git` and `gh` are available/u);
    const bootstrapTurnCall = providerCalls.sendTurn[0];
    const recoveryTurnCall = providerCalls.sendTurn[1];
    const promptTurnCall = providerCalls.sendTurn[2];
    assert.equal(bootstrapTurnCall.threadId, "00000000-0000-4000-8000-000000000004");
    assert.equal(bootstrapTurnCall.params.cwd, worktree);
    assert.match(bootstrapTurnCall.input, /VIBE64_SESSION_BOOTSTRAP/u);
    assert.equal(recoveryTurnCall.threadId, "00000000-0000-4000-8000-000000000004");
    assert.equal(recoveryTurnCall.params.cwd, worktree);
    assert.match(recoveryTurnCall.input, /VIBE64_CONTEXT_RECOVERY/u);
    assert.match(recoveryTurnCall.input, /stale-codex-thread/u);
    assert.doesNotMatch(recoveryTurnCall.input, /Verify app-server prompt delivery/u);
    assert.equal(promptTurnCall.threadId, "00000000-0000-4000-8000-000000000004");
    assert.equal(promptTurnCall.params.cwd, worktree);
    assert.equal(promptTurnCall.params.effort, "xhigh");
    assert.equal(promptTurnCall.params.summary, "concise");
    assert.deepEqual(promptTurnCall.params.sandboxPolicy, {
      type: "dangerFullAccess"
    });
    assert.match(promptTurnCall.input, /Verify app-server prompt delivery/u);
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
      `${STUDIO_MANAGED_CODEX_COMMAND} -c ${STUDIO_MANAGED_CODEX_NO_UPDATE_CONFIG} --remote unix:///vibe64-codex-app-server/app-server.sock resume 00000000-0000-4000-8000-000000000004`
    );
    assert.equal(session.metadata.codex_prompt_handoff_delivery, "app_server");
    assert.equal(codexAppServerAgentRunSnapshot(session).providerTurnId, "codex-app-server-turn-1");
    assert.equal(session.metadata.codex_last_prompt_git_actor_active, "yes");
    assert.equal(session.metadata.codex_last_prompt_git_actor_scope, "local");
    assert.equal(session.metadata.codex_last_prompt_git_actor_session_id, sessionId);
    assert.equal(session.metadata.codex_last_prompt_git_actor_thread_id, "00000000-0000-4000-8000-000000000004");
    assert.equal(session.metadata.codex_last_prompt_git_actor_user_key, "local");
    assert.equal(session.metadata.codex_last_prompt_git_actor_workdir, worktree);
    assert.equal(session.metadata.codex_session_briefing_delivered, "yes");
    assert.equal(session.metadata.codex_session_briefing_delivery, "app_server_developer_instructions");
    assert.equal(
      session.presentation.backgroundTasks.find((task) => task.id === "codex_app_server")?.status,
      "ready"
    );
    const codexContextTask = session.presentation.backgroundTasks.find((task) => task.id === "codex_context");
    assert.equal(codexContextTask?.status, "ready");
    assert.match(codexContextTask?.message || "", /Codex context recovered/u);
    assert.equal(codexContextTask?.error || "", "");
    assert.equal(
      (await runtime.store.readConversationLog())
        .some((turn) => /Codex could not resume its previous internal thread/u.test(turn.system?.text || "")),
      true
    );
    assert.equal(session.metadata.codex_context_replacement_notice_thread_id, "stale-codex-thread");
    assert.deepEqual(publishPromptReasons, ["codex-app-server-prompt-injected"]);
    assert.deepEqual(publishSessionReasons, [
      "codex-app-server-turn-claimed",
      "codex-app-server-running",
      "codex-context-replaced",
      "codex-app-server-ready",
      "codex-context-ready",
      "codex-app-server-turn-active",
      "codex-app-server-turn-active",
      "codex-app-server-ready"
    ]);
    assert.equal(providerSubscribers.length, 1);
    const duplicateResult = await controller.injectCodexPrompt(sessionId, {
      handoffId: "000001-maintenance_conversation.json:agent_conversation:duplicate",
      kind: "codex_prompt_handoff",
      terminalInput: "Vibe64 interactive conversation turn:\nUser/request input:\n- conversationRequest: Duplicate prompt."
    });
    assert.equal(duplicateResult.ok, false);
    assert.equal(duplicateResult.code, "vibe64_agent_turn_already_running");
    assert.equal(duplicateResult.operationOutcome, "agent_already_running");
    assert.equal(duplicateResult.threadId, "00000000-0000-4000-8000-000000000004");
    assert.equal(duplicateResult.turnId, "codex-app-server-turn-1");
    assert.equal(providerCalls.sendTurn.length, 3);
    session.metadata.codex_thread_id = "00000000-0000-4000-8000-000000000099";
    session.metadata.agent_identity_conversation_id = "00000000-0000-4000-8000-000000000099";
    providerSubscribers[0]({
      method: "codex/event",
      params: {
        event: {
          payload: {
            reason: "token_budget",
            type: "context_compacted"
          },
          type: "context_compacted"
        },
        threadId: "00000000-0000-4000-8000-000000000004",
        turnId: "codex-app-server-turn-1"
      }
    });
    await delay(10);
    assert.equal(session.metadata.codex_context_refresh_pending || "", "");
    session.metadata.codex_thread_id = "00000000-0000-4000-8000-000000000004";
    session.metadata.agent_identity_conversation_id = "00000000-0000-4000-8000-000000000004";
    providerSubscribers[0]({
      method: "codex/event",
      params: {
        event: {
          payload: {
            message: "This progress text mentions context_compacted but is not a provider compaction signal.",
            type: "status"
          },
          type: "event_msg"
        },
        threadId: "00000000-0000-4000-8000-000000000004",
        turnId: "codex-app-server-turn-1"
      }
    });
    await delay(5);
    assert.equal(providerCalls.steerTurn.length, 0);
    assert.equal(session.metadata.codex_context_refresh_pending || "", "");
    providerSubscribers[0]({
      method: "codex/event",
      params: {
        event: {
          payload: {
            reason: "token_budget",
            type: "context_compacted"
          },
          type: "context_compacted"
        },
        threadId: "00000000-0000-4000-8000-000000000004",
        turnId: "codex-app-server-turn-1"
      }
    });
    await waitForCondition(
      () => session.metadata.codex_context_refresh_pending === "yes",
      "Codex context compaction should leave a pending refresh after the turn is no longer steerable."
    );
    assert.equal(providerCalls.steerTurn.length, 0);
    assert.equal(session.metadata.codex_context_refresh_pending, "yes");
    assert.equal(session.metadata.codex_context_refresh_reason, "context_compacted");
    providerSubscribers[0]({
      method: "item/reasoning/summaryPartAdded",
      params: {
        itemId: "workflow-reasoning-summary-1",
        summaryIndex: 0,
        threadId: "00000000-0000-4000-8000-000000000004",
        turnId: "codex-app-server-turn-1"
      }
    });
    providerSubscribers[0]({
      method: "item/reasoning/summaryTextDelta",
      params: {
        delta: "Running JSKIT verification from the active app-server turn.",
        itemId: "workflow-reasoning-summary-1",
        summaryIndex: 0,
        threadId: "00000000-0000-4000-8000-000000000004",
        turnId: "codex-app-server-turn-1"
      }
    });
    await delay(30);
    assert.deepEqual((await runtime.store.readConversationLog()).flatMap((turn) => (turn.thinking || []).map((message) => message.text)).filter(Boolean), [
      "Running JSKIT verification from the active app-server turn."
    ]);
    assert.equal(publishSessionReasons.at(-1), "codex-app-server-reasoning-summary");
    assert.equal(publishSessionEvents.at(-1)?.payload?.conversationLogPatch?.type, "upsert-turn");
    assert.equal(publishSessionEvents.at(-1)?.payload?.conversationLogPatch?.turn?.turnId, "000002");
    assert.equal(
      publishSessionEvents.at(-1)?.payload?.conversationLogPatch?.turn?.thinking?.[0]?.text,
      "Running JSKIT verification from the active app-server turn."
    );
    const steerResult = await controller.steerTurn(sessionId, {
      message: "What are you up to?"
    });
    assert.equal(steerResult.ok, true);
    assert.equal(providerCalls.steerTurn.length, 1);
    const userSteerCall = providerCalls.steerTurn[0];
    assert.equal(userSteerCall.threadId, "00000000-0000-4000-8000-000000000004");
    assert.equal(userSteerCall.turnId, "codex-app-server-turn-1");
    assertCodexSteerProviderInput(userSteerCall.input, "What are you up to?", {
      stepId: "maintenance_conversation"
    });
    assert.equal(session.metadata.codex_context_refresh_pending, "yes");
    assert.equal((await runtime.store.readConversationLog()).at(-1)?.user?.text, "What are you up to?");
    const publishCountBeforeSteerUserMirror = publishSessionEvents.length;
    providerSubscribers[0]({
      method: "item/completed",
      params: {
        item: {
          content: [
            {
              text: userSteerCall.input,
              type: "text"
            }
          ],
          id: "steer-wrapper-user-message-1",
          type: "userMessage"
        },
        threadId: "00000000-0000-4000-8000-000000000004",
        turnId: "codex-app-server-turn-1"
      }
    });
    await delay(5);
    assert.equal(publishSessionEvents.length, publishCountBeforeSteerUserMirror);
    assert.equal(publishSessionReasons.includes("codex-app-server-terminal-user-message"), false);
    assert.equal(
      (await runtime.store.readConversationLog())
        .map((turn) => turn.user?.text)
        .filter(Boolean)
        .some((text) => /^Vibe64 steering update for the active Codex turn\./u.test(text)),
      false
    );
    providerSubscribers[0]({
      method: "item/reasoning/summaryPartAdded",
      params: {
        itemId: "reasoning-summary-1",
        summaryIndex: 0,
        threadId: "00000000-0000-4000-8000-000000000004",
        turnId: "codex-app-server-turn-1"
      }
    });
    providerSubscribers[0]({
      method: "item/reasoning/summaryTextDelta",
      params: {
        delta: "Checked the app-server prompt delivery result.",
        itemId: "reasoning-summary-1",
        summaryIndex: 0,
        threadId: "00000000-0000-4000-8000-000000000004",
        turnId: "codex-app-server-turn-1"
      }
    });
    await delay(30);
    assert.deepEqual((await runtime.store.readConversationLog()).flatMap((turn) => (turn.thinking || []).map((message) => message.text)).filter(Boolean), [
      "Running JSKIT verification from the active app-server turn.",
      "Checked the app-server prompt delivery result."
    ]);
    assert.equal(publishSessionReasons.at(-1), "codex-app-server-reasoning-summary");
    assert.equal(publishSessionEvents.at(-1)?.payload?.conversationLogPatch?.type, "upsert-turn");
    assert.equal(publishSessionEvents.at(-1)?.payload?.conversationLogPatch?.turn?.turnId, "000003");
    assert.equal(
      publishSessionEvents.at(-1)?.payload?.conversationLogPatch?.turn?.thinking?.[0]?.text,
      "Checked the app-server prompt delivery result."
    );
    providerSubscribers[0]({
      method: "item/reasoning/summaryPartAdded",
      params: {
        itemId: "reasoning-summary-2",
        summaryIndex: 0,
        threadId: "00000000-0000-4000-8000-000000000004",
        turnId: "codex-app-server-turn-1"
      }
    });
    providerSubscribers[0]({
      method: "item/reasoning/summaryTextDelta",
      params: {
        delta: "**Preparing",
        itemId: "reasoning-summary-2",
        summaryIndex: 0,
        threadId: "00000000-0000-4000-8000-000000000004",
        turnId: "codex-app-server-turn-1"
      }
    });
    providerSubscribers[0]({
      method: "item/reasoning/summaryTextDelta",
      params: {
        delta: " to verify UI layouts",
        itemId: "reasoning-summary-2",
        summaryIndex: 0,
        threadId: "00000000-0000-4000-8000-000000000004",
        turnId: "codex-app-server-turn-1"
      }
    });
    providerSubscribers[0]({
      method: "item/reasoning/summaryTextDelta",
      params: {
        delta: "**",
        itemId: "reasoning-summary-2",
        summaryIndex: 0,
        threadId: "00000000-0000-4000-8000-000000000004",
        turnId: "codex-app-server-turn-1"
      }
    });
    await delay(30);
    assert.deepEqual((await runtime.store.readConversationLog()).flatMap((turn) => (turn.thinking || []).map((message) => message.text)).filter(Boolean), [
      "Running JSKIT verification from the active app-server turn.",
      "Checked the app-server prompt delivery result.",
      "Preparing to verify UI layouts"
    ]);
    const publishCountBeforeAssistantProgress = publishSessionEvents.length;
    providerSubscribers[0]({
      method: "item/completed",
      params: {
        item: {
          content: [
            {
              text: "I am checking the generated app.",
              type: "text"
            }
          ],
          id: "assistant-progress-1",
          type: "assistantMessage"
        },
        threadId: "00000000-0000-4000-8000-000000000004",
        turnId: "codex-app-server-turn-1"
      }
    });
    await delay(5);
    assert.equal(publishSessionEvents.length, publishCountBeforeAssistantProgress + 1);
    assert.equal(publishSessionReasons.at(-1), "codex-app-server-live-progress");
    assert.equal(publishSessionEvents.at(-1)?.payload?.conversationLogPatch?.type, "upsert-turn");
    assert.equal(
      publishSessionEvents.at(-1)?.payload?.conversationLogPatch?.turn?.thinking?.at(-1)?.text,
      "I am checking the generated app."
    );
    assert.deepEqual((await runtime.store.readConversationLog()).map((turn) => turn.assistant?.text).filter(Boolean), []);
    assert.deepEqual((await runtime.store.readConversationLog()).flatMap((turn) => (turn.thinking || []).map((message) => message.text)).filter(Boolean), [
      "Running JSKIT verification from the active app-server turn.",
      "Checked the app-server prompt delivery result.",
      "Preparing to verify UI layouts",
      "I am checking the generated app."
    ]);
    providerSubscribers[0]({
      method: "item/reasoning/summaryTextDelta",
      params: {
        delta: "\nInspecting remaining CSS.",
        itemId: "reasoning-summary-1",
        summaryIndex: 0,
        threadId: "00000000-0000-4000-8000-000000000004",
        turnId: "codex-app-server-turn-1"
      }
    });
    await delay(30);
    assert.deepEqual((await runtime.store.readConversationLog()).flatMap((turn) => (turn.thinking || []).map((message) => message.text)).filter(Boolean), [
      "Running JSKIT verification from the active app-server turn.",
      "Checked the app-server prompt delivery result.",
      "Preparing to verify UI layouts",
      "I am checking the generated app.",
      "Inspecting remaining CSS."
    ]);
    providerSubscribers[0]({
      method: "codex/event",
      params: {
        event: {
          payload: {
            message: "I found the relevant area: visible Codex terminal writes go through the terminal PTY, while the UI watches durable app-server run metadata and conversation events.",
            phase: "progress",
            type: "agent_message"
          },
          type: "event_msg"
        },
        threadId: "00000000-0000-4000-8000-000000000004",
        turnId: "codex-app-server-turn-1"
      }
    });
    await delay(5);
    assert.equal(publishSessionEvents.length, publishCountBeforeAssistantProgress + 3);
    assert.equal(publishSessionReasons.at(-1), "codex-app-server-live-progress");
    assert.equal(
      publishSessionEvents.at(-1)?.payload?.conversationLogPatch?.turn?.thinking?.at(-1)?.text,
      "I found the relevant area: visible Codex terminal writes go through the terminal PTY, while the UI watches durable app-server run metadata and conversation events."
    );
    const publishCountAfterAssistantProgress = publishSessionEvents.length;
    providerSubscribers[0]({
      method: "item/completed",
      params: {
        item: {
          content: [
            {
              text: "Checking generated files.\nThis second line should not be live progress.",
              type: "text"
            }
          ],
          id: "assistant-progress-2",
          type: "assistantMessage"
        },
        threadId: "00000000-0000-4000-8000-000000000004",
        turnId: "codex-app-server-turn-1"
      }
    });
    await delay(5);
    assert.equal(publishSessionEvents.length, publishCountAfterAssistantProgress);
    providerSubscribers[0]({
      method: "item/completed",
      params: {
        item: {
          content: [
            {
              text: [
                "Here are the questions.",
                AGENT_TURN_RESULT_BEGIN,
                JSON.stringify({
                  kind: "waiting_for_input",
                  schema: AGENT_TURN_RESULT_SCHEMA,
                  stepId: "seed_application_defined",
                  stepStatus: "awaiting_agent_result"
                }, null, 2),
                AGENT_TURN_RESULT_END
              ].join("\n"),
              type: "text"
            }
          ],
          id: "assistant-progress-envelope",
          type: "assistantMessage"
        },
        threadId: "00000000-0000-4000-8000-000000000004",
        turnId: "codex-app-server-turn-1"
      }
    });
    await delay(5);
    assert.equal(publishSessionEvents.length, publishCountAfterAssistantProgress);
    assert.equal(publishSessionReasons.includes("codex-app-server-live-progress"), true);
    providerSubscribers[0]({
      method: "turn/completed",
      params: {
        status: "completed",
        threadId: "00000000-0000-4000-8000-000000000004",
        turnId: "codex-app-server-turn-1"
      }
    });
    await delay(5);
    assert.equal(codexAppServerAgentRunSnapshot(session).state, "finalizing");
    assert.equal(codexAppServerAgentRunSnapshot(session).providerStatus, "completed");
    assert.equal(session.stepMachine.status, "awaiting_agent_result");
    session.stepMachine = {
      from: "awaiting_agent_result",
      source: "system_recovery",
      status: "waiting_for_input"
    };
    const transcriptAssistantText = [
      "The app-server turn is complete.",
      "",
      "This visible prose should be preserved in chat.",
      AGENT_TURN_RESULT_BEGIN,
      JSON.stringify({
        fields: {
          response: "The app-server turn is complete."
        },
        kind: "ready",
        schema: AGENT_TURN_RESULT_SCHEMA,
        stepId: "maintenance_conversation",
        stepStatus: "awaiting_agent_result"
      }),
      AGENT_TURN_RESULT_END
    ].join("\n");
    providerSubscribers[0]({
      method: "codex/event",
      params: {
        event: {
          payload: {
            message: transcriptAssistantText,
            phase: "final_answer",
            type: "agent_message"
          },
          type: "event_msg"
        },
        threadId: "00000000-0000-4000-8000-000000000004",
        turnId: "codex-app-server-turn-1"
      }
    });
    providerSubscribers[0]({
      method: "codex/event",
      params: {
        event: {
          payload: {
            content: [
              {
                text: transcriptAssistantText,
                type: "output_text"
              }
            ],
            phase: "final_answer",
            role: "assistant",
            type: "message"
          },
          type: "response_item"
        },
        threadId: "00000000-0000-4000-8000-000000000004",
        turnId: "codex-app-server-turn-1"
      }
    });
    providerSubscribers[0]({
      method: "codex/event",
      params: {
        event: {
          payload: {
            last_agent_message: transcriptAssistantText,
            turn_id: "codex-app-server-turn-1"
          },
          type: "task_complete"
        },
        threadId: "00000000-0000-4000-8000-000000000004"
      }
    });
    await delay(10);
    assert.deepEqual(session.lastStepInput, {
      fields: {
        response: "The app-server turn is complete."
      },
      conversationText: "The app-server turn is complete.\n\nThis visible prose should be preserved in chat.",
      inputFields: [],
      kind: "ready",
      message: "",
      source: "codex",
      stepId: "maintenance_conversation",
      stepStatus: "awaiting_agent_result",
      text: ""
    });
    assert.equal(session.stepMachine.status, "done");
    assert.equal(codexAppServerAgentRunSnapshot(session).state, "completed");
    assert.equal(codexAppServerAgentRunSnapshot(session).providerStatus, "completed");
    assert.equal(codexAppServerAgentRunSnapshot(session).error, "");
    assert.deepEqual((await runtime.store.readConversationLog()).map((turn) => turn.assistant?.text).filter(Boolean), [
      "The app-server turn is complete.\n\nThis visible prose should be preserved in chat."
    ]);
    assert.deepEqual((await runtime.store.readConversationLog()).flatMap((turn) => (turn.thinking || []).map((message) => message.text)).filter(Boolean), [
      "Running JSKIT verification from the active app-server turn.",
      "Checked the app-server prompt delivery result.",
      "Preparing to verify UI layouts",
      "I am checking the generated app.",
      "Inspecting remaining CSS.",
      "I found the relevant area: visible Codex terminal writes go through the terminal PTY, while the UI watches durable app-server run metadata and conversation events."
    ]);
    const publishReasonBeforeTerminalTurn = publishSessionReasons.at(-1);
    providerSubscribers[0]({
      method: "turn/started",
      params: {
        status: "inProgress",
        threadId: "00000000-0000-4000-8000-000000000004",
        turnId: "terminal-turn-1"
      }
    });
    await delay(5);
    const sessionAfterTerminalTurnStarted = await runtime.getSession(sessionId);
    assert.equal(codexAppServerAgentRunSnapshot(sessionAfterTerminalTurnStarted).state, "active");
    assert.equal(codexAppServerAgentRunSnapshot(sessionAfterTerminalTurnStarted).providerStatus, "inProgress");
    assert.equal(codexAppServerAgentRunSnapshot(sessionAfterTerminalTurnStarted).providerTurnId, "terminal-turn-1");
    assert.equal(codexAppServerAgentRunSnapshot(sessionAfterTerminalTurnStarted).inputSource, "terminal");
    assert.equal(publishSessionReasons.at(-1), "codex-app-server-turn-active");
    assert.deepEqual(publishSessionEvents.at(-1)?.payload?.codexAgentTurn, {
      active: true,
      completedAt: "",
      error: "",
      inputSource: "terminal",
      runId: "codex_app_server",
      runState: "active",
      startedAt: publishSessionEvents.at(-1)?.payload?.codexAgentTurn?.startedAt,
      state: "active",
      status: "inProgress",
      threadId: "00000000-0000-4000-8000-000000000004",
      turnId: "terminal-turn-1",
      updatedAt: publishSessionEvents.at(-1)?.payload?.codexAgentTurn?.updatedAt
    });
    assert.equal(publishSessionEvents.at(-1)?.payload?.codexAgentTurnActive, true);
    assert.equal(publishSessionEvents.at(-1)?.payload?.codexAgentRun?.providerTurnId, "terminal-turn-1");
    assert.notEqual(publishSessionReasons.at(-1), publishReasonBeforeTerminalTurn);
    providerSubscribers[0]({
      method: "item/reasoning/summaryPartAdded",
      params: {
        itemId: "terminal-reasoning-summary-1",
        summaryIndex: 0,
        threadId: "00000000-0000-4000-8000-000000000004",
        turnId: "terminal-turn-1"
      }
    });
    providerSubscribers[0]({
      method: "item/reasoning/summaryTextDelta",
      params: {
        delta: "Direct terminal reasoning should stay out of the Vibe64 conversation log.",
        itemId: "terminal-reasoning-summary-1",
        summaryIndex: 0,
        threadId: "00000000-0000-4000-8000-000000000004",
        turnId: "terminal-turn-1"
      }
    });
    await delay(30);
    assert.deepEqual((await runtime.store.readConversationLog()).flatMap((turn) => (turn.thinking || []).map((message) => message.text)).filter(Boolean), [
      "Running JSKIT verification from the active app-server turn.",
      "Checked the app-server prompt delivery result.",
      "Preparing to verify UI layouts",
      "I am checking the generated app.",
      "Inspecting remaining CSS.",
      "I found the relevant area: visible Codex terminal writes go through the terminal PTY, while the UI watches durable app-server run metadata and conversation events."
    ]);
    assert.equal(publishSessionReasons.at(-1), "codex-app-server-turn-active");
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
    assert.equal(
      (await runtime.store.readConversationLog())
        .map((turn) => turn.user?.text)
        .filter(Boolean)
        .includes("This was typed directly into the Codex terminal."),
      false
    );
    assert.equal(publishSessionReasons.includes("codex-app-server-terminal-user-message"), false);
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
    await delay(5);
    assert.equal(
      (await runtime.store.readConversationLog())
        .map((turn) => turn.user?.text)
        .filter(Boolean)
        .includes("This was typed directly into the Codex terminal."),
      true
    );
    assert.equal(publishSessionReasons.includes("codex-app-server-terminal-user-message"), true);
    providerSubscribers[0]({
      method: "item/completed",
      params: {
        item: {
          content: [
            {
              text: "Continuing from the interruption.",
              type: "text"
            }
          ],
          id: "terminal-assistant-progress-1",
          type: "assistantMessage"
        },
        threadId: "00000000-0000-4000-8000-000000000004",
        turnId: "terminal-turn-1"
      }
    });
    await delay(5);
    assert.equal(
      (await runtime.store.readConversationLog())
        .map((turn) => turn.assistant?.text)
        .filter(Boolean)
        .includes("Continuing from the interruption."),
      true
    );
    providerSubscribers[0]({
      method: "item/completed",
      params: {
        item: {
          content: [
            {
              text: "Direct Codex terminal assistant answer.",
              type: "text"
            }
          ],
          id: "terminal-assistant-message-1",
          type: "assistantMessage"
        },
        threadId: "00000000-0000-4000-8000-000000000004",
        turnId: "terminal-turn-1"
      }
    });
    await delay(5);
    assert.equal(
      (await runtime.store.readConversationLog())
        .flatMap((turn) => (turn.thinking || []).map((message) => message.text))
        .includes("Continuing from the interruption."),
      false
    );
    assert.equal(
      (await runtime.store.readConversationLog())
        .map((turn) => turn.assistant?.text)
        .filter(Boolean)
        .includes("Direct Codex terminal assistant answer."),
      true
    );
    providerSubscribers[0]({
      method: "turn/completed",
      params: {
        status: "completed",
        threadId: "00000000-0000-4000-8000-000000000004",
        turnId: "terminal-turn-1"
      }
    });
    await delay(10);
    const conversationAfterTerminalTurn = await runtime.store.readConversationLog();
    assert.equal(
      conversationAfterTerminalTurn
        .map((turn) => turn.user?.text)
        .filter(Boolean)
        .includes("This was typed directly into the Codex terminal."),
      true
    );
    assert.equal(
      conversationAfterTerminalTurn
        .map((turn) => turn.assistant?.text)
        .filter(Boolean)
        .includes("Direct Codex terminal assistant answer."),
      true
    );
    assert.equal(publishSessionReasons.includes("codex-app-server-terminal-user-message"), true);
    assert.equal(publishSessionReasons.includes("codex-app-server-terminal-thinking-message"), false);
    assert.equal(publishSessionReasons.includes("codex-app-server-terminal-assistant-message"), true);
    assert.equal(
      publishSessionEvents
        .some((event) => event.reason === "codex-app-server-terminal-user-message" &&
          event.payload?.conversationLogPatch?.turn?.user?.text === "This was typed directly into the Codex terminal."),
      true
    );
    assert.equal(
      publishSessionEvents
        .some((event) => event.reason === "codex-app-server-terminal-assistant-message" &&
          event.payload?.conversationLogPatch?.turn?.assistant?.text === "Continuing from the interruption."),
      true
    );
    assert.equal(
      publishSessionEvents
        .some((event) => event.reason === "codex-app-server-terminal-assistant-message" &&
          event.payload?.conversationLogPatch?.turn?.assistant?.text === "Direct Codex terminal assistant answer."),
      true
    );
    const sessionAfterTerminalTurnCompleted = await runtime.getSession(sessionId);
    assert.equal(codexAppServerAgentRunSnapshot(sessionAfterTerminalTurnCompleted).state, "completed");
    assert.equal(codexAppServerAgentRunSnapshot(sessionAfterTerminalTurnCompleted).providerStatus, "completed");
    assert.equal(codexAppServerAgentRunSnapshot(sessionAfterTerminalTurnCompleted).providerTurnId, "terminal-turn-1");
    assert.equal(codexAppServerAgentRunSnapshot(sessionAfterTerminalTurnCompleted).inputSource, "terminal");
    const terminalIdleEvent = publishSessionEvents.findLast((event) => (
      event.reason === "codex-app-server-turn-idle" &&
      event.payload?.codexAgentTurn?.turnId === "terminal-turn-1"
    ));
    assert.equal(terminalIdleEvent?.payload?.codexAgentTurnActive, false);
    assert.equal(terminalIdleEvent?.payload?.codexAgentTurn?.state, "idle");
    assert.equal(terminalIdleEvent?.payload?.codexAgentTurn?.status, "completed");
    providerSubscribers[0]({
      method: "item/completed",
      params: {
        item: {
          content: [
            {
              text: "Terminal prompt without turn started.",
              type: "text"
            }
          ],
          id: "terminal-user-message-without-start",
          type: "userMessage"
        },
        threadId: "00000000-0000-4000-8000-000000000004",
        turnId: "terminal-turn-without-start"
      }
    });
    await delay(5);
    const sessionAfterTerminalUserWithoutStart = await runtime.getSession(sessionId);
    assert.equal(codexAppServerAgentRunSnapshot(sessionAfterTerminalUserWithoutStart).state, "active");
    assert.equal(codexAppServerAgentRunSnapshot(sessionAfterTerminalUserWithoutStart).providerStatus, "inProgress");
    assert.equal(codexAppServerAgentRunSnapshot(sessionAfterTerminalUserWithoutStart).providerTurnId, "terminal-turn-without-start");
    assert.equal(codexAppServerAgentRunSnapshot(sessionAfterTerminalUserWithoutStart).inputSource, "terminal");
    assert.equal(
      (await runtime.store.readConversationLog())
        .map((turn) => turn.user?.text)
        .filter(Boolean)
        .includes("Terminal prompt without turn started."),
      true
    );
    providerSubscribers[0]({
      method: "item/completed",
      params: {
        item: {
          content: [
            {
              text: "Terminal answer without turn started.",
              type: "text"
            }
          ],
          id: "terminal-assistant-message-without-start",
          type: "assistantMessage"
        },
        threadId: "00000000-0000-4000-8000-000000000004",
        turnId: "terminal-turn-without-start"
      }
    });
    await delay(5);
    assert.equal(
      (await runtime.store.readConversationLog())
        .map((turn) => turn.assistant?.text)
        .filter(Boolean)
        .includes("Terminal answer without turn started."),
      true
    );
    providerSubscribers[0]({
      method: "turn/completed",
      params: {
        status: "completed",
        threadId: "00000000-0000-4000-8000-000000000004",
        turnId: "terminal-turn-without-start"
      }
    });
    await delay(10);
    assert.equal(codexAppServerAgentRunSnapshot(session).state, "completed");
    assert.equal(codexAppServerAgentRunSnapshot(session).providerStatus, "completed");
    assert.equal(codexAppServerAgentRunSnapshot(session).providerTurnId, "terminal-turn-without-start");
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
    providerSubscribers[0]({
      method: "item/completed",
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
    const conversationAfterRoutedTerminalMessage = await runtime.store.readConversationLog();
    assert.equal(
      conversationAfterRoutedTerminalMessage
        .map((turn) => turn.user?.text)
        .filter(Boolean)
        .filter((text) => text === "This was typed directly into the Codex terminal.")
        .length,
      1
    );
    assert.equal(
      conversationAfterRoutedTerminalMessage
        .map((turn) => turn.user?.text)
        .filter(Boolean)
        .some((text) => text.includes("Already in Vibe64 chat.")),
      false
    );
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
    assert.equal(codexAppServerAgentRunSnapshot(session).state, "completed");
    assert.equal(codexAppServerAgentRunSnapshot(session).providerStatus, "completed");
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
    assert.equal(codexAppServerAgentRunSnapshot(session).state, "completed");
    assert.equal(codexAppServerAgentRunSnapshot(session).providerStatus, "completed");
    session.stepMachine.status = "awaiting_agent_result";
    session.returnedControl = null;
    providerSubscribers[0]({
      method: "turn/started",
      params: {
        status: "inProgress",
        threadId: "00000000-0000-4000-8000-000000000004",
        turnId: "codex-app-server-failed-turn"
      }
    });
    await delay(5);
    providerSubscribers[0]({
      method: "turn/completed",
      params: {
        error: {
          message: "app-server crashed"
        },
        status: "failed",
        threadId: "00000000-0000-4000-8000-000000000004",
        turnId: "codex-app-server-failed-turn"
      }
    });
    await delay(5);
    assert.equal(codexAppServerAgentRunSnapshot(session).state, "failed");
    assert.equal(codexAppServerAgentRunSnapshot(session).providerStatus, "failed");
    assert.match(session.returnedControl?.message || "", /Codex app-server failed before completing this turn/u);
    assert.doesNotMatch(session.returnedControl?.message || "", /result envelope/u);
    const steerCountBeforePendingRefresh = providerCalls.steerTurn.length;
    providerSubscribers[0]({
      method: "codex/event",
      params: {
        event: {
          payload: {
            reason: "token_budget",
            type: "context_refresh_required"
          },
          type: "context_refresh_required"
        },
        threadId: "00000000-0000-4000-8000-000000000004",
        turnId: "codex-app-server-after-failed-turn"
      }
    });
    await delay(10);
    assert.equal(providerCalls.steerTurn.length, steerCountBeforePendingRefresh);
    assert.equal(session.metadata.codex_context_refresh_pending, "yes");
    assert.equal(session.metadata.codex_context_refresh_reason, "context_refresh_required");
    const sendTurnCountBeforeRefreshPrompt = providerCalls.sendTurn.length;
    session.returnedControl = null;
    session.stepMachine.status = "awaiting_agent_result";
    const refreshedPromptResult = await controller.injectCodexPrompt(sessionId, {
      handoffId: "000002-maintenance_conversation.json:agent_conversation",
      kind: "codex_prompt_handoff",
      terminalInput: "Vibe64 interactive conversation turn:\nUser/request input:\n- conversationRequest: Continue after context refresh."
    });
    assert.equal(refreshedPromptResult.ok, true);
    assert.equal(refreshedPromptResult.turnId, "codex-app-server-turn-2");
    assert.equal(providerCalls.sendTurn.length, sendTurnCountBeforeRefreshPrompt + 1);
    const refreshedPromptCall = providerCalls.sendTurn.at(-1);
    assert.match(refreshedPromptCall.input, /VIBE64_CONTEXT_REFRESH/u);
    assert.match(refreshedPromptCall.input, /Vibe64 session briefing/u);
    assert.match(refreshedPromptCall.input, /Continue after context refresh/u);
    assert.equal(session.metadata.codex_context_refresh_pending || "", "");
    assert.equal(session.metadata.codex_context_refresh_delivery, "prompt");
    assert.equal(session.metadata.codex_context_refresh_delivered_reason, "context_refresh_required");
    await controller.closeAllForSession(sessionId);
    assert.equal(providerCalls.close, 1);
    assert.equal(providerCalls.stopRuntime, 1);
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
    const terminalService = createTestTerminalService({
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

test("Vibe64 Codex app-server blocks a removed session worktree without restarting app-server", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "codex_app_server_removed_worktree";
    const sessionRoot = path.join(targetRoot, ".vibe64", "sessions", "active", sessionId);
    const worktree = path.join(sessionRoot, "worktree");
    const runtime = new Vibe64SessionRuntime({
      targetRoot
    });
    await runtime.createSession({
      initialStep: "worktree_created",
      metadata: {
        worktree_path: worktree,
        worktree_removed: "yes",
        worktree_removed_reason: "abandoned"
      },
      sessionId
    });

    const providerCalls = [];
    const publishReasons = [];
    const terminalService = createTestTerminalService({
      codexTerminalController: {
        codexAppServerProviderFactory(options = {}) {
          providerCalls.push(options);
          throw new Error("provider must not start for a removed worktree");
        }
      },
      projectService: {
        targetRoot,
        async createRuntime() {
          return runtime;
        }
      },
      publishSessionChanged: {
        codexTerminal: async (changedSessionId, event = {}) => {
          publishReasons.push({
            reason: event.reason,
            sessionId: changedSessionId
          });
        }
      }
    });

    const result = await terminalService.ensureCodexThread(sessionId);
    const session = await runtime.getSession(sessionId);
    const task = session.presentation.backgroundTasks.find((entry) => entry.id === "codex_app_server");

    assert.equal(result.ok, false);
    assert.equal(result.code, "vibe64_session_worktree_unavailable");
    assert.equal(result.retryable, false);
    assert.match(result.error, /Session clone was removed/u);
    assert.equal(providerCalls.length, 0);
    assert.equal(task.status, "ready");
    assert.equal(task.retry, null);
    assert.match(task.error, /Session clone was removed/u);
    assert.deepEqual(publishReasons.map((entry) => entry.reason), [
      "codex-app-server-blocked"
    ]);
  });
});

test("Vibe64 Codex app-server blocks a closing session worktree without restarting app-server", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "codex_app_server_closing_worktree";
    const sessionRoot = path.join(targetRoot, ".vibe64", "sessions", "active", sessionId);
    const worktree = path.join(sessionRoot, "worktree");
    const runtime = new Vibe64SessionRuntime({
      targetRoot
    });
    await runtime.createSession({
      initialStep: "worktree_created",
      metadata: {
        session_closing_reason: "abandoned",
        worktree_path: worktree
      },
      sessionId
    });
    await mkdir(worktree, {
      recursive: true
    });

    const providerCalls = [];
    const publishReasons = [];
    const terminalService = createTestTerminalService({
      codexTerminalController: {
        codexAppServerProviderFactory(options = {}) {
          providerCalls.push(options);
          throw new Error("provider must not start for a closing worktree");
        }
      },
      projectService: {
        targetRoot,
        async createRuntime() {
          return runtime;
        }
      },
      publishSessionChanged: {
        codexTerminal: async (changedSessionId, event = {}) => {
          publishReasons.push({
            reason: event.reason,
            sessionId: changedSessionId
          });
        }
      }
    });

    const result = await terminalService.ensureCodexThread(sessionId);
    const session = await runtime.getSession(sessionId);
    const task = session.presentation.backgroundTasks.find((entry) => entry.id === "codex_app_server");

    assert.equal(result.ok, false);
    assert.equal(result.code, "vibe64_session_worktree_unavailable");
    assert.equal(result.retryable, false);
    assert.match(result.error, /Session is abandoned/u);
    assert.equal(providerCalls.length, 0);
    assert.equal(task.status, "ready");
    assert.equal(task.retry, null);
    assert.match(task.error, /Session is abandoned/u);
    assert.deepEqual(publishReasons.map((entry) => entry.reason), [
      "codex-app-server-blocked"
    ]);
  });
});

test("Vibe64 self-target Codex app-server uses native provider control", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "self_target_native_codex_app_server";
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

    const providerOptions = [];
    const terminalService = createTestTerminalService({
      codexTerminalController: {
        codexAppServerProviderFactory(options = {}) {
          providerOptions.push(options);
          return {
            ensureRuntime: async () => ({
              containerEndpoint: "unix:///tmp/vibe64-self-target-test.sock",
              endpoint: "unix:///tmp/vibe64-self-target-test.sock",
              runtimeDir: path.join(targetRoot, ".vibe64", "runtime", "agent-providers", "codex-app-server-test"),
              socketPath: "/tmp/vibe64-self-target-test.sock",
              transport: "unix"
            }),
            sendTurn: async () => ({
              id: "turn-1",
              status: "completed"
            }),
            startThread: async () => ({
              id: "00000000-0000-4000-8000-000000000005",
              status: "completed"
            }),
            subscribe: () => () => null
          };
        }
      },
      env: {
        [VIBE64_SELF_TARGET_SYSTEM_ROOT_ENV]: "1"
      },
      projectService: {
        targetRoot,
        async createRuntime() {
          return runtime;
        }
      }
    });

    const result = await terminalService.ensureCodexThread(sessionId);

    assert.equal(result.ok, true);
    assert.equal(result.codexThreadReady, true);
    assert.equal(providerOptions.length, 1);
    assert.equal(providerOptions[0].useDocker, false);
    assert.equal(providerOptions[0].targetRoot, targetRoot);
    assert.equal(providerOptions[0].workdir, worktree);
  });
});

test("Vibe64 self-target Codex interrupt keeps native provider control", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "self_target_interrupt_native_codex_app_server";
    const sessionRoot = path.join(targetRoot, ".vibe64", "sessions", "active", sessionId);
    const worktree = path.join(sessionRoot, "worktree");
    const threadId = "00000000-0000-4000-8000-000000000006";
    const runtime = new Vibe64SessionRuntime({
      targetRoot
    });
    await runtime.createSession({
      initialStep: "worktree_created",
      metadata: {
        agent_identity_conversation_id: threadId,
        agent_identity_provider: "codex",
        agent_identity_resume_strategy: "provider-native",
        agent_identity_status: "ready",
        agent_identity_workdir: worktree,
        worktree_path: worktree
      },
      sessionId
    });
    await runtime.store.writeAgentRunEvent(sessionId, CODEX_APP_SERVER_AGENT_RUN_ID, {
      event: {
        kind: "active"
      },
      patch: {
        provider: "codex",
        providerInterface: "app-server",
        providerStatus: "inProgress",
        providerThreadId: threadId,
        providerTurnId: "turn-1",
        state: "active"
      }
    });
    await mkdir(worktree, {
      recursive: true
    });

    const providerOptions = [];
    const interruptCalls = [];
    const terminalService = createTestTerminalService({
      codexTerminalController: {
        codexAppServerProviderFactory(options = {}) {
          providerOptions.push(options);
          return {
            interruptTurn: async (interruptedThreadId, interruptedTurnId) => {
              interruptCalls.push({
                threadId: interruptedThreadId,
                turnId: interruptedTurnId
              });
              return {
                ok: true
              };
            }
          };
        }
      },
      env: {
        [VIBE64_SELF_TARGET_SYSTEM_ROOT_ENV]: "1"
      },
      projectService: {
        targetRoot,
        async createRuntime() {
          return runtime;
        }
      }
    });

    const result = await terminalService.interruptCodexTurn(sessionId);

    assert.equal(result.ok, true);
    assert.deepEqual(interruptCalls, [
      {
        threadId,
        turnId: "turn-1"
      }
    ]);
    assert.equal(providerOptions.length, 1);
    assert.equal(providerOptions[0].useDocker, false);
    assert.equal(providerOptions[0].targetRoot, targetRoot);
    assert.equal(providerOptions[0].workdir, worktree);
    const interruptedSession = await runtime.getSession(sessionId);
    assert.deepEqual(interruptedSession.agentRuns.map((run) => ({
      active: run.active,
      id: run.id,
      providerStatus: run.providerStatus,
      providerTurnId: run.providerTurnId,
      state: run.state
    })), [
      {
        active: false,
        id: "codex_app_server",
        providerStatus: "interrupted",
        providerTurnId: "turn-1",
        state: "interrupted"
      }
    ]);
  });
});

test("Vibe64 Codex app-server steer writes user messages and last-prompt Git identity", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "codex_app_server_steer_active_turn";
    const sessionRoot = path.join(targetRoot, ".vibe64", "sessions", "active", sessionId);
    const worktree = path.join(sessionRoot, "worktree");
    const threadId = "00000000-0000-4000-8000-000000000126";
    const turnId = "codex-app-server-turn-steered";
    const runtime = new Vibe64SessionRuntime({
      targetRoot
    });
    await runtime.createSession({
      initialStep: "issue_file_created",
      metadata: {
        agent_identity_conversation_id: threadId,
        agent_identity_provider: "codex",
        agent_identity_resume_strategy: "provider-native",
        agent_identity_status: "ready",
        agent_identity_workdir: worktree,
        worktree_path: worktree
      },
      sessionId
    });
    await runtime.store.writeAgentRunEvent(sessionId, CODEX_APP_SERVER_AGENT_RUN_ID, {
      event: {
        kind: "active"
      },
      patch: {
        provider: "codex",
        providerInterface: "app-server",
        providerStatus: "inProgress",
        providerThreadId: threadId,
        providerTurnId: turnId,
        state: "active"
      }
    });
    await mkdir(worktree, {
      recursive: true
    });

    const publishSessionEvents = [];
    const steerCalls = [];
    const controller = createCodexTerminalController({
      codexAuthPreflight: noopCodexAuthPreflight,
      codexAppServerPromptDeliveryEnabled: true,
      codexAppServerProviderOptions: {
        useDocker: false
      },
      codexAppServerProviderFactory: () => ({
        async ensureAvailable() {
          return {
            ok: true
          };
        },
        async steerTurn(steeredThreadId, steeredTurnId, input) {
          steerCalls.push({
            input,
            threadId: steeredThreadId,
            turnId: steeredTurnId
          });
          return {
            ok: true,
            turnId: steeredTurnId
          };
        }
      }),
      projectService: {
        targetRoot,
        async createRuntime() {
          return runtime;
        }
      },
      publishSessionChanged: async (publishedSessionId, event = {}) => {
        publishSessionEvents.push({
          ...event,
          sessionId: publishedSessionId
        });
      }
    });

    const result = await controller.steerTurn(sessionId, {
      fields: {
        conversationRequest: "Use the existing tests as the guide."
      }
    });

    assert.equal(result.ok, true);
    assert.equal(result.steered, true);
    assert.equal(steerCalls.length, 1);
    assert.equal(steerCalls[0].threadId, threadId);
    assert.equal(steerCalls[0].turnId, turnId);
    assertCodexSteerProviderInput(steerCalls[0].input, "Use the existing tests as the guide.", {
      stepId: "issue_file_created"
    });
    const conversationLog = await runtime.store.readConversationLog(sessionId);
    assert.equal(conversationLog.length, 1);
    assert.equal(conversationLog[0].user.text, "Use the existing tests as the guide.");
    const steerEvent = publishSessionEvents.find((event) => event.reason === "codex-app-server-turn-steered");
    assert.equal(steerEvent?.payload?.conversationLogPatch?.type, "upsert-turn");
    assert.equal(
      steerEvent?.payload?.conversationLogPatch?.turn?.user?.text,
      "Use the existing tests as the guide."
    );
    const wrappedSteerResult = await controller.steerTurn(sessionId, {
      displayFields: {
        conversationRequest: "Skip verify"
      },
      fields: {
        conversationRequest: "Skip verify\n\nAttached files:\n- image.png: /workspace/.vibe64/uploads/image.png"
      },
      message: [
        "Vibe64 steering update for the active Codex turn.",
        "",
        "User steering text:",
        "```",
        "Skip verify",
        "```"
      ].join("\n")
    });
    assert.equal(wrappedSteerResult.ok, true);
    assert.match(steerCalls.at(-1)?.input, /Vibe64 steering update for the active Codex turn/u);
    const displayConversationLog = await runtime.store.readConversationLog(sessionId);
    assert.equal(displayConversationLog.at(-1)?.user.text, "Skip verify");
    const latestSteerEvent = publishSessionEvents
      .filter((event) => event.reason === "codex-app-server-turn-steered")
      .at(-1);
    assert.equal(
      latestSteerEvent?.payload?.conversationLogPatch?.turn?.user?.text,
      "Skip verify"
    );
    let session = await runtime.getSession(sessionId);
    assert.equal(codexAppServerAgentRunSnapshot(session).state, "active");
    assert.equal(codexAppServerAgentRunSnapshot(session).active, true);
    assert.equal(codexAppServerAgentRunSnapshot(session).providerStatus, "inProgress");
    assert.equal(codexAppServerAgentRunSnapshot(session).providerThreadId, threadId);
    assert.equal(codexAppServerAgentRunSnapshot(session).providerTurnId, turnId);
    assert.equal(session.metadata.codex_last_prompt_git_actor_active, "yes");
    assert.equal(session.metadata.codex_last_prompt_git_actor_scope, "local");
    assert.equal(session.metadata.codex_last_prompt_git_actor_thread_id, threadId);
    assert.equal(session.metadata.codex_last_prompt_git_actor_user_key, "local");
    assert.equal(session.metadata.codex_last_prompt_git_actor_workdir, worktree);

    const gitPromptResult = await controller.steerTurn(sessionId, {
      message: "Please commit and push the current changes now."
    });

    assert.equal(gitPromptResult.ok, true);
    assert.equal(steerCalls.at(-1)?.threadId, threadId);
    assert.equal(steerCalls.at(-1)?.turnId, turnId);
    assertCodexSteerProviderInput(steerCalls.at(-1)?.input, "Please commit and push the current changes now.", {
      stepId: "issue_file_created"
    });
    session = await runtime.getSession(sessionId);
    assert.equal(session.metadata.codex_last_prompt_git_actor_active, "yes");
    assert.equal(session.metadata.codex_last_prompt_git_actor_scope, "local");
    assert.equal(session.metadata.codex_last_prompt_git_actor_session_id, sessionId);
    assert.equal(session.metadata.codex_last_prompt_git_actor_thread_id, threadId);
    assert.equal(session.metadata.codex_last_prompt_git_actor_user_key, "local");
    assert.equal(session.metadata.codex_last_prompt_git_actor_workdir, worktree);
  });
});

test("Vibe64 Codex app-server interrupt refusal keeps the active turn running", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "codex_app_server_interrupt_refused";
    const sessionRoot = path.join(targetRoot, ".vibe64", "sessions", "active", sessionId);
    const worktree = path.join(sessionRoot, "worktree");
    const threadId = "00000000-0000-4000-8000-000000000016";
    const turnId = "codex-app-server-turn-refused";
    const runtime = new Vibe64SessionRuntime({
      targetRoot
    });
    await runtime.createSession({
      initialStep: "issue_file_created",
      metadata: {
        agent_identity_conversation_id: threadId,
        agent_identity_provider: "codex",
        agent_identity_resume_strategy: "provider-native",
        agent_identity_status: "ready",
        agent_identity_workdir: worktree,
        worktree_path: worktree
      },
      sessionId
    });
    await runtime.store.writeAgentRunEvent(sessionId, CODEX_APP_SERVER_AGENT_RUN_ID, {
      event: {
        kind: "active"
      },
      patch: {
        provider: "codex",
        providerInterface: "app-server",
        providerStatus: "inProgress",
        providerThreadId: threadId,
        providerTurnId: turnId,
        state: "active"
      }
    });
    await mkdir(worktree, {
      recursive: true
    });

    const interruptCalls = [];
    const controller = createCodexTerminalController({
      codexAuthPreflight: noopCodexAuthPreflight,
      codexAppServerPromptDeliveryEnabled: true,
      codexAppServerProviderOptions: {
        useDocker: false
      },
      codexAppServerProviderFactory: () => ({
        async ensureAvailable() {
          return {
            ok: true
          };
        },
        async interruptTurn(interruptedThreadId, interruptedTurnId) {
          interruptCalls.push({
            threadId: interruptedThreadId,
            turnId: interruptedTurnId
          });
          return {
            error: "Codex cannot be interrupted right now.",
            ok: false
          };
        }
      }),
      projectService: {
        targetRoot,
        async createRuntime() {
          return runtime;
        }
      }
    });

    const result = await controller.interruptTurn(sessionId);

    assert.equal(result.ok, false);
    assert.match(result.error, /cannot be interrupted/u);
    assert.deepEqual(interruptCalls, [
      {
        threadId,
        turnId
      }
    ]);
    const session = await runtime.getSession(sessionId);
    assert.equal(codexAppServerAgentRunSnapshot(session).state, "active");
    assert.equal(codexAppServerAgentRunSnapshot(session).active, true);
    assert.equal(codexAppServerAgentRunSnapshot(session).providerStatus, "inProgress");
    assert.equal(codexAppServerAgentRunSnapshot(session).providerThreadId, threadId);
    assert.equal(codexAppServerAgentRunSnapshot(session).providerTurnId, turnId);
    assert.equal(codexAppServerAgentRunSnapshot(session).error, "");
  });
});

test("Vibe64 Codex app-server interrupt without a turn id does not mark the run interrupted", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "codex_app_server_interrupt_missing_turn_id";
    const sessionRoot = path.join(targetRoot, ".vibe64", "sessions", "active", sessionId);
    const worktree = path.join(sessionRoot, "worktree");
    const threadId = "00000000-0000-4000-8000-000000000017";
    const runtime = new Vibe64SessionRuntime({
      targetRoot
    });
    await runtime.createSession({
      initialStep: "issue_file_created",
      metadata: {
        agent_identity_conversation_id: threadId,
        agent_identity_provider: "codex",
        agent_identity_resume_strategy: "provider-native",
        agent_identity_status: "ready",
        agent_identity_workdir: worktree,
        worktree_path: worktree
      },
      sessionId
    });
    await runtime.store.writeAgentRunEvent(sessionId, CODEX_APP_SERVER_AGENT_RUN_ID, {
      event: {
        kind: "active"
      },
      patch: {
        provider: "codex",
        providerInterface: "app-server",
        providerStatus: "inProgress",
        providerThreadId: threadId,
        providerTurnId: "",
        state: "active"
      }
    });
    await mkdir(worktree, {
      recursive: true
    });

    const interruptCalls = [];
    const controller = createCodexTerminalController({
      codexAuthPreflight: noopCodexAuthPreflight,
      codexAppServerPromptDeliveryEnabled: true,
      codexAppServerProviderOptions: {
        useDocker: false
      },
      codexAppServerProviderFactory: () => ({
        async ensureAvailable() {
          return {
            ok: true
          };
        },
        async interruptTurn(interruptedThreadId, interruptedTurnId) {
          interruptCalls.push({
            threadId: interruptedThreadId,
            turnId: interruptedTurnId
          });
          return {
            ok: true
          };
        }
      }),
      projectService: {
        targetRoot,
        async createRuntime() {
          return runtime;
        }
      }
    });

    const result = await controller.interruptTurn(sessionId);

    assert.equal(result.ok, false);
    assert.equal(result.operationOutcome, "interrupt_unavailable");
    assert.deepEqual(interruptCalls, []);
    const session = await runtime.getSession(sessionId);
    assert.equal(codexAppServerAgentRunSnapshot(session).state, "active");
    assert.equal(codexAppServerAgentRunSnapshot(session).active, true);
    assert.equal(codexAppServerAgentRunSnapshot(session).providerStatus, "inProgress");
    assert.equal(codexAppServerAgentRunSnapshot(session).providerThreadId, threadId);
    assert.equal(codexAppServerAgentRunSnapshot(session).providerTurnId, "");
    assert.equal(codexAppServerAgentRunSnapshot(session).error, "");
  });
});

test("Vibe64 Codex app-server preserves active turn id across status updates before interrupt", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "codex_app_server_preserve_turn_id_before_interrupt";
    const sessionRoot = path.join(targetRoot, ".vibe64", "sessions", "active", sessionId);
    const worktree = path.join(sessionRoot, "worktree");
    const threadId = "00000000-0000-4000-8000-000000000008";
    const turnId = "codex-app-server-turn-preserved";
    const runtime = new Vibe64SessionRuntime({
      targetRoot
    });
    await runtime.createSession({
      initialStep: "issue_file_created",
      metadata: {
        worktree_path: worktree
      },
      sessionId
    });
    await mkdir(worktree, {
      recursive: true
    });

    const providerCalls = {
      interruptTurn: []
    };
    const providerSubscribers = [];
    const controller = createCodexTerminalController({
      codexAuthPreflight: noopCodexAuthPreflight,
      codexAppServerPromptDeliveryEnabled: true,
      codexAppServerProviderOptions: {
        useDocker: false
      },
      codexAppServerProviderFactory: () => ({
        async ensureAvailable() {
          return {
            ok: true
          };
        },
        async ensureRuntime() {
          return {
            endpoint: "unix:///tmp/vibe64-preserve-turn-id-test.sock",
            runtimeDir: path.join(targetRoot, ".vibe64", "runtime", "agent-providers", "codex-app-server-test"),
            socketPath: "/tmp/vibe64-preserve-turn-id-test.sock",
            transport: "unix"
          };
        },
        async interruptTurn(interruptedThreadId, interruptedTurnId) {
          providerCalls.interruptTurn.push({
            threadId: interruptedThreadId,
            turnId: interruptedTurnId
          });
          return {
            ok: true
          };
        },
        async sendTurn(_threadId, input) {
          return {
            id: /VIBE64_SESSION_BOOTSTRAP/u.test(input) ? "bootstrap-turn" : turnId,
            status: /VIBE64_SESSION_BOOTSTRAP/u.test(input) ? "completed" : "inProgress"
          };
        },
        async startThread() {
          return {
            id: threadId
          };
        },
        async stopRuntime() {
          return {
            removed: true
          };
        },
        subscribe(callback) {
          providerSubscribers.push(callback);
          return () => null;
        }
      }),
      projectService: {
        targetRoot,
        async createRuntime() {
          return runtime;
        }
      }
    });

    const injected = await controller.injectCodexPrompt(sessionId, {
      handoffId: "000001_issue_file_created.json:draft_issue",
      kind: "codex_prompt_handoff",
      terminalInput: "Vibe64 interactive conversation turn:\nUser/request input:\n- conversationRequest: Preserve this turn id."
    });

    assert.equal(injected.ok, true);
    assert.equal(injected.turnId, turnId);
    assert.ok(providerSubscribers.length >= 1);

    providerSubscribers[0]({
      method: "thread/status/changed",
      params: {
        status: {
          activeFlags: [],
          type: "active"
        },
        threadId
      }
    });
    await delay(5);

    let session = await runtime.getSession(sessionId);
    assert.equal(codexAppServerAgentRunSnapshot(session).state, "active");
    assert.equal(codexAppServerAgentRunSnapshot(session).providerStatus, "inProgress");
    assert.equal(codexAppServerAgentRunSnapshot(session).providerThreadId, threadId);
    assert.equal(codexAppServerAgentRunSnapshot(session).providerTurnId, turnId);

    const interrupted = await controller.interruptTurn(sessionId);

    assert.equal(interrupted.ok, true);
    assert.deepEqual(providerCalls.interruptTurn, [
      {
        threadId,
        turnId
      }
    ]);
    session = await runtime.getSession(sessionId);
    assert.equal(codexAppServerAgentRunSnapshot(session).state, "interrupted");
    assert.equal(codexAppServerAgentRunSnapshot(session).providerStatus, "interrupted");
    assert.equal(codexAppServerAgentRunSnapshot(session).providerTurnId, turnId);
    assert.match(codexAppServerAgentRunSnapshot(session).error, /Stopped by user/u);
  });
});

test("Vibe64 Codex app-server ignores late completion after user interrupt", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "codex_app_server_late_complete_after_interrupt";
    const sessionRoot = path.join(targetRoot, ".vibe64", "sessions", "active", sessionId);
    const worktree = path.join(sessionRoot, "worktree");
    const threadId = "00000000-0000-4000-8000-000000000007";
    const turnId = "codex-app-server-turn-interrupted";
    const runtime = new Vibe64SessionRuntime({
      targetRoot
    });
    await runtime.createSession({
      initialStep: "issue_file_created",
      metadata: {
        worktree_path: worktree
      },
      sessionId
    });
    await mkdir(worktree, {
      recursive: true
    });

    const providerSubscribers = [];
    const providerCalls = {
      interruptTurn: []
    };
    const controller = createCodexTerminalController({
      codexAuthPreflight: noopCodexAuthPreflight,
      codexAppServerPromptDeliveryEnabled: true,
      codexAppServerProviderOptions: {
        useDocker: false
      },
      codexAppServerProviderFactory: () => ({
        async ensureAvailable() {
          return {
            ok: true
          };
        },
        async ensureRuntime() {
          return {
            endpoint: "unix:///tmp/vibe64-late-complete-test.sock",
            runtimeDir: path.join(targetRoot, ".vibe64", "runtime", "agent-providers", "codex-app-server-test"),
            socketPath: "/tmp/vibe64-late-complete-test.sock",
            transport: "unix"
          };
        },
        async interruptTurn(interruptedThreadId, interruptedTurnId) {
          providerCalls.interruptTurn.push({
            threadId: interruptedThreadId,
            turnId: interruptedTurnId
          });
          return {
            ok: true
          };
        },
        async sendTurn(_threadId, input) {
          return {
            id: /VIBE64_SESSION_BOOTSTRAP/u.test(input) ? "bootstrap-turn" : turnId,
            status: /VIBE64_SESSION_BOOTSTRAP/u.test(input) ? "completed" : "inProgress"
          };
        },
        async startThread() {
          return {
            id: threadId
          };
        },
        async stopRuntime() {
          return {
            removed: true
          };
        },
        subscribe(callback) {
          providerSubscribers.push(callback);
          return () => null;
        }
      }),
      projectService: {
        targetRoot,
        async createRuntime() {
          return runtime;
        }
      }
    });

    const injected = await controller.injectCodexPrompt(sessionId, {
      handoffId: "000001_issue_file_created.json:draft_issue",
      kind: "codex_prompt_handoff",
      terminalInput: "Vibe64 interactive conversation turn:\nUser/request input:\n- conversationRequest: Draft this issue."
    });

    assert.equal(injected.ok, true);
    assert.equal(injected.turnId, turnId);
    assert.ok(providerSubscribers.length >= 1);

    const interrupted = await controller.interruptTurn(sessionId);

    assert.equal(interrupted.ok, true);
    assert.deepEqual(providerCalls.interruptTurn, [
      {
        threadId,
        turnId
      }
    ]);
    let session = await runtime.getSession(sessionId);
    assert.equal(codexAppServerAgentRunSnapshot(session).state, "interrupted");
    assert.equal(codexAppServerAgentRunSnapshot(session).providerStatus, "interrupted");
    assert.match(codexAppServerAgentRunSnapshot(session).error, /Stopped by user/u);

    for (const subscriber of providerSubscribers) {
      subscriber({
        method: "turn/completed",
        params: {
          status: "completed",
          threadId,
          turnId
        }
      });
    }
    for (const subscriber of providerSubscribers) {
      subscriber({
        method: "thread/status/changed",
        params: {
          status: {
            type: "idle"
          },
          threadId
        }
      });
    }
    await delay(5);

    session = await runtime.getSession(sessionId);
    assert.equal(codexAppServerAgentRunSnapshot(session).state, "interrupted");
    assert.equal(codexAppServerAgentRunSnapshot(session).providerStatus, "interrupted");
    assert.match(codexAppServerAgentRunSnapshot(session).error, /Stopped by user/u);
    assert.doesNotMatch(
      codexAppServerAgentRunSnapshot(session).error,
      /did not receive the assistant result/u
    );
    assert.deepEqual(codexAppServerAgentRunSnapshot(session).events.map((event) => event.kind), [
      "codex-app-server-turn-claimed",
      "codex-app-server-turn-active",
      "codex-app-server-turn-active",
      "codex-app-server-turn-idle"
    ]);
  });
});

test("Vibe64 Codex app-server logs duplicate stale assistant results only once", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "codex_app_server_duplicate_stale_result";
    const sessionRoot = path.join(targetRoot, ".vibe64", "sessions", "active", sessionId);
    const worktree = path.join(sessionRoot, "worktree");
    const threadId = "00000000-0000-4000-8000-000000000018";
    const turnId = "codex-app-server-turn-stale-duplicates";
    const runtime = new Vibe64SessionRuntime({
      targetRoot
    });
    await runtime.createSession({
      initialStep: "issue_file_created",
      metadata: {
        worktree_path: worktree
      },
      sessionId
    });
    await mkdir(worktree, {
      recursive: true
    });

    const providerSubscribers = [];
    const controller = createCodexTerminalController({
      codexAuthPreflight: noopCodexAuthPreflight,
      codexAppServerPromptDeliveryEnabled: true,
      codexAppServerProviderOptions: {
        useDocker: false
      },
      codexAppServerProviderFactory: () => ({
        async ensureAvailable() {
          return {
            ok: true
          };
        },
        async ensureRuntime() {
          return {
            endpoint: "unix:///tmp/vibe64-stale-result-duplicates-test.sock",
            runtimeDir: path.join(targetRoot, ".vibe64", "runtime", "agent-providers", "codex-app-server-test"),
            socketPath: "/tmp/vibe64-stale-result-duplicates-test.sock",
            transport: "unix"
          };
        },
        async interruptTurn() {
          return {
            ok: true
          };
        },
        async sendTurn(_threadId, input) {
          return {
            id: /VIBE64_SESSION_BOOTSTRAP/u.test(input) ? "bootstrap-turn" : turnId,
            status: /VIBE64_SESSION_BOOTSTRAP/u.test(input) ? "completed" : "inProgress"
          };
        },
        async startThread() {
          return {
            id: threadId
          };
        },
        async stopRuntime() {
          return {
            removed: true
          };
        },
        subscribe(callback) {
          providerSubscribers.push(callback);
          return () => null;
        }
      }),
      projectService: {
        targetRoot,
        async createRuntime() {
          return runtime;
        }
      }
    });

    const injected = await controller.injectCodexPrompt(sessionId, {
      handoffId: "000001_issue_file_created.json:draft_issue",
      kind: "codex_prompt_handoff",
      terminalInput: "Vibe64 interactive conversation turn:\nUser/request input:\n- conversationRequest: Finish then interrupt."
    });

    assert.equal(injected.ok, true);
    assert.equal(injected.turnId, turnId);
    assert.ok(providerSubscribers.length >= 1);

    for (const subscriber of providerSubscribers) {
      subscriber({
        method: "turn/completed",
        params: {
          status: "completed",
          threadId,
          turnId
        }
      });
    }
    await waitForCondition(async () => {
      const session = await runtime.getSession(sessionId);
      const run = codexAppServerAgentRunSnapshot(session);
      return run.state === "finalizing" &&
        run.providerThreadId === threadId &&
        run.providerTurnId === turnId;
    }, "Timed out waiting for Codex app-server completion finalization.");

    const interrupted = await controller.interruptTurn(sessionId);

    assert.equal(interrupted.ok, true);
    const staleLogs = [];
    const originalInfo = console.info;
    const previousSessionDebug = process.env.VIBE64_SESSION_DEBUG;
    process.env.VIBE64_SESSION_DEBUG = "1";
    console.info = (...args) => {
      const line = args.map((part) => String(part)).join(" ");
      if (line.includes("server.codexTerminal.appServerAgentResult.stale")) {
        staleLogs.push(line);
      }
      return originalInfo.apply(console, args);
    };
    try {
      for (let index = 0; index < 5; index += 1) {
        for (const subscriber of providerSubscribers) {
          subscriber({
            method: "item/completed",
            params: {
              item: {
                content: [
                  {
                    text: "Late assistant result after interruption.",
                    type: "text"
                  }
                ],
                id: `assistant-message-${index}`,
                phase: "final_answer",
                type: "assistantMessage"
              },
              threadId,
              turnId
            }
          });
        }
      }
      await waitForCondition(
        () => staleLogs.length === 1,
        "Timed out waiting for stale Codex app-server assistant result log."
      );
    } finally {
      console.info = originalInfo;
      if (previousSessionDebug == null) {
        delete process.env.VIBE64_SESSION_DEBUG;
      } else {
        process.env.VIBE64_SESSION_DEBUG = previousSessionDebug;
      }
    }

    assert.equal(staleLogs.length, 1);
    const session = await runtime.getSession(sessionId);
    assert.equal(codexAppServerAgentRunSnapshot(session).state, "interrupted");
    assert.equal(codexAppServerAgentRunSnapshot(session).providerStatus, "interrupted");
    assert.match(codexAppServerAgentRunSnapshot(session).error, /Stopped by user/u);
    await controller.closeAllForSession(sessionId);
  });
});

test("Vibe64 Codex app-server rejects completion writes that lose the interrupt race", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "codex_app_server_completion_loses_interrupt_race";
    const sessionRoot = path.join(targetRoot, ".vibe64", "sessions", "active", sessionId);
    const worktree = path.join(sessionRoot, "worktree");
    const threadId = "00000000-0000-4000-8000-000000000009";
    const turnId = "codex-app-server-turn-race";
    const runtime = new Vibe64SessionRuntime({
      targetRoot
    });
    await runtime.createSession({
      initialStep: "issue_file_created",
      metadata: {
        worktree_path: worktree
      },
      sessionId
    });
    await mkdir(worktree, {
      recursive: true
    });

    const providerSubscribers = [];
    const providerCalls = {
      interruptTurn: []
    };
    const controller = createCodexTerminalController({
      codexAuthPreflight: noopCodexAuthPreflight,
      codexAppServerPromptDeliveryEnabled: true,
      codexAppServerProviderOptions: {
        useDocker: false
      },
      codexAppServerProviderFactory: () => ({
        async ensureAvailable() {
          return {
            ok: true
          };
        },
        async ensureRuntime() {
          return {
            endpoint: "unix:///tmp/vibe64-race-complete-test.sock",
            runtimeDir: path.join(targetRoot, ".vibe64", "runtime", "agent-providers", "codex-app-server-test"),
            socketPath: "/tmp/vibe64-race-complete-test.sock",
            transport: "unix"
          };
        },
        async interruptTurn(interruptedThreadId, interruptedTurnId) {
          providerCalls.interruptTurn.push({
            threadId: interruptedThreadId,
            turnId: interruptedTurnId
          });
          return {
            ok: true
          };
        },
        async sendTurn(_threadId, input) {
          return {
            id: /VIBE64_SESSION_BOOTSTRAP/u.test(input) ? "bootstrap-turn" : turnId,
            status: /VIBE64_SESSION_BOOTSTRAP/u.test(input) ? "completed" : "inProgress"
          };
        },
        async startThread() {
          return {
            id: threadId
          };
        },
        subscribe(callback) {
          providerSubscribers.push(callback);
          return () => null;
        }
      }),
      projectService: {
        targetRoot,
        async createRuntime() {
          return runtime;
        }
      }
    });

    const injected = await controller.injectCodexPrompt(sessionId, {
      handoffId: "000001_issue_file_created.json:draft_issue",
      kind: "codex_prompt_handoff",
      terminalInput: "Vibe64 interactive conversation turn:\nUser/request input:\n- conversationRequest: Race this completion."
    });

    assert.equal(injected.ok, true);
    assert.equal(injected.turnId, turnId);
    assert.ok(providerSubscribers.length >= 1);
    const activeSnapshot = structuredClone(await runtime.getSession(sessionId));

    const interrupted = await controller.interruptTurn(sessionId);

    assert.equal(interrupted.ok, true);
    assert.deepEqual(providerCalls.interruptTurn, [
      {
        threadId,
        turnId
      }
    ]);

    const realGetSession = runtime.getSession.bind(runtime);
    let staleActiveReads = 1;
    runtime.getSession = async (requestedSessionId) => {
      if (requestedSessionId === sessionId && staleActiveReads > 0) {
        staleActiveReads -= 1;
        return structuredClone(activeSnapshot);
      }
      return realGetSession(requestedSessionId);
    };
    for (const subscriber of providerSubscribers) {
      subscriber({
        method: "turn/completed",
        params: {
          status: "completed",
          threadId,
          turnId
        }
      });
    }
    await waitForCondition(async () => {
      const session = await runtime.getSession(sessionId);
      const run = codexAppServerAgentRunSnapshot(session);
      return run.state === "interrupted" &&
        run.providerStatus === "interrupted" &&
        /Stopped by user/u.test(run.error || "");
    }, "Timed out waiting for stale completion to preserve interrupted state.");
    runtime.getSession = realGetSession;

    const session = await runtime.getSession(sessionId);
    assert.equal(codexAppServerAgentRunSnapshot(session).state, "interrupted");
    assert.equal(codexAppServerAgentRunSnapshot(session).providerStatus, "interrupted");
    assert.match(codexAppServerAgentRunSnapshot(session).error, /Stopped by user/u);
    assert.doesNotMatch(
      codexAppServerAgentRunSnapshot(session).error,
      /did not receive the assistant result/u
    );
    assert.deepEqual(codexAppServerAgentRunSnapshot(session).events.map((event) => event.kind), [
      "codex-app-server-turn-claimed",
      "codex-app-server-turn-active",
      "codex-app-server-turn-active",
      "codex-app-server-turn-idle"
    ]);
  });
});

test("Vibe64 shell terminal joins the target runtime network before the image", () => {
  const targetRoot = "/workspace/project";
  const worktree = "/workspace/project/.vibe64-local/sessions/active/unit/worktree";
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
  const worktree = "/workspace/project/.vibe64-local/sessions/active/unit/worktree";
  const resultDirectory = "/tmp/vibe64-command-unit";
  const supportDirectory = "/tmp/vibe64-toolchain-support";
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

test("Vibe64 command terminal composes tool cache home and GitHub provider config", () => {
  const targetRoot = "/workspace/project";
  const worktree = "/workspace/project/.vibe64-local/sessions/active/unit/worktree";
  const providerHome = "/srv/vibe64/tenants/ada/provider-homes/github/ada@example.com";
  const terminalHome = "/srv/vibe64/tenants/ada/provider-homes/terminal-homes/github/ada@example.com";
  const resultDirectory = "/tmp/vibe64-command-unit";
  const args = commandTerminalArgs({
    args: [
      "-lc",
      "git status"
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
    sessionId: "unit-session",
    targetRoot,
    terminalId: "unit-terminal",
    githubToolHomeSource: providerHome,
    toolHomeSource: terminalHome,
    workdir: worktree
  });

  assertDockerVolumeMount(args, terminalHome, STUDIO_TOOL_HOME_PATH);
  assertDockerVolumeMount(args, providerHome, STUDIO_GITHUB_PROVIDER_HOME_PATH);
  assertDockerEnv(args, "GH_CONFIG_DIR", STUDIO_GITHUB_PROVIDER_GH_CONFIG_DIR);
  assertDockerEnv(args, "GIT_CONFIG_GLOBAL", STUDIO_GITHUB_PROVIDER_GIT_CONFIG_GLOBAL);
});

test("Vibe64 command terminal resolves the current user's GitHub provider home", async () => {
  await withTemporaryRoot(async (root) => {
    const providerHomesRoot = path.join(root, "provider-homes");
    const userHome = path.join(providerHomesRoot, "github", "ada@example.com");
    const otherUserHome = path.join(providerHomesRoot, "github", "grace@example.com");
    const localHome = path.join(providerHomesRoot, "github", "local");
    const userTerminalHome = path.join(providerHomesRoot, "terminal-homes", "github", "ada@example.com");
    const otherUserTerminalHome = path.join(providerHomesRoot, "terminal-homes", "github", "grace@example.com");
    const localTerminalHome = path.join(providerHomesRoot, "terminal-homes", "github", "local");
    await mkdir(userHome, {
      recursive: true
    });
    await mkdir(otherUserHome, {
      recursive: true
    });
    await mkdir(localHome, {
      recursive: true
    });

    assert.deepEqual(await resolveCommandTerminalToolHome({
      env: {
        [VIBE64_GITHUB_ACCOUNT_MODE_ENV]: "user",
        [VIBE64_PROVIDER_HOMES_ROOT_ENV]: providerHomesRoot
      },
      input: {
        vibe64User: {
          email: "Ada@Example.com"
        }
      }
    }), {
      ok: true,
      owner: {
        githubProviderScope: "user",
        githubToolHomeSource: userHome,
        ownerEmail: "ada@example.com",
        ownerScope: "user",
        ownerUserKey: "ada@example.com"
      },
      providerScope: "user",
      githubToolHomeSource: userHome,
      toolHomeSource: userTerminalHome
    });

    const logs = [];
    assert.equal((await resolveCommandTerminalToolHome({
      env: {
        [VIBE64_GITHUB_ACCOUNT_MODE_ENV]: "user",
        [VIBE64_PROVIDER_HOMES_ROOT_ENV]: providerHomesRoot
      },
      input: {
        vibe64User: {
          email: "Ada@Example.com"
        }
      },
      logger: {
        info(fields, message) {
          logs.push({
            fields,
            message
          });
        }
      },
      operation: "unit_command",
      terminalKind: "command"
    })).ok, true);
    assert.equal(logs.length, 1);
    assert.equal(logs[0].fields.event, "vibe64.github_provider_home.resolved");
    assert.equal(logs[0].fields.accountMode, "user");
    assert.equal(logs[0].fields.providerScope, "user");
    assert.equal(logs[0].fields.ownerUserKey, "ada@example.com");
    assert.equal(logs[0].fields.terminalKind, "command");
    assert.equal(logs[0].fields.operation, "unit_command");
    assert.equal(Object.hasOwn(logs[0].fields, "toolHomeSource"), false);

    assert.equal((await resolveCommandTerminalToolHome({
      env: {
        [VIBE64_GITHUB_ACCOUNT_MODE_ENV]: "user",
        [VIBE64_PROVIDER_HOMES_ROOT_ENV]: providerHomesRoot
      },
      input: {
        vibe64User: {
          email: "Grace@Example.com"
        }
      }
    })).toolHomeSource, otherUserTerminalHome);

    assert.deepEqual(await resolveCommandTerminalToolHome({
      env: {
        [VIBE64_PROVIDER_HOMES_ROOT_ENV]: providerHomesRoot
      },
      input: {}
    }), {
      ok: true,
      owner: {
        githubProviderScope: "app",
        githubToolHomeSource: localHome,
        ownerEmail: "",
        ownerScope: "local",
        ownerUserKey: "local"
      },
      providerScope: "app",
      githubToolHomeSource: localHome,
      toolHomeSource: localTerminalHome
    });
  });
});

test("Vibe64 shell terminal resolves actor-scoped GitHub provider homes", async () => {
  await withTemporaryRoot(async (root) => {
    const providerHomesRoot = path.join(root, "provider-homes");
    const userHome = path.join(providerHomesRoot, "github", "ada@example.com");
    const otherUserHome = path.join(providerHomesRoot, "github", "grace@example.com");
    const localHome = path.join(providerHomesRoot, "github", "local");
    const userTerminalHome = path.join(providerHomesRoot, "terminal-homes", "github", "ada@example.com");
    const otherUserTerminalHome = path.join(providerHomesRoot, "terminal-homes", "github", "grace@example.com");
    const localTerminalHome = path.join(providerHomesRoot, "terminal-homes", "github", "local");
    await mkdir(userHome, {
      recursive: true
    });
    await mkdir(otherUserHome, {
      recursive: true
    });
    await mkdir(localHome, {
      recursive: true
    });

    assert.equal((await resolveShellTerminalToolHome({
      env: {
        [VIBE64_GITHUB_ACCOUNT_MODE_ENV]: "user",
        [VIBE64_PROVIDER_HOMES_ROOT_ENV]: providerHomesRoot
      },
      input: {
        vibe64User: {
          email: "Ada@Example.com"
        }
      }
    })).toolHomeSource, userTerminalHome);

    assert.equal((await resolveShellTerminalToolHome({
      env: {
        [VIBE64_GITHUB_ACCOUNT_MODE_ENV]: "user",
        [VIBE64_PROVIDER_HOMES_ROOT_ENV]: providerHomesRoot
      },
      input: {
        vibe64User: {
          email: "Grace@Example.com"
        }
      }
    })).toolHomeSource, otherUserTerminalHome);

    assert.equal((await resolveShellTerminalToolHome({
      env: {
        [VIBE64_PROVIDER_HOMES_ROOT_ENV]: providerHomesRoot
      },
      input: {}
    })).toolHomeSource, localTerminalHome);

    const missingActor = await resolveShellTerminalToolHome({
      env: {
        [VIBE64_GITHUB_ACCOUNT_MODE_ENV]: "user",
        [VIBE64_PROVIDER_HOMES_ROOT_ENV]: providerHomesRoot
      },
      input: {}
    });
    assert.equal(missingActor.ok, false);
    assert.match(missingActor.error, /user/i);

    const missingProviderHome = await resolveShellTerminalToolHome({
      env: {
        [VIBE64_GITHUB_ACCOUNT_MODE_ENV]: "user",
        [VIBE64_PROVIDER_HOMES_ROOT_ENV]: providerHomesRoot
      },
      input: {
        vibe64User: {
          email: "Missing@Example.com"
        }
      }
    });
    assert.equal(missingProviderHome.ok, false);
    assert.match(missingProviderHome.error, /GitHub is not ready/i);
  });
});

test("Vibe64 shell terminal listing excludes non-worktree shell targets", async () => {
  const sessionId = "shell-list-targets";
  const namespace = shellTerminalNamespace(sessionId);
  const controller = createShellTerminalController({
    projectService: {}
  });
  const worktreeTerminal = startTerminalSession({
    args: [
      "-e",
      "process.stdin.resume(); setInterval(() => {}, 1000);"
    ],
    command: process.execPath,
    metadata: {
      sessionId,
      target: "worktree",
      terminalKind: "shell"
    },
    namespace
  });
  const mainTerminal = startTerminalSession({
    args: [
      "-e",
      "process.stdin.resume(); setInterval(() => {}, 1000);"
    ],
    command: process.execPath,
    metadata: {
      sessionId,
      target: "main",
      terminalKind: "shell"
    },
    namespace
  });

  try {
    assert.equal(worktreeTerminal.ok, true);
    assert.equal(mainTerminal.ok, true);
    const listed = controller.listTerminals(sessionId);

    assert.equal(listed.ok, true);
    assert.deepEqual(listed.terminals.map((terminal) => terminal.id), [worktreeTerminal.id]);
  } finally {
    await closeTerminalSessionsForNamespacePrefix(namespace);
  }
});

test("Vibe64 project runtime close matches project-scoped terminal namespaces only", () => {
  assert.equal(
    terminalNamespaceMatchesProjectScope("vibe64-launch-target:project:alpha:session-a", "project:alpha"),
    true
  );
  assert.equal(
    terminalNamespaceMatchesProjectScope("current-app-target-script:project:alpha:target", "project:alpha"),
    true
  );
  assert.equal(
    terminalNamespaceMatchesProjectScope("vibe64-launch-target:project:alphabet:session-a", "project:alpha"),
    false
  );
  assert.equal(
    terminalNamespaceMatchesProjectScope("vibe64-launch-target:project:beta:session-b", "project:alpha"),
    false
  );
});

test("Vibe64 project runtime open writes filesystem state and publishes a project change", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const alphaRoot = path.join(targetRoot, "alpha");
    const alphaProjectLocalRoot = path.join(alphaRoot, ".vibe64-local");
    const projectEvents = [];
    await mkdir(alphaRoot, {
      recursive: true
    });
    const terminalService = createTestTerminalService({
      projectService: {
        currentProjectLocalRoot() {
          return path.join(targetRoot, "wrong-local-root");
        },
        currentTargetRoot() {
          return path.join(targetRoot, "wrong-target-root");
        },
        targetRoot: path.join(targetRoot, "wrong-target-root"),
        async createRuntime() {
          return {
            async listSessionSummaries() {
              return [];
            }
          };
        }
      },
      publishProjectChanged: async (operation, projectSlug, change = {}) => {
        projectEvents.push({
          change,
          operation,
          projectSlug
        });
        return {
          ok: true
        };
      }
    });

    const result = await runWithProjectRequestContext({
      projectLocalRoot: alphaProjectLocalRoot,
      slug: "alpha",
      targetRoot: alphaRoot
    }, () => terminalService.openProjectRuntime({
      reason: "unit-open"
    }));
    const persisted = await readProjectRuntimeOpenState({
      projectLocalRoot: alphaProjectLocalRoot
    });

    assert.equal(result.ok, true);
    assert.equal(result.targetRoot, alphaRoot);
    assert.equal(result.runtime.open, true);
    assert.equal(result.runtime.projectSlug, "alpha");
    assert.equal(persisted.open, true);
    assert.equal(persisted.targetRoot, alphaRoot);
    assert.equal(projectEvents.length, 1);
    assert.equal(projectEvents[0].operation, "updated");
    assert.equal(projectEvents[0].projectSlug, "alpha");
    assert.equal(projectEvents[0].change.action, "runtime-opened");
    assert.equal(projectEvents[0].change.reason, "unit-open");
    assert.equal(projectEvents[0].change.payload.projectSlug, "alpha");
    assert.equal(projectEvents[0].change.payload.targetRoot, alphaRoot);
    assert.equal(projectEvents[0].change.payload.runtime.open, true);
  });
});

test("Vibe64 project runtime close stops current project terminals without closing another project", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runId = crypto.randomUUID();
    const alphaRoot = path.join(targetRoot, "alpha");
    const betaRoot = path.join(targetRoot, "beta");
    const alphaProjectLocalRoot = path.join(alphaRoot, ".vibe64-local");
    const alphaNamespace = `vibe64-launch-target:project:alpha:${runId}`;
    const betaNamespace = `vibe64-launch-target:project:beta:${runId}`;
    const alphaUnscopedNamespace = `project-setup-doctor:${runId}:alpha`;
    const betaUnscopedNamespace = `project-setup-doctor:${runId}:beta`;
    const projectEvents = [];
    await mkdir(alphaRoot, {
      recursive: true
    });
    await mkdir(betaRoot, {
      recursive: true
    });
    await writeProjectRuntimeOpenState({
      projectLocalRoot: alphaProjectLocalRoot,
      projectSlug: "alpha",
      reason: "unit-open",
      targetRoot: alphaRoot
    });
    const alphaTerminal = startTerminalSession({
      args: [
        "-e",
        "process.stdin.resume(); setInterval(() => {}, 1000);"
      ],
      command: process.execPath,
      cwd: alphaRoot,
      metadata: {
        terminalKind: "launchTarget"
      },
      namespace: alphaNamespace
    });
    const betaTerminal = startTerminalSession({
      args: [
        "-e",
        "process.stdin.resume(); setInterval(() => {}, 1000);"
      ],
      command: process.execPath,
      cwd: betaRoot,
      metadata: {
        terminalKind: "launchTarget"
      },
      namespace: betaNamespace
    });
    const alphaUnscopedTerminal = startTerminalSession({
      args: [
        "-e",
        "process.stdin.resume(); setInterval(() => {}, 1000);"
      ],
      command: process.execPath,
      cwd: alphaRoot,
      metadata: {
        terminalKind: "project-setup-doctor"
      },
      namespace: alphaUnscopedNamespace
    });
    const betaUnscopedTerminal = startTerminalSession({
      args: [
        "-e",
        "process.stdin.resume(); setInterval(() => {}, 1000);"
      ],
      command: process.execPath,
      cwd: betaRoot,
      metadata: {
        terminalKind: "project-setup-doctor"
      },
      namespace: betaUnscopedNamespace
    });
    const terminalService = createService({
      codexTerminalController: {
        closeAllForProject: async () => ({
          failed: [],
          ok: true,
          stopped: 0
        })
      },
      projectService: {
        targetRoot: alphaRoot,
        currentProjectLocalRoot() {
          return alphaProjectLocalRoot;
        },
        async createRuntime() {
          return {
            async listSessionSummaries() {
              return [];
            }
          };
        }
      },
      publishProjectChanged: async (operation, projectSlug, change = {}) => {
        projectEvents.push({
          change,
          operation,
          projectSlug
        });
        return {
          ok: true
        };
      }
    });

    try {
      assert.equal(alphaTerminal.ok, true);
      assert.equal(betaTerminal.ok, true);
      assert.equal(alphaUnscopedTerminal.ok, true);
      assert.equal(betaUnscopedTerminal.ok, true);
      const result = await runWithProjectRequestContext({
        projectLocalRoot: alphaProjectLocalRoot,
        slug: "alpha",
        targetRoot: alphaRoot
      }, () => terminalService.closeProjectRuntime({
        reason: "unit-test"
      }));

      assert.equal(result.ok, true);
      assert.equal(result.projectScope, "project:alpha");
      assert.equal(result.projectNamespaceCount, 1);
      assert.equal(result.projectTerminalClosed, 1);
      assert.equal(result.projectCwdNamespaceCount, 1);
      assert.equal(result.projectCwdTerminalClosed, 1);
      assert.equal(result.runtime.open, false);
      assert.equal((await readProjectRuntimeOpenState({
        projectLocalRoot: alphaProjectLocalRoot
      })).open, false);
      assert.equal(projectEvents.length, 1);
      assert.equal(projectEvents[0].operation, "updated");
      assert.equal(projectEvents[0].projectSlug, "alpha");
      assert.equal(projectEvents[0].change.action, "runtime-closed");
      assert.equal(projectEvents[0].change.reason, "unit-test");
      assert.equal(projectEvents[0].change.payload.message, "Project is closed.");
      assert.equal(projectEvents[0].change.payload.projectSlug, "alpha");
      assert.equal(projectEvents[0].change.payload.runtime.open, false);
      assert.equal(readTerminalSession(alphaTerminal.id, {
        namespace: alphaNamespace
      }).ok, false);
      assert.equal(readTerminalSession(betaTerminal.id, {
        namespace: betaNamespace
      }).ok, true);
      assert.equal(readTerminalSession(alphaUnscopedTerminal.id, {
        namespace: alphaUnscopedNamespace
      }).ok, false);
      assert.equal(readTerminalSession(betaUnscopedTerminal.id, {
        namespace: betaUnscopedNamespace
      }).ok, true);
    } finally {
      await closeTerminalSessionsForNamespacePrefix(alphaNamespace);
      await closeTerminalSessionsForNamespacePrefix(betaNamespace);
      await closeTerminalSessionsForNamespacePrefix(alphaUnscopedNamespace);
      await closeTerminalSessionsForNamespacePrefix(betaUnscopedNamespace);
    }
  });
});

test("Vibe64 project runtime close continues project cleanup when sessions cannot be listed", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runId = crypto.randomUUID();
    const alphaRoot = path.join(targetRoot, "alpha");
    const alphaProjectLocalRoot = path.join(alphaRoot, ".vibe64-local");
    const alphaNamespace = `vibe64-launch-target:project:alpha:${runId}`;
    const alphaUnscopedNamespace = `project-setup-doctor:${runId}:alpha`;
    const projectEvents = [];
    await mkdir(alphaRoot, {
      recursive: true
    });
    await writeProjectRuntimeOpenState({
      projectLocalRoot: alphaProjectLocalRoot,
      projectSlug: "alpha",
      reason: "unit-open",
      targetRoot: alphaRoot
    });
    const alphaTerminal = startTerminalSession({
      args: [
        "-e",
        "process.stdin.resume(); setInterval(() => {}, 1000);"
      ],
      command: process.execPath,
      cwd: alphaRoot,
      metadata: {
        terminalKind: "launchTarget"
      },
      namespace: alphaNamespace
    });
    const alphaUnscopedTerminal = startTerminalSession({
      args: [
        "-e",
        "process.stdin.resume(); setInterval(() => {}, 1000);"
      ],
      command: process.execPath,
      cwd: alphaRoot,
      metadata: {
        terminalKind: "project-setup-doctor"
      },
      namespace: alphaUnscopedNamespace
    });
    const terminalService = createService({
      codexTerminalController: {
        closeAllForProject: async () => ({
          failed: [],
          ok: true,
          stopped: 1
        })
      },
      projectService: {
        targetRoot: alphaRoot,
        currentProjectLocalRoot() {
          return alphaProjectLocalRoot;
        },
        async createRuntime() {
          throw new Error("runtime unavailable");
        }
      },
      publishProjectChanged: async (operation, projectSlug, change = {}) => {
        projectEvents.push({
          change,
          operation,
          projectSlug
        });
        return {
          ok: true
        };
      }
    });

    try {
      assert.equal(alphaTerminal.ok, true);
      assert.equal(alphaUnscopedTerminal.ok, true);
      const result = await runWithProjectRequestContext({
        projectLocalRoot: alphaProjectLocalRoot,
        slug: "alpha",
        targetRoot: alphaRoot
      }, () => terminalService.closeProjectRuntime({
        reason: "unit-test"
      }));

      assert.equal(result.ok, false);
      assert.equal(result.failed.length, 1);
      assert.equal(result.failed[0].controller, "sessions");
      assert.equal(result.failed[0].operation, "list-project-sessions");
      assert.equal(result.projectNamespaceCount, 1);
      assert.equal(result.projectTerminalClosed, 1);
      assert.equal(result.projectCwdNamespaceCount, 1);
      assert.equal(result.projectCwdTerminalClosed, 1);
      assert.equal((await readProjectRuntimeOpenState({
        projectLocalRoot: alphaProjectLocalRoot
      })).open, true);
      assert.equal(projectEvents.length, 0);
      assert.equal(readTerminalSession(alphaTerminal.id, {
        namespace: alphaNamespace
      }).ok, false);
      assert.equal(readTerminalSession(alphaUnscopedTerminal.id, {
        namespace: alphaUnscopedNamespace
      }).ok, false);
    } finally {
      await closeTerminalSessionsForNamespacePrefix(alphaNamespace);
      await closeTerminalSessionsForNamespacePrefix(alphaUnscopedNamespace);
    }
  });
});

test("Vibe64 project reconciliation closes runtime when the open marker is missing", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runId = crypto.randomUUID();
    const alphaRoot = path.join(targetRoot, "alpha");
    const alphaProjectLocalRoot = path.join(alphaRoot, ".vibe64-local");
    const alphaNamespace = `vibe64-launch-target:project:alpha:${runId}`;
    const projectEvents = [];
    const runtime = new Vibe64SessionRuntime({
      targetRoot: alphaRoot
    });
    await mkdir(alphaRoot, {
      recursive: true
    });
    await runtime.createSession({
      sessionId: "closed-project-session"
    });
    const alphaTerminal = startTerminalSession({
      args: [
        "-e",
        "process.stdin.resume(); setInterval(() => {}, 1000);"
      ],
      command: process.execPath,
      cwd: alphaRoot,
      metadata: {
        terminalKind: "launchTarget"
      },
      namespace: alphaNamespace
    });
    const terminalService = createTestTerminalService({
      projectService: {
        targetRoot: alphaRoot,
        currentProjectLocalRoot() {
          return alphaProjectLocalRoot;
        },
        async createRuntime() {
          return runtime;
        }
      },
      publishProjectChanged: async (operation, projectSlug, change = {}) => {
        projectEvents.push({
          change,
          operation,
          projectSlug
        });
        return {
          ok: true
        };
      }
    });

    try {
      assert.equal(alphaTerminal.ok, true);
      const result = await runWithProjectRequestContext({
        projectLocalRoot: alphaProjectLocalRoot,
        slug: "alpha",
        targetRoot: alphaRoot
      }, () => terminalService.reconcileOpenCodexThreads());

      assert.equal(result.ok, true);
      assert.equal(result.skipped, true);
      assert.equal(result.reason, "project-runtime-marker-missing");
      assert.equal(result.sessionCount, 0);
      assert.deepEqual(result.results, []);
      assert.equal(result.closeResult.projectScope, "project:alpha");
      assert.equal(result.closeResult.projectNamespaceCount, 1);
      assert.equal(result.closeResult.projectTerminalClosed, 1);
      assert.equal(result.runtime.open, false);
      assert.equal((await readProjectRuntimeOpenState({
        projectLocalRoot: alphaProjectLocalRoot
      })).open, false);
      assert.equal(readTerminalSession(alphaTerminal.id, {
        namespace: alphaNamespace
      }).ok, false);
      assert.equal(projectEvents.length, 1);
      assert.equal(projectEvents[0].operation, "updated");
      assert.equal(projectEvents[0].projectSlug, "alpha");
      assert.equal(projectEvents[0].change.action, "runtime-closed");
      assert.equal(projectEvents[0].change.reason, "project-runtime-marker-missing");
      assert.equal(projectEvents[0].change.payload.runtime.open, false);
    } finally {
      await closeTerminalSessionsForNamespacePrefix(alphaNamespace);
    }
  });
});

test("Vibe64 launch status closes runtime instead of recovering without the open marker", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const alphaRoot = path.join(targetRoot, "alpha");
    const alphaProjectLocalRoot = path.join(alphaRoot, ".vibe64-local");
    const sessionId = "closed-project-launch-status";
    const namespace = launchTargetTerminalNamespace(sessionId);
    const projectEvents = [];
    const runtime = new Vibe64SessionRuntime({
      targetRoot: alphaRoot
    });
    await mkdir(alphaRoot, {
      recursive: true
    });
    await runtime.createSession({
      sessionId
    });
    const terminal = startTerminalSession({
      args: [
        "-e",
        "process.stdin.resume(); setInterval(() => {}, 1000);"
      ],
      command: process.execPath,
      cwd: alphaRoot,
      metadata: {
        launchTargetId: "dev",
        openTarget: {
          href: "http://127.0.0.1:4100/app",
          kind: "url",
          label: "Open browser"
        },
        terminalKind: "launchTarget"
      },
      namespace
    });
    const terminalService = createTestTerminalService({
      projectService: {
        targetRoot: alphaRoot,
        currentProjectLocalRoot() {
          return alphaProjectLocalRoot;
        },
        currentTargetRoot() {
          return alphaRoot;
        },
        async createRuntime() {
          return runtime;
        }
      },
      publishProjectChanged: async (operation, projectSlug, change = {}) => {
        projectEvents.push({
          change,
          operation,
          projectSlug
        });
        return {
          ok: true
        };
      }
    });

    try {
      assert.equal(terminal.ok, true);
      const result = await runWithProjectRequestContext({
        projectLocalRoot: alphaProjectLocalRoot,
        slug: "alpha",
        targetRoot: alphaRoot
      }, () => terminalService.launchTargetStatus(sessionId));

      assert.equal(result.ok, true);
      assert.equal(result.reason, "project-runtime-marker-missing");
      assert.equal(result.activeTerminal, null);
      assert.equal(result.openTarget.available, false);
      assert.equal(result.openTarget.disabledReason, "Project is closed.");
      assert.equal(result.preview.state, "project_closed");
      assert.equal(result.preview.message, "Project is closed.");
      assert.equal(result.preview.canRestart, false);
      assert.equal(result.preview.recovery, null);
      assert.equal(result.previewTarget.available, false);
      assert.equal(result.previewTarget.disabledReason, "Project is closed.");
      assert.equal(result.runtime.open, false);
      assert.equal(readTerminalSession(terminal.id, {
        namespace
      }).ok, false);
      assert.equal(projectEvents.length, 1);
      assert.equal(projectEvents[0].projectSlug, "alpha");
      assert.equal(projectEvents[0].change.action, "runtime-closed");
      assert.equal(projectEvents[0].change.reason, "project-runtime-marker-missing");
    } finally {
      await closeTerminalSessionsForNamespacePrefix(namespace);
    }
  });
});

test("Vibe64 dormant project cleanup closes open runtimes after idle timeout", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runId = crypto.randomUUID();
    const alphaRoot = path.join(targetRoot, "alpha");
    const alphaProjectLocalRoot = path.join(alphaRoot, ".vibe64-local");
    const alphaNamespace = `vibe64-launch-target:project:alpha:${runId}`;
    const projectEvents = [];
    const runtime = new Vibe64SessionRuntime({
      targetRoot: alphaRoot
    });
    await mkdir(alphaRoot, {
      recursive: true
    });
    await runtime.createSession({
      sessionId: "dormant-project-session"
    });
    await writeProjectRuntimeOpenState({
      projectLocalRoot: alphaProjectLocalRoot,
      projectSlug: "alpha",
      reason: "unit-open",
      targetRoot: alphaRoot
    });
    const terminal = startTerminalSession({
      args: [
        "-e",
        "process.stdin.resume(); setInterval(() => {}, 1000);"
      ],
      command: process.execPath,
      cwd: alphaRoot,
      metadata: {
        terminalKind: "launchTarget"
      },
      namespace: alphaNamespace
    });
    const terminalService = createTestTerminalService({
      projectService: {
        targetRoot: alphaRoot,
        currentProjectLocalRoot() {
          return alphaProjectLocalRoot;
        },
        async createRuntime() {
          return runtime;
        },
        async listProjects() {
          return {
            ok: true,
            projects: [
              {
                projectRoot: alphaRoot,
                runtime: await readProjectRuntimeOpenState({
                  projectLocalRoot: alphaProjectLocalRoot
                }),
                slug: "alpha"
              }
            ],
            projectsRoot: targetRoot
          };
        }
      },
      publishProjectChanged: async (operation, projectSlug, change = {}) => {
        projectEvents.push({
          change,
          operation,
          projectSlug
        });
        return {
          ok: true
        };
      }
    });

    try {
      assert.equal(terminal.ok, true);
      const result = await terminalService.closeDormantProjectRuntimes({
        idleAfterMs: 30 * 60 * 1000,
        nowMs: Date.now() + (31 * 60 * 1000)
      });

      assert.equal(result.ok, true);
      assert.equal(result.projectCount, 1);
      assert.equal(result.closedCount, 1);
      assert.equal(result.results[0].reason, "idle-timeout");
      assert.equal(result.results[0].dormant, true);
      assert.equal((await readProjectRuntimeOpenState({
        projectLocalRoot: alphaProjectLocalRoot
      })).open, false);
      assert.equal(readTerminalSession(terminal.id, {
        namespace: alphaNamespace
      }).ok, false);
      assert.equal(projectEvents.length, 1);
      assert.equal(projectEvents[0].projectSlug, "alpha");
      assert.equal(projectEvents[0].change.action, "runtime-closed");
      assert.equal(projectEvents[0].change.reason, "idle-timeout");
    } finally {
      await closeTerminalSessionsForNamespacePrefix(alphaNamespace);
    }
  });
});

test("Vibe64 dormant project cleanup keeps open runtimes with active agent work", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runId = crypto.randomUUID();
    const alphaRoot = path.join(targetRoot, "alpha");
    const alphaProjectLocalRoot = path.join(alphaRoot, ".vibe64-local");
    const alphaNamespace = `vibe64-launch-target:project:alpha:${runId}`;
    const runtime = new Vibe64SessionRuntime({
      targetRoot: alphaRoot
    });
    await mkdir(alphaRoot, {
      recursive: true
    });
    await runtime.createSession({
      sessionId: "active-project-session"
    });
    await runtime.store.writeAgentRunEvent("active-project-session", "active-run", {
      event: {
        kind: "active",
        state: VIBE64_AGENT_RUN_STATE.ACTIVE
      },
      patch: {
        state: VIBE64_AGENT_RUN_STATE.ACTIVE
      }
    });
    await writeProjectRuntimeOpenState({
      projectLocalRoot: alphaProjectLocalRoot,
      projectSlug: "alpha",
      reason: "unit-open",
      targetRoot: alphaRoot
    });
    const terminal = startTerminalSession({
      args: [
        "-e",
        "process.stdin.resume(); setInterval(() => {}, 1000);"
      ],
      command: process.execPath,
      cwd: alphaRoot,
      metadata: {
        terminalKind: "launchTarget"
      },
      namespace: alphaNamespace
    });
    const terminalService = createTestTerminalService({
      projectService: {
        targetRoot: alphaRoot,
        currentProjectLocalRoot() {
          return alphaProjectLocalRoot;
        },
        async createRuntime() {
          return runtime;
        },
        async listProjects() {
          return {
            ok: true,
            projects: [
              {
                projectRoot: alphaRoot,
                runtime: await readProjectRuntimeOpenState({
                  projectLocalRoot: alphaProjectLocalRoot
                }),
                slug: "alpha"
              }
            ],
            projectsRoot: targetRoot
          };
        }
      }
    });

    try {
      assert.equal(terminal.ok, true);
      const result = await terminalService.closeDormantProjectRuntimes({
        idleAfterMs: 30 * 60 * 1000,
        nowMs: Date.now() + (31 * 60 * 1000)
      });

      assert.equal(result.ok, true);
      assert.equal(result.projectCount, 1);
      assert.equal(result.closedCount, 0);
      assert.equal(result.results[0].skipped, true);
      assert.equal(result.results[0].reason, "active-agent-run");
      assert.deepEqual(result.results[0].dormancy.activeAgentSessionIds, ["active-project-session"]);
      assert.equal((await readProjectRuntimeOpenState({
        projectLocalRoot: alphaProjectLocalRoot
      })).open, true);
      assert.equal(readTerminalSession(terminal.id, {
        namespace: alphaNamespace
      }).ok, true);
    } finally {
      await closeTerminalSessionsForNamespacePrefix(alphaNamespace);
    }
  });
});

test("Vibe64 dormant project cleanup schedule repeats until stopped", async () => {
  const calls = [];
  const cleared = [];
  const intervals = [];
  let intervalCallback = null;
  let unrefCalled = false;
  const intervalHandle = {
    unref() {
      unrefCalled = true;
    }
  };
  const schedule = startProjectRuntimeDormancyCleanupSchedule({
    clearIntervalImpl: (handle) => {
      cleared.push(handle);
    },
    idleAfterMs: 1234,
    intervalMs: 5678,
    serviceFactory: () => ({
      async closeDormantProjectRuntimes(input = {}) {
        calls.push(input);
        return {
          closedCount: 0,
          failed: [],
          ok: true,
          projectCount: 0,
          results: []
        };
      }
    }),
    setIntervalImpl: (callback, intervalMs) => {
      intervalCallback = callback;
      intervals.push(intervalMs);
      return intervalHandle;
    }
  });

  assert.equal(schedule.idleAfterMs, 1234);
  assert.equal(schedule.intervalMs, 5678);
  assert.deepEqual(intervals, [5678]);
  assert.equal(unrefCalled, true);

  intervalCallback();
  await waitForArrayLength(calls, 1);
  intervalCallback();
  await waitForArrayLength(calls, 2);

  assert.deepEqual(calls, [
    {
      idleAfterMs: 1234
    },
    {
      idleAfterMs: 1234
    }
  ]);
  schedule.stop();
  assert.deepEqual(cleared, [intervalHandle]);
  intervalCallback();
  await delay(5);
  assert.equal(calls.length, 2);
});

test("Vibe64 command terminal rejects the wrong owner at controller access", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const providerHomesRoot = path.join(targetRoot, "provider-homes");
    await mkdir(path.join(providerHomesRoot, "github", "ada@example.com"), {
      recursive: true
    });
    await mkdir(path.join(providerHomesRoot, "github", "grace@example.com"), {
      recursive: true
    });
    const sessionId = "unit-session";
    const namespace = commandTerminalNamespace(sessionId);
    const controller = createCommandTerminalController({
      env: {
        [VIBE64_GITHUB_ACCOUNT_MODE_ENV]: "user",
        [VIBE64_PROVIDER_HOMES_ROOT_ENV]: providerHomesRoot
      },
      projectService: {
        async createRuntime() {
          return {};
        }
      }
    });
    const owner = terminalOwnerForGithubActor({
      accountMode: "user",
      providerHomesRoot,
      vibe64User: {
        email: "ada@example.com"
      }
    });
    const terminal = startTerminalSession({
      args: [
        "-e",
        "process.stdin.resume(); setInterval(() => {}, 1000);"
      ],
      command: process.execPath,
      commandPreview: "node long-running",
      cwd: targetRoot,
      metadata: {
        sessionId,
        terminalKind: "command",
        ...terminalOwnerMetadata(owner)
      },
      namespace
    });
    const wrongUserInput = {
      vibe64User: {
        email: "grace@example.com"
      }
    };

    try {
      for (const denied of [
        controller.readTerminal(sessionId, terminal.id, wrongUserInput),
        controller.writeTerminal(sessionId, terminal.id, "input", wrongUserInput),
        await controller.closeTerminal(sessionId, terminal.id, wrongUserInput)
      ]) {
        assert.equal(denied.ok, false);
        assert.equal(denied.code, TERMINAL_OWNER_MISMATCH_CODE);
      }
    } finally {
      await closeTerminalSessionsForNamespacePrefix(namespace);
    }
  });
});

test("Vibe64 shell terminal rejects the wrong owner at controller access", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const providerHomesRoot = path.join(targetRoot, "provider-homes");
    await mkdir(path.join(providerHomesRoot, "github", "ada@example.com"), {
      recursive: true
    });
    await mkdir(path.join(providerHomesRoot, "github", "grace@example.com"), {
      recursive: true
    });
    const sessionId = "unit-session";
    const namespace = shellTerminalNamespace(sessionId);
    const controller = createShellTerminalController({
      env: {
        [VIBE64_GITHUB_ACCOUNT_MODE_ENV]: "user",
        [VIBE64_PROVIDER_HOMES_ROOT_ENV]: providerHomesRoot
      },
      projectService: {}
    });
    const owner = terminalOwnerForGithubActor({
      accountMode: "user",
      providerHomesRoot,
      vibe64User: {
        email: "ada@example.com"
      }
    });
    const terminal = startTerminalSession({
      args: [
        "-e",
        "process.stdin.resume(); setInterval(() => {}, 1000);"
      ],
      command: process.execPath,
      commandPreview: "node long-running",
      cwd: targetRoot,
      metadata: {
        sessionId,
        terminalKind: "shell",
        ...terminalOwnerMetadata(owner)
      },
      namespace
    });
    const denied = controller.readTerminal(sessionId, terminal.id, {
      vibe64User: {
        email: "grace@example.com"
      }
    });

    try {
      assert.equal(denied.ok, false);
      assert.equal(denied.code, TERMINAL_OWNER_MISMATCH_CODE);
    } finally {
      await closeTerminalSessionsForNamespacePrefix(namespace);
    }
  });
});

test("Vibe64 project tool terminal mounts the actor-scoped GitHub provider home", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const providerHomesRoot = path.join(targetRoot, "provider-homes");
    const userHome = path.join(providerHomesRoot, "github", "ada@example.com");
    const localHome = path.join(providerHomesRoot, "github", "local");
    const userTerminalHome = path.join(providerHomesRoot, "terminal-homes", "github", "ada@example.com");
    const localTerminalHome = path.join(providerHomesRoot, "terminal-homes", "github", "local");
    await mkdir(userHome, {
      recursive: true
    });
    await mkdir(localHome, {
      recursive: true
    });
    const terminalCalls = [];
    const controller = createProjectToolTerminalController({
      ensureRuntimeNetwork: async () => null,
      env: {
        [VIBE64_GITHUB_ACCOUNT_MODE_ENV]: "user",
        [VIBE64_PROVIDER_HOMES_ROOT_ENV]: providerHomesRoot
      },
      projectService: {
        async createRuntime() {
          return {};
        }
      },
      resolveToolchainImage: async () => ({
        image: "adapter-toolchain:1.0.0",
        label: "Adapter toolchain",
        ok: true
      }),
      startTerminal(options) {
        const args = typeof options.args === "function"
          ? options.args({
              id: "unit-project-tool-terminal"
            })
          : options.args;
        terminalCalls.push({
          args,
          metadata: options.metadata,
          namespace: options.namespace
        });
        return {
          args,
          id: "unit-project-tool-terminal",
          metadata: options.metadata,
          ok: true
        };
      }
    });

    const result = await controller.startPreparedRun("unit-tool", {
      input: {},
      spec: {
        args: ["-lc", "gh auth status"],
        command: "bash",
        commandPreview: "gh auth status",
        cwd: targetRoot
      },
      targetRoot,
      tool: {
        id: "unit-tool",
        label: "Unit tool"
      },
      type: "command"
    }, {
      vibe64User: {
        email: "Ada@Example.com"
      }
    });

    assert.equal(result.ok, true);
    assert.equal(terminalCalls.length, 1);
    assertDockerVolumeMount(terminalCalls[0].args, userTerminalHome, STUDIO_TOOL_HOME_PATH);
    assertDockerVolumeMount(terminalCalls[0].args, userHome, STUDIO_GITHUB_PROVIDER_HOME_PATH);
    assertDockerEnv(terminalCalls[0].args, "GH_CONFIG_DIR", STUDIO_GITHUB_PROVIDER_GH_CONFIG_DIR);
    assertDockerEnv(terminalCalls[0].args, "GIT_CONFIG_GLOBAL", STUDIO_GITHUB_PROVIDER_GIT_CONFIG_GLOBAL);
    assert.equal(terminalCalls[0].namespace, toolTerminalNamespace("unit-tool"));
    assert.equal(terminalCalls[0].metadata.terminalOwner.ownerScope, "user");
    assert.equal(terminalCalls[0].metadata.terminalOwner.ownerUserKey, "ada@example.com");

    const localCalls = [];
    const localController = createProjectToolTerminalController({
      ensureRuntimeNetwork: async () => null,
      env: {
        [VIBE64_PROVIDER_HOMES_ROOT_ENV]: providerHomesRoot
      },
      projectService: {
        async createRuntime() {
          return {};
        }
      },
      resolveToolchainImage: async () => ({
        image: "adapter-toolchain:1.0.0",
        label: "Adapter toolchain",
        ok: true
      }),
      startTerminal(options) {
        const args = typeof options.args === "function"
          ? options.args({
              id: "unit-project-tool-local-terminal"
            })
          : options.args;
        localCalls.push({
          args,
          metadata: options.metadata
        });
        return {
          args,
          id: "unit-project-tool-local-terminal",
          metadata: options.metadata,
          ok: true
        };
      }
    });

    const localResult = await localController.startPreparedRun("unit-tool", {
      input: {},
      spec: {
        args: ["-lc", "gh auth status"],
        command: "bash",
        commandPreview: "gh auth status",
        cwd: targetRoot
      },
      targetRoot,
      tool: {
        id: "unit-tool",
        label: "Unit tool"
      },
      type: "command"
    });

    assert.equal(localResult.ok, true);
    assertDockerVolumeMount(localCalls[0].args, localTerminalHome, STUDIO_TOOL_HOME_PATH);
    assertDockerVolumeMount(localCalls[0].args, localHome, STUDIO_GITHUB_PROVIDER_HOME_PATH);
    assert.equal(localCalls[0].metadata.terminalOwner.ownerScope, "local");
    assert.equal(localCalls[0].metadata.terminalOwner.ownerUserKey, "local");
  });
});

test("Vibe64 project tool terminal rejects the wrong owner at controller access", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const providerHomesRoot = path.join(targetRoot, "provider-homes");
    await mkdir(path.join(providerHomesRoot, "github", "ada@example.com"), {
      recursive: true
    });
    await mkdir(path.join(providerHomesRoot, "github", "grace@example.com"), {
      recursive: true
    });
    const namespace = toolTerminalNamespace("unit-tool");
    const controller = createProjectToolTerminalController({
      env: {
        [VIBE64_GITHUB_ACCOUNT_MODE_ENV]: "user",
        [VIBE64_PROVIDER_HOMES_ROOT_ENV]: providerHomesRoot
      },
      projectService: {
        async createRuntime() {
          return {};
        }
      }
    });
    const owner = terminalOwnerForGithubActor({
      accountMode: "user",
      providerHomesRoot,
      vibe64User: {
        email: "ada@example.com"
      }
    });
    const terminal = startTerminalSession({
      args: [
        "-e",
        "process.stdin.resume(); setInterval(() => {}, 1000);"
      ],
      command: process.execPath,
      commandPreview: "node long-running",
      cwd: targetRoot,
      metadata: {
        terminalKind: "project-tool",
        toolId: "unit-tool",
        ...terminalOwnerMetadata(owner)
      },
      namespace
    });

    try {
      const denied = controller.readTerminal("unit-tool", terminal.id, {
        vibe64User: {
          email: "grace@example.com"
        }
      });
      assert.equal(denied.ok, false);
      assert.equal(denied.code, TERMINAL_OWNER_MISMATCH_CODE);
    } finally {
      await closeTerminalSessionsForNamespacePrefix(namespace);
    }
  });
});

test("Vibe64 terminal service passes runtime env to command terminals", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new Vibe64SessionRuntime({
      adapter: new MissingToolchainCommandAdapter(),
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
      sessionId: "terminal_service_env"
    });

    const service = createTestTerminalService({
      env: await commandTerminalTestEnv(targetRoot),
      projectService: {
        targetRoot,
        async createRuntime() {
          return runtime;
        }
      }
    });

    const result = await service.startCommandTerminal("terminal_service_env", {
      actionId: "unit_command"
    });

    assert.equal(result.ok, false);
    assert.match(result.error, /Service test missing toolchain image vibe64-service-test-missing-toolchain:never is missing/u);
    assert.doesNotMatch(result.error, /provider homes root is required/u);
  });
});

test("Vibe64 command terminal action forwards the authenticated user", async () => {
  const action = terminalFeatureActions.find((entry) => entry.id === ACTION_START_COMMAND_TERMINAL);
  const calls = [];
  const result = await action.execute({
    actionId: "create_worktree",
    sessionId: "unit-session",
    vibe64User: {
      email: "ada@example.com"
    }
  }, {}, {
    featureService: {
      startCommandTerminal(sessionId, input) {
        calls.push({
          input,
          sessionId
        });
        return {
          ok: true
        };
      }
    }
  });

  assert.deepEqual(result, {
    ok: true
  });
  assert.deepEqual(calls, [
    {
      input: {
        actionId: "create_worktree",
        advanceOnSuccess: false,
        input: undefined,
        vibe64User: {
          email: "ada@example.com"
        }
      },
      sessionId: "unit-session"
    }
  ]);
});

test("Vibe64 command terminal mounts the session root for session clone creation outside the repo", () => {
  const targetRoot = "/home/workspace/vibe64/beepollen";
  const sessionRoot = "/home/workspace/vibe64/beepollen/.vibe64-local/sessions/active/unit";
  const resultDirectory = "/tmp/vibe64-command-unit";
  const args = commandTerminalArgs({
    args: [
      "-lc",
      `git clone https://github.com/example/project.git ${sessionRoot}/worktree`
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

test("Vibe64 terminal env skips managed MariaDB client defaults when unmanaged", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const env = await projectTerminalEnvironment({
      runtime: {
        adapter: new JskitTargetAdapter(),
        projectConfig: {
          values: {
            jskit_database_runtime: "none"
          }
        }
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

test("Vibe64 terminal env requests server runtime config for worktree shells", async () => {
  const calls = [];
  const env = await projectTerminalEnvironment({
    projectService: {
      async projectConfigEnvironment() {
        return {};
      },
      async projectRuntimeConfigEnvironment(input = {}) {
        calls.push(input);
        return {
          APP_PUBLIC_URL: "http://localhost:3000"
        };
      }
    },
    session: {
      metadata: {
        worktree_path: "/tmp/vibe64-worktree"
      }
    },
    target: "worktree",
    targetRoot: "/tmp/vibe64-target"
  });

  assert.equal(env.APP_PUBLIC_URL, "http://localhost:3000");
  assert.deepEqual(calls.map((call) => call.phases), [[RUNTIME_CONFIG_PHASES.SERVER]]);
  assert.equal(calls[0].worktreePath, "/tmp/vibe64-worktree");
});

test("Vibe64 terminal env derives command runtime config phases from specs", () => {
  assert.deepEqual(runtimeConfigPhasesForCommand({
    action: {
      id: "install_dependencies",
      label: "Install dependencies"
    },
    spec: {
      commandPreview: "npm install"
    }
  }), [RUNTIME_CONFIG_PHASES.INSTALL]);

  assert.deepEqual(runtimeConfigPhasesForTerminalContext({
    action: {
      id: "custom_migrate"
    },
    spec: {
      runtimeConfigPhases: [RUNTIME_CONFIG_PHASES.MIGRATE]
    },
    target: "command"
  }), [RUNTIME_CONFIG_PHASES.MIGRATE]);
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
      env: await commandTerminalTestEnv(targetRoot),
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
    let lifecycle = await runtime.store.readCommandLifecycle("terminal_success", "1-unit_command-001");
    for (let attempt = 0; attempt < 20 && lifecycle?.phase !== "done"; attempt += 1) {
      await delay(5);
      lifecycle = await runtime.store.readCommandLifecycle("terminal_success", "1-unit_command-001");
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

test("Vibe64 command terminal claims one active execution per session", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new Vibe64SessionRuntime({
      adapter: new UnitCommandAdapter(),
      targetRoot,
      workflow: {
        id: "unit-terminal-duplicate-claim",
        steps: [
          {
            actions: [
              {
                adapterCapability: "unit_command",
                id: "unit_command",
                label: "Unit command",
                type: "command"
              },
              {
                adapterCapability: "unit_command",
                id: "second_unit_command",
                label: "Second unit command",
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
      sessionId: "terminal_duplicate_claim"
    });

    let closeTerminal = async () => null;
    let startCount = 0;
    const command = createCommandTerminalController({
      env: await commandTerminalTestEnv(targetRoot),
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
        startCount += 1;
        const id = `unit-command-duplicate-terminal-${startCount}`;
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

    const first = await command.startTerminal("terminal_duplicate_claim", {
      actionId: "unit_command"
    });
    assert.equal(first.ok, true);
    assert.equal(startCount, 1);

    const runningDuplicate = await command.startTerminal("terminal_duplicate_claim", {
      actionId: "unit_command"
    });
    assert.equal(runningDuplicate.ok, true);
    assert.equal(runningDuplicate.code, "vibe64_command_execution_claimed");
    assert.equal(runningDuplicate.commandLifecycleId, "1-unit_command-001");
    assert.equal(runningDuplicate.operationOutcome, "command_already_running");
    assert.equal(runningDuplicate.refreshRecommended, true);
    assert.equal(runningDuplicate.terminalSessionId, "unit-command-duplicate-terminal-1");
    assert.equal(startCount, 1);

    const runningOtherAction = await command.startTerminal("terminal_duplicate_claim", {
      actionId: "second_unit_command"
    });
    assert.equal(runningOtherAction.ok, true);
    assert.equal(runningOtherAction.code, "vibe64_command_execution_claimed");
    assert.equal(runningOtherAction.commandLifecycleId, "1-unit_command-001");
    assert.equal(runningOtherAction.operationOutcome, "command_already_running");
    assert.equal(runningOtherAction.refreshRecommended, true);
    assert.equal(runningOtherAction.terminalSessionId, "unit-command-duplicate-terminal-1");
    assert.equal(startCount, 1);

    await closeTerminal();
    let lifecycle = await runtime.store.readCommandLifecycle("terminal_duplicate_claim", "1-unit_command-001");
    for (let attempt = 0; attempt < 20 && lifecycle?.phase !== "done"; attempt += 1) {
      await delay(5);
      lifecycle = await runtime.store.readCommandLifecycle("terminal_duplicate_claim", "1-unit_command-001");
    }
    assert.equal(lifecycle.phase, "done");
    assert.equal(lifecycle.outcome, "completed");

    const finishedDuplicate = await command.startTerminal("terminal_duplicate_claim", {
      actionId: "unit_command"
    });
    assert.equal(finishedDuplicate.ok, true);
    assert.equal(finishedDuplicate.code, "vibe64_command_execution_claimed");
    assert.equal(finishedDuplicate.commandLifecycleId, "1-unit_command-001");
    assert.equal(finishedDuplicate.operationOutcome, "command_already_finished");
    assert.equal(finishedDuplicate.refreshRecommended, true);
    assert.equal(startCount, 1);

    const lifecycles = await runtime.store.readCommandLifecycles("terminal_duplicate_claim");
    assert.deepEqual(lifecycles.map((item) => item.id), ["1-unit_command-001"]);
  });
});

test("Vibe64 command terminal duplicate start waits until claimed command is attachable", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new Vibe64SessionRuntime({
      adapter: new UnitCommandAdapter(),
      targetRoot,
      workflow: {
        id: "unit-terminal-duplicate-starting",
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
      sessionId: "terminal_duplicate_starting"
    });

    const terminalStarted = deferred();
    const terminalReleased = deferred();
    let startCount = 0;
    const command = createCommandTerminalController({
      env: await commandTerminalTestEnv(targetRoot),
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
      startTerminal: async () => {
        startCount += 1;
        terminalStarted.resolve();
        await terminalReleased.promise;
        return {
          id: "unit-command-delayed-terminal",
          ok: true,
          status: "running"
        };
      }
    });

    const first = command.startTerminal("terminal_duplicate_starting", {
      actionId: "unit_command"
    });
    await terminalStarted.promise;

    const duplicate = command.startTerminal("terminal_duplicate_starting", {
      actionId: "unit_command"
    });
    await waitForCondition(async () => {
      const lifecycle = await runtime.store.readCommandLifecycle("terminal_duplicate_starting", "1-unit_command-001");
      return lifecycle?.phase === "starting" && !lifecycle.terminalSessionId;
    }, "Expected duplicate command test to observe a starting lifecycle.");
    terminalReleased.resolve();

    await assert.doesNotReject(first);
    const duplicateResult = await duplicate;
    assert.equal(duplicateResult.ok, true);
    assert.equal(duplicateResult.code, "vibe64_command_execution_claimed");
    assert.equal(duplicateResult.commandLifecycleId, "1-unit_command-001");
    assert.equal(duplicateResult.operationOutcome, "command_already_running");
    assert.equal(duplicateResult.terminalSessionId, "unit-command-delayed-terminal");
    assert.equal(startCount, 1);
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
      env: await commandTerminalTestEnv(targetRoot),
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

test("Vibe64 command terminal retry starts a new attempt after failure", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new Vibe64SessionRuntime({
      adapter: new UnitCommandAdapter(),
      targetRoot,
      workflow: {
        id: "unit-terminal-failure-retry",
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
      sessionId: "terminal_failure_retry"
    });

    let closeTerminal = async () => null;
    let startCount = 0;
    const command = createCommandTerminalController({
      env: await commandTerminalTestEnv(targetRoot),
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
        startCount += 1;
        const id = `unit-command-retry-terminal-${startCount}`;
        const dockerArgs = options.args({
          id,
          namespace: options.namespace
        });
        const resultFilePath = dockerEnvValue(dockerArgs, COMMAND_RESULT_ENV);
        closeTerminal = async () => {
          if (startCount === 1) {
            await options.onClose({
              exitCode: 1,
              id,
              output: "seed failed before retry"
            });
            return;
          }
          await writeFile(
            resultFilePath,
            "fact:set\tdynamic_done\tcmV0cnktZG9uZQ==\n",
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

    const first = await command.startTerminal("terminal_failure_retry", {
      actionId: "unit_command"
    });
    assert.equal(first.ok, true);
    assert.equal(startCount, 1);
    await closeTerminal();
    await waitForCondition(async () => {
      const lifecycle = await runtime.store.readCommandLifecycle("terminal_failure_retry", "1-unit_command-001");
      return lifecycle?.phase === "done" &&
        lifecycle?.outcome === "blocked" &&
        lifecycle?.postCommit?.publishSessionChanged === "done";
    }, "Expected failed command lifecycle to finish as blocked.");

    const retry = await command.startTerminal("terminal_failure_retry", {
      actionId: "unit_command"
    });
    assert.equal(retry.ok, true);
    assert.equal(retry.code, undefined);
    assert.equal(startCount, 2);
    await closeTerminal();
    await waitForCondition(async () => {
      const lifecycle = await runtime.store.readCommandLifecycle("terminal_failure_retry", "1-unit_command-002");
      return lifecycle?.phase === "done" && lifecycle?.outcome === "completed";
    }, "Expected retry command lifecycle to finish as completed.");

    const lifecycles = await runtime.store.readCommandLifecycles("terminal_failure_retry");
    assert.deepEqual(lifecycles.map((item) => ({
      id: item.id,
      outcome: item.outcome,
      phase: item.phase,
      terminalSessionId: item.terminalSessionId
    })), [
      {
        id: "1-unit_command-001",
        outcome: "blocked",
        phase: "done",
        terminalSessionId: "unit-command-retry-terminal-1"
      },
      {
        id: "1-unit_command-002",
        outcome: "completed",
        phase: "done",
        terminalSessionId: "unit-command-retry-terminal-2"
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
      env: await commandTerminalTestEnv(targetRoot),
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
      env: await commandTerminalTestEnv(targetRoot),
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
      env: await commandTerminalTestEnv(targetRoot),
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
    const service = createTestTerminalService({
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
      env: await commandTerminalTestEnv(targetRoot),
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

test("Vibe64 shell terminal resolves only the session clone target", async () => {
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

    const emptyTarget = await resolveShellTerminalCwd({
      projectService: {
        targetRoot
      },
      session,
      target: ""
    });
    assert.equal(emptyTarget.ok, true);
    assert.equal(emptyTarget.cwd, worktreePath);

    const invalidTarget = await resolveShellTerminalCwd({
      projectService: {
        targetRoot
      },
      session,
      target: "main"
    });
    assert.equal(invalidTarget.ok, false);
    assert.match(invalidTarget.error, /must be worktree/u);

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
    assert.match(missingWorktree.error, /Create the session clone/u);
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
    const service = createTestTerminalService({
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
    assert.match(invalid.error, /must be worktree/u);
  });
});

test("Vibe64 terminal service publishes session changes after close and stop actions", async () => {
  const published = [];
  const publisher = (kind) => async (sessionId, event = {}) => {
    published.push({
      kind,
      reason: event.reason,
      sessionId
    });
  };
  const service = createTestTerminalService({
    projectService: {
      targetRoot: "/tmp/vibe64-terminal-publish-test"
    },
    publishSessionChanged: {
      codexTerminalClosed: publisher("codex"),
      commandTerminalClosed: publisher("command"),
      launchTargetClosed: publisher("launch-close"),
      launchTargetStopped: publisher("launch-stop"),
      shellTerminalClosed: publisher("shell")
    }
  });

  await service.closeCodexTerminal("publish_session", "missing-codex");
  await service.closeCommandTerminal("publish_session", "missing-command");
  await service.closeLaunchTargetTerminal("publish_session", "missing-launch-close");
  await service.stopLaunchTargetTerminal("publish_session", "missing-launch-stop");
  await service.closeShellTerminal("publish_session", "missing-shell");

  assert.deepEqual(published, [
    {
      kind: "codex",
      reason: "codex-terminal-closed",
      sessionId: "publish_session"
    },
    {
      kind: "command",
      reason: "command-terminal-closed",
      sessionId: "publish_session"
    },
    {
      kind: "launch-close",
      reason: "launch-target-closed",
      sessionId: "publish_session"
    },
    {
      kind: "launch-stop",
      reason: "launch-target-stopped",
      sessionId: "publish_session"
    },
    {
      kind: "shell",
      reason: "shell-terminal-closed",
      sessionId: "publish_session"
    }
  ]);
});

test("Vibe64 shell terminal action preserves reuseRunning", async () => {
  const action = terminalFeatureActions.find((item) => item.id === ACTION_START_SHELL_TERMINAL);
  const calls = [];

  const result = await action.execute({
    reuseRunning: false,
    sessionId: "shell_action"
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
        reuseRunning: false
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
    assert.equal(helper.env.VIBE64_FIX_CODEX_REPORT_HELPER, "/vibe64-fix-helper/vibe64-fix-codex-report.mjs");
    assert.equal(helper.env.VIBE64_FIX_CODEX_REPORT_SOCKET, "/vibe64-fix-helper/fix.sock");

    try {
      const result = await runNodeScript(helper.hostScriptPath, [
        "--json"
      ], {
        ...helper.env,
        VIBE64_FIX_CODEX_REPORT_HELPER: helper.hostScriptPath,
        VIBE64_FIX_CODEX_REPORT_SOCKET: helper.hostSocketPath
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
