import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import crypto from "node:crypto";
import http from "node:http";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { prepareAgentHelperCommand } from "../../packages/vibe64-terminals/src/server/agentHelperCommand.js";
import {
  agentPreviewBrowserWorkerSource,
  agentPreviewWrapperSource
} from "../../packages/vibe64-execution/src/server/index.js";
import {
  APPLICATION_COMMAND_PREVIEW_AUTH_KIND,
  PREVIEW_IDENTITY_CONTROL_PATH,
  createPreviewIdentityGrant
} from "../../packages/vibe64-core/src/server/previewAuth.js";
import { createLaunchPreviewProxyRegistry } from "../../packages/vibe64-terminals/src/server/launchPreviewProxy.js";
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

test("managed preview control leaves operation deadlines to the operation owner", () => {
  const wrapperSource = agentPreviewWrapperSource({
    managedNodePath: "/runtime/node",
    workerScriptPath: "/runtime/preview-browser-worker"
  });

  assert.doesNotMatch(wrapperSource, /timeoutMs: 5000/u);
  assert.match(
    wrapperSource,
    /vibe64_agent_control_timeout: Managed preview control timed out\. Retry the command\./u
  );
  assert.doesNotMatch(
    wrapperSource,
    /\["ECONNREFUSED", "ENOENT", "ENOTSOCK", "ETIMEDOUT"\]/u
  );
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
  const nodePath = path.join(runtimeRoot, "node26", "bin", "node");
  const npmPath = path.join(runtimeRoot, "node26", "bin", "npm");
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
function identityRequestContext() {
  let selectedIdentity = null;
  return {
    async dispose() {},
    async get() {},
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
      const identityValue = grant.startsWith("grant:") ? grant.slice("grant:".length) : "";
      const identityType = identityValue.includes("@") ? "email" : "login";
      selectedIdentity = identityValue === "guest" ? null : {
        email: identityType === "email" ? identityValue : "",
        login: identityType === "login" ? identityValue : "",
        selector: {
          type: identityType,
          value: identityValue
        },
        userId: "fake-user-id",
        username: identityValue.split("@")[0]
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
    },
    async storageState() {
      const identityValue = selectedIdentity?.email || selectedIdentity?.login || "";
      return {
        cookies: identityValue ? [{
          domain: "preview.example.test",
          expires: -1,
          httpOnly: true,
          name: "app_session",
          path: "/",
          sameSite: "Lax",
          secure: true,
          value: identityValue
        }] : [],
        origins: []
      };
    }
  };
}
exports.request = { async newContext() { return identityRequestContext(); } };
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
        const identityRequest = identityRequestContext();
        const context = {
          async close() {},
          request: identityRequest,
          pages() { return [...pages]; },
          storageState: identityRequest.storageState,
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
  onEnsurePreview = null,
  selectPreviewIdentity = null,
  previewUrl,
  runManagedCommand,
  stopManagedExecution,
  stopOwnedExecutions,
  terminalId = () => "launch-terminal"
} = {}) {
  return createAgentPreviewCommandService({
    launchTarget: {
      previewTestRunAdmission() { return null; },
      async ensurePreview() {
        onEnsurePreview?.();
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
          lastOutputTarget: {
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
    },
    ...(typeof runManagedCommand === "function" ? { runManagedCommand } : {}),
    ...(typeof stopManagedExecution === "function" ? { stopManagedExecution } : {}),
    ...(typeof stopOwnedExecutions === "function" ? { stopOwnedExecutions } : {})
  });
}

test("agent preview help distinguishes duplicate previews from explicit reference apps", async () => {
  const command = createAgentPreviewCommandService({
    launchTarget: {
      async launchStatus() {
        return {};
      }
    }
  });

  const result = await command.run({
    args: ["--help"],
    sessionId: "preview-help-session"
  });

  assert.equal(result.ok, true);
  assert.match(result.stdout, /canonical preview server for the configured primary application/u);
  assert.match(result.stdout, /Do not start a duplicate copy/u);
  assert.match(result.stdout, /distinct secondary application explicitly requested by the user/u);
  assert.match(result.stdout, /vibe64-helper playwright \[--target <target-id>\] \[--identity <default\|guest\|configured-name>\] test/u);
  assert.doesNotMatch(result.stdout, /only preview server the agent may use/u);
  assert.doesNotMatch(result.stdout, /any other development server/u);
});

test("managed preview browser eval validates stdin before starting browser control", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-preview-browser-eval-input-"));
  const sessionId = "browser-eval-input-session";
  let ensureCalls = 0;
  const commandService = createReadyPreviewCommandService({
    onEnsurePreview: () => {
      ensureCalls += 1;
    },
    previewUrl: "https://preview.example.test/"
  });
  try {
    const prepared = await prepareAgentPreviewCommand({
      commandService,
      sessionId,
      wrapperHostDir: root
    });
    const commandEnv = {
      ...process.env,
      ...prepared.env
    };
    await prepareAgentHelperCommand({ wrapperHostDir: root });
    const helper = path.join(root, "vibe64-helper");
    const help = await execWithInput(helper, [
      "preview",
      "browser",
      "eval",
      "--help"
    ], {
      env: commandEnv
    });

    assert.match(help.stdout, /Usage: vibe64-helper preview browser eval < playwright-code\.js/u);
    assert.match(help.stdout, /new URL\('\/your-path', preview\.url\)/u);
    assert.match(help.stdout, /direct application ports bypass Preview identity/u);
    const playwrightHelp = await execWithInput(helper, ["playwright", "--help"], { env: commandEnv });
    assert.match(playwrightHelp.stdout, /Usage:\n {2}vibe64-helper playwright/u);
    await assert.rejects(
      execWithInput(prepared.hostWrapperPath, [
        "browser",
        "eval",
        "return page.url();"
      ], {
        env: commandEnv
      }),
      /Playwright code must be provided on stdin, not as a positional argument/u
    );
    await assert.rejects(
      execWithInput(prepared.hostWrapperPath, ["browser", "eval"], {
        env: commandEnv,
        input: " \n"
      }),
      /Playwright code is required on stdin/u
    );
    assert.equal(ensureCalls, 0);
    await assert.rejects(stat(prepared.hostBrowserSocketPath), {
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

test("agent preview identity authorization uses configured names without Vibe64 viewer data", async () => {
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

  assert.equal((await command.authorizeBrowserIdentity(sessionId, "default")).ok, true);
  assert.equal((await command.authorizeBrowserIdentity(sessionId, "guest")).ok, true);
  assert.equal((await command.authorizeBrowserIdentity(sessionId, "worker")).ok, true);
  assert.deepEqual(selections, [
    {
      input: {
        identityName: "default",
        mode: "identity"
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
        identityName: "worker",
        mode: "identity"
      },
      sessionId
    }
  ]);

  await command.closeAllForSession(sessionId);
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
      lastOutputTarget: {
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
      lastOutputTarget: {
        agentHref: "http://vibe64-launch-agent:4100/",
        id: "dev"
      },
      openTarget: {
        href: "http://127.0.0.1:4100/"
      },
      previewIdentity: {
        defaultIdentityName: "admin",
        identities: [
          {
            name: "admin",
            type: "email",
            value: "admin@example.com"
          }
        ],
        identityTypes: ["email"]
      },
      previewTarget: {
        available: true,
        href: "http://127.0.0.1:49100/",
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
    diagnostics: {
      directApplicationEndpoint: {
        hostname: "vibe64-launch-agent",
        port: 4100,
        url: "http://vibe64-launch-agent:4100/"
      }
    },
    endpoints: {
      browser: {
        hostname: "127.0.0.1",
        port: 49100,
        url: "http://127.0.0.1:49100/"
      }
    },
    defaultIdentity: "admin",
    identities: [
      {
        name: "admin",
        type: "email"
      }
    ],
    identityTypes: ["email"],
    ensured: true,
    outputTargetId: "dev",
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
      lastOutputTarget: {
        agentHref: "http://vibe64-launch-agent:4100/app",
        id: "jskit-dev"
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
      lastOutputTarget: {
        agentHref: "http://vibe64-launch-agent:4100/app",
        id: "jskit-dev"
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
      lastOutputTarget: {
        agentHref: "http://vibe64-launch-agent:4100/app",
        id: "jskit-dev"
      },
      openTarget: {
        href: "http://127.0.0.1:4100/app"
      },
      previewTarget: {
        available: true,
        href: "http://127.0.0.1:49100/app",
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
    diagnostics: {
      directApplicationEndpoint: {
        hostname: "vibe64-launch-agent",
        port: 4100,
        url: "http://vibe64-launch-agent:4100/app"
      }
    },
    endpoints: {
      browser: {
        hostname: "127.0.0.1",
        port: 49100,
        url: "http://127.0.0.1:49100/app"
      }
    },
    defaultIdentity: "",
    identities: [],
    identityTypes: [],
    outputTargetId: "jskit-dev",
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
  let observedRoute = "/orders/42?tab=history";
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
    lastOutputTarget: {
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
          route: observedRoute,
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
  assert.equal(statusPayload.endpoints.browser.hostname, "v64preview-example.test");
  assert.equal(statusPayload.endpoints.browser.port, 443);
  assert.equal(statusPayload.endpoints.agent, undefined);
  assert.equal(statusPayload.currentPage.route, "/orders/42?tab=history");
  assert.equal(statusPayload.currentPage.url, "https://v64preview-example.test/orders/42?tab=history&vibe64_preview_token=preview-secret");
  assert.equal(statusPayload.currentPage.agentUrl, undefined);
  assert.equal(statusPayload.currentPage.title, "Order 42");
  assert.deepEqual(statusPayload.diagnostics, {
    latest: "/workspace/session-7/preview-last.json",
    log: "/workspace/session-7/preview-log.jsonl",
    directApplicationEndpoint: {
      hostname: "vibe64-launch-agent",
      port: 4103,
      url: "http://vibe64-launch-agent:4103/"
    }
  });

  const textStatus = await command.run({ args: ["status"], sessionId });
  assert.match(textStatus.stdout, /Browser URL \(Preview proxy\): https:\/\/v64preview-example.test/u);
  assert.match(textStatus.stdout, /Current page URL \(Preview proxy\): https:\/\/v64preview-example.test\/orders\/42/u);
  assert.doesNotMatch(textStatus.stdout, /vibe64-launch-agent|4103|Agent URL/u);

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

  observedRoute = "//127.0.0.1:4103/orders/42";
  const escapedRoute = await command.run({ args: ["inspect-url"], sessionId });
  assert.equal(escapedRoute.stdout.trim(), status.previewTarget.href);

  status.previewTarget.available = false;
  const unavailable = await command.run({ args: ["inspect-url"], sessionId });
  assert.equal(unavailable.ok, false);
  const unavailableStatus = JSON.parse((await command.run({ args: ["status", "--json"], sessionId })).stdout);
  assert.equal(unavailableStatus.endpoints.browser, null);
  assert.equal(unavailableStatus.currentPage.url, "");
});

test("agent preview inspection refuses a missing proxy instead of offering the raw application", async () => {
  const command = createAgentPreviewCommandService({
    launchTarget: {
      async launchStatus() {
        return {
          lastOutputTarget: {
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

  assert.equal(result.ok, false);
  assert.equal(result.code, "vibe64_agent_preview_command_inspection_url_unavailable");
  assert.doesNotMatch(result.error, /4104/u);
  const status = JSON.parse((await command.run({
    args: ["status", "--json"], sessionId: "direct-inspection-session"
  })).stdout);
  assert.equal(status.endpoints.browser, null);
  assert.equal(status.diagnostics.directApplicationEndpoint.port, 4104);
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
    assert.equal(prepared.env[VIBE64_AGENT_PREVIEW_COMMAND_SOCKET_ENV], prepared.hostSocketPath);
    assert.match(prepared.env[VIBE64_AGENT_PREVIEW_COMMAND_TOKEN_ENV], /^[a-f0-9]{16}$/u);
    assert.equal(prepared.env[VIBE64_AGENT_PREVIEW_COMMAND_CONTRACT_VERSION_ENV], "11");

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

test("managed preview browser surfaces capacity refusal without creating a worker", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-preview-capacity-"));
  const runtimeRoot = path.join(root, "runtime-packs");
  const sessionId = "browser-capacity-session";
  const requests = [];
  const commandService = createReadyPreviewCommandService({
    previewUrl: "https://preview.example.test/capacity",
    async runManagedCommand(request) {
      requests.push(request);
      return {
        code: "vibe64_capacity_rejected",
        error: "This work cannot start while available memory is this low.",
        exitCode: 1,
        ok: false,
        retryable: false
      };
    }
  });
  try {
    await createFakePlaywrightRuntime(runtimeRoot);
    const prepared = await prepareAgentPreviewCommand({
      commandService,
      env: {
        VIBE64_RUNTIME_PACK_ROOT: runtimeRoot
      },
      sessionId,
      worktreePath: root,
      wrapperHostDir: root
    });
    await assert.rejects(
      execFileAsync(prepared.hostWrapperPath, ["browser", "ensure"], {
        cwd: root,
        env: {
          ...process.env,
          ...prepared.env
        }
      }),
      (error) => {
        assert.match(error.stderr, /available memory is this low/u);
        return true;
      }
    );
    assert.equal(requests.length, 1);
    assert.equal(requests[0].execution.kind, "browser");
    assert.equal(requests[0].execution.lifecycle, "service");
    await assert.rejects(stat(prepared.hostBrowserSocketPath), { code: "ENOENT" });
    await assert.rejects(stat(prepared.hostBrowserMetadataPath), { code: "ENOENT" });
  } finally {
    await commandService.closeAllForSession(sessionId);
    await rm(root, {
      force: true,
      recursive: true
    });
  }
});

test("managed preview browser selects configured identities and retains signed-out failures", async () => {
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
      assert.equal(input.mode, "identity");
      const configured = {
        default: {
          name: "admin",
          type: "email",
          value: "ada@example.com"
        },
        missing: {
          name: "missing",
          type: "email",
          value: "missing@example.com"
        },
        worker: {
          name: "worker",
          type: "login",
          value: "merc"
        }
      }[input.identityName];
      assert.ok(configured);
      return {
        grant: configured.name === "missing"
          ? "grant:rejected-after-logout"
          : `grant:${configured.value}`,
        ok: true,
        requestedIdentity: {
          displayName: configured.name,
          mode: "identity",
          name: configured.name,
          selector: {
            type: configured.type,
            value: configured.value
          }
        }
      };
    }
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

    const asDefault = await execFileAsync(prepared.hostWrapperPath, [
      "browser",
      "identity",
      "default"
    ], {
      env: commandEnv
    });
    assert.doesNotMatch(asDefault.stdout, /grant:/u);
    assert.deepEqual(JSON.parse(asDefault.stdout).identity, {
      displayName: "ada",
      email: "ada@example.com",
      login: "",
      mode: "identity",
      name: "admin",
      selector: {
        type: "email",
        value: "ada@example.com"
      },
      userId: "fake-user-id",
      username: "ada"
    });

    const asExistingUser = JSON.parse((await execFileAsync(prepared.hostWrapperPath, [
      "browser",
      "identity",
      "worker"
    ], {
      env: commandEnv
    })).stdout);
    assert.deepEqual(asExistingUser.identity, {
      displayName: "merc",
      email: "",
      login: "merc",
      mode: "identity",
      name: "worker",
      selector: {
        type: "login",
        value: "merc"
      },
      userId: "fake-user-id",
      username: "merc"
    });

    await assert.rejects(
      execFileAsync(prepared.hostWrapperPath, [
        "browser",
        "identity",
        "missing"
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
        identityName: "default",
        mode: "identity"
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

test("managed browser identity returns from the app port to the real Preview proxy without a reset", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-preview-origin-"));
  const runtimeRoot = path.join(root, "runtime-packs");
  const sessionId = "browser-origin-session";
  const directIdentityRequests = [];
  const selections = [];
  const app = http.createServer((request, response) => {
    if (request.url === PREVIEW_IDENTITY_CONTROL_PATH) {
      directIdentityRequests.push(request.url);
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, { "Content-Type": "text/html" });
    response.end(`<!doctype html><html><body>${request.headers.cookie?.includes("app_session=ada")
      ? "Signed in as Ada" : "Sign in"}</body></html>`);
  });
  const registry = createLaunchPreviewProxyRegistry();
  let commandService;
  try {
    await new Promise((resolve) => app.listen(0, "127.0.0.1", resolve));
    const appOrigin = `http://127.0.0.1:${app.address().port}`;
    const previewAuth = {
      kind: APPLICATION_COMMAND_PREVIEW_AUTH_KIND,
      identityTypes: ["email"],
      projectScope: "project:browser-origin",
      secret: "a".repeat(64),
      sessionSourceRoot: root,
      sessionId,
      targetHref: `${appOrigin}/admin`,
      terminalSessionId: "launch-terminal"
    };
    const preview = await registry.ensure({
      ...previewAuth,
      previewAuth,
      async executePreviewIdentityCommand({ selection }) {
        selections.push(selection);
        const guest = selection.operation === "logout";
        return {
          ok: true,
          identity: guest ? null : { displayName: "Ada", email: "ada@example.com" },
          setCookie: [guest
            ? "app_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax"
            : "app_session=ada; Path=/; HttpOnly; SameSite=Lax"]
        };
      }
    });
    commandService = createReadyPreviewCommandService({
      previewUrl: preview.href,
      async selectPreviewIdentity(_sessionId, input) {
        const selection = input.mode === "guest"
          ? { operation: "logout" }
          : { operation: "login-as", selector: { type: "email", value: "ada@example.com" } };
        return {
          ok: true,
          grant: createPreviewIdentityGrant(previewAuth, selection),
          requestedIdentity: { mode: input.mode, name: "admin", selector: selection.selector }
        };
      }
    });
    const { playwrightModule } = await createFakePlaywrightRuntime(runtimeRoot);
    const require = createRequire(import.meta.url);
    const playwrightPath = require.resolve("playwright");
    const executablePath = require("playwright").chromium.executablePath();
    await writeFile(path.join(playwrightModule, "index.js"), `
const playwright = require(${JSON.stringify(playwrightPath)});
exports.chromium = { launch(options) {
  return playwright.chromium.launch({ ...options, executablePath: ${JSON.stringify(executablePath)} });
} };
exports.request = playwright.request;
`, "utf8");
    const prepared = await prepareAgentPreviewCommand({
      commandService, env: { VIBE64_RUNTIME_PACK_ROOT: runtimeRoot }, sessionId,
      wrapperHostDir: path.join(root, "commands")
    });
    const env = { ...process.env, ...prepared.env };
    await execWithInput(prepared.hostWrapperPath, ["browser", "eval"], {
      env,
      input: `await page.evaluate(() => sessionStorage.setItem("retained", "same browser"));
await page.goto(${JSON.stringify(`${appOrigin}/auth/login`)});`
    });
    const navigation = JSON.parse((await execWithInput(prepared.hostWrapperPath, ["browser", "eval"], {
      env, input: 'return { managed: new URL(preview.url).origin, current: new URL(page.url()).origin };'
    })).stdout);
    assert.equal(navigation.result.managed, new URL(preview.href).origin);
    assert.equal(navigation.result.current, appOrigin);
    const identity = JSON.parse((await execFileAsync(prepared.hostWrapperPath, ["browser", "identity", "admin"], { env })).stdout);
    assert.equal(identity.identity.email, "ada@example.com");
    assert.equal(new URL(identity.url).origin, new URL(preview.href).origin);
    const authenticated = JSON.parse((await execWithInput(prepared.hostWrapperPath, ["browser", "eval"], {
      env,
      input: 'return { text: await page.locator("body").innerText(), retained: await page.evaluate(() => sessionStorage.getItem("retained")) };'
    })).stdout);
    assert.deepEqual(authenticated.result, { text: "Signed in as Ada", retained: "same browser" });
    assert.deepEqual(directIdentityRequests, []);

    // Selecting on the managed origin must preserve the page's current route.
    await execWithInput(prepared.hostWrapperPath, ["browser", "eval"], {
      env,
      input: 'await page.goto(new URL("/bookings/162?tab=details", page.url()).href);'
    });
    const guest = JSON.parse((await execFileAsync(prepared.hostWrapperPath, ["browser", "identity", "guest"], { env })).stdout);
    assert.deepEqual(guest.identity, { mode: "guest" });
    assert.equal(new URL(guest.url).pathname, "/bookings/162");
    assert.equal(new URL(guest.url).search, "?tab=details");
    const signedOut = JSON.parse((await execWithInput(prepared.hostWrapperPath, ["browser", "eval"], {
      env, input: 'return await page.locator("body").innerText();'
    })).stdout);
    assert.equal(signedOut.result, "Sign in");
    assert.deepEqual(selections.map(({ operation }) => operation), ["login-as", "logout"]);
  } finally {
    await commandService?.closeAllForSession(sessionId);
    await registry.closeAll();
    await new Promise((resolve) => app.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});

test("managed preview writes authenticated Playwright state without changing the interactive browser identity", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-preview-storage-state-"));
  const runtimeRoot = path.join(root, "runtime-packs");
  const previewUrl = "https://preview.example.test/home?vibe64_preview_token=identity-token";
  const sessionId = "browser-storage-state-session";
  const outputPath = path.join(root, "playwright", "storage-state.json");
  const commandService = createReadyPreviewCommandService({
    previewUrl,
    async selectPreviewIdentity(receivedSessionId, input) {
      assert.equal(receivedSessionId, sessionId);
      assert.equal(input.mode, "identity");
      assert.equal(input.identityName, "default");
      return {
        grant: "grant:ada@example.com",
        ok: true,
        requestedIdentity: {
          mode: "identity",
          name: "admin",
          selector: {
            type: "email",
            value: "ada@example.com"
          }
        }
      };
    }
  });
  try {
    await createFakePlaywrightRuntime(runtimeRoot);
    await mkdir(path.dirname(outputPath), {
      recursive: true
    });
    const prepared = await prepareAgentPreviewCommand({
      commandService,
      env: {
        VIBE64_RUNTIME_PACK_ROOT: runtimeRoot
      },
      sessionId,
      wrapperHostDir: path.join(root, "commands")
    });
    const commandEnv = {
      ...process.env,
      ...prepared.env
    };

    const written = JSON.parse((await execFileAsync(prepared.hostWrapperPath, [
      "browser",
      "storage-state",
      "default",
      "--output",
      outputPath
    ], {
      env: commandEnv
    })).stdout);

    assert.deepEqual(written, {
      outputPath
    });
    assert.deepEqual(JSON.parse(await readFile(outputPath, "utf8")), {
      cookies: [{
        domain: "preview.example.test",
        expires: -1,
        httpOnly: true,
        name: "app_session",
        path: "/",
        sameSite: "Lax",
        secure: true,
        value: "ada@example.com"
      }],
      origins: []
    });
    assert.equal((await stat(outputPath)).mode & 0o777, 0o600);

    const browserStatus = JSON.parse((await execFileAsync(
      prepared.hostWrapperPath,
      ["browser", "status"],
      { env: commandEnv }
    )).stdout);
    assert.equal(browserStatus.applicationIdentity, null);
    assert.equal(browserStatus.started, false);
    assert.equal(browserStatus.browserProcessGroupCount, 0);
  } finally {
    await commandService.closeAllForSession(sessionId);
    await rm(root, {
      force: true,
      recursive: true
    });
  }
});

test("Playwright state preserves host and application cookies without starting Chromium", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-preview-request-state-"));
  const runtimeRoot = path.join(root, "runtime-packs");
  const sessionId = "request-state-session";
  const outputPath = path.join(root, "storage-state.json");
  const requests = [];
  let invalidExchangeStatus = null;
  const server = http.createServer(async (request, response) => {
    requests.push([request.method, request.url]);
    if (request.method === "GET") {
      response.writeHead(401, { "Set-Cookie": "preview_session=host; Path=/; HttpOnly" });
      response.end('<script src="/must-not-load.js"></script>');
      return;
    }
    let body = "";
    for await (const chunk of request) body += chunk;
    if (invalidExchangeStatus !== null) {
      response.writeHead(invalidExchangeStatus, { "Content-Type": "text/html" });
      response.end("<html>Unexpected application page with private details</html>");
      return;
    }
    const authorized = request.url === PREVIEW_IDENTITY_CONTROL_PATH &&
      request.headers.cookie?.includes("preview_session=host") &&
      JSON.parse(body).grant === "request-state-grant";
    response.writeHead(authorized ? 200 : 403, {
      "Content-Type": "application/json",
      ...(authorized ? { "Set-Cookie": "app_session=ada; Path=/; HttpOnly; SameSite=Lax" } : {})
    });
    response.end(JSON.stringify({ ok: authorized }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const previewUrl = `http://127.0.0.1:${server.address().port}/home?vibe64_preview_token=test`;
  const commandService = createReadyPreviewCommandService({
    previewUrl,
    async selectPreviewIdentity() {
      return { ok: true, grant: "request-state-grant", requestedIdentity: { mode: "identity" } };
    }
  });
  try {
    const { playwrightModule } = await createFakePlaywrightRuntime(runtimeRoot);
    const playwrightPath = createRequire(import.meta.url).resolve("playwright");
    await writeFile(path.join(playwrightModule, "index.js"), `
exports.request = require(${JSON.stringify(playwrightPath)}).request;
exports.chromium = { launch() { throw new Error("Storage state must not start Chromium."); } };
`, "utf8");
    const prepared = await prepareAgentPreviewCommand({
      commandService, env: { VIBE64_RUNTIME_PACK_ROOT: runtimeRoot }, sessionId,
      wrapperHostDir: path.join(root, "commands")
    });
    await execFileAsync(prepared.hostWrapperPath, ["browser", "storage-state", "default", "--output", outputPath], {
      env: { ...process.env, ...prepared.env }
    });
    const state = JSON.parse(await readFile(outputPath, "utf8"));
    assert.deepEqual(state.cookies.map(({ name, value, httpOnly }) => ({ name, value, httpOnly })), [
      { name: "preview_session", value: "host", httpOnly: true },
      { name: "app_session", value: "ada", httpOnly: true }
    ]);
    assert.deepEqual(requests, [["GET", "/home?vibe64_preview_token=test"], ["POST", PREVIEW_IDENTITY_CONTROL_PATH]]);
    assert.deepEqual(state.origins, []);
    for (const status of [404, 200]) {
      invalidExchangeStatus = status;
      await assert.rejects(
        execFileAsync(prepared.hostWrapperPath, ["browser", "storage-state", "default", "--output", outputPath], {
          env: { ...process.env, ...prepared.env }
        }),
        (error) => {
          assert.ok(error.stderr.includes(`Preview identity exchange failed (HTTP ${status}).`));
          assert.doesNotMatch(error.stderr, /private details|request-state-grant/u);
          return true;
        }
      );
      assert.deepEqual(JSON.parse(await readFile(outputPath, "utf8")), state);
    }
  } finally {
    await commandService.closeAllForSession(sessionId);
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});

test("agent preview wrapper captures the authenticated page from a long workspace path", async () => {
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
      wrapperHostDir: path.join(root, "workspace-path-".repeat(8), "wrappers")
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

test("managed preview browser inspects auxiliary localhost apps and recovers killed processes", async () => {
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

    const auxiliaryUrl = "http://127.0.0.1:8181/view-jobs/11514";
    const auxiliaryPage = JSON.parse((await execWithInput(prepared.hostWrapperPath, ["browser", "eval"], {
      env: commandEnv,
      input: `await page.goto(${JSON.stringify(auxiliaryUrl)}, { waitUntil: "load" }); return page.url();`
    })).stdout);
    assert.equal(auxiliaryPage.result, auxiliaryUrl);
    assert.equal(auxiliaryPage.url, auxiliaryUrl);

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

test("managed preview browser recovers a stale ownership record through its session owner", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-browser-stale-owner-"));
  const runtimeRoot = path.join(root, "runtime-packs");
  const sessionId = "stale-browser-session";
  const selectors = [];
  const commandService = createReadyPreviewCommandService({
    previewUrl: "https://preview.example.test/recovered",
    async stopOwnedExecutions(selector) {
      selectors.push(selector);
      return { ok: true, scopeEmpty: true, supported: true };
    }
  });
  try {
    await createFakePlaywrightRuntime(runtimeRoot);
    const prepared = await prepareAgentPreviewCommand({
      commandService,
      env: { VIBE64_RUNTIME_PACK_ROOT: runtimeRoot },
      project: { slug: "browser-project" },
      sessionId,
      wrapperHostDir: root
    });
    await writeFile(prepared.hostBrowserMetadataPath, JSON.stringify({
      executionId: "foreign-execution-must-not-be-stopped",
      signature: "previous-service-token"
    }));
    const results = await Promise.all(Array.from({ length: 3 }, async () => {
      const result = await execFileAsync(prepared.hostWrapperPath, ["browser", "ensure"], {
        env: { ...process.env, ...prepared.env }
      });
      return JSON.parse(result.stdout);
    }));
    const [result] = results;
    assert.equal(result.started, true);
    assert.equal(new Set(results.map((entry) => entry.pid)).size, 1);
    assert.deepEqual(selectors, [{
      kind: "browser",
      ownerId: sessionId,
      projectSlug: "browser-project",
      sessionId
    }]);
    const metadata = JSON.parse(await readFile(prepared.hostBrowserMetadataPath, "utf8"));
    assert.equal(metadata.pid, result.pid);
    assert.notEqual(metadata.executionId, "foreign-execution-must-not-be-stopped");
  } finally {
    await commandService.closeAllForSession(sessionId);
    await rm(root, { force: true, recursive: true });
  }
});

test("managed preview browser can retry recovery after cleanup fails", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-browser-retry-cleanup-"));
  const runtimeRoot = path.join(root, "runtime-packs");
  const sessionId = "retry-browser-session";
  let scopeEmpty = false;
  const commandService = createReadyPreviewCommandService({
    previewUrl: "https://preview.example.test/retry",
    async stopOwnedExecutions() {
      return { supported: true, scopeEmpty };
    }
  });
  try {
    await createFakePlaywrightRuntime(runtimeRoot);
    const prepared = await prepareAgentPreviewCommand({
      commandService,
      env: { VIBE64_RUNTIME_PACK_ROOT: runtimeRoot },
      sessionId,
      wrapperHostDir: root
    });
    await writeFile(prepared.hostBrowserMetadataPath, "stale state");
    const env = { ...process.env, ...prepared.env };
    await assert.rejects(
      execFileAsync(prepared.hostWrapperPath, ["browser", "ensure"], { env }),
      /no valid execution ownership record/u
    );
    scopeEmpty = true;
    const result = await execFileAsync(prepared.hostWrapperPath, ["browser", "ensure"], { env });
    assert.equal(JSON.parse(result.stdout).started, true);
  } finally {
    await commandService.closeAllForSession(sessionId);
    await rm(root, { force: true, recursive: true });
  }
});

test("managed preview browser preserves stale files when owner cleanup is unproven", async () => {
  for (const proof of [{ supported: false, scopeEmpty: true }, { supported: true, scopeEmpty: false }]) {
    const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-browser-unproven-"));
    const sessionId = "unproven-browser-session";
    let starts = 0;
    const commandService = createReadyPreviewCommandService({
      previewUrl: "https://preview.example.test/blocked",
      async runManagedCommand() {
        starts += 1;
        throw new Error("Must not start a replacement.");
      },
      async stopOwnedExecutions() {
        return proof;
      }
    });
    try {
      const prepared = await prepareAgentPreviewCommand({ commandService, sessionId, wrapperHostDir: root });
      await writeFile(prepared.hostBrowserMetadataPath, "invalid metadata");
      await assert.rejects(execFileAsync(prepared.hostWrapperPath, ["browser", "ensure"], {
        env: { ...process.env, ...prepared.env }
      }), /no valid execution ownership record/u);
      assert.equal(starts, 0);
      assert.equal(await readFile(prepared.hostBrowserMetadataPath, "utf8"), "invalid metadata");
    } finally {
      await commandService.closeAllForSession(sessionId);
      await rm(root, { force: true, recursive: true });
    }
  }
});

test("managed preview browser does not replace an unrelated listener after owner cleanup", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-browser-foreign-listener-"));
  const sessionId = "foreign-listener-session";
  const listener = http.createServer((request, response) => {
    response.writeHead(403);
    response.end("unrelated listener");
  });
  let starts = 0;
  const commandService = createReadyPreviewCommandService({
    previewUrl: "https://preview.example.test/blocked",
    async runManagedCommand() {
      starts += 1;
      throw new Error("Must not start a replacement.");
    },
    async stopOwnedExecutions() {
      return { supported: true, scopeEmpty: true };
    }
  });
  try {
    const prepared = await prepareAgentPreviewCommand({ commandService, sessionId, wrapperHostDir: root });
    await new Promise((resolve) => listener.listen(prepared.hostBrowserSocketPath, resolve));
    await writeFile(prepared.hostBrowserMetadataPath, "unrelated metadata");
    await assert.rejects(execFileAsync(prepared.hostWrapperPath, ["browser", "ensure"], {
      env: { ...process.env, ...prepared.env }
    }), /unverified listener/u);
    assert.equal(starts, 0);
    assert.equal(listener.listening, true);
    assert.equal((await stat(prepared.hostBrowserSocketPath)).isSocket(), true);
    assert.equal(await readFile(prepared.hostBrowserMetadataPath, "utf8"), "unrelated metadata");
  } finally {
    await new Promise((resolve) => listener.close(resolve));
    await commandService.closeAllForSession(sessionId);
    await rm(root, { force: true, recursive: true });
  }
});

test("managed preview browser drains the previous control generation before replacement", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-preview-browser-upgrade-"));
  const runtimeRoot = path.join(root, "runtime-packs");
  const sessionId = "browser-upgrade-session";
  const commandService = createReadyPreviewCommandService({
    previewUrl: "https://preview.example.test/upgrade?vibe64_preview_token=upgrade-token"
  });
  try {
    await createFakePlaywrightRuntime(runtimeRoot);
    const preparationOptions = {
      commandService,
      env: {
        VIBE64_RUNTIME_PACK_ROOT: runtimeRoot
      },
      sessionId,
      wrapperHostDir: root
    };
    const prepared = await prepareAgentPreviewCommand(preparationOptions);
    const firstCommandEnv = {
      ...process.env,
      ...prepared.env
    };
    const currentContractVersion = prepared.env[VIBE64_AGENT_PREVIEW_COMMAND_CONTRACT_VERSION_ENV];
    const firstGeneration = prepared.controlGenerationId;
    const firstBrowser = JSON.parse((await execWithInput(prepared.hostWrapperPath, ["browser", "eval"], {
      env: firstCommandEnv,
      input: "return { childPid: browser.childPid };"
    })).stdout);
    const firstMetadata = JSON.parse(await readFile(prepared.hostBrowserMetadataPath, "utf8"));
    assert.equal(firstMetadata.contractVersion, currentContractVersion);

    await commandService.releaseControlForSession(sessionId);
    assert.equal(processRunning(firstMetadata.pid), false);
    assert.equal(processRunning(firstBrowser.result.childPid), false);

    const replacement = await prepareAgentPreviewCommand(preparationOptions);
    assert.notEqual(replacement.controlGenerationId, firstGeneration);
    const replacementEnv = {
      ...process.env,
      ...replacement.env
    };
    const currentStatus = JSON.parse((await execFileAsync(prepared.hostWrapperPath, ["browser", "ensure"], {
      env: replacementEnv
    })).stdout);
    const currentMetadata = JSON.parse(await readFile(prepared.hostBrowserMetadataPath, "utf8"));
    assert.equal(currentStatus.contractVersion, currentContractVersion);
    assert.equal(currentMetadata.contractVersion, currentContractVersion);
    assert.notEqual(currentMetadata.pid, firstMetadata.pid);
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
      const ensured = JSON.parse((await execFileAsync(prepared.hostWrapperPath, ["browser", "ensure"], {
        env: {
          ...process.env,
          ...prepared.env
        }
      })).stdout);
      if (mode === "control-loss") {
        await commandService.releaseControlForSession(sessionId);
      }
      for (let attempt = 0; attempt < 100 && processRunning(ensured.pid); attempt += 1) {
        await wait(25);
      }
      assert.equal(processRunning(ensured.pid), false, `${mode} worker should exit`);
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

test("agent preview preparation repairs one missing cached socket and fences its old generation", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-preview-command-repair-"));
  const sessionId = "preview-repair-session";
  const commandService = createReadyPreviewCommandService({
    previewUrl: "https://preview.example.test/repair"
  });
  try {
    const options = {
      commandService,
      sessionId,
      wrapperHostDir: root
    };
    const first = await prepareAgentPreviewCommand(options);
    await rm(first.hostSocketPath, { force: true });

    const [left, right] = await Promise.all([
      prepareAgentPreviewCommand(options),
      prepareAgentPreviewCommand(options)
    ]);

    assert.notEqual(left.controlGenerationId, first.controlGenerationId);
    assert.equal(right.controlGenerationId, left.controlGenerationId);
    assert.equal((await stat(left.hostSocketPath)).isSocket(), true);
    await assert.rejects(execFileAsync(first.hostWrapperPath, ["status", "--json"], {
      env: {
        ...process.env,
        ...first.env
      }
    }), (error) => {
      assert.match(error.stderr, /vibe64_agent_control_unavailable/u);
      return true;
    });
    const current = await execFileAsync(left.hostWrapperPath, ["status", "--json"], {
      env: {
        ...process.env,
        ...left.env
      }
    });
    assert.equal(JSON.parse(current.stdout).ready, true);
  } finally {
    await commandService.closeAllForSession(sessionId);
    await rm(root, {
      force: true,
      recursive: true
    });
  }
});
