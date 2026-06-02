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
  previewReadyLoadNumber = 1
}: {
  previewReadyDelayMs?: number;
  previewReadyLoadNumber?: number;
} = {}) {
  const session = sessionPayload();
  let previewLoadCount = 0;
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
        sessionId: SESSION_ID
      });
      return;
    }
    if (method === "GET" && /\/sessions\/[^/]+$/u.test(url.pathname)) {
      await fulfillJson(route, {
        ok: true,
        ...session
      });
      return;
    }
    await fulfillJson(route, {
      limits: {
        maxOpenSessions: 5,
        openSessionCount: 1
      },
      ok: true,
      sessions: [session]
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

function sessionPayload() {
  return {
    actionResults: [],
    actions: [],
    artifactsRoot: `/workspace/example-target-app/.vibe64/sessions/active/${SESSION_ID}/artifacts`,
    completedSteps: ["worktree_created"],
    createdAt: "2026-05-24T00:00:00.000Z",
    currentStep: "maintenance_conversation",
    currentStepDefinition: {
      id: "maintenance_conversation",
      label: "Maintenance"
    },
    intents: [],
    metadata: {
      worktree_path: `/workspace/example-target-app/.vibe64/sessions/active/${SESSION_ID}/worktree`
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
    sessionId: SESSION_ID,
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
    title: "Renderer session",
    updatedAt: "2026-05-24T00:00:00.000Z",
    workflowId: "test-workflow",
    worktree: `/workspace/example-target-app/.vibe64/sessions/active/${SESSION_ID}/worktree`,
    worktreeReady: true
  };
}

async function fulfillJson(route: Route, payload: unknown) {
  await route.fulfill({
    body: JSON.stringify(payload),
    contentType: "application/json"
  });
}
