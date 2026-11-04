import { expect, type Page, type Request } from "@playwright/test";
import { DASHBOARD_PATH, directChatSessionId, directChatSessionPayload } from "./base-shell-data";
import { mockProjectGateReady } from "./base-shell-mocks";
import { fulfillJson, routeApiEndpoint } from "./base-shell/http";
import { assistantStatusServer, relayConversation } from "./assistant-status-server";

type StatusServer = Awaited<ReturnType<typeof assistantStatusServer>>;

const CONFLICT_PATHS = ["src/app.js", "package.json"];
export const CONFLICT_FAILURE = {
  status: "failed",
  code: "vibe64_session_update_conflict",
  error: "2 files need review before this session can update.",
  conflictPaths: CONFLICT_PATHS,
  conflictRecovery: { reviewId: "review-1", conflictPaths: CONFLICT_PATHS }
};

/** Update's answer when it still finds conflicts. A new review id makes it a new failure. */
export function conflictAnswer(reviewId: string, paths = ["src/pricing.js"]) {
  return {
    ok: false,
    code: "vibe64_session_update_conflict",
    error: `Update stopped at ${paths.join(", ")}.`,
    details: { conflictPaths: paths, conflictRecovery: { reviewId, conflictPaths: paths } }
  };
}

/**
 * A session whose Update has failed, on the real AI task routes. `world.updated` is what the page's
 * repository reads see, so a scenario can end the failure as Update would.
 */
export async function aiTaskWorld(page: Page, server: StatusServer, failure: Record<string, any> = CONFLICT_FAILURE) {
  return repositoryWorld(page, server, failure, "update");
}

export const SAVE_FAILURE = { status: "failed", code: "vibe64_session_save_git_failed", error: "The pre-commit hook failed: lint found 2 errors." };

/** A session whose Save has failed. `world.updated` here means Save has since succeeded. */
export async function saveTaskWorld(page: Page, server: StatusServer, failure: Record<string, any> = SAVE_FAILURE) {
  return repositoryWorld(page, server, failure, "save");
}

export const SETUP_FAILURE = {
  status: "failed",
  diagnostic: "npm ci failed: ERESOLVE could not resolve the dependency tree.",
  transcript: "$ npm ci\nnpm error ERESOLVE could not resolve",
  updatedAt: "2026-11-04T10:00:00.000Z"
};

/** A session whose workspace preparation has failed. `world.updated` here means preparation has since succeeded. */
export async function workspaceSetupWorld(page: Page, server: StatusServer, failure: Record<string, any> = SETUP_FAILURE) {
  return repositoryWorld(page, server, failure, "workspace-setup");
}

/** A session with nothing failed, for a kind whose notice lives elsewhere. */
export async function quietWorld(page: Page, server: StatusServer) {
  return repositoryWorld(page, server, {}, "");
}

