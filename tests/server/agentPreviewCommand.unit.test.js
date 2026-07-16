import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  agentPreviewBrowserWorkerSource,
  agentPreviewWrapperSource
} from "../../packages/vibe64-execution/src/server/index.js";
import {
  PREVIEW_IDENTITY_CONTROL_PATH
} from "../../packages/vibe64-core/src/server/previewAuth.js";
import {
  AGENT_PREVIEW_COMMAND_NAME,
  VIBE64_AGENT_PREVIEW_COMMAND_CONTRACT_VERSION_ENV,
  VIBE64_AGENT_PREVIEW_COMMAND_SESSION_ID_ENV,
  VIBE64_AGENT_PREVIEW_COMMAND_SOCKET_ENV,
  VIBE64_AGENT_PREVIEW_COMMAND_TOKEN_ENV,
  createAgentPreviewCommandService,
  prepareAgentPreviewCommand
} from "../../packages/vibe64-terminals/src/server/agentPreviewCommand.js";

const execFileAsync = promisify(execFile);
const FAKE_SCREENSHOT_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAHdElNRQfqBw4XCBDl8xb+AAAAFklEQVQI12NgYGD4//8/4////xkYGAAp6wX8D0F0QAAAAABJRU5ErkJggg==";
const FAKE_SCREENSHOT_BYTES = Buffer.from(FAKE_SCREENSHOT_BASE64, "base64");

test("managed screenshot helpers inject dependencies across the serialized worker boundary", () => {
  const workerSource = agentPreviewBrowserWorkerSource({
    playwrightModulePath: "/runtime/playwright/index.js"
  });
  const metricsSource = workerSource.match(
    /const pngVisualMetrics = ([\s\S]*?);\nconst domTextFacts/u
  )?.[1] || "";

  assert.ok(metricsSource);
  assert.doesNotMatch(metricsSource, /\binflateSync\b/u);
  assert.doesNotMatch(workerSource, /const pngPaethPredictor =/u);
  assert.match(workerSource, /pngVisualMetrics\(bytes, inflateSync\)/u);
});

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function processRunning(pid) {
  try {
    if (readFileSync(`/proc/${pid}/stat`, "utf8").split(" ")[2] === "Z") {
      return false;
    }
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function execWithInput(command, args, {
  env = process.env,
  input = ""
} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env,
      stdio: ["pipe", "pipe", "pipe"]
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
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0 && !signal) {
        resolve({ stderr, stdout });
        return;
      }
      reject(new Error(`Command failed (${signal || code}): ${stderr || stdout}`));
    });
    child.stdin.end(input);
  });
}

async function writeExecutable(filePath, source) {
  await mkdir(path.dirname(filePath), {
    recursive: true
  });
  await writeFile(filePath, source, "utf8");
  await chmod(filePath, 0o755);
}

