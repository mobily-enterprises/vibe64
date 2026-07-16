import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir, userInfo } from "node:os";
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
  VIBE64_CODEX_ATTACHMENTS_ROOT_ENV
} from "@local/vibe64-runtime/server/codexAttachmentPaths";
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
  RUNTIME_CONFIG_PHASES,
  RUNTIME_CONFIG_TARGETS
} from "@local/vibe64-core/server/runtimeConfig";
import {
  JSKIT_PREVIEW_AUTH_KIND,
  previewAuthSecretPath,
  verifyPreviewIdentityGrant
} from "@local/vibe64-core/server/previewAuth";
import {
  readCodexAuthStatus
} from "@local/vibe64-core/server/codexAuthState";
import {
  WORKFLOW_REPOSITORY_PROFILE_CANONICAL_GIT,
  WORKFLOW_REPOSITORY_PROFILE_GITHUB_PR
} from "../../packages/vibe64-core/src/server/projectRepository.js";
import {
  createService,
  startProjectRuntimeDormancyCleanupSchedule,
  terminalNamespaceMatchesProjectScope
} from "../../packages/vibe64-terminals/src/server/service.js";
import {
  ACTION_RUN_PROJECT_TOOL,
  ACTION_START_COMMAND_TERMINAL,
  ACTION_START_SESSION_TERMINAL_FIX,
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
  codexGitCommandShimDirs,
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
  COMMAND_RESULT_ENV,
  SHARED_COMMAND_RESULT_DIRECTORY_MODE,
  createCommandResultFileSync
} from "../../packages/vibe64-terminals/src/server/commandTerminalResults.js";
import {
  applyGitSafeDirectoriesToEnv,
  commandTerminalGitSafeDirectories,
  commandTerminalHostArgs,
  commandResultDirectoryRoot,
  createCommandTerminalController,
  createProjectToolTerminalController,
  resolveCommandTerminalToolHome,
  startCommandTerminalProcess
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
  toolTerminalNamespace
} from "../../packages/vibe64-terminals/src/server/terminalShared.js";
import {
  closeTerminalSession,
  closeTerminalSessionsForNamespacePrefix,
  countRunningTerminalSessions,
  readTerminalSession,
  startTerminalSession
} from "@local/vibe64-execution/server/terminalSessions";
import {
  codexRuntimeContext
} from "@local/studio-terminal-core/server/codexRuntimeContext";
import {
  terminalOwnerForGithubActor,
  terminalOwnerMetadata
} from "@local/studio-terminal-core/server/terminalOwnership";
import {
  loadProjectExecutionEnv,
  runtimeConfigPhasesForCommand,
  runtimeConfigPhasesForTerminalContext,
  runtimeConfigPhasesForTerminalTarget
} from "../../packages/vibe64-terminals/src/server/projectExecutionEnv.js";
import {
  JskitTargetAdapter
} from "@local/vibe64-adapters/server/adapters/jskit/adapter";
import {
  jskitMariaDbHostPort,
  JSKIT_MARIADB_HOST
} from "@local/vibe64-adapters/server/adapters/jskit/setupMariaDbRuntime";
import {
  STUDIO_MANAGED_CODEX_COMMAND,
  STUDIO_MANAGED_CODEX_NO_UPDATE_CONFIG,
  VIBE64_LOCAL_RUNTIME_NAMESPACE,
  VIBE64_RUNTIME_NAMESPACE_ENV
} from "@local/studio-terminal-core/server/studioRuntimeIdentity";
import {
  githubSshToHttpsGitEnv
} from "@local/vibe64-execution/server";
import {
  VIBE64_GITHUB_ACCOUNT_MODE_ENV
} from "@local/vibe64-execution/server";
import {
  VIBE64_SYSTEM_ROOT_ENV,
  VIBE64_SELF_TARGET_SYSTEM_ROOT_ENV
} from "@local/vibe64-core/server/studioRoots";
import {
  SESSION_SOURCE_PATH_AUTHORITY_MANAGED
} from "@local/vibe64-core/server/sessionSourcePath";
import {
  _testing as coreMaintenanceTesting
} from "@local/vibe64-runtime/server/workflowModules/coreMaintenance";
import {
  projectRuntimeRoot,
  sourcePath,
  withTemporaryRoot
} from "./vibe64TestHelpers.js";
const POST_COMMIT_TEST_TIMEOUT_MS = 500;
const CODEX_APP_SERVER_AGENT_RUN_ID = "codex_app_server";
const MAINTENANCE_WORKFLOW_DEFINITION_IDS = coreMaintenanceTesting.workflowDefinitionIds;
const TEST_WORKFLOW_ORIGIN_ID = "tab:test";
const UNIT_DATABASE_PASSWORD = "unit-database-password";
const execFileAsync = promisify(execFile);

process.env[VIBE64_RUNTIME_NAMESPACE_ENV] = "unit-owner";

test.after(async () => {
  await closeTerminalSessionsForNamespacePrefix("");
});

function testWorkflowInput(input = {}) {
  return {
    originId: TEST_WORKFLOW_ORIGIN_ID,
    ...(input && typeof input === "object" && !Array.isArray(input) ? input : {})
  };
}

function commandTerminalTestRunCommand(startTerminal) {
  return (request = {}) => {
    const terminal = request.terminal || {};
    return startTerminal({
      args: request.args,
      command: request.command,
      commandPreview: terminal.commandPreview,
      cwd: request.cwd,
      detachedIdleTimeoutMs: terminal.detachedIdleTimeoutMs,
      env: request.env,
      maxRunning: terminal.maxRunning,
      metadata: terminal.metadata,
      namespace: terminal.namespace,
      namespaceLimitPrefix: terminal.namespaceLimitPrefix,
      onClose: terminal.onClose,
      reuseRunning: terminal.reuseRunning
    });
  };
}

function testSessionRoot(targetRoot, sessionId) {
  return path.join(projectRuntimeRoot(targetRoot), "sessions", "active", sessionId);
}

function testSessionSourcePath(targetRoot, sessionId) {
  return sourcePath(targetRoot, sessionId);
}

function testSourceMetadataForPath(sourcePathValue, metadata = {}) {
  return {
    source_kind: "session_clone",
    source_path: sourcePathValue,
    source_path_authority: SESSION_SOURCE_PATH_AUTHORITY_MANAGED,
    ...metadata
  };
}

function testSessionGitCommandActor({
  scope = "user",
  sessionId = "unit-session",
  targetRoot = "/workspace/project",
  username = "",
  userKey = username,
  workdir = targetRoot
} = {}) {
  return {
    metadata: {
      session_git_command_actor_reason: "unit-test",
      session_git_command_actor_scope: scope,
      session_git_command_actor_session_id: sessionId,
      session_git_command_actor_target_root: targetRoot,
      session_git_command_actor_thread_id: "",
      session_git_command_actor_updated_at: "2026-06-29T00:00:00.000Z",
      session_git_command_actor_user_key: scope === "user" ? userKey : "local",
      session_git_command_actor_workdir: workdir
    },
    sessionId,
    targetRoot
  };
}

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
  events = [],
  finishedAt = "",
  inputSource = "",
  providerStatus = "inProgress",
  providerThreadId = "",
  providerTurnId = "",
  startedAt = "",
  state = VIBE64_AGENT_RUN_STATE.ACTIVE,
  stepId = "",
  stepStatus = "",
  updatedAt = "",
  workflowResultContract = null
} = {}) {
  return {
    active: vibe64AgentRunStateIsActive(state),
    error,
    events,
    finishedAt,
    id: CODEX_APP_SERVER_AGENT_RUN_ID,
    ...(inputSource ? { inputSource } : {}),
    provider: "codex",
    providerInterface: "app-server",
    providerStatus,
    providerThreadId,
    providerTurnId,
    startedAt,
    stepId,
    stepStatus,
    updatedAt,
    state,
    ...(workflowResultContract ? { workflowResultContract } : {})
  };
}

function codexAppServerAgentRunSnapshot(session = {}) {
  return (Array.isArray(session.agentRuns) ? session.agentRuns : [])
    .find((run) => run.id === CODEX_APP_SERVER_AGENT_RUN_ID) || null;
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

function unitCommandDefinition({
  id = "unit_command",
  label = "Unit command"
} = {}) {
  return {
    adapterCapability: "unit_command",
    id,
    label,
    type: "command"
  };
}

async function commandTerminalFixture(targetRoot, {
  actions = [unitCommandDefinition()],
  publishSessionChanged,
  readTerminalSessionImpl = () => ({
    ok: true,
    status: "running"
  }),
  runCommand,
  sessionId
} = {}) {
  const runtime = new Vibe64SessionRuntime({
    adapter: new UnitCommandAdapter(),
    targetRoot,
    workflow: {
      id: `unit-${sessionId}`,
      steps: [
        {
          actions,
          id: "unit_step",
          label: "Unit step"
        }
      ]
    }
  });
  await runtime.createSession({ sessionId });
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
          VIBE64_PROJECT_MANIFEST: path.join(targetRoot, "vibe64.project.json")
        };
      }
    },
    publishSessionChanged,
    readTerminalSessionImpl,
    runCommand
  });
  return {
    command,
    runtime
  };
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
    launchReadinessMarkerLineSeen(`[studio] Generated script contains ${marker}\n`, marker),
    false
  );
  assert.equal(
    launchReadinessMarkerLineSeen(`[studio] Starting app\n\u001b[32m${marker}\u001b[0m\n`, marker),
    true
  );
  assert.equal(
    launchReadinessMarkerLineSeen(`[studio] Starting app\n⠙${marker}\n`, marker),
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

test("launch terminal start rejects closing sessions", async () => {
  const sessionId = "launch-closing-session";
  const controller = createLaunchTargetTerminalController({
    projectService: {
      async createRuntime() {
        return {
          adapter: {
            async listLaunchTargets() {
              throw new Error("Launch targets should not be listed while the session is closing.");
            }
          },
          async getSession() {
            return {
              metadata: {
                session_closing_reason: "finished"
              },
              sessionId
            };
          },
          store: {
            async mutateSession(_sessionId, operation) {
              return operation();
            },
            async writeMetadataValue() {
              return null;
            }
          }
        };
      }
    }
  });

  const result = await controller.startTerminal(sessionId, testWorkflowInput({
    launchTargetId: "dev"
  }));

  assert.equal(result.ok, false);
  assert.match(result.error, /Session is finished/u);
});

test("launch terminal start writes session-readable preview diagnostics before a terminal exists", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "launch-diagnostics-missing-target";
    const sessionRoot = testSessionRoot(targetRoot, sessionId);
    const session = {
      metadata: {},
      sessionId,
      sessionRoot,
      targetRoot
    };
    const controller = createLaunchTargetTerminalController({
      projectService: {
        targetRoot,
        async createRuntime() {
          return {
            adapter: {
              async createLaunchTargetTerminalSpec() {
                throw new Error("A launch spec should not be created for a missing target.");
              },
              async listLaunchTargets() {
                return [
                  {
                    id: "built",
                    label: "Run built app"
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
                return operation();
              },
              async writeMetadataValue(_sessionId, key, value) {
                session.metadata[key] = value;
              }
            }
          };
        }
      }
    });

    const result = await controller.startTerminal(sessionId, testWorkflowInput({
      launchTargetId: "dev"
    }));

    assert.equal(result.ok, false);
    assert.match(result.error, /Launch target is not available/u);
    const latest = JSON.parse(await readFile(path.join(sessionRoot, "preview-last.json"), "utf8"));
    assert.equal(latest.status, "failed");
    assert.equal(latest.reason, "launch_target_missing");
    assert.equal(latest.launchTargetId, "dev");
    assert.deepEqual(latest.details.availableLaunchTargetIds, ["built"]);
    const previewLog = await readFile(path.join(sessionRoot, "preview-log.jsonl"), "utf8");
    assert.match(previewLog, /"status":"failed"/u);
    assert.match(previewLog, /launch_target_missing/u);
  });
});

test("launch controller owns managed preview ensure and restart authority", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "launch-ensure-initial-preview";
    const session = {
      metadata: {
        workflow_driver_origin_id: TEST_WORKFLOW_ORIGIN_ID,
        workflow_driver_username: "unit-owner"
      },
      sessionId,
      sessionRoot: testSessionRoot(targetRoot, sessionId),
      targetRoot
    };
    const specInputs = [];
    const terminalRequests = [];
    const controller = createLaunchTargetTerminalController({
      projectService: {
        targetRoot,
        async createRuntime() {
          return {
            adapter: {
              async createLaunchTargetTerminalSpec({ launchInput, launchTargetId }) {
                specInputs.push({
                  launchInput,
                  launchTargetId
                });
                return {
                  args: ["-lc", "npm run dev"],
                  command: "bash",
                  commandPreview: "npm run dev",
                  cwd: targetRoot,
                  metadata: {
                    launchTargetId,
                    openTarget: {
                      href: "http://127.0.0.1:4100/",
                      kind: "url",
                      label: "Open browser"
                    },
                    targetRoot
                  },
                  ok: true,
                  waitForReadiness: false
                };
              },
              async listLaunchTargets() {
                return [
                  {
                    id: "built",
                    label: "Run built app"
                  },
                  {
                    defaultPreview: true,
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
                return operation();
              },
              async writeMetadataValue(_sessionId, key, value) {
                session.metadata[key] = value;
              }
            }
          };
        }
      },
      runCommand(request = {}) {
        terminalRequests.push(request);
        return {
          id: "ensured-preview-terminal",
          metadata: request.terminal.metadata,
          ok: true,
          status: "running"
        };
      }
    });

    const launchInput = {
      workspaceSlug: "demo"
    };
    const missingOrigin = await controller.startTerminal(sessionId, {
      launchTargetId: "dev"
    });
    const ensured = await controller.ensurePreview(sessionId);
    const started = await controller.startTerminal(sessionId, testWorkflowInput({
      forceRestart: true,
      launchInput,
      launchTargetId: "dev"
    }));
    const restarted = await controller.restartPreview(sessionId);

    assert.equal(missingOrigin.ok, false);
    assert.equal(missingOrigin.code, "vibe64_workflow_driver_origin_required");
    assert.equal(ensured.ok, true, JSON.stringify(ensured, null, 2));
    assert.equal(ensured.id, "ensured-preview-terminal");
    assert.equal(started.ok, true, JSON.stringify(started, null, 2));
    assert.equal(restarted.ok, true, JSON.stringify(restarted, null, 2));
    assert.deepEqual(specInputs, [
      {
        launchInput: {},
        launchTargetId: "dev"
      },
      {
        launchInput,
        launchTargetId: "dev"
      },
      {
        launchInput,
        launchTargetId: "dev"
      }
    ]);
    assert.equal(terminalRequests.length, 3);
    assert.deepEqual(terminalRequests[2].terminal.metadata.launchInput, launchInput);
  });
});

test("launch terminal start evaluates function env with the allocated terminal id", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "launch-function-env";
    const namespace = launchTargetTerminalNamespace(sessionId);
    const session = {
      metadata: {},
      sessionId,
      sessionRoot: testSessionRoot(targetRoot, sessionId),
      targetRoot
    };
    const envInputs = [];
    const outputPrefix = "ENV_PAYLOAD:";
    const script = [
      "const payload = {",
      "  DB_HOST: process.env.DB_HOST || '',",
      "  MYSQL_HOST: process.env.MYSQL_HOST || '',",
      "  PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH || '',",
      "  PROJECT_ENV: process.env.PROJECT_ENV || '',",
      "  RUNTIME_ENV: process.env.RUNTIME_ENV || '',",
      "  SPEC_ENV: process.env.SPEC_ENV || '',",
      "  TERMINAL_ID_FROM_ENV: process.env.TERMINAL_ID_FROM_ENV || '',",
      "  NAMESPACE_FROM_ENV: process.env.NAMESPACE_FROM_ENV || ''",
      "};",
      `console.log(${JSON.stringify(outputPrefix)} + JSON.stringify(payload));`,
      "setInterval(() => {}, 1000);"
    ].join("\n");
    const controller = createLaunchTargetTerminalController({
      projectService: {
        targetRoot,
        async createRuntime() {
          return {
            adapter: {
              async createLaunchTargetTerminalSpec() {
                return {
                  args: [
                    "-e",
                    script
                  ],
                  command: process.execPath,
                  cwd: targetRoot,
                  env(input = {}) {
                    envInputs.push({
                      id: input.id || "",
                      namespace: input.namespace || ""
                    });
                    return {
                      SPEC_ENV: "spec",
                      TERMINAL_ID_FROM_ENV: input.id || "",
                      NAMESPACE_FROM_ENV: input.namespace || ""
                    };
                  },
                  metadata: {
                    launchTargetId: "dev",
                    targetRoot
                  },
                  ok: true,
                  reuseRunning: false
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
                return operation();
              },
              async writeMetadataValue(_sessionId, key, value) {
                session.metadata[key] = value;
              }
            }
          };
        },
        async projectConfigEnvironment() {
          return {
            DB_CLIENT: "mysql2",
            DB_HOST: "127.0.0.1",
            PROJECT_ENV: "project"
          };
        },
        async projectRuntimeConfigEnvironment() {
          return {
            PLAYWRIGHT_BROWSERS_PATH: "/tmp/wrong-preview-playwright",
            RUNTIME_ENV: "runtime"
          };
        }
      }
    });

    const terminal = await controller.startTerminal(sessionId, testWorkflowInput({
      launchTargetId: "dev"
    }));

    try {
      assert.equal(terminal.ok, true);
      await waitForCondition(() => readTerminalSession(terminal.id, {
        namespace
      }).output.includes(outputPrefix), "Launch terminal did not print its environment payload.");
      const snapshot = readTerminalSession(terminal.id, {
        namespace
      });
      const payloadLine = snapshot.output
        .split(/\r?\n/u)
        .find((line) => line.includes(outputPrefix)) || "";
      const payload = JSON.parse(payloadLine.slice(payloadLine.indexOf(outputPrefix) + outputPrefix.length));

      assert.equal(payload.DB_HOST, "127.0.0.1");
      assert.equal(payload.MYSQL_HOST, "127.0.0.1");
      assert.equal(payload.PLAYWRIGHT_BROWSERS_PATH, "/opt/vibe64/runtime-packs/playwright/browsers");
      assert.equal(payload.PROJECT_ENV, "project");
      assert.equal(payload.RUNTIME_ENV, "runtime");
      assert.equal(payload.SPEC_ENV, "spec");
      assert.equal(payload.TERMINAL_ID_FROM_ENV, terminal.id);
      assert.equal(payload.NAMESPACE_FROM_ENV, namespace);
      assert.deepEqual(envInputs[0], {
        id: "",
        namespace: ""
      });
      assert.ok(envInputs.some((input) => input.id === terminal.id && input.namespace === namespace));
    } finally {
      await closeTerminalSession(terminal.id, {
        namespace
      });
    }
  });
});

test("launch terminal start passes launch spec runtimes through the execution gateway", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "launch-spec-runtimes";
    const session = {
      metadata: {},
      sessionId,
      sessionRoot: testSessionRoot(targetRoot, sessionId),
      targetRoot
    };
    const requests = [];
    const controller = createLaunchTargetTerminalController({
      projectService: {
        targetRoot,
        async createRuntime() {
          return {
            adapter: {
              async createLaunchTargetTerminalSpec() {
                return {
                  args: ["-lc", "npm run dev"],
                  command: "bash",
                  commandPreview: "npm run dev",
                  cwd: targetRoot,
                  metadata: {
                    launchTargetId: "dev",
                    openTarget: {
                      href: "http://127.0.0.1:4100/",
                      kind: "url",
                      label: "Open browser"
                    },
                    targetRoot
                  },
                  ok: true,
                  reuseRunning: false,
                  runtimes: ["node22", "mariadb", "git"]
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
                return operation();
              },
              async writeMetadataValue(_sessionId, key, value) {
                session.metadata[key] = value;
              }
            }
          };
        }
      },
      runCommand(request = {}) {
        requests.push(request);
        return {
          id: "unit-launch-runtime-terminal",
          metadata: request.terminal.metadata,
          ok: true
        };
      }
    });

    const terminal = await controller.startTerminal(sessionId, testWorkflowInput({
      launchTargetId: "dev"
    }));

    assert.equal(terminal.ok, true);
    assert.deepEqual(requests[0].runtimes, ["git", "node22", "mariadb"]);
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

test("launch status creates runtime with the session source selector", async () => {
  const sessionId = "launch-status-session-source-selector";
  const createRuntimeCalls = [];
  const controller = createLaunchTargetTerminalController({
    projectService: {
      async createRuntime(options = {}) {
        createRuntimeCalls.push(options);
        return {
          adapter: {
            async listLaunchTargets() {
              return [];
            }
          },
          async getSession() {
            return {
              id: sessionId,
              metadata: {},
              targetRoot: "/tmp/vibe64-launch-status-session-source-selector"
            };
          },
          projectConfig: {}
        };
      }
    }
  });

  const status = await controller.launchStatus(sessionId);

  assert.equal(status.ok, true);
  assert.deepEqual(createRuntimeCalls, [
    {
      input: {
        sessionId
      }
    }
  ]);
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

test("launch status repairs a running preview from retained readiness-marker output", async () => {
  const sessionId = "launch-ready-marker-repair";
  const namespace = launchTargetTerminalNamespace(sessionId);
  const readinessMarker = "[[VIBE64_LAUNCH_READY_V1:repair]]";
  const writtenMetadata = {};
  const published = [];
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
      `console.log(${JSON.stringify(readinessMarker)}); process.stdin.resume(); setInterval(() => {}, 1000);`
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
      readinessMarker,
      sessionRoot: "/tmp/vibe64-launch-ready-probe/session",
      targetRoot: "/tmp/vibe64-launch-ready-probe",
      targetUrl: "http://127.0.0.1:4100/app"
    },
    namespace
  });
  assert.equal(terminal.ok, true);
  await waitForCondition(() => readTerminalSession(terminal.id, {
    namespace
  }).output.includes(readinessMarker));
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
    assert.equal(readTerminalSession(terminal.id, {
      namespace
    }).metadata.launchReady, true);
    assert.equal(readTerminalSession(terminal.id, {
      namespace
    }).metadata.launchReadySource, "marker-repair");
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

test("launch preview identity grants use the trusted viewer and active terminal scope", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "launch-preview-identity";
    const sessionRoot = testSessionRoot(targetRoot, sessionId);
    const namespace = launchTargetTerminalNamespace(sessionId);
    const targetHref = "http://127.0.0.1:4100/app";
    const projectScope = "project:preview-identity";
    const terminal = startTerminalSession({
      args: [
        "-e",
        "process.stdin.resume(); setInterval(() => {}, 1000);"
      ],
      command: process.execPath,
      metadata: {
        launchReady: true,
        launchTargetId: "dev",
        launchTargetLabel: "Run app",
        openTarget: {
          href: targetHref,
          kind: "url",
          label: "Open browser"
        },
        previewAuth: JSKIT_PREVIEW_AUTH_KIND,
        projectScope,
        sessionId,
        sessionRoot,
        targetRoot,
        targetUrl: targetHref
      },
      namespace
    });
    assert.equal(terminal.ok, true);

    const secret = "c".repeat(64);
    const secretPath = previewAuthSecretPath({
      sessionRoot,
      terminalSessionId: terminal.id
    });
    await mkdir(path.dirname(secretPath), {
      mode: 0o700,
      recursive: true
    });
    await writeFile(secretPath, secret, {
      mode: 0o600
    });

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
                metadata: {},
                sessionId,
                sessionRoot,
                targetRoot
              };
            },
            projectConfig: {}
          };
        }
      }
    });
    const vibe64User = {
      displayName: "Ada Lovelace",
      email: " ADA@EXAMPLE.COM "
    };

    try {
      const status = await controller.launchStatus(sessionId, {
        vibe64User
      });
      assert.equal(status.ok, true);
      assert.equal(status.preview.state, "ready");
      assert.deepEqual(status.previewIdentity, {
        available: true,
        defaultMode: "viewer",
        disabledReason: "",
        viewer: {
          displayName: "Ada Lovelace",
          email: "ada@example.com"
        }
      });

      const selection = await controller.selectPreviewIdentity(sessionId, {
        mode: "viewer",
        vibe64User
      });
      assert.equal(selection.ok, true);
      assert.deepEqual(selection.requestedIdentity, {
        displayName: "Ada Lovelace",
        email: "ada@example.com",
        mode: "viewer"
      });
      const verified = verifyPreviewIdentityGrant(selection.grant, {
        kind: JSKIT_PREVIEW_AUTH_KIND,
        projectScope,
        secret,
        sessionId,
        targetHref,
        targetRoot,
        terminalSessionId: terminal.id
      });
      assert.deepEqual(verified.selection, {
        email: "ada@example.com",
        operation: "login-as"
      });

      const missingViewer = await controller.selectPreviewIdentity(sessionId, {
        mode: "viewer",
        vibe64User: null
      });
      assert.equal(missingViewer.ok, false);
      assert.equal(missingViewer.code, "vibe64_preview_identity_email_missing");
    } finally {
      await controller.closeAllForSession(sessionId);
    }
  });
});

test("launch status stays starting when retained output has no readiness marker", async () => {
  const sessionId = "launch-ready-marker-missing";
  const namespace = launchTargetTerminalNamespace(sessionId);
  const readinessMarker = "[[VIBE64_LAUNCH_READY_V1:missing]]";
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
      readinessMarker,
      targetUrl: "http://127.0.0.1:4100/app"
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

test("launch status detects stale server files for a running ready launch terminal", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "launch-ready-stale-files";
    const namespace = launchTargetTerminalNamespace(sessionId);
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

    const terminal = startTerminalSession({
      args: [
        "-e",
        "setInterval(() => {}, 1000)"
      ],
      command: process.execPath,
      cwd: targetRoot,
      metadata: {
        launchReady: true,
        launchRestartBaseline: baseline,
        launchTargetId: "dev",
        launchTargetLabel: "Run app",
        openTarget: {
          href: "http://127.0.0.1:4100/app",
          kind: "url",
          label: "Open browser"
        },
        targetRoot
      },
      namespace
    });
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
                  launch_target_label: "Run app"
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
      assert.equal(terminal.ok, true);
      const status = await controller.launchStatus(sessionId);

      assert.equal(status.ok, true);
      assert.equal(status.activeTerminal.id, terminal.id);
      assert.equal(status.preview.state, "stale");
      assert.equal(status.preview.reason, "server_source_changed");
      assert.deepEqual(status.preview.recovery.changedFiles, ["server/app.js"]);
      assert.equal(status.previewTarget.available, true);
      assert.equal(status.previewTarget.stale, true);
      assert.deepEqual(status.previewTarget.recovery.changedFiles, ["server/app.js"]);
      assert.equal(status.previewTarget.recovery.label, "server files");
      assert.equal(status.previewTarget.recovery.reason, "server_source_changed");
    } finally {
      await closeTerminalSession(terminal.id, {
        namespace
      });
    }
  });
});

test("launch status surfaces lost preview state when metadata exists without a terminal", async () => {
  const sessionId = "launch-restart-stale";
  const targetRoot = "/tmp/vibe64-launch-stale";
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
  assert.equal(status.preview.recovery.canStopStale, false);
  assert.equal(status.previewTarget.available, false);
  assert.equal(status.previewTarget.href, "");
  assert.equal(
    status.previewTarget.disabledReason,
    "Preview state was lost after a server restart. Restart preview to recover."
  );
  assert.equal(status.previewTarget.targetHref, "http://127.0.0.1:4100/app");
  assert.deepEqual(status.previewTarget.recovery, {
    canRestart: true,
    canStopStale: false,
    reason: "server_restart_state_lost",
    terminalSessionId: ""
  });
});

