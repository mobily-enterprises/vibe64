import { expect, test, type Page, type Route } from "@playwright/test";
import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";

import {
  injectLaunchPreviewBridge
} from "../../packages/vibe64-terminals/src/server/launchPreviewBridge.js";
import {
  PREVIEW_IDENTITY_CONTROL_PATH
} from "../../packages/vibe64-core/src/server/previewAuth.js";

import {
  BASE_URL,
  DASHBOARD_PATH,
  DEVELOPMENT_PATH,
  sessionRuntimeRoot
} from "./support/base-shell-data";
import {
  mockStudioReady
} from "./support/base-shell-mocks";

const SESSION_ID = "session-renderer";
const TARGET_APP_URL = "http://127.0.0.1:4103/home";
const PROXY_APP_URL = "http://127.0.0.1:49000/home";
type SourceExplanationPayload = Record<string, unknown>;
type SourceExplanationResponse = unknown[] | ((payload: SourceExplanationPayload) => unknown[]);
type PreviewIdentitySelection = {
  displayName?: string;
  email?: string;
  mode: string;
};
type PreviewIdentityExchangeResult = {
  code?: string;
  error?: string;
  identity?: Record<string, unknown> | null;
  ok?: boolean;
  signedOut?: boolean;
  status?: number;
};

async function openSessionDashboardTool(page: Page, label: string) {
  await page.getByRole("tab", {
    name: "Dashboard"
  }).click();
  const dashboardNav = page.locator(".section-container-shell__nav");
  await expect(dashboardNav.getByLabel("Active session navigation")).toBeVisible();
  await dashboardNav.locator(".vibe64-active-session-nav-item.v-list-item", {
    hasText: label
  }).click();
}

test("@preview-lifecycle renders through the proxy and displays the target URL", async ({ page }) => {
  await mockLaunchTerminalSocket(page);
  await mockLaunchSession(page);

  await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);

  const previewFrame = page.locator(".vibe64-launch-controls__preview-frame");
  await expect(previewFrame).toBeVisible();
  await expect(previewFrame).toHaveAttribute("src", /http:\/\/127\.0\.0\.1:49000\/home/u);
  await expect(
    page.frameLocator(".vibe64-launch-controls__preview-frame").getByText("Preview app")
  ).toBeVisible();
  await expect(page.getByLabel("Preview URL")).toHaveValue("/home");
  await expect(
    page.locator(".studio-home-shell-preview-toolbar-host .vibe64-launch-controls__toolbar")
  ).toBeVisible();
});

test("@preview-identity switches between real app identities and Guest without restarting", async ({ page }) => {
  await mockLaunchTerminalSocket(page);
  const launchSession = await mockLaunchSession(page, {
    previewIdentity: previewIdentityCapability(),
    previewIdentityExchange: (selection) => ({
      identity: selection.mode === "guest"
        ? null
        : {
            email: selection.email,
            userId: selection.mode === "viewer" ? "app-user-viewer" : "app-user-custom",
            username: selection.mode === "viewer" ? "Ada App" : "Grace App"
          },
      ok: true
    }),
    previewIdentityExchangeDelayMs: 500
  });

  await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);

  const identityButton = page.getByRole("button", {
    name: /Previewing as|Switching preview identity/u
  });
  await expect(page.locator(".vibe64-launch-controls__preview-overlay")).toContainText(
    "Opening preview as"
  );
  await expect(identityButton).toHaveAttribute(
    "aria-label",
    "Previewing as You — ada@example.com"
  );
  await expect(page.locator(".vibe64-launch-controls__preview-overlay")).toHaveCount(0);

  await identityButton.click();
  await page.locator(".vibe64-launch-controls__identity-menu")
    .getByText("Guest", { exact: true })
    .click();
  await expect(identityButton).toHaveAttribute("aria-label", "Previewing as Guest");

  await identityButton.click();
  await page.locator(".vibe64-launch-controls__identity-menu")
    .getByText("Another app user…", { exact: true })
    .click();
  await page.getByLabel("Application user email").fill("GRACE@EXAMPLE.COM");
  await page.getByRole("button", { name: "Preview as user" }).click();
  await expect(identityButton).toHaveAttribute(
    "aria-label",
    "Previewing as Grace App — grace@example.com"
  );

  expect(launchSession.getPreviewIdentitySelections()).toEqual([
    {
      displayName: "Ada Viewer",
      email: "ada@example.com",
      mode: "viewer"
    },
    {
      mode: "guest"
    },
    {
      email: "grace@example.com",
      mode: "email"
    }
  ]);
  expect(launchSession.getLaunchStartPayloads()).toHaveLength(0);
});

test("@preview-identity exposes exact app errors and remains recoverable on mobile", async ({ page }) => {
  await page.setViewportSize({
    height: 844,
    width: 390
  });
  await mockLaunchTerminalSocket(page);
  const launchSession = await mockLaunchSession(page, {
    previewIdentity: previewIdentityCapability(),
    previewIdentityExchange: (selection) => {
      if (selection.email === "missing@example.com") {
        return {
          code: "auth_user_not_found",
          error: "User not found.",
          ok: false,
          signedOut: true,
          status: 404
        };
      }
      return {
        identity: {
          email: selection.email,
          userId: "app-user-viewer",
          username: "Ada App"
        },
        ok: true
      };
    }
  });

  await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);
  await page.getByRole("button", { name: "Show project" }).click();
  await page.getByRole("button", { name: "Show preview controls" }).click();

  const identityButton = page.getByRole("button", {
    name: "Previewing as You — ada@example.com"
  });
  await expect(identityButton).toBeVisible();
  await identityButton.click();
  await page.locator(".vibe64-launch-controls__identity-menu")
    .getByText("Another app user…", { exact: true })
    .click();
  await page.getByLabel("Application user email").fill("missing@example.com");
  await page.getByRole("button", { name: "Preview as user" }).click();

  await expect(page.getByText("User not found.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", {
    name: "Preview identity failed: User not found."
  })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", {
    name: "Preview identity failed: User not found."
  }).click();
  await page.locator(".vibe64-launch-controls__identity-menu")
    .getByText("You", { exact: true })
    .click();
  await expect(page.getByRole("button", {
    name: "Previewing as You — ada@example.com"
  })).toBeVisible();

  expect(launchSession.getLaunchStartPayloads()).toHaveLength(0);
});