async function repositoryWorld(page: Page, server: StatusServer, failure: Record<string, any>, kind: "update" | "save" | "workspace-setup" | "") {
  const world = { updated: false, operationEvents: [] as { at: string; message: string }[] };
  const update = kind === "update";
  const save = kind === "save";
  if (update || save) {
    await server.temporary!.store.writeBackgroundTaskEvent(directChatSessionId, update ? "update-session" : "save-work", { patch: failure });
  }
  if (kind === "workspace-setup") server.aiTasks.workspaceSetup = failure;
  const workspaceSetup = () => kind === "workspace-setup" && !world.updated ? failure : { status: "unconfigured" };
  await mockProjectGateReady(page);
  await relayConversation(page, server);
  await routeApiEndpoint(page, "/vibe64/repository", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/history")) {
      await fulfillJson(route, { historySnapshotCommit: "canonical", nextCursor: "", ok: true, versions: [], updateCheck: {
        ahead: 0, behind: 1, canonicalCommit: "canonical", checkedAt: "2026-11-04T10:00:00.000Z", sessionCommit: "session", updateAvailable: true
      } });
      return;
    }
    await fulfillJson(route, { ok: true });
  }, { prefix: true });
  await routeApiEndpoint(page, "/vibe64/sessions", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    if (/\/(?:ai-task-conversations|ai-tasks)(?:[/?]|$)/u.test(url.pathname)) return route.fallback();
    if (method === "GET" && url.pathname.endsWith("/assistant-access")) {
      await fulfillJson(route, { ok: true, available: true, canUse: true, purposes: { senior: { available: true }, fix: { available: true } } });
      return;
    }
    if (method === "GET" && url.pathname.endsWith("/agent-session")) {
      await fulfillJson(route, { ok: true, agentSession: directChatSessionPayload.agentSession });
      return;
    }
    if (method === "PUT" && url.pathname.endsWith("/current")) {
      await fulfillJson(route, { ok: true, sessionId: directChatSessionId });
      return;
    }
    if (method === "POST" && url.pathname.endsWith("/updates/check")) {
      await fulfillJson(route, world.updated || !update
        ? { ok: true, relationship: "current", ahead: 0, behind: 0, updateAvailable: false, incomingVersions: [] }
        : { code: failure.code, error: failure.error, ok: false });
      return;
    }
    if (method === "GET" && url.pathname.endsWith("/work")) {
      const failed = world.updated || !(update || save) ? null : {
        operationId: `failed-${kind}`, kind, status: "failed", code: failure.code,
        error: failure.error, conflictRecovery: failure.conflictRecovery, events: world.operationEvents
      };
      await fulfillJson(route, { ahead: save ? 1 : 0, behind: update && !world.updated ? 1 : 0, ok: true,
        unsaved: update || (save && !world.updated), updateAvailable: update && !world.updated,
        operation: save ? failed : null, updateOperation: update ? failed : null });
      return;
    }
    if (method === "GET" && /\/sessions\/[^/]+$/u.test(url.pathname)) {
      await fulfillJson(route, { ...directChatSessionPayload, workspaceSetup: workspaceSetup() });
      return;
    }
    await fulfillJson(route, { creation: { canCreate: true, mode: "direct" }, limits: { openSessionCount: 1 }, ok: true,
      sessions: [{ ...directChatSessionPayload, workspaceSetup: workspaceSetup() }] });
  }, { prefix: true });
  return world;
}

export const taskWindow = (page: Page) => page.locator("[data-vibe64-ai-task]");

/** Opens the session and starts the fix from Update's notice, as a person does. */
export async function openFix(page: Page, server: StatusServer, arrive: () => Promise<void> = async () => {}) {
  await page.goto(`${server.url}${DASHBOARD_PATH}/repository`);
  await arrive();
  // On a phone the notice can sit in the hidden chat: wait for the page, then show the chat if needed.
  const button = page.locator("[data-vibe64-ai-task-button]").filter({ visible: true }).first();
  const showChat = page.getByRole("button", { name: "Show chat", exact: true });
  await expect(button.or(showChat).first()).toBeVisible();
  if (!await button.isVisible()) await showChat.click();
  await button.click();
  await expect(taskWindow(page)).toBeVisible();
  return taskIdOf(page);
}

/** Starts a task on the server, as its own notice does, and opens the session at its window. */
export async function openStarted(page: Page, server: StatusServer, kind: string, input: Record<string, unknown>) {
  const { task } = await server.aiTasks.start(kind, input);
  await page.goto(`${server.url}${DASHBOARD_PATH}/repository?aiTask=${encodeURIComponent(task.id)}`);
  await expect(taskWindow(page)).toBeVisible();
  return task.id as string;
}

export function taskIdOf(page: Page) {
  return new URL(page.url()).searchParams.get("aiTask") || "";
}

export const taskResult = (kind: string, message: string) => JSON.stringify({ kind, message, report: message });

/** Ends the AI's turn the way a kind of result does, with no browser involved. */
export async function endTurn(server: StatusServer, taskId: string, kind: string, message: string) {
  const { captured } = server.temporary!;
  await expect.poll(() => captured.startedTurns).toBe(captured.temporaryTurns.length);
  await server.temporary!.endNativeTurn(taskId, { text: taskResult(kind, message), message });
  await server.aiTasks.settled();
}

export async function expectPhase(page: Page, phase: string, reason = "") {
  await expect(taskWindow(page)).toHaveAttribute("data-vibe64-ai-task-phase", phase);
  if (reason) await expect(taskWindow(page)).toHaveAttribute("data-vibe64-ai-task-reason", reason);
}

export function requestBody(request: Request) {
  return request.postDataJSON() as Record<string, unknown>;
}