test("launch status clears stale launch metadata when the launch terminal is gone", async () => {
  const sessionId = "launch-restart-missing-terminal";
  const targetRoot = "/tmp/vibe64-launch-missing-terminal";
  const deletedMetadata = [];
  const published = [];
  const metadata = {
    launch_target_agent_href: "http://127.0.0.1:4100/app",
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
      sessionRoot: testSessionRoot(targetRoot, sessionId),
      targetRoot
    };
    const controller = createLaunchTargetTerminalController({
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
                return operation();
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

    const terminal = await controller.startTerminal(sessionId, testWorkflowInput({
      launchTargetId: "dev"
    }));
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

test("launch readiness marker publishes immediately without the recovery probe", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "launch-ready-stability";
    const namespace = launchTargetTerminalNamespace(sessionId);
    const readinessMarker = "[[VIBE64_LAUNCH_READY_V1:stable]]";
    const metadata = {};
    const published = [];
    const session = {
      metadata: {},
      sessionId,
      sessionRoot: testSessionRoot(targetRoot, sessionId),
      targetRoot
    };
    const controller = createLaunchTargetTerminalController({
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
                return operation();
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

    const terminal = await controller.startTerminal(sessionId, testWorkflowInput({
      launchTargetId: "dev"
    }));

    try {
      assert.equal(terminal.ok, true);
      await waitForCondition(
        () => metadata.launch_target_id === "dev",
        "Launch readiness metadata was not published after the readiness marker.",
        500
      );
      assert.equal(metadata.launch_target_id, "dev");
      assert.equal(metadata.launch_target_terminal_id, terminal.id);
      assert.equal(readTerminalSession(terminal.id, { namespace }).metadata.launchReady, true);
      assert.equal(readTerminalSession(terminal.id, { namespace }).metadata.launchReadySource, "marker");
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

test("launch start closes superseded terminals before replacing a non-reusable preview", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "launch-replace-session";
    const namespace = launchTargetTerminalNamespace(sessionId);
    const metadataWrites = [];
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
      sessionRoot: testSessionRoot(targetRoot, sessionId),
      targetRoot
    };
    const controller = createLaunchTargetTerminalController({
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
                return operation();
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
      }
    });

    let secondTerminal = null;
    try {
      const firstTerminal = await controller.startTerminal(sessionId, testWorkflowInput({
        launchInput: {
          variant: "first"
        },
        launchTargetId: "dev"
      }));
      assert.equal(firstTerminal.ok, true);
      assert.equal(countRunningTerminalSessions({ namespace }), 1);

      secondTerminal = await controller.startTerminal(sessionId, testWorkflowInput({
        launchInput: {
          variant: "second"
        },
        launchTargetId: "dev"
      }));

      assert.equal(secondTerminal.ok, true);
      assert.notEqual(secondTerminal.id, firstTerminal.id);
      assert.equal(countRunningTerminalSessions({ namespace }), 1);
      assert.equal(readTerminalSession(firstTerminal.id, { namespace }).ok, false);
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
    const session = {
      metadata: {},
      sessionId,
      sessionRoot: testSessionRoot(targetRoot, sessionId),
      targetRoot
    };
    const controller = createLaunchTargetTerminalController({
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
                return operation();
              },
              async writeMetadataValue() {}
            }
          };
        },
        async projectConfigEnvironment() {
          return {};
        }
      }
    });

    let firstTerminal = null;
    try {
      firstTerminal = await controller.startTerminal(sessionId, testWorkflowInput({
        launchInput: {
          variant: "same"
        },
        launchTargetId: "dev"
      }));
      const secondTerminal = await controller.startTerminal(sessionId, testWorkflowInput({
        launchInput: {
          variant: "same"
        },
        launchTargetId: "dev"
      }));

      assert.equal(firstTerminal.ok, true);
      assert.equal(secondTerminal.ok, true);
      assert.equal(secondTerminal.id, firstTerminal.id);
      assert.equal(countRunningTerminalSessions({ namespace }), 1);
    } finally {
      if (firstTerminal?.id) {
        await closeTerminalSession(firstTerminal.id, {
          namespace
        });
      }
    }
  });
});

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
  void root;
  return {};
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

test("Vibe64 Codex terminal args run through the host startup script", () => {
  const args = codexTerminalArgs({
    codexThreadId: "",
    codexRemoteEndpoint: "unix:///tmp/vibe64/codex-app-server/app-server.sock"
  });

  assert.deepEqual(args.slice(0, 1), [
    "-lc"
  ]);
  const startupScript = args[1];
  assert.match(startupScript, /umask 0007/u);
  assert.ok(startupScript.includes(STUDIO_MANAGED_CODEX_COMMAND));
  assert.ok(startupScript.includes(STUDIO_MANAGED_CODEX_NO_UPDATE_CONFIG));
  assert.ok(startupScript.includes("--remote"));
  assert.ok(startupScript.includes("unix:///tmp/vibe64/codex-app-server/app-server.sock"));
  assert.doesNotMatch(startupScript, /export PATH="\$VIBE64_CODEX_GIT_COMMAND_WRAPPER_DIR:\$PATH"/u);
  assert.doesNotMatch(args.join("\0"), /--network|toolchain/u);
});

test("Vibe64 Codex terminal exposes Git command wrapper as gateway shim dirs", () => {
  assert.deepEqual(codexGitCommandShimDirs({
    terminalProcessEnv: {
      VIBE64_CODEX_GIT_COMMAND_WRAPPER_DIR: "/tmp/vibe64-codex-wrapper"
    }
  }), [
    "/tmp/vibe64-codex-wrapper"
  ]);
  assert.deepEqual(codexGitCommandShimDirs({
    terminalEnv: {
      VIBE64_CODEX_GIT_COMMAND_WRAPPER_DIR: "/tmp/vibe64-terminal-wrapper"
    }
  }), [
    "/tmp/vibe64-terminal-wrapper"
  ]);
  assert.deepEqual(codexGitCommandShimDirs({
    terminalProcessEnv: {
      VIBE64_CODEX_GIT_COMMAND_WRAPPER_DIR: "relative-wrapper"
    }
  }), []);
});

test("Vibe64 global Codex terminal args use the project root without a session token", () => {
  const args = codexTerminalArgs({
    codexThreadId: ""
  });

  assert.notEqual(globalCodexTerminalNamespace(), codexTerminalNamespace("global"));
  assert.equal(args.some((arg) => String(arg).startsWith("vibe64.session=")), false);
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
    sessionId: "startup_prompt",
    targetRoot: "/workspace/project",
    terminalId: "startup-terminal",
    worktree: "/workspace/vibe64-local-editor/state/projects/project-test/sessions/active/startup_prompt/source"
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
  assert.doesNotMatch(startupScript, /export PATH="\$VIBE64_CODEX_GIT_COMMAND_WRAPPER_DIR:\$PATH"/u);

  const resumedArgs = codexTerminalArgs({
    codexThreadId: "00000000-0000-4000-8000-000000000001",
    sessionId: "startup_prompt",
    targetRoot: "/workspace/project",
    terminalId: "startup-terminal",
    worktree: "/workspace/vibe64-local-editor/state/projects/project-test/sessions/active/startup_prompt/source"
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
    sessionId: "startup_prompt",
    targetRoot: "/workspace/project",
    terminalId: "startup-terminal",
    worktree: "/workspace/vibe64-local-editor/state/projects/project-test/sessions/active/startup_prompt/source"
  });
  assert.match(
    customReasoningArgs.at(-1),
    /model_reasoning_effort="medium"/u
  );

  const remoteResumedArgs = codexTerminalArgs({
    codexRemoteEndpoint: "unix:///tmp/vibe64/agent-providers/codex-app-server/app-server.sock",
    codexThreadId: "00000000-0000-4000-8000-000000000001",
    sessionId: "startup_prompt",
    targetRoot: "/workspace/project",
    terminalId: "startup-terminal",
    worktree: "/workspace/vibe64-local-editor/state/projects/project-test/sessions/active/startup_prompt/source"
  });
  assert.match(
    remoteResumedArgs.at(-1),
    new RegExp(`${STUDIO_MANAGED_CODEX_COMMAND} -c ${STUDIO_MANAGED_CODEX_NO_UPDATE_CONFIG} --remote unix:\\/\\/\\/tmp\\/vibe64\\/agent-providers\\/codex-app-server\\/app-server\\.sock .*resume 00000000-0000-4000-8000-000000000001`, "u")
  );
  assert.doesNotMatch(remoteResumedArgs.join("\0"), /\/vibe64-codex-app-server/u);

  const invalidThreadArgs = codexTerminalArgs({
    codexThreadId: "not-a-thread-id",
    sessionId: "startup_prompt",
    targetRoot: "/workspace/project",
    terminalId: "startup-terminal",
    worktree: "/workspace/vibe64-local-editor/state/projects/project-test/sessions/active/startup_prompt/source"
  });
  assert.doesNotMatch(invalidThreadArgs.at(-1), /resume [0-9a-f-]{36}/u);
});

test("Vibe64 Codex terminal resumes the app-server thread for the same workdir", () => {
  const workdir = "/workspace/vibe64-local-editor/state/projects/project-test/sessions/active/session-1/source";
  const session = {
    metadata: {
      agent_identity_conversation_id: "00000000-0000-4000-8000-000000000005",
      agent_identity_provider: "codex",
      agent_identity_resume_strategy: "provider-native",
      agent_identity_status: "ready",
      agent_identity_workdir: workdir,
      agent_transport_endpoint: "unix:///tmp/vibe64/agent-providers/codex-app-server/app-server.sock",
    },
    sessionId: "session-1"
  };

  assert.equal(
    codexRemoteEndpointForWorkdir(session, workdir),
    "unix:///tmp/vibe64/agent-providers/codex-app-server/app-server.sock"
  );

  const args = codexTerminalArgs({
    codexRemoteEndpoint: codexRemoteEndpointForWorkdir(session, workdir),
    codexThreadId: session.metadata.agent_identity_conversation_id,
    sessionId: "session-1",
    targetRoot: "/workspace/project",
    terminalId: "terminal-1",
    worktree: workdir
  });
  assert.match(
    args.at(-1),
    new RegExp(`${STUDIO_MANAGED_CODEX_COMMAND} -c ${STUDIO_MANAGED_CODEX_NO_UPDATE_CONFIG} --remote unix:\\/\\/\\/tmp\\/vibe64\\/agent-providers\\/codex-app-server\\/app-server\\.sock .*resume 00000000-0000-4000-8000-000000000005`, "u")
  );

  assert.equal(
    codexRemoteEndpointForWorkdir(session, "/workspace/project/other"),
    ""
  );
});

test("Vibe64 Codex visible terminal uses the session Codex credential home", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "visible-terminal-real-home";
    const threadId = "00000000-0000-4000-8000-000000000015";
    const worktree = testSessionSourcePath(targetRoot, sessionId);
    const toolHomeSource = homedir();
    await mkdir(toolHomeSource, {
      recursive: true
    });
    const runtime = new Vibe64SessionRuntime({
      targetRoot
    });
    await runtime.createSession({
      initialStep: "source_created",
      metadata: {
        agent_workflow_result_transport: "dynamic_tool_v1",
        agent_identity_conversation_id: threadId,
        agent_identity_provider: "codex",
        agent_identity_resume_strategy: "provider-native",
        agent_identity_status: "ready",
        agent_identity_workdir: worktree,
        agent_transport_id: "codex_app_server",
        ...testSourceMetadataForPath(worktree)
      },
      sessionId
    });
    await mkdir(worktree, {
      recursive: true
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
              throw new Error("Stop before launching the visible terminal.");
            }
            return {
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
      }
    });

    const result = await controller.startTerminal(sessionId, {
      originId: "tab:test"
    });

    assert.equal(result.ok, false);
    assert.match(result.error, /Stop before launching the visible terminal/u);
    assert.equal(providerFactoryOptions.length, 1);
    assert.equal(providerFactoryOptions[0].toolHomeSource, toolHomeSource);
    assert.equal(ensureRuntimeCalls, 2);
  });
});

test("Vibe64 Codex visible terminal stays off until requested and its close kills the process", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "visible-terminal-explicit-lifecycle";
    const threadId = "00000000-0000-4000-8000-000000000218";
    const worktree = testSessionSourcePath(targetRoot, sessionId);
    const namespace = codexTerminalNamespace(sessionId);
    const runtime = new Vibe64SessionRuntime({
      targetRoot
    });
    await runtime.createSession({
      initialStep: "source_created",
      metadata: {
        agent_workflow_result_transport: "dynamic_tool_v1",
        agent_identity_conversation_id: threadId,
        agent_identity_provider: "codex",
        agent_identity_resume_strategy: "provider-native",
        agent_identity_status: "ready",
        agent_identity_workdir: worktree,
        agent_transport_id: "codex_app_server",
        ...testSourceMetadataForPath(worktree)
      },
      sessionId
    });
    await mkdir(worktree, {
      recursive: true
    });

    const appServerRuntime = {
      endpoint: `unix://${path.join(targetRoot, "app-server.sock")}`,
      runtimeDir: path.join(targetRoot, "app-server"),
      socketPath: path.join(targetRoot, "app-server.sock"),
      transport: "unix"
    };
    const terminalRequests = [];
    const controller = createCodexTerminalController({
      codexAuthPreflight: noopCodexAuthPreflight,
      codexAppServerPromptDeliveryEnabled: true,
      codexAppServerProviderFactory: () => ({
        connectionGeneration: 1,
        async ensureAvailable() {
          return true;
        },
        async ensureRuntime() {
          return appServerRuntime;
        },
        async readThreadStatus() {
          return {
            raw: {
              status: {
                type: "idle"
              }
            }
          };
        },
        async resumeThread(id) {
          return {
            id
          };
        },
        setServerRequestHandler() {
          return () => {};
        },
        subscribe() {
          return () => {};
        }
      }),
      codexToolHomeRequired: true,
      codexToolHomeSource: homedir(),
      projectService: {
        targetRoot,
        async createRuntime() {
          return runtime;
        },
        async projectConfigEnvironment() {
          return {};
        }
      },
      runCommand(request = {}) {
        terminalRequests.push(request);
        return startTerminalSession({
          args: [
            "-e",
            "process.stdin.resume(); setInterval(() => {}, 1000);"
          ],
          command: process.execPath,
          commandPreview: request.terminal.commandPreview,
          cwd: request.cwd,
          detachedIdleTimeoutMs: request.terminal.detachedIdleTimeoutMs,
          metadata: request.terminal.metadata,
          namespace: request.terminal.namespace,
          onClose: request.terminal.onClose,
          reuseRunning: request.terminal.reuseRunning
        });
      }
    });

    const idleState = await controller.terminalState(sessionId);

    assert.equal(idleState.ok, true);
    assert.equal(terminalRequests.length, 0);
    assert.equal(countRunningTerminalSessions({
      namespacePrefix: namespace
    }), 0);

    const started = await controller.startTerminal(sessionId, {
      originId: "tab:test"
    });

    assert.equal(started.ok, true, JSON.stringify(started, null, 2));
    assert.equal(terminalRequests.length, 1);
    assert.equal(terminalRequests[0].terminal.detachedIdleTimeoutMs, 5_000);
    assert.equal(countRunningTerminalSessions({
      namespacePrefix: namespace
    }), 1);

    const closed = await controller.closeTerminal(sessionId, started.id);

    assert.deepEqual(closed, {
      closed: true,
      ok: true
    });
    assert.equal(countRunningTerminalSessions({
      namespacePrefix: namespace
    }), 0);
  });
});

