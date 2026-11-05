import { expect, test, type Page } from "@playwright/test";
import { directChatSessionId, directChatSessionPayload } from "./support/base-shell-data";
import { fulfillJson, routeApiEndpoint } from "./support/base-shell/http";
import { assistantStatusServer } from "./support/assistant-status-server";
import {
  aiTaskWorld, conflictAnswer, endTurn, expectPhase, openFix, taskIdOf, taskWindow
} from "./support/ai-task-world";

const VIEWPORTS = [
  { width: 320, height: 568, touch: true },
  { width: 390, height: 844, touch: true },
  { width: 390, height: 500, touch: true },
  { width: 600, height: 844, touch: true },
  { width: 844, height: 390, touch: true },
  { width: 1280, height: 800, touch: false },
  { width: 1600, height: 1000, touch: false }
];
const held = () => ({ status: "inProgress" });

function serverFixture() {
  const shared = {} as { server: Awaited<ReturnType<typeof assistantStatusServer>>; pageErrors: string[] };
  test.beforeEach(async ({ page }) => {
    shared.server = await assistantStatusServer({ temporaryEngineId: "codex" });
    shared.server.temporary!.captured.nativeTurn = held;
    shared.pageErrors = [];
    page.on("pageerror", error => shared.pageErrors.push(error.message));
  });
  test.afterEach(async ({ page }, testInfo) => {
    if (!page.isClosed()) await page.screenshot({ path: testInfo.outputPath("final.png") }).catch(() => {});
    await shared.server.close();
    expect(shared.pageErrors).toEqual([]);
  });
  return shared;
}

/** Nothing in the window or the page runs wider than the screen. */
async function expectNoSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(() => {
    const window = document.querySelector("[data-vibe64-ai-task]");
    const wide = (element: Element) => element.scrollWidth > element.clientWidth + 1;
    return { page: document.documentElement.scrollWidth > innerWidth + 1, window: Boolean(window && wide(window)) };
  });
  expect(overflow).toEqual({ page: false, window: false });
}

/** Every visible control in the window is a full touch target. */
async function expectTouchTargets(page: Page) {
  const small = await taskWindow(page).evaluate((root) => {
    const controls = [...root.querySelectorAll("button, summary, [role='tab']")] as HTMLElement[];
    return controls.filter(control => control.getClientRects().length > 0).map((control) => {
      const box = control.getBoundingClientRect();
      return { name: control.getAttribute("aria-label") || control.textContent?.trim(), height: Math.round(box.height), width: Math.round(box.width) };
    }).filter(box => box.height < 48 || box.width < 48);
  });
  expect(small).toEqual([]);
}

/** Opens the person's temporary chats from the session header, as a person does. */
async function openTemporaryChats(page: Page) {
  const action = page.getByRole("button", { name: /^Open temporary AI(?::|$)/u }).filter({ visible: true });
  const actions = page.getByRole("button", { name: /^Session actions(?::|$)/u }).filter({ visible: true });
  const showChat = page.getByRole("button", { name: "Show chat", exact: true });
  await expect(action.or(actions).or(showChat).first()).toBeVisible();
  if (await showChat.isVisible()) await showChat.click();
  if (await action.count()) await action.first().click();
  else {
    await actions.first().click();
    await page.locator("[data-vibe64-temporary-ai-action]").filter({ visible: true }).click();
  }
  const workspace = page.getByRole("region", { name: "Temporary AI workspace" });
  await expect(workspace).toBeVisible();
  return workspace;
}

/** The ids the server lists for the temporary chat tabs as the page loads. */
function listedTemporaryChats(page: Page) {
  return page.waitForResponse(response => response.request().method() === "GET" &&
    new URL(response.url()).pathname.endsWith("/temporary-conversations"))
    .then(async response => ((await response.json()).conversations as Array<{ conversationId: string }>)
      .map(chat => chat.conversationId));
}

