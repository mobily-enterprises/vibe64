import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  AGENT_PREVIEW_COMMAND_NAME,
  VIBE64_AGENT_PREVIEW_COMMAND_SESSION_ID_ENV,
  VIBE64_AGENT_PREVIEW_COMMAND_SOCKET_ENV,
  VIBE64_AGENT_PREVIEW_COMMAND_TOKEN_ENV,
  createAgentPreviewCommandService,
  prepareAgentPreviewCommand
} from "../../packages/vibe64-terminals/src/server/agentPreviewCommand.js";

const execFileAsync = promisify(execFile);

test("agent preview command ensures the managed preview and waits for readiness", async () => {
  const sessionId = "preview-command-ensure-session";
  const ensureCalls = [];
  const statuses = [
    {
      activeTerminal: {
        id: "launch-terminal-1",
        running: true,
        status: "running"
      },
      lastLaunchTarget: {
        agentHref: "http://vibe64-launch-agent:4100/",
        id: "dev"
      },
      previewTarget: {
        available: false,
        href: ""
      }
    },
    {
      activeTerminal: {
        id: "launch-terminal-1",
        running: true,
        status: "running"
      },
      lastLaunchTarget: {
        agentHref: "http://vibe64-launch-agent:4100/",
        id: "dev"
      },
      openTarget: {
        href: "http://127.0.0.1:4100/"
      },
      previewTarget: {
        available: true,
        href: "/preview/session/",
        targetHref: "http://127.0.0.1:4100/"
      }
    }
  ];
  let statusIndex = 0;
  const command = createAgentPreviewCommandService({
    launchTarget: {
      async ensurePreview(receivedSessionId) {
        ensureCalls.push(receivedSessionId);
        return {
          id: "launch-terminal-1",
          ok: true
        };
      },
      async launchStatus(receivedSessionId) {
        assert.equal(receivedSessionId, sessionId);
        const status = statuses[Math.min(statusIndex, statuses.length - 1)];
        statusIndex += 1;
        return status;
      }
    }
  });

  const result = await command.run({
    args: [
      "ensure",
      "--wait",
      "--json"
    ],
    sessionId
  });

  assert.equal(result.ok, true);
  assert.deepEqual(ensureCalls, [sessionId]);
  assert.deepEqual(JSON.parse(result.stdout), {
    currentPage: null,
    diagnostics: null,
    endpoints: {
      agent: {
        hostname: "vibe64-launch-agent",
        port: 4100,
        url: "http://vibe64-launch-agent:4100/"
      },
      browser: {
        hostname: "127.0.0.1",
        port: 4100,
        url: "http://127.0.0.1:4100/"
      }
    },
    ensured: true,
    launchTargetId: "dev",
    ready: true,
    stale: false,
    terminal: {
      command: "",
      createdAt: "",
      exitCode: null,
      id: "launch-terminal-1",
      running: true,
      status: "running"
    }
  });
});

test("agent preview command restarts the managed launch target with saved input", async () => {
  const sessionId = "preview-command-session";
  const startCalls = [];
  const statuses = [
    {
      activeTerminal: {
        running: true,
        status: "running"
      },
      lastLaunchTarget: {
        agentHref: "http://vibe64-launch-agent:4100/app",
        id: "jskit-dev",
        launchInput: {
          workspaceSlug: "demo"
        }
      },
      previewTarget: {
        available: false,
        href: "",
        stale: true
      }
    },
    {
      activeTerminal: {
        id: "launch-terminal-2",
        running: true,
        status: "running"
      },
      lastLaunchTarget: {
        agentHref: "http://vibe64-launch-agent:4100/app",
        id: "jskit-dev",
        launchInput: {
          workspaceSlug: "demo"
        }
      },
      previewTarget: {
        available: false,
        href: ""
      }
    },
    {
      activeTerminal: {
        id: "launch-terminal-2",
        running: true,
        status: "running"
      },
      lastLaunchTarget: {
        agentHref: "http://vibe64-launch-agent:4100/app",
        id: "jskit-dev",
        launchInput: {
          workspaceSlug: "demo"
        }
      },
      openTarget: {
        href: "http://127.0.0.1:4100/app"
      },
      previewTarget: {
        available: true,
        href: "/preview/session/app",
        targetHref: "http://127.0.0.1:4100/app"
      }
    }
  ];
  let statusIndex = 0;
  const command = createAgentPreviewCommandService({
    launchTarget: {
      async launchStatus(receivedSessionId) {
        assert.equal(receivedSessionId, sessionId);
        const status = statuses[Math.min(statusIndex, statuses.length - 1)];
        statusIndex += 1;
        return status;
      },
      async startTerminal(receivedSessionId, input) {
        startCalls.push({
          input,
          sessionId: receivedSessionId
        });
        return {
          id: "launch-terminal-2",
          ok: true
        };
      }
    }
  });

  const result = await command.run({
    args: [
      "restart",
      "--wait",
      "--json"
    ],
    cwd: "/tmp/project",
    sessionId
  });

  assert.equal(result.ok, true);
  assert.equal(result.exitCode, 0);
  assert.deepEqual(startCalls, [
    {
      input: {
        forceRestart: true,
        launchInput: {
          workspaceSlug: "demo"
        },
        launchTargetId: "jskit-dev"
      },
      sessionId
    }
  ]);
  assert.deepEqual(JSON.parse(result.stdout), {
    currentPage: null,
    diagnostics: null,
    endpoints: {
      agent: {
        hostname: "vibe64-launch-agent",
        port: 4100,
        url: "http://vibe64-launch-agent:4100/app"
      },
      browser: {
        hostname: "127.0.0.1",
        port: 4100,
        url: "http://127.0.0.1:4100/app"
      }
    },
    launchTargetId: "jskit-dev",
    ready: true,
    restarted: true,
    stale: false,
    terminal: {
      command: "",
      createdAt: "",
      exitCode: null,
      id: "launch-terminal-2",
      running: true,
      status: "running"
    }
  });
});

