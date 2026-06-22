import { expect, test, type Page, type Route } from "@playwright/test";

import {
  BASE_URL,
  DASHBOARD_PATH,
  DEVELOPMENT_PATH
} from "./support/base-shell-data";
import {
  mockStudioReady
} from "./support/base-shell-mocks";

const SESSION_ID = "session-renderer";
const TARGET_APP_URL = "http://127.0.0.1:4103/home";
const PROXY_APP_URL = "http://127.0.0.1:49000/home";

test("embedded preview renders through the proxy and displays the target URL", async ({ page }) => {
  await mockLaunchTerminalSocket(page);
  await mockLaunchSession(page);

  await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);

  const previewFrame = page.locator(".vibe64-launch-controls__preview-frame");
  await expect(previewFrame).toBeVisible();
  await expect(previewFrame).toHaveAttribute("src", /http:\/\/127\.0\.0\.1:49000\/home/u);
  await expect(
    page.frameLocator(".vibe64-launch-controls__preview-frame").getByText("Preview app")
  ).toBeVisible();
  await expect(page.getByText(TARGET_APP_URL)).toBeVisible();
});

test("embedded preview loads launch targets from session summaries without worktree paths", async ({ page }) => {
  await mockLaunchTerminalSocket(page);
  await mockLaunchSession(page, {
    session: sessionPayload({
      includeWorktreePaths: false
    })
  });

  await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);

  const previewFrame = page.locator(".vibe64-launch-controls__preview-frame");
  await expect(previewFrame).toBeVisible();
  await expect(previewFrame).toHaveAttribute("src", /http:\/\/127\.0\.0\.1:49000\/home/u);
  await expect(page.frameLocator(".vibe64-launch-controls__preview-frame").getByText("Preview app")).toBeVisible();
});

test("embedded preview auto-starts the dev target without exposing the target picker", async ({ page }) => {
  await mockLaunchTerminalSocket(page);
  const launchSession = await mockLaunchSession(page, {
    initialLaunchStatus: {
      ...launchStatusPayload(),
      activeTerminal: null,
      launchTargets: [
        {
          available: true,
          id: "built",
          label: "Run built app"
        },
        {
          available: true,
          id: "dev",
          label: "Run app"
        }
      ],
      openTarget: {
        available: false,
        disabledReason: "Run a launch target first.",
        href: "",
        kind: "url",
        label: "Open browser",
        previewHref: ""
      },
      previewTarget: {
        available: false,
        disabledReason: "Run a launch target first.",
        href: "",
        kind: "url",
        label: "Preview",
        targetHref: ""
      }
    },
    launchTerminalDelayMs: 1000
  });

  await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);

  await expect.poll(() => launchSession.getLaunchStartPayloads()).toEqual([
    {
      launchInput: {
        values: {}
      },
      launchTargetId: "dev"
    }
  ]);
  await expect(page.locator(".vibe64-launch-controls__run-button")).toHaveCount(0);
  await expect(page.getByText("Run built app")).toHaveCount(0);
});

test("embedded preview shows the start control while launch targets are still loading", async ({ page }) => {
  await mockLaunchTerminalSocket(page);
  const launchSession = await mockLaunchSession(page, {
    initialLaunchStatus: {
      ...launchStatusPayload(),
      activeTerminal: null,
      launchTargets: [
        {
          available: true,
          id: "dev",
          label: "Run app"
        }
      ],
      openTarget: {
        available: false,
        disabledReason: "Run a launch target first.",
        href: "",
        kind: "url",
        label: "Open browser",
        previewHref: ""
      },
      previewTarget: {
        available: false,
        disabledReason: "Run a launch target first.",
        href: "",
        kind: "url",
        label: "Preview",
        targetHref: ""
      }
    },
    launchTargetsDelayMs: 1000
  });

  await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);

  const startButton = page.locator(".vibe64-launch-controls__auto-start-button");
  await expect(startButton).toBeVisible();
  await expect(startButton).toBeDisabled();
  await expect.poll(() => launchSession.getLaunchStartPayloads()).toEqual([
    {
      launchInput: {
        values: {}
      },
      launchTargetId: "dev"
    }
  ]);
});