async function createFakePlaywrightRuntime(runtimeRoot) {
  const nodePath = path.join(runtimeRoot, "node22", "bin", "node");
  const npmPath = path.join(runtimeRoot, "node22", "bin", "npm");
  const playwrightRoot = path.join(runtimeRoot, "playwright");
  const playwrightModule = path.join(playwrightRoot, "runtime", "lib", "node_modules", "playwright");
  await writeExecutable(nodePath, `#!/bin/sh\nexec ${process.execPath} "$@"\n`);
  await writeExecutable(npmPath, "#!/bin/sh\nexit 0\n");
  await mkdir(playwrightModule, {
    recursive: true
  });
  await mkdir(path.join(playwrightRoot, "browsers"), {
    recursive: true
  });
  await writeExecutable(path.join(playwrightRoot, "bin", "playwright"), "#!/bin/sh\nexit 0\n");
  await writeFile(path.join(playwrightRoot, "runtime.env"), "playwright_version=1.50.1\n", "utf8");
  await writeFile(path.join(playwrightModule, "index.js"), `
const { spawn } = require("node:child_process");
const screenshotBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAHdElNRQfqBw4XCBDl8xb+AAAAFklEQVQI12NgYGD4//8/4////xkYGAAp6wX8D0F0QAAAAABJRU5ErkJggg==", "base64");
const identityControlPath = ${JSON.stringify(PREVIEW_IDENTITY_CONTROL_PATH)};
let launchCount = 0;
exports.chromium = {
  async launch() {
    const launchId = ++launchCount;
    const browserChild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      detached: true,
      stdio: "ignore"
    });
    browserChild.unref();
    let connected = true;
    const pages = [];
    return {
      launchId,
      childPid: browserChild.pid,
      isConnected() { return connected; },
      async close() {
        connected = false;
        try { browserChild.kill("SIGKILL"); } catch {}
        for (const page of pages) page.closed = true;
      },
      async newContext() {
        let selectedIdentity = null;
        const context = {
          request: {
            async post(url, options) {
              if (new URL(url).pathname !== identityControlPath) {
                throw new Error("Managed browser used the wrong identity control path.");
              }
              const grant = String(options?.data?.grant || "");
              if (grant === "grant:rejected-after-logout") {
                selectedIdentity = null;
                return {
                  async json() {
                    return {
                      code: "preview_identity_rejected",
                      error: "The requested preview user does not exist.",
                      ok: false,
                      signedOut: true
                    };
                  },
                  ok() { return false; }
                };
              }
              const email = grant.startsWith("grant:") ? grant.slice("grant:".length) : "";
              selectedIdentity = email === "guest" ? null : {
                email,
                userId: "fake-user-id",
                username: email.split("@")[0]
              };
              return {
                async json() {
                  return {
                    identity: selectedIdentity,
                    ok: true
                  };
                },
                ok() { return true; }
              };
            }
          },
          pages() { return [...pages]; },
          async newPage() {
            const page = {
              closed: false,
              currentUrl: "about:blank",
              loadState: "",
              renderReady: false,
              isClosed() { return this.closed; },
              url() { return this.currentUrl; },
              async goto(url, options) {
                if (options?.waitUntil !== "load") {
                  throw new Error("Managed preview navigation did not wait for page load.");
                }
                this.currentUrl = url;
                this.loadState = "load";
              },
              async reload(options) {
                if (options?.waitUntil !== "load") {
                  throw new Error("Managed preview identity reload did not wait for page load.");
                }
                this.loadState = "load";
              },
              async waitForLoadState(state) {
                if (state !== "load") {
                  throw new Error("Managed preview screenshot did not wait for page load.");
                }
                this.loadState = state;
              },
              async waitForFunction(predicate, argument, options) {
                const browserDocument = ({
                  fonts = "loaded",
                  painted = true,
                  readyState = "complete"
                } = {}) => ({
                  defaultView: {
                    performance: {
                      getEntriesByName(name) {
                        return name === "first-contentful-paint" && painted ? [{}] : [];
                      }
                    }
                  },
                  fonts: { status: fonts },
                  readyState
                });
                if (
                  predicate(browserDocument({ readyState: "loading" })) ||
                  predicate(browserDocument({ fonts: "loading" })) ||
                  predicate(browserDocument({ painted: false })) ||
                  !predicate(browserDocument())
                ) {
                  throw new Error("Managed preview screenshot used an invalid render-readiness predicate.");
                }
                if (argument !== undefined || options?.polling !== "raf") {
                  throw new Error("Managed preview screenshot readiness was not frame-driven.");
                }
                this.renderReady = true;
              },
              locator(selector) {
                if (selector !== "body") {
                  throw new Error("Unexpected fake preview locator: " + selector);
                }
                return {
                  async innerText() {
                    return "Home\\nReady\\nCore services are available.";
                  }
                };
              },
              async title() { return "Fake preview"; },
              async screenshot(options) {
                if (this.loadState !== "load" || !this.renderReady) {
                  throw new Error("Managed preview screenshot ran before rendered-page readiness.");
                }
                if (options.fullPage !== true || options.type !== "png") {
                  throw new Error("Managed preview screenshot did not request a full-page PNG.");
                }
                return Buffer.from(screenshotBytes);
              }
            };
            pages.push(page);
            return page;
          }
        };
        return context;
      }
    };
  }
};
`, "utf8");
  return {
    nodePath,
    playwrightModule
  };
}

