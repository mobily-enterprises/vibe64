import { expect, test, type Page } from "@playwright/test";
import { DEVELOPMENT_PATH } from "./support/base-shell-data";
import { fulfillJson } from "./support/base-shell/http";
import { assistantStatusServer } from "./support/assistant-status-server";
import { expectSteady } from "./support/settled-ui";
import { expectPhase, quietWorld, taskIdOf, taskWindow } from "./support/ai-task-world";

type StatusServer = Awaited<ReturnType<typeof assistantStatusServer>>;

const ATTENTION = {
  ok: true,
  available: true,
  inspection: {
    state: "attention",
    nextAction: "repair",
    diagnostics: [{ code: "PROGRAM_SOURCE_MISSING", message: "Program module cites a missing or ineligible source file: src/shared/report.js." }]
  },
  templates: []
};

/** Preview shows Project setup's notice; the task's own reads see the same setup. */
async function setupWorld(page: Page, server: StatusServer) {
  server.aiTasks.onboarding = async () => ATTENTION;
  await quietWorld(page, server);
  await page.route("**/vibe64/onboarding?*", route => fulfillJson(route, ATTENTION));
}

const windowShown = (page: Page) => taskWindow(page).isVisible();

for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
  test.describe(`Project setup's notice in Preview at ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport, hasTouch: viewport.width < 600 });
    const shared = {} as { server: StatusServer; pageErrors: string[] };
    test.beforeEach(async ({ page }) => {
      shared.server = await assistantStatusServer({ temporaryEngineId: "codex" });
      shared.server.temporary!.captured.nativeTurn = () => ({ status: "inProgress" });
      shared.pageErrors = [];
      page.on("pageerror", error => shared.pageErrors.push(error.message));
    });
    test.afterEach(async ({ page }, testInfo) => {
      if (!page.isClosed()) await page.screenshot({ path: testInfo.outputPath("final.png") }).catch(() => {});
      await shared.server.close();
      expect(shared.pageErrors).toEqual([]);
    });

    /** The notice's AI task button, on a phone once the project side is shown. */
    async function noticeButton(page: Page) {
      await page.goto(`${shared.server.url}${DEVELOPMENT_PATH}`);
      if (viewport.width < 600) await page.getByRole("button", { name: "Show project", exact: true }).click();
      return page.locator(".project-preview__warning [data-vibe64-ai-task-button]");
    }

    test("Being fixed opens the running task's window, and it stays open", async ({ page }) => {
      await setupWorld(page, shared.server);
      const { task } = await shared.server.aiTasks.start("project-setup", { mode: "repair" });
      const button = await noticeButton(page);
      await expect(button).toHaveText(/Being fixed/u);
      await button.click();
      await expect(taskWindow(page)).toBeVisible();
      await expectSteady(() => windowShown(page), true, 1500);
      expect(taskIdOf(page)).toBe(task.id);
      await expectPhase(page, "working");
    });

    test("Fix it with AI starts the task, and its window stays open", async ({ page }) => {
      await setupWorld(page, shared.server);
      const button = await noticeButton(page);
      await expect(button).toHaveText(/Fix it with AI/u);
      await button.click();
      await expect(taskWindow(page)).toBeVisible();
      await expectSteady(() => windowShown(page), true, 1500);
      expect(taskIdOf(page)).not.toBe("");
      await expectPhase(page, "working");
    });
  });
}