for (const viewport of VIEWPORTS) {
  const size = `${viewport.width}x${viewport.height}`;
  test.describe(`at ${size}`, () => {
    test.use({ hasTouch: viewport.touch, viewport: { width: viewport.width, height: viewport.height } });
    const shared = serverFixture();

    test("opens from the notice, keeps the problem in both views and fits the screen", async ({ page }) => {
      await aiTaskWorld(page, shared.server);
      await openFix(page, shared.server);
      const window = taskWindow(page);
      await expectPhase(page, "working");
      await expect(window.getByRole("heading", { name: "Fix Update" })).toBeVisible();
      await expect(window.locator("[data-vibe64-ai-task-status]")).toHaveText("The AI is working on this");
      const progress = window.getByRole("tab", { name: "Progress" });
      const chat = window.getByRole("tab", { name: "Chat" });
      await expect(progress).toHaveAttribute("aria-selected", "true");
      await expect(window.getByText("Update found conflicts in 2 files.")).toBeVisible();
      await expect(window.getByText("The AI repairs the conflicts")).toBeVisible();
      await expectNoSidewaysScroll(page);
      if (viewport.touch) await expectTouchTargets(page);

      await chat.click();
      await expect(chat).toHaveAttribute("aria-selected", "true");
      await expect(window.getByText("Update found conflicts in 2 files.")).toBeVisible();
      await expect(window.getByRole("textbox", { name: "Message the AI" })).toBeVisible();
      await expect(window.getByText("The AI repairs the conflicts")).toBeHidden();
      await expectNoSidewaysScroll(page);
      if (viewport.touch) await expectTouchTargets(page);

      await progress.click();
      await window.locator("[data-vibe64-ai-task-details]").click();
      const details = window.locator("[data-vibe64-ai-task-details-text]");
      await expect(details).toContainText("src/app.js");
      const sizes = await window.evaluate((root) => {
        const text = root.querySelector("[data-vibe64-ai-task-details-text]")!;
        return { details: text.getBoundingClientRect().height, window: root.getBoundingClientRect().height };
      });
      expect(sizes.details).toBeLessThanOrEqual(sizes.window * 0.4 + 1);
      await expectNoSidewaysScroll(page);
    });

    test("ends Done with the problem and the answer together, and Close ends it", async ({ page }) => {
      await aiTaskWorld(page, shared.server);
      const taskId = await openFix(page, shared.server);
      await expectPhase(page, "working");
      await endTurn(shared.server, taskId, "complete", "Merged both sides in src/app.js and package.json.");
      await expectPhase(page, "done");
      const window = taskWindow(page);
      await expect(window.getByRole("heading", { name: "Done" })).toBeFocused();
      await expect(window.getByText("Update found conflicts in 2 files.")).toBeVisible();
      await expect(window.getByText("Session updated. Your changes were preserved. Nothing was pushed.")).toBeVisible();
      await expect(window.getByText("Merged both sides in src/app.js and package.json.").filter({ visible: true })).toBeVisible();
      await expectNoSidewaysScroll(page);
      if (viewport.touch) await expectTouchTargets(page);
      await window.locator("[data-vibe64-ai-task-transcript]").click();
      await expect(window.getByRole("button", { name: "Back to the result" })).toBeVisible();
      await expect(window.getByText("This conversation has ended.")).toBeVisible();
      await expect(window.getByRole("textbox")).toHaveCount(0);
      await window.getByRole("button", { name: "Back to the result" }).click();
      await window.locator("[data-vibe64-ai-task-close]").click();
      await expect(window).toHaveCount(0);
      await expect(page.locator("[data-vibe64-ai-task-tray]")).toHaveCount(0);
      expect(new URL(page.url()).searchParams.has("aiTask")).toBe(false);
    });

    test("ends Not done on Cancel, asked once in the footer", async ({ page }) => {
      await aiTaskWorld(page, shared.server);
      await openFix(page, shared.server);
      await expectPhase(page, "working");
      const window = taskWindow(page);
      await window.locator("[data-vibe64-ai-task-cancel]").click();
      await expect(window.getByText("Cancel this fix? The AI stops. Anything it has changed stays in the session.")).toBeVisible();
      await expectNoSidewaysScroll(page);
      await window.locator("[data-vibe64-ai-task-keep-going]").click();
      await expectPhase(page, "working");
      await window.locator("[data-vibe64-ai-task-cancel]").click();
      await window.locator("[data-vibe64-ai-task-cancel-confirm]").click();
      await expectPhase(page, "not_done");
      await expect(window.getByRole("heading", { name: "Not done" })).toBeVisible();
      await expect(window.getByText("You cancelled this fix.")).toBeVisible();
      await expect(window.getByText("To try again, close this and choose Fix it with AI.")).toBeVisible();
      await expectNoSidewaysScroll(page);
      await window.locator("[data-vibe64-ai-task-close]").click();
      await expect(window).toHaveCount(0);
    });
  });
}