function createReadyPreviewCommandService({
  selectPreviewIdentity = null,
  previewUrl,
  terminalId = () => "launch-terminal"
} = {}) {
  return createAgentPreviewCommandService({
    launchTarget: {
      async ensurePreview() {
        return {
          id: terminalId(),
          ok: true
        };
      },
      async launchStatus() {
        return {
          activeTerminal: {
            id: terminalId(),
            running: true,
            status: "running"
          },
          lastLaunchTarget: {
            id: "dev"
          },
          previewTarget: {
            available: true,
            href: previewUrl
          }
        };
      },
      async selectPreviewIdentity(sessionId, input) {
        if (typeof selectPreviewIdentity !== "function") {
          return {
            code: "preview_identity_not_configured",
            error: "Preview identity selection is not configured for this test.",
            ok: false
          };
        }
        return selectPreviewIdentity(sessionId, input);
      }
    }
  });
}

test("agent preview identity authorization binds you to the trusted Vibe64 viewer", async () => {
  const sessionId = "preview-identity-session";
  const selections = [];
  const command = createAgentPreviewCommandService({
    launchTarget: {
      async launchStatus() {
        return {};
      },
      async selectPreviewIdentity(receivedSessionId, input) {
        selections.push({
          input,
          sessionId: receivedSessionId
        });
        return {
          grant: "private-grant",
          ok: true
        };
      }
    }
  });

  assert.equal(command.registerViewer(sessionId, {
    displayName: "Ada Lovelace",
    email: "ADA@EXAMPLE.COM"
  }), true);
  assert.equal((await command.authorizeBrowserIdentity(sessionId, "you")).ok, true);
  assert.equal((await command.authorizeBrowserIdentity(sessionId, "guest")).ok, true);
  assert.equal((await command.authorizeBrowserIdentity(sessionId, "grace@example.com")).ok, true);
  assert.deepEqual(selections, [
    {
      input: {
        mode: "viewer",
        vibe64User: {
          displayName: "Ada Lovelace",
          email: "ada@example.com"
        }
      },
      sessionId
    },
    {
      input: {
        mode: "guest"
      },
      sessionId
    },
    {
      input: {
        email: "grace@example.com",
        mode: "email"
      },
      sessionId
    }
  ]);

  await command.closeAllForSession(sessionId);
  const missingViewer = await command.authorizeBrowserIdentity(sessionId, "you");
  assert.equal(missingViewer.ok, false);
  assert.equal(missingViewer.code, "vibe64_agent_preview_viewer_unavailable");
  assert.equal(selections.length, 3);
});

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