test("Vibe64 Codex visible terminal attaches to an active tracked turn without readiness recovery", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "visible-terminal-active-turn-attach";
    const threadId = "00000000-0000-4000-8000-000000000217";
    const turnId = "codex-visible-terminal-active-turn";
    const worktree = testSessionSourcePath(targetRoot, sessionId);
    const toolHomeSource = homedir();
    await mkdir(toolHomeSource, {
      recursive: true
    });
    const runtime = new Vibe64SessionRuntime({
      targetRoot
    });
    await runtime.createSession({
      initialStep: "maintenance_conversation",
      metadata: {
        agent_workflow_result_transport: "dynamic_tool_v1",
        agent_identity_conversation_id: threadId,
        agent_identity_provider: "codex",
        agent_identity_resume_strategy: "provider-native",
        agent_identity_status: "ready",
        agent_identity_workdir: worktree,
        agent_transport_id: "codex_app_server",
        ...testSourceMetadataForPath(worktree)
      },
      sessionId,
      workflowDefinition: MAINTENANCE_WORKFLOW_DEFINITION_IDS.NON_COMMIT_MAINTENANCE
    });
    await runtime.store.writeStepState(sessionId, "maintenance_conversation", {
      inputPrompt: "Waiting for Codex.",
      schemaVersion: 1,
      status: "awaiting_agent_result"
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

    const providerCalls = {
      ensureRuntime: 0,
      readThreadStatus: [],
      resumeThread: []
    };
    const controller = createCodexTerminalController({
      codexAuthPreflight: noopCodexAuthPreflight,
      codexAppServerPromptDeliveryEnabled: true,
      codexAppServerProviderFactory: () => ({
        async ensureAvailable() {
          return {
            ok: true
          };
        },
        async ensureRuntime() {
          providerCalls.ensureRuntime += 1;
          throw new Error("Stop before launching the visible terminal.");
        },
        async readThreadStatus(readThreadId) {
          providerCalls.readThreadStatus.push(readThreadId);
          return {
            raw: {
              status: {
                activeFlags: [],
                type: "active"
              }
            }
          };
        },
        async resumeThread(resumedThreadId) {
          providerCalls.resumeThread.push(resumedThreadId);
          return {
            id: resumedThreadId
          };
        },
        subscribe() {
          return () => {};
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

    const result = await controller.startTerminal(sessionId, {
      originId: "tab:test"
    });
    const session = await runtime.getSession(sessionId);
    const run = codexAppServerAgentRunSnapshot(session);

    assert.equal(result.ok, false);
    assert.match(result.error, /Stop before launching the visible terminal/u);
    assert.equal(providerCalls.ensureRuntime, 1);
    assert.deepEqual(providerCalls.resumeThread, []);
    assert.deepEqual(providerCalls.readThreadStatus, []);
    assert.equal(run.active, true);
    assert.equal(run.state, "active");
    assert.equal(run.providerStatus, "inProgress");
    assert.equal(run.providerThreadId, threadId);
    assert.equal(run.providerTurnId, turnId);
    assert.equal(session.stepMachine?.status, "awaiting_agent_result");
  });
});

test("Vibe64 Codex visible terminal returns reconnect-required when Codex auth is rejected", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "visible-terminal-codex-reconnect";
    const threadId = "00000000-0000-4000-8000-000000000216";
    const systemRoot = path.join(targetRoot, "system");
    const worktree = testSessionSourcePath(targetRoot, sessionId);
    const toolHomeSource = homedir();

    const runtime = new Vibe64SessionRuntime({
      targetRoot
    });
    await runtime.createSession({
      initialStep: "source_created",
      metadata: {
        agent_identity_conversation_id: threadId,
        agent_identity_provider: "codex",
        agent_identity_resume_strategy: "provider-native",
        agent_identity_status: "ready",
        agent_identity_workdir: worktree,
        agent_transport_id: "codex_app_server",
        ...testSourceMetadataForPath(worktree)
      },
      sessionId
    });
    await mkdir(worktree, {
      recursive: true
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
      codexAppServerProviderOptions: {
        systemRoot
      },
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

    const result = await controller.startTerminal(sessionId, {
      originId: "tab:test"
    });

    assert.equal(result.ok, false);
    assert.equal(result.code, CODEX_RECONNECT_REQUIRED_CODE, JSON.stringify(result, null, 2));
    assert.equal(result.error, CODEX_RECONNECT_REQUIRED_MESSAGE);
    assert.equal(result.errors[0].code, CODEX_RECONNECT_REQUIRED_CODE);

    const authStatus = await readCodexAuthStatus(systemRoot);
    assert.equal(authStatus.status, "reconnect_required");
    assert.equal(authStatus.code, CODEX_RECONNECT_REQUIRED_CODE);
    assert.equal(authStatus.reason, "codex-app-server-thread-ready");
  });
});

test("Vibe64 terminal service passes captured provider env to Codex app-server providers", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "captured-provider-env-session";
    const threadId = "00000000-0000-4000-8000-000000000116";
    const worktree = testSessionSourcePath(targetRoot, sessionId);
    const codexToolHomeSource = homedir();
    const systemRoot = path.join(targetRoot, "system-root");

    const attachmentRoot = path.join(targetRoot, "online-state", "attachments");
    const previousAttachmentRoot = process.env[VIBE64_CODEX_ATTACHMENTS_ROOT_ENV];
    const previousRuntimeNamespace = process.env[VIBE64_RUNTIME_NAMESPACE_ENV];
    process.env[VIBE64_RUNTIME_NAMESPACE_ENV] = VIBE64_LOCAL_RUNTIME_NAMESPACE;
    const runtime = new Vibe64SessionRuntime({
      targetRoot
    });
    await runtime.createSession({
      initialStep: "source_created",
      metadata: {
        ...testSourceMetadataForPath(worktree)
      },
      sessionId
    });
    await mkdir(worktree, {
      recursive: true
    });

    const providerFactoryOptions = [];
    const providerCalls = {
      stopRuntime: 0
    };
    try {
      process.env[VIBE64_CODEX_ATTACHMENTS_ROOT_ENV] = attachmentRoot;
      const terminalService = createTestTerminalService({
        env: {
          [VIBE64_SYSTEM_ROOT_ENV]: systemRoot
        },
        codexTerminalController: {
          codexAppServerProviderFactory(options = {}) {
            providerFactoryOptions.push(options);
            return {
              async ensureRuntime() {
                return {
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

      const ensureResult = await terminalService.ensureAgentSession(sessionId);

      assert.equal(ensureResult.ok, true, ensureResult.error || "Codex thread should be ready.");
      assert.equal(providerFactoryOptions.length, 1);
      assert.equal(
        Object.keys(providerFactoryOptions[0].env).some((key) => /HOMES_ROOT/u.test(key)),
        false
      );
      assert.equal(
        providerFactoryOptions[0].env[VIBE64_CODEX_ATTACHMENTS_ROOT_ENV],
        attachmentRoot
      );
      assert.equal(providerFactoryOptions[0].terminalEnv.VIBE64_CODEX_GIT_COMMAND_SESSION_ID, sessionId);
      assert.match(providerFactoryOptions[0].terminalEnv.VIBE64_CODEX_GIT_COMMAND_SOCKET, /command\.sock$/u);
      assert.match(providerFactoryOptions[0].terminalEnv.VIBE64_CODEX_GIT_COMMAND_TOKEN, /^[a-f0-9]{16}$/u);
      assert.ok(providerFactoryOptions[0].terminalEnv.VIBE64_CODEX_GIT_COMMAND_WRAPPER_DIR.startsWith(`${attachmentRoot}/`));
      assert.equal(providerFactoryOptions[0].terminalEnv[VIBE64_AGENT_PREVIEW_COMMAND_SESSION_ID_ENV], sessionId);
      assert.match(providerFactoryOptions[0].terminalEnv[VIBE64_AGENT_PREVIEW_COMMAND_SOCKET_ENV], /preview-command\.sock$/u);
      assert.match(providerFactoryOptions[0].terminalEnv[VIBE64_AGENT_PREVIEW_COMMAND_TOKEN_ENV], /^[a-f0-9]{16}$/u);
      assert.equal(providerFactoryOptions[0].toolHomeSource, codexToolHomeSource);
      assert.equal(providerFactoryOptions[0].systemRoot, systemRoot);
      assert.equal(providerFactoryOptions[0].env.HOME, codexToolHomeSource);
      assert.equal(providerFactoryOptions[0].env[VIBE64_SYSTEM_ROOT_ENV], systemRoot);

      const wrapperHostDir = providerFactoryOptions[0].terminalEnv.VIBE64_CODEX_GIT_COMMAND_WRAPPER_DIR;
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
      const worktree = testSessionSourcePath(targetRoot, session.sessionId);
      await runtime.createSession({
        initialStep: "source_created",
        metadata: {
          ...testSourceMetadataForPath(worktree)
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
        }
      },
      projectService: {
        targetRoot,
        async projectConfigEnvironment() {
          return {};
        },
        async projectRuntimeConfigEnvironment() {
          return {
            DB_CLIENT: "mysql2",
            DB_HOST: JSKIT_MARIADB_HOST,
            DB_NAME: "captured_provider_env",
            DB_PASSWORD: UNIT_DATABASE_PASSWORD,
            DB_PORT: jskitMariaDbHostPort(),
            DB_USER: "vibe64_dev_app"
          };
        },
        async createRuntime() {
          return runtime;
        }
      }
    });

    const reconcileResult = await terminalService.reconcileAgentSessions(sessions);

    assert.equal(reconcileResult.ok, true, JSON.stringify(reconcileResult));
    assert.equal(reconcileResult.sessionCount, 2);
    assert.equal(providerCalls.startThread.length, 2);
    assert.equal(providerCalls.sendTurn.length, 0);
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
    const worktree = testSessionSourcePath(targetRoot, sessionId);
    const runtime = new Vibe64SessionRuntime({
      targetRoot
    });
    await runtime.createSession({
      initialStep: "source_created",
      metadata: {
        agent_identity_conversation_id: threadId,
        agent_identity_provider: "codex",
        agent_identity_resume_strategy: "provider-native",
        agent_identity_status: "ready",
        agent_identity_workdir: worktree,
        agent_transport_id: "codex_app_server",
        agent_transport_runtime_dir: path.join(targetRoot, ".vibe64", "runtime", "agent-providers", "codex-app-server"),
        ...testSourceMetadataForPath(worktree)
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

test("Vibe64 Codex app-server close removes persisted runtime metadata without provider cache", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "persisted-runtime-close-session";
    const threadId = "00000000-0000-4000-8000-000000000123";
    const worktree = testSessionSourcePath(targetRoot, sessionId);
    const runtimeDir = path.join(targetRoot, ".vibe64", "runtime", "agent-providers", "codex-app-server-test");
    const runtime = new Vibe64SessionRuntime({
      targetRoot
    });
    await mkdir(runtimeDir, {
      recursive: true
    });
    await writeFile(path.join(runtimeDir, "runtime.json"), `${JSON.stringify({
      endpoint: `unix://${path.join(runtimeDir, "app-server.sock")}`,
      pid: -1,
      runtimeDir
    }, null, 2)}\n`);
    await runtime.createSession({
      initialStep: "source_created",
      metadata: {
        agent_identity_conversation_id: threadId,
        agent_identity_provider: "codex",
        agent_identity_resume_strategy: "provider-native",
        agent_identity_status: "ready",
        agent_identity_workdir: worktree,
        agent_transport_id: "codex_app_server",
        agent_transport_runtime_dir: runtimeDir,
        ...testSourceMetadataForPath(worktree)
      },
      sessionId
    });
    await mkdir(worktree, {
      recursive: true
    });

    const providerCalls = {
      factory: 0
    };
    const terminalService = createTestTerminalService({
      codexTerminalController: {
        codexAppServerProviderFactory() {
          providerCalls.factory += 1;
          return {};
        },
        codexAppServerProviderOptions: {
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

    await stat(runtimeDir);
    await terminalService.closeSessionTerminals(sessionId);

    assert.equal(providerCalls.factory, 0);
    await assert.rejects(stat(runtimeDir), {
      code: "ENOENT"
    });
  });
});

test("Vibe64 Codex app-server close tolerates stale metadata without a live provider", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "close-only-provider-session";
    const threadId = "00000000-0000-4000-8000-000000000122";
    const worktree = testSessionSourcePath(targetRoot, sessionId);
    const runtime = new Vibe64SessionRuntime({
      targetRoot
    });
    await runtime.createSession({
      initialStep: "source_created",
      metadata: {
        agent_identity_conversation_id: threadId,
        agent_identity_provider: "codex",
        agent_identity_resume_strategy: "provider-native",
        agent_identity_status: "ready",
        agent_identity_workdir: worktree,
        agent_transport_id: "codex_app_server",
        agent_transport_runtime_dir: path.join(targetRoot, ".vibe64", "runtime", "agent-providers", "codex-app-server"),
        ...testSourceMetadataForPath(worktree)
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
      const worktree = testSessionSourcePath(targetRoot, session.sessionId);
      await runtime.createSession({
        initialStep: "source_created",
        metadata: {
          agent_identity_conversation_id: session.threadId,
          agent_identity_provider: "codex",
          agent_identity_resume_strategy: "provider-native",
          agent_identity_status: "ready",
          agent_identity_workdir: worktree,
          agent_transport_id: "codex_app_server",
          agent_transport_runtime_dir: path.join(targetRoot, ".vibe64", "runtime", "agent-providers", "codex-app-server"),
          ...testSourceMetadataForPath(worktree)
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

    const firstResult = await terminalService.reconcileAgentSessions([]);
    const secondResult = await terminalService.reconcileAgentSessions([]);

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
    const worktree = testSessionSourcePath(targetRoot, sessionId);
    const runtime = new Vibe64SessionRuntime({
      targetRoot
    });
    await runtime.createSession({
      initialStep: "source_created",
      metadata: {
        agent_identity_conversation_id: threadId,
        agent_identity_provider: "codex",
        agent_identity_resume_strategy: "provider-native",
        agent_identity_status: "ready",
        agent_identity_workdir: worktree,
        agent_transport_id: "codex_app_server",
        ...testSourceMetadataForPath(worktree)
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
        }
      },
      projectService: {
        targetRoot,
        async createRuntime() {
          return runtime;
        }
      }
    });

    const result = await terminalService.reconcileAgentSessions([{ sessionId }]);

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

    const secondResult = await terminalService.reconcileAgentSessions([{ sessionId }]);

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
    const worktree = testSessionSourcePath(targetRoot, sessionId);
    const runtime = new Vibe64SessionRuntime({
      targetRoot
    });
    await runtime.createSession({
      initialStep: "source_created",
      metadata: {
        agent_identity_conversation_id: threadId,
        agent_identity_provider: "codex",
        agent_identity_resume_strategy: "provider-native",
        agent_identity_status: "ready",
        agent_identity_workdir: worktree,
        agent_transport_id: "codex_app_server",
        ...testSourceMetadataForPath(worktree)
      },
      sessionId
    });
    await mkdir(worktree, {
      recursive: true
    });

    const providerCalls = {
      listLoadedThreads: 0,
      readThreadStatus: 0,
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
            async readThreadStatus() {
              providerCalls.readThreadStatus += 1;
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
        }
      },
      projectService: {
        targetRoot,
        async createRuntime() {
          return runtime;
        }
      }
    });

    const result = await terminalService.reconcileAgentSessions([{ sessionId }]);
    const secondResult = await terminalService.reconcileAgentSessions([{ sessionId }]);
    connectionGeneration += 1;
    threadStatus = "active";
    threadTurnId = "terminal-turn-after-reconnect";
    const thirdResult = await terminalService.reconcileAgentSessions([{ sessionId }]);
    const session = await runtime.getSession(sessionId);

    assert.equal(result.ok, true);
    assert.equal(result.results[0].status, "loaded");
    assert.equal(secondResult.ok, true);
    assert.equal(secondResult.results[0].status, "alreadySubscribed");
    assert.equal(thirdResult.ok, true);
    assert.equal(thirdResult.results[0].status, "resubscribed");
    assert.equal(providerCalls.listLoadedThreads, 3);
    assert.equal(providerCalls.readThreadStatus, 3);
    assert.equal(providerCalls.subscribe, 2);
    assert.equal(providerCalls.unsubscribe, 1);
    assert.equal(codexAppServerAgentRunSnapshot(session).state, "active");
    assert.equal(codexAppServerAgentRunSnapshot(session).providerStatus, "inProgress");
    assert.equal(codexAppServerAgentRunSnapshot(session).providerThreadId, threadId);
    assert.equal(codexAppServerAgentRunSnapshot(session).providerTurnId, threadTurnId);
  });
});

test("Vibe64 Codex app-server reconnect preserves workflow ownership when the provider echo omits its client id", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "workflow-prompt-echo-after-restart";
    const threadId = "00000000-0000-4000-8000-000000000128";
    const turnId = "workflow-turn-after-restart";
    const clientId = "composer:unit:workflow-after-restart";
    const worktree = testSessionSourcePath(targetRoot, sessionId);
    const internalPrompt = [
      "User/request input:",
      "Keep the user's real message visible.",
      "",
      "Vibe64 workflow context:",
      "- action: Discuss seed choices",
      "- hidden workflow instructions must never become a user message"
    ].join("\n");
    const runtime = new Vibe64SessionRuntime({
      targetRoot
    });
    await runtime.createSession({
      initialStep: "maintenance_conversation",
      metadata: {
        agent_workflow_result_transport: "dynamic_tool_v1",
        agent_identity_conversation_id: threadId,
        agent_identity_provider: "codex",
        agent_identity_resume_strategy: "provider-native",
        agent_identity_status: "ready",
        agent_identity_workdir: worktree,
        agent_transport_id: "codex_app_server",
        ...testSourceMetadataForPath(worktree)
      },
      sessionId,
      workflowDefinition: MAINTENANCE_WORKFLOW_DEFINITION_IDS.NON_COMMIT_MAINTENANCE
    });
    await runtime.store.writeStepState(sessionId, "maintenance_conversation", {
      inputPrompt: "Waiting for Codex.",
      schemaVersion: 1,
      status: "awaiting_agent_result"
    });
    await runtime.store.writeConversationUserMessage(sessionId, {
      text: "Keep the user's real message visible."
    });
    await runtime.store.writeAgentRunEvent(sessionId, CODEX_APP_SERVER_AGENT_RUN_ID, {
      event: {
        kind: "codex-prompt-delivery-abandoned",
        message: "Codex app-server prompt delivery ended before a provider turn was created.",
        state: VIBE64_AGENT_RUN_STATE.FAILED
      },
      patch: {
        error: "Codex app-server prompt delivery ended before a provider turn was created.",
        handoffId: "000001-maintenance_conversation.json:agent_conversation",
        inputSource: "workflow",
        pendingUserMessageClientIds: [clientId],
        provider: "codex",
        providerInterface: "app-server",
        providerStatus: "delivery_failed",
        providerThreadId: "",
        providerTurnId: "",
        state: VIBE64_AGENT_RUN_STATE.FAILED,
        stepId: "maintenance_conversation",
        stepStatus: "awaiting_agent_result"
      }
    });
    await mkdir(worktree, {
      recursive: true
    });

    let providerSubscriber = null;
    const terminalService = createTestTerminalService({
      codexTerminalController: {
        codexAppServerProviderFactory() {
          return {
            async ensureAvailable() {
              return {
                ok: true
              };
            },
            async listLoadedThreads() {
              return {
                data: [threadId],
                nextCursor: null
              };
            },
            async readThreadStatus() {
              return {
                raw: {
                  activeTurnId: turnId,
                  status: "active"
                }
              };
            },
            subscribe(callback) {
              providerSubscriber = callback;
              return () => {
                if (providerSubscriber === callback) {
                  providerSubscriber = null;
                }
              };
            }
          };
        },
        codexAppServerProviderOptions: {
        }
      },
      projectService: {
        targetRoot,
        async createRuntime() {
          return runtime;
        }
      }
    });

    const result = await terminalService.reconcileAgentSessions([{ sessionId }]);
    let session = await runtime.getSession(sessionId);
    let run = codexAppServerAgentRunSnapshot(session);

    assert.equal(result.ok, true);
    assert.equal(typeof providerSubscriber, "function");
    assert.equal(run.state, VIBE64_AGENT_RUN_STATE.ACTIVE);
    assert.equal(run.inputSource, "workflow");
    assert.equal(run.providerThreadId, threadId);
    assert.equal(run.providerTurnId, turnId);
    assert.deepEqual(run.pendingUserMessageClientIds, [clientId]);

    providerSubscriber({
      method: "item/completed",
      params: {
        item: {
          content: [{
            text: internalPrompt,
            type: "text"
          }],
          id: "workflow-prompt-echo-without-client-id",
          type: "userMessage"
        },
        threadId,
        turnId
      }
    });
    await waitForCondition(async () => {
      const currentSession = await runtime.getSession(sessionId);
      return codexAppServerAgentRunSnapshot(currentSession)?.pendingUserMessageClientIds?.length === 0;
    }, "The owned workflow prompt echo was not consumed after reconnect.");

    session = await runtime.getSession(sessionId);
    run = codexAppServerAgentRunSnapshot(session);
    const conversationLog = await runtime.store.readConversationLog(sessionId);
    assert.equal(run.state, VIBE64_AGENT_RUN_STATE.ACTIVE);
    assert.equal(run.inputSource, "workflow");
    assert.equal(run.providerThreadId, threadId);
    assert.equal(run.providerTurnId, turnId);
    assert.equal(
      run.events.some((event) => (
        event.kind === "codex-app-server-user-message-consumed" &&
        event.clientId === clientId
      )),
      true
    );
    assert.deepEqual(
      conversationLog
        .map((turn) => turn.user?.text)
        .filter(Boolean),
      ["Keep the user's real message visible."]
    );
    assert.equal(
      conversationLog.some((turn) => turn.user?.text === internalPrompt),
      false
    );

    const secondClientId = "composer:unit:workflow-echo-before-turn-started";
    const secondTurnId = "workflow-turn-with-user-echo-first";
    await runtime.store.writeConversationUserMessage(sessionId, {
      text: "Preserve this second real message too."
    });
    await runtime.store.writeAgentRunEvent(sessionId, CODEX_APP_SERVER_AGENT_RUN_ID, {
      event: {
        kind: "codex-prompt-delivery-abandoned",
        message: "Simulated restart before turn/started was replayed.",
        state: VIBE64_AGENT_RUN_STATE.FAILED
      },
      patch: {
        error: "Simulated restart before turn/started was replayed.",
        inputSource: "workflow",
        pendingUserMessageClientIds: [secondClientId],
        providerStatus: "delivery_failed",
        providerThreadId: "",
        providerTurnId: "",
        state: VIBE64_AGENT_RUN_STATE.FAILED
      }
    });
    providerSubscriber({
      method: "item/completed",
      params: {
        item: {
          content: [{
            text: internalPrompt,
            type: "text"
          }],
          id: "workflow-prompt-echo-before-turn-started",
          type: "userMessage"
        },
        threadId,
        turnId: secondTurnId
      }
    });
    await waitForCondition(async () => {
      const currentSession = await runtime.getSession(sessionId);
      const currentRun = codexAppServerAgentRunSnapshot(currentSession);
      return currentRun?.state === VIBE64_AGENT_RUN_STATE.ACTIVE &&
        currentRun?.providerTurnId === secondTurnId &&
        currentRun?.pendingUserMessageClientIds?.length === 0;
    }, "The owned prompt echo did not recover the workflow turn when it arrived before turn/started.");

    session = await runtime.getSession(sessionId);
    run = codexAppServerAgentRunSnapshot(session);
    const recoveredConversationLog = await runtime.store.readConversationLog(sessionId);
    assert.equal(run.inputSource, "workflow");
    assert.equal(run.providerThreadId, threadId);
    assert.deepEqual(
      recoveredConversationLog
        .map((turn) => turn.user?.text)
        .filter(Boolean),
      [
        "Keep the user's real message visible.",
        "Preserve this second real message too."
      ]
    );
    assert.equal(
      recoveredConversationLog.some((turn) => turn.user?.text === internalPrompt),
      false
    );
  });
});

test("Vibe64 Codex app-server readiness returns control for an unrecoverable tracked turn", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "ready-reconciles-replaced-turn";
    const threadId = "00000000-0000-4000-8000-000000000124";
    const replacementThreadId = "00000000-0000-4000-8000-000000000125";
    const turnId = "codex-turn-before-restart";
    const worktree = testSessionSourcePath(targetRoot, sessionId);
    const runtime = new Vibe64SessionRuntime({
      targetRoot
    });
    await runtime.createSession({
      initialStep: "maintenance_conversation",
      metadata: {
        agent_workflow_result_transport: "dynamic_tool_v1",
        agent_identity_conversation_id: threadId,
        agent_identity_provider: "codex",
        agent_identity_resume_strategy: "provider-native",
        agent_identity_status: "ready",
        agent_identity_workdir: worktree,
        agent_transport_id: "codex_app_server",
        ...testSourceMetadataForPath(worktree)
      },
      sessionId,
      workflowDefinition: MAINTENANCE_WORKFLOW_DEFINITION_IDS.NON_COMMIT_MAINTENANCE
    });
    await runtime.store.writeStepState(sessionId, "maintenance_conversation", {
      inputPrompt: "Waiting for Codex.",
      schemaVersion: 1,
      status: "awaiting_agent_result"
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

    const providerCalls = {
      readThreadStatus: 0,
      resumeThread: [],
      sendTurn: [],
      startThread: 0
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
              return {
                data: [],
                nextCursor: null
              };
            },
            async readThreadStatus() {
              providerCalls.readThreadStatus += 1;
              throw new Error("replaced tracked turn should fail before reading the replacement thread");
            },
            async resumeThread(resumedThreadId) {
              providerCalls.resumeThread.push(resumedThreadId);
              throw Object.assign(new Error("invalid request"), {
                code: -32600,
                method: "thread/resume"
              });
            },
            async readThread(readThreadId) {
              assert.equal(readThreadId, threadId);
              throw Object.assign(new Error("invalid request"), {
                code: -32600,
                method: "thread/read"
              });
            },
            async sendTurn(sentThreadId, input) {
              providerCalls.sendTurn.push({
                input,
                threadId: sentThreadId
              });
              return {
                id: "bootstrap-turn",
                status: "completed"
              };
            },
            async startThread() {
              providerCalls.startThread += 1;
              return {
                id: replacementThreadId
              };
            },
            subscribe() {
              return () => null;
            }
          };
        },
        codexAppServerProviderOptions: {
        }
      },
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

    const result = await terminalService.reconcileAgentSessions([{ sessionId }]);
    const session = await runtime.getSession(sessionId);
    const run = codexAppServerAgentRunSnapshot(session);

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(providerCalls.resumeThread, [threadId]);
    assert.equal(providerCalls.startThread, 1);
    assert.equal(providerCalls.sendTurn.length, 1);
    assert.match(providerCalls.sendTurn[0].input, /VIBE64_CONTEXT_RECOVERY/u);
    assert.equal(providerCalls.readThreadStatus, 0);
    assert.equal(session.metadata.agent_identity_conversation_id, replacementThreadId);
    assert.equal(run.active, false);
    assert.equal(run.state, "failed");
    assert.equal(run.providerStatus, "failed");
    assert.equal(run.providerThreadId, threadId);
    assert.equal(run.providerTurnId, turnId);
    assert.match(run.error, /resumed a different thread/u);
    assert.equal(session.stepMachine?.status, "waiting_for_input");
    assert.match(session.stepMachine?.message || "", /Retry the step/u);
  });
});

test("Vibe64 Codex app-server readiness keeps a confirmed active tracked turn", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "ready-confirms-active-turn";
    const threadId = "00000000-0000-4000-8000-000000000127";
    const turnId = "codex-turn-after-restart";
    const worktree = testSessionSourcePath(targetRoot, sessionId);
    const runtime = new Vibe64SessionRuntime({
      targetRoot
    });
    await runtime.createSession({
      initialStep: "maintenance_conversation",
      metadata: {
        agent_workflow_result_transport: "dynamic_tool_v1",
        agent_identity_conversation_id: threadId,
        agent_identity_provider: "codex",
        agent_identity_resume_strategy: "provider-native",
        agent_identity_status: "ready",
        agent_identity_workdir: worktree,
        agent_transport_id: "codex_app_server",
        ...testSourceMetadataForPath(worktree)
      },
      sessionId,
      workflowDefinition: MAINTENANCE_WORKFLOW_DEFINITION_IDS.NON_COMMIT_MAINTENANCE
    });
    await runtime.store.writeStepState(sessionId, "maintenance_conversation", {
      inputPrompt: "Waiting for Codex.",
      schemaVersion: 1,
      status: "awaiting_agent_result"
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

    const providerCalls = {
      readThreadStatus: [],
      resumeThread: []
    };
    const terminalService = createTestTerminalService({
      codexTerminalController: {
        codexAppServerActiveReconcileMs: 60_000,
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
              return {
                data: [],
                nextCursor: null
              };
            },
            async readThreadStatus(readThreadId) {
              providerCalls.readThreadStatus.push(readThreadId);
              return {
                raw: {
                  activeTurnId: turnId,
                  status: "active"
                }
              };
            },
            async resumeThread(resumedThreadId) {
              providerCalls.resumeThread.push(resumedThreadId);
              return {
                id: resumedThreadId
              };
            },
            async startThread() {
              throw new Error("confirmed active turn should resume the existing thread");
            },
            subscribe() {
              return () => null;
            }
          };
        },
        codexAppServerProviderOptions: {
        }
      },
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

    const result = await terminalService.reconcileAgentSessions([{ sessionId }]);
    const session = await runtime.getSession(sessionId);
    const run = codexAppServerAgentRunSnapshot(session);

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(providerCalls.resumeThread, [threadId]);
    assert.deepEqual(providerCalls.readThreadStatus, [threadId]);
    assert.equal(run.active, true);
    assert.equal(run.state, "active");
    assert.equal(run.providerStatus, "inProgress");
    assert.equal(run.providerThreadId, threadId);
    assert.equal(run.providerTurnId, turnId);
    assert.equal(session.stepMachine?.status, "awaiting_agent_result");
  });
});

test("Vibe64 Codex app-server readiness keeps an active tracked turn when provider omits the active turn id", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "ready-keeps-active-turn-without-provider-turn-id";
    const threadId = "00000000-0000-4000-8000-000000000128";
    const turnId = "codex-turn-still-running";
    const worktree = testSessionSourcePath(targetRoot, sessionId);
    const runtime = new Vibe64SessionRuntime({
      targetRoot
    });
    await runtime.createSession({
      initialStep: "maintenance_conversation",
      metadata: {
        agent_workflow_result_transport: "dynamic_tool_v1",
        agent_identity_conversation_id: threadId,
        agent_identity_provider: "codex",
        agent_identity_resume_strategy: "provider-native",
        agent_identity_status: "ready",
        agent_identity_workdir: worktree,
        agent_transport_id: "codex_app_server",
        ...testSourceMetadataForPath(worktree)
      },
      sessionId,
      workflowDefinition: MAINTENANCE_WORKFLOW_DEFINITION_IDS.NON_COMMIT_MAINTENANCE
    });
    await runtime.store.writeStepState(sessionId, "maintenance_conversation", {
      inputPrompt: "Waiting for Codex.",
      schemaVersion: 1,
      status: "awaiting_agent_result"
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

    const providerCalls = {
      readThreadStatus: [],
      resumeThread: []
    };
    const terminalService = createTestTerminalService({
      codexTerminalController: {
        codexAppServerActiveReconcileMs: 60_000,
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
              return {
                data: [],
                nextCursor: null
              };
            },
            async readThreadStatus(readThreadId) {
              providerCalls.readThreadStatus.push(readThreadId);
              return {
                raw: {
                  status: {
                    activeFlags: [],
                    type: "active"
                  },
                  turns: []
                }
              };
            },
            async resumeThread(resumedThreadId) {
              providerCalls.resumeThread.push(resumedThreadId);
              return {
                id: resumedThreadId
              };
            },
            async startThread() {
              throw new Error("active tracked turn should not start a replacement thread");
            },
            subscribe() {
              return () => null;
            }
          };
        },
        codexAppServerProviderOptions: {
        }
      },
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

    const result = await terminalService.reconcileAgentSessions([{ sessionId }]);
    const session = await runtime.getSession(sessionId);
    const run = codexAppServerAgentRunSnapshot(session);

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(providerCalls.resumeThread, [threadId]);
    assert.deepEqual(providerCalls.readThreadStatus, [threadId]);
    assert.equal(run.active, true);
    assert.equal(run.state, "active");
    assert.equal(run.providerStatus, "inProgress");
    assert.equal(run.providerThreadId, threadId);
    assert.equal(run.providerTurnId, turnId);
    assert.equal(run.error, "");
    assert.equal(session.stepMachine?.status, "awaiting_agent_result");
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
    const worktreeA = testSessionSourcePath(projectA, sessionId);
    const worktreeB = testSessionSourcePath(projectB, sessionId);
    await runtimeA.createSession({
      initialStep: "source_created",
      metadata: {
        ...testSourceMetadataForPath(worktreeA)
      },
      sessionId
    });
    await runtimeB.createSession({
      initialStep: "source_created",
      metadata: {
        ...testSourceMetadataForPath(worktreeB)
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
    function stateForTarget(targetRootValue) {
      const key = targetRootValue === worktreeA ? "a" : "b";
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
    function threadIdForTarget(targetRootValue) {
      return targetRootValue === worktreeA
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
      const result = await terminalService.reconcileAgentSessions([{ sessionId }]);
      assert.equal(result.ok, true);
    });
    assert.equal(stateForTarget(worktreeA).activeSubscriptions, 1);
    assert.equal(stateForTarget(worktreeB).activeSubscriptions, 0);

    await runWithProjectRequestContext({
      slug: "project-b",
      targetRoot: projectB
    }, async () => {
      activeTargetRoot = projectB;
      activeRuntime = runtimeB;
      const result = await terminalService.reconcileAgentSessions([{ sessionId }]);
      assert.equal(result.ok, true);
    });

    assert.equal(stateForTarget(worktreeA).activeSubscriptions, 0);
    assert.equal(stateForTarget(worktreeA).close, 1);
    assert.equal(stateForTarget(worktreeB).activeSubscriptions, 1);
    assert.equal(stateForTarget(worktreeB).close, 0);
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
    const worktreeA = testSessionSourcePath(projectA, sessionId);
    const worktreeB = testSessionSourcePath(projectB, sessionId);
    const threadA = "00000000-0000-4000-8000-000000000301";
    const threadB = "00000000-0000-4000-8000-000000000302";
    await runtimeA.createSession({
      initialStep: "source_created",
      metadata: {
        agent_identity_conversation_id: threadA,
        agent_identity_provider: "codex",
        agent_identity_resume_strategy: "provider-native",
        agent_identity_status: "ready",
        agent_identity_workdir: worktreeA,
        agent_transport_id: "codex_app_server",
        ...testSourceMetadataForPath(worktreeA)
      },
      sessionId
    });
    await runtimeB.createSession({
      initialStep: "source_created",
      metadata: {
        ...testSourceMetadataForPath(worktreeB)
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
    function stateForTarget(targetRootValue) {
      const key = targetRootValue === worktreeA ? "a" : "b";
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
          const threadId = options.targetRoot === worktreeA ? threadA : threadB;
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
              if (options.targetRoot === worktreeA) {
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
      return terminalService.reconcileAgentSessions([{ sessionId }]);
    });

    await projectAListLoadedThreadsReady;

    const projectBReconcile = runWithProjectRequestContext({
      slug: "project-b",
      targetRoot: projectB
    }, async () => {
      activeTargetRoot = projectB;
      activeRuntime = runtimeB;
      return terminalService.reconcileAgentSessions([{ sessionId }]);
    });

    await delay(25);
    assert.equal(stateForTarget(worktreeA).close, 0);

    allowProjectAListLoadedThreads();
    const [resultA, resultB] = await Promise.all([
      projectAReconcile,
      projectBReconcile
    ]);

    assert.equal(resultA.ok, true);
    assert.equal(resultB.ok, true);
    assert.equal(stateForTarget(worktreeA).close, 1);
    assert.equal(stateForTarget(worktreeB).close, 0);
    assert.equal(stateForTarget(worktreeA).unsubscribe, 1);
  });
});

test("Vibe64 Codex terminal uses host paths for linked git metadata", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const linkedRepository = path.join(path.dirname(targetRoot), "linked-repository");
    await mkdir(path.join(linkedRepository, ".git"), {
      recursive: true
    });
    await writeFile(path.join(targetRoot, ".git"), `gitdir: ${path.join(linkedRepository, ".git")}\n`);

    const args = codexTerminalArgs({
      codexThreadId: "",
      sessionId: "unit-session",
      targetRoot,
      terminalId: "unit-terminal",
      worktree: testSessionSourcePath(targetRoot, "unit")
    });

    assert.equal(args.some((arg) => String(arg).includes(`${linkedRepository}:${linkedRepository}`)), false);
    assert.match(args.at(-1), /codex/u);
  });
});

test("Vibe64 Codex terminal state uses durable app-server agent run state", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "codex_turn_state";
    const sessionRoot = testSessionRoot(targetRoot, sessionId);
    const worktree = testSessionSourcePath(targetRoot, sessionId);
    await mkdir(worktree, {
      recursive: true
    });
    const session = {
      completedSteps: ["source_created"],
      metadata: {
        ...testSourceMetadataForPath(worktree)
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
      let state = await terminalService.agentSessionState(sessionId);
      assert.equal(state.terminal.status, "running");
      assert.equal(state.terminal.transmitting, undefined);
      assert.equal(state.terminal.attentionRequired, undefined);
      assert.equal(state.turn, null);

      session.agentRuns = [
        codexAppServerAgentRun({
          providerThreadId: "00000000-0000-4000-8000-000000000010",
          providerTurnId: "turn-1"
        })
      ];
      state = await terminalService.agentSessionState(sessionId);
      assert.equal(state.turn.active, true);
      assert.equal(state.turn.state, "active");
      assert.equal(state.turn.status, "inProgress");
      assert.equal(state.turn.id, "turn-1");
      assert.equal(state.terminal.transmitting, undefined);

      session.agentRuns = [
        codexAppServerAgentRun({
          providerStatus: "inProgress",
          providerThreadId: "00000000-0000-4000-8000-000000000011",
          providerTurnId: "turn-2",
          state: "active"
        })
      ];
      state = await terminalService.agentSessionState(sessionId);
      assert.equal(state.turn.active, true);
      assert.equal(state.turn.state, "active");
      assert.equal(state.turn.status, "inProgress");
      assert.equal(state.turn.threadId, "00000000-0000-4000-8000-000000000011");
      assert.equal(state.turn.id, "turn-2");
    } finally {
      await closeTerminalSession(terminal.id, {
        namespace
      });
    }
  });
});

test("Vibe64 Codex terminal state has no stale process fallback when memory attach state is missing", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "codex_terminal_stale_container";
    const sessionRoot = testSessionRoot(targetRoot, sessionId);
    const worktree = testSessionSourcePath(targetRoot, sessionId);
    await mkdir(worktree, {
      recursive: true
    });
    const session = {
      completedSteps: ["source_created"],
      metadata: {
        ...testSourceMetadataForPath(worktree)
      },
      sessionId,
      sessionRoot,
      targetRoot
    };
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

    const state = await terminalService.agentSessionState(sessionId);

    assert.equal(state.ok, true);
    assert.equal(state.terminal, null);
    assert.equal(state.turn, null);
  });
});

test("Vibe64 Codex terminal close does not have a stale process fallback when memory state is gone", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "codex_terminal_close_stale_container";
    const terminalSessionId = "terminal-from-host";
    const sessionRoot = testSessionRoot(targetRoot, sessionId);
    const worktree = testSessionSourcePath(targetRoot, sessionId);
    await mkdir(worktree, {
      recursive: true
    });
    const session = {
      completedSteps: ["source_created"],
      metadata: {
        ...testSourceMetadataForPath(worktree)
      },
      sessionId,
      sessionRoot,
      targetRoot
    };
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

    const result = await terminalService.closeAgentTerminal(sessionId, terminalSessionId);

    assert.equal(result.ok, true);
    assert.equal(result.closed, false);
    assert.equal(result.removedContainers, undefined);
  });
});

test("Vibe64 Codex polling releases an orphaned prompt claim without losing its ownership", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "codex_turn_identity_pending";
    const sessionRoot = testSessionRoot(targetRoot, sessionId);
    const worktree = testSessionSourcePath(targetRoot, sessionId);
    const runtimeDir = path.join(targetRoot, ".vibe64", "runtime", "codex-app-server");
    await mkdir(worktree, {
      recursive: true
    });
    const session = {
      agentRuns: [
        {
          ...codexAppServerAgentRun({
            inputSource: "workflow",
            providerStatus: "starting",
            providerThreadId: "thread-1",
            providerTurnId: "",
            state: VIBE64_AGENT_RUN_STATE.STARTING,
            updatedAt: new Date().toISOString()
          }),
          handoffId: "000001-agent_conversation.json:agent_conversation",
          pendingUserMessageClientIds: ["composer:unit:orphaned-prompt"]
        }
      ],
      currentStep: "seed_application_defined",
      metadata: {
        agent_transport_endpoint: `unix://${path.join(runtimeDir, "app-server.sock")}`,
        agent_transport_runtime_dir: runtimeDir,
        agent_transport_socket_path: path.join(runtimeDir, "app-server.sock"),
        ...testSourceMetadataForPath(worktree)
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
    let readThreadStatusCalls = 0;
    const controller = createCodexTerminalController({
      codexAuthPreflight: noopCodexAuthPreflight,
      codexAppServerProviderFactory: () => ({
        async readThreadStatus() {
          readThreadStatusCalls += 1;
          return {
            raw: {
              status: "completed"
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
    const run = codexAppServerAgentRunSnapshot(session);

    assert.equal(state.ok, true);
    assert.equal(readThreadStatusCalls, 1);
    assert.equal(run.state, VIBE64_AGENT_RUN_STATE.FAILED);
    assert.equal(run.providerStatus, "delivery_failed");
    assert.equal(run.providerTurnId, "");
    assert.match(run.error, /message is safe; retry it/u);
    assert.deepEqual(run.pendingUserMessageClientIds, ["composer:unit:orphaned-prompt"]);
    assert.equal(state.codexAgentTurn.active, false);
    assert.equal(state.codexAgentTurn.state, "idle");
  });
});

test("Vibe64 Codex terminal state reconciles stale active app-server turns", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "codex_turn_reconcile";
    const sessionRoot = testSessionRoot(targetRoot, sessionId);
    const worktree = testSessionSourcePath(targetRoot, sessionId);
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
      completedSteps: ["source_created"],
      metadata: {
        agent_transport_endpoint: `unix://${path.join(runtimeDir, "app-server.sock")}`,
        agent_transport_runtime_dir: runtimeDir,
        agent_transport_socket_path: path.join(runtimeDir, "app-server.sock"),
        ...testSourceMetadataForPath(worktree)
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
    const readThreadStatusCalls = [];
    let providerOptions = null;
    const controller = createCodexTerminalController({
      codexAuthPreflight: noopCodexAuthPreflight,
      codexAppServerProviderOptions: {
      },
      codexAppServerProviderFactory: (options = {}) => {
        providerOptions = options;
        return {
          async readThreadStatus(threadId) {
            readThreadStatusCalls.push(threadId);
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
    assert.deepEqual(readThreadStatusCalls, ["thread-1"]);
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
    assert.equal(state.codexAgentTurn.active, true);
    assert.equal(state.codexAgentTurn.state, "finalizing");
    assert.equal(state.codexAgentTurn.status, "completed");
  });
});

test("Vibe64 Codex app-server active turns self-reconcile without another session refresh", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "codex_turn_active_watchdog";
    const sessionRoot = testSessionRoot(targetRoot, sessionId);
    const worktree = testSessionSourcePath(targetRoot, sessionId);
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
      completedSteps: ["source_created"],
      metadata: {
        agent_transport_endpoint: `unix://${path.join(runtimeDir, "app-server.sock")}`,
        agent_transport_runtime_dir: runtimeDir,
        agent_transport_socket_path: path.join(runtimeDir, "app-server.sock"),
        ...testSourceMetadataForPath(worktree)
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
    const readThreadStatusCalls = [];
    const controller = createCodexTerminalController({
      codexAuthPreflight: noopCodexAuthPreflight,
      codexAppServerActiveReconcileMs: 5,
      codexAppServerProviderOptions: {
      },
      codexAppServerProviderFactory: () => ({
        async readThreadStatus(threadId) {
          readThreadStatusCalls.push(threadId);
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
    assert.deepEqual(readThreadStatusCalls, ["thread-1"]);
    assert.equal(codexAppServerAgentRunSnapshot(session).state, "active");

    await waitForCondition(
      () => codexAppServerAgentRunSnapshot(session).state === "finalizing",
      "Timed out waiting for Codex app-server active turn reconciliation."
    );

    assert.deepEqual(readThreadStatusCalls, ["thread-1", "thread-1"]);
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

test("Vibe64 Codex terminal recovery preserves distinct app-server item ids even when text overlaps", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "codex_turn_stale_finalizing_recovered";
    const sessionRoot = testSessionRoot(targetRoot, sessionId);
    const worktree = testSessionSourcePath(targetRoot, sessionId);
    const runtimeDir = path.join(targetRoot, ".vibe64", "runtime", "codex-app-server");
    const threadId = "thread-1";
    const turnId = "turn-1";
    await mkdir(worktree, {
      recursive: true
    });
    const assistantText = "What should the app do?";
    const workflowResult = {
      fields: {},
      inputFields: [],
      kind: "waiting_for_input",
      message: "What should the app do?",
      stepId: "seed_application_defined",
      stepStatus: "awaiting_agent_result"
    };
    const workflowResultContract = {
      fields: {
        body: "App definition.",
        title: "Work title.",
        word: "Session word."
      },
      mode: "structured",
      optionalFields: [],
      stepId: "seed_application_defined",
      stepStatus: "awaiting_agent_result"
    };
    const session = {
      agentRuns: [
        codexAppServerAgentRun({
          events: [{
            callId: "workflow-result-1",
            kind: "codex-app-server-workflow-result-accepted",
            providerThreadId: threadId,
            providerTurnId: turnId,
            workflowResult
          }],
          inputSource: "workflow",
          providerStatus: "completed",
          providerThreadId: threadId,
          providerTurnId: turnId,
          state: "finalizing",
          updatedAt: "2000-01-01T00:00:00.000Z",
          workflowResultContract
        })
      ],
      completedSteps: ["source_created"],
      currentStep: "seed_application_defined",
      currentStepDefinition: {
        autopilot: {
          kind: "agent_conversation"
        }
      },
      metadata: {
        agent_transport_endpoint: `unix://${path.join(runtimeDir, "app-server.sock")}`,
        agent_transport_runtime_dir: runtimeDir,
        agent_transport_socket_path: path.join(runtimeDir, "app-server.sock"),
        ...testSourceMetadataForPath(worktree)
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
    const readThreadCalls = [];
    const resumeThreadCalls = [];
    const controller = createCodexTerminalController({
      codexAuthPreflight: noopCodexAuthPreflight,
      codexAppServerProviderOptions: {
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
            id: resumedThreadId
          };
        },
        async readThread(readThreadId) {
          readThreadCalls.push(readThreadId);
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
                    },
                    {
                      id: "assistant-message-2",
                      text: `${assistantText} You're welcome.`,
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
    assert.deepEqual(readThreadCalls, [threadId]);
    assert.deepEqual(session.lastStepInput, {
      conversationText: "What should the app do?\n\nWhat should the app do? You're welcome.",
      fields: {},
      inputFields: [],
      kind: "waiting_for_input",
      message: "What should the app do?",
      source: "codex",
      stepId: "seed_application_defined",
      stepStatus: "awaiting_agent_result",
      text: ""
    });
    assert.equal(session.stepMachine.status, "done");
    assert.equal(codexAppServerAgentRunSnapshot(session).state, "completed");
    assert.equal(codexAppServerAgentRunSnapshot(session).providerStatus, "completed");
    assert.equal(codexAppServerAgentRunSnapshot(session).error, "");
    assert.equal(state.codexAgentTurn.active, false);
    assert.equal(state.codexAgentTurn.state, "idle");
  });
});

test("Vibe64 Codex app-server accepts plain text for agent conversation turns", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "codex_turn_plain_agent_conversation";
    const sessionRoot = testSessionRoot(targetRoot, sessionId);
    const worktree = testSessionSourcePath(targetRoot, sessionId);
    const runtimeDir = path.join(targetRoot, ".vibe64", "runtime", "codex-app-server");
    const threadId = "thread-1";
    const turnId = "turn-1";
    await mkdir(worktree, {
      recursive: true
    });
    const assistantText = "Done. I adjusted the jobs screen and ran the focused checks.";
    const workflowResultContract = {
      fields: {},
      mode: "plain",
      optionalFields: [],
      stepId: "",
      stepStatus: ""
    };
    const session = {
      agentRuns: [
        codexAppServerAgentRun({
          inputSource: "workflow",
          providerStatus: "completed",
          providerThreadId: threadId,
          providerTurnId: turnId,
          state: "finalizing",
          stepId: "maintenance_conversation",
          stepStatus: "awaiting_agent_result",
          updatedAt: "2000-01-01T00:00:00.000Z",
          workflowResultContract
        })
      ],
      completedSteps: ["source_created"],
      currentStep: "maintenance_conversation",
      currentStepDefinition: {
        actions: [],
        id: "maintenance_conversation",
        label: "Talk to Codex"
      },
      metadata: {
        agent_transport_endpoint: `unix://${path.join(runtimeDir, "app-server.sock")}`,
        agent_transport_runtime_dir: runtimeDir,
        agent_transport_socket_path: path.join(runtimeDir, "app-server.sock"),
        ...testSourceMetadataForPath(worktree)
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
    const readThreadCalls = [];
    const resumeThreadCalls = [];
    const controller = createCodexTerminalController({
      codexAuthPreflight: noopCodexAuthPreflight,
      codexAppServerProviderOptions: {
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
            id: resumedThreadId
          };
        },
        async readThread(readThreadId) {
          readThreadCalls.push(readThreadId);
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
    assert.deepEqual(readThreadCalls, [threadId]);
    assert.deepEqual(session.lastStepInput, {
      conversationText: assistantText,
      fields: {},
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
    assert.equal(state.codexAgentTurn.active, false);
    assert.equal(state.codexAgentTurn.state, "idle");
  });
});

test("Vibe64 Codex terminal state explains unprocessable app-server results", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "codex_turn_stale_finalizing_unprocessable";
    const sessionRoot = testSessionRoot(targetRoot, sessionId);
    const worktree = testSessionSourcePath(targetRoot, sessionId);
    const runtimeDir = path.join(targetRoot, ".vibe64", "runtime", "codex-app-server");
    const threadId = "thread-1";
    const turnId = "turn-1";
    await mkdir(worktree, {
      recursive: true
    });
    const assistantText = "For login, JSKIT uses Supabase here.";
    const workflowResult = {
      fields: {},
      inputFields: [
        {
          id: "supabase_project_url",
          kind: "text",
          label: "Project URL"
        }
      ],
      kind: "waiting_for_input",
      message: "For login, JSKIT uses Supabase here.",
      stepId: "seed_application_defined",
      stepStatus: "awaiting_agent_result"
    };
    const workflowResultContract = {
      fields: {
        body: "App definition.",
        title: "Work title.",
        word: "Session word."
      },
      mode: "structured",
      optionalFields: [],
      stepId: "seed_application_defined",
      stepStatus: "awaiting_agent_result"
    };
    const session = {
      agentRuns: [
        codexAppServerAgentRun({
          events: [{
            callId: "workflow-result-1",
            kind: "codex-app-server-workflow-result-accepted",
            providerThreadId: threadId,
            providerTurnId: turnId,
            workflowResult
          }],
          inputSource: "workflow",
          providerStatus: "completed",
          providerThreadId: threadId,
          providerTurnId: turnId,
          state: "finalizing",
          updatedAt: "2000-01-01T00:00:00.000Z",
          workflowResultContract
        })
      ],
      completedSteps: ["source_created"],
      currentStep: "seed_application_defined",
      currentStepDefinition: {
        autopilot: {
          kind: "agent_conversation"
        }
      },
      metadata: {
        agent_transport_endpoint: `unix://${path.join(runtimeDir, "app-server.sock")}`,
        agent_transport_runtime_dir: runtimeDir,
        agent_transport_socket_path: path.join(runtimeDir, "app-server.sock"),
        ...testSourceMetadataForPath(worktree)
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
    const readThreadCalls = [];
    const resumeThreadCalls = [];
    const controller = createCodexTerminalController({
      codexAuthPreflight: noopCodexAuthPreflight,
      codexAppServerProviderOptions: {
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
            id: resumedThreadId
          };
        },
        async readThread(readThreadId) {
          readThreadCalls.push(readThreadId);
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
    assert.deepEqual(readThreadCalls, [threadId]);
    assert.equal(codexAppServerAgentRunSnapshot(session).state, "completed");
    assert.equal(codexAppServerAgentRunSnapshot(session).providerStatus, "completed");
    assert.equal(agentRunError, "");
    assert.match(session.returnedControl?.message || "", /Vibe64 agent workflow result field is missing a name/u);
    assert.doesNotMatch(agentRunError, /did not receive the assistant result text/u);
    assert.equal(session.stepMachine.status, "waiting_for_input");
    assert.match(session.returnedControl?.inputPrompt || "", /Retry the step/u);
    assert.equal(state.codexAgentTurn.active, false);
    assert.equal(state.codexAgentTurn.state, "idle");
  });
});

test("Vibe64 Codex terminal state returns control for stale finalizing app-server turns", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "codex_turn_stale_finalizing";
    const sessionRoot = testSessionRoot(targetRoot, sessionId);
    const worktree = testSessionSourcePath(targetRoot, sessionId);
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
      completedSteps: ["source_created"],
      currentStep: "plan_and_execute",
      metadata: {
        agent_transport_endpoint: `unix://${path.join(runtimeDir, "app-server.sock")}`,
        agent_transport_runtime_dir: runtimeDir,
        agent_transport_socket_path: path.join(runtimeDir, "app-server.sock"),
        ...testSourceMetadataForPath(worktree)
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
    let readThreadStatusCalls = 0;
    const controller = createCodexTerminalController({
      codexAuthPreflight: noopCodexAuthPreflight,
      codexAppServerProviderFactory: () => ({
        async readThreadStatus() {
          readThreadStatusCalls += 1;
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
    assert.equal(readThreadStatusCalls, 0);
    assert.equal(codexAppServerAgentRunSnapshot(session).state, "completed");
    assert.equal(codexAppServerAgentRunSnapshot(session).providerStatus, "completed");
    assert.match(codexAppServerAgentRunSnapshot(session).error, /did not receive the assistant result text/u);
    assert.equal(session.stepMachine.status, "waiting_for_input");
    assert.match(session.returnedControl?.message || "", /did not receive the assistant result text/u);
    assert.equal(state.codexAgentTurn.active, false);
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
    kind: "agent_prompt_handoff",
    terminalInput: "This must not be typed into xterm."
  });
  assert.equal(promptResult.ok, false);
  assert.match(promptResult.error, /no terminal fallback/u);
});

test("Vibe64 Codex app-server prompt delivery records the resumable CLI thread", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "codex_app_server_prompt";
    const stateRoot = path.join(targetRoot, "server-state");
    const toolHomeSource = homedir();
    const sessionRoot = path.join(stateRoot, "sessions", "active", sessionId);
    const worktree = testSessionSourcePath(targetRoot, sessionId);
    await mkdir(worktree, {
      recursive: true
    });
    const plainResultContract = {
      fields: {},
      mode: "plain",
      optionalFields: [],
      stepId: "",
      stepStatus: ""
    };
    const structuredResultContract = {
      fields: {
        body: "App definition.",
        title: "Work title.",
        word: "Session word."
      },
      mode: "structured",
      optionalFields: [],
      stepId: "seed_application_defined",
      stepStatus: "awaiting_agent_result"
    };
    const session = {
      actionResult: {
        agentPromptHandoff: {
          resultContract: plainResultContract
        }
      },
      actionAttempts: [],
      artifactsRoot: path.join(sessionRoot, "artifacts"),
      completedSteps: ["source_created"],
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
        agent_workflow_result_transport: "dynamic_tool_v1",
        agent_identity_conversation_id: "stale-codex-thread",
        agent_identity_provider: "codex",
        agent_identity_status: "ready",
        agent_identity_workdir: worktree,
        agent_transport_id: "codex_app_server",
        agent_transport_runtime_dir: path.join(stateRoot, "runtime", "legacy-codex-app-server"),
        github_repository: "example/project",
        ...testSourceMetadataForPath(worktree)
      },
      presentation: {
        backgroundTasks: []
      },
      sessionId,
      sessionRoot,
      stateRoot,
      status: "active",
      stepMachine: {
        from: "ready",
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
    const startupEvents = [];
    const runtime = {
      adapter: {
        async listExecutionEnvironmentPreparations() {
          return [{
            allowedRoots: [targetRoot],
            coalesceKey: `codex-startup:${sessionId}`,
            command: "unit-database-preparation",
            cwd: targetRoot,
            id: "unit-database-preparation",
            runtimes: []
          }];
        }
      },
      projectConfig: {},
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
        async upsertConversationAssistantMessage(_sessionId, {
          text = "",
          turnId = ""
        } = {}) {
          const turn = conversationLog.find((candidate) => candidate.turnId === turnId) || null;
          if (!turn) {
            return null;
          }
          turn.assistant = {
            text: String(text || "").trim()
          };
          return turn;
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
    let providerRequestHandler = null;
    let earlyWorkflowResultResponse = null;
    let appServerPromptTurnCount = 0;
    const providerThreadItems = new Map();
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
        startupEvents.push("provider-available");
        providerCalls.ensureAvailable += 1;
        return {
          ok: true
        };
      },
      async ensureRuntime() {
        providerCalls.ensureRuntime += 1;
        return {
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
        throw Object.assign(new Error("invalid request"), {
          code: -32600,
          method: "thread/resume"
        });
      },
      async readThread(threadId) {
        if (threadId === "stale-codex-thread") {
          throw Object.assign(new Error("invalid request"), {
            code: -32600,
            method: "thread/read"
          });
        }
        return {
          raw: {
            id: threadId,
            turns: [...providerThreadItems.entries()].map(([id, items]) => ({
              id,
              items,
              status: "completed"
            }))
          }
        };
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
        const turnId = bootstrapTurn
            ? "codex-bootstrap-turn-1"
            : recoveryTurn
              ? "codex-context-recovery-turn-1"
              : `codex-app-server-turn-${appServerPromptTurnCount}`;
        if (!bootstrapTurn && !recoveryTurn) {
          earlyWorkflowResultResponse = await providerRequestHandler({
            id: "server-request-before-turn-start-returned",
            method: "item/tool/call",
            params: {
              arguments: {
                fields: {},
                inputFields: [],
                kind: "waiting_for_input",
                message: "What should the app do?",
                stepId: "seed_application_defined",
                stepStatus: "awaiting_agent_result"
              },
              callId: "workflow-call-before-turn-start-returned",
              threadId,
              tool: "vibe64_submit_workflow_result",
              turnId
            }
          });
        }
        return {
          id: turnId,
          status: bootstrapTurn || recoveryTurn ? "completed" : "inProgress"
        };
      },
      async steerTurn(threadId, turnId, input, params = {}) {
        providerCalls.steerTurn.push({
          input,
          params,
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
      },
      setServerRequestHandler(callback) {
        providerRequestHandler = typeof callback === "function" ? callback : null;
        return () => {
          if (providerRequestHandler === callback) {
            providerRequestHandler = null;
          }
        };
      }
    };
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
      },
      codexAppServerPromptDeliveryEnabled: true,
      codexAppServerProviderFactory: (options = {}) => {
        startupEvents.push("provider-created");
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
          return {};
        },
        async projectRuntimeConfigEnvironment() {
          return {
            DB_CLIENT: "mysql2",
            DB_HOST: JSKIT_MARIADB_HOST,
            DB_NAME: "captured_provider_env",
            DB_PASSWORD: UNIT_DATABASE_PASSWORD,
            DB_PORT: jskitMariaDbHostPort(),
            DB_USER: "vibe64_dev_app"
          };
        },
        async createRuntime() {
          return runtime;
        }
      },
      publishSessionChanged: async (_sessionId, event = {}) => {
        publishSessionEvents.push(event);
        publishSessionReasons.push(event.reason);
      },
      runCommand: async () => {
        startupEvents.push("environment-prepared");
        return {
          ok: true
        };
      }
    });

    const result = await controller.injectCodexPrompt(sessionId, {
      clientSubmissionId: "composer:unit:initial-prompt",
      handoffId: "000001-maintenance_conversation.json:agent_conversation",
      kind: "agent_prompt_handoff",
      resultContract: structuredResultContract,
      terminalInput: "Vibe64 interactive conversation turn:\nUser/request input:\n- conversationRequest: Verify app-server prompt delivery."
    });

    assert.equal(result.ok, true);
    assert.equal(earlyWorkflowResultResponse?.success, true);
    assert.deepEqual(
      codexAppServerAgentRunSnapshot(session).workflowResultContract,
      structuredResultContract
    );
    assert.equal(
      codexAppServerAgentRunSnapshot(session).events.filter((event) => (
        event.kind === "codex-app-server-workflow-result-accepted"
      )).length,
      1
    );
    codexAppServerAgentRunSnapshot(session).events = codexAppServerAgentRunSnapshot(session).events.filter((event) => (
      event.kind !== "codex-app-server-workflow-result-accepted"
    ));
    assert.equal(result.turnId, "codex-app-server-turn-1");
    assert.equal(result.codexAgentTurn.active, true);
    assert.equal(providerCalls.ensureAvailable, 1);
    assert.equal(providerCalls.ensureRuntime, 1);
    assert.ok(startupEvents.indexOf("environment-prepared") < startupEvents.indexOf("provider-created"));
    assert.ok(startupEvents.indexOf("environment-prepared") < startupEvents.indexOf("provider-available"));
    assert.equal(providerFactoryOptions.length, 1);
    assert.equal(providerFactoryOptions[0].targetRoot, worktree);
    assert.equal(providerFactoryOptions[0].runtimeDir, "");
    assert.equal(providerFactoryOptions[0].terminalEnv.DB_HOST, JSKIT_MARIADB_HOST);
    assert.equal(providerFactoryOptions[0].terminalEnv.DB_PASSWORD, UNIT_DATABASE_PASSWORD);
    assert.equal(providerFactoryOptions[0].terminalEnv.DB_NAME, "captured_provider_env");
    assert.equal(providerFactoryOptions[0].terminalEnv.VIBE64_CODEX_GIT_COMMAND_SESSION_ID, sessionId);
    assert.match(providerFactoryOptions[0].terminalEnv.VIBE64_CODEX_GIT_COMMAND_SOCKET, /command\.sock$/u);
    assert.match(providerFactoryOptions[0].terminalEnv.VIBE64_CODEX_GIT_COMMAND_TOKEN, /^[a-f0-9]{16}$/u);
    assert.ok(path.isAbsolute(providerFactoryOptions[0].terminalEnv.VIBE64_CODEX_GIT_COMMAND_WRAPPER_DIR));
    assert.match(providerFactoryOptions[0].terminalEnv.VIBE64_CODEX_GIT_COMMAND_WRAPPER_DIR, /codex-git-command/u);
    assert.equal(providerFactoryOptions[0].terminalEnv[VIBE64_AGENT_PREVIEW_COMMAND_SESSION_ID_ENV], sessionId);
    assert.match(providerFactoryOptions[0].terminalEnv[VIBE64_AGENT_PREVIEW_COMMAND_SOCKET_ENV], /preview-command\.sock$/u);
    assert.match(providerFactoryOptions[0].terminalEnv[VIBE64_AGENT_PREVIEW_COMMAND_TOKEN_ENV], /^[a-f0-9]{16}$/u);
    assert.equal(providerFactoryOptions[0].toolHomeSource, toolHomeSource);
    assert.equal(providerFactoryOptions[0].workdir, worktree);
    assert.equal(providerFactoryOptions[0].mounts, undefined);
    assert.equal(providerCalls.resumeThread.length, 1);
    assert.equal(providerCalls.resumeThread[0].threadId, "stale-codex-thread");
    assert.equal(providerCalls.startThread.length, 1);
    assert.equal(providerCalls.sendTurn.length, 2);
    assert.equal(providerCalls.startThread[0].approvalPolicy, "never");
    assert.equal(providerCalls.startThread[0].cwd, worktree);
    assert.equal(providerCalls.startThread[0].model, "gpt-5.6-sol");
    assert.equal(providerCalls.startThread[0].sandbox, "danger-full-access");
    assert.equal(providerCalls.startThread[0].dynamicTools[0].name, "vibe64_submit_workflow_result");
    assert.match(providerCalls.startThread[0].developerInstructions, /Vibe64 session briefing/u);
    assert.match(providerCalls.startThread[0].developerInstructions, /Vibe64 agent result routing/u);
    assert.match(providerCalls.startThread[0].developerInstructions, /workflow-result control/u);
    assert.match(providerCalls.startThread[0].developerInstructions, /ordinary Markdown/u);
    assert.match(providerCalls.startThread[0].developerInstructions, /Live progress instruction/u);
    assert.match(providerCalls.startThread[0].developerInstructions, /`git` and `gh` are available/u);
    const recoveryTurnCall = providerCalls.sendTurn[0];
    const promptTurnCall = providerCalls.sendTurn[1];
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
    assert.equal(promptTurnCall.params.outputSchema, undefined);
    assert.match(promptTurnCall.input, /Verify app-server prompt delivery/u);
    assert.equal(promptTurnCall.params.clientUserMessageId, "composer:unit:initial-prompt");
    assert.deepEqual(
      codexAppServerAgentRunSnapshot(session).pendingUserMessageClientIds,
      [promptTurnCall.params.clientUserMessageId]
    );
    providerSubscribers[0]({
      method: "item/completed",
      params: {
        item: {
          clientId: promptTurnCall.params.clientUserMessageId,
          content: [{
            text: promptTurnCall.input,
            type: "text"
          }],
          id: "workflow-prompt-user-message",
          type: "userMessage"
        },
        threadId: promptTurnCall.threadId,
        turnId: "codex-app-server-turn-1"
      }
    });
    await delay(5);
    assert.equal(
      conversationLog.some((turn) => turn.user?.text === promptTurnCall.input),
      false
    );
    assert.deepEqual(codexAppServerAgentRunSnapshot(session).pendingUserMessageClientIds, []);
    assert.equal(session.metadata.agent_identity_provider, "codex");
    assert.equal(session.metadata.agent_identity_status, "ready");
    assert.equal(
      session.metadata.agent_identity_conversation_id,
      "00000000-0000-4000-8000-000000000004"
    );
    assert.equal(session.metadata.agent_identity_workdir, worktree);
    assert.equal(session.metadata.agent_identity_resume_strategy, "provider-native");
    assert.equal(session.metadata.agent_workflow_result_transport, "dynamic_tool_v1");
    assert.equal(session.metadata.agent_transport_endpoint, `unix://${path.join(stateRoot, "runtime", "codex-app-server", "app-server.sock")}`);
    assert.equal(session.metadata.agent_transport_kind, "unix");
    assert.equal(
      session.metadata.agent_resume_command,
      `${STUDIO_MANAGED_CODEX_COMMAND} -c ${STUDIO_MANAGED_CODEX_NO_UPDATE_CONFIG} --remote unix://${path.join(stateRoot, "runtime", "codex-app-server", "app-server.sock")} resume 00000000-0000-4000-8000-000000000004`
    );
    assert.equal(codexAppServerAgentRunSnapshot(session).providerTurnId, "codex-app-server-turn-1");
    assert.equal(session.metadata.session_git_command_actor_scope, "local");
    assert.equal(session.metadata.session_git_command_actor_session_id, sessionId);
    assert.equal(session.metadata.session_git_command_actor_thread_id, "00000000-0000-4000-8000-000000000004");
    assert.equal(session.metadata.session_git_command_actor_user_key, "local");
    assert.equal(session.metadata.session_git_command_actor_workdir, worktree);
    assert.equal(session.metadata.agent_briefing_delivered, "yes");
    assert.equal(session.metadata.agent_briefing_transport, "codex_app_server");
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
    assert.deepEqual(publishSessionReasons, [
      "codex-app-server-turn-claimed",
      "codex-app-server-running",
      "codex-context-replaced",
      "codex-app-server-ready",
      "codex-context-ready",
      "codex-app-server-turn-active",
      "codex-app-server-turn-active"
    ]);
    assert.equal(providerSubscribers.length, 1);
    assert.equal(typeof providerRequestHandler, "function");
    const workflowToolRequest = {
      id: "server-request-1",
      method: "item/tool/call",
      params: {
        callId: "workflow-call-1",
        threadId: "00000000-0000-4000-8000-000000000004",
        tool: "vibe64_submit_workflow_result",
        turnId: "codex-app-server-turn-1"
      }
    };
    const rejectedWorkflowResult = await providerRequestHandler({
      ...workflowToolRequest,
      params: {
        ...workflowToolRequest.params,
        arguments: {
          fields: {
            body: "",
            title: "",
            word: ""
          },
          inputFields: [],
          kind: "ready",
          message: "",
          stepId: "seed_application_defined",
          stepStatus: "awaiting_agent_result"
        }
      }
    });
    assert.equal(rejectedWorkflowResult.success, false);
    assert.match(rejectedWorkflowResult.contentItems[0].text, /requires non-empty fields/u);
    const waitingWorkflowArguments = {
      fields: {},
      inputFields: [],
      kind: "waiting_for_input",
      message: "What should the app do?",
      stepId: "seed_application_defined",
      stepStatus: "awaiting_agent_result"
    };
    const acceptedWorkflowResult = await providerRequestHandler({
      ...workflowToolRequest,
      params: {
        ...workflowToolRequest.params,
        arguments: waitingWorkflowArguments
      }
    });
    assert.equal(acceptedWorkflowResult.success, true);
    const duplicateWorkflowResult = await providerRequestHandler({
      ...workflowToolRequest,
      params: {
        ...workflowToolRequest.params,
        arguments: waitingWorkflowArguments
      }
    });
    assert.equal(duplicateWorkflowResult.success, true);
    const conflictingWorkflowResult = await providerRequestHandler({
      ...workflowToolRequest,
      params: {
        ...workflowToolRequest.params,
        arguments: waitingWorkflowArguments,
        callId: "workflow-call-2"
      }
    });
    assert.equal(conflictingWorkflowResult.success, false);
    assert.match(conflictingWorkflowResult.contentItems[0].text, /already accepted/u);
    const agentRun = codexAppServerAgentRunSnapshot(session);
    const workflowResultEvents = agentRun.events.filter((event) => (
      event.kind === "codex-app-server-workflow-result-accepted"
    ));
    assert.equal(workflowResultEvents.length, 1);
    assert.equal(workflowResultEvents[0].callId, "workflow-call-1");
    assert.deepEqual(workflowResultEvents[0].workflowResult, {
      ...waitingWorkflowArguments,
      source: "codex",
      text: ""
    });
    agentRun.events = agentRun.events.filter((event) => (
      event.kind !== "codex-app-server-workflow-result-accepted"
    ));
    agentRun.workflowResultContract = plainResultContract;
    const duplicateResult = await controller.injectCodexPrompt(sessionId, {
      handoffId: "000001-maintenance_conversation.json:agent_conversation:duplicate",
      kind: "agent_prompt_handoff",
      terminalInput: "Vibe64 interactive conversation turn:\nUser/request input:\n- conversationRequest: Duplicate prompt."
    });
    assert.equal(duplicateResult.ok, false);
    assert.equal(duplicateResult.code, "vibe64_agent_turn_already_running");
    assert.equal(duplicateResult.operationOutcome, "agent_already_running");
    assert.equal(duplicateResult.threadId, "00000000-0000-4000-8000-000000000004");
    assert.equal(duplicateResult.turnId, "codex-app-server-turn-1");
    assert.equal(providerCalls.sendTurn.length, 2);
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
    session.metadata.agent_identity_conversation_id = "00000000-0000-4000-8000-000000000004";
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
    const messageResult = await controller.sendMessage(sessionId, {
      originId: "tab:test",
      message: "What are you up to?"
    });
    assert.equal(messageResult.ok, true);
    assert.equal(messageResult.delivered, true);
    assert.equal(providerCalls.steerTurn.length, 1);
    const userSteerCall = providerCalls.steerTurn[0];
    assert.equal(userSteerCall.threadId, "00000000-0000-4000-8000-000000000004");
    assert.equal(userSteerCall.turnId, "codex-app-server-turn-1");
    assert.equal(userSteerCall.input, "What are you up to?");
    assert.match(userSteerCall.params.clientUserMessageId, /^vibe64:/u);
    assert.deepEqual(
      codexAppServerAgentRunSnapshot(session).pendingUserMessageClientIds,
      [userSteerCall.params.clientUserMessageId]
    );
    assert.equal(session.metadata.codex_context_refresh_pending, "yes");
    assert.equal((await runtime.store.readConversationLog()).at(-1)?.user?.text, "What are you up to?");
    const publishCountBeforeSteerUserMirror = publishSessionEvents.length;
    providerSubscribers[0]({
      method: "item/completed",
      params: {
        item: {
          clientId: userSteerCall.params.clientUserMessageId,
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
    assert.deepEqual(codexAppServerAgentRunSnapshot(session).pendingUserMessageClientIds, []);
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
    const publishCountBeforeAnonymousProgress = publishSessionEvents.length;
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
    assert.equal(publishSessionEvents.length, publishCountBeforeAnonymousProgress);
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
              text: "Here are the questions.\nThis second line keeps the message out of live progress.",
              type: "text"
            }
          ],
          id: "assistant-progress-structured-result",
          type: "assistantMessage"
        },
        threadId: "00000000-0000-4000-8000-000000000004",
        turnId: "codex-app-server-turn-1"
      }
    });
    await delay(5);
    assert.equal(publishSessionEvents.length, publishCountAfterAssistantProgress);
    assert.equal(publishSessionReasons.includes("codex-app-server-live-progress"), true);
    const transcriptAssistantText = "The app-server turn is complete.";
    providerSubscribers[0]({
      method: "codex/event",
      params: {
        event: {
          payload: {
            id: "internal-response-item-1",
            phase: "final_answer",
            text: transcriptAssistantText,
            type: "agentMessage"
          },
          type: "response_item"
        },
        threadId: "00000000-0000-4000-8000-000000000004",
        turnId: "codex-app-server-turn-1"
      }
    });
    await delay(5);
    assert.deepEqual((await runtime.store.readConversationLog()).map((turn) => turn.assistant?.text).filter(Boolean), []);
    providerThreadItems.set("codex-app-server-turn-1", [
      {
        id: "canonical-assistant-final-1",
        phase: "final_answer",
        text: transcriptAssistantText,
        type: "agentMessage"
      },
      {
        id: "canonical-assistant-final-2",
        phase: "final_answer",
        text: "QUACK!",
        type: "agentMessage"
      }
    ]);
    providerSubscribers[0]({
      method: "turn/completed",
      params: {
        status: "completed",
        threadId: "00000000-0000-4000-8000-000000000004",
        turnId: "codex-app-server-turn-1"
      }
    });
    await waitForCondition(
      () => session.stepMachine.status === "done",
      "Timed out waiting for the canonical assistant response bundle."
    );
    providerSubscribers[0]({
      method: "item/completed",
      params: {
        item: {
          content: [{
            text: transcriptAssistantText,
            type: "text"
          }],
          id: "assistant-final-1",
          phase: "final_answer",
          type: "assistantMessage"
        },
        threadId: "00000000-0000-4000-8000-000000000004",
        turnId: "codex-app-server-turn-1"
      }
    });
    providerSubscribers[0]({
      method: "item/completed",
      params: {
        item: {
          content: [{
            text: "QUACK!",
            type: "text"
          }],
          id: "assistant-final-2",
          phase: "final_answer",
          type: "assistantMessage"
        },
        threadId: "00000000-0000-4000-8000-000000000004",
        turnId: "codex-app-server-turn-1"
      }
    });
    providerSubscribers[0]({
      method: "item/completed",
      params: {
        item: {
          content: [{
            text: transcriptAssistantText,
            type: "text"
          }],
          id: "assistant-final-1",
          phase: "final_answer",
          type: "assistantMessage"
        },
        threadId: "00000000-0000-4000-8000-000000000004",
        turnId: "codex-app-server-turn-1"
      }
    });
    await delay(10);
    assert.deepEqual(session.lastStepInput, {
      conversationText: "The app-server turn is complete.\n\nQUACK!",
      fields: {},
      kind: "ready",
      source: "codex",
      stepId: "maintenance_conversation",
      stepStatus: "awaiting_agent_result"
    });
    assert.equal(session.stepMachine.status, "done");
    assert.equal(codexAppServerAgentRunSnapshot(session).state, "completed");
    assert.equal(codexAppServerAgentRunSnapshot(session).providerStatus, "completed");
    assert.equal(codexAppServerAgentRunSnapshot(session).error, "");
    assert.deepEqual((await runtime.store.readConversationLog()).map((turn) => turn.assistant?.text).filter(Boolean), [
      "The app-server turn is complete.\n\nQUACK!"
    ]);
    assert.equal(
      publishSessionEvents.some((event) => (
        event.reason === "assistant-response-bundle" &&
        event.payload?.conversationLogPatch?.turn?.assistant?.text?.endsWith("QUACK!")
      )),
      true
    );
    assert.deepEqual((await runtime.store.readConversationLog()).flatMap((turn) => (turn.thinking || []).map((message) => message.text)).filter(Boolean), [
      "Running JSKIT verification from the active app-server turn.",
      "Checked the app-server prompt delivery result.",
      "Preparing to verify UI layouts",
      "I am checking the generated app.",
      "Inspecting remaining CSS."
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
    assert.deepEqual(publishSessionEvents.at(-1)?.payload?.agentSession?.turn, {
      active: true,
      completedAt: "",
      error: "",
      id: "terminal-turn-1",
      inputSource: "terminal",
      runState: "active",
      startedAt: publishSessionEvents.at(-1)?.payload?.agentSession?.turn?.startedAt,
      state: "active",
      status: "inProgress",
      updatedAt: publishSessionEvents.at(-1)?.payload?.agentSession?.turn?.updatedAt
    });
    assert.equal(publishSessionEvents.at(-1)?.payload?.agentSession?.turn?.active, true);
    assert.equal(publishSessionEvents.at(-1)?.payload?.agentRun?.providerTurnId, "terminal-turn-1");
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
      "Inspecting remaining CSS."
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
    session.stepMachine.status = "awaiting_agent_result";
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
      false
    );
    assert.equal(
      (await runtime.store.readConversationLog())
        .flatMap((turn) => (turn.thinking || []).map((message) => message.text))
        .includes("Continuing from the interruption."),
      true
    );
    session.stepMachine.status = "done";
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
      true
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
        .some((event) => event.reason === "codex-app-server-live-progress" &&
          event.payload?.conversationLogPatch?.turn?.thinking?.some((message) => message.text === "Continuing from the interruption.")),
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
      event.payload?.agentSession?.turn?.id === "terminal-turn-1"
    ));
    assert.equal(terminalIdleEvent?.payload?.agentSession?.turn?.active, false);
    assert.equal(terminalIdleEvent?.payload?.agentSession?.turn?.state, "idle");
    assert.equal(terminalIdleEvent?.payload?.agentSession?.turn?.status, "completed");
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
    const conversationAfterPromptLikeTerminalMessage = await runtime.store.readConversationLog();
    assert.equal(
      conversationAfterPromptLikeTerminalMessage
        .map((turn) => turn.user?.text)
        .filter(Boolean)
        .filter((text) => text === "This was typed directly into the Codex terminal.")
        .length,
      1
    );
    assert.equal(
      conversationAfterPromptLikeTerminalMessage
        .map((turn) => turn.user?.text)
        .filter(Boolean)
        .some((text) => text.includes("Already in Vibe64 chat.")),
      true
    );
    providerSubscribers[0]({
      method: "turn/completed",
      params: {
        status: "completed",
        threadId: "00000000-0000-4000-8000-000000000004",
        turnId: "routed-turn-1"
      }
    });
    await delay(10);
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
      kind: "agent_prompt_handoff",
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
    const worktree = testSessionSourcePath(targetRoot, sessionId);
    const runtime = new Vibe64SessionRuntime({
      targetRoot
    });
    await runtime.createSession({
      initialStep: "source_created",
      metadata: {
        ...testSourceMetadataForPath(worktree)
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
        agentTerminal: async (sessionId, event = {}) => {
          publishReasons.push({
            reason: event.reason,
            sessionId
          });
        }
      }
    });

    const result = await terminalService.ensureAgentSession(sessionId);
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
    const worktree = testSessionSourcePath(targetRoot, sessionId);
    const runtime = new Vibe64SessionRuntime({
      targetRoot
    });
    await runtime.createSession({
      initialStep: "source_created",
      metadata: {
        ...testSourceMetadataForPath(worktree),
        source_removed: "yes",
        source_removed_reason: "abandoned"
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
        agentTerminal: async (changedSessionId, event = {}) => {
          publishReasons.push({
            reason: event.reason,
            sessionId: changedSessionId
          });
        }
      }
    });

    const result = await terminalService.ensureAgentSession(sessionId);
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
    const worktree = testSessionSourcePath(targetRoot, sessionId);
    const runtime = new Vibe64SessionRuntime({
      targetRoot
    });
    await runtime.createSession({
      initialStep: "source_created",
      metadata: {
        session_closing_reason: "abandoned",
        ...testSourceMetadataForPath(worktree)
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
        agentTerminal: async (changedSessionId, event = {}) => {
          publishReasons.push({
            reason: event.reason,
            sessionId: changedSessionId
          });
        }
      }
    });

    const result = await terminalService.ensureAgentSession(sessionId);
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
    const worktree = testSessionSourcePath(targetRoot, sessionId);
    const runtime = new Vibe64SessionRuntime({
      targetRoot
    });
    await runtime.createSession({
      initialStep: "source_created",
      metadata: {
        ...testSourceMetadataForPath(worktree)
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

    const result = await terminalService.ensureAgentSession(sessionId);

    assert.equal(result.ok, true);
    assert.equal(result.thread.id, "00000000-0000-4000-8000-000000000005");
    assert.equal(providerOptions.length, 1);
    assert.equal(providerOptions[0].targetRoot, worktree);
    assert.equal(providerOptions[0].workdir, worktree);
  });
});

test("Vibe64 self-target Codex interrupt keeps native provider control", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "self_target_interrupt_native_codex_app_server";
    const worktree = testSessionSourcePath(targetRoot, sessionId);
    const threadId = "00000000-0000-4000-8000-000000000006";
    const runtime = new Vibe64SessionRuntime({
      targetRoot
    });
    await runtime.createSession({
      initialStep: "source_created",
      metadata: {
        agent_identity_conversation_id: threadId,
        agent_identity_provider: "codex",
        agent_identity_resume_strategy: "provider-native",
        agent_identity_status: "ready",
        agent_identity_workdir: worktree,
        ...testSourceMetadataForPath(worktree)
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

    const result = await terminalService.interruptAgentTurn(sessionId, testWorkflowInput());

    assert.equal(result.ok, true);
    assert.deepEqual(interruptCalls, [
      {
        threadId,
        turnId: "turn-1"
      }
    ]);
    assert.equal(providerOptions.length, 1);
    assert.equal(providerOptions[0].targetRoot, worktree);
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

test("Vibe64 Codex app-server messages use the active turn and record the Git actor", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "codex_app_server_steer_active_turn";
    const worktree = testSessionSourcePath(targetRoot, sessionId);
    const threadId = "00000000-0000-4000-8000-000000000126";
    const turnId = "codex-app-server-turn-active-message";
    const runtime = new Vibe64SessionRuntime({
      targetRoot
    });
    await runtime.createSession({
      initialStep: "issue_file_created",
      metadata: {
        ...testSourceMetadataForPath(worktree)
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
      },
      codexAppServerProviderFactory: () => ({
        async ensureAvailable() {
          return {
            ok: true
          };
        },
        async steerTurn(steeredThreadId, steeredTurnId, input, options) {
          steerCalls.push({
            input,
            options,
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

    const result = await controller.sendMessage(sessionId, {
      composerSubmissionId: "composer-message-1",
      originId: "tab:test",
      fields: {
        conversationRequest: "Use the existing tests as the guide."
      }
    });

    assert.equal(result.ok, true);
    assert.equal(result.delivered, true);
    assert.equal(result.deliveryMode, "active_turn");
    assert.equal(steerCalls.length, 1);
    assert.equal(steerCalls[0].threadId, threadId);
    assert.equal(steerCalls[0].turnId, turnId);
    assert.equal(steerCalls[0].input, "Use the existing tests as the guide.");
    assert.equal(steerCalls[0].options.clientUserMessageId, "composer-message-1");
    const conversationLog = await runtime.store.readConversationLog(sessionId);
    assert.equal(conversationLog.length, 1);
    assert.equal(conversationLog[0].user.text, "Use the existing tests as the guide.");
    const steerEvent = publishSessionEvents.find((event) => event.reason === "codex-app-server-message-delivered");
    assert.equal(steerEvent?.payload?.conversationLogPatch?.type, "upsert-turn");
    assert.equal(
      steerEvent?.payload?.conversationLogPatch?.turn?.user?.text,
      "Use the existing tests as the guide."
    );
    const attachmentMessageResult = await controller.sendMessage(sessionId, {
      displayFields: {
        conversationRequest: "Skip verify"
      },
      fields: {
        conversationRequest: "Skip verify\n\nAttached files:\n- image.png: /home/v64d_example/.local/state/vibe64/uploads/image.png"
      },
      originId: "tab:test"
    });
    assert.equal(attachmentMessageResult.ok, true);
    assert.equal(
      steerCalls.at(-1)?.input,
      "Skip verify\n\nAttached files:\n- image.png: /home/v64d_example/.local/state/vibe64/uploads/image.png"
    );
    const displayConversationLog = await runtime.store.readConversationLog(sessionId);
    assert.equal(displayConversationLog.at(-1)?.user.text, "Skip verify");
    const latestSteerEvent = publishSessionEvents
      .filter((event) => event.reason === "codex-app-server-message-delivered")
      .at(-1);
    assert.equal(
      latestSteerEvent?.payload?.conversationLogPatch?.turn?.user?.text,
      "Skip verify"
    );
    const displayOnlyMessageResult = await controller.sendMessage(sessionId, {
      displayFields: {
        conversationRequest: "Prompt: Check UI"
      },
      fields: {
        conversationRequest: "[Prompt: Check UI]\nFull Check UI prompt text."
      },
      originId: "tab:test"
    });
    assert.equal(displayOnlyMessageResult.ok, true);
    assert.equal(steerCalls.at(-1)?.input, "[Prompt: Check UI]\nFull Check UI prompt text.");
    const compactPromptConversationLog = await runtime.store.readConversationLog(sessionId);
    assert.equal(compactPromptConversationLog.at(-1)?.user.text, "Prompt: Check UI");
    let session = await runtime.getSession(sessionId);
    assert.equal(codexAppServerAgentRunSnapshot(session).state, "active");
    assert.equal(codexAppServerAgentRunSnapshot(session).active, true);
    assert.equal(codexAppServerAgentRunSnapshot(session).providerStatus, "inProgress");
    assert.equal(codexAppServerAgentRunSnapshot(session).providerThreadId, threadId);
    assert.equal(codexAppServerAgentRunSnapshot(session).providerTurnId, turnId);
    assert.equal(session.metadata.session_git_command_actor_scope, "local");
    assert.equal(session.metadata.session_git_command_actor_thread_id, threadId);
    assert.equal(session.metadata.session_git_command_actor_user_key, "local");
    assert.equal(session.metadata.session_git_command_actor_workdir, worktree);

    const workflowDriverUpdatedAt = session.metadata.workflow_driver_updated_at;
    const gitActorUpdatedAt = session.metadata.session_git_command_actor_updated_at;
    const roundOwner = session.metadata.workflow_driver_username;
    const reusedOwnershipResult = await controller.sendMessage(sessionId, {
      originId: "tab:test-reloaded",
      message: "Reuse this round's established owner.",
      vibe64User: {
        username: roundOwner
      }
    }, {
      turnOwnership: {
        reusable: true,
        threadId,
        turnId,
        username: roundOwner
      }
    });
    assert.equal(reusedOwnershipResult.ok, true);
    session = await runtime.getSession(sessionId);
    assert.equal(session.metadata.workflow_driver_updated_at, workflowDriverUpdatedAt);
    assert.equal(session.metadata.session_git_command_actor_updated_at, gitActorUpdatedAt);

    const steerCountBeforeConflict = steerCalls.length;
    const conflictingOwnerResult = await controller.sendMessage(sessionId, {
      originId: "tab:another-user",
      message: "Do not take over another user's round.",
      vibe64User: {
        username: "another-user"
      }
    }, {
      turnOwnership: {
        reusable: false,
        threadId,
        turnId,
        username: roundOwner
      }
    });
    assert.equal(conflictingOwnerResult.ok, false);
    assert.equal(conflictingOwnerResult.operationOutcome, "active_turn_owned_by_another_user");
    assert.equal(conflictingOwnerResult.retryable, true);
    assert.equal(steerCalls.length, steerCountBeforeConflict);

    const gitPromptResult = await controller.sendMessage(sessionId, {
      originId: "tab:test",
      message: "Please commit and push the current changes now."
    });

    assert.equal(gitPromptResult.ok, true);
    assert.equal(steerCalls.at(-1)?.threadId, threadId);
    assert.equal(steerCalls.at(-1)?.turnId, turnId);
    assert.equal(steerCalls.at(-1)?.input, "Please commit and push the current changes now.");
    session = await runtime.getSession(sessionId);
    assert.equal(session.metadata.session_git_command_actor_scope, "local");
    assert.equal(session.metadata.session_git_command_actor_session_id, sessionId);
    assert.equal(session.metadata.session_git_command_actor_thread_id, threadId);
    assert.equal(session.metadata.session_git_command_actor_user_key, "local");
    assert.equal(session.metadata.session_git_command_actor_workdir, worktree);
  });
});

test("Vibe64 Codex app-server messages request a new turn when the tracked turn completed", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "codex_app_server_steer_completed_turn";
    const worktree = testSessionSourcePath(targetRoot, sessionId);
    const threadId = "00000000-0000-4000-8000-000000000127";
    const turnId = "codex-app-server-turn-completed";
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
        ...testSourceMetadataForPath(worktree)
      },
      sessionId
    });
    await runtime.store.writeAgentRunEvent(sessionId, CODEX_APP_SERVER_AGENT_RUN_ID, {
      event: {
        kind: "completed"
      },
      patch: {
        active: false,
        finishedAt: "2026-07-02T07:13:02.631Z",
        provider: "codex",
        providerInterface: "app-server",
        providerStatus: "completed",
        providerThreadId: threadId,
        providerTurnId: turnId,
        state: "completed"
      }
    });
    await mkdir(worktree, {
      recursive: true
    });

    let providerCalled = false;
    const readThreadStatusCalls = [];
    let steerCalled = false;
    const controller = createCodexTerminalController({
      codexAuthPreflight: noopCodexAuthPreflight,
      codexAppServerPromptDeliveryEnabled: true,
      codexAppServerProviderOptions: {
      },
      codexAppServerProviderFactory: () => {
        providerCalled = true;
        return {
          async readThreadStatus(readThreadId) {
            readThreadStatusCalls.push(readThreadId);
            return {
              raw: {
                status: {
                  activeFlags: [],
                  type: "idle"
                }
              }
            };
          },
          async steerTurn() {
            steerCalled = true;
            throw new Error("completed turns must not be steered");
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

    const result = await controller.sendMessage(sessionId, {
      message: "This should be rejected before provider I/O.",
      originId: "tab:test"
    });

    assert.equal(result.ok, true);
    assert.equal(result.delivered, false);
    assert.equal(result.newTurnRequired, true);
    assert.equal(result.operationOutcome, "new_turn_required");
    assert.equal(result.threadId, threadId);
    assert.equal(result.turnId, turnId);
    assert.equal(providerCalled, true);
    assert.deepEqual(readThreadStatusCalls, [threadId]);
    assert.equal(steerCalled, false);
    const conversationLog = await runtime.store.readConversationLog(sessionId);
    assert.equal(conversationLog.length, 0);
    const session = await runtime.getSession(sessionId);
    assert.equal(session.metadata.session_git_command_actor_reason || "", "");
    const stopped = await controller.interruptTurn(sessionId, {
      controlRequestId: "stop-idle-turn",
      originId: "tab:test",
      reason: "user_interrupt"
    });
    assert.equal(stopped.ok, true);
    assert.equal(stopped.interrupted, false);
    assert.equal(stopped.operationOutcome, "already_idle");
  });
});

test("Vibe64 Codex app-server message delivery converts a completed steer race into a new turn", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "codex_app_server_message_completed_race";
    const worktree = testSessionSourcePath(targetRoot, sessionId);
    const threadId = "00000000-0000-4000-8000-000000000129";
    const turnId = "codex-app-server-turn-race";
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
        ...testSourceMetadataForPath(worktree)
      },
      sessionId
    });
    await runtime.store.writeAgentRunEvent(sessionId, CODEX_APP_SERVER_AGENT_RUN_ID, {
      event: {
        kind: "active"
      },
      patch: {
        active: true,
        inputSource: "terminal",
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

    let statusReadCount = 0;
    let steerCalls = 0;
    const controller = createCodexTerminalController({
      codexAuthPreflight: noopCodexAuthPreflight,
      codexAppServerPromptDeliveryEnabled: true,
      codexAppServerProviderOptions: {},
      codexAppServerProviderFactory: () => ({
        async readThreadStatus() {
          statusReadCount += 1;
          return statusReadCount === 1
            ? {
                raw: {
                  activeTurnId: turnId,
                  status: {
                    activeFlags: [],
                    type: "active"
                  }
                }
              }
            : {
                raw: {
                  status: {
                    activeFlags: [],
                    type: "idle"
                  }
                }
              };
        },
        async steerTurn() {
          steerCalls += 1;
          throw Object.assign(new Error("invalid request"), {
            code: -32600,
            method: "turn/steer"
          });
        }
      }),
      projectService: {
        targetRoot,
        async createRuntime() {
          return runtime;
        }
      }
    });

    const result = await controller.sendMessage(sessionId, {
      composerSubmissionId: "composer-message-race",
      message: "Actually, make the protagonist a girl.",
      originId: "tab:test"
    });

    assert.equal(result.ok, true);
    assert.equal(result.delivered, false);
    assert.equal(result.newTurnRequired, true);
    assert.equal(result.operationOutcome, "new_turn_required");
    assert.equal(result.reason, "active_turn_completed_before_delivery");
    assert.equal(steerCalls, 1);
    assert.equal(statusReadCount, 2);
    const session = await runtime.getSession(sessionId);
    assert.equal(codexAppServerAgentRunSnapshot(session).active, false);
    assert.equal(codexAppServerAgentRunSnapshot(session).state, "completed");
  });
});

test("Vibe64 Codex terminal input rebinds same-user reloads and records the writer as the Git actor", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "codex-terminal-writer-git-actor";
    const worktree = testSessionSourcePath(targetRoot, sessionId);
    const runtime = new Vibe64SessionRuntime({
      targetRoot
    });
    await runtime.createSession({
      initialStep: "source_created",
      metadata: {
        ...testSourceMetadataForPath(worktree),
        workflow_driver_origin_id: "tab:ada-before-reload",
        workflow_driver_reason: "test",
        workflow_driver_username: "ada"
      },
      sessionId
    });
    await mkdir(worktree, {
      recursive: true
    });
    const controller = createCodexTerminalController({
      codexAuthPreflight: noopCodexAuthPreflight,
      env: {
        [VIBE64_GITHUB_ACCOUNT_MODE_ENV]: "user"
      },
      projectService: {
        createRuntime() {
          return runtime;
        }
      }
    });
    const namespace = codexTerminalNamespace(sessionId);
    const terminal = startTerminalSession({
      args: [
        "-e",
        "process.stdin.resume(); setInterval(() => {}, 1000);"
      ],
      command: process.execPath,
      commandPreview: "node long-running",
      cwd: worktree,
      metadata: {
        sessionId,
        terminalKind: "codex-terminal",
        workdir: worktree
      },
      namespace
    });

    try {
      const result = await controller.writeTerminal(sessionId, terminal.id, "\r", {
        originId: "tab:ada",
        trackGitActor: true,
        vibe64User: {
          username: "ada"
        }
      });
      assert.equal(result.ok, true);

      const session = await runtime.getSession(sessionId);
      assert.equal(session.metadata.workflow_driver_origin_id, "tab:ada");
      assert.equal(session.metadata.workflow_driver_username, "ada");
      assert.equal(session.metadata.session_git_command_actor_scope, "user");
      assert.equal(session.metadata.session_git_command_actor_user_key, "ada");
      assert.equal(session.metadata.session_git_command_actor_session_id, sessionId);
      assert.equal(session.metadata.session_git_command_actor_target_root, worktree);
      assert.equal(session.metadata.session_git_command_actor_workdir, worktree);
    } finally {
      await closeTerminalSessionsForNamespacePrefix(namespace);
    }
  });
});

test("Vibe64 Codex terminal websocket input writes directly without actor bookkeeping", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "codex-terminal-websocket-input";
    const worktree = testSessionSourcePath(targetRoot, sessionId);
    await mkdir(worktree, {
      recursive: true
    });
    const controller = createCodexTerminalController({
      codexAuthPreflight: noopCodexAuthPreflight,
      projectService: {
        createRuntime() {
          throw new Error("Terminal websocket input must not load the project runtime.");
        }
      }
    });
    const namespace = codexTerminalNamespace(sessionId);
    const terminal = startTerminalSession({
      args: [
        "-e",
        "process.stdin.resume(); setInterval(() => {}, 1000);"
      ],
      command: process.execPath,
      commandPreview: "node long-running",
      cwd: worktree,
      metadata: {
        sessionId,
        terminalKind: "codex-terminal",
        workdir: worktree
      },
      namespace
    });

    try {
      const result = await controller.writeTerminal(sessionId, terminal.id, "a", {
        originId: "tab:ada",
        vibe64User: {
          username: "ada"
        }
      });
      assert.equal(result.ok, true);
    } finally {
      await closeTerminalSessionsForNamespacePrefix(namespace);
    }
  });
});

test("Vibe64 Codex terminal input lets another enabled OS user act without replacing the Git actor", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "codex-terminal-cross-origin-git-actor";
    const worktree = testSessionSourcePath(targetRoot, sessionId);
    const runtime = new Vibe64SessionRuntime({
      targetRoot
    });
    await runtime.createSession({
      initialStep: "source_created",
      metadata: {
        workflow_driver_origin_id: "tab:owner",
        workflow_driver_reason: "test",
        workflow_driver_username: "owner",
        session_git_command_actor_scope: "user",
        session_git_command_actor_session_id: sessionId,
        session_git_command_actor_target_root: worktree,
        session_git_command_actor_user_key: "owner",
        session_git_command_actor_workdir: worktree,
        ...testSourceMetadataForPath(worktree)
      },
      sessionId
    });
    await mkdir(worktree, {
      recursive: true
    });
    const controller = createCodexTerminalController({
      codexAuthPreflight: noopCodexAuthPreflight,
      env: {
        [VIBE64_GITHUB_ACCOUNT_MODE_ENV]: "user"
      },
      projectService: {
        createRuntime() {
          return runtime;
        }
      }
    });
    const namespace = codexTerminalNamespace(sessionId);
    const terminal = startTerminalSession({
      args: [
        "-e",
        "process.stdin.resume(); setInterval(() => {}, 1000);"
      ],
      command: process.execPath,
      commandPreview: "node long-running",
      cwd: worktree,
      metadata: {
        sessionId,
        terminalKind: "codex-terminal",
        workdir: worktree
      },
      namespace
    });

    try {
      const result = await controller.writeTerminal(sessionId, terminal.id, "\r", {
        originId: "tab:intruder",
        trackGitActor: true,
        vibe64User: {
          username: "intruder"
        }
      });
      assert.equal(result.ok, true);

      const session = await runtime.getSession(sessionId);
      assert.equal(session.metadata.workflow_driver_origin_id, "tab:intruder");
      assert.equal(session.metadata.workflow_driver_username, "intruder");
      assert.equal(session.metadata.session_git_command_actor_user_key, "owner");
    } finally {
      await closeTerminalSessionsForNamespacePrefix(namespace);
    }
  });
});

test("Vibe64 Codex app-server interrupt refusal keeps the active turn running", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "codex_app_server_interrupt_refused";
    const worktree = testSessionSourcePath(targetRoot, sessionId);
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
        ...testSourceMetadataForPath(worktree)
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

    const result = await controller.interruptTurn(sessionId, {
      originId: "tab:test"
    });

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

test("Vibe64 Codex app-server interrupt race trusts idle provider state", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "codex_app_server_interrupt_completed_race";
    const worktree = testSessionSourcePath(targetRoot, sessionId);
    const threadId = "00000000-0000-4000-8000-000000000220";
    const turnId = "codex-app-server-turn-interrupt-race";
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
        ...testSourceMetadataForPath(worktree)
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

    const providerCalls = {
      interruptTurn: 0,
      readThreadStatus: 0
    };
    const controller = createCodexTerminalController({
      codexAuthPreflight: noopCodexAuthPreflight,
      codexAppServerPromptDeliveryEnabled: true,
      codexAppServerProviderOptions: {},
      codexAppServerProviderFactory: () => ({
        async ensureAvailable() {
          return {
            ok: true
          };
        },
        async interruptTurn() {
          providerCalls.interruptTurn += 1;
          throw Object.assign(new Error("invalid request"), {
            code: -32600,
            method: "turn/interrupt"
          });
        },
        async readThreadStatus(readThreadId) {
          providerCalls.readThreadStatus += 1;
          assert.equal(readThreadId, threadId);
          return {
            raw: {
              status: {
                activeFlags: [],
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

    const result = await controller.interruptTurn(sessionId, {
      originId: "tab:test"
    });

    assert.equal(result.ok, true);
    assert.equal(result.interrupted, false);
    assert.equal(result.operationOutcome, "already_idle");
    assert.equal(providerCalls.interruptTurn, 1);
    assert.equal(providerCalls.readThreadStatus, 1);
    const session = await runtime.getSession(sessionId);
    assert.equal(codexAppServerAgentRunSnapshot(session).state, "finalizing");
    assert.equal(codexAppServerAgentRunSnapshot(session).providerStatus, "completed");
    await controller.closeAllForSession(sessionId);
  });
});

test("Vibe64 Codex app-server interrupt without a turn id does not mark the run interrupted", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "codex_app_server_interrupt_missing_turn_id";
    const worktree = testSessionSourcePath(targetRoot, sessionId);
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
        ...testSourceMetadataForPath(worktree)
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

    const result = await controller.interruptTurn(sessionId, {
      originId: "tab:test"
    });

    assert.equal(result.ok, false);
    assert.equal(result.operationOutcome, "interrupt_unavailable");
    assert.equal(result.retryable, true);
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

test("Vibe64 Codex app-server preserves active turn id across concurrent status updates before interrupt", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "codex_app_server_preserve_turn_id_before_interrupt";
    const worktree = testSessionSourcePath(targetRoot, sessionId);
    const threadId = "00000000-0000-4000-8000-000000000008";
    const turnId = "codex-app-server-turn-preserved";
    const runtime = new Vibe64SessionRuntime({
      targetRoot
    });
    await runtime.createSession({
      initialStep: "issue_file_created",
      metadata: {
        ...testSourceMetadataForPath(worktree)
      },
      sessionId
    });
    await mkdir(worktree, {
      recursive: true
    });

    let delayNextMutation = false;
    let releaseDelayedMutation;
    let resolveDelayedMutationFinished;
    let resolveDelayedMutationStarted;
    const delayedMutationFinished = new Promise((resolve) => {
      resolveDelayedMutationFinished = resolve;
    });
    const delayedMutationStarted = new Promise((resolve) => {
      resolveDelayedMutationStarted = resolve;
    });
    const originalMutateSession = runtime.store.mutateSession.bind(runtime.store);
    runtime.store.mutateSession = async (...args) => {
      if (!delayNextMutation) {
        return originalMutateSession(...args);
      }
      delayNextMutation = false;
      resolveDelayedMutationStarted();
      await new Promise((resolve) => {
        releaseDelayedMutation = resolve;
      });
      const result = await originalMutateSession(...args);
      resolveDelayedMutationFinished();
      return result;
    };

    const providerCalls = {
      interruptTurn: []
    };
    const providerSubscribers = [];
    const controller = createCodexTerminalController({
      codexAuthPreflight: noopCodexAuthPreflight,
      codexAppServerPromptDeliveryEnabled: true,
      codexAppServerProviderOptions: {
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
          const bootstrap = /VIBE64_SESSION_BOOTSTRAP/u.test(input);
          if (!bootstrap) {
            delayNextMutation = true;
            for (const subscriber of providerSubscribers) {
              subscriber({
                method: "thread/status/changed",
                params: {
                  status: {
                    activeFlags: [],
                    type: "active"
                  },
                  threadId
                }
              });
            }
            await delayedMutationStarted;
            setTimeout(() => {
              releaseDelayedMutation();
            }, 20);
          }
          return {
            id: bootstrap ? "bootstrap-turn" : turnId,
            status: bootstrap ? "completed" : "inProgress"
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
      kind: "agent_prompt_handoff",
      terminalInput: "Vibe64 interactive conversation turn:\nUser/request input:\n- conversationRequest: Preserve this turn id."
    });

    assert.equal(injected.ok, true);
    assert.equal(injected.turnId, turnId);
    assert.ok(providerSubscribers.length >= 1);
    await delayedMutationFinished;

    let session = await runtime.getSession(sessionId);
    assert.equal(codexAppServerAgentRunSnapshot(session).state, "active");
    assert.equal(codexAppServerAgentRunSnapshot(session).providerStatus, "inProgress");
    assert.equal(codexAppServerAgentRunSnapshot(session).providerThreadId, threadId);
    assert.equal(codexAppServerAgentRunSnapshot(session).providerTurnId, turnId);

    const interrupted = await controller.interruptTurn(sessionId, {
      originId: "tab:test"
    });

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

test("Vibe64 Codex app-server checks live provider state before releasing a failed turn", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "codex_app_server_failure_event_active_provider";
    const worktree = testSessionSourcePath(targetRoot, sessionId);
    const threadId = "00000000-0000-4000-8000-000000000219";
    const turnId = "codex-app-server-turn-still-active";
    const runtime = new Vibe64SessionRuntime({
      targetRoot
    });
    await runtime.createSession({
      initialStep: "maintenance_conversation",
      metadata: {
        agent_identity_conversation_id: threadId,
        agent_identity_provider: "codex",
        agent_identity_resume_strategy: "provider-native",
        agent_identity_status: "ready",
        agent_identity_workdir: worktree,
        agent_transport_id: "codex_app_server",
        ...testSourceMetadataForPath(worktree)
      },
      sessionId,
      workflowDefinition: MAINTENANCE_WORKFLOW_DEFINITION_IDS.NON_COMMIT_MAINTENANCE
    });
    await runtime.store.writeStepState(sessionId, "maintenance_conversation", {
      inputPrompt: "Waiting for Codex.",
      schemaVersion: 1,
      status: "awaiting_agent_result"
    });
    await mkdir(worktree, {
      recursive: true
    });

    let providerThreadStatus = "active";
    const providerSubscribers = [];
    const publishedSessionEvents = [];
    const readThreadStatusCalls = [];
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

    const controller = createCodexTerminalController({
      codexAuthPreflight: noopCodexAuthPreflight,
      codexAppServerActiveReconcileMs: 60_000,
      codexAppServerPromptDeliveryEnabled: true,
      codexAppServerProviderOptions: {
      },
      codexAppServerProviderFactory: () => ({
        async ensureAvailable() {
          return {
            ok: true
          };
        },
        async listLoadedThreads() {
          return {
            data: [
              threadId
            ]
          };
        },
        async readThreadStatus(readThreadId) {
          readThreadStatusCalls.push(readThreadId);
          return {
            raw: {
              activeTurnId: turnId,
              status: {
                activeFlags: [],
                type: providerThreadStatus
              }
            }
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
      },
      publishSessionChanged: async (_publishedSessionId, event = {}) => {
        publishedSessionEvents.push(event);
      }
    });

    const reconciled = await controller.reconcileThreads([sessionId]);

    assert.equal(reconciled.ok, true, JSON.stringify(reconciled));
    assert.equal(providerSubscribers.length, 1);
    assert.deepEqual(readThreadStatusCalls, [threadId]);
    readThreadStatusCalls.length = 0;

    providerSubscribers[0]({
      method: "thread/status/changed",
      params: {
        error: {
          message: "False failure event."
        },
        status: {
          type: "failed"
        },
        threadId,
        turnId
      }
    });

    await waitForCondition(
      () => readThreadStatusCalls.length >= 1,
      "Timed out waiting for Codex app-server status release guard."
    );

    const session = await runtime.getSession(sessionId);
    const run = codexAppServerAgentRunSnapshot(session);

    assert.deepEqual(readThreadStatusCalls, [threadId]);
    assert.equal(run.active, true);
    assert.equal(run.state, "active");
    assert.equal(run.providerStatus, "inProgress");
    assert.equal(run.providerThreadId, threadId);
    assert.equal(run.providerTurnId, turnId);
    assert.equal(run.error, "");
    assert.equal(session.stepMachine?.status, "awaiting_agent_result");

    providerThreadStatus = "failed";
    const failedReconciliation = await controller.reconcileThreads([sessionId]);
    assert.equal(failedReconciliation.ok, true);
    const idleEvent = publishedSessionEvents.findLast((event) => (
      event.reason === "codex-app-server-turn-idle"
    ));
    assert.ok(idleEvent, "Expected the failed Codex turn to publish its idle state.");
    assert.equal(idleEvent.payload?.clientRefresh?.includeLaunchTargets, true);
  });
});

test("Vibe64 Codex app-server ignores late completion after user interrupt", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "codex_app_server_late_complete_after_interrupt";
    const worktree = testSessionSourcePath(targetRoot, sessionId);
    const threadId = "00000000-0000-4000-8000-000000000007";
    const turnId = "codex-app-server-turn-interrupted";
    const runtime = new Vibe64SessionRuntime({
      targetRoot
    });
    await runtime.createSession({
      initialStep: "issue_file_created",
      metadata: {
        ...testSourceMetadataForPath(worktree)
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
      kind: "agent_prompt_handoff",
      terminalInput: "Vibe64 interactive conversation turn:\nUser/request input:\n- conversationRequest: Draft this issue."
    });

    assert.equal(injected.ok, true);
    assert.equal(injected.turnId, turnId);
    assert.ok(providerSubscribers.length >= 1);

    const interrupted = await controller.interruptTurn(sessionId, {
      originId: "tab:test"
    });

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
      "codex-app-server-user-message-owned",
      "codex-app-server-turn-active",
      "codex-app-server-turn-idle"
    ]);
    assert.deepEqual(codexAppServerAgentRunSnapshot(session).pendingUserMessageClientIds, []);
  });
});

test("Vibe64 Codex app-server ignores transient assistant items after interruption", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "codex_app_server_duplicate_stale_result";
    const worktree = testSessionSourcePath(targetRoot, sessionId);
    const threadId = "00000000-0000-4000-8000-000000000018";
    const turnId = "codex-app-server-turn-stale-duplicates";
    const runtime = new Vibe64SessionRuntime({
      targetRoot
    });
    await runtime.createSession({
      initialStep: "issue_file_created",
      metadata: {
        ...testSourceMetadataForPath(worktree)
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
      kind: "agent_prompt_handoff",
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

    const interrupted = await controller.interruptTurn(sessionId, {
      originId: "tab:test"
    });

    assert.equal(interrupted.ok, true);
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
    await delay(20);

    const session = await runtime.getSession(sessionId);
    assert.equal(codexAppServerAgentRunSnapshot(session).state, "interrupted");
    assert.equal(codexAppServerAgentRunSnapshot(session).providerStatus, "interrupted");
    assert.match(codexAppServerAgentRunSnapshot(session).error, /Stopped by user/u);
    assert.equal(
      (await runtime.store.readConversationLog(sessionId)).some((turn) => (
        turn.assistant?.text === "Late assistant result after interruption."
      )),
      false
    );
    await controller.closeAllForSession(sessionId);
  });
});

test("Vibe64 Codex app-server rejects completion writes that lose the interrupt race", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "codex_app_server_completion_loses_interrupt_race";
    const worktree = testSessionSourcePath(targetRoot, sessionId);
    const threadId = "00000000-0000-4000-8000-000000000009";
    const turnId = "codex-app-server-turn-race";
    const runtime = new Vibe64SessionRuntime({
      targetRoot
    });
    await runtime.createSession({
      initialStep: "issue_file_created",
      metadata: {
        ...testSourceMetadataForPath(worktree)
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
      kind: "agent_prompt_handoff",
      terminalInput: "Vibe64 interactive conversation turn:\nUser/request input:\n- conversationRequest: Race this completion."
    });

    assert.equal(injected.ok, true);
    assert.equal(injected.turnId, turnId);
    assert.ok(providerSubscribers.length >= 1);
    const activeSnapshot = structuredClone(await runtime.getSession(sessionId));

    const interrupted = await controller.interruptTurn(sessionId, {
      originId: "tab:test"
    });

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
      "codex-app-server-user-message-owned",
      "codex-app-server-turn-active",
      "codex-app-server-turn-idle"
    ]);
    assert.deepEqual(codexAppServerAgentRunSnapshot(session).pendingUserMessageClientIds, []);
  });
});

test("Vibe64 command terminal host args wrap commands in a host startup script", () => {
  const args = commandTerminalHostArgs({
    args: [
      "-lc",
      "npm test"
    ],
    command: "bash"
  });

  assert.deepEqual(args.slice(0, 1), [
    "-lc"
  ]);
  const startupScript = args[1];
  assert.match(startupScript, /umask 0007/u);
  assert.match(startupScript, /bash -lc 'npm test'/u);
  assert.doesNotMatch(startupScript, /--network|toolchain/u);
});

test("Vibe64 command terminal host args do not synthesize GitHub config paths", () => {
  const args = commandTerminalHostArgs({
    args: [
      "status"
    ],
    command: "git"
  });

  assert.equal(args.some((arg) => String(arg).includes("GH_CONFIG_DIR=")), false);
  assert.equal(args.some((arg) => String(arg).includes("GIT_CONFIG_GLOBAL=")), false);
});

test("Vibe64 command terminal composes GitHub transport and safe directories", () => {
  const targetRoot = "/workspace/project";
  const worktree = "/workspace/project/sessions/active/unit/source";
  const env = applyGitSafeDirectoriesToEnv(githubSshToHttpsGitEnv(), [
      targetRoot,
      worktree
  ]);

  assert.equal(env.GIT_CONFIG_COUNT, "4");
  assert.equal(env.GIT_CONFIG_KEY_0, "url.https://github.com/.insteadOf");
  assert.equal(env.GIT_CONFIG_KEY_1, "url.https://github.com/.insteadOf");
  assert.equal(env.GIT_CONFIG_KEY_2, "safe.directory");
  assert.equal(env.GIT_CONFIG_VALUE_2, targetRoot);
  assert.equal(env.GIT_CONFIG_KEY_3, "safe.directory");
  assert.equal(env.GIT_CONFIG_VALUE_3, worktree);
});

test("Vibe64 command terminal resolves session Git actors to real OS homes", async () => {
  const username = userInfo().username;
  const home = homedir();

  const userHome = await resolveCommandTerminalToolHome({
    env: {
      [VIBE64_GITHUB_ACCOUNT_MODE_ENV]: "user"
    },
    session: testSessionGitCommandActor({
      targetRoot: "/workspace/project",
      username
    })
  });
  assert.equal(userHome.ok, true);
  assert.equal(userHome.credentialScope, "user");
  assert.equal(userHome.githubToolHomeSource, home);
  assert.equal(userHome.toolHomeSource, home);
  assert.deepEqual(userHome.owner, {
    githubCredentialScope: "user",
    githubToolHomeSource: home,
    ownerScope: "user",
    ownerUserKey: username
  });

  const logs = [];
  assert.equal((await resolveCommandTerminalToolHome({
    env: {
      [VIBE64_GITHUB_ACCOUNT_MODE_ENV]: "user"
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
    session: testSessionGitCommandActor({
      targetRoot: "/workspace/project",
      username
    }),
    terminalKind: "command"
  })).ok, true);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].fields.event, "vibe64.github_credential_home.resolved");
  assert.equal(logs[0].fields.accountMode, "user");
  assert.equal(Object.hasOwn(logs[0].fields, "credentialScope"), true);
  assert.equal(Object.hasOwn(logs[0].fields, "ownerUserKey"), true);
  assert.equal(logs[0].fields.terminalKind, "command");
  assert.equal(logs[0].fields.operation, "unit_command");
  assert.equal(Object.hasOwn(logs[0].fields, "toolHomeSource"), false);

  const localHome = await resolveCommandTerminalToolHome({
    session: testSessionGitCommandActor({
      scope: "local",
      targetRoot: "/workspace/project"
    })
  });
  assert.equal(localHome.ok, true);
  assert.equal(localHome.credentialScope, "app");
  assert.equal(localHome.githubToolHomeSource, home);
  assert.equal(localHome.toolHomeSource, home);

  const noGithubHome = await resolveCommandTerminalToolHome({
    env: {
      [VIBE64_GITHUB_ACCOUNT_MODE_ENV]: "user"
    },
    session: {
      metadata: {
        workflow_repository_profile: WORKFLOW_REPOSITORY_PROFILE_CANONICAL_GIT
      },
      sessionId: "managed-session",
      targetRoot: "/workspace/project"
    }
  });
  assert.equal(noGithubHome.ok, true);
  assert.equal(noGithubHome.githubToolHomeSource, "");
  assert.equal(noGithubHome.toolHomeSource, home);

  const missingActor = await resolveCommandTerminalToolHome({
    env: {
      [VIBE64_GITHUB_ACCOUNT_MODE_ENV]: "user"
    },
    session: {
      metadata: {
        workflow_repository_profile: WORKFLOW_REPOSITORY_PROFILE_GITHUB_PR
      },
      sessionId: "github-pr-session",
      targetRoot: "/workspace/project"
    }
  });
  assert.equal(missingActor.ok, false);
  assert.match(missingActor.error, /GitHub command actor/i);
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
    const alphaProjectLocalRoot = projectRuntimeRoot(alphaRoot);
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
    const alphaProjectLocalRoot = projectRuntimeRoot(alphaRoot);
    const alphaNamespace = `vibe64-launch-target:project:alpha:${runId}`;
    const betaNamespace = `vibe64-launch-target:project:beta:${runId}`;
    const alphaUnscopedNamespace = `project-setup-doctor:${runId}:alpha`;
    const betaUnscopedNamespace = `project-setup-doctor:${runId}:beta`;
    const projectEvents = [];
    const sessionListOptions = [];
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
            async listSessionSummaries(options = {}) {
              sessionListOptions.push(options);
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
      assert.deepEqual(sessionListOptions, [
        {
          statusGroup: "open"
        }
      ]);
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
    const alphaProjectLocalRoot = projectRuntimeRoot(alphaRoot);
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

test("Vibe64 open Codex reconciliation lists only open project sessions", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const alphaRoot = path.join(targetRoot, "alpha");
    const alphaProjectLocalRoot = projectRuntimeRoot(alphaRoot);
    const sessionListOptions = [];
    await mkdir(alphaRoot, {
      recursive: true
    });
    await writeProjectRuntimeOpenState({
      projectLocalRoot: alphaProjectLocalRoot,
      projectSlug: "alpha",
      reason: "unit-open",
      targetRoot: alphaRoot
    });
    const terminalService = createTestTerminalService({
      projectService: {
        targetRoot: alphaRoot,
        currentProjectLocalRoot() {
          return alphaProjectLocalRoot;
        },
        async createRuntime() {
          return {
            async listSessionSummaries(options = {}) {
              sessionListOptions.push(options);
              return [];
            }
          };
        }
      }
    });

    const result = await runWithProjectRequestContext({
      projectLocalRoot: alphaProjectLocalRoot,
      slug: "alpha",
      targetRoot: alphaRoot
    }, () => terminalService.reconcileOpenAgentSessions({
      reason: "unit-test"
    }));

    assert.equal(result.ok, true);
    assert.deepEqual(sessionListOptions[0], {
      statusGroup: "open"
    });
    assert.deepEqual(sessionListOptions[1], {
      statusGroup: "all"
    });
  });
});

test("Vibe64 project reconciliation closes runtime when the open marker is missing", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runId = crypto.randomUUID();
    const alphaRoot = path.join(targetRoot, "alpha");
    const alphaProjectLocalRoot = projectRuntimeRoot(alphaRoot);
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
      }, () => terminalService.reconcileOpenAgentSessions());

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
    const alphaProjectLocalRoot = projectRuntimeRoot(alphaRoot);
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
    const alphaProjectLocalRoot = projectRuntimeRoot(alphaRoot);
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
        },
        runInProjectContext(slug, operation) {
          return runWithProjectRequestContext({
            projectLocalRoot: alphaProjectLocalRoot,
            projectRuntimeRoot: alphaProjectLocalRoot,
            slug,
            targetRoot: alphaRoot
          }, operation);
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
    const alphaProjectLocalRoot = projectRuntimeRoot(alphaRoot);
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
        },
        runInProjectContext(slug, operation) {
          return runWithProjectRequestContext({
            projectLocalRoot: alphaProjectLocalRoot,
            projectRuntimeRoot: alphaProjectLocalRoot,
            slug,
            targetRoot: alphaRoot
          }, operation);
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

test("Vibe64 command terminal allows another enabled OS user at controller access", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const username = userInfo().username;
    const home = homedir();
    const sessionId = "unit-session";
    const namespace = commandTerminalNamespace(sessionId);
    const controller = createCommandTerminalController({
      env: {
        [VIBE64_GITHUB_ACCOUNT_MODE_ENV]: "user"
      },
      projectService: {
        async createRuntime() {
          return {};
        }
      }
    });
    const owner = terminalOwnerForGithubActor({
      accountMode: "user",
      vibe64User: {
        home,
        username
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
        home,
        username
      }
    };

    try {
      for (const result of [
        controller.readTerminal(sessionId, terminal.id, wrongUserInput),
        controller.writeTerminal(sessionId, terminal.id, "input", wrongUserInput),
        await controller.closeTerminal(sessionId, terminal.id, wrongUserInput)
      ]) {
        assert.equal(result.ok, true);
      }
    } finally {
      await closeTerminalSessionsForNamespacePrefix(namespace);
    }
  });
});

test("Vibe64 project tool terminal runs with the actor real OS home", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const username = userInfo().username;
    const home = homedir();
    const terminalCalls = [];
    const controller = createProjectToolTerminalController({
      ensureRuntimeNetwork: async () => null,
      env: {
        [VIBE64_GITHUB_ACCOUNT_MODE_ENV]: "user"
      },
      projectService: {
        async createRuntime() {
          return {};
        }
      },
      runCommand(request) {
        const args = typeof request.args === "function"
          ? request.args({
              id: "unit-project-tool-terminal"
            })
          : request.args;
        const env = request.env({
          id: "unit-project-tool-terminal"
        });
        terminalCalls.push({
          args,
          env,
          metadata: request.terminal.metadata,
          namespace: request.terminal.namespace,
          request
        });
        return {
          args,
          id: "unit-project-tool-terminal",
          metadata: request.terminal.metadata,
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
        home,
        username
      }
    });

    assert.equal(result.ok, true);
    assert.equal(terminalCalls.length, 1);
    assert.equal(terminalCalls[0].request.actor, "owner-user");
    assert.equal(terminalCalls[0].request.userKey, username);
    assert.deepEqual(terminalCalls[0].request.credentialHome, {
      home,
      username
    });
    assert.equal(Object.values(terminalCalls[0].request.credentialHome).some((value) => String(value).includes("provider-homes")), false);
    assert.equal("GH_CONFIG_DIR" in terminalCalls[0].env, false);
    assert.equal("GIT_CONFIG_GLOBAL" in terminalCalls[0].env, false);
    assert.equal(terminalCalls[0].namespace, toolTerminalNamespace("unit-tool"));
    assert.equal(terminalCalls[0].metadata.terminalOwner.ownerScope, "user");
    assert.equal(terminalCalls[0].metadata.terminalOwner.ownerUserKey, username);

    const localCalls = [];
    const localController = createProjectToolTerminalController({
      ensureRuntimeNetwork: async () => null,
      env: {},
      projectService: {
        async createRuntime() {
          return {};
        }
      },
      runCommand(request) {
        const args = typeof request.args === "function"
          ? request.args({
              id: "unit-project-tool-local-terminal"
            })
          : request.args;
        const env = request.env({
          id: "unit-project-tool-local-terminal"
        });
        localCalls.push({
          args,
          env,
          metadata: request.terminal.metadata,
          request
        });
        return {
          args,
          id: "unit-project-tool-local-terminal",
          metadata: request.terminal.metadata,
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
    assert.equal(Object.values(localCalls[0].request.credentialHome || {}).some((value) => String(value).includes("provider-homes")), false);
    assert.equal(localCalls[0].metadata.terminalOwner.ownerScope, "local");
    assert.equal(localCalls[0].metadata.terminalOwner.ownerUserKey, username);
  });
});

test("Vibe64 session-bound project tool terminal preserves and uses the session Git command actor", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "project-tool-session";
    const username = userInfo().username;
    const home = homedir();
    const metadataWrites = [];
    const terminalCalls = [];
    const controller = createProjectToolTerminalController({
      ensureRuntimeNetwork: async () => null,
      env: {
        [VIBE64_GITHUB_ACCOUNT_MODE_ENV]: "user"
      },
      projectService: {
        async createRuntime({ input } = {}) {
          assert.equal(input?.sessionId, sessionId);
          return {
            async getSession(requestedSessionId) {
              assert.equal(requestedSessionId, sessionId);
              return testSessionGitCommandActor({
                sessionId,
                targetRoot,
                username
              });
            },
            store: {
              async mutateSession(_sessionId, operation) {
                return operation();
              },
              async writeMetadataValue(_sessionId, name, value) {
                metadataWrites.push({
                  name,
                  value
                });
              }
            }
          };
        }
      },
      runCommand(request) {
        const args = typeof request.args === "function"
          ? request.args({
              id: "unit-project-tool-session-terminal"
            })
          : request.args;
        const env = request.env({
          id: "unit-project-tool-session-terminal"
        });
        terminalCalls.push({
          args,
          env,
          metadata: request.terminal.metadata,
          request
        });
        return {
          args,
          id: "unit-project-tool-session-terminal",
          metadata: request.terminal.metadata,
          ok: true
        };
      }
    });

    const result = await controller.startPreparedRun("unit-tool", {
      input: {},
      sessionId,
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
    }, testWorkflowInput({
      vibe64User: {
        home,
        username
      }
    }));

    assert.equal(result.ok, true);
    assert.equal(terminalCalls.length, 1);
    assert.equal(Object.values(terminalCalls[0].request.credentialHome || {}).some((value) => String(value).includes("provider-homes")), false);
    assert.equal(terminalCalls[0].request.actor, "owner-user");
    assert.equal(terminalCalls[0].request.userKey, username);
    assert.deepEqual(terminalCalls[0].request.credentialHome, {
      home: userInfo().homedir || homedir(),
      username
    });
    assert.equal(terminalCalls[0].metadata.terminalOwner.ownerScope, "user");
    assert.equal(terminalCalls[0].metadata.terminalOwner.ownerUserKey, username);
    assert.equal(metadataWrites.find((entry) => entry.name === "session_git_command_actor_user_key")?.value, username);
    assert.equal(metadataWrites.find((entry) => entry.name === "session_git_command_actor_reason")?.value, "project-tool:unit-tool");
  });
});

test("Vibe64 project tool terminal allows another enabled OS user at controller access", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const username = userInfo().username;
    const home = homedir();
    const namespace = toolTerminalNamespace("unit-tool");
    const controller = createProjectToolTerminalController({
      env: {
        [VIBE64_GITHUB_ACCOUNT_MODE_ENV]: "user"
      },
      projectService: {
        async createRuntime() {
          return {};
        }
      }
    });
    const owner = terminalOwnerForGithubActor({
      accountMode: "user",
      vibe64User: {
        home,
        username
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
      const result = controller.readTerminal("unit-tool", terminal.id, {
        vibe64User: {
          home,
          username
        }
      });
      assert.equal(result.ok, true);
    } finally {
      await closeTerminalSessionsForNamespacePrefix(namespace);
    }
  });
});

test("Vibe64 command terminal action forwards the authenticated user", async () => {
  const action = terminalFeatureActions.find((entry) => entry.id === ACTION_START_COMMAND_TERMINAL);
  const calls = [];
  const result = await action.execute({
    actionId: "create_source",
    originId: TEST_WORKFLOW_ORIGIN_ID,
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
        actionId: "create_source",
        advanceOnSuccess: false,
        input: undefined,
        originId: TEST_WORKFLOW_ORIGIN_ID,
        vibe64User: {
          email: "ada@example.com"
        }
      },
      sessionId: "unit-session"
    }
  ]);
});

test("Vibe64 terminal env includes JSKIT managed MariaDB client defaults when selected", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await writeFile(path.join(targetRoot, ".env"), `DB_HOST=${JSKIT_MARIADB_HOST}\n`, "utf8");
    const configDir = path.join(targetRoot, "vibe64.project.json");
    const env = await loadProjectExecutionEnv({
      projectService: {
        async projectConfigEnvironment() {
          return {
            VIBE64_PROJECT_MANIFEST: configDir
          };
        },
        async projectRuntimeConfigEnvironment() {
          return {
            DB_CLIENT: "mysql2",
            DB_HOST: JSKIT_MARIADB_HOST,
            DB_NAME: path.basename(targetRoot).replace(/[^A-Za-z0-9_]+/gu, "_"),
            DB_PASSWORD: UNIT_DATABASE_PASSWORD,
            DB_PORT: jskitMariaDbHostPort(),
            DB_USER: "vibe64_dev_app"
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

    assert.equal(env.VIBE64_PROJECT_MANIFEST, configDir);
    assert.equal(env.DB_HOST, JSKIT_MARIADB_HOST);
    assert.equal(env.DB_PASSWORD, UNIT_DATABASE_PASSWORD);
    assert.equal(env.DB_PORT, jskitMariaDbHostPort());
    assert.equal(env.DB_USER, "vibe64_dev_app");
    assert.equal(env.DB_NAME, path.basename(targetRoot).replace(/[^A-Za-z0-9_]+/gu, "_"));
  });
});

test("Codex runtime context applies gateway shared tool cache policy", async () => {
  const env = await loadProjectExecutionEnv({
    projectService: {
      async projectConfigEnvironment() {
        return {
          PLAYWRIGHT_BROWSERS_PATH: "/tmp/project-wrong-playwright",
          VIBE64_SHARED_CACHE_ROOT: "/tmp/project-wrong-cache"
        };
      },
      async projectRuntimeConfigEnvironment() {
        return {
          PLAYWRIGHT_BROWSERS_PATH: "/tmp/runtime-wrong-playwright",
          VIBE64_SHARED_CACHE_ROOT: "/tmp/runtime-wrong-cache"
        };
      }
    },
    target: "codex",
    targetRoot: "/tmp/vibe64-terminal-shared-tools"
  });

  const codexContext = codexRuntimeContext({
    env: {},
    home: "/home/v64d_tenant",
    terminalEnv: env,
    username: "v64d_tenant"
  });
  assert.equal(codexContext.ok, true);
  assert.equal(codexContext.terminalEnv.VIBE64_SHARED_CACHE_ROOT, undefined);
  assert.equal(codexContext.terminalEnv.PLAYWRIGHT_BROWSERS_PATH, undefined);
  assert.equal(codexContext.terminalProcessEnv.VIBE64_SHARED_CACHE_ROOT, "/var/cache/vibe64");
  assert.equal(codexContext.terminalProcessEnv.PLAYWRIGHT_BROWSERS_PATH, "/opt/vibe64/runtime-packs/playwright/browsers");
});

test("Vibe64 terminal env includes JSKIT managed MariaDB client defaults when config selects MariaDB", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const env = await loadProjectExecutionEnv({
      projectService: {
        async projectRuntimeConfigEnvironment() {
          return {
            DB_CLIENT: "mysql2",
            DB_HOST: JSKIT_MARIADB_HOST,
            DB_NAME: path.basename(targetRoot).replace(/[^A-Za-z0-9_]+/gu, "_"),
            DB_PASSWORD: UNIT_DATABASE_PASSWORD,
            DB_PORT: jskitMariaDbHostPort(),
            DB_USER: "vibe64_dev_app"
          };
        }
      },
      runtime: {
        adapter: new JskitTargetAdapter(),
        projectConfig: {
          values: {
            jskit_database_runtime: "mariadb"
          }
        }
      },
      session: {
        targetRoot
      },
      target: "shell",
      targetRoot
    });

    assert.equal(env.DB_HOST, JSKIT_MARIADB_HOST);
    assert.equal(env.DB_PASSWORD, UNIT_DATABASE_PASSWORD);
    assert.equal(env.DB_PORT, jskitMariaDbHostPort());
    assert.equal(env.DB_USER, "vibe64_dev_app");
    assert.equal(env.DB_NAME, path.basename(targetRoot).replace(/[^A-Za-z0-9_]+/gu, "_"));
  });
});

test("Vibe64 terminal env skips managed MariaDB client defaults when unmanaged", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const env = await loadProjectExecutionEnv({
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

    assert.equal(env.DB_HOST, undefined);
    assert.equal(env.DB_PASSWORD, undefined);
  });
});

test("Vibe64 terminal env requests server runtime config for source shells", async () => {
  const calls = [];
  const sourcePathValue = "/tmp/vibe64-source/sessions/active/terminal-env/source";
  const env = await loadProjectExecutionEnv({
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
      sessionId: "terminal-env",
      metadata: testSourceMetadataForPath(sourcePathValue)
    },
    target: "worktree",
    targetRoot: "/tmp/vibe64-target"
  });

  assert.equal(env.APP_PUBLIC_URL, "http://localhost:3000");
  assert.deepEqual(calls.map((call) => call.phases), [[RUNTIME_CONFIG_PHASES.SERVER]]);
  assert.equal(calls[0].sourcePath, sourcePathValue);
  assert.equal(calls[0].target, RUNTIME_CONFIG_TARGETS.SERVER);
});

test("Vibe64 terminal env requests server runtime config for Codex terminals", async () => {
  assert.deepEqual(runtimeConfigPhasesForTerminalTarget("codex"), [
    RUNTIME_CONFIG_PHASES.SERVER
  ]);
  assert.deepEqual(runtimeConfigPhasesForTerminalTarget("fix-codex"), [
    RUNTIME_CONFIG_PHASES.SERVER
  ]);
  assert.deepEqual(runtimeConfigPhasesForTerminalTarget("launch-target"), [
    RUNTIME_CONFIG_PHASES.PREVIEW,
    RUNTIME_CONFIG_PHASES.SERVER
  ]);

  const calls = [];
  const env = await loadProjectExecutionEnv({
    projectService: {
      async projectConfigEnvironment() {
        return {
          VIBE64_PROJECT_MANIFEST: "/tmp/session-source/vibe64.project.json"
        };
      },
      async projectRuntimeConfigEnvironment(input = {}) {
        calls.push(input);
        return {
          APP_PUBLIC_URL: "http://localhost:3000",
          DB_CLIENT: "mysql2",
          DB_HOST: "127.0.0.1",
          DB_NAME: "codex_terminal_runtime_env"
        };
      }
    },
    runtime: {
      adapter: new JskitTargetAdapter(),
      projectConfig: {
        values: {
          jskit_database_runtime: "mariadb"
        }
      }
    },
    session: {
      sessionId: "codex-terminal-runtime-env",
      metadata: {
        source_path: "/tmp/session-source"
      },
      targetRoot: "/tmp/session-source"
    },
    target: "codex",
    targetRoot: "/tmp/session-source"
  });

  assert.equal(env.VIBE64_PROJECT_MANIFEST, "/tmp/session-source/vibe64.project.json");
  assert.equal(env.APP_PUBLIC_URL, "http://localhost:3000");
  assert.equal(env.DB_HOST, "127.0.0.1");
  assert.equal(env.DB_NAME, "codex_terminal_runtime_env");

  const codexContext = codexRuntimeContext({
    env: {},
    home: "/home/v64d_tenant",
    terminalEnv: env,
    username: "v64d_tenant"
  });
  assert.equal(codexContext.ok, true);
  assert.equal(codexContext.terminalEnv.DB_HOST, env.DB_HOST);
  assert.equal(codexContext.terminalEnv.DB_NAME, env.DB_NAME);
  assert.equal(codexContext.terminalEnv.MYSQL_HOST, env.DB_HOST);
  assert.equal(codexContext.terminalEnv.MYSQL_DATABASE, env.DB_NAME);
  assert.equal(codexContext.terminalProcessEnv.DB_HOST, env.DB_HOST);
  assert.equal(codexContext.terminalProcessEnv.MYSQL_DATABASE, env.DB_NAME);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].phases, [RUNTIME_CONFIG_PHASES.SERVER]);
  assert.equal(calls[0].sourcePath, "/tmp/session-source");
  assert.equal(calls[0].target, RUNTIME_CONFIG_TARGETS.SERVER);
});

test("Vibe64 terminal env requests project config env for the session source", async () => {
  const calls = [];
  const env = await loadProjectExecutionEnv({
    projectService: {
      async projectConfigEnvironment(input = {}) {
        calls.push(input);
        return {
          VIBE64_CONFIG_SOURCE: input.sessionId || ""
        };
      }
    },
    session: {
      sessionId: "terminal-env-session-source",
      targetRoot: "/tmp/vibe64-terminal-env-source"
    },
    target: "launch-target",
    targetRoot: "/tmp/vibe64-terminal-env-source"
  });

  assert.equal(env.VIBE64_CONFIG_SOURCE, "terminal-env-session-source");
  assert.deepEqual(calls, [
    {
      sessionId: "terminal-env-session-source"
    }
  ]);
});

test("Vibe64 command terminal process receives native database client env and shared tool env", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const namespace = `unit-command-gateway-env-${crypto.randomUUID()}`;
    const marker = "VIBE64_COMMAND_ENV:";
    const result = await startCommandTerminalProcess({
      namespace,
      namespaceLimitPrefix: namespace,
      projectService: {
        async projectConfigEnvironment() {
          return {};
        },
        async projectRuntimeConfigEnvironment() {
          return {
            DB_CLIENT: "mysql2",
            DB_HOST: "127.0.0.1",
            DB_NAME: "command_terminal_db",
            DB_PASSWORD: "command-secret",
            DB_PORT: "24712",
            DB_USER: "vibe64_dev_app",
            PLAYWRIGHT_BROWSERS_PATH: "/tmp/wrong-command-playwright"
          };
        }
      },
      runtime: {
        adapter: {
          id: "unit"
        },
        projectConfig: {}
      },
      session: {
        sessionId: "command-terminal-env",
        targetRoot
      },
      spec: {
        args: [
          "-e",
          [
            `console.log(${JSON.stringify(marker)} + JSON.stringify({`,
            "dbHost: process.env.DB_HOST,",
            "dbName: process.env.DB_NAME,",
            "mysqlHost: process.env.MYSQL_HOST,",
            "mysqlDatabase: process.env.MYSQL_DATABASE,",
            "mysqlPassword: process.env.MYSQL_PWD,",
            "browsers: process.env.PLAYWRIGHT_BROWSERS_PATH",
            "}));"
          ].join("")
        ],
        command: process.execPath,
        cwd: targetRoot,
        runtimeConfigPhases: [RUNTIME_CONFIG_PHASES.SERVER]
      },
      target: "command",
      targetRoot
    });

    assert.equal(result.ok, true, result.error || "");
    try {
      await waitForCondition(() => {
        const snapshot = readTerminalSession(result.id, {
          namespace
        });
        return String(snapshot.output || "").includes(marker);
      }, "Command terminal did not print its gateway-resolved env.");
      const snapshot = readTerminalSession(result.id, {
        namespace
      });
      const line = String(snapshot.output || "").split(/\r?\n/u)
        .find((candidate) => candidate.includes(marker)) || "";
      const payload = JSON.parse(line.slice(line.indexOf(marker) + marker.length));
      assert.deepEqual(payload, {
        browsers: "/opt/vibe64/runtime-packs/playwright/browsers",
        dbHost: "127.0.0.1",
        dbName: "command_terminal_db",
        mysqlDatabase: "command_terminal_db",
        mysqlHost: "127.0.0.1",
        mysqlPassword: "command-secret"
      });
    } finally {
      await closeTerminalSession(result.id, {
        namespace
      });
    }
  });
});

test("Vibe64 command terminal forwards explicit runtimes through GitHub gateway commands", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    let startedRequest = null;
    const result = await startCommandTerminalProcess({
      action: {
        id: "install_dependencies",
        label: "Get app ready"
      },
      metadata: {
        terminalOwner: {
          githubCredentialScope: "user",
          ownerScope: "user",
          ownerUserKey: userInfo().username
        }
      },
      namespace: "unit-command-terminal-runtimes",
      namespaceLimitPrefix: "unit-command-terminal-runtimes",
      projectService: {
        async projectConfigEnvironment() {
          return {};
        },
        async projectRuntimeConfigEnvironment() {
          return {};
        }
      },
      runCommand: async (request = {}) => {
        startedRequest = request;
        return {
          id: "terminal-1",
          ok: true,
          status: "running"
        };
      },
      runtime: {
        adapter: {
          id: "unit"
        },
        projectConfig: {}
      },
      session: {
        sessionId: "command-terminal-runtimes",
        targetRoot
      },
      spec: {
        args: ["-lc", "npm install --foreground-scripts --no-audit --no-fund"],
        command: "bash",
        commandPreview: "npm install --foreground-scripts --no-audit --no-fund",
        cwd: targetRoot,
        requiresHostGithubCredentials: true,
        runtimes: ["node22"]
      },
      target: "command",
      targetRoot,
      toolHomeSource: homedir()
    });

    assert.equal(result.ok, true);
    assert.equal(startedRequest.purpose, "github");
    assert.equal(startedRequest.gitTransport, "github-https");
    assert.deepEqual(startedRequest.runtimes, ["node22"]);
  });
});

test("Vibe64 terminal env does not treat create-source cwd as a session source", async () => {
  const runtimeConfigCalls = [];
  const env = await loadProjectExecutionEnv({
    projectService: {
      async projectConfigEnvironment(input = {}) {
        return {
          VIBE64_CONFIG_SESSION: input.sessionId || ""
        };
      },
      async projectRuntimeConfigEnvironment(input = {}) {
        runtimeConfigCalls.push(input);
        return {
          APP_PUBLIC_URL: "http://localhost:3000"
        };
      }
    },
    session: {
      sessionId: "seed-session"
    },
    spec: {
      cwd: "/var/lib/vibe64/merc/projects/smoke"
    },
    target: "command",
    targetRoot: "/var/lib/vibe64/merc/projects/smoke"
  });

  assert.equal(env.VIBE64_CONFIG_SESSION, "seed-session");
  assert.equal(env.APP_PUBLIC_URL, undefined);
  assert.deepEqual(runtimeConfigCalls, []);
});

test("Vibe64 command terminal start does not pass project-home cwd as sourcePath", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtimeConfigCalls = [];
    const startedTerminals = [];
    const result = await startCommandTerminalProcess({
      namespace: "unit-command-terminal",
      namespaceLimitPrefix: "unit-command-terminal",
      projectService: {
        async projectConfigEnvironment() {
          return {};
        },
        async projectRuntimeConfigEnvironment(input = {}) {
          runtimeConfigCalls.push(input);
          return {};
        }
      },
      runtime: {
        adapter: {
          id: "unit"
        }
      },
      session: {
        sessionId: "seed-session",
        targetRoot
      },
      spec: {
        args: ["-lc", "true"],
        command: "bash",
        cwd: targetRoot
      },
      runCommand: commandTerminalTestRunCommand(async (options = {}) => {
        startedTerminals.push(options);
        return {
          id: "terminal-1",
          ok: true,
          status: "running"
        };
      }),
      target: "command",
      targetRoot
    });

    assert.equal(result.ok, true);
    assert.equal(startedTerminals.length, 1);
    assert.deepEqual(runtimeConfigCalls, []);
  });
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

  assert.deepEqual(runtimeConfigPhasesForTerminalContext({
    action: {
      id: "create_source"
    },
    spec: {
      runtimeConfigPhases: false
    },
    target: "command"
  }), []);
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

    let closePromise = Promise.resolve();
    let startedCommand = "";
    let startedArgs = [];
    let startedEnv = {};
    const publishedSessionChanges = [];
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
      projectService: {
        targetRoot,
        async createRuntime() {
          return runtime;
        },
        async projectConfigEnvironment() {
          return {
            VIBE64_PROJECT_MANIFEST: path.join(targetRoot, "vibe64.project.json")
          };
        }
      },
      publishSessionChanged: async (sessionId, event = {}) => {
        publishedSessionChanges.push({
          event,
          sessionId
        });
      },
      runCommand: commandTerminalTestRunCommand((options) => {
        const id = "unit-command-terminal";
        assert.equal(options.maxRunning, 1);
        assert.equal(options.reuseRunning, false);
        startedCommand = options.command;
        startedArgs = options.args({
          id,
          namespace: options.namespace
        });
        startedEnv = options.env({
          id,
          namespace: options.namespace
        });
        assert.match(options.metadata.attemptedCommand, /^bash -lc /u);
        assert.match(options.metadata.attemptedCommand, /dynamic_done/u);
        const resultFilePath = startedEnv[COMMAND_RESULT_ENV];
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
      })
    });

    const terminal = await command.startTerminal("terminal_success", testWorkflowInput({
      actionId: "unit_command",
      input: {
        dryRun: true
      }
    }));
    assert.equal(terminal.ok, true);
    await closePromise;
    await delay(5);
    assert.equal(startedCommand, "bash");
    assert.match(startedArgs[1], /exec bash -lc/u);

    const updatedSession = await runtime.getSession("terminal_success");
    assert.equal(updatedSession.metadata.terminal_done, "yes");
    assert.equal(updatedSession.metadata.dynamic_done, "from-result-file");
    assert.equal(updatedSession.metadata.stale_value, undefined);
    await waitForArrayLength(successfulCommandHooks, 1);
    await waitForArrayLength(publishedSessionChanges, 1);
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
    assert.equal(publishedSessionChanges[0].sessionId, "terminal_success");
    assert.equal(publishedSessionChanges[0].event.reason, "command-terminal-closed");
    assert.deepEqual(publishedSessionChanges[0].event.payload, {
      clientRefresh: {
        includeLaunchTargets: true
      }
    });
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

test("Vibe64 command terminal runs GitHub credential commands on the host", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionSourceRoot = path.join(targetRoot, "sessions", "active", "terminal_host_github");
    const sessionSourcePath = path.join(sessionSourceRoot, "source");
    class HostGithubCommandAdapter extends UnitCommandAdapter {
      async createCommandTerminalSpec(commandId, context = {}) {
        const spec = await super.createCommandTerminalSpec(commandId, context);
        return {
          ...spec,
          requiresHostGithubCredentials: true,
          runtimes: ["node22"],
          successMetadata: {
            ...spec.successMetadata,
            source_cache_path: path.join(targetRoot, "git-cache", "repository.git"),
            source_path: sessionSourcePath
          }
        };
      }
    }
    await mkdir(sessionSourceRoot, {
      recursive: true
    });
    const runtime = new Vibe64SessionRuntime({
      adapter: new HostGithubCommandAdapter(),
      targetRoot,
      workflow: {
        id: "unit-terminal-host-github",
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
        workflow_repository_profile: WORKFLOW_REPOSITORY_PROFILE_GITHUB_PR
      },
      sessionId: "terminal_host_github"
    });

    let closePromise = Promise.resolve();
    let startedArgs = [];
    let startedCommand = "";
    let startedEnv = {};
    let startedMetadata = {};
    let startedRequest = {};
    let startedResultDirectoryMode = null;
    const command = createCommandTerminalController({
      env: await commandTerminalTestEnv(targetRoot),
      projectService: {
        targetRoot,
        async createRuntime() {
          return runtime;
        },
        async projectConfigEnvironment() {
          return {};
        }
      },
      runCommand: (request) => {
        const id = "unit-host-github-terminal";
        startedRequest = request;
        startedCommand = request.command;
        startedArgs = request.args({
          id,
          namespace: request.terminal.namespace
        });
        startedEnv = request.env({
          id,
          namespace: request.terminal.namespace
        });
        startedMetadata = request.terminal.metadata;
        closePromise = (async () => {
          const resultDirectory = path.dirname(startedEnv[COMMAND_RESULT_ENV]);
          startedResultDirectoryMode = (await stat(resultDirectory)).mode & 0o7777;
          await writeFile(
            startedEnv[COMMAND_RESULT_ENV],
            "fact:set\tdynamic_done\tZnJvbS1ob3N0LXJlc3VsdA==\n",
            "utf8"
          );
          await request.terminal.onClose({
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

    const terminal = await command.startTerminal("terminal_host_github", testWorkflowInput({
      actionId: "unit_command"
    }));

    assert.equal(terminal.ok, true);
    await closePromise;
    await delay(25);
    assert.equal(startedCommand, "bash");
    assert.deepEqual(startedArgs.slice(0, 2), ["-lc", startedArgs[1]]);
    assert.match(startedArgs[1], /umask 0007/u);
    assert.match(startedArgs[1], /exec bash -lc/u);
    const realHome = userInfo().homedir || homedir();
    assert.deepEqual(startedRequest.credentialHome, {
      home: realHome,
      username: userInfo().username
    });
    assert.equal(startedRequest.purpose, "github");
    assert.equal(startedRequest.gitTransport, "github-https");
    assert.deepEqual(startedRequest.runtimes, ["node22"]);
    assert.equal(path.dirname(path.dirname(startedEnv[COMMAND_RESULT_ENV])), sessionSourceRoot);
    assert.equal(startedResultDirectoryMode, SHARED_COMMAND_RESULT_DIRECTORY_MODE);
    assert.deepEqual(startedRequest.gitSafeDirectories, [
      targetRoot,
      sessionSourcePath,
      path.join(targetRoot, "git-cache", "repository.git")
    ]);
    assert.equal(startedEnv.VIBE64_HOST_UID, String(process.getuid?.() ?? ""));
    assert.equal(startedEnv.VIBE64_HOST_GID, String(process.getgid?.() ?? ""));
    assert.equal(startedMetadata.terminalExecution, "gateway");
    assert.equal(startedMetadata.image, undefined);

    const updatedSession = await runtime.getSession("terminal_host_github");
    assert.equal(updatedSession.metadata.dynamic_done, "from-host-result");
    assert.deepEqual((await runtime.store.readCommandLog("terminal_host_github")).map((entry) => ({
      actionId: entry.actionId,
      actionLabel: entry.actionLabel,
      actionType: entry.actionType,
      kind: entry.kind,
      status: entry.status,
      stepId: entry.stepId
    })), [
      {
        actionId: "unit_command",
        actionLabel: "Unit command",
        actionType: "command",
        kind: "terminal-action",
        status: "completed",
        stepId: "unit_step"
      }
    ]);
  });
});

test("Vibe64 command terminal uses host user helper for another GitHub OS user", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionSourceRoot = path.join(targetRoot, "sessions", "active", "terminal_host_github_helper");
    const sessionSourcePath = path.join(sessionSourceRoot, "source");
    class HostGithubCommandAdapter extends UnitCommandAdapter {
      async createCommandTerminalSpec(commandId, context = {}) {
        const spec = await super.createCommandTerminalSpec(commandId, context);
        return {
          ...spec,
          requiresHostGithubCredentials: true,
          successMetadata: {
            ...spec.successMetadata,
            source_path: sessionSourcePath
          }
        };
      }
    }
    await mkdir(sessionSourceRoot, {
      recursive: true
    });
    const runtime = new Vibe64SessionRuntime({
      adapter: new HostGithubCommandAdapter(),
      targetRoot,
      workflow: {
        id: "unit-terminal-host-github-helper",
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
        workflow_repository_profile: WORKFLOW_REPOSITORY_PROFILE_GITHUB_PR
      },
      sessionId: "terminal_host_github_helper"
    });

    const helperPath = "/tmp/vibe64-exec-helper-unit";
    const otherUid = (typeof process.getuid === "function" ? process.getuid() : 1000) + 1;
    const otherGid = (typeof process.getgid === "function" ? process.getgid() : 1000) + 1;
    const otherHome = path.join(targetRoot, "homes", "member");
    await mkdir(otherHome, {
      recursive: true
    });

    let closePromise = Promise.resolve();
    let startedArgs = [];
    let startedEnv = {};
    let startedRequest = {};
    let startedResultDirectoryMode = null;
    const command = createCommandTerminalController({
      env: {
        VIBE64_HOST_USER_EXEC_HELPER_PATH: helperPath
      },
      projectService: {
        targetRoot,
        async createRuntime() {
          return runtime;
        },
        async projectConfigEnvironment() {
          return {};
        }
      },
      resolveCommandTerminalToolHomeImpl: async () => ({
        credentialScope: "user",
        githubToolHomeSource: otherHome,
        hostGid: otherGid,
        hostUid: otherUid,
        ok: true,
        owner: {
          githubCredentialScope: "user",
          githubToolHomeSource: otherHome,
          ownerScope: "user",
          ownerUserKey: "member"
        },
        toolHomeSource: otherHome
      }),
      runCommand: (request) => {
        const id = "unit-host-github-helper-terminal";
        startedRequest = request;
        startedArgs = request.args({
          id,
          namespace: request.terminal.namespace
        });
        startedEnv = request.env({
          id,
          namespace: request.terminal.namespace
        });
        closePromise = (async () => {
          const resultDirectory = path.dirname(startedEnv[COMMAND_RESULT_ENV]);
          startedResultDirectoryMode = (await stat(resultDirectory)).mode & 0o7777;
          await writeFile(
            startedEnv[COMMAND_RESULT_ENV],
            "fact:set\tdynamic_done\tZnJvbS1oZWxwZXItcmVzdWx0\n",
            "utf8"
          );
          await request.terminal.onClose({
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

    const terminal = await command.startTerminal("terminal_host_github_helper", testWorkflowInput({
      actionId: "unit_command",
      vibe64User: {
        gid: otherGid,
        home: otherHome,
        role: "member",
        uid: otherUid,
        username: "member"
      }
    }));

    assert.equal(terminal.ok, true);
    await closePromise;
    await delay(25);
    assert.equal(startedRequest.actor, "owner-user");
    assert.equal(startedRequest.userKey, "member");
    assert.equal(startedRequest.command, "bash");
    assert.equal(startedRequest.mode, "pty");
    assert.equal(startedRequest.purpose, "github");
    assert.equal(startedRequest.gitTransport, "github-https");
    assert.deepEqual(startedRequest.credentialHome, {
      home: otherHome,
      username: "member"
    });
    assert.match(startedArgs[1], /umask 0007/u);
    assert.equal(startedEnv.VIBE64_HOST_UID, String(otherUid));
    assert.equal(startedEnv.VIBE64_HOST_GID, String(otherGid));
    assert.equal(path.dirname(path.dirname(startedEnv[COMMAND_RESULT_ENV])), sessionSourceRoot);
    assert.equal(startedResultDirectoryMode, SHARED_COMMAND_RESULT_DIRECTORY_MODE);
    assert.deepEqual(startedRequest.gitSafeDirectories, [
      targetRoot,
      sessionSourcePath
    ]);
    assert.equal(startedRequest.terminal.metadata.terminalExecution, "gateway");
    assert.equal(startedRequest.terminal.metadata.image, undefined);

    const updatedSession = await runtime.getSession("terminal_host_github_helper");
    assert.equal(updatedSession.metadata.dynamic_done, "from-helper-result");
  });
});

test("Vibe64 command terminal uses host user helper for another OS user on non-GitHub commands", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionSourceRoot = path.join(targetRoot, "sessions", "active", "terminal_host_user_helper");
    const sessionSourcePath = path.join(sessionSourceRoot, "source");
    await mkdir(sessionSourceRoot, {
      recursive: true
    });
    const runtime = new Vibe64SessionRuntime({
      adapter: new UnitCommandAdapter(),
      targetRoot,
      workflow: {
        id: "unit-terminal-host-user-helper",
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
        source_path: sessionSourcePath,
        workflow_repository_profile: WORKFLOW_REPOSITORY_PROFILE_GITHUB_PR
      },
      sessionId: "terminal_host_user_helper"
    });

    const helperPath = "/tmp/vibe64-exec-helper-unit";
    const otherUid = (typeof process.getuid === "function" ? process.getuid() : 1000) + 1;
    const otherGid = (typeof process.getgid === "function" ? process.getgid() : 1000) + 1;
    const otherHome = path.join(targetRoot, "homes", "member");
    await mkdir(otherHome, {
      recursive: true
    });

    let closePromise = Promise.resolve();
    let startedArgs = [];
    let startedEnv = {};
    let startedRequest = {};
    let startedResultDirectoryMode = null;
    const command = createCommandTerminalController({
      env: {
        VIBE64_HOST_USER_EXEC_HELPER_PATH: helperPath
      },
      projectService: {
        targetRoot,
        async createRuntime() {
          return runtime;
        },
        async projectConfigEnvironment() {
          return {};
        }
      },
      resolveCommandTerminalToolHomeImpl: async () => ({
        credentialScope: "user",
        githubToolHomeSource: otherHome,
        hostGid: otherGid,
        hostUid: otherUid,
        ok: true,
        owner: {
          githubCredentialScope: "user",
          githubToolHomeSource: otherHome,
          ownerScope: "user",
          ownerUserKey: "member"
        },
        toolHomeSource: otherHome
      }),
      runCommand: (request) => {
        const id = "unit-host-user-helper-terminal";
        startedRequest = request;
        startedArgs = request.args({
          id,
          namespace: request.terminal.namespace
        });
        startedEnv = request.env({
          id,
          namespace: request.terminal.namespace
        });
        closePromise = (async () => {
          const resultDirectory = path.dirname(startedEnv[COMMAND_RESULT_ENV]);
          startedResultDirectoryMode = (await stat(resultDirectory)).mode & 0o7777;
          await writeFile(
            startedEnv[COMMAND_RESULT_ENV],
            "fact:set\tdynamic_done\tZnJvbS11c2VyLWhlbHBlci1yZXN1bHQ=\n",
            "utf8"
          );
          await request.terminal.onClose({
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

    const terminal = await command.startTerminal("terminal_host_user_helper", testWorkflowInput({
      actionId: "unit_command",
      vibe64User: {
        gid: otherGid,
        home: otherHome,
        role: "member",
        uid: otherUid,
        username: "member"
      }
    }));

    assert.equal(terminal.ok, true);
    await closePromise;
    await delay(25);
    assert.equal(startedRequest.actor, "owner-user");
    assert.equal(startedRequest.userKey, "member");
    assert.equal(startedRequest.command, "bash");
    assert.equal(startedRequest.mode, "pty");
    assert.equal(startedRequest.purpose, "github");
    assert.equal(startedRequest.gitTransport, "github-https");
    assert.deepEqual(startedRequest.credentialHome, {
      home: otherHome,
      username: "member"
    });
    assert.match(startedArgs[1], /umask 0007/u);
    assert.equal(startedEnv.VIBE64_HOST_UID, String(otherUid));
    assert.equal(startedEnv.VIBE64_HOST_GID, String(otherGid));
    assert.equal(path.dirname(path.dirname(startedEnv[COMMAND_RESULT_ENV])), sessionSourceRoot);
    assert.equal(startedResultDirectoryMode, SHARED_COMMAND_RESULT_DIRECTORY_MODE);
    assert.deepEqual(startedRequest.gitSafeDirectories, [
      targetRoot,
      sessionSourcePath
    ]);
    assert.equal(startedRequest.terminal.metadata.terminalExecution, "gateway");

    const updatedSession = await runtime.getSession("terminal_host_user_helper");
    assert.equal(updatedSession.metadata.dynamic_done, "from-user-helper-result");
  });
});

test("Vibe64 command terminal runs local commands as the app actor", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionSourceRoot = path.join(targetRoot, "sessions", "active", "terminal_local_app_actor");
    const sessionSourcePath = path.join(sessionSourceRoot, "source");
    await mkdir(sessionSourceRoot, {
      recursive: true
    });
    const runtime = new Vibe64SessionRuntime({
      adapter: new UnitCommandAdapter(),
      targetRoot,
      workflow: {
        id: "unit-terminal-local-app-actor",
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
        source_path: sessionSourcePath
      },
      sessionId: "terminal_local_app_actor"
    });

    let closePromise = Promise.resolve();
    let startedEnv = {};
    let startedRequest = {};
    const command = createCommandTerminalController({
      env: await commandTerminalTestEnv(targetRoot),
      projectService: {
        targetRoot,
        async createRuntime() {
          return runtime;
        },
        async projectConfigEnvironment() {
          return {};
        }
      },
      runCommand: (request) => {
        const id = "unit-local-app-actor-terminal";
        startedRequest = request;
        startedEnv = request.env({
          id,
          namespace: request.terminal.namespace
        });
        closePromise = (async () => {
          await writeFile(
            startedEnv[COMMAND_RESULT_ENV],
            "fact:set\tdynamic_done\tZnJvbS1hcHAtYWN0b3ItcmVzdWx0\n",
            "utf8"
          );
          await request.terminal.onClose({
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

    const terminal = await command.startTerminal("terminal_local_app_actor", testWorkflowInput({
      actionId: "unit_command"
    }));

    assert.equal(terminal.ok, true);
    await closePromise;
    await delay(25);
    assert.equal(startedRequest.actor, "app");
    assert.equal(startedRequest.userKey, "runtime");
    assert.equal(startedRequest.command, "bash");
    assert.equal(startedRequest.mode, "pty");
    assert.equal(startedRequest.purpose, "terminal");
    assert.equal(startedRequest.gitTransport, "none");
    assert.equal(startedRequest.envPolicy, "project");
    assert.equal(startedRequest.terminal.metadata.terminalExecution, "gateway");

    const updatedSession = await runtime.getSession("terminal_local_app_actor");
    assert.equal(updatedSession.metadata.dynamic_done, "from-app-actor-result");
  });
});

test("host GitHub command path policy is derived from command metadata", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sourcePath = path.join(targetRoot, "sessions", "active", "unit-session", "source");
    const cachePath = path.join(targetRoot, "git-cache", "repository.git");
    const safeDirectories = commandTerminalGitSafeDirectories({
      session: {
        metadata: {
          source_cache_path: cachePath
        }
      },
      spec: {
        successMetadata: {
          main_checkout_root: targetRoot,
          source_cache_path: cachePath,
          source_path: sourcePath
        }
      },
      targetRoot,
      workdir: targetRoot
    });
    assert.deepEqual(safeDirectories, [
      targetRoot,
      sourcePath,
      cachePath
    ]);

    const env = applyGitSafeDirectoriesToEnv({
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "credential.helper",
      GIT_CONFIG_VALUE_0: ""
    }, safeDirectories);
    assert.equal(env.GIT_CONFIG_COUNT, "4");
    assert.equal(env.GIT_CONFIG_KEY_1, "safe.directory");
    assert.equal(env.GIT_CONFIG_VALUE_1, targetRoot);
    assert.equal(env.GIT_CONFIG_KEY_2, "safe.directory");
    assert.equal(env.GIT_CONFIG_VALUE_2, sourcePath);
    assert.equal(env.GIT_CONFIG_KEY_3, "safe.directory");
    assert.equal(env.GIT_CONFIG_VALUE_3, cachePath);
  });
});

test("host GitHub command result files are allocated beside managed session source", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sourceRoot = path.join(targetRoot, "sessions", "active", "unit-session");
    const sourcePath = path.join(sourceRoot, "source");
    await mkdir(sourceRoot, {
      recursive: true
    });

    const directoryRoot = commandResultDirectoryRoot({
      spec: {
        successMetadata: {
          source_path: sourcePath
        }
      },
      targetRoot
    });
    const resultFile = createCommandResultFileSync({
      directoryMode: SHARED_COMMAND_RESULT_DIRECTORY_MODE,
      directoryRoot
    });
    const info = await stat(resultFile.directory);
    assert.equal(directoryRoot, sourceRoot);
    assert.equal(path.dirname(resultFile.directory), sourceRoot);
    assert.equal(info.mode & 0o7777, SHARED_COMMAND_RESULT_DIRECTORY_MODE);
  });
});

test("host GitHub command result files for Git cache refresh are allocated beside project cache", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const cachePath = path.join(targetRoot, "git-cache", "repository.git");
    const directoryRoot = commandResultDirectoryRoot({
      spec: {
        successMetadata: {
          source_cache_path: cachePath
        }
      },
      targetRoot: ""
    });
    const resultFile = createCommandResultFileSync({
      directoryMode: SHARED_COMMAND_RESULT_DIRECTORY_MODE,
      directoryRoot
    });
    const info = await stat(resultFile.directory);
    assert.equal(directoryRoot, targetRoot);
    assert.equal(path.dirname(resultFile.directory), targetRoot);
    assert.equal(info.mode & 0o7777, SHARED_COMMAND_RESULT_DIRECTORY_MODE);
  });
});

test("Vibe64 command terminal claims one active execution per session", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    let closeTerminal = async () => null;
    let startCount = 0;
    const { command, runtime } = await commandTerminalFixture(targetRoot, {
      actions: [
        unitCommandDefinition(),
        unitCommandDefinition({
          id: "second_unit_command",
          label: "Second unit command"
        })
      ],
      runCommand: commandTerminalTestRunCommand((options) => {
        startCount += 1;
        const id = `unit-command-duplicate-terminal-${startCount}`;
        const terminalEnv = options.env({
          id,
          namespace: options.namespace
        });
        const resultFilePath = terminalEnv[COMMAND_RESULT_ENV];
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
      }),
      sessionId: "terminal_duplicate_claim"
    });

    const first = await command.startTerminal("terminal_duplicate_claim", testWorkflowInput({
      actionId: "unit_command"
    }));
    assert.equal(first.ok, true);
    assert.equal(startCount, 1);

    const runningDuplicate = await command.startTerminal("terminal_duplicate_claim", testWorkflowInput({
      actionId: "unit_command"
    }));
    assert.equal(runningDuplicate.ok, true);
    assert.equal(runningDuplicate.code, "vibe64_command_execution_claimed");
    assert.equal(runningDuplicate.commandLifecycleId, "1-unit_command-001");
    assert.equal(runningDuplicate.operationOutcome, "command_already_running");
    assert.equal(runningDuplicate.refreshRecommended, true);
    assert.equal(runningDuplicate.terminalSessionId, "unit-command-duplicate-terminal-1");
    assert.equal(startCount, 1);

    const runningOtherAction = await command.startTerminal("terminal_duplicate_claim", testWorkflowInput({
      actionId: "second_unit_command"
    }));
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

    const finishedDuplicate = await command.startTerminal("terminal_duplicate_claim", testWorkflowInput({
      actionId: "unit_command"
    }));
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
    const terminalStarted = deferred();
    const terminalReleased = deferred();
    let startCount = 0;
    const { command, runtime } = await commandTerminalFixture(targetRoot, {
      runCommand: commandTerminalTestRunCommand(async () => {
        startCount += 1;
        terminalStarted.resolve();
        await terminalReleased.promise;
        return {
          id: "unit-command-delayed-terminal",
          ok: true,
          status: "running"
        };
      }),
      sessionId: "terminal_duplicate_starting"
    });

    const first = command.startTerminal("terminal_duplicate_starting", testWorkflowInput({
      actionId: "unit_command"
    }));
    await terminalStarted.promise;

    const duplicate = command.startTerminal("terminal_duplicate_starting", testWorkflowInput({
      actionId: "unit_command"
    }));
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

test("Vibe64 command terminal makes a lost server terminal retryable", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    let startCount = 0;
    const publishedSessionChanges = [];
    const { command, runtime } = await commandTerminalFixture(targetRoot, {
      publishSessionChanged: async (sessionId, event) => {
        publishedSessionChanges.push({
          event,
          sessionId
        });
      },
      readTerminalSessionImpl: () => ({
        code: "terminal_session_not_found",
        error: "Terminal session not found.",
        ok: false
      }),
      runCommand: commandTerminalTestRunCommand((options) => {
        assert.equal(options.detachedIdleTimeoutMs, 30 * 60 * 1000);
        startCount += 1;
        return {
          id: `unit-command-lost-terminal-${startCount}`,
          ok: true,
          status: "running"
        };
      }),
      sessionId: "terminal_lost"
    });

    const first = await command.startTerminal("terminal_lost", testWorkflowInput({
      actionId: "unit_command"
    }));
    assert.equal(first.ok, true);
    assert.equal(startCount, 1);

    const lost = await command.startTerminal("terminal_lost", testWorkflowInput({
      actionId: "unit_command"
    }));
    assert.equal(lost.ok, false);
    assert.equal(lost.code, "vibe64_command_terminal_lost");
    assert.equal(lost.operationOutcome, "command_interrupted");
    assert.equal(startCount, 1);

    const lifecycle = await runtime.store.readCommandLifecycle("terminal_lost", "1-unit_command-001");
    assert.equal(lifecycle.phase, "failed");
    assert.equal(lifecycle.outcome, "failed");
    assert.equal(lifecycle.terminalStatus, "missing");
    assert.equal(publishedSessionChanges.at(-1).event.reason, "command-terminal-lost");

    const retry = await command.startTerminal("terminal_lost", testWorkflowInput({
      actionId: "unit_command"
    }));
    assert.equal(retry.ok, true);
    assert.equal(retry.id, "unit-command-lost-terminal-2");
    assert.equal(startCount, 2);

    const missingSubscription = await command.subscribeTerminal(
      "terminal_lost",
      "unit-command-lost-terminal-2",
      () => null
    );
    assert.equal(missingSubscription.code, "terminal_session_not_found");
    const retryLifecycle = await runtime.store.readCommandLifecycle("terminal_lost", "1-unit_command-002");
    assert.equal(retryLifecycle.phase, "failed");
    assert.equal(retryLifecycle.terminalStatus, "missing");
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
            VIBE64_PROJECT_MANIFEST: path.join(targetRoot, "vibe64.project.json")
          };
        }
      },
      runCommand: commandTerminalTestRunCommand((options) => {
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
      })
    });

    const terminal = await command.startTerminal("terminal_failure_context", testWorkflowInput({
      actionId: "unit_command"
    }));
    assert.equal(terminal.ok, true);

    await closeTerminal();
    await waitForCondition(async () => {
      const lifecycle = await runtime.store.readCommandLifecycle("terminal_failure_context", "1-unit_command-001");
      return lifecycle?.phase === "done" &&
        lifecycle?.outcome === "blocked" &&
        lifecycle?.postCommit?.publishSessionChanged === "done";
    }, "Expected failed command lifecycle context to finish before teardown.");

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
            VIBE64_PROJECT_MANIFEST: path.join(targetRoot, "vibe64.project.json")
          };
        }
      },
      runCommand: commandTerminalTestRunCommand((options) => {
        startCount += 1;
        const id = `unit-command-retry-terminal-${startCount}`;
        const terminalEnv = options.env({
          id,
          namespace: options.namespace
        });
        const resultFilePath = terminalEnv[COMMAND_RESULT_ENV];
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
      })
    });

    const first = await command.startTerminal("terminal_failure_retry", testWorkflowInput({
      actionId: "unit_command"
    }));
    assert.equal(first.ok, true);
    assert.equal(startCount, 1);
    await closeTerminal();
    await waitForCondition(async () => {
      const lifecycle = await runtime.store.readCommandLifecycle("terminal_failure_retry", "1-unit_command-001");
      return lifecycle?.phase === "done" &&
        lifecycle?.outcome === "blocked" &&
        lifecycle?.postCommit?.publishSessionChanged === "done";
    }, "Expected failed command lifecycle to finish as blocked.");

    const retry = await command.startTerminal("terminal_failure_retry", testWorkflowInput({
      actionId: "unit_command"
    }));
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
            VIBE64_PROJECT_MANIFEST: path.join(targetRoot, "vibe64.project.json")
          };
        }
      },
      runCommand: commandTerminalTestRunCommand((options) => {
        const id = "unit-command-metadata-race-terminal";
        const terminalEnv = options.env({
          id,
          namespace: options.namespace
        });
        const resultFilePath = terminalEnv[COMMAND_RESULT_ENV];
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
      })
    });

    const terminal = await command.startTerminal("terminal_metadata_race", testWorkflowInput({
      actionId: "unit_command"
    }));
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
            VIBE64_PROJECT_MANIFEST: path.join(targetRoot, "vibe64.project.json")
          };
        }
      },
      publishSessionChanged: async () => {
        publishStarted.resolve();
        await publishReleased.promise;
      },
      runCommand: commandTerminalTestRunCommand((options) => {
        const id = "unit-command-post-commit-terminal";
        const terminalEnv = options.env({
          id,
          namespace: options.namespace
        });
        const resultFilePath = terminalEnv[COMMAND_RESULT_ENV];
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
      })
    });

    try {
      const terminal = await command.startTerminal("terminal_post_commit", testWorkflowInput({
        actionId: "unit_command"
      }));
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
            VIBE64_PROJECT_MANIFEST: path.join(targetRoot, "vibe64.project.json")
          };
        }
      },
      runCommand: commandTerminalTestRunCommand((options) => {
        const id = "unit-command-stale-terminal";
        const terminalEnv = options.env({
          id,
          namespace: options.namespace
        });
        const resultFilePath = terminalEnv[COMMAND_RESULT_ENV];
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
      })
    });

    const terminal = await command.startTerminal("terminal_stale_close", testWorkflowInput({
      actionId: "unit_command"
    }));
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

    const prompt = await service.startCommandTerminal("terminal_blocked", testWorkflowInput({
      actionId: "unit_prompt"
    }));
    assert.equal(prompt.ok, false);
    assert.match(prompt.error, /does not run in the command terminal/u);

    const disabled = await service.startCommandTerminal("terminal_blocked", testWorkflowInput({
      actionId: "blocked_command"
    }));
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
            VIBE64_PROJECT_MANIFEST: path.join(targetRoot, "vibe64.project.json")
          };
        }
      },
      runCommand: commandTerminalTestRunCommand((options) => {
        const id = "unit-command-advance-terminal";
        const terminalEnv = options.env({
          id,
          namespace: options.namespace
        });
        const resultFilePath = terminalEnv[COMMAND_RESULT_ENV];
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
      })
    });

    const terminal = await command.startTerminal("terminal_advance", testWorkflowInput({
      actionId: "unit_command",
      advanceOnSuccess: true
    }));
    assert.equal(terminal.ok, true);
    await closePromise;

    const session = await runtime.getSession("terminal_advance");
    assert.equal(session.currentStep, "next_step");
    assert.deepEqual(session.completedSteps, ["unit_step"]);
    await waitForArrayLength(hookSteps, 1);
    assert.deepEqual(hookSteps, ["next_step"]);
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
      agentTerminalClosed: publisher("agent"),
      commandTerminalClosed: publisher("command"),
      launchTargetClosed: publisher("launch-close"),
      launchTargetStopped: publisher("launch-stop")
    }
  });

  await service.closeAgentTerminal("publish_session", "missing-codex");
  await service.closeCommandTerminal("publish_session", "missing-command");
  await service.closeLaunchTargetTerminal("publish_session", "missing-launch-close");
  await service.stopLaunchTargetTerminal("publish_session", "missing-launch-stop");

  assert.deepEqual(published, [
    {
      kind: "agent",
      reason: "agent-terminal-closed",
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
    }
  ]);
});

test("Vibe64 project tool action forwards source selection input", async () => {
  const action = terminalFeatureActions.find((item) => item.id === ACTION_RUN_PROJECT_TOOL);
  const calls = [];

  const result = await action.execute({
    originId: TEST_WORKFLOW_ORIGIN_ID,
    parameters: {
      mode: "dry-run"
    },
    sessionId: "source-session",
    sourcePath: "/runtime/projects/catalog/sessions/active/source-session/source",
    toolId: "unit-tool"
  }, {}, {
    featureService: {
      runProjectTool(toolId, input) {
        calls.push({
          input,
          toolId
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
        originId: TEST_WORKFLOW_ORIGIN_ID,
        parameters: {
          mode: "dry-run"
        },
        sessionId: "source-session",
        sourcePath: "/runtime/projects/catalog/sessions/active/source-session/source",
        vibe64User: null
      },
      toolId: "unit-tool"
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
