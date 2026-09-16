import { expect, test, type Page, type Request } from "@playwright/test";

import {
  BASE_URL,
  DASHBOARD_PATH,
  directChatSessionId,
  directChatSessionPayload
} from "./support/base-shell-data";
import { mockProjectGateReady } from "./support/base-shell-mocks";
import { fulfillJson, routeApiEndpoint } from "./support/base-shell/http";

const DRAFT_HASH = "a".repeat(64);
const VIEWER_SCOPE = `viewer-v1-${"1".repeat(32)}`;

function reviewRenewal(overrides: Record<string, unknown> = {}) {
  return {
    basis: {
      source: {
        authority: "github",
        commit: "b".repeat(40),
        ref: "refs/heads/main",
        repository: "https://github.com/example/project.git"
      }
    },
    draft: {
      hash: DRAFT_HASH,
      origin: "generated",
      revision: 1,
      text: "Generated handover",
      updatedAt: "2026-08-24T01:00:00.000Z"
    },
    operationKey: `renewal:${directChatSessionId}:one`,
    renewalId: "renewal-one",
    revision: 1,
    sessionId: directChatSessionId,
    stage: "draft_ready",
    status: "review",
    updatedAt: "2026-08-24T01:00:00.000Z",
    ...overrides
  };
}

function freshSession() {
  const sessionId = "fresh-session";
  const sessionRoot = `/workspace/vibe64-local-editor/state/projects/example-target-app-test/sessions/active/${sessionId}`;
  return {
    ...directChatSessionPayload,
    agentSession: {
      ...directChatSessionPayload.agentSession,
      thread: { id: "thread-fresh" },
      workdir: `${sessionRoot}/source`
    },
    manifest: {
      ...directChatSessionPayload.manifest,
      sessionId
    },
    sessionId,
    sessionName: "Fresh session",
    sessionRoot,
    sourcePath: `${sessionRoot}/source`,
    stateRoot: `${sessionRoot}/state`
  };
}

async function openRenewal(page: Page) {
  const compactActions = page.getByRole("button", { name: /^Session actions/u });
  const expandedAction = page.locator(
    ".studio-autopilot__header-actions--expanded [data-vibe64-session-renew-action]:visible"
  );
  await expect.poll(async () => (
    await compactActions.isVisible() || await expandedAction.isVisible()
  )).toBe(true);
  if (await compactActions.isVisible()) {
    await compactActions.click();
    await page.locator("[data-vibe64-session-renew-action]:visible").click();
  } else {
    await expandedAction.click();
  }
  await expect(page.getByRole("dialog", { name: "Renew this session" })).toBeVisible();
}