test("agent preview command delegates restart to the managed launch controller", async () => {
  const sessionId = "preview-command-session";
  const restartCalls = [];
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
      async restartPreview(receivedSessionId) {
        restartCalls.push(receivedSessionId);
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
  assert.deepEqual(restartCalls, [sessionId]);
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
      href: "https://v64preview-example.test/?vibe64_preview_token=preview-secret",
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

  const inspectionResult = await command.run({
    args: ["inspect-url"],
    sessionId
  });
  assert.equal(
    inspectionResult.stdout,
    "https://v64preview-example.test/orders/42?tab=history&vibe64_preview_token=preview-secret\n"
  );

  const logsResult = await command.run({
    args: ["logs", "--lines", "2", "--json"],
    sessionId
  });
  const logsPayload = JSON.parse(logsResult.stdout);
  assert.equal(logsPayload.lineLimit, 2);
  assert.equal(logsPayload.output, "GET /orders/42\nrender complete");
  assert.equal(logsPayload.terminal.id, "launch-terminal-7");
});

test("agent preview inspection URL falls back to the direct managed endpoint", async () => {
  const command = createAgentPreviewCommandService({
    launchTarget: {
      async launchStatus() {
        return {
          lastLaunchTarget: {
            agentHref: "http://vibe64-launch-agent:4104/home",
            id: "dev"
          },
          previewTarget: {
            available: false,
            href: ""
          }
        };
      }
    }
  });

  const result = await command.run({
    args: ["inspect-url"],
    sessionId: "direct-inspection-session"
  });

  assert.equal(result.ok, true);
  assert.equal(result.stdout, "http://vibe64-launch-agent:4104/home\n");
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
    assert.equal(prepared.env[VIBE64_AGENT_PREVIEW_COMMAND_CONTRACT_VERSION_ENV], "7");

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

test("managed preview browser selects real application identities inside its own context", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-preview-identity-"));
  const runtimeRoot = path.join(root, "runtime-packs");
  const previewUrl = "https://preview.example.test/home?vibe64_preview_token=identity-token";
  const sessionId = "browser-identity-session";
  const selections = [];
  const commandService = createReadyPreviewCommandService({
    previewUrl,
    async selectPreviewIdentity(receivedSessionId, input) {
      selections.push({
        input,
        sessionId: receivedSessionId
      });
      if (input.mode === "guest") {
        return {
          grant: "grant:guest",
          ok: true,
          requestedIdentity: {
            mode: "guest"
          }
        };
      }
      const email = input.mode === "viewer" ? input.vibe64User.email : input.email;
      return {
        grant: email === "missing@example.com"
          ? "grant:rejected-after-logout"
          : `grant:${email}`,
        ok: true,
        requestedIdentity: {
          displayName: input.mode === "viewer" ? input.vibe64User.displayName : "",
          email,
          mode: input.mode
        }
      };
    }
  });
  commandService.registerViewer(sessionId, {
    displayName: "Ada Lovelace",
    email: "ada@example.com"
  });
  try {
    await createFakePlaywrightRuntime(runtimeRoot);
    const prepared = await prepareAgentPreviewCommand({
      commandService,
      env: {
        VIBE64_RUNTIME_PACK_ROOT: runtimeRoot
      },
      sessionId,
      wrapperHostDir: root
    });
    const commandEnv = {
      ...process.env,
      ...prepared.env
    };

    const asViewer = await execFileAsync(prepared.hostWrapperPath, [
      "browser",
      "identity",
      "you"
    ], {
      env: commandEnv
    });
    assert.doesNotMatch(asViewer.stdout, /grant:/u);
    assert.deepEqual(JSON.parse(asViewer.stdout).identity, {
      displayName: "ada",
      email: "ada@example.com",
      mode: "you",
      userId: "fake-user-id",
      username: "ada"
    });

    const asExistingUser = JSON.parse((await execFileAsync(prepared.hostWrapperPath, [
      "browser",
      "identity",
      "grace@example.com"
    ], {
      env: commandEnv
    })).stdout);
    assert.deepEqual(asExistingUser.identity, {
      displayName: "grace",
      email: "grace@example.com",
      mode: "email",
      userId: "fake-user-id",
      username: "grace"
    });

    await assert.rejects(
      execFileAsync(prepared.hostWrapperPath, [
        "browser",
        "identity",
        "missing@example.com"
      ], {
        env: commandEnv
      }),
      /The requested preview user does not exist\./u
    );
    const afterRejectedLogin = JSON.parse((await execFileAsync(
      prepared.hostWrapperPath,
      ["browser", "status"],
      { env: commandEnv }
    )).stdout);
    assert.deepEqual(afterRejectedLogin.applicationIdentity, {
      mode: "guest"
    });

    const asGuest = JSON.parse((await execFileAsync(prepared.hostWrapperPath, [
      "browser",
      "identity",
      "guest"
    ], {
      env: commandEnv
    })).stdout);
    assert.deepEqual(asGuest.identity, {
      mode: "guest"
    });
    assert.equal(selections.length, 4);
    assert.deepEqual(selections[0], {
      input: {
        mode: "viewer",
        vibe64User: {
          displayName: "Ada Lovelace",
          email: "ada@example.com"
        }
      },
      sessionId
    });
  } finally {
    await commandService.closeAllForSession(sessionId);
    await rm(root, {
      force: true,
      recursive: true
    });
  }
});

test("agent preview wrapper captures the authenticated page with managed Playwright", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-preview-screenshot-"));
  const runtimeRoot = path.join(root, "runtime-packs");
  const blockedPlaywright = path.join(root, "guard-bin", "playwright");
  const outputPath = path.join(root, "current page.png");
  const previewUrl = "https://preview.example.test/home?vibe64_preview_token=private-token";
  const sessionId = "screenshot-wrapper-session";
  const commandService = createReadyPreviewCommandService({
    previewUrl,
    terminalId: () => "launch-terminal-screenshot"
  });
  try {
    await createFakePlaywrightRuntime(runtimeRoot);
    await mkdir(path.dirname(blockedPlaywright), {
      recursive: true
    });
    await writeFile(blockedPlaywright, "#!/bin/sh\nexit 99\n", "utf8");
    await chmod(blockedPlaywright, 0o755);

    const prepared = await prepareAgentPreviewCommand({
      commandService,
      env: {
        VIBE64_RUNTIME_PACK_ROOT: runtimeRoot
      },
      sessionId,
      wrapperHostDir: root
    });

    const executed = await execFileAsync(prepared.hostWrapperPath, [
      "screenshot",
      "--output",
      outputPath
    ], {
      env: {
        ...process.env,
        ...prepared.env,
        PATH: `${path.dirname(blockedPlaywright)}:${process.env.PATH}`
      }
    });

    const capture = JSON.parse(executed.stdout);
    assert.equal(capture.outputPath, outputPath);
    assert.equal(
      capture.sha256,
      crypto.createHash("sha256").update(FAKE_SCREENSHOT_BYTES).digest("hex")
    );
    assert.equal(capture.byteLength, FAKE_SCREENSHOT_BYTES.length);
    assert.equal(capture.width, 2);
    assert.equal(capture.height, 2);
    assert.equal(capture.totalPixels, 4);
    assert.equal(capture.sampledPixels, 4);
    assert.equal(capture.samplingStep, 1);
    assert.equal(capture.luminance, 0.75);
    assert.equal(capture.darkPixelThreshold, 0.1);
    assert.equal(capture.darkPixelPercentage, 25);
    assert.equal(capture.title, "Fake preview");
    assert.equal(capture.domTextSummary, "Home Ready Core services are available.");
    assert.equal(capture.domTextLength, 39);
    assert.match(capture.url, /^https:\/\/preview\.example\.test\/home\?/u);
    assert.match(capture.url, /vibe64_preview_token=%5Bredacted%5D/u);
    assert.equal(Number.isNaN(Date.parse(capture.capturedAt)), false);
    assert.doesNotMatch(executed.stdout, /private-token/u);
    assert.equal(executed.stderr, "");
    assert.deepEqual(await readFile(outputPath), FAKE_SCREENSHOT_BYTES);

    await assert.rejects(
      execFileAsync(prepared.hostWrapperPath, [
        "screenshot",
        "--output",
        outputPath
      ], {
        env: {
          ...process.env,
          ...prepared.env
        }
      }),
      /screenshot path already exists/u
    );
    assert.deepEqual(await readFile(outputPath), FAKE_SCREENSHOT_BYTES);

    const automaticCaptures = [];
    for (let index = 0; index < 2; index += 1) {
      const automatic = await execFileAsync(prepared.hostWrapperPath, [
        "screenshot"
      ], {
        env: {
          ...process.env,
          ...prepared.env,
          TMPDIR: root
        }
      });
      automaticCaptures.push(JSON.parse(automatic.stdout));
    }
    assert.notEqual(automaticCaptures[0].outputPath, automaticCaptures[1].outputPath);
    for (const automaticCapture of automaticCaptures) {
      assert.equal(path.dirname(automaticCapture.outputPath), root);
      assert.match(
        path.basename(automaticCapture.outputPath),
        /^vibe64-page-screenshot-wrapper-session-.+-[a-f0-9]{12}\.png$/u
      );
      assert.equal(automaticCapture.sha256, capture.sha256);
      assert.deepEqual(await readFile(automaticCapture.outputPath), FAKE_SCREENSHOT_BYTES);
    }
  } finally {
    await commandService.closeAllForSession(sessionId);
    await rm(root, {
      force: true,
      recursive: true
    });
  }
});

test("managed preview browser persists interaction state and recovers killed browser and preview processes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-preview-browser-recovery-"));
  const runtimeRoot = path.join(root, "runtime-packs");
  const previewUrl = "https://preview.example.test/app?vibe64_preview_token=recovery-token";
  const sessionId = "browser-recovery-session";
  let terminalId = "launch-terminal-1";
  const commandService = createReadyPreviewCommandService({
    previewUrl,
    terminalId: () => terminalId
  });
  try {
    await createFakePlaywrightRuntime(runtimeRoot);
    const prepared = await prepareAgentPreviewCommand({
      commandService,
      env: {
        VIBE64_RUNTIME_PACK_ROOT: runtimeRoot
      },
      sessionId,
      wrapperHostDir: root
    });
    const commandEnv = {
      ...process.env,
      ...prepared.env
    };
    const evalCode = "state.count = (state.count || 0) + 1; return { childPid: browser.childPid, count: state.count, launchId: browser.launchId };";

    const first = JSON.parse((await execWithInput(prepared.hostWrapperPath, ["browser", "eval"], {
      env: commandEnv,
      input: evalCode
    })).stdout);
    const firstMetadata = JSON.parse(await readFile(prepared.hostBrowserMetadataPath, "utf8"));
    assert.deepEqual(firstMetadata.browserProcessGroups, [{
      groupId: first.result.childPid,
      startTimeTicks: firstMetadata.browserProcessGroups[0].startTimeTicks
    }]);
    assert.deepEqual(first.result, {
      childPid: first.result.childPid,
      count: 1,
      launchId: 1
    });

    const second = JSON.parse((await execWithInput(prepared.hostWrapperPath, ["browser", "eval"], {
      env: commandEnv,
      input: evalCode
    })).stdout);
    assert.deepEqual(second.result, {
      childPid: first.result.childPid,
      count: 2,
      launchId: 1
    });

    process.kill(firstMetadata.pid, "SIGKILL");
    await wait(100);
    const afterWorkerKill = JSON.parse((await execWithInput(prepared.hostWrapperPath, ["browser", "eval"], {
      env: commandEnv,
      input: evalCode
    })).stdout);
    const recoveredMetadata = JSON.parse(await readFile(prepared.hostBrowserMetadataPath, "utf8"));
    assert.notEqual(recoveredMetadata.pid, firstMetadata.pid);
    assert.equal(processRunning(first.result.childPid), false);
    assert.deepEqual(afterWorkerKill.result, {
      childPid: afterWorkerKill.result.childPid,
      count: 1,
      launchId: 1
    });

    terminalId = "launch-terminal-2";
    const afterPreviewKill = JSON.parse((await execWithInput(prepared.hostWrapperPath, ["browser", "eval"], {
      env: commandEnv,
      input: evalCode
    })).stdout);
    assert.deepEqual(afterPreviewKill.result, {
      childPid: afterPreviewKill.result.childPid,
      count: 2,
      launchId: 2
    });
    assert.notEqual(afterPreviewKill.result.childPid, afterWorkerKill.result.childPid);
    assert.equal(processRunning(afterWorkerKill.result.childPid), false);
    const status = JSON.parse((await execFileAsync(prepared.hostWrapperPath, ["browser", "status"], {
      env: commandEnv
    })).stdout);
    assert.equal(status.previewInstance, "dev:launch-terminal-2");
    assert.equal(status.running, true);

    process.kill(recoveredMetadata.pid, "SIGKILL");
    await wait(100);
    assert.equal(processRunning(afterPreviewKill.result.childPid), true);
    await commandService.closeAllForSession(sessionId);
    for (let attempt = 0; attempt < 20 && processRunning(recoveredMetadata.pid); attempt += 1) {
      await wait(25);
    }
    assert.equal(processRunning(recoveredMetadata.pid), false);
    assert.equal(processRunning(afterPreviewKill.result.childPid), false);
    await assert.rejects(stat(prepared.hostBrowserSocketPath), {
      code: "ENOENT"
    });
    await assert.rejects(stat(prepared.hostBrowserMetadataPath), {
      code: "ENOENT"
    });
  } finally {
    await commandService.closeAllForSession(sessionId);
    await rm(root, {
      force: true,
      recursive: true
    });
  }
});