test("embedded preview clears the opening overlay when bridge reports rendered content", async ({ page }) => {
  await mockLaunchTerminalSocket(page);
  await mockLaunchSession(page, {
    previewReadyDelayMs: 100,
    previewResponseDelayMs: 1000
  });

  await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);

  await expect(page.locator(".vibe64-launch-controls__preview-overlay")).toContainText("Opening preview.");
  await expect(
    page.frameLocator(".vibe64-launch-controls__preview-frame").getByText("Preview app")
  ).toBeVisible();
  await expect(page.locator(".vibe64-launch-controls__preview-overlay")).toHaveCount(0);
});

test("embedded preview retries when iframe loads without a rendered-content bridge message", async ({ page }) => {
  await mockLaunchTerminalSocket(page);
  const launchSession = await mockLaunchSession(page, {
    previewReadyLoadNumber: 2
  });

  await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);

  const previewFrame = page.locator(".vibe64-launch-controls__preview-frame");
  await expect(page.frameLocator(".vibe64-launch-controls__preview-frame").getByText("Preview app")).toBeVisible();
  const initialSrc = await previewFrame.getAttribute("src");
  await expect(page.locator(".vibe64-launch-controls__preview-overlay")).toContainText("Opening preview.");
  await expect.poll(() => launchSession.getPreviewLoadCount(), {
    timeout: 7000
  }).toBe(2);
  expect(await previewFrame.getAttribute("src")).not.toBe(initialSrc);
  await expect(page.locator(".vibe64-launch-controls__preview-overlay")).toHaveCount(0);
});

test("embedded preview stays mounted and does not reload while covered by dashboard", async ({ page }) => {
  await mockLaunchTerminalSocket(page);
  const launchSession = await mockLaunchSession(page);

  await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);

  const previewFrame = page.locator(".vibe64-launch-controls__preview-frame");
  await expect(previewFrame).toHaveCount(1);
  await expect(page.locator(".vibe64-launch-controls__preview-overlay")).toHaveCount(0);

  const initialSrc = await previewFrame.getAttribute("src");
  const initialPreviewLoadCount = launchSession.getPreviewLoadCount();
  await page.evaluate(() => {
    const frame = document.querySelector(".vibe64-launch-controls__preview-frame");
    const shellPane = document.querySelector(".shell-route-transition__pane");
    (window as unknown as { __vibe64ShellPane?: Element | null }).__vibe64ShellPane = shellPane;
    (window as unknown as { __vibe64PreviewFrame?: Element | null }).__vibe64PreviewFrame = frame;
  });

  await page.getByRole("tab", { name: "Dashboard" }).click();
  await expect(page).toHaveURL(new RegExp(`${escapeRegExp(DASHBOARD_PATH)}/configure/?$`, "u"));
  await page.waitForTimeout(5500);

  await expect(previewFrame).toHaveCount(1);
  expect(await previewFrame.getAttribute("src")).toBe(initialSrc);
  expect(launchSession.getPreviewLoadCount()).toBe(initialPreviewLoadCount);

  await page.getByRole("tab", { name: "Preview" }).click();
  await expect(previewFrame).toHaveCount(1);
  expect(await previewFrame.getAttribute("src")).toBe(initialSrc);
});