test("@preview-lifecycle attaches multiple visible preview frames and stops each shared tab stream", async ({ page }) => {
  await page.addInitScript(() => {
    (window as typeof window & { __vibe64PreviewCaptureCalls?: number }).__vibe64PreviewCaptureCalls = 0;
    (window as typeof window & { __vibe64PreviewCaptureTracks?: MediaStreamTrack[] }).__vibe64PreviewCaptureTracks = [];
    Object.defineProperty(navigator.mediaDevices, "getDisplayMedia", {
      configurable: true,
      value: async () => {
        (window as typeof window & { __vibe64PreviewCaptureCalls?: number }).__vibe64PreviewCaptureCalls =
          Number((window as typeof window & { __vibe64PreviewCaptureCalls?: number }).__vibe64PreviewCaptureCalls || 0) + 1;
        const canvas = document.createElement("canvas");
        canvas.height = window.innerHeight;
        canvas.width = window.innerWidth;
        const context = canvas.getContext("2d");
        const captureStream = canvas.captureStream(30);
        const track = captureStream.getVideoTracks()[0];
        (window as typeof window & { __vibe64PreviewCaptureTracks?: MediaStreamTrack[] })
          .__vibe64PreviewCaptureTracks?.push(track);
        let frame = 0;
        const paintFrame = () => {
          if (track.readyState === "ended") {
            return;
          }
          if (context) {
            context.fillStyle = frame % 2 === 0 ? "#102030" : "#102031";
            context.fillRect(0, 0, canvas.width, canvas.height);
          }
          frame += 1;
          window.requestAnimationFrame(paintFrame);
        };
        paintFrame();
        return captureStream;
      }
    });
  });
  await mockLaunchTerminalSocket(page);
  const launchSession = await mockLaunchSession(page, {
    previewResponseDelayMs: 800
  });

  await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`, {
    waitUntil: "domcontentloaded"
  });

  const previewFrame = page.locator(".vibe64-launch-controls__preview-frame");
  const composerTools = page.locator(".vibe64-workflow-control-form__composer-tools");
  const captureButton = composerTools.getByRole("button", {
    name: "Attach visible preview"
  });
  await expect(
    page.locator(".vibe64-launch-controls__toolbar").getByRole("button", {
      name: "Attach visible preview"
    })
  ).toHaveCount(0);
  await expect(page.locator(".vibe64-launch-controls__preview-overlay")).toBeVisible();
  await expect(captureButton).toHaveCount(0);
  await expect(page.frameLocator(".vibe64-launch-controls__preview-frame").getByText("Preview app"))
    .toBeVisible();
  await expect(captureButton).toBeVisible();
  await expect(composerTools.getByRole("button", {
    name: "Composer menu"
  })).toBeVisible();

  await captureButton.click();
  await expect(page.locator(".studio-autopilot-prompt-textarea__attachment")).toHaveCount(1);
  await captureButton.click();
  await expect(page.locator(".studio-autopilot-prompt-textarea__attachment")).toHaveCount(2);
  expect(launchSession.getAttachmentUploads()).toHaveLength(2);
  expect(launchSession.getAttachmentUploads().every((upload) => (
    upload.contentType === "image/png" &&
    /^vibe64-preview-.*\.png$/u.test(upload.fileName) &&
    upload.dataBase64.length > 0
  ))).toBe(true);
  expect(await page.evaluate(() => ({
    calls: Number((window as typeof window & { __vibe64PreviewCaptureCalls?: number }).__vibe64PreviewCaptureCalls || 0),
    trackStates: ((window as typeof window & { __vibe64PreviewCaptureTracks?: MediaStreamTrack[] })
      .__vibe64PreviewCaptureTracks || []).map((track) => track.readyState)
  }))).toEqual({
    calls: 2,
    trackStates: ["ended", "ended"]
  });

  await previewFrame.evaluate((frame) => {
    frame.style.transform = "translateX(-200vw)";
  });
  await expect(captureButton).toHaveCount(0);
  await previewFrame.evaluate((frame) => {
    frame.style.transform = "";
  });
  await expect(captureButton).toBeVisible();

  await page.getByRole("tab", {
    name: "Dashboard"
  }).click();
  await expect(captureButton).toHaveCount(0);
  await page.getByRole("tab", {
    name: "Preview"
  }).click();
  await expect(captureButton).toBeVisible();
});

test("@preview-lifecycle attaches isolated proxied-app console and network diagnostics", async ({ page }) => {
  await mockLaunchTerminalSocket(page);
  const launchSession = await mockLaunchSession(page);
  await page.route("http://127.0.0.1:49000/api/diagnostics", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        message: "validation failed"
      }),
      contentType: "application/json",
      headers: {
        "x-preview-diagnostic": "captured"
      },
      status: 422
    });
  });
  await page.route("http://127.0.0.1:49000/assets/routine-resource.svg*", async (route) => {
    await route.fulfill({
      body: "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"1\" height=\"1\"/>",
      contentType: "image/svg+xml",
      status: 200
    });
  });
  await page.route("http://127.0.0.1:49000/assets/missing-resource.svg", async (route) => {
    await route.fulfill({
      body: "not found",
      contentType: "text/plain",
      status: 404
    });
  });

  await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);
  await expect(page.frameLocator(".vibe64-launch-controls__preview-frame").getByText("Preview app"))
    .toBeVisible();
  await page.evaluate(() => {
    console.error("studio-console-must-not-be-attached");
  });
  await page.frameLocator(".vibe64-launch-controls__preview-frame").locator("body").evaluate(async () => {
    console.log("proxied-console-log", {
      answer: 42
    });
    console.error("proxied-console-error");
    const response = await fetch("/api/diagnostics", {
      body: JSON.stringify({
        accountId: 7
      }),
      headers: {
        "content-type": "application/json"
      },
      method: "POST"
    });
    await response.text();
    const loadImage = (src: string) => new Promise<void>((resolve) => {
      const image = document.createElement("img");
      image.addEventListener("error", () => {
        image.remove();
        resolve();
      }, { once: true });
      image.addEventListener("load", () => {
        image.remove();
        resolve();
      }, { once: true });
      image.src = src;
      document.body.append(image);
    });
    await Promise.all(Array.from({ length: 275 }, (_, index) => (
      loadImage(`/assets/routine-resource.svg?index=${index}`)
    )));
    await loadImage("/assets/missing-resource.svg");
    await new Promise((resolve) => {
      setTimeout(resolve, 100);
    });
  });

  await page.getByRole("button", {
    name: "Composer menu"
  }).click();
  const attachDiagnostics = page.getByRole("button", {
    name: "Attach console & network"
  });
  await expect(attachDiagnostics).toBeVisible();
  await attachDiagnostics.click();
  await expect(page.locator(".studio-autopilot-prompt-textarea__attachment")).toHaveCount(1);
  await expect.poll(() => launchSession.getAttachmentUploads().length).toBe(1);

  const [upload] = launchSession.getAttachmentUploads();
  const diagnostics = Buffer.from(upload.dataBase64, "base64").toString("utf8");
  expect(upload.contentType).toBe("text/plain");
  expect(upload.fileName).toMatch(/^vibe64-preview-diagnostics-.*\.log$/u);
  expect(diagnostics).toContain("## Console");
  expect(diagnostics).toContain("proxied-console-log {\"answer\":42}");
  expect(diagnostics).toContain("proxied-console-error");
  expect(diagnostics).toContain("## Network");
  expect(diagnostics).toContain("POST http://127.0.0.1:4103/api/diagnostics");
  expect(diagnostics).toContain("422");
  expect(diagnostics).toContain("{\"accountId\":7}");
  expect(diagnostics).toContain("{\"message\":\"validation failed\"}");
  expect(diagnostics).toContain("GET http://127.0.0.1:4103/assets/missing-resource.svg");
  expect(diagnostics).toContain("Resource failed to load");
  expect(diagnostics).not.toContain("routine-resource.svg");
  const suppressedResourceCount = diagnostics.match(/Routine passive resource entries omitted: (\d+)/u);
  expect(Number(suppressedResourceCount?.[1] || 0)).toBeGreaterThanOrEqual(275);
  expect(diagnostics).not.toContain("studio-console-must-not-be-attached");
  expect(diagnostics).not.toContain("VIBE64_SESSION_DEBUG");
  expect(diagnostics).not.toContain("vibe64_preview_token");
});

test("@preview-lifecycle address bar navigates within the preview and goes back", async ({ page }) => {
  await mockLaunchTerminalSocket(page);
  await mockLaunchSession(page);

  await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);

  const previewFrame = page.locator(".vibe64-launch-controls__preview-frame");
  const address = page.getByLabel("Preview URL");
  await expect(previewFrame).toBeVisible();
  await expect(address).toHaveValue("/home");

  await address.fill("/jobs/42?tab=docs#files");
  await address.press("Enter");

  await expect(previewFrame).toHaveAttribute("src", /http:\/\/127\.0\.0\.1:49000\/jobs\/42\?tab=docs#files/u);
  await expect(address).toHaveValue("/jobs/42?tab=docs#files");

  await page.getByRole("button", {
    name: "Go back in preview"
  }).click();

  await expect(address).toHaveValue("/home");
});

test("@preview-lifecycle back button follows locations reported by the iframe", async ({ page }) => {
  await mockLaunchTerminalSocket(page);
  await mockLaunchSession(page);

  await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);

  const previewFrame = page.locator(".vibe64-launch-controls__preview-frame");
  const address = page.getByLabel("Preview URL");
  await expect(previewFrame).toBeVisible();
  await expect(address).toHaveValue("/home");

  const frameHandle = await previewFrame.elementHandle();
  const frame = await frameHandle?.contentFrame();
  expect(frame).not.toBeNull();

  await frame?.evaluate(() => {
    window.history.pushState({}, "", "/jobs/42?tab=docs#files");
  });
  await expect(address).toHaveValue("/jobs/42?tab=docs#files");

  await page.getByRole("button", {
    name: "Go back in preview"
  }).click();

  await expect(address).toHaveValue("/home");
});

test("embedded preview toolbar follows mobile project-pane visibility", async ({ page }) => {
  await page.setViewportSize({
    height: 800,
    width: 390
  });
  await mockLaunchTerminalSocket(page);
  await mockLaunchSession(page);

  await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);
  await expect(page.locator(".studio-home-shell-heading")).toBeVisible();

  await expect(page.locator(".studio-home-shell-preview-toolbar-host")).toHaveCount(0);

  await page.locator(".studio-home-shell-chat-toggle").click();

  const toolbar = page.locator(".studio-home-shell-preview-toolbar-host .vibe64-launch-controls__toolbar");
  await expect(toolbar).toBeVisible();
  await expect(toolbar).toHaveClass(/vibe64-launch-controls__toolbar--mobile-collapsed/u);

  await toolbar.locator(".vibe64-launch-controls__mobile-expand").click();

  await expect(toolbar).toHaveClass(/vibe64-launch-controls__toolbar--mobile-expanded/u);
  await expect(page.getByLabel("Preview URL")).toBeVisible();

  const appBarBox = await page.getByTestId("jskit-shell-app-bar").boundingBox();
  const toolbarBox = await toolbar.boundingBox();
  const collapseBox = await toolbar.locator(".vibe64-launch-controls__mobile-collapse-button").boundingBox();
  const addressBox = await page.getByLabel("Preview URL").boundingBox();
  const actionsBox = await toolbar.locator(".vibe64-launch-controls__secondary-actions").boundingBox();
  expect(appBarBox).not.toBeNull();
  expect(toolbarBox).not.toBeNull();
  expect(collapseBox).not.toBeNull();
  expect(addressBox).not.toBeNull();
  expect(actionsBox).not.toBeNull();
  expect(toolbarBox?.y).toBeGreaterThanOrEqual((appBarBox?.y || 0) + (appBarBox?.height || 0) - 1);
  expect(collapseBox?.x).toBeLessThan(addressBox?.x || 0);
  expect(Math.abs(
    ((collapseBox?.y || 0) + (collapseBox?.height || 0) / 2) -
    ((addressBox?.y || 0) + (addressBox?.height || 0) / 2)
  )).toBeLessThan(3);
  expect(actionsBox?.y).toBeGreaterThan((addressBox?.y || 0) + (addressBox?.height || 0) - 2);
});

test("@preview-lifecycle loads launch targets from pathless session summaries", async ({ page }) => {
  await mockLaunchTerminalSocket(page);
  await mockLaunchSession(page, {
    session: sessionPayload(),
    sessionList: [sessionPayload({
      includeWorktreePaths: false
    })]
  });

  await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);

  const previewFrame = page.locator(".vibe64-launch-controls__preview-frame");
  await expect(previewFrame).toBeVisible();
  await expect(previewFrame).toHaveAttribute("src", /http:\/\/127\.0\.0\.1:49000\/home/u);
  await expect(page.frameLocator(".vibe64-launch-controls__preview-frame").getByText("Preview app")).toBeVisible();
});

test("@preview-lifecycle auto-starts without exposing passive actions", async ({ page }) => {
  await mockLaunchTerminalSocket(page);
  const launchSession = await mockLaunchSession(page, {
    initialLaunchStatus: idleLaunchStatusPayload([
      {
        available: true,
        id: "built",
        label: "Run built app"
      },
      {
        available: true,
        defaultPreview: true,
        id: "dev",
        label: "Run app"
      }
    ]),
    launchTerminalDelayMs: 1000
  });

  await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);

  const waitingState = page.locator(".vibe64-launch-controls__preview-empty");
  await expect(waitingState).toBeVisible();
  await expect(waitingState.getByRole("button")).toHaveCount(0);
  await expect.poll(() => launchSession.getLaunchStartPayloads()).toEqual([
    {
      launchInput: {
        values: {}
      },
      launchTargetId: "dev",
      originId: expect.stringMatching(/^tab:/u)
    }
  ]);
  await expect(page.locator(".vibe64-launch-controls__run-button")).toHaveCount(0);
  await expect(page.getByText("Run built app")).toHaveCount(0);
});

test("@preview-lifecycle automatically recovers when the first status has no targets", async ({ page }) => {
  await mockLaunchTerminalSocket(page);
  const launchSession = await mockLaunchSession(page, {
    launchStatusSequence: [
      idleLaunchStatusPayload(),
      idleLaunchStatusPayload([
        {
          available: true,
          id: "dev",
          label: "Run app"
        }
      ])
    ]
  });

  await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);

  await expect(page.getByText("Preview will appear here when it is ready.")).toBeVisible();
  await expect(page.locator(".vibe64-launch-controls__preview-empty").getByRole("button")).toHaveCount(0);

  await expect.poll(() => launchSession.getLaunchStartPayloads()).toEqual([
    {
      launchInput: {
        values: {}
      },
      launchTargetId: "dev",
      originId: expect.stringMatching(/^tab:/u)
    }
  ]);
});

test("@preview-lifecycle refreshes disabled targets after the selected session advances", async ({ page }) => {
  await mockLaunchTerminalSocket(page);
  const session = {
    ...sessionPayload(),
    revision: 1
  };
  const launchSession = await mockLaunchSession(page, {
    launchStatusSequence: previewAvailabilitySequence(),
    session
  });

  await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);

  await expect(page.getByText("Install dependencies before running the app.")).toBeVisible();
  expect(launchSession.getLaunchStatusRequestCount()).toBe(1);

  session.metadata = {
    ...session.metadata,
    dependencies_installed: "yes"
  };
  session.revision = 2;
  await page.getByRole("button", {
    name: "Reload chat"
  }).click();

  await expect.poll(() => launchSession.getLaunchStatusRequestCount()).toBe(2);
  await expect.poll(() => launchSession.getLaunchStartPayloads()).toEqual([
    {
      launchInput: {
        values: {}
      },
      launchTargetId: "dev",
      originId: expect.stringMatching(/^tab:/u)
    }
  ]);
});

test("@preview-lifecycle lets the user recheck a disabled target without a session signal", async ({ page }) => {
  await mockLaunchTerminalSocket(page);
  const launchSession = await mockLaunchSession(page, {
    launchStatusSequence: previewAvailabilitySequence()
  });

  await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);

  await expect(page.getByText("Install dependencies before running the app.")).toBeVisible();
  expect(launchSession.getLaunchStatusRequestCount()).toBe(1);

  await page.getByRole("button", {
    name: "Check again"
  }).click();

  await expect.poll(() => launchSession.getLaunchStatusRequestCount()).toBe(2);
  await expect.poll(() => launchSession.getLaunchStartPayloads()).toEqual([
    {
      launchInput: {
        values: {}
      },
      launchTargetId: "dev",
      originId: expect.stringMatching(/^tab:/u)
    }
  ]);
});

test("@preview-lifecycle keeps the loading explanation visible until the iframe loads", async ({ page }) => {
  await mockLaunchTerminalSocket(page);
  await mockLaunchSession(page, {
    previewResponseDelayMs: 1000
  });

  await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);

  const loadingOverlay = page.locator(".vibe64-launch-controls__preview-overlay");
  await expect(loadingOverlay).toContainText("Loading preview page");
  await expect(loadingOverlay).toContainText("The server is ready; the browser is still loading the app.");
  await expect(loadingOverlay.locator(".vibe64-launch-controls__preview-pulse")).toBeVisible();
  await expect(loadingOverlay.getByRole("button")).toHaveCount(0);
  await expect(
    page.frameLocator(".vibe64-launch-controls__preview-frame").getByText("Preview app")
  ).toBeVisible();
  await expect(page.locator(".vibe64-launch-controls__preview-overlay")).toHaveCount(0);
});

test("@preview-lifecycle lets a slow first iframe load finish without restarting it", async ({ page }) => {
  await mockLaunchTerminalSocket(page);
  const launchSession = await mockLaunchSession(page, {
    previewResponseDelayMs: 6500
  });

  await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);

  await expect(
    page.frameLocator(".vibe64-launch-controls__preview-frame").getByText("Preview app")
  ).toBeVisible({
    timeout: 10000
  });
  await expect(page.locator(".vibe64-launch-controls__preview-overlay")).toHaveCount(0);
  expect(launchSession.getPreviewLoadCount()).toBe(1);
});

test("@preview-lifecycle token bootstrap redirects once without reloading the clean document", async ({ page }) => {
  await mockLaunchTerminalSocket(page);
  const launchSession = await mockLaunchSession(page, {
    previewBootstrapToken: "preview-bootstrap-token"
  });
  try {
    await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);

    await expect(
      page.frameLocator(".vibe64-launch-controls__preview-frame").getByText("Preview app")
    ).toBeVisible();
    await expect.poll(() => launchSession.getPreviewLoadCount()).toBe(2);
    await page.waitForTimeout(500);
    expect(launchSession.getPreviewLoadCount()).toBe(2);
  } finally {
    await launchSession.close();
  }
});

test("@preview-lifecycle stays mounted without reloading while covered by dashboard", async ({ page }) => {
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
  await expect(page).toHaveURL(new RegExp(`${escapeRegExp(DASHBOARD_PATH)}/env/?$`, "u"));
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
      forceRestart: true,
      launchInput: {
        values: {
          startupArgs: [
            ".",
            "--debug"
          ]
        }
      },
      launchTargetId: "dev",
      originId: expect.stringMatching(/^tab:/u)
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

  await page.goto(`${BASE_URL}${DASHBOARD_PATH}/env`);
  await page.getByRole("button", {
    name: "Show project"
  }).click();
  await page.locator(".section-container-shell__mobile-section-title", {
    hasText: "Env"
  }).click();

  await expect(page).toHaveURL(`${BASE_URL}${DASHBOARD_PATH}/env`);
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

test("chat source links open the editor and editor autosaves file changes", async ({ page }) => {
  await mockLaunchTerminalSocket(page);
  const sourceEditor = await mockLaunchSession(page, {
    conversationLog: [
      {
        assistant: {
          at: "2026-05-24T00:00:00.000Z",
          role: "assistant",
          text: "Open [src/App.js:2](src/App.js:2) and make the change."
        },
        turnId: "turn-source-link"
      }
    ],
    sourceEditorFiles: {
      "node_modules/pkg/hidden.js": "export const hidden = 'visible needle';\n",
      "src/App.js": "import { helper } from './utils/really-long-helper-file-name-that-needs-hover';\nconst value = 1;\nconst status = 'ready';\n",
      "src/utils/really-long-helper-file-name-that-needs-hover.js": "export const helper = 'visible needle';\n"
    }
  });

  await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);

  await page.getByRole("link", {
    name: "src/App.js:2"
  }).click();

  await expect(page).toHaveURL(`${BASE_URL}${DASHBOARD_PATH}/files`);
  await expect(page.getByLabel("Session source editor")).toBeVisible();
  await expect(page.locator(".vibe64-source-editor__title")).toContainText("App.js");
  await expect(page.locator(".vibe64-source-tree__button--active", {
    hasText: "App.js"
  })).toBeVisible();
  expect(sourceEditor.getTreeRequests()).toEqual([
    {
      limit: 20,
      offset: 0,
      path: ""
    }
  ]);
  await expect(page.locator(".cm-content")).toContainText("const status = 'ready';");

  await page.getByText("./utils/really-long-helper-file-name-that-needs-hover").click({
    modifiers: ["Control"]
  });
  await expect(page.locator(".vibe64-source-editor__title")).toContainText("really-long-helper-file-name");
  await expect(page.locator(".cm-content")).toContainText("visible needle");

  await page.getByRole("link", {
    name: "src/App.js:2"
  }).click();
  await expect(page.locator(".vibe64-source-editor__title")).toContainText("App.js");

  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+A");
  await page.keyboard.insertText("const value = 2;\n");

  await expect.poll(() => sourceEditor.getSavedText("src/App.js")).toBe("const value = 2;\n");

  await page.getByRole("textbox", {
    name: "Open file"
  }).fill("helper");
  const fastOpenMatch = page.locator(".vibe64-source-editor__matches")
    .getByTitle("src/utils/really-long-helper-file-name-that-needs-hover.js");
  await expect(fastOpenMatch).toBeVisible();
  await fastOpenMatch.click();
  await expect(page.locator(".vibe64-source-editor__title")).toContainText("really-long-helper-file-name");
  await expect(page.locator(".cm-content")).toContainText("visible needle");

  await page.getByRole("tab", {
    name: "Preview"
  }).click();
  await expect(page).toHaveURL(`${BASE_URL}${DEVELOPMENT_PATH}`);
  await expect(page.getByLabel("Session source editor")).toBeHidden();
  await expect(page.frameLocator(".vibe64-launch-controls__preview-frame").getByText("Preview app"))
    .toBeVisible();
  await page.getByRole("tab", {
    name: "Dashboard"
  }).click();
  await expect(page).toHaveURL(`${BASE_URL}${DASHBOARD_PATH}/files`);
  await expect(page.getByLabel("Session source editor")).toBeVisible();
  await expect(page.locator(".vibe64-source-editor__title")).toContainText("really-long-helper-file-name");
  const composerBottomGap = await page.locator(".studio-autopilot__chat-panel .studio-autopilot__composer .studio-autopilot-prompt-textarea__field").evaluate((element) => (
    window.innerHeight - element.getBoundingClientRect().bottom
  ));
  expect(composerBottomGap).toBeLessThanOrEqual(3);
  await page.getByTitle("Collapse file list").click();
  await expect(page.getByTitle("Show files")).toBeVisible();
  await page.getByTitle("Show files").click();
  await expect(page.locator(".vibe64-source-tree__button--active", {
    hasText: "really-long-helper-file-name"
  })).toBeVisible();

  await page.getByRole("textbox", {
    name: "Find in files"
  }).fill("visible needle");
  await expect(page.getByTitle("src/utils/really-long-helper-file-name-that-needs-hover.js:1:24")).toBeVisible();
  await expect(page.getByText("node_modules/pkg/hidden.js")).toHaveCount(0);
});

test("source explanations keep live progress compact and answers above the follow-up composer", async ({ page }) => {
  const sourcePath = "src/pages/home/receivals/[recordId]/edit.vue";
  const sourceRoot = `${sessionRuntimeRoot(SESSION_ID)}/source`;
  const finalText = [
    "## Brief Summary",
    `[${sourcePath}](<${sourceRoot}/${sourcePath}:1>) is the edit screen wiring for an existing receival.`,
    "",
    "It configures the shared CRUD runtime and passes lookup helpers into the receival form.",
    "",
    "Readable closing line above the follow-up composer."
  ].join("\n");
  await mockLaunchTerminalSocket(page);
  await mockLaunchSession(page, {
    conversationLog: [
      {
        assistant: {
          at: "2026-05-24T00:00:00.000Z",
          role: "assistant",
          text: `Open [${sourcePath}:1](${sourcePath}:1) and explain it.`
        },
        turnId: "turn-source-explanation-link"
      }
    ],
    sourceEditorFiles: {
      [sourcePath]: "<template><ReceivalForm /></template>\n<script setup>\nconst recordId = '42';\n</script>\n"
    },
    sourceExplanationResponses: [
      (payload) => [
        {
          assistantMessageId: payload.assistantMessageId,
          type: "source-explanation.started",
          userMessageId: payload.userMessageId
        },
        {
          messageId: payload.assistantMessageId,
          role: "assistant",
          status: "thinking",
          text: "I'll read the project guidance and adjacent generated CRUD files first.",
          type: "source-explanation.message"
        }
      ],
      (payload) => [
        {
          assistantMessageId: payload.assistantMessageId,
          type: "source-explanation.started",
          userMessageId: payload.userMessageId
        },
        {
          explanation: sourceEditorExplanationPayload(payload, finalText),
          type: "source-explanation.finished"
        }
      ]
    ]
  });

  await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);

  await openSessionDashboardTool(page, "Files");
  await page.getByRole("textbox", {
    name: "Open file"
  }).fill("edit.vue");
  await page.locator(".vibe64-source-editor__matches").getByTitle(sourcePath).click();
  await expect(page.locator(".vibe64-source-editor__title")).toContainText("edit.vue");

  await page.getByRole("button", {
    name: "Explain"
  }).click();

  const panel = page.getByLabel("Source explanation");
  const thinkingDetail = panel.locator(".vibe64-source-explanation__thinking-detail", {
    hasText: "I'll read the project guidance"
  });
  await expect(thinkingDetail).toBeVisible();
  const status = panel.locator(".vibe64-source-explanation__status", {
    hasText: "Thinking..."
  });
  await expect(status).toBeVisible();
  await expect(status.locator(".vibe64-source-explanation__status-mark")).toBeVisible();
  await page.getByTitle("Collapse explanation").click();
  await expect(page.getByTitle("Show explanation")).toBeVisible();
  await page.getByTitle("Show explanation").click();
  await expect(panel).toBeVisible();
  const statusFontSize = await thinkingDetail.locator(".studio-long-text-review__paragraph").evaluate((element) => (
    Number.parseFloat(getComputedStyle(element).fontSize)
  ));
  expect(statusFontSize).toBeLessThanOrEqual(13);

  await page.getByRole("button", {
    name: "Explain"
  }).click();

  const sourceLink = panel.getByRole("link", {
    name: sourcePath
  });
  await expect(sourceLink).toBeVisible();
  await expect(panel.getByText("Readable closing line above the follow-up composer.")).toBeVisible();

  const geometry = await panel.evaluate((element) => {
    const answer = element.querySelector(".vibe64-source-explanation__thread");
    const followup = element.querySelector(".vibe64-source-explanation__followup");
    const closingLine = Array.from(element.querySelectorAll(".studio-long-text-review__paragraph"))
      .find((node) => node.textContent?.includes("Readable closing line above the follow-up composer."));
    if (!answer || !followup || !closingLine) {
      throw new Error("Missing explanation layout element.");
    }
    return {
      closingBottom: closingLine.getBoundingClientRect().bottom,
      followupTop: followup.getBoundingClientRect().top,
      threadBottom: answer.getBoundingClientRect().bottom
    };
  });
  expect(geometry.closingBottom).toBeLessThanOrEqual(geometry.followupTop - 1);
  expect(geometry.threadBottom).toBeLessThanOrEqual(geometry.followupTop - 1);

  const followupBox = panel.getByRole("textbox", {
    name: "Ask about this explanation"
  });
  const explanationComposerBottomGap = await panel.locator(".vibe64-source-explanation__followup .studio-autopilot-prompt-textarea__field").evaluate((element) => (
    window.innerHeight - element.getBoundingClientRect().bottom
  ));
  expect(explanationComposerBottomGap).toBeLessThanOrEqual(3);
  await followupBox.fill("first line");
  await followupBox.press("Enter");
  await followupBox.pressSequentially("second line");
  await expect(followupBox).toHaveValue("first line\nsecond line");

  await sourceLink.click();
  await expect(page.locator(".vibe64-source-editor__title")).toContainText("edit.vue");
});

test("conversation messages render pipe tables", async ({ page }) => {
  await mockLaunchTerminalSocket(page);
  await mockLaunchSession(page, {
    conversationLog: [
      {
        assistant: {
          at: "2026-05-24T00:00:00.000Z",
          role: "assistant",
          text: "| Table | Rows | Role | | --- | ---: | --- | | users | 3 | JSKIT user mirror for Supabase identities. | | assistant_config | 0 | Per-surface assistant config. |"
        },
        turnId: "turn-table"
      }
    ]
  });

  await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);

  const table = page.locator(".studio-long-text-review__table");
  await expect(table).toBeVisible();
  await expect(table.getByRole("columnheader", {
    name: "Table"
  })).toBeVisible();
  await expect(table.getByRole("columnheader", {
    name: "Rows"
  })).toBeVisible();
  await expect(table.getByRole("cell", {
    name: "JSKIT user mirror for Supabase identities."
  })).toBeVisible();
  await expect(table.getByRole("cell", {
    name: "Per-surface assistant config."
  })).toBeVisible();

  const numericCellAlign = await table.getByRole("cell", {
    name: "3"
  }).evaluate((element) => getComputedStyle(element).textAlign);
  expect(numericCellAlign).toBe("right");
});

test("embedded launch terminal can be shown and hidden again", async ({ page }) => {
  await mockLaunchTerminalSocket(page);
  await mockLaunchSession(page);

  await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);

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

  const terminalHost = page.locator(".vibe64-launch-controls__terminal--embedded .vibe64-terminal-surface__host");
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
  const terminalHost = terminal.locator(".vibe64-terminal-surface__host");
  await expect(terminalHost).toBeVisible();
  const hostHeightBefore = await terminalHost.evaluate((element) => element.getBoundingClientRect().height);

  await expect(page.getByText("Exited with code 1", { exact: true })).toBeVisible();
  await expect(terminal).toBeVisible();
  const hostHeightAfter = await terminalHost.evaluate((element) => element.getBoundingClientRect().height);

  expect(hostHeightBefore).toBeGreaterThan(320);
  expect(hostHeightAfter).toBeGreaterThan(320);
  expect(Math.abs(hostHeightAfter - hostHeightBefore)).toBeLessThan(1);
});

async function mockLaunchSession(page: Page, {
  conversationLog = [],
  initialLaunchStatus = null,
  launchTargetPreviewOptions = [],
  launchStatusSequence = null,
  launchTerminalDelayMs = 0,
  previewBootstrapToken = "",
  previewIdentity = null,
  previewIdentityExchange = null,
  previewIdentityExchangeDelayMs = 0,
  previewResponseDelayMs = 0,
  session = sessionPayload(),
  sessionList = null,
  sourceEditorFiles = null,
  sourceExplanationResponses = [],
  sessionListDelayMs = 0
}: {
  conversationLog?: unknown[];
  initialLaunchStatus?: ReturnType<typeof launchStatusPayload> | null;
  launchTargetPreviewOptions?: unknown[];
  launchStatusSequence?: unknown[] | null;
  launchTerminalDelayMs?: number;
  previewBootstrapToken?: string;
  previewIdentity?: Record<string, unknown> | null;
  previewIdentityExchange?: ((selection: PreviewIdentitySelection) => PreviewIdentityExchangeResult) | null;
  previewIdentityExchangeDelayMs?: number;
  previewResponseDelayMs?: number;
  session?: ReturnType<typeof sessionPayload>;
  sessionList?: ReturnType<typeof sessionPayload>[] | null;
  sourceEditorFiles?: Record<string, string> | null;
  sourceExplanationResponses?: SourceExplanationResponse[];
  sessionListDelayMs?: number;
} = {}) {
  const listedSessions = Array.isArray(sessionList) ? sessionList : [session];
  const sourceEditor = sourceEditorFiles ? createSourceEditorMock(sourceEditorFiles) : null;
  const queuedSourceExplanationResponses = [...sourceExplanationResponses];
  const launchStartPayloads: unknown[] = [];
  const previewIdentityGrants = new Map<string, PreviewIdentitySelection>();
  const previewIdentitySelections: PreviewIdentitySelection[] = [];
  const attachmentUploads: Array<{
    contentType: string;
    dataBase64: string;
    fileName: string;
  }> = [];
  const sequencedLaunchStatuses = Array.isArray(launchStatusSequence) ? launchStatusSequence : [];
  let launchStarted = sequencedLaunchStatuses.length > 0
    ? Boolean((sequencedLaunchStatuses[0] as { activeTerminal?: unknown })?.activeTerminal)
    : !initialLaunchStatus || Boolean(initialLaunchStatus.activeTerminal);
  let initialLaunchStatusActive = true;
  let launchStatusReadCount = 0;
  let launchStatusSequenceIndex = 0;
  let previewLoadCount = 0;
  let previewIdentityGrantSequence = 0;
  const previewServer = previewBootstrapToken
    ? await startPreviewAppServer({
        bootstrapToken: previewBootstrapToken,
        responseDelayMs: previewResponseDelayMs,
        targetOrigin: new URL(TARGET_APP_URL).origin
      })
    : null;
  const proxyAppUrl = previewServer?.href || PROXY_APP_URL;
  const previewHref = previewBootstrapToken
    ? `${proxyAppUrl}?vibe64_preview_token=${encodeURIComponent(previewBootstrapToken)}`
    : proxyAppUrl;
  function currentLaunchStatus() {
    if (sequencedLaunchStatuses.length > 0 && !launchStarted) {
      const index = Math.min(launchStatusSequenceIndex, sequencedLaunchStatuses.length - 1);
      launchStatusSequenceIndex += 1;
      return sequencedLaunchStatuses[index];
    }
    if (initialLaunchStatusActive && initialLaunchStatus) {
      return initialLaunchStatus;
    }
    return launchStatusPayload(launchStarted
      ? { launchTargetPreviewOptions, previewHref, previewIdentity }
      : {
          activeTerminal: null,
          launchTargetPreviewOptions,
          previewHref,
          previewIdentity
        });
  }
  function sessionForRequest(pathname: string) {
    const requestedSessionId = decodeURIComponent(pathname.split("/").at(-1) || "");
    if (session.sessionId === requestedSessionId) {
      return session;
    }
    return listedSessions.find((item) => item.sessionId === requestedSessionId) || session;
  }
  await mockStudioReady(page);
  await page.route(/\/api(?:\/app\/[^/]+)?\/vibe64\/sessions(?:\/.*)?(?:\?.*)?$/u, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    if (method === "GET" && url.pathname.endsWith("/launch-targets")) {
      launchStatusReadCount += 1;
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
          launchTargetPreviewOptions,
          previewHref,
          previewIdentity
        }).activeTerminal
      });
      return;
    }
    if (method === "POST" && url.pathname.endsWith("/preview-identity")) {
      const requestedIdentity = normalizePreviewIdentitySelection(
        request.postDataJSON(),
        previewIdentity
      );
      const grant = `preview-identity-grant-${++previewIdentityGrantSequence}`;
      previewIdentityGrants.set(grant, requestedIdentity);
      previewIdentitySelections.push(requestedIdentity);
      await fulfillJson(route, {
        grant,
        ok: true,
        requestedIdentity
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
        conversationLog,
        ok: true,
        sessionId: decodeURIComponent(url.pathname.split("/").at(-2) || "")
      });
      return;
    }
    if (method === "POST" && url.pathname.endsWith("/agent-attachments")) {
      const payload = request.postDataJSON() as {
        contentType?: string;
        dataBase64?: string;
        fileName?: string;
      };
      const attachment = {
        contentType: String(payload.contentType || ""),
        dataBase64: String(payload.dataBase64 || ""),
        fileName: String(payload.fileName || "attachment")
      };
      attachmentUploads.push(attachment);
      await fulfillJson(route, {
        attachmentId: `attachment-${attachmentUploads.length}`,
        contentType: attachment.contentType,
        expiresInMs: 300_000,
        fileName: attachment.fileName,
        ok: true,
        path: `/tmp/vibe64-attachments/${attachment.fileName}`,
        size: Buffer.from(attachment.dataBase64, "base64").length
      });
      return;
    }
    if (sourceEditor && method === "GET" && url.pathname.endsWith("/source-editor/tree")) {
      await fulfillJson(route, sourceEditor.readTree({
        limit: Number(url.searchParams.get("limit") || 20),
        offset: Number(url.searchParams.get("offset") || 0),
        path: url.searchParams.get("path") || ""
      }));
      return;
    }
    if (sourceEditor && method === "GET" && url.pathname.endsWith("/source-editor/files")) {
      await fulfillJson(route, sourceEditor.listFiles(url.searchParams.get("q") || ""));
      return;
    }
    if (sourceEditor && method === "GET" && url.pathname.endsWith("/source-editor/search")) {
      await fulfillJson(route, sourceEditor.search(url.searchParams.get("q") || ""));
      return;
    }
    if (sourceEditor && method === "POST" && url.pathname.endsWith("/source-editor/resolve-path")) {
      await fulfillJson(route, sourceEditor.resolvePath(request.postDataJSON()));
      return;
    }
    if (sourceEditor && method === "GET" && url.pathname.endsWith("/source-editor/file")) {
      await fulfillJson(route, sourceEditor.readFile(url.searchParams.get("path") || ""));
      return;
    }
    if (sourceEditor && method === "PUT" && url.pathname.endsWith("/source-editor/file")) {
      await fulfillJson(route, sourceEditor.saveFile(request.postDataJSON()));
      return;
    }
    if (sourceEditor && method === "POST" && url.pathname.endsWith("/source-editor/explanations/stream")) {
      const payload = request.postDataJSON() as SourceExplanationPayload;
      const response = queuedSourceExplanationResponses.shift();
      const events = typeof response === "function" ? response(payload) : response;
      await fulfillNdjson(route, Array.isArray(events) ? events : [
        {
          explanation: sourceEditorExplanationPayload(payload, "Source explanation complete."),
          type: "source-explanation.finished"
        }
      ]);
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
  if (!previewServer) {
    await page.route("http://127.0.0.1:49000/**", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.method() === "POST" && url.pathname === PREVIEW_IDENTITY_CONTROL_PATH) {
        const grant = String((request.postDataJSON() as { grant?: string })?.grant || "");
        const selection = previewIdentityGrants.get(grant);
        if (!selection) {
          await fulfillJson(route, {
            code: "vibe64_preview_identity_grant_invalid",
            error: "Preview identity grant is missing or invalid.",
            ok: false
          }, {
            status: 403
          });
          return;
        }
        previewIdentityGrants.delete(grant);
        if (previewIdentityExchangeDelayMs > 0) {
          await new Promise((resolve) => {
            setTimeout(resolve, previewIdentityExchangeDelayMs);
          });
        }
        const result = previewIdentityExchange?.(selection) || {
          identity: selection.mode === "guest" ? null : {
            email: selection.email,
            userId: "app-user",
            username: selection.displayName || selection.email
          },
          ok: true
        };
        await fulfillJson(route, result, {
          status: result.status || (result.ok === false ? 400 : 200)
        });
        return;
      }
      previewLoadCount += 1;
      if (previewResponseDelayMs > 0) {
        await new Promise((resolve) => {
          setTimeout(resolve, previewResponseDelayMs);
        });
      }
      await route.fulfill({
        body: previewAppHtml({
          targetOrigin: new URL(TARGET_APP_URL).origin
        }),
        contentType: "text/html"
      });
    });
  }
  return {
    async close() {
      await previewServer?.close();
    },
    getLaunchStartPayloads() {
      return launchStartPayloads;
    },
    getAttachmentUploads() {
      return [...attachmentUploads];
    },
    getLaunchStatusRequestCount() {
      return launchStatusReadCount;
    },
    getSavedText(path: string) {
      return sourceEditor?.getText(path) || "";
    },
    getTreeRequests() {
      return sourceEditor?.getTreeRequests() || [];
    },
    getPreviewLoadCount() {
      return previewServer?.getLoadCount() || previewLoadCount;
    },
    getPreviewIdentitySelections() {
      return [...previewIdentitySelections];
    }
  };
}

function previewIdentityCapability() {
  return {
    available: true,
    defaultMode: "viewer",
    disabledReason: "",
    viewer: {
      displayName: "Ada Viewer",
      email: "ada@example.com"
    }
  };
}

function normalizePreviewIdentitySelection(
  value: unknown,
  capability: Record<string, unknown> | null
): PreviewIdentitySelection {
  const selection = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const mode = String(selection.mode || "viewer");
  if (mode === "viewer") {
    const viewer = capability?.viewer && typeof capability.viewer === "object" && !Array.isArray(capability.viewer)
      ? capability.viewer as Record<string, unknown>
      : {};
    return {
      displayName: String(viewer.displayName || viewer.email || ""),
      email: String(viewer.email || "").trim().toLowerCase(),
      mode
    };
  }
  if (mode === "email") {
    return {
      email: String(selection.email || "").trim().toLowerCase(),
      mode
    };
  }
  return { mode: "guest" };
}

function escapeRegExp(value: string) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function createSourceEditorMock(initialFiles: Record<string, string>) {
  const files = new Map(Object.entries(initialFiles));
  const treeRequests: Array<{
    limit: number;
    offset: number;
    path: string;
  }> = [];
  let version = 1;

  function fileHash(path: string) {
    return `${path}:${version}`;
  }

  function sortedFilePaths() {
    return Array.from(files.keys())
      .filter((filePath) => !sourceEditorPathExcluded(filePath))
      .sort((left, right) => left.localeCompare(right));
  }

  function readTree(input: {
    limit?: number;
    offset?: number;
    path?: string;
  } = {}) {
    const request = {
      limit: Number(input.limit || 20),
      offset: Number(input.offset || 0),
      path: String(input.path || "")
    };
    treeRequests.push(request);
    return {
      ok: true,
      policy: {
        adapterId: "jskit",
        defaultOpenFiles: ["src/App.js"],
        exclude: [],
        preexpandedDirectories: ["src"],
        preloadDirectories: ["src", "packages"]
      },
      root: "",
      tree: sourceEditorTreeFromPaths(sortedFilePaths(), request, {
        preexpandedDirectories: ["src"],
        preloadDirectories: ["packages"]
      })
    };
  }

  function listFiles(query: string) {
    const normalizedQuery = String(query || "").trim().toLowerCase();
    return {
      files: sortedFilePaths()
        .filter((filePath) => !normalizedQuery || filePath.toLowerCase().includes(normalizedQuery))
        .map((filePath) => ({
          language: filePath.endsWith(".js") ? "javascript" : "text",
          name: filePath.split("/").at(-1) || filePath,
          path: filePath
        })),
      ok: true,
      query,
      truncated: false
    };
  }

  function search(query: string) {
    const needle = String(query || "");
    const results: Array<Record<string, unknown>> = [];
    if (needle) {
      for (const filePath of sortedFilePaths()) {
        const lines = String(files.get(filePath) || "").split(/\r?\n/u);
        lines.forEach((line, index) => {
          const column = line.indexOf(needle);
          if (column >= 0) {
            results.push({
              column: column + 1,
              line: index + 1,
              path: filePath,
              preview: line
            });
          }
        });
      }
    }
    return {
      ok: true,
      query,
      results,
      truncated: false
    };
  }

  function readFile(filePath: string) {
    const path = String(filePath || "");
    return {
      file: {
        hash: fileHash(path),
        language: "javascript",
        path,
        text: files.get(path) || ""
      },
      ok: true
    };
  }

  function saveFile(payload: unknown) {
    const record = payload && typeof payload === "object" && !Array.isArray(payload)
      ? payload as { path?: string; text?: string }
      : {};
    const path = String(record.path || "");
    files.set(path, String(record.text ?? ""));
    version += 1;
    return readFile(path);
  }

  function resolvePath(payload: unknown) {
    const record = payload && typeof payload === "object" && !Array.isArray(payload)
      ? payload as { fromPath?: string; target?: string }
      : {};
    const fromPath = String(record.fromPath || "").replaceAll("\\", "/");
    const target = String(record.target || "").replaceAll("\\", "/").split(/[?#]/u)[0];
    const fromDirectory = fromPath.split("/").slice(0, -1).join("/");
    const basePath = target.startsWith("/")
      ? target.slice(1)
      : normalizeSourceEditorMockPath(`${fromDirectory}/${target}`);
    for (const candidatePath of sourceEditorResolveMockCandidates(basePath)) {
      if (files.has(candidatePath) && !sourceEditorPathExcluded(candidatePath)) {
        return {
          file: {
            language: candidatePath.endsWith(".js") ? "javascript" : "text",
            path: candidatePath
          },
          ok: true,
          path: candidatePath,
          resolved: true,
          target
        };
      }
    }
    return {
      ok: true,
      resolved: false,
      target
    };
  }

  return {
    getText(path: string) {
      return files.get(path) || "";
    },
    getTreeRequests() {
      return [...treeRequests];
    },
    listFiles,
    readFile,
    readTree,
    resolvePath,
    saveFile,
    search
  };
}

function normalizeSourceEditorMockPath(value: string) {
  const parts: string[] = [];
  for (const part of String(value || "").split("/")) {
    if (!part || part === ".") {
      continue;
    }
    if (part === "..") {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join("/");
}

function sourceEditorResolveMockCandidates(pathValue: string) {
  const normalizedPath = normalizeSourceEditorMockPath(pathValue);
  const hasExtension = /\.[^/.]+$/u.test(normalizedPath);
  const extensions = [".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".vue", ".json", ".css"];
  return [
    normalizedPath,
    ...(hasExtension ? [] : extensions.map((suffix) => `${normalizedPath}${suffix}`)),
    ...extensions.map((suffix) => `${normalizedPath}/index${suffix}`)
  ];
}

function sourceEditorPathExcluded(filePath: string) {
  return String(filePath || "").split("/").some((segment) => [
    ".git",
    ".vibe64",
    "dist",
    "node_modules"
  ].includes(segment));
}

function sourceEditorTreeFromPaths(paths: string[], {
  limit = 20,
  offset = 0,
  path = ""
}: {
  limit?: number;
  offset?: number;
  path?: string;
} = {}, {
  preexpandedDirectories = [],
  preloadDirectories = []
}: {
  preexpandedDirectories?: string[];
  preloadDirectories?: string[];
} = {}) {
  const root = {
    children: [] as Array<Record<string, unknown>>,
    name: "",
    path: "",
    type: "directory"
  };

  for (const filePath of paths) {
    let directory = root;
    const parts = filePath.split("/").filter(Boolean);
    for (let index = 0; index < parts.length; index += 1) {
      const name = parts[index];
      const childPath = parts.slice(0, index + 1).join("/");
      if (index === parts.length - 1) {
        directory.children.push({
          language: name.endsWith(".js") ? "javascript" : "text",
          name,
          path: childPath,
          size: 0,
          type: "file"
        });
        continue;
      }
      let child = directory.children.find((candidate) => (
        candidate.type === "directory" && candidate.path === childPath
      )) as typeof root | undefined;
      if (!child) {
        child = {
          children: [],
          name,
          path: childPath,
          type: "directory"
        };
        directory.children.push(child);
      }
      directory = child;
    }
  }

  sortSourceEditorTree(root);
  const directory = findSourceEditorTreeDirectory(root, path);
  const page = sourceEditorDirectoryPage(directory || {
    children: [],
    name: String(path || "").split("/").filter(Boolean).at(-1) || "",
    path,
    type: "directory"
  }, {
    limit,
    offset
  });
  if (path || offset > 0) {
    return page;
  }
  return sourceEditorTreeWithPolicyDirectories(root, page, {
    preexpandedDirectories,
    preloadDirectories
  });
}

function sortSourceEditorTree(node: Record<string, unknown>) {
  const children = Array.isArray(node.children)
    ? node.children as Array<Record<string, unknown>>
    : [];
  children.sort((left, right) => {
    if (left.type !== right.type) {
      return left.type === "directory" ? -1 : 1;
    }
    return String(left.name || "").localeCompare(String(right.name || ""));
  });
  for (const child of children) {
    if (child.type === "directory") {
      sortSourceEditorTree(child);
    }
  }
}

function findSourceEditorTreeDirectory(node: Record<string, unknown>, directoryPath = ""): Record<string, unknown> | null {
  if (node.type !== "directory") {
    return null;
  }
  if (String(node.path || "") === String(directoryPath || "")) {
    return node;
  }
  for (const child of Array.isArray(node.children) ? node.children as Array<Record<string, unknown>> : []) {
    const found = findSourceEditorTreeDirectory(child, directoryPath);
    if (found) {
      return found;
    }
  }
  return null;
}

function sourceEditorDirectoryPage(node: Record<string, unknown>, {
  limit = 20,
  offset = 0
}: {
  limit?: number;
  offset?: number;
} = {}) {
  const children = Array.isArray(node.children)
    ? node.children as Array<Record<string, unknown>>
    : [];
  const normalizedLimit = Math.max(1, Number(limit || 20));
  const normalizedOffset = Math.max(0, Number(offset || 0));
  const pageChildren = children
    .slice(normalizedOffset, normalizedOffset + normalizedLimit)
    .map((child) => child.type === "directory"
      ? {
          children: [],
          hasMore: false,
          limit: normalizedLimit,
          loaded: false,
          name: child.name,
          nextOffset: 0,
          offset: 0,
          path: child.path,
          total: 0,
          truncated: false,
          type: "directory"
        }
      : child);
  const nextOffset = Math.min(children.length, normalizedOffset + pageChildren.length);
  return {
    children: pageChildren,
    hasMore: nextOffset < children.length,
    limit: normalizedLimit,
    loaded: true,
    name: node.name,
    nextOffset,
    offset: normalizedOffset,
    path: node.path,
    total: children.length,
    truncated: false,
    type: "directory"
  };
}

function sourceEditorTreeWithPolicyDirectories(
  fullTree: Record<string, unknown>,
  rootPage: Record<string, unknown>,
  {
    preexpandedDirectories = [],
    preloadDirectories = []
  }: {
    preexpandedDirectories?: string[];
    preloadDirectories?: string[];
  } = {}
) {
  let tree = rootPage;
  const preexpandedSet = new Set(preexpandedDirectories);
  for (const directoryPath of preloadDirectories) {
    if (preexpandedSet.has(directoryPath)) {
      continue;
    }
    tree = mergeSourceEditorTreeDirectory(tree, sourceEditorPolicyDirectoryNode(fullTree, directoryPath));
  }
  for (const directoryPath of preexpandedDirectories) {
    tree = mergeSourceEditorTreeDirectory(tree, sourceEditorPolicyDirectoryNode(fullTree, directoryPath, {
      recursive: true
    }));
  }
  return tree;
}

function sourceEditorPolicyDirectoryNode(
  fullTree: Record<string, unknown>,
  directoryPath: string,
  {
    recursive = false
  }: {
    recursive?: boolean;
  } = {}
) {
  const directory = findSourceEditorTreeDirectory(fullTree, directoryPath);
  if (!directory) {
    return null;
  }
  const page = sourceEditorDirectoryPage(directory);
  if (!recursive) {
    return page;
  }
  let node = page;
  for (const child of Array.isArray(page.children) ? page.children as Array<Record<string, unknown>> : []) {
    if (child.type === "directory") {
      node = mergeSourceEditorTreeDirectory(node, sourceEditorPolicyDirectoryNode(fullTree, String(child.path || ""), {
        recursive: true
      }));
    }
  }
  return node;
}

function mergeSourceEditorTreeDirectory(root: Record<string, unknown>, directory: Record<string, unknown> | null) {
  if (!directory) {
    return root;
  }
  const directoryPath = String(directory.path || "");
  if (!directoryPath) {
    return directory;
  }
  const parts = directoryPath.split("/").filter(Boolean);

  function mergeAt(node: Record<string, unknown>, depth: number): Record<string, unknown> {
    if (depth === parts.length) {
      return {
        ...node,
        ...directory,
        children: mergeSourceEditorTreeChildren(
          Array.isArray(node.children) ? node.children as Array<Record<string, unknown>> : [],
          Array.isArray(directory.children) ? directory.children as Array<Record<string, unknown>> : []
        )
      };
    }
    const childPath = parts.slice(0, depth + 1).join("/");
    const children = Array.isArray(node.children) ? node.children as Array<Record<string, unknown>> : [];
    let found = false;
    const nextChildren = children.map((child) => {
      if (child.type === "directory" && child.path === childPath) {
        found = true;
        return mergeAt(child, depth + 1);
      }
      return child;
    });
    if (!found) {
      nextChildren.push(mergeAt({
        children: [],
        hasMore: false,
        loaded: false,
        name: parts[depth],
        path: childPath,
        type: "directory"
      }, depth + 1));
    }
    return {
      ...node,
      children: sortSourceEditorTreeChildren(nextChildren)
    };
  }

  return mergeAt(root, 0);
}

function mergeSourceEditorTreeChildren(
  existingChildren: Array<Record<string, unknown>>,
  incomingChildren: Array<Record<string, unknown>>
) {
  const byKey = new Map<string, Record<string, unknown>>();
  for (const child of existingChildren) {
    byKey.set(`${child.type}:${child.path}`, child);
  }
  for (const child of incomingChildren) {
    byKey.set(`${child.type}:${child.path}`, child);
  }
  return sortSourceEditorTreeChildren([...byKey.values()]);
}

function sortSourceEditorTreeChildren(children: Array<Record<string, unknown>>) {
  return [...children].sort((left, right) => {
    if (left.type !== right.type) {
      return left.type === "directory" ? -1 : 1;
    }
    return String(left.name || "").localeCompare(String(right.name || ""));
  });
}

function previewAppHtml({
  targetOrigin = new URL(TARGET_APP_URL).origin
}: {
  targetOrigin?: string;
} = {}) {
  return injectLaunchPreviewBridge(
    "<!doctype html><html><head><title>Preview</title></head><body><div id=\"app\">Preview app</div></body></html>",
    {
      targetOrigin
    }
  );
}

async function startPreviewAppServer({
  bootstrapToken = "",
  responseDelayMs = 0,
  targetOrigin = new URL(TARGET_APP_URL).origin
}: {
  bootstrapToken?: string;
  responseDelayMs?: number;
  targetOrigin?: string;
} = {}) {
  let loadCount = 0;
  const server = createHttpServer(async (request, response) => {
    loadCount += 1;
    const address = server.address() as AddressInfo;
    const origin = `http://127.0.0.1:${address.port}`;
    const url = new URL(String(request.url || "/"), origin);
    if (bootstrapToken && url.searchParams.get("vibe64_preview_token") === bootstrapToken) {
      url.searchParams.delete("vibe64_preview_token");
      response.writeHead(302, {
        Location: url.toString(),
        "Set-Cookie": `vibe64_preview_token_${address.port}=${bootstrapToken}; Path=/; HttpOnly`
      });
      response.end();
      return;
    }
    if (responseDelayMs > 0) {
      await new Promise((resolve) => {
        setTimeout(resolve, responseDelayMs);
      });
    }
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8"
    });
    response.end(previewAppHtml({
      targetOrigin
    }));
  });
  await listenOnLoopback(server);
  const address = server.address() as AddressInfo;
  return {
    async close() {
      await closeHttpServer(server);
    },
    href: `http://127.0.0.1:${address.port}/home`,
    getLoadCount() {
      return loadCount;
    }
  };
}