test("managed preview browser replaces and cleans up a stale worker contract", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-preview-browser-upgrade-"));
  const runtimeRoot = path.join(root, "runtime-packs");
  const sessionId = "browser-upgrade-session";
  const commandService = createReadyPreviewCommandService({
    previewUrl: "https://preview.example.test/upgrade?vibe64_preview_token=upgrade-token"
  });
  try {
    const runtime = await createFakePlaywrightRuntime(runtimeRoot);
    const preparationOptions = {
      commandService,
      env: {
        VIBE64_RUNTIME_PACK_ROOT: runtimeRoot
      },
      sessionId,
      wrapperHostDir: root
    };
    const prepared = await prepareAgentPreviewCommand(preparationOptions);
    const commandEnv = {
      ...process.env,
      ...prepared.env
    };
    const currentContractVersion = prepared.env[VIBE64_AGENT_PREVIEW_COMMAND_CONTRACT_VERSION_ENV];
    const staleContractVersion = String(Number(currentContractVersion) - 1);
    await Promise.all([
      writeExecutable(prepared.hostBrowserWorkerPath, agentPreviewBrowserWorkerSource({
        contractVersion: staleContractVersion,
        identityControlPath: PREVIEW_IDENTITY_CONTROL_PATH,
        playwrightModulePath: runtime.playwrightModule
      })),
      writeExecutable(prepared.hostWrapperPath, agentPreviewWrapperSource({
        contractVersion: staleContractVersion,
        managedNodePath: runtime.nodePath,
        workerScriptPath: prepared.hostBrowserWorkerPath
      }))
    ]);

    const staleBrowser = JSON.parse((await execWithInput(prepared.hostWrapperPath, ["browser", "eval"], {
      env: commandEnv,
      input: "return { childPid: browser.childPid };"
    })).stdout);
    const staleMetadata = JSON.parse(await readFile(prepared.hostBrowserMetadataPath, "utf8"));
    assert.equal(staleMetadata.contractVersion, staleContractVersion);

    await prepareAgentPreviewCommand(preparationOptions);
    const currentStatus = JSON.parse((await execFileAsync(prepared.hostWrapperPath, ["browser", "ensure"], {
      env: commandEnv
    })).stdout);
    const currentMetadata = JSON.parse(await readFile(prepared.hostBrowserMetadataPath, "utf8"));
    assert.equal(currentStatus.contractVersion, currentContractVersion);
    assert.equal(currentMetadata.contractVersion, currentContractVersion);
    assert.notEqual(currentMetadata.pid, staleMetadata.pid);
    for (let attempt = 0; attempt < 20 && (
      processRunning(staleMetadata.pid) || processRunning(staleBrowser.result.childPid)
    ); attempt += 1) {
      await wait(25);
    }
    assert.equal(processRunning(staleMetadata.pid), false);
    assert.equal(processRunning(staleBrowser.result.childPid), false);
  } finally {
    await commandService.closeAllForSession(sessionId);
    await rm(root, {
      force: true,
      recursive: true
    });
  }
});

