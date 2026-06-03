import { expect, test, type Page, type Route } from "@playwright/test";

import { BASE_URL } from "./support/base-shell-data";
import {
  mockStudioReady
} from "./support/base-shell-mocks";

const SESSION_ID = "session-renderer";
const TARGET_APP_URL = "http://127.0.0.1:4103/home";
const PROXY_APP_URL = "http://127.0.0.1:49000/home";

test("embedded preview renders through the proxy and displays the target URL", async ({ page }) => {
  await mockLaunchTerminalSocket(page);
  await mockLaunchSession(page);

  await page.goto(`${BASE_URL}/home`);

  const previewFrame = page.locator(".vibe64-launch-controls__preview-frame");
  await expect(previewFrame).toBeVisible();
  await expect(previewFrame).toHaveAttribute("src", /http:\/\/127\.0\.0\.1:49000\/home/u);
  await expect(
    page.frameLocator(".vibe64-launch-controls__preview-frame").getByText("Preview app")
  ).toBeVisible();
  await expect(page.getByText(TARGET_APP_URL)).toBeVisible();
});

test("embedded preview keeps the opening overlay until the bridge reports rendered content", async ({ page }) => {
  await mockLaunchTerminalSocket(page);
  await mockLaunchSession(page, {
    previewReadyDelayMs: 1000
  });

  await page.goto(`${BASE_URL}/home`);

  await expect(page.locator(".vibe64-launch-controls__preview-overlay")).toContainText("Opening preview.");
  await expect(page.locator(".vibe64-launch-controls__preview-overlay")).toHaveCount(0);
});

test("embedded preview retries when the first iframe load never reports ready", async ({ page }) => {
  await mockLaunchTerminalSocket(page);
  await mockLaunchSession(page, {
    previewReadyLoadNumber: 3
  });

  await page.goto(`${BASE_URL}/home`);

  await expect(page.locator(".vibe64-launch-controls__preview-overlay")).toContainText("Opening preview.");
  await expect(page.locator(".vibe64-launch-controls__preview-frame")).toHaveAttribute("src", /vibe64_reload=2/u, {
    timeout: 12000
  });
  await expect(page.locator(".vibe64-launch-controls__preview-overlay")).toHaveCount(0);
});

