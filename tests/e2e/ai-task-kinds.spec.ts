import { expect, test, type Page } from "@playwright/test";
import { assistantStatusServer } from "./support/assistant-status-server";
import { endTurn, expectPhase, openFix, saveTaskWorld, taskWindow } from "./support/ai-task-world";

type StatusServer = Awaited<ReturnType<typeof assistantStatusServer>>;

/**
 * Every kind of AI task, end to end once: it opens from its own notice with its problem, the AI finishes,
 * Vibe64 proves it, and Close ends it. Update's full matrix is in ai-task-window.spec.ts.
 */
const KINDS: {
  kind: string;
  world: (page: Page, server: StatusServer) => Promise<unknown>;
  problem: string;
  done: string;
  proof: (server: StatusServer, taskId: string) => void;
}[] = [
  {
    kind: "save",
    world: (page, server) => saveTaskWorld(page, server),
    problem: "The pre-commit hook failed: lint found 2 errors.",
    done: "Session saved. Your work was pushed.",
    proof(server, taskId) {
      expect(server.aiTasks.saves).toHaveLength(1);
      expect(server.aiTasks.saves[0]).toMatchObject({ aiTaskId: taskId, destinationReview: { mode: "local" } });
    }
  }
];

for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
  test.describe(`each kind at ${viewport.width}x${viewport.height}`, () => {
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

    for (const row of KINDS) {
      test(`${row.kind}: opens from its notice and ends Done once Vibe64 proves it`, async ({ page }) => {
        await row.world(page, shared.server);
        const taskId = await openFix(page, shared.server);
        await expectPhase(page, "working");
        const window = taskWindow(page);
        await expect(window.getByText(row.problem).first()).toBeVisible();
        await endTurn(shared.server, taskId, "complete", "Repaired it.");
        await expectPhase(page, "done");
        await expect(window.getByText(row.done)).toBeVisible();
        row.proof(shared.server, taskId);
        await window.locator("[data-vibe64-ai-task-close]").click();
        await expect(window).toHaveCount(0);
      });
    }
  });
}