test("managed preview browser exits after idle expiry and loss of its Vibe64 control lease", async () => {
  for (const mode of ["idle", "control-loss"]) {
    const root = await mkdtemp(path.join(os.tmpdir(), `vibe64-preview-browser-${mode}-`));
    const runtimeRoot = path.join(root, "runtime-packs");
    const sessionId = `browser-${mode}-session`;
    const commandService = createReadyPreviewCommandService({
      previewUrl: "https://preview.example.test/lease?vibe64_preview_token=lease-token"
    });
    try {
      await createFakePlaywrightRuntime(runtimeRoot);
      const prepared = await prepareAgentPreviewCommand({
        browserControlHealthFailureLimit: 2,
        browserControlHealthIntervalMs: 30,
        browserIdleTimeoutMs: mode === "idle" ? 100 : 10_000,
        commandService,
        env: {
          VIBE64_RUNTIME_PACK_ROOT: runtimeRoot
        },
        sessionId,
        wrapperHostDir: root
      });
      await execFileAsync(prepared.hostWrapperPath, ["browser", "ensure"], {
        env: {
          ...process.env,
          ...prepared.env
        }
      });
      const metadata = JSON.parse(await readFile(prepared.hostBrowserMetadataPath, "utf8"));
      if (mode === "control-loss") {
        await commandService.releaseControlForSession(sessionId);
      }
      for (let attempt = 0; attempt < 100 && processRunning(metadata.pid); attempt += 1) {
        await wait(25);
      }
      assert.equal(processRunning(metadata.pid), false, `${mode} worker should exit`);
      await assert.rejects(stat(prepared.hostBrowserMetadataPath), {
        code: "ENOENT"
      });
    } finally {
      await commandService.closeAllForSession(sessionId);
      await rm(root, {
        force: true,
        recursive: true
      });
    }
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