test("embedded preview stays mounted when switching selected sessions", async ({ page }) => {
  await mockLaunchTerminalSocket(page);
  const alphaSession = sessionPayload({
    sessionId: "session-alpha",
    title: "Alpha"
  });
  const betaSession = sessionPayload({
    sessionId: "session-beta",
    title: "Beta"
  });
  await mockLaunchSession(page, {
    session: alphaSession,
    sessionList: [alphaSession, betaSession]
  });

  await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);
  const visibleSessionTab = (name: string) => page.locator(
    ".studio-ai-session-runtime:not([style*='display: none']) .studio-ai-sessions__tab",
    { hasText: name }
  );
  await visibleSessionTab("Alpha").click();

  const alphaRuntime = page.locator("[data-vibe64-session-runtime-id='session-alpha']");
  const alphaPreviewFrame = alphaRuntime.locator(".vibe64-launch-controls__preview-frame");
  await expect(alphaPreviewFrame).toHaveCount(1);
  const initialSrc = await alphaPreviewFrame.getAttribute("src");
  await page.evaluate(() => {
    const frame = document.querySelector("[data-vibe64-session-runtime-id='session-alpha'] .vibe64-launch-controls__preview-frame");
    (window as unknown as { __vibe64AlphaPreviewFrame?: Element | null }).__vibe64AlphaPreviewFrame = frame;
  });

  await visibleSessionTab("Beta").click();
  await expect(page.locator("[data-vibe64-session-runtime-id='session-beta']")).toBeVisible();

  await visibleSessionTab("Alpha").click();
  await expect(alphaRuntime).toBeVisible();
  await expect(alphaPreviewFrame).toHaveCount(1);
  expect(await alphaPreviewFrame.getAttribute("src")).toBe(initialSrc);
  await expect.poll(async () => page.evaluate(() => {
    const frame = document.querySelector("[data-vibe64-session-runtime-id='session-alpha'] .vibe64-launch-controls__preview-frame");
    const refs = window as unknown as { __vibe64AlphaPreviewFrame?: Element | null };
    return frame === refs.__vibe64AlphaPreviewFrame;
  })).toBe(true);
});

test("embedded preview options restart does not wait on the terminal stream", async ({ page }) => {
  await mockLaunchTerminalSocket(page, {
    terminalSocketNeverSettles: true
  });
  const launchSession = await mockLaunchSession(page, {
    launchTargetPreviewOptions: [
      {
        defaultValue: [],
        description: "Arguments passed to the app server command when previewing this app.",
        id: "startupArgs",
        label: "Startup arguments",
        placeholder: "--flag\nvalue",
        type: "string-list"
      }
    ]
  });

  await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);

  const previewOptionsButton = page.getByRole("button", {
    name: "Preview options"
  });
  await expect(previewOptionsButton).toBeVisible();
  await expect(previewOptionsButton).toBeEnabled();
  await expect.poll(() => page.locator(".vibe64-launch-controls__toolbar button").last().getAttribute("title"))
    .toBe("Preview options");
  const startCountBeforeRestart = launchSession.getLaunchStartPayloads().length;

  await previewOptionsButton.click();
  await page.getByLabel("Startup arguments").fill(".\n--debug");
  await page.getByRole("button", {
    name: "Save and restart preview"
  }).click();

  await expect.poll(() => launchSession.getLaunchStartPayloads().slice(startCountBeforeRestart)).toEqual([
    {
      launchInput: {
        values: {
          startupArgs: [
            ".",
            "--debug"
          ]
        }
      },
      launchTargetId: "dev"
    }
  ]);
  await expect(previewOptionsButton).toBeEnabled();
  await expect(page.locator("button[title='Restart']")).toBeEnabled();
});

test("mobile project navigation uses action labels after showing the project pane", async ({ page }) => {
  await page.setViewportSize({
    height: 844,
    width: 390
  });
  await mockLaunchTerminalSocket(page);
  await mockLaunchSession(page);

  await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);

  await expect(page.getByRole("button", {
    name: "Show project"
  })).toBeVisible();
  await expect(page.getByRole("tab", {
    exact: true,
    name: "Preview"
  })).toHaveCount(0);
  await expect(page.getByRole("tab", {
    exact: true,
    name: "Dashboard"
  })).toHaveCount(0);

  await page.getByRole("button", {
    name: "Show project"
  }).click();

  await expect(page.getByRole("tab", {
    exact: true,
    name: "Go to preview"
  })).toHaveCount(0);
  await expect(page.getByRole("tab", {
    exact: true,
    name: "Go to dashboard"
  })).toHaveCount(0);
  await expect(page.getByRole("button", {
    exact: true,
    name: "Go to dashboard"
  })).toBeVisible();
});

test("mobile dashboard section links keep the active project slug", async ({ page }) => {
  await page.setViewportSize({
    height: 844,
    width: 390
  });
  await mockLaunchTerminalSocket(page);
  await mockLaunchSession(page);

  await page.goto(`${BASE_URL}${DASHBOARD_PATH}/configure`);
  await page.getByRole("button", {
    name: "Show project"
  }).click();
  await page.locator(".section-container-shell__mobile-section-title", {
    hasText: "Runtime Config"
  }).click();

  await expect(page).toHaveURL(`${BASE_URL}${DASHBOARD_PATH}/runtime-config`);
  expect(page.url()).not.toContain("[slug]");
});