test("embedded preview stays mounted and does not reload while covered by dashboard", async ({ page }) => {
  await mockLaunchTerminalSocket(page);
  await mockLaunchSession(page, {
    previewReadyLoadNumber: 99
  });

  await page.goto(`${BASE_URL}/home`);

  const previewFrame = page.locator(".vibe64-launch-controls__preview-frame");
  await expect(previewFrame).toHaveCount(1);
  await expect(page.locator(".vibe64-launch-controls__preview-overlay")).toContainText("Opening preview.");

  const initialSrc = await previewFrame.getAttribute("src");
  await page.evaluate(() => {
    const frame = document.querySelector(".vibe64-launch-controls__preview-frame");
    const shellPane = document.querySelector(".shell-route-transition__pane");
    (window as unknown as { __vibe64ShellPane?: Element | null }).__vibe64ShellPane = shellPane;
    (window as unknown as { __vibe64PreviewFrame?: Element | null }).__vibe64PreviewFrame = frame;
  });

  await page.getByRole("tab", { name: "Dashboard" }).click();
  await expect(page).toHaveURL(/\/home\/dashboard\/accounts\/?$/u);
  await page.waitForTimeout(5500);

  await expect(previewFrame).toHaveCount(1);
  expect(await previewFrame.getAttribute("src")).toBe(initialSrc);
  const identity = await page.evaluate(() => {
    const frame = document.querySelector(".vibe64-launch-controls__preview-frame");
    const shellPane = document.querySelector(".shell-route-transition__pane");
    const refs = window as unknown as {
      __vibe64PreviewFrame?: Element | null;
      __vibe64ShellPane?: Element | null;
    };
    return {
      frameSame: frame === refs.__vibe64PreviewFrame,
      shellPaneSame: shellPane === refs.__vibe64ShellPane
    };
  });
  expect(identity.frameSame).toBe(true);

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

  await page.goto(`${BASE_URL}/home`);
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

test("embedded launch terminal can be shown and hidden again", async ({ page }) => {
  await mockLaunchTerminalSocket(page);
  await mockLaunchSession(page);

  await page.goto(`${BASE_URL}/home`);

  await expect(page.getByRole("button", {
    name: "Show launch terminal"
  })).toBeVisible();
  await expect(page.locator(".vibe64-launch-controls__terminal--embedded")).toHaveCount(0);

  await page.getByRole("button", {
    name: "Show launch terminal"
  }).click();

  await expect(page.locator(".vibe64-launch-controls__terminal--embedded")).toBeVisible();
  await expect(page.getByRole("button", {
    name: "Hide launch terminal"
  })).toBeVisible();
  await expect(page.getByText("Hide terminal")).toBeVisible();

  await page.getByRole("button", {
    name: "Hide launch terminal"
  }).click();

  await expect(page.locator(".vibe64-launch-controls__terminal--embedded")).toHaveCount(0);
  await expect(page.getByRole("button", {
    name: "Show launch terminal"
  })).toBeVisible();
  await expect(page.getByText("Hide terminal")).toHaveCount(0);
});

async function mockLaunchSession(page: Page, {
  previewReadyDelayMs = 0,
  previewReadyLoadNumber = 1,
  session = sessionPayload(),
  sessionList = null
}: {
  previewReadyDelayMs?: number;
  previewReadyLoadNumber?: number;
  session?: ReturnType<typeof sessionPayload>;
  sessionList?: ReturnType<typeof sessionPayload>[] | null;
} = {}) {
  const listedSessions = Array.isArray(sessionList) ? sessionList : [session];
  let previewLoadCount = 0;
  function sessionForRequest(pathname: string) {
    const requestedSessionId = decodeURIComponent(pathname.split("/").at(-1) || "");
    return listedSessions.find((item) => item.sessionId === requestedSessionId) || session;
  }
  await mockStudioReady(page);
  await page.route("**/api/vibe64/sessions**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    if (method === "GET" && url.pathname.endsWith("/launch-targets")) {
      await fulfillJson(route, launchStatusPayload());
      return;
    }
    if (method === "POST" && url.pathname.endsWith("/launch-terminal")) {
      await fulfillJson(route, {
        ok: true,
        ...launchStatusPayload().activeTerminal
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
    await route.fulfill({
      body: previewAppHtml({
        readyDelayMs: previewReadyDelayMs,
        readyEnabled: previewLoadCount >= previewReadyLoadNumber
      }),
      contentType: "text/html"
    });
  });
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

async function mockLaunchTerminalSocket(page: Page) {
  await page.addInitScript((targetAppUrl) => {
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
        }, 0);
      }

      send() {}

      close() {
        this.readyState = MockWebSocket.CLOSED;
        this.dispatchEvent(new CloseEvent("close"));
      }
    }

    window.WebSocket = MockWebSocket as unknown as typeof WebSocket;
  }, TARGET_APP_URL);
}

function launchStatusPayload() {
  return {
    activeTerminal: {
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
    },
    launchTargets: [
      {
        available: true,
        id: "dev",
        label: "Run app"
      }
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
  sessionId = SESSION_ID,
  title = "Renderer session"
}: {
  sessionId?: string;
  title?: string;
} = {}) {
  return {
    actionResults: [],
    actions: [],
    artifactsRoot: `/workspace/example-target-app/.vibe64/sessions/active/${sessionId}/artifacts`,
    completedSteps: ["worktree_created"],
    createdAt: "2026-05-24T00:00:00.000Z",
    currentStep: "maintenance_conversation",
    currentStepDefinition: {
      id: "maintenance_conversation",
      label: "Maintenance"
    },
    intents: [],
    metadata: {
      worktree_path: `/workspace/example-target-app/.vibe64/sessions/active/${sessionId}/worktree`
    },
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
    worktree: `/workspace/example-target-app/.vibe64/sessions/active/${sessionId}/worktree`,
    worktreeReady: true
  };
}

async function fulfillJson(route: Route, payload: unknown) {
  await route.fulfill({
    body: JSON.stringify(payload),
    contentType: "application/json"
  });
}