for (const viewport of [VIEWPORTS[5], VIEWPORTS[1]]) {
  const size = `${viewport.width}x${viewport.height}`;
  test.describe(`once at ${size}`, () => {
    test.use({ hasTouch: viewport.touch, viewport: { width: viewport.width, height: viewport.height } });
    const shared = serverFixture();

    test("a reload in each phase reopens the window on the same task", async ({ page }) => {
      await aiTaskWorld(page, shared.server);
      const taskId = await openFix(page, shared.server);
      await expectPhase(page, "working");
      await page.reload();
      await expectPhase(page, "working");

      await endTurn(shared.server, taskId, "question", "Which price table should stay?");
      await expectPhase(page, "needs_you", "question");
      await page.reload();
      await expectPhase(page, "needs_you", "question");
      await expect(taskWindow(page).getByRole("tab", { name: "Chat" })).toHaveAttribute("aria-selected", "true");

      await taskWindow(page).getByRole("textbox", { name: "Message the AI" }).fill("Keep the newer one.");
      await taskWindow(page).getByRole("button", { name: "Send message" }).click();
      await expectPhase(page, "working");
      await endTurn(shared.server, taskId, "complete", "Kept the newer price table.");
      await expectPhase(page, "done");
      await page.reload();
      await expectPhase(page, "done");
      expect(taskIdOf(page)).toBe(taskId);
    });

    test("after a reload the person's temporary chat is a tab again and the running task stays in its own window", async ({ page }) => {
      await aiTaskWorld(page, shared.server);
      // The person's own temporary chat, saved as the header's New temporary chat saves it.
      await shared.server.temporary!.seed([{ conversationId: "person-chat", title: "Check the schema",
        draft: "Which index is missing?", agentSettings: {} }]);
      const taskId = await openFix(page, shared.server);
      await expectPhase(page, "working");
      const tray = page.locator("[data-vibe64-ai-task-tray]");
      const expectTabs = async () => {
        const workspace = await openTemporaryChats(page);
        await expect(workspace.locator("[data-temporary-ai-task-id]")).toHaveCount(1);
        await expect(workspace.locator('[data-temporary-ai-task-id="person-chat"]')).toContainText("Check the schema");
        await expect(workspace.locator(`[data-temporary-ai-task-id="${taskId}"]`)).toHaveCount(0);
        await expect(workspace.getByLabel("Message temporary AI")).toHaveValue("Which index is missing?");
        await expect(tray).toHaveAccessibleName("Fix Update: Fixing Update…");
      };

      await page.locator("[data-vibe64-ai-task-hide]").filter({ visible: true }).click();
      await expect(taskWindow(page)).toBeHidden();
      expect(taskIdOf(page)).toBe("");
      let listed = listedTemporaryChats(page);
      await page.reload();
      expect(await listed).toEqual(["person-chat"]);
      await expectTabs();
      await page.goto(`${new URL(page.url()).origin}${new URL(page.url()).pathname}?aiTask=${encodeURIComponent(taskId)}`);
      await expectPhase(page, "working");

      // Again with the task's window open.
      listed = listedTemporaryChats(page);
      await page.reload();
      expect(await listed).toEqual(["person-chat"]);
      await expectPhase(page, "working");
      expect(taskIdOf(page)).toBe(taskId);
      await page.locator("[data-vibe64-ai-task-hide]").filter({ visible: true }).click();
      await expect(taskWindow(page)).toBeHidden();
      await expectTabs();
      await tray.click();
      await expectPhase(page, "working");
      expect(taskIdOf(page)).toBe(taskId);
    });

    test("Hide keeps the task running, and the tray and the notice bring it back", async ({ page }) => {
      await aiTaskWorld(page, shared.server);
      const taskId = await openFix(page, shared.server);
      await expectPhase(page, "working");
      await page.locator("[data-vibe64-ai-task-hide]").filter({ visible: true }).click();
      await expect(taskWindow(page)).toBeHidden();
      const tray = page.locator("[data-vibe64-ai-task-tray]");
      await expect(tray).toBeVisible();
      await expect(tray).toHaveAccessibleName("Fix Update: Fixing Update…");
      await tray.click();
      await expect(taskWindow(page)).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(taskWindow(page)).toBeHidden();
      await expect(tray).toBeFocused();
      await endTurn(shared.server, taskId, "complete", "Merged both sides.");
      const toast = page.locator("[data-vibe64-ai-task-toast]");
      await expect(toast).toHaveText("Fix Update: Done.");
      await expect(tray).toHaveAccessibleName("Fix Update: Done");
      await expect(taskWindow(page)).toBeHidden();
      await page.locator("[data-vibe64-ai-task-see-result]").click();
      await expectPhase(page, "done");
    });

    test("Back hides the window and Forward brings it back", async ({ page }) => {
      await aiTaskWorld(page, shared.server);
      await openFix(page, shared.server);
      await expectPhase(page, "working");
      await page.goBack();
      await expect(taskWindow(page)).toBeHidden();
      await expect(page.locator("[data-vibe64-ai-task-tray]")).toBeVisible();
      await page.goForward();
      await expectPhase(page, "working");
    });

    test("a second person sees it live, can cancel it, and hears when it closes", async ({ page, browser }) => {
      await aiTaskWorld(page, shared.server);
      await openFix(page, shared.server);
      await expectPhase(page, "working");
      const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, hasTouch: viewport.touch });
      try {
        const other = await context.newPage();
        await aiTaskWorld(other, shared.server);
        await other.goto(page.url());
        await expectPhase(other, "working");
        await other.locator("[data-vibe64-ai-task-cancel]").click();
        await other.locator("[data-vibe64-ai-task-cancel-confirm]").click();
        await expectPhase(page, "not_done");
        await expectPhase(other, "not_done");
        await taskWindow(page).locator("[data-vibe64-ai-task-close]").click();
        await expect(taskWindow(other)).toHaveCount(0);
      } finally {
        await context.close();
      }
    });

    test("a restart in working stops at needs you, and Continue carries on", async ({ page }) => {
      await aiTaskWorld(page, shared.server);
      const taskId = await openFix(page, shared.server);
      await expectPhase(page, "working");
      await shared.server.temporary!.setNativeStatus(taskId, "interrupted");
      await shared.server.aiTasks.restart();
      await expectPhase(page, "needs_you", "interrupted");
      await expect(taskWindow(page).locator("[data-vibe64-ai-task-status]")).toHaveText("Vibe64 restarted while the AI was working");
      const turns = shared.server.temporary!.captured.temporaryTurns.length;
      await taskWindow(page).locator("[data-vibe64-ai-task-action='continue']").click();
      await expectPhase(page, "working");
      await expect.poll(() => shared.server.temporary!.captured.temporaryTurns.length).toBe(turns + 1);
    });

    test("a restart in checking runs the same check again and finishes", async ({ page }) => {
      await aiTaskWorld(page, shared.server);
      const taskId = await openFix(page, shared.server);
      await expectPhase(page, "working");
      shared.server.aiTasks.update = () => new Promise(() => {});
      void endTurn(shared.server, taskId, "complete", "Merged both sides.");
      await expectPhase(page, "checking");
      shared.server.aiTasks.update = async () => ({ ok: true });
      await shared.server.aiTasks.restart();
      await expectPhase(page, "done");
      const [first, second] = shared.server.aiTasks.updates;
      expect(second.requestId).toBe(first.requestId);
    });

    test("a failed check goes back to the same chat by itself", async ({ page }) => {
      await aiTaskWorld(page, shared.server);
      const taskId = await openFix(page, shared.server);
      await expectPhase(page, "working");
      shared.server.aiTasks.update = async () => conflictAnswer("review-2");
      await endTurn(shared.server, taskId, "complete", "Merged both sides.");
      await expect(taskWindow(page).locator("[data-vibe64-ai-task-status]")).toHaveText("The AI is trying again (attempt 2 of 3)");
      expect(taskIdOf(page)).toBe(taskId);
      expect(shared.server.temporary!.captured.temporaryCreates).toHaveLength(1);
      await taskWindow(page).getByRole("tab", { name: "Chat" }).click();
      await expect(taskWindow(page).getByText("Continue repairing the remaining conflicts.")).toBeVisible();
      await expect(taskWindow(page).getByText("Update still has conflicts in 1 file. Sent back to the AI.")).toBeHidden();
    });

    test("Cancel during a check that can't stop says so, stays pressable, and ends with the run", async ({ page }) => {
      await aiTaskWorld(page, shared.server);
      const taskId = await openFix(page, shared.server);
      await expectPhase(page, "working");
      const release = Promise.withResolvers<Record<string, unknown>>();
      shared.server.aiTasks.update = () => release.promise;
      void endTurn(shared.server, taskId, "complete", "Merged both sides.");
      await expectPhase(page, "checking");
      const window = taskWindow(page);
      await window.locator("[data-vibe64-ai-task-cancel]").click();
      await window.locator("[data-vibe64-ai-task-cancel-confirm]").click();
      await expectPhase(page, "cancelling");
      await expect(window.getByText("Update can't be interrupted. The fix ends as soon as this run finishes.")).toBeVisible();
      const cancel = window.locator("[data-vibe64-ai-task-cancel]");
      await expect(cancel).toHaveText("Cancelling…");
      await expect(cancel).toBeEnabled();
      await cancel.click();
      await expectPhase(page, "cancelling");
      release.resolve(conflictAnswer("review-2"));
      await expectPhase(page, "not_done");
    });

    test("an account change does nothing to a running task", async ({ page }) => {
      await aiTaskWorld(page, shared.server);
      const taskId = await openFix(page, shared.server);
      await expectPhase(page, "working");
      shared.server.sessionChanged("assistant-routing-changed", { conversationId: taskId });
      await shared.server.aiTasks.settled();
      await expectPhase(page, "working");
      await expect.poll(() => shared.server.temporary!.captured.temporaryTurns.length).toBe(1);
    });

    test("archiving ends an open task", async ({ page }) => {
      await aiTaskWorld(page, shared.server);
      await openFix(page, shared.server);
      await expectPhase(page, "working");
      await shared.server.aiTasks.archive();
      await expectPhase(page, "not_done", "archived");
      await expect(taskWindow(page).getByText("The session was archived before this finished.")).toBeVisible();
    });

    test("a dropped connection keeps the draft, and the window catches up when it returns", async ({ page }) => {
      await aiTaskWorld(page, shared.server);
      const taskId = await openFix(page, shared.server);
      await expectPhase(page, "working");
      const window = taskWindow(page);
      await window.getByRole("tab", { name: "Chat" }).click();
      const input = window.getByRole("textbox", { name: "Message the AI" });
      await input.fill("Keep the roster behaviour.");
      shared.server.disconnect();
      await endTurn(shared.server, taskId, "question", "Which price table should stay?");
      await expectPhase(page, "needs_you", "question");
      await expect(input).toHaveValue("Keep the roster behaviour.");
    });

    test("Tab then Enter sends one reply, and Stop and the composer stay on screen", async ({ page }) => {
      await aiTaskWorld(page, shared.server);
      const taskId = await openFix(page, shared.server);
      await expectPhase(page, "working");
      await endTurn(shared.server, taskId, "question", "Which price table should stay?");
      await expectPhase(page, "needs_you", "question");
      const window = taskWindow(page);
      await window.locator("[data-vibe64-ai-task-action='answer']").click();
      const input = window.getByRole("textbox", { name: "Message the AI" });
      await input.fill("Keep the newer one.");
      await input.press("Tab");
      await expect(window.getByRole("button", { name: "Send message" })).toBeFocused();
      await page.keyboard.press("Enter");
      await expectPhase(page, "working");
      await expect.poll(() => shared.server.temporary!.captured.temporaryTurns.length).toBe(2);
      expect(shared.server.temporary!.captured.temporaryTurns[1].displayMessage).toBe("Keep the newer one.");
      await expect(window.getByRole("button", { name: "Stop", exact: true })).toBeInViewport();
      await expect(input).toBeInViewport();
      await expectNoSidewaysScroll(page);
      expect(shared.server.temporary!.captured.temporaryCreates).toHaveLength(1);
    });

    test("Stop in Chat ends the turn and leaves the fix with the person", async ({ page }) => {
      await aiTaskWorld(page, shared.server);
      await openFix(page, shared.server);
      await expectPhase(page, "working");
      const window = taskWindow(page);
      await window.getByRole("tab", { name: "Chat" }).click();
      await window.getByRole("button", { name: "Stop", exact: true }).click();
      await expectPhase(page, "needs_you", "stopped");
      await expect(window.locator("[data-vibe64-ai-task-status]")).toHaveText("Stopped. Tell the AI what to do next.");
    });

    test("the whole window works from the keyboard", async ({ page }) => {
      await aiTaskWorld(page, shared.server);
      const taskId = await openFix(page, shared.server);
      await expectPhase(page, "working");
      const window = taskWindow(page);
      await expect(window.getByRole("heading", { name: "Fix Update" })).toBeFocused();
      const progress = window.getByRole("tab", { name: "Progress" });
      const chat = window.getByRole("tab", { name: "Chat" });
      await progress.focus();
      await page.keyboard.press("ArrowRight");
      await expect(chat).toBeFocused();
      await expect(chat).toHaveAttribute("aria-selected", "true");
      await page.keyboard.press("Home");
      await expect(progress).toBeFocused();
      await page.keyboard.press("End");
      await expect(chat).toBeFocused();
      for (let press = 0; press < 25; press += 1) {
        await page.keyboard.press("Tab");
        expect(await page.evaluate(() => Boolean(document.activeElement?.closest("[data-vibe64-ai-task], .v-overlay")))).toBe(true);
      }
      await endTurn(shared.server, taskId, "complete", "Merged both sides.");
      await expect(window.getByRole("heading", { name: "Done" })).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(window).toHaveCount(0);
    });
  });
}

