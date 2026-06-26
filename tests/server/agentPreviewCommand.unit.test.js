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
    agentUrl: "http://vibe64-launch-agent:4100/app",
    browserUrl: "http://127.0.0.1:4100/app",
    launchTargetId: "jskit-dev",
    previewUrl: "/preview/session/app",
    ready: true,
    restarted: true,
    running: true,
    stale: false,
    status: "running"
  });
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