test("session panel shows loading feedback instead of empty create state while sessions load", async ({ page }) => {
  await mockLaunchTerminalSocket(page);
  await mockLaunchSession(page, {
    sessionListDelayMs: 3000
  });

  await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);

  await expect(page.getByText("Loading sessions.").first()).toBeVisible();
  await expect(page.getByText("Create a session to start preview.")).toHaveCount(0);
  await expect(page.getByRole("button", {
    name: "Create session"
  })).toHaveCount(0);
  await expect(page.getByRole("button", {
    name: "New session"
  })).toHaveCount(0);

  await expect(page.locator(".vibe64-launch-controls__preview-frame")).toBeVisible();
  await expect(page.getByText("Create a session to start preview.")).toHaveCount(0);
});

test("embedded launch terminal can be shown and hidden again", async ({ page }) => {
  await mockLaunchTerminalSocket(page);
  await mockLaunchSession(page);

  await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);

  await expect(page.getByRole("button", {
    name: "Show launch terminal"
  })).toBeVisible();
  const showButtonBox = await page.getByRole("button", {
    name: "Show launch terminal"
  }).boundingBox();
  await expect(page.locator(".vibe64-launch-controls__terminal--embedded")).toHaveCount(0);

  await page.getByRole("button", {
    name: "Show launch terminal"
  }).click();

  await expect(page.locator(".vibe64-launch-controls__terminal--embedded")).toBeVisible();
  await expect(page.getByRole("button", {
    name: "Hide launch terminal"
  })).toBeVisible();
  const hideButton = page.getByRole("button", {
    name: "Hide launch terminal"
  });
  await expect(hideButton).toHaveClass(/v-btn--icon/u);
  await expect.poll(async () => hideButton.evaluate((button) => button.textContent?.trim() || ""))
    .toBe("");
  const hideButtonBox = await hideButton.boundingBox();
  expect(hideButtonBox?.width).toBeLessThanOrEqual((showButtonBox?.width || 0) + 2);

  await page.getByRole("button", {
    name: "Hide launch terminal"
  }).click();

  await expect(page.locator(".vibe64-launch-controls__terminal--embedded")).toHaveCount(0);
  await expect(page.getByRole("button", {
    name: "Show launch terminal"
  })).toBeVisible();
  await expect(page.getByText("Hide terminal")).toHaveCount(0);
});

test("embedded launch terminal errors do not push the terminal host down", async ({ page }) => {
  await mockLaunchTerminalSocket(page, {
    terminalErrorDelayMs: 120
  });
  await mockLaunchSession(page);

  await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);
  await page.getByRole("button", {
    name: "Show launch terminal"
  }).click();

  const terminalHost = page.locator(".vibe64-launch-controls__terminal--embedded .vibe64-terminal-frame__host");
  await expect(terminalHost).toBeVisible();
  const hostTopBefore = await terminalHost.evaluate((element) => element.getBoundingClientRect().top);

  await expect(page.getByText("No command running.")).toBeVisible();
  const hostTopAfter = await terminalHost.evaluate((element) => element.getBoundingClientRect().top);

  expect(Math.abs(hostTopAfter - hostTopBefore)).toBeLessThan(1);
});

test("embedded launch terminal stays expanded after the launch exits", async ({ page }) => {
  await mockLaunchTerminalSocket(page, {
    terminalExitCode: 1,
    terminalExitDelayMs: 120
  });
  await mockLaunchSession(page);

  await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);
  await page.getByRole("button", {
    name: "Show launch terminal"
  }).click();

  const terminal = page.locator(".vibe64-launch-controls__terminal--embedded");
  const terminalHost = terminal.locator(".vibe64-terminal-frame__host");
  await expect(terminalHost).toBeVisible();
  const hostHeightBefore = await terminalHost.evaluate((element) => element.getBoundingClientRect().height);

  await expect(page.getByText("Exited with code 1")).toBeVisible();
  await expect(terminal).toBeVisible();
  const hostHeightAfter = await terminalHost.evaluate((element) => element.getBoundingClientRect().height);

  expect(hostHeightBefore).toBeGreaterThan(320);
  expect(hostHeightAfter).toBeGreaterThan(320);
  expect(Math.abs(hostHeightAfter - hostHeightBefore)).toBeLessThan(1);
});