test.describe("what the rest of the page does", () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  const shared = serverFixture();

  test("the notice follows the task, and competing actions wait", async ({ page }) => {
    await aiTaskWorld(page, shared.server);
    const taskId = await openFix(page, shared.server);
    await expectPhase(page, "working");
    await page.keyboard.press("Escape");
    const button = page.locator("[data-vibe64-ai-task-button]").first();
    await expect(button).toContainText("Being fixed…");
    await expect(page.getByRole("button", { name: "Review resolved conflicts", exact: true })).toHaveCount(0);
    await button.click();
    await expectPhase(page, "working");
    await endTurn(shared.server, taskId, "cannot", "These two designs can't be merged.");
    await expectPhase(page, "needs_you", "ai_stuck");
    await taskWindow(page).locator("[data-vibe64-ai-task-action='end']").click();
    await expectPhase(page, "not_done");
    await expect(taskWindow(page).getByText("The AI could not fix this: These two designs can't be merged.")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(taskWindow(page)).toHaveCount(0);
    await expect(page.locator("[data-vibe64-ai-task-button]").first()).toContainText("Fix it with AI");
  });

  test("Review resolved conflicts runs the task's own check", async ({ page }) => {
    await aiTaskWorld(page, shared.server);
    const taskId = await openFix(page, shared.server);
    await expectPhase(page, "working");
    shared.server.aiTasks.update = async () => conflictAnswer("review-2");
    await endTurn(shared.server, taskId, "complete", "Merged both sides.");
    await endTurn(shared.server, taskId, "complete", "Merged again.");
    await expectPhase(page, "needs_you", "check_stuck");
    await taskWindow(page).locator("[data-vibe64-ai-task-action='review']").click();
    const review = page.getByRole("dialog", { name: "Apply resolved Update", exact: true });
    await expect(review).toBeVisible();
    shared.server.aiTasks.update = async () => ({ ok: true });
    await review.getByRole("button", { name: "I've resolved these conflicts — apply Update", exact: true }).click();
    await expectPhase(page, "done");
    expect(shared.server.aiTasks.updates.at(-1)?.reviewedConflictId).toBe("review-1");
  });

  test("the AI's own words join Vibe64's in Activity", async ({ page }) => {
    await aiTaskWorld(page, shared.server);
    const taskId = await openFix(page, shared.server);
    await expectPhase(page, "working");
    await shared.server.temporary!.say(taskId, "Read src/app.js and package.json");
    await page.reload();
    await expect(taskWindow(page).getByRole("region", { name: "Activity" })).toContainText("Read src/app.js and package.json");
    await expect(taskWindow(page).getByRole("region", { name: "Activity" })).toContainText("The AI started.");
  });

  test("the archive dialog warns about a running task", async ({ page }) => {
    await aiTaskWorld(page, shared.server);
    await openFix(page, shared.server);
    await expectPhase(page, "working");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Archive session", exact: true }).filter({ visible: true }).first().click();
    await expect(page.locator("[data-vibe64-archive-ai-task]")).toHaveText("An AI task is still running. Archiving cancels it.");
  });

  test("diverged history opens the same window", async ({ page }) => {
    await aiTaskWorld(page, shared.server, {
      status: "failed", code: "vibe64_session_update_history_diverged", error: "This session and the saved version have diverged."
    });
    await openFix(page, shared.server);
    await expectPhase(page, "working");
    await expect(taskWindow(page).getByText("This session and the saved version have diverged.")).toBeVisible();
  });

  test("switching sessions leaves the window and its draft behind, and coming back finds them", async ({ page }) => {
    await aiTaskWorld(page, shared.server);
    const other = {
      ...directChatSessionPayload, sessionId: "2026-05-12_02-00-00", sessionName: "Other session",
      workspaceSetup: { status: "unconfigured" },
      manifest: { ...directChatSessionPayload.manifest, sessionId: "2026-05-12_02-00-00" }
    };
    await routeApiEndpoint(page, "/vibe64/sessions", route => fulfillJson(route, {
      ok: true, sessions: [{ ...directChatSessionPayload, workspaceSetup: { status: "unconfigured" } }, other],
      limits: { openSessionCount: 2 }, creation: { canCreate: true, mode: "direct" }
    }));
    await routeApiEndpoint(page, "/vibe64/sessions/current", route => fulfillJson(route, { ok: true,
      sessionId: route.request().method() === "PUT" ? route.request().postDataJSON().sessionId : directChatSessionId }));
    await routeApiEndpoint(page, `/vibe64/sessions/${other.sessionId}`, route => fulfillJson(route, other));
    await routeApiEndpoint(page, `/vibe64/sessions/${other.sessionId}/temporary-conversations`,
      route => fulfillJson(route, { ok: true, conversations: [] }));
    await routeApiEndpoint(page, `/vibe64/sessions/${other.sessionId}/ai-tasks`,
      route => fulfillJson(route, { ok: true, tasks: [], viewerId: "" }));
    await openFix(page, shared.server, () => page.locator(`[data-vibe64-session-id="${directChatSessionId}"]:visible`).click());
    await expectPhase(page, "working");
    await taskWindow(page).getByRole("tab", { name: "Chat" }).click();
    const input = taskWindow(page).getByRole("textbox", { name: "Message the AI" });
    const saved = page.waitForResponse(response => response.request().method() === "PATCH" && response.url().includes("/temporary-conversations/"));
    await input.fill("Preserve this reply for the original session.");
    await saved;
    await page.keyboard.press("Escape");
    await page.locator(`[data-vibe64-session-id="${other.sessionId}"]:visible`).click();
    await expect(page.locator("[data-vibe64-ai-task-tray]")).toHaveCount(0);
    await expect(page.getByText("Preserve this reply for the original session.", { exact: true })).toBeHidden();
    await page.locator(`[data-vibe64-session-id="${directChatSessionId}"]:visible`).click();
    await page.locator("[data-vibe64-ai-task-tray]").click();
    await expect(taskWindow(page)).toBeVisible();
    await taskWindow(page).getByRole("tab", { name: "Chat" }).click();
    await expect(input).toHaveValue("Preserve this reply for the original session.");
    expect(shared.server.temporary!.captured.temporaryCreates).toHaveLength(1);
  });

  test("the task chat queues several files for a reply and keeps its draft", async ({ page }) => {
    const release = Promise.withResolvers<void>();
    const received: string[] = [];
    const names = ["bookings.HTML", "customers.csv", "pricing.js"];
    await aiTaskWorld(page, shared.server);
    await routeApiEndpoint(page, `/vibe64/sessions/${directChatSessionId}/agent-attachments`, async route => {
      const form = await new globalThis.Response(route.request().postDataBuffer(), {
        headers: { "Content-Type": route.request().headers()["content-type"] }
      }).formData();
      const file = form.get("file") as File;
      received.push(file.name);
      if (received.length === 1) await release.promise;
      await fulfillJson(route, { ok: true, attachmentId: `attachment-${received.length}`, fileName: file.name,
        path: `/tmp/vibe64-attachments/${file.name}`, size: file.size });
    });
    try {
      const taskId = await openFix(page, shared.server);
      await endTurn(shared.server, taskId, "question", "Which price table should stay?");
      await expectPhase(page, "needs_you", "question");
      const window = taskWindow(page);
      await window.locator("[data-vibe64-ai-task-action='answer']").click();
      const input = window.getByRole("textbox", { name: "Message the AI" });
      const send = window.getByRole("button", { name: "Send message", exact: true });
      await input.fill("These are the files.");
      const chooser = page.waitForEvent("filechooser");
      await window.getByRole("button", { name: "Attach files", exact: true }).click();
      await (await chooser).setFiles(names.map(name => ({ name, mimeType: "text/plain", buffer: Buffer.from(`Contents of ${name}`) })));
      const queue = window.getByRole("region", { name: "Message attachments" });
      await expect(queue.locator(".assistant-attachment-queue__item")).toHaveCount(3);
      await expect.poll(() => received.length).toBe(1);
      await expect(send).toBeDisabled();
      release.resolve();
      await expect(queue.locator(".assistant-attachment-queue__item--ready")).toHaveCount(3);
      await expect(send).toBeEnabled();
      // The draft keeps its text, and each file adds its reference after it.
      await expect(input).toHaveValue(/^These are the files\.\s+\[File #1\]\s+\[File #2\]\s+\[File #3\]\s*$/u);
      expect(received).toEqual(names);
      await expectNoSidewaysScroll(page);
      // Send carries every file with the reply.
      const { captured } = shared.server.temporary!;
      const sent = captured.temporaryTurns.length;
      await send.click();
      await expect.poll(() => captured.temporaryTurns.length).toBe(sent + 1);
      expect((captured.temporaryTurns.at(-1) as Record<string, unknown>).attachmentIds)
        .toEqual(["attachment-1", "attachment-2", "attachment-3"]);
    } finally {
      release.resolve();
    }
  });

  test("a reply that could not start offers Edit and Retry, and Retry resends that reply once", async ({ page }) => {
    const captured = shared.server.temporary!.captured;
    // The person's two sends (turns 2 and 3) fail before reaching the AI; the Retry goes through.
    captured.beforeNativeTurn = async (turn) => {
      if (turn !== 2 && turn !== 3) return;
      throw Object.assign(new Error("Assistant could not start."), {
        code: "conversation_busy", statusCode: 409, delivery: "not-sent"
      });
    };
    await aiTaskWorld(page, shared.server);
    const taskId = await openFix(page, shared.server);
    await endTurn(shared.server, taskId, "question", "Which price table should stay?");
    await expectPhase(page, "needs_you", "question");
    const window = taskWindow(page);
    await window.locator("[data-vibe64-ai-task-action='answer']").click();
    const transcript = window.locator(".assistant-transcript");
    const input = window.getByRole("textbox", { name: "Message the AI" });
    const send = window.getByRole("button", { name: "Send message", exact: true });
    await input.fill("Keep the newer one.");
    await send.click();
    await expect(transcript.getByRole("button", { name: "Cancel", exact: true })).toBeVisible();
    await transcript.getByRole("button", { name: "Edit", exact: true }).click();
    await expect(input).toHaveValue("Keep the newer one.");
    await expect(transcript.getByRole("button", { name: "Retry", exact: true })).toHaveCount(0);
    await send.click();
    await expect(transcript.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
    await input.fill("A newer draft.");
    await transcript.getByRole("button", { name: "Retry", exact: true }).click();
    await expect.poll(() => captured.temporaryTurns.length).toBe(4);
    await expect(transcript.getByRole("button", { name: "Retry", exact: true })).toHaveCount(0);
    await expect(input).toHaveValue("A newer draft.");
    const [, , failed, retry] = captured.temporaryTurns as Array<Record<string, any>>;
    expect(retry.messageId).toBe(failed.messageId);
    expect(retry.displayMessage).toBe("Keep the newer one.");
    expect(retry.presentation.draft).toBe("A newer draft.");
  });

  test("a chat of an AI task never appears as a temporary chat", async ({ page }) => {
    await aiTaskWorld(page, shared.server);
    await openFix(page, shared.server);
    await expectPhase(page, "working");
    await expect(page.getByRole("region", { name: "Temporary AI workspace" })).toHaveCount(0);
  });
});
