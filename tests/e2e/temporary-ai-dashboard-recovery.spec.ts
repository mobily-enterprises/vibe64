import { expect, test, type Page, type Request } from "@playwright/test";

import {
  DASHBOARD_PATH,
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
const REPOSITORY_RECOVERY_GIT_BOUNDARY = [
  "Vibe64—not Temporary AI—owns every repository operation. The failed operation has already been rolled back.",
  "You may inspect Git read-only and edit ordinary working-tree files in this session. Do not change HEAD, branches, refs, the index, stashes, remotes, commits, checkpoints, or repository configuration.",
  "Do not run git add, commit, checkout, switch, restore, reset, clean, stash, merge, rebase, cherry-pick, revert, pull, push, fetch, or update-ref. Do not create a recovery ref or stash; Vibe64 already owns durable recovery.",
  "Record the initial HEAD and index with read-only commands, leave both byte-for-byte unchanged, and do not publish. Resolve only by editing the conflicting working-tree files; Vibe64 owns applying and verifying the repository operation.",
  "Preserve the intended behavior of both the latest saved work and this session. Do not hand-edit generated Genesis maps; Vibe64 regenerates its derived artifacts. A clean index after rollback is not proof that the conflict is resolved."
].join("\n");
const REPOSITORY_RECOVERY_PROMPT_LEAD = "Help resolve this Vibe64 repository problem. Inspect the current session and canonical repository state, preserve all work, and do not publish until the conflict is understood:";

test.describe("Dashboard repository Temporary AI recovery", () => {
  let server: Awaited<ReturnType<typeof assistantStatusServer>>;
  let pageErrors: string[];
  test.beforeEach(async ({ page }) => {
    server = await assistantStatusServer();
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

  for (const code of RECOVERY_CODES) {
    test(`${code} reveals chat and sends exactly one Temporary AI turn`, async ({ page }) => {
      const diagnostic = `Repository update failed with ${code}.`;
      const expectedPrompt = [
        REPOSITORY_RECOVERY_PROMPT_LEAD,
        REPOSITORY_RECOVERY_GIT_BOUNDARY
      ].join("\n\n");
      const captured = await mockRepositoryRecovery(page, { code, diagnostic });

      await page.goto(`${server.url}${DASHBOARD_PATH}/repository`);

      await expect(page.getByRole("button", { name: "Show chat", exact: true })).toBeVisible();
      await expectTouchTarget(page.getByRole("button", {
        name: "Fix it with AI",
        exact: true
      }));
      await page.getByRole("button", { name: "Fix it with AI", exact: true }).click();

      const workspace = page.getByRole("region", { name: "Temporary AI workspace" });
      await expect(workspace).toBeVisible();
      await expect(page.getByRole("button", { name: "Show project", exact: true })).toBeVisible();
      await expectTouchTarget(workspace.getByRole("button", {
        name: "Resolve repository update",
        exact: true
      }));
      await expectTouchTarget(workspace.getByRole("button", {
        name: "Read/write: temporary AI may edit this session",
        exact: true
      }));
      await expect.poll(() => captured.temporaryCreates).toHaveLength(1);
      await expect.poll(() => captured.temporaryTurns).toHaveLength(1);
      expect(captured.temporaryCreates[0]).toEqual(expect.objectContaining({
        policy: "workspace_write"
      }));
      expect(captured.temporaryTurns[0]).toEqual(expect.objectContaining({
        message: expect.stringContaining(expectedPrompt),
        policy: "workspace_write",
        promptLabel: "Resolve repository update"
      }));
      expect(captured.temporaryTurns[0].message).toContain(diagnostic);
      expect(captured.temporaryTurns[0].message).toContain("Return kind=complete");
      await expect(workspace.getByText("Temporary recovery complete.", { exact: true })).toBeVisible();
      await expect(workspace.getByRole("button", {
        name: "Resolve repository update",
        exact: true
      })).toBeVisible();
      await expect(workspace.getByRole("button", {
        name: "Read/write: temporary AI may edit this session",
        exact: true
      })).toBeVisible();
      expect(captured.temporaryCreates).toHaveLength(1);
      expect(captured.temporaryTurns).toHaveLength(1);
      expect(captured.mainChatMessages).toHaveLength(0);
    });
  }

  for (const [width, height, entry] of [[320, 640, "check"], [390, 844, "header"], [1280, 844, "check"]] as const) {
  test(`${entry} Update checks the existing repair and continues in the same chat at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height });
    const updates: Array<ReturnType<typeof Promise.withResolvers<Record<string, unknown>>>> = [];
    const captured = await mockRepositoryRecovery(page, {
      code: "vibe64_session_update_conflict", diagnostic: "Two files need review.",
      outcome: (turn) => turn === 1 ? "continue" : "complete",
      async applyUpdate() {
        const pending = Promise.withResolvers<Record<string, unknown>>();
        updates.push(pending);
        return pending.promise;
      }
    });
    try {
      await page.goto(`${server.url}${DASHBOARD_PATH}/repository`);
      await page.getByRole("button", { name: "Fix it with AI", exact: true }).click();
      const workspace = page.getByRole("region", { name: "Temporary AI workspace" });
      const checkUpdate = workspace.getByRole("button", { name: "Check Update", exact: true });
      await expect(checkUpdate).toBeEnabled();
      await expect(workspace.getByRole("button", { name: "Close Resolve repository update", exact: true })).toBeInViewport({ ratio: 1 });
      await expect(workspace).toContainText("Update not yet verified");
      if (entry === "header") {
        await page.getByRole("button", { name: "Update selected session (rebase)", exact: true }).click();
      } else {
        await checkUpdate.dblclick();
      }
      await expect.poll(() => updates.length).toBe(1);
      await expect(checkUpdate).toBeDisabled();
      await expect(workspace.getByRole("button", { name: "Close Resolve repository update", exact: true })).toBeDisabled();
      await expect(workspace.getByLabel("Message temporary AI")).toBeDisabled();
      const activity = page.getByLabel("Session activity", { exact: true });
      await expect(activity).toContainText("Update this session (rebase)");
      await activity.getByRole("button", { name: "Show Update this session (rebase) details", exact: true }).click();
      if (width <= 720) {
        const terminal = page.getByRole("dialog", { name: "Update this session (rebase)", exact: true });
        await expect(terminal).toBeVisible();
        await expect(terminal.getByRole("button", { name: "Collapse", exact: true })).toBeInViewport({ ratio: 1 });
        await page.screenshot({ path: testInfo.outputPath("expanded-terminal.png") });
        await terminal.getByRole("button", { name: "Collapse", exact: true }).click();
        await expect(terminal).toHaveCount(0);
      } else {
        await expect(activity.getByRole("button", { name: "Collapse", exact: true })).toBeVisible();
      }
      const activityBox = await activity.boundingBox();
      const workspaceBox = await workspace.boundingBox();
      expect(activityBox!.y + activityBox!.height).toBeLessThanOrEqual(workspaceBox!.y + 1);
      const mainBox = await workspace.getByRole("button", { name: "Main chat", exact: true }).boundingBox();
      const tabArea = await workspace.locator(".vibe64-temporary-ai__task-tabs").boundingBox();
      expect(mainBox!.x + mainBox!.width).toBeLessThanOrEqual(tabArea!.x + 1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const widths = await workspace.evaluate((element) => ({
        client: element.clientWidth, scroll: element.scrollWidth,
        children: Array.from(element.children).map((child) => ({ class: child.className, client: child.clientWidth, scroll: child.scrollWidth }))
      }));
      expect(widths.scroll, JSON.stringify(widths)).toBeLessThanOrEqual(widths.client);
      expect(await workspace.locator(".vibe64-temporary-ai__messages").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
      const composerBox = await workspace.getByLabel("Message temporary AI").boundingBox();
      expect(composerBox!.y + composerBox!.height).toBeLessThanOrEqual(height);
      expect(composerBox!.x + composerBox!.width).toBeLessThanOrEqual(workspaceBox!.x + workspaceBox!.width + 1);
      await page.screenshot({ path: testInfo.outputPath("checking-update-mobile.png") });
      updates[0].resolve({
        ok: false, code: "vibe64_session_update_conflict", error: "Remaining conflict: messages.vue",
        details: { conflictPaths: ["messages.vue"], conflictRecovery: { canonicalCommit: "canonical-commit" } }
      });
      await expect.poll(() => captured.temporaryTurns.length).toBe(2);
      expect(captured.temporaryCreates).toHaveLength(1);
      expect(captured.temporaryTurns[1].message).toContain("Remaining conflict: messages.vue");
      await expect.poll(() => updates.length).toBe(2);
      updates[1].resolve({ ok: true, status: "updated" });
      await expect(workspace).toContainText("Session updated");
      await expect(checkUpdate).toHaveCount(0);
      expect(captured.temporaryCreates).toHaveLength(1);
      expect(captured.mainChatMessages).toHaveLength(0);
      await page.screenshot({ path: testInfo.outputPath("updated-mobile.png") });
    } finally {
      for (const pending of updates) pending.resolve({ ok: false, error: "Test stopped." });
    }
  });
  }

  test("repeated conflicts pause instead of looping, and a manual check preserves the unsent reply", async ({ page }) => {
    let checks = 0;
    const captured = await mockRepositoryRecovery(page, {
      code: "vibe64_session_update_conflict", diagnostic: "Review messages.vue", outcome: () => "complete",
      async applyUpdate() {
        checks += 1;
        return checks < 3 ? {
          ok: false, code: "vibe64_session_update_conflict", error: "Still conflicts: messages.vue",
          details: { conflictPaths: ["messages.vue"] }
        } : { ok: true, status: "updated" };
      }
    });
    await page.goto(`${server.url}${DASHBOARD_PATH}/repository`);
    await page.getByRole("button", { name: "Fix it with AI", exact: true }).click();
    const workspace = page.getByRole("region", { name: "Temporary AI workspace" });
    await expect(workspace).toContainText("Automatic repair paused after repeated conflicts");
    expect(checks).toBe(2);
    expect(captured.temporaryTurns).toHaveLength(2);
    expect(captured.temporaryCreates).toHaveLength(1);
    const input = workspace.getByLabel("Message temporary AI");
    await input.fill("Keep this unsent decision.");
    await workspace.getByRole("button", { name: "Check Update", exact: true }).click();
    await expect(workspace).toContainText("Session updated");
    await expect(input).toHaveValue("Keep this unsent decision.");
    expect(checks).toBe(3);
    expect(captured.temporaryTurns).toHaveLength(2);
  });

  test("a disconnected check explains the block and retains the draft through reconnection", async ({ page }) => {
    let unblock: (() => void) | undefined;
    let checks = 0;
    await mockRepositoryRecovery(page, {
      code: "vibe64_session_update_conflict", diagnostic: "Review messages.vue",
      async applyUpdate() { checks += 1; return { ok: true, status: "updated" }; }
    });
    await page.goto(`${server.url}${DASHBOARD_PATH}/repository`);
    await page.getByRole("button", { name: "Fix it with AI", exact: true }).click();
    const workspace = page.getByRole("region", { name: "Temporary AI workspace" });
    const check = workspace.getByRole("button", { name: "Check Update", exact: true });
    await expect(check).toBeEnabled();
    await workspace.getByLabel("Message temporary AI").fill("Keep the roster behavior.");
    await routeApiEndpoint(page, `/vibe64/sessions/${directChatSessionId}/agent-session`, async (route) => {
      if (route.request().method() === "POST") {
        await new Promise<void>((resolve) => { unblock = resolve; });
        await fulfillJson(route, { ok: true });
      } else await route.fallback();
    });
    try {
      server.disconnect();
      await expect(check).toBeDisabled();
      await expect(workspace).toContainText(/assistant.*(connection|reconnect)/u);
      await expect.poll(() => Boolean(unblock)).toBe(true);
      expect(checks).toBe(0);
      unblock!();
      await expect(check).toBeEnabled();
      await expect(workspace.getByLabel("Message temporary AI")).toHaveValue("Keep the roster behavior.");
      await check.click();
      await expect(workspace).toContainText("Session updated");
      expect(checks).toBe(1);
    } finally { unblock?.(); }
  });

  test("provider failure stays inline and a reply resumes the same repair without publishing", async ({ page }) => {
    const captured = await mockRepositoryRecovery(page, { code: "vibe64_session_update_conflict", diagnostic: "Review messages.vue", outcome: () => "complete" });
    let fail = true;
    await routeApiEndpoint(page, `/vibe64/sessions/${directChatSessionId}/temporary-conversations/temporary-conversation-1`, async (route) => {
      if (fail) await fulfillJson(route, { ok: true, status: "failed", error: "Provider connection dropped." });
      else await route.fallback();
    });
    await page.goto(`${server.url}${DASHBOARD_PATH}/repository`);
    await page.getByRole("button", { name: "Fix it with AI", exact: true }).click();
    const workspace = page.getByRole("region", { name: "Temporary AI workspace" });
    await expect(workspace.getByRole("alert")).toContainText("Provider connection dropped.");
    await expect(workspace.getByRole("button", { name: "Stop", exact: true })).toHaveCount(0);
    await expect(workspace).not.toContainText("Session updated");
    expect(captured.temporaryTurns).toHaveLength(1);
    fail = false;
    await workspace.getByLabel("Message temporary AI").fill("Continue preserving both changes.");
    await workspace.getByRole("button", { name: "Send to temporary AI", exact: true }).click();
    await expect(workspace).toContainText("Session updated");
    expect(captured.temporaryTurns).toHaveLength(2);
    expect(captured.temporaryCreates).toHaveLength(1);
    expect(captured.mainChatMessages).toHaveLength(0);
    await expect(page.locator(".v-snackbar")).toHaveCount(0);
  });

  test("failed Stop and Close retain the repair and can be retried without losing work", async ({ page }) => {
    const captured = await mockRepositoryRecovery(page, { code: "vibe64_session_update_conflict", diagnostic: "Review messages.vue" });
    const conversationPath = `/vibe64/sessions/${directChatSessionId}/temporary-conversations/temporary-conversation-1`;
    let stops = 0;
    let deletes = 0;
    await routeApiEndpoint(page, conversationPath, async (route) => {
      if (route.request().method() === "DELETE") {
        deletes += 1;
        await fulfillJson(route, deletes === 1 ? { ok: false, error: "Could not close the conversation." } : { ok: true });
      } else {
        await fulfillJson(route, { ok: true, status: "inProgress", progressUpdates: [{ id: "one", text: "Inspecting the overlapping features." }] });
      }
    });
    await routeApiEndpoint(page, `${conversationPath}/stop`, async (route) => {
      stops += 1;
      await fulfillJson(route, stops === 1 ? { ok: false, error: "Could not stop the AI." } : { ok: true });
    });
    await page.goto(`${server.url}${DASHBOARD_PATH}/repository`);
    await page.getByRole("button", { name: "Fix it with AI", exact: true }).click();
    const workspace = page.getByRole("region", { name: "Temporary AI workspace" });
    const stop = workspace.getByRole("button", { name: "Stop", exact: true });
    await stop.click();
    await expect(page.getByText("Could not stop the AI.", { exact: true })).toBeVisible();
    await expect(stop).toBeEnabled();
    await stop.click();
    await expect(stop).toHaveCount(0);
    await expect(workspace).toContainText("You stopped this repair");
    const close = workspace.getByRole("button", { name: "Close Resolve repository update", exact: true });
    await close.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Partial edits");
    await dialog.getByRole("button", { name: "Keep chat open", exact: true }).click();
    expect(deletes).toBe(0);
    await close.click();
    await dialog.getByRole("button", { name: "Close repair", exact: true }).click();
    await expect(page.getByText("Could not close the conversation.", { exact: true })).toBeVisible();
    await expect(workspace).toBeVisible();
    await dialog.getByRole("button", { name: "Close repair", exact: true }).click();
    await expect(workspace).toHaveCount(0);
    expect(stops).toBe(2);
    expect(deletes).toBe(2);
    expect(captured.temporaryCreates).toHaveLength(1);
  });

  test("Tab then Enter sends one reply, and long progress cannot move the composer offscreen", async ({ page }) => {
    const captured = await mockRepositoryRecovery(page, { code: "vibe64_session_update_conflict", diagnostic: "Review messages.vue" });
    await page.goto(`${server.url}${DASHBOARD_PATH}/repository`);
    await page.getByRole("button", { name: "Fix it with AI", exact: true }).click();
    const workspace = page.getByRole("region", { name: "Temporary AI workspace" });
    const input = workspace.getByLabel("Message temporary AI");
    await expect(input).toBeEnabled();
    await routeApiEndpoint(page, `/vibe64/sessions/${directChatSessionId}/temporary-conversations/temporary-conversation-1`, (route) => fulfillJson(route, {
      ok: true, status: "inProgress", progressUpdates: Array.from({ length: 40 }, (_, id) => ({ id: String(id), text: `Checking preserved behavior ${id}. ${"Details ".repeat(25)}` }))
    }));
    await input.fill("Keep both notification types.");
    await input.press("Tab");
    await expect(workspace.getByRole("button", { name: "Send to temporary AI", exact: true })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect.poll(() => captured.temporaryTurns.length).toBe(2);
    expect(captured.temporaryTurns[1].message).toBe("Keep both notification types.");
    await workspace.getByRole("button", { name: "Show all 40 progress updates", exact: true }).click();
    const stop = workspace.getByRole("button", { name: "Stop", exact: true });
    await expect(stop).toBeInViewport();
    await expect(input).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(captured.temporaryCreates).toHaveLength(1);
  });

  test("switching sessions retains the original repair and unsent draft without leaking them", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 844 });
    const captured = await mockRepositoryRecovery(page, { code: "vibe64_session_update_conflict", diagnostic: "Review messages.vue" });
    const other = {
      ...directChatSessionPayload, sessionId: "2026-05-12_02-00-00", sessionName: "Other session",
      manifest: { ...directChatSessionPayload.manifest, sessionId: "2026-05-12_02-00-00" }
    };
    await routeApiEndpoint(page, "/vibe64/sessions", (route) => fulfillJson(route, {
      ok: true, sessions: [directChatSessionPayload, other], limits: { openSessionCount: 2 }, creation: { canCreate: true, mode: "direct" }
    }));
    await routeApiEndpoint(page, "/vibe64/sessions/current", async (route) => {
      await fulfillJson(route, { ok: true, sessionId: route.request().method() === "PUT"
        ? route.request().postDataJSON().sessionId : directChatSessionId });
    });
    await routeApiEndpoint(page, `/vibe64/sessions/${other.sessionId}`, (route) => fulfillJson(route, other));
    await page.goto(`${server.url}${DASHBOARD_PATH}/repository`);
    await page.locator(`[data-vibe64-session-id="${directChatSessionId}"]:visible`).click();
    await page.getByRole("button", { name: "Fix it with AI", exact: true }).click();
    const workspace = page.getByRole("region", { name: "Temporary AI workspace" });
    await expect(workspace.getByLabel("Message temporary AI")).toBeEnabled();
    await workspace.getByLabel("Message temporary AI").fill("Preserve this reply for the original session.");
    await page.locator(`[data-vibe64-session-id="${other.sessionId}"]:visible`).click();
    await expect(workspace).toBeHidden();
    await expect(page.getByText("Preserve this reply for the original session.", { exact: true })).toBeHidden();
    await page.locator(`[data-vibe64-session-id="${directChatSessionId}"]:visible`).click();
    await expect(workspace).toBeVisible();
    await expect(workspace.getByLabel("Message temporary AI")).toHaveValue("Preserve this reply for the original session.");
    expect(captured.temporaryCreates).toHaveLength(1);
    expect(captured.temporaryTurns).toHaveLength(1);
  });

  test("required preparation offers one direct action, reports failure, and clears after successful setup", async ({ page }) => {
    const captured = await mockRepositoryRecovery(page, { code: "vibe64_session_update_conflict", diagnostic: "Review messages.vue" });
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

async function mockRepositoryRecovery(page: Page, {
  code,
  diagnostic,
  outcome = () => "continue",
  applyUpdate = async () => ({ ok: true, status: "updated" })
}: {
  code: typeof RECOVERY_CODES[number];
  diagnostic: string;
  outcome?: (turn: number) => string;
  applyUpdate?: () => Promise<Record<string, unknown>>;
}) {
  const mainChatMessages: Record<string, unknown>[] = [];
  const temporaryCreates: Record<string, unknown>[] = [];
  const temporaryTurns: Record<string, unknown>[] = [];
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

    if (method === "GET" && url.pathname.endsWith("/assistant-access")) {
      await fulfillJson(route, { ok: true, available: true, canUse: true });
      return;
    }
    if (method === "GET" && url.pathname.endsWith("/agent-session")) {
      await fulfillJson(route, { ok: true, agentSession: directChatSessionPayload.agentSession });
      return;
    }
    if (method === "POST" && url.pathname.endsWith("/updates/apply")) {
      const result = await applyUpdate();
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
    if (method === "POST" && url.pathname.endsWith("/agent-message")) {
      mainChatMessages.push(requestBodyWithoutOrigin(request));
      await fulfillJson(route, { delivered: true, ok: true });
      return;
    }
    if (method === "POST" && url.pathname.endsWith("/temporary-conversations")) {
      temporaryCreates.push(requestBodyWithoutOrigin(request));
      await fulfillJson(route, {
        conversationId: "temporary-conversation-1",
        ok: true
      });
      return;
    }
    if (
      method === "POST" &&
      url.pathname.endsWith("/temporary-conversations/temporary-conversation-1/turns")
    ) {
      temporaryTurns.push(requestBodyWithoutOrigin(request));
      await fulfillJson(route, {
        ok: true,
        runId: `temporary-run-${temporaryTurns.length}`,
        status: "inProgress"
      });
      return;
    }
    if (
      method === "GET" &&
      url.pathname.endsWith("/temporary-conversations/temporary-conversation-1")
    ) {
      await fulfillJson(route, {
        message: "Temporary recovery complete.",
        ok: true,
        outcome: { kind: outcome(temporaryTurns.length) },
        runId: `temporary-run-${temporaryTurns.length}`,
        status: "completed"
      });
      return;
    }
    if (method === "POST" && url.pathname.endsWith("/updates/check")) {
      await fulfillJson(route, {
        code,
        error: diagnostic,
        ok: false
      });
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
        updateOperation: null
      });
      return;
    }
    if (method === "GET" && url.pathname.endsWith("/conversation-log")) {
      await fulfillJson(route, {
        conversationLog: [],
        ok: true,
        pagination: {
          count: 0,
          hasMoreBefore: false,
          limit: 20,
          totalTurnCount: 0
        },
        sessionId: directChatSessionId
      });
      return;
    }
    if (method === "GET" && /\/sessions\/[^/]+$/u.test(url.pathname)) {
      await fulfillJson(route, directChatSessionPayload);
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
      sessions: [directChatSessionPayload]
    });
  }, { prefix: true });

  return {
    mainChatMessages,
    temporaryCreates,
    temporaryTurns
  };
}

function requestBodyWithoutOrigin(request: Request) {
  const {
    originId: _originId,
    ...body
  } = (request.postDataJSON() || {}) as Record<string, unknown>;
  return body;
}

async function expectTouchTarget(locator: ReturnType<Page["getByRole"]>) {
  await expect.poll(async () => {
    const box = await locator.boundingBox();
    return box && {
      height: Math.round(box.height),
      width: Math.round(box.width)
    };
  }).toMatchObject({
    height: 48
  });
}