async function mockRenewal(page: Page, {
  initialRenewal = reviewRenewal()
}: {
  initialRenewal?: Record<string, unknown>;
} = {}) {
  await mockProjectGateReady(page);
  await routeApiEndpoint(page, "/vibe64/assistants/capabilities", (route) => fulfillJson(route, {
    ok: true,
    engines: [{
      engineId: "codex", label: "Codex", revision: `sha256:${"a".repeat(64)}`,
      health: { status: "ready" },
      agents: [{ id: "codex", label: "Codex", mode: "primary" }],
      defaults: { agentId: "codex", modelId: "gpt-5.6", modelProviderId: "openai" },
      modelProviders: [{
        id: "openai", label: "OpenAI", connected: true, defaultModelId: "gpt-5.6",
        models: [{ id: "gpt-5.6", label: "GPT-5.6", status: "available", variants: [] }]
      }]
    }]
  }));
  const predecessor = {
    ...directChatSessionPayload,
    renewalAdvisory: {
      reason: "This conversation is approaching its safe context limit.",
      recommended: true,
      severity: "consider"
    }
  };
  const successor = freshSession();
  const state = {
    confirmValidationError: "",
    renewal: initialRenewal,
    retryResult: null as Record<string, unknown> | null,
    retryRequests: [] as Record<string, unknown>[],
    selectedSessionId: directChatSessionId,
    sessions: [predecessor] as Record<string, unknown>[]
  };

  await routeApiEndpoint(page, "/vibe64/sessions", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const sessionId = decodeURIComponent(url.pathname.match(/\/sessions\/([^/]+)/u)?.[1] || "");

    if (method === "GET" && url.pathname.endsWith("/assistant-access")) {
      await fulfillJson(route, { ok: true, available: true, canUse: true, ownerOnly: false });
      return;
    }
    if (method === "PUT" && url.pathname.endsWith("/current")) {
      state.selectedSessionId = String(requestBody(request).sessionId || directChatSessionId);
      await fulfillJson(route, { ok: true, sessionId: state.selectedSessionId });
      return;
    }
    if (method === "GET" && url.pathname.endsWith("/conversation-log")) {
      await fulfillJson(route, {
        conversationLog: [],
        ok: true,
        pagination: { count: 0, hasMoreBefore: false, limit: 20, totalTurnCount: 0 },
        sessionId
      });
      return;
    }
    if (method === "GET" && url.pathname.endsWith("/work")) {
      await fulfillJson(route, { ok: true, operation: null, unsaved: false, updateOperation: null });
      return;
    }
    if (method === "GET" && url.pathname.endsWith("/renewal")) {
      await fulfillJson(route, {
        ok: true,
        renewal: sessionId === directChatSessionId ? state.renewal : null,
        viewerScope: VIEWER_SCOPE
      });
      return;
    }
    if (method === "PATCH" && url.pathname.endsWith("/renewal/draft")) {
      const body = requestBody(request);
      state.renewal = {
        ...state.renewal,
        draft: {
          ...(state.renewal.draft as Record<string, unknown>),
          hash: "c".repeat(64),
          origin: "edited",
          revision: Number((state.renewal.draft as Record<string, unknown>)?.revision || 0) + 1,
          text: String(body.draft || ""),
          updatedAt: "2026-08-24T01:04:00.000Z"
        },
        revision: Number(state.renewal.revision || 0) + 1,
        updatedAt: "2026-08-24T01:04:00.000Z"
      };
      await fulfillJson(route, {
        ok: true,
        renewal: state.renewal,
        viewerScope: VIEWER_SCOPE
      });
      return;
    }
    if (method === "POST" && url.pathname.endsWith("/renewal/confirm")) {
      if (state.confirmValidationError) {
        await route.fulfill({
          body: JSON.stringify({
            code: "vibe64_session_renewal_handover_source_mismatch",
            error: state.confirmValidationError,
            ok: false
          }),
          contentType: "application/json",
          status: 400
        });
        return;
      }
      state.renewal = {
        ...state.renewal,
        revision: Number(state.renewal.revision || 0) + 1,
        stage: "old_quiescing",
        status: "running",
        updatedAt: "2026-08-24T01:05:00.000Z"
      };
      await fulfillJson(route, {
        ok: true,
        renewal: state.renewal,
        viewerScope: VIEWER_SCOPE
      });
      return;
    }
    if (method === "POST" && url.pathname.endsWith("/renewal/retry")) {
      state.retryRequests.push(requestBody(request));
      state.renewal = state.retryResult || {
        ...state.renewal,
        error: null,
        revision: Number(state.renewal.revision || 0) + 1,
        stage: "old_quiescing",
        status: "running",
        updatedAt: "2026-08-24T01:06:00.000Z"
      };
      await fulfillJson(route, {
        ok: true,
        renewal: state.renewal,
        viewerScope: VIEWER_SCOPE
      });
      return;
    }
    if (method === "GET" && /\/sessions\/[^/]+$/u.test(url.pathname)) {
      const requested = state.sessions.find((entry) => entry.sessionId === sessionId) || predecessor;
      await fulfillJson(route, { ...requested, ok: true });
      return;
    }
    if (method === "GET" && /\/sessions\/?$/u.test(url.pathname)) {
      await fulfillJson(route, {
        creation: { canCreate: true, mode: "direct" },
        limits: { openSessionCount: state.sessions.length },
        ok: true,
        sessions: state.sessions
      });
      return;
    }
    await fulfillJson(route, { ok: true });
  }, { prefix: true });

  return {
    complete() {
      state.sessions = [predecessor, successor];
      state.renewal = {
        ...state.renewal,
        revision: Number(state.renewal.revision || 0) + 1,
        stage: "completed",
        status: "completed",
        successor: { sessionId: String(successor.sessionId) },
        updatedAt: "2026-08-24T01:07:00.000Z"
      };
    },
    state
  };
}