function listenOnLoopback(server: HttpServer) {
  return new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function closeHttpServer(server: HttpServer) {
  if (!server.listening) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
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
  previewHref?: string;
  previewIdentity?: Record<string, unknown> | null;
} = {}) {
  const launchTargetPreviewOptions = options.launchTargetPreviewOptions || [];
  const previewHref = options.previewHref || PROXY_APP_URL;
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
    ...(options.previewIdentity ? { previewIdentity: options.previewIdentity } : {}),
    openTarget: {
      available: true,
      href: TARGET_APP_URL,
      kind: "url",
      label: "Open browser",
      previewHref
    },
    previewTarget: {
      available: true,
      disabledReason: "",
      href: previewHref,
      kind: "url",
      label: "Preview",
      targetHref: TARGET_APP_URL
    }
  };
}

function idleLaunchStatusPayload(launchTargets: unknown[] = []) {
  return {
    activeTerminal: null,
    launchTargets,
    ok: true,
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
  };
}

function previewAvailabilitySequence() {
  const previewTarget = {
    defaultPreview: true,
    id: "dev",
    label: "Run app"
  };
  return [
    idleLaunchStatusPayload([
      {
        ...previewTarget,
        available: false,
        disabledReason: "Install dependencies before running the app."
      }
    ]),
    idleLaunchStatusPayload([
      {
        ...previewTarget,
        available: true
      }
    ])
  ];
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
  const sourcePath = `/var/lib/vibe64/test/projects/example/sessions/active/${sessionId}/source`;
  const session = {
    actionResults: [],
    actions: [],
    completedSteps: ["source_created"],
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
    sessionRoot: sessionRuntimeRoot(sessionId),
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
    artifactsRoot: `${sessionRuntimeRoot(sessionId)}/artifacts`,
    metadata: {
      source_kind: "session_clone",
      source_path: sourcePath,
      source_path_authority: "managed_session_source"
    },
    targetRoot: "/workspace/example-target-app",
    source: sourcePath,
    sourceReady: true
  };
}

