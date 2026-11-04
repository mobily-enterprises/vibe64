import { expect, test, type Page, type Request } from "@playwright/test";

import {
  DASHBOARD_PATH,
  WORKSPACE_SLUG,
  directChatSessionId,
  directChatSessionPayload
} from "./support/base-shell-data";
import {
  mockProjectGateReady
} from "./support/base-shell-mocks";
import {
  fulfillJson,
  routeApiEndpoint
} from "./support/base-shell/http";
import { assistantStatusServer } from "./support/assistant-status-server";

const RECOVERY_CODES = [
  "vibe64_session_update_conflict",
  "vibe64_session_update_history_diverged"
] as const;

test.describe("Dashboard repository Temporary AI recovery", () => {
  let server: Awaited<ReturnType<typeof assistantStatusServer>>;
  let pageErrors: string[];
  test.beforeEach(async ({ page }) => {
    server = await assistantStatusServer({ temporaryEngineId: "codex" });
    pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
  });
  test.afterEach(async ({ page }, testInfo) => {
    if (!page.isClosed()) await page.screenshot({ path: testInfo.outputPath("final.png") });
    await server.close();
    expect(pageErrors).toEqual([]);
  });
  test.use({
    hasTouch: true,
    viewport: { height: 844, width: 390 }
  });

  for (const width of [320, 1280]) {
    test(`a person applies resolved conflicts without an AI chat at ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 844 });
      const inputs: Record<string, unknown>[] = [];
      const pending = Promise.withResolvers<Record<string, unknown>>();
      const captured = await mockRepositoryRecovery(page, server, {
        code: "vibe64_session_update_conflict", diagnostic: "One file needs review.",
        conflictRecovery: { reviewId: "human-reviewed", conflictPaths: ["tests/server/previewTestTarget.integration.test.js"] },
        async applyUpdate(input) { inputs.push(input); return pending.promise; }
      });
      await page.goto(`${server.url}${DASHBOARD_PATH}/repository`);
      if (width <= 720) await page.getByRole("button", { name: "Show chat", exact: true }).click();
      await page.getByRole("button", { name: "Review resolved conflicts", exact: true }).click();
      const review = page.getByRole("dialog", { name: "Apply resolved Update", exact: true });
      await expect(review).toContainText("tests/server/previewTestTarget.integration.test.js");
      await expect(review).toContainText("Nothing is pushed.");
      await review.getByRole("button", { name: "Cancel", exact: true }).click();
      expect(inputs).toEqual([]);
      await page.getByRole("button", { name: "Review resolved conflicts", exact: true }).click();
      const apply = review.getByRole("button", { name: "I've resolved these conflicts — apply Update", exact: true });
      await expect(apply).toBeInViewport({ ratio: 1 });
      expect(await review.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      expect(await apply.locator(".text-wrap").evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath("resolved-update-review.png"), animations: "disabled" });
      await apply.click();
      await expect.poll(() => inputs.length).toBe(1);
      expect(inputs[0].reviewedConflictId).toBe("human-reviewed");
      await expect(review).toBeHidden();
      pending.resolve({ ok: true, status: "updated" });
      await expect(page.getByRole("button", { name: "Review resolved conflicts", exact: true })).toHaveCount(0);
      expect(captured.temporaryCreates).toHaveLength(0);
      expect(captured.temporaryTurns).toHaveLength(0);
      expect(captured.mainChatMessages).toHaveLength(0);
    });
  }

  test("required preparation offers one direct action, reports failure, and clears after successful setup", async ({ page }) => {
    const captured = await mockRepositoryRecovery(page, server, { code: "vibe64_session_update_conflict", diagnostic: "Review messages.vue" });
    let setup = { status: "required", updatedAt: "2026-09-09T03:50:00Z", diagnostic: "Run this session's declared setup steps after updating its source." };
    const retries: Array<ReturnType<typeof Promise.withResolvers<void>>> = [];
    await routeApiEndpoint(page, `/vibe64/sessions/${directChatSessionId}`, (route) => fulfillJson(route, {
      ...directChatSessionPayload, workspaceSetup: setup
    }));
    await routeApiEndpoint(page, `/vibe64/sessions/${directChatSessionId}/workspace-setup/retry`, async (route) => {
      const pending = Promise.withResolvers<void>();
      retries.push(pending);
      await pending.promise;
      if (retries.length === 1) await fulfillJson(route, { ok: false, error: "Preparation could not start. Please retry." });
      else {
        setup = { status: "succeeded", updatedAt: "2026-09-09T03:51:00Z", diagnostic: "Workspace prepared." };
        await fulfillJson(route, { ok: true });
      }
    });
    try {
      await page.goto(`${server.url}${DASHBOARD_PATH}/repository`);
      await page.getByRole("button", { name: "Show chat", exact: true }).click();
      const activity = page.getByLabel("Session activity", { exact: true });
      const prepare = activity.getByRole("button", { name: "Prepare workspace", exact: true });
      await expect(prepare).toBeEnabled();
      await expect(activity.getByRole("button", { name: "Fix it with AI", exact: true })).toHaveCount(0);
      await prepare.dblclick();
      await expect.poll(() => retries.length).toBe(1);
      await expect(prepare).toBeDisabled();
      retries[0].resolve();
      await expect(activity).toContainText("Preparation could not start. Please retry.");
      await expect(prepare).toBeEnabled();
      await prepare.click();
      await expect.poll(() => retries.length).toBe(2);
      retries[1].resolve();
      await expect(prepare).toHaveCount(0);
      await expect(activity).not.toContainText("Workspace preparation required");
      expect(captured.temporaryCreates).toHaveLength(0);
      expect(captured.mainChatMessages).toHaveLength(0);
    } finally { for (const pending of retries) pending.resolve(); }
  });
});

async function mockRepositoryRecovery(page: Page, server: Awaited<ReturnType<typeof assistantStatusServer>>, {
  code,
  diagnostic,
  outcome = () => "continue",
  nativeTurn = () => null,
  conflictRecovery,
  workspaceSetup = () => ({ status: "unconfigured" }),
  applyUpdate = async () => ({ ok: true, status: "updated" })
}: {
  code: typeof RECOVERY_CODES[number];
  diagnostic: string;
  conflictRecovery?: { reviewId: string; conflictPaths: string[] };
  outcome?: (turn: number) => string;
  nativeTurn?: (turn: number) => Record<string, unknown> | null;
  workspaceSetup?: () => Record<string, unknown>;
  applyUpdate?: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
}) {
  const captured = server.temporary!.captured;
  captured.outcome = outcome;
  captured.nativeTurn = nativeTurn;
  let updated = false;
  await mockProjectGateReady(page);

  await routeApiEndpoint(page, "/vibe64/repository", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "GET" && url.pathname.endsWith("/history")) {
      await fulfillJson(route, {
        historySnapshotCommit: "canonical-commit",
        nextCursor: "",
        ok: true,
        updateCheck: {
          ahead: 0,
          behind: 1,
          canonicalCommit: "canonical-commit",
          checkedAt: "2026-08-23T12:00:00.000Z",
          sessionCommit: "session-commit",
          updateAvailable: true
        },
        versions: []
      });
      return;
    }
    await fulfillJson(route, { ok: true });
  }, { prefix: true });

  await routeApiEndpoint(page, "/vibe64/sessions", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    if (url.pathname.includes("/temporary-conversations")) return route.fallback();

    if (method === "GET" && url.pathname.endsWith("/assistant-access")) {
      // Repairs run on the Fix it with AI role.
      await fulfillJson(route, { ok: true, available: true, canUse: true, purposes: { senior: { available: true }, fix: { available: true } } });
      return;
    }
    if (method === "GET" && url.pathname.endsWith("/agent-session")) {
      await fulfillJson(route, { ok: true, agentSession: directChatSessionPayload.agentSession });
      return;
    }
    if (method === "POST" && url.pathname.endsWith("/updates/apply")) {
      const result = await applyUpdate(requestBodyWithoutOrigin(request));
      updated = result.ok === true;
      await fulfillJson(route, result);
      return;
    }
    if (method === "PUT" && url.pathname.endsWith("/current")) {
      await fulfillJson(route, {
        ok: true,
        sessionId: directChatSessionId
      });
      return;
    }
    if (method === "POST" && url.pathname.endsWith("/updates/check")) {
      await fulfillJson(route, updated
        ? { ok: true, relationship: "current", ahead: 0, behind: 0, updateAvailable: false, incomingVersions: [] }
        : { code, error: diagnostic, ok: false });
      return;
    }
    if (method === "GET" && url.pathname.endsWith("/work")) {
      await fulfillJson(route, {
        ahead: 0,
        behind: updated ? 0 : 1,
        ok: true,
        operation: null,
        unsaved: true,
        updateAvailable: !updated,
        updateOperation: !updated && conflictRecovery ? {
          operationId: "failed-update", kind: "update", status: "failed", code,
          error: diagnostic, conflictRecovery
        } : null
      });
      return;
    }
    if (method === "GET" && /\/sessions\/[^/]+$/u.test(url.pathname)) {
      await fulfillJson(route, { ...directChatSessionPayload, workspaceSetup: workspaceSetup() });
      return;
    }
    await fulfillJson(route, {
      creation: {
        canCreate: true,
        mode: "direct"
      },
      limits: {
        openSessionCount: 1
      },
      ok: true,
      sessions: [{ ...directChatSessionPayload, workspaceSetup: workspaceSetup() }]
    });
  }, { prefix: true });

  return {
    mainChatMessages: server.state.messages,
    get temporaryDeletes() { return captured.temporaryDeletes; },
    temporaryCreates: captured.temporaryCreates,
    temporaryTurns: captured.temporaryTurns
  };
}

function requestBodyWithoutOrigin(request: Request) {
  const {
    originId: _originId,
    ...body
  } = (request.postDataJSON() || {}) as Record<string, unknown>;
  return body;
}