async function mockLaunchSession(page: Page, {
  initialLaunchStatus = null,
  launchTargetPreviewOptions = [],
  launchTargetsDelayMs = 0,
  launchTerminalDelayMs = 0,
  previewReadyDelayMs = 0,
  previewReadyLoadNumber = 1,
  previewResponseDelayMs = 0,
  session = sessionPayload(),
  sessionList = null,
  sessionListDelayMs = 0
}: {
  initialLaunchStatus?: ReturnType<typeof launchStatusPayload> | null;
  launchTargetPreviewOptions?: unknown[];
  launchTargetsDelayMs?: number;
  launchTerminalDelayMs?: number;
  previewReadyDelayMs?: number;
  previewReadyLoadNumber?: number;
  previewResponseDelayMs?: number;
  session?: ReturnType<typeof sessionPayload>;
  sessionList?: ReturnType<typeof sessionPayload>[] | null;
  sessionListDelayMs?: number;
} = {}) {
  const listedSessions = Array.isArray(sessionList) ? sessionList : [session];
  const launchStartPayloads: unknown[] = [];
  let launchStarted = !initialLaunchStatus || Boolean(initialLaunchStatus.activeTerminal);
  let initialLaunchStatusActive = true;
  let previewLoadCount = 0;
  function currentLaunchStatus() {
    if (initialLaunchStatusActive && initialLaunchStatus) {
      return initialLaunchStatus;
    }
    return launchStatusPayload(launchStarted
      ? { launchTargetPreviewOptions }
      : {
          activeTerminal: null,
          launchTargetPreviewOptions
        });
  }
  function sessionForRequest(pathname: string) {
    const requestedSessionId = decodeURIComponent(pathname.split("/").at(-1) || "");
    return listedSessions.find((item) => item.sessionId === requestedSessionId) || session;
  }
  await mockStudioReady(page);
  await page.route(/\/api(?:\/app\/[^/]+)?\/vibe64\/sessions(?:\/.*)?(?:\?.*)?$/u, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    if (method === "GET" && url.pathname.endsWith("/launch-targets")) {
      if (launchTargetsDelayMs > 0) {
        await new Promise((resolve) => {
          setTimeout(resolve, launchTargetsDelayMs);
        });
      }
      await fulfillJson(route, currentLaunchStatus());
      return;
    }
    if (method === "POST" && url.pathname.endsWith("/launch-terminal")) {
      launchStartPayloads.push(request.postDataJSON());
      if (launchTerminalDelayMs > 0) {
        await new Promise((resolve) => {
          setTimeout(resolve, launchTerminalDelayMs);
        });
      }
      initialLaunchStatusActive = false;
      launchStarted = true;
      await fulfillJson(route, {
        ok: true,
        ...launchStatusPayload({
          launchTargetPreviewOptions
        }).activeTerminal
      });
      return;
    }
    if (method === "POST" && /\/launch-terminal\/[^/]+\/stop$/u.test(url.pathname)) {
      initialLaunchStatusActive = false;
      launchStarted = false;
      await fulfillJson(route, {
        id: "server-launch-terminal",
        ok: true,
        running: false,
        status: "exited"
      });
      return;
    }
    if (method === "GET" && url.pathname.endsWith("/conversation-log")) {
      await fulfillJson(route, {
        conversationLog: [],
        ok: true,
        sessionId: decodeURIComponent(url.pathname.split("/").at(-2) || "")
      });
      return;
    }
    if (method === "GET" && /\/sessions\/[^/]+$/u.test(url.pathname)) {
      await fulfillJson(route, {
        ok: true,
        ...sessionForRequest(url.pathname)
      });
      return;
    }
    if (sessionListDelayMs > 0) {
      await new Promise((resolve) => {
        setTimeout(resolve, sessionListDelayMs);
      });
    }
    await fulfillJson(route, {
      limits: {
        maxOpenSessions: 5,
        openSessionCount: 1
      },
      ok: true,
      sessions: listedSessions
    });
  });
  await page.route("http://127.0.0.1:49000/**", async (route) => {
    previewLoadCount += 1;
    if (previewResponseDelayMs > 0) {
      await new Promise((resolve) => {
        setTimeout(resolve, previewResponseDelayMs);
      });
    }
    await route.fulfill({
      body: previewAppHtml({
        readyDelayMs: previewReadyDelayMs,
        readyEnabled: previewLoadCount >= previewReadyLoadNumber
      }),
      contentType: "text/html"
    });
  });
  return {
    getLaunchStartPayloads() {
      return launchStartPayloads;
    },
    getPreviewLoadCount() {
      return previewLoadCount;
    }
  };
}