for (const width of [390, 960, 1600]) {
  test(`keeps renewal review usable without horizontal overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ height: width === 390 ? 844 : 900, width });
    await mockRenewal(page);
    await page.goto(`${BASE_URL}${DASHBOARD_PATH}/env`);
    await openRenewal(page);

    const dialog = page.getByRole("dialog", { name: "Renew this session" });
    await expect(dialog.getByLabel("Handover for the fresh session")).toBeVisible();
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}

test("keeps long session tabs and renewal actions usable in the fixed desktop chat pane", async ({ page }) => {
  await page.setViewportSize({ height: 900, width: 1600 });
  const renewal = await mockRenewal(page);
  const predecessor = renewal.state.sessions[0];
  renewal.state.sessions = [
    {
      ...predecessor,
      createdAt: "2026-08-24T01:03:00.000Z",
      sessionId: directChatSessionId,
      sessionName: "A very long predecessor session name"
    },
    {
      ...predecessor,
      createdAt: "2026-08-24T01:01:00.000Z",
      manifest: {
        ...((predecessor.manifest || {}) as Record<string, unknown>),
        sessionId: "second-long-session"
      },
      sessionId: "second-long-session",
      sessionName: "A second very long active session name"
    },
    {
      ...predecessor,
      createdAt: "2026-08-24T01:02:00.000Z",
      manifest: {
        ...((predecessor.manifest || {}) as Record<string, unknown>),
        sessionId: "third-long-session"
      },
      sessionId: "third-long-session",
      sessionName: "A third very long active session name"
    }
  ];

  await page.goto(`${BASE_URL}${DASHBOARD_PATH}/env`);

  const header = page.locator(".studio-autopilot__session-header");
  const sessionActions = page.getByRole("button", { name: /^Session actions/u });
  await expect(sessionActions).toBeVisible();
  await sessionActions.click();
  await page.locator("[data-vibe64-session-renew-action]:visible").click();
  const dialog = page.getByRole("dialog", { name: "Renew this session" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Handover for the fresh session")).toBeVisible();
  await dialog.getByRole("button", { name: "Close session renewal" }).click();
  await expect(sessionActions).toHaveAccessibleName("Session actions: Review handover");
  expect(await header.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await header.evaluate((headerElement) => {
    const headerRect = headerElement.getBoundingClientRect();
    return [...headerElement.querySelectorAll([
      "[data-vibe64-session-id]",
      "[data-vibe64-session-actions]",
      ".studio-ai-sessions__create-button"
    ].join(","))]
      .filter((element) => element.getClientRects().length > 0)
      .every((element) => {
        const rect = element.getBoundingClientRect();
        return rect.left >= headerRect.left && rect.right <= headerRect.right &&
          rect.top >= headerRect.top && rect.bottom <= headerRect.bottom;
      });
  })).toBe(true);

  await sessionActions.click();
  await expect(page.getByText("Review handover", { exact: true })).toBeVisible();
});

test("preserves review edits, exposes conflicts, and keeps server validation in context", async ({ page }) => {
  await page.setViewportSize({ height: 900, width: 960 });
  const renewal = await mockRenewal(page);
  await page.goto(`${BASE_URL}${DASHBOARD_PATH}/env`);
  await openRenewal(page);

  const dialog = page.getByRole("dialog", { name: "Renew this session" });
  const handover = dialog.getByLabel("Handover for the fresh session");
  await handover.fill("My local handover");
  await dialog.getByRole("button", { name: "Close session renewal" }).click();
  await openRenewal(page);
  await expect(handover).toHaveValue("My local handover");

  renewal.state.renewal = reviewRenewal({
    draft: {
      hash: "d".repeat(64),
      origin: "edited",
      revision: 2,
      text: "Newer remote handover",
      updatedAt: "2026-08-24T01:02:00.000Z"
    },
    revision: 2,
    updatedAt: "2026-08-24T01:02:00.000Z"
  });
  await dialog.getByRole("button", { name: "Close session renewal" }).click();
  await openRenewal(page);
  await expect(dialog.getByText("This handover changed elsewhere")).toBeVisible();
  await expect(handover).toHaveValue("My local handover");
  await dialog.getByRole("button", { name: "Keep my edits" }).click();

  renewal.state.confirmValidationError = "The Saved source commit must match exactly.";
  await dialog.getByRole("button", { name: "Renew session" }).click();
  await expect(dialog.getByText(renewal.state.confirmValidationError, { exact: true })).toBeVisible();
  await handover.fill("Corrected local handover");
  await expect(dialog.getByText(renewal.state.confirmValidationError, { exact: true })).toHaveCount(0);
});

test("recovers a persisted source failure through a manual handover on a phone", async ({ page }, testInfo) => {
  await page.setViewportSize({ height: 844, width: 390 });
  const sourceFailure = reviewRenewal({
    basis: null,
    draft: null,
    error: {
      code: "vibe64_session_renewal_source_not_ready",
      message: "Save this session and bring it fully up to date before renewing it.",
      retryable: false
    },
    stage: "draft_generating",
    status: "failed"
  });
  const renewal = await mockRenewal(page, { initialRenewal: sourceFailure });
  renewal.state.retryResult = sourceFailure;
  await page.goto(`${BASE_URL}${DASHBOARD_PATH}/env`);
  await openRenewal(page);
  const dialog = page.getByRole("dialog", { name: "Renew this session" });
  const retry = dialog.getByRole("button", { name: "Retry", exact: true });
  await expect(retry).toBeVisible();
  await expect(retry).toBeInViewport();
  await page.screenshot({ animations: "disabled", path: testInfo.outputPath("renewal-retry.png") });
  await dialog.getByRole("button", { name: "Close session renewal" }).click();
  await page.reload();
  await openRenewal(page);
  await retry.click();
  await expect.poll(() => renewal.state.retryRequests.length).toBe(1);
  await expect(dialog.locator('[data-vibe64-session-renewal-phase="failed"]')).toBeVisible();
  await expect(retry).toBeEnabled();
  expect(renewal.state.selectedSessionId).toBe(directChatSessionId);

  // After Save, the exhausted provider leaves an editable manual handover.
  renewal.state.retryResult = reviewRenewal({
    draft: {
      hash: DRAFT_HASH, origin: "manual", revision: 1,
      text: "# Session handover", updatedAt: "2026-08-24T01:00:00.000Z"
    },
    error: { message: "Complete the editable handover template.", retryable: false },
    manualRequired: true,
    revision: 3
  });
  await retry.click();
  await expect.poll(() => renewal.state.retryRequests.length).toBe(2);
  expect(renewal.state.retryRequests).toEqual([
    expect.objectContaining({ operationKey: sourceFailure.operationKey }),
    expect.objectContaining({ operationKey: sourceFailure.operationKey })
  ]);
  const handover = dialog.getByLabel("Handover for the fresh session");
  await expect(handover).toHaveValue("# Session handover");
  await handover.fill("Reviewed handover with unfinished work and verification evidence.");
  await dialog.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Save draft", exact: true })).toBeDisabled();
  await page.reload();
  await openRenewal(page);
  await expect(handover).toHaveValue("Reviewed handover with unfinished work and verification evidence.");
  await dialog.getByRole("button", { name: "Renew session", exact: true }).click();
  await expect(dialog.locator('[data-vibe64-session-renewal-phase="progress"]')).toBeVisible();
  renewal.complete();
  await expect.poll(() => renewal.state.selectedSessionId, { timeout: 10_000 }).toBe("fresh-session");
  await expect(dialog).not.toBeVisible();
});

test("keeps a failed predecessor visible, retries, and opens the completed successor", async ({ page }) => {
  await page.setViewportSize({ height: 900, width: 960 });
  const renewal = await mockRenewal(page, {
    initialRenewal: reviewRenewal({
      error: { message: "Workspace preparation needs attention.", retryable: true },
      stage: "successor_setup",
      status: "failed"
    })
  });
  await page.goto(`${BASE_URL}${DASHBOARD_PATH}/env`);
  await openRenewal(page);

  const dialog = page.getByRole("dialog", { name: "Renew this session" });
  await expect(dialog.getByText("Workspace preparation needs attention.")).toBeVisible();
  expect(renewal.state.selectedSessionId).toBe(directChatSessionId);
  await dialog.getByRole("button", { name: "Retry" }).click();
  await expect(dialog.locator('[data-vibe64-session-renewal-phase="progress"]')).toBeVisible();
  expect(renewal.state.selectedSessionId).toBe(directChatSessionId);

  renewal.complete();
  await expect.poll(() => renewal.state.selectedSessionId, { timeout: 10_000 }).toBe("fresh-session");
  await expect(dialog).not.toBeVisible();
});

function requestBody(request: Request) {
  return (request.postDataJSON() || {}) as Record<string, unknown>;
}