test("agent preview status exposes the managed endpoint, current page, and server logs", async () => {
  const sessionId = "preview-inspection-session";
  const status = {
    activeTerminal: {
      commandPreview: "npm run dev",
      createdAt: "2026-07-13T02:00:00.000Z",
      id: "launch-terminal-7",
      metadata: {
        sessionRoot: "/workspace/session-7"
      },
      output: "server ready\nGET /orders/42\nrender complete",
      running: true,
      status: "running"
    },
    lastLaunchTarget: {
      agentHref: "http://vibe64-launch-agent:4103/",
      id: "jskit-dev"
    },
    openTarget: {
      href: "http://127.0.0.1:4103/"
    },
    previewTarget: {
      available: true,
      href: "/preview/session-7/",
      targetHref: "http://127.0.0.1:4103/"
    }
  };
  const command = createAgentPreviewCommandService({
    launchTarget: {
      async launchStatus(receivedSessionId) {
        assert.equal(receivedSessionId, sessionId);
        return status;
      }
    },
    readSessionUiState(receivedSessionId) {
      assert.equal(receivedSessionId, sessionId);
      return {
        preview: {
          route: "/orders/42?tab=history",
          title: "Order 42",
          updatedAt: "2026-07-13T02:01:00.000Z"
        }
      };
    }
  });

  const statusResult = await command.run({
    args: ["status", "--json"],
    sessionId
  });
  const statusPayload = JSON.parse(statusResult.stdout);
  assert.equal(statusPayload.endpoints.agent.hostname, "vibe64-launch-agent");
  assert.equal(statusPayload.endpoints.agent.port, 4103);
  assert.equal(statusPayload.currentPage.route, "/orders/42?tab=history");
  assert.equal(statusPayload.currentPage.agentUrl, "http://vibe64-launch-agent:4103/orders/42?tab=history");
  assert.equal(statusPayload.currentPage.title, "Order 42");
  assert.deepEqual(statusPayload.diagnostics, {
    latest: "/workspace/session-7/preview-last.json",
    log: "/workspace/session-7/preview-log.jsonl"
  });

  const logsResult = await command.run({
    args: ["logs", "--lines", "2", "--json"],
    sessionId
  });
  const logsPayload = JSON.parse(logsResult.stdout);
  assert.equal(logsPayload.lineLimit, 2);
  assert.equal(logsPayload.output, "GET /orders/42\nrender complete");
  assert.equal(logsPayload.terminal.id, "launch-terminal-7");
});

test("agent preview wrapper forwards command input over the private session socket", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-preview-command-"));
  try {
    let receivedInput = null;
    const prepared = await prepareAgentPreviewCommand({
      commandService: {
        async run(input) {
          receivedInput = input;
          return {
            exitCode: 0,
            ok: true,
            stdout: JSON.stringify({
              args: input.args,
              sessionId: input.sessionId
            })
          };
        }
      },
      sessionId: "wrapper-session",
      wrapperContainerDir: root,
      wrapperHostDir: root
    });

    assert.equal(prepared.ok, true);
    assert.equal((await stat(path.join(root, AGENT_PREVIEW_COMMAND_NAME))).isFile(), true);
    assert.equal(prepared.env[VIBE64_AGENT_PREVIEW_COMMAND_SESSION_ID_ENV], "wrapper-session");
    assert.match(prepared.env[VIBE64_AGENT_PREVIEW_COMMAND_SOCKET_ENV], /preview-command\.sock$/u);
    assert.match(prepared.env[VIBE64_AGENT_PREVIEW_COMMAND_TOKEN_ENV], /^[a-f0-9]{16}$/u);

    const executed = await execFileAsync(prepared.hostWrapperPath, [
      "status",
      "--json"
    ], {
      env: {
        ...process.env,
        ...prepared.env
      }
    });

    assert.deepEqual(JSON.parse(executed.stdout), {
      args: [
        "status",
        "--json"
      ],
      sessionId: "wrapper-session"
    });
    assert.deepEqual(receivedInput.args, [
      "status",
      "--json"
    ]);
    assert.equal(receivedInput.sessionId, "wrapper-session");
  } finally {
    await rm(root, {
      force: true,
      recursive: true
    });
  }
});

test("agent preview command preparation does not rewrite an unchanged wrapper file", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-preview-command-"));
  try {
    const options = {
      commandService: {
        async run() {
          return {
            exitCode: 0,
            ok: true,
            stdout: ""
          };
        }
      },
      sessionId: "idempotent-wrapper-session",
      wrapperHostDir: root
    };
    const first = await prepareAgentPreviewCommand(options);
    const firstStat = await stat(first.hostWrapperPath);
    const second = await prepareAgentPreviewCommand(options);
    const secondStat = await stat(second.hostWrapperPath);

    assert.equal(second.hostWrapperPath, first.hostWrapperPath);
    assert.equal(secondStat.mtimeMs, firstStat.mtimeMs);
  } finally {
    await rm(root, {
      force: true,
      recursive: true
    });
  }
});