function escapeRegExp(value: string) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function previewAppHtml({
  readyDelayMs = 0,
  readyEnabled = true
}: {
  readyDelayMs?: number;
  readyEnabled?: boolean;
} = {}) {
  const locationMessage = JSON.stringify({
    href: TARGET_APP_URL,
    reason: "ready",
    type: "vibe64:preview-location",
    version: 1
  });
  const readyMessage = {
    href: TARGET_APP_URL,
    reason: "rendered",
    type: "vibe64:preview-ready",
    version: 1
  };
  const readyDelay = Number(readyDelayMs) || 0;
  return `<!doctype html><title>Preview</title><body>Preview app<script>
parent.postMessage(${locationMessage}, "*");
const readyEnabled = ${JSON.stringify(readyEnabled)};
function postReady(reason) {
  if (!readyEnabled) {
    return;
  }
  parent.postMessage({
    ...${JSON.stringify(readyMessage)},
    reason
  }, "*");
}
setTimeout(() => postReady("rendered"), ${readyDelay});
</script></body>`;
}

async function mockLaunchTerminalSocket(page: Page, {
  terminalErrorDelayMs = 0,
  terminalExitCode = 0,
  terminalExitDelayMs = 0,
  terminalSocketNeverSettles = false
}: {
  terminalErrorDelayMs?: number;
  terminalExitCode?: number;
  terminalExitDelayMs?: number;
  terminalSocketNeverSettles?: boolean;
} = {}) {
  await page.addInitScript(({
    targetAppUrl,
    terminalErrorDelayMs: errorDelayMs,
    terminalExitCode: exitCode,
    terminalExitDelayMs: exitDelayMs,
    terminalSocketNeverSettles: neverSettles
  }) => {
    const OriginalWebSocket = window.WebSocket;

    class MockWebSocket extends EventTarget {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;
      readyState = MockWebSocket.CONNECTING;
      url = "";

      constructor(url: string | URL) {
        super();
        this.url = String(url || "");
        const pathname = new URL(this.url, window.location.href).pathname;
        if (!pathname.includes("/launch-terminal/")) {
          return new OriginalWebSocket(url);
        }
        if (neverSettles) {
          return;
        }
        window.setTimeout(() => {
          this.readyState = MockWebSocket.OPEN;
          this.dispatchEvent(new Event("open"));
          this.dispatchEvent(new MessageEvent("message", {
            data: JSON.stringify({
              session: {
                commandPreview: "npm run dev",
                id: "server-launch-terminal",
                metadata: {
                  actions: [
                    {
                      href: targetAppUrl,
                      id: "url-dev",
                      kind: "url",
                      label: "Open browser"
                    }
                  ],
                  launchReady: true,
                  launchTargetId: "dev",
                  launchTargetLabel: "Run app"
                },
                ok: true,
                output: `action:url:${targetAppUrl}\nready`,
                status: "running"
              },
              type: "snapshot"
            })
          }));
          if (errorDelayMs > 0) {
            window.setTimeout(() => {
              this.dispatchEvent(new MessageEvent("message", {
                data: JSON.stringify({
                  error: "Terminal session not found.",
                  type: "error"
                })
              }));
            }, errorDelayMs);
          }
          if (exitDelayMs > 0) {
            window.setTimeout(() => {
              this.dispatchEvent(new MessageEvent("message", {
                data: JSON.stringify({
                  exitCode,
                  status: "exited",
                  type: "status"
                })
              }));
            }, exitDelayMs);
          }
        }, 0);
      }

      send() {}

      close() {
        this.readyState = MockWebSocket.CLOSED;
        this.dispatchEvent(new CloseEvent("close"));
      }
    }

    window.WebSocket = MockWebSocket as unknown as typeof WebSocket;
  }, {
    targetAppUrl: TARGET_APP_URL,
    terminalErrorDelayMs,
    terminalExitCode,
    terminalExitDelayMs,
    terminalSocketNeverSettles
  });
}