function sourceEditorExplanationPayload(payload: SourceExplanationPayload = {}, text = "") {
  const path = String(payload.path || "src/App.js");
  const startLine = Math.max(1, Number(payload.startLine || 1));
  const endLine = Math.max(startLine, Number(payload.endLine || startLine));
  return {
    agentThreadId: "agent-thread-source-explanation",
    agentTurnId: "agent-turn-source-explanation",
    body: text,
    createdAt: "2026-05-24T00:00:00.000Z",
    engine: "agent-chat",
    followups: [],
    id: String(payload.explanationId || "exp_source_explanation"),
    messages: [
      {
        createdAt: "2026-05-24T00:00:00.000Z",
        id: String(payload.userMessageId || "msg_user"),
        role: "user",
        status: "complete",
        text: `Explain the whole file ${path}.`
      },
      {
        createdAt: "2026-05-24T00:00:01.000Z",
        id: String(payload.assistantMessageId || "msg_assistant"),
        role: "assistant",
        status: "complete",
        text
      }
    ],
    model: "agent-chat",
    sourceRange: {
      endColumn: Math.max(1, Number(payload.endColumn || 1)),
      endLine,
      language: "vue",
      path,
      scope: String(payload.scope || "file"),
      startColumn: Math.max(1, Number(payload.startColumn || 1)),
      startLine
    },
    status: "ready",
    summary: text.split(/\n\n/u)[0] || text,
    title: `${path.split("/").at(-1) || "Code"} full file`
  };
}

async function fulfillJson(route: Route, payload: unknown, {
  status = 200
}: {
  status?: number;
} = {}) {
  await route.fulfill({
    body: JSON.stringify(payload),
    contentType: "application/json",
    status
  });
}

async function fulfillNdjson(route: Route, events: unknown[]) {
  await route.fulfill({
    body: `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
    contentType: "application/x-ndjson"
  });
}