function launchStatusPayload(options: {
  activeTerminal?: unknown;
  launchTargetPreviewOptions?: unknown[];
} = {}) {
  const launchTargetPreviewOptions = options.launchTargetPreviewOptions || [];
  const terminal = Object.hasOwn(options, "activeTerminal")
    ? options.activeTerminal
    : {
        commandPreview: "npm run dev",
        id: "server-launch-terminal",
        metadata: {
          actions: [
            {
              href: TARGET_APP_URL,
              id: "url-dev",
              kind: "url",
              label: "Open browser"
            }
          ],
          launchReady: true,
          launchTargetId: "dev",
          launchTargetLabel: "Run app"
        },
        output: `action:url:${TARGET_APP_URL}\nready`,
        running: true,
        status: "running"
      };
  const devLaunchTarget = {
    available: true,
    id: "dev",
    label: "Run app",
    ...(launchTargetPreviewOptions.length > 0 ? { previewOptions: launchTargetPreviewOptions } : {})
  };
  return {
    activeTerminal: terminal,
    launchTargets: [
      devLaunchTarget
    ],
    ok: true,
    openTarget: {
      available: true,
      href: TARGET_APP_URL,
      kind: "url",
      label: "Open browser",
      previewHref: PROXY_APP_URL
    },
    previewTarget: {
      available: true,
      disabledReason: "",
      href: PROXY_APP_URL,
      kind: "url",
      label: "Preview",
      targetHref: TARGET_APP_URL
    }
  };
}

function sessionPayload({
  includeWorktreePaths = true,
  sessionId = SESSION_ID,
  title = "Renderer session"
}: {
  includeWorktreePaths?: boolean;
  sessionId?: string;
  title?: string;
} = {}) {
  const session = {
    actionResults: [],
    actions: [],
    completedSteps: ["worktree_created"],
    createdAt: "2026-05-24T00:00:00.000Z",
    currentStep: "maintenance_conversation",
    currentStepDefinition: {
      id: "maintenance_conversation",
      label: "Maintenance"
    },
    intents: [],
    metadata: {},
    next: {
      disabledReason: "",
      enabled: false,
      label: "Next step",
      stepId: "next_step",
      visible: true
    },
    presentation: {
      auto: {
        nextOperation: {
          executable: false,
          kind: "wait",
          reason: "user"
        }
      },
      intents: [],
      screen: {
        kind: "ready",
        sections: [],
        title: "Ready"
      },
      step: {
        id: "maintenance_conversation",
        label: "Maintenance",
        status: "ready"
      }
    },
    sessionId,
    sessionRoot: `/workspace/example-target-app/.vibe64-local/sessions/active/${sessionId}`,
    status: "active",
    stepDefinitions: [
      {
        id: "maintenance_conversation",
        label: "Maintenance",
        status: "current"
      }
    ],
    stepMachine: {
      status: "ready",
      stepId: "maintenance_conversation"
    },
    targetRoot: "/workspace/example-target-app",
    title,
    updatedAt: "2026-05-24T00:00:00.000Z",
    workflowId: "test-workflow",
  };
  if (!includeWorktreePaths) {
    return session;
  }
  return {
    ...session,
    artifactsRoot: `/workspace/example-target-app/.vibe64-local/sessions/active/${sessionId}/artifacts`,
    metadata: {
      worktree_path: `/workspace/example-target-app/.vibe64-local/sessions/active/${sessionId}/worktree`
    },
    targetRoot: "/workspace/example-target-app",
    worktree: `/workspace/example-target-app/.vibe64-local/sessions/active/${sessionId}/worktree`,
    worktreeReady: true
  };
}

async function fulfillJson(route: Route, payload: unknown) {
  await route.fulfill({
    body: JSON.stringify(payload),
    contentType: "application/json"
  });
}
