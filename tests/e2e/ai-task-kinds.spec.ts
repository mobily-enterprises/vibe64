import { expect, test, type Page } from "@playwright/test";
import { DASHBOARD_PATH } from "./support/base-shell-data";
import { assistantStatusServer } from "./support/assistant-status-server";
import {
  endTurn, expectPhase, openFix, openStarted, quietWorld, saveTaskWorld, taskIdOf, taskWindow, workspaceSetupWorld
} from "./support/ai-task-world";

type StatusServer = Awaited<ReturnType<typeof assistantStatusServer>>;

async function openNewAiTask(page: Page) {
  // A phone shows the project first; the header is in the chat. The header settles its actions after it
  // measures: New AI task is inline, or in Session actions.
  const inline = page.locator("[data-vibe64-header-action=new-ai-task]");
  const menu = page.getByRole("button", { name: /^Session actions(?::|$)/u });
  const showChat = page.getByRole("button", { name: "Show chat", exact: true });
  await expect(inline.or(menu).or(showChat).first()).toBeVisible();
  if (await showChat.isVisible()) await showChat.click();
  await expect(inline.or(menu).first()).toBeVisible();
  if (!(await inline.isVisible())) await menu.click();
  await page.locator("[data-vibe64-new-ai-task-action]:visible").first().click();
}

const INCOMING_REVIEW = { repository: "example/library", targetBranch: "main", targetHead: "a".repeat(40), id: "contribution-1",
  activeHead: "b".repeat(40), discardedHead: "" };

/**
 * Every kind of AI task, end to end once: it opens from its own notice with its problem, the AI finishes,
 * Vibe64 proves it, and Close ends it. Update's full matrix is in ai-task-window.spec.ts. A kind whose notice
 * this page doesn't draw starts as its notice would; its notice's own spec proves what that sends.
 */
const KINDS: {
  kind: string;
  world: (page: Page, server: StatusServer) => Promise<unknown>;
  open?: (page: Page, server: StatusServer) => Promise<string>;
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
  },
  {
    kind: "workspace-setup",
    world: (page, server) => workspaceSetupWorld(page, server),
    problem: "npm ci failed: ERESOLVE could not resolve the dependency tree.",
    done: "Workspace preparation succeeded.",
    proof(server, taskId) {
      expect(server.aiTasks.setups).toEqual([expect.objectContaining({ aiTaskId: taskId })]);
    }
  },
  {
    kind: "preview-identity",
    world: (page, server) => quietWorld(page, server),
    open: (page, server) => openStarted(page, server, "preview-identity", {
      error: "User not found.", identity: { name: "missing", type: "email", value: "missing@example.com" }
    }),
    problem: "Preview couldn't sign in as missing.",
    done: "Preview accepts missing now. Choose it again to sign in.",
    proof(server) {
      expect(server.aiTasks.signIns).toEqual([{ identityName: "missing" }]);
    }
  },
  {
    kind: "incoming-merge",
    world: (page, server) => quietWorld(page, server),
    open: (page, server) => openStarted(page, server, "incoming-merge", { review: INCOMING_REVIEW, conflictPaths: ["shared.txt"] }),
    problem: "This contribution conflicts with main in 1 file.",
    done: "The repaired merge is ready for your review. Check it, then choose Merge into main.",
    proof(server, taskId) {
      expect(server.aiTasks.incoming).toEqual([expect.objectContaining({ action: "review-repair", aiTaskId: taskId, review: INCOMING_REVIEW })]);
    }
  },
  {
    kind: "project-setup",
    async world(page, server) {
      // The setup screen's first read needs attention; the check's read finds it ready.
      const reads = [{ ok: true, inspection: { state: "attention", nextAction: "repair", diagnostics: [{ message: "Stack is missing Connected development." }] } }];
      server.aiTasks.onboarding = async () => reads.shift() || { ok: true, inspection: { state: "ready", diagnostics: [] } };
      return quietWorld(page, server);
    },
    open: (page, server) => openStarted(page, server, "project-setup", { mode: "repair" }),
    problem: "Stack is missing Connected development.",
    done: "Project setup is ready.",
    proof() {}
  },
  {
    kind: "database-overview",
    async world(page, server) {
      // The request's read finds no overview yet; the check's read finds it saved and valid.
      const missing = { ok: true, overview: { present: false, hash: "", error: "" },
        coverage: { unreviewed: ["orders"], missing: [], missingRelationships: [] }, schema: { tables: [{ qualifiedName: "public.orders", reference: "orders" }] } };
      const valid = { ...missing, overview: { present: true, hash: "h1", error: "" }, coverage: { unreviewed: [], missing: [], missingRelationships: [] } };
      const reads = [missing];
      server.aiTasks.overview = async () => reads.shift() || valid;
      return quietWorld(page, server);
    },
    open: (page, server) => openStarted(page, server, "database-overview", { abstraction: "balanced", scope: "all" }),
    problem: "Regenerate the data overview: Balanced.",
    done: "The data overview is valid.",
    proof(server) {
      expect(server.aiTasks.overviewReads).toBe(2);
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
        const taskId = await (row.open || openFix)(page, shared.server);
        await expectPhase(page, "working");
        const window = taskWindow(page);
        await expect(window.getByText(row.problem).first()).toBeVisible();
        await expect(window.locator("[data-vibe64-ai-task-rename]"), "only a New AI task can be renamed").toHaveCount(0);
        await endTurn(shared.server, taskId, "complete", "Repaired it.");
        await expectPhase(page, "done");
        await expect(window.getByText(row.done)).toBeVisible();
        row.proof(shared.server, taskId);
        await window.locator("[data-vibe64-ai-task-close]").click();
        await expect(window).toHaveCount(0);
      });
    }

    test("free: New AI task starts the person's request, and the person's Finish ends it Done", async ({ page }) => {
      await quietWorld(page, shared.server);
      await page.goto(`${shared.server.url}${DASHBOARD_PATH}/repository`);
      await openNewAiTask(page);
      const form = page.locator("[data-vibe64-new-ai-task]");
      await form.getByLabel("What should the AI do?").fill("Tidy the README.");
      await form.getByRole("button", { name: "Start", exact: true }).click();
      await expect(form).toHaveCount(0);
      await expectPhase(page, "working");
      const window = taskWindow(page);
      await expect(window.getByText("Tidy the README.").first()).toBeVisible();
      // A person's own request has no schema: the AI's turn just ends, and the person decides.
      const { captured } = shared.server.temporary!;
      await expect.poll(() => captured.startedTurns).toBe(captured.temporaryTurns.length);
      await shared.server.temporary!.endNativeTurn(taskIdOf(page), { text: "Tidied it.", message: "Tidied it." });
      await shared.server.aiTasks.settled();
      await expectPhase(page, "needs_you", "your_turn");
      await window.getByRole("button", { name: "Finish", exact: true }).click();
      await expectPhase(page, "done");
      await expect(window.getByText("You finished this task.")).toBeVisible();
      await window.locator("[data-vibe64-ai-task-close]").click();
      await expect(window).toHaveCount(0);
    });

    test("free: Rename names the task in every tab while the AI works, and a reload keeps the name", async ({ page }) => {
      await quietWorld(page, shared.server);
      await openStarted(page, shared.server, "free", { message: "Tidy the README." });
      await expectPhase(page, "working");
      const { captured } = shared.server.temporary!;
      await expect.poll(() => captured.startedTurns).toBe(captured.temporaryTurns.length);
      const turns = captured.temporaryTurns.length;
      const title = (target: Page) => taskWindow(target).getByRole("heading", { level: 2 });
      const window = taskWindow(page);
      const dialog = page.locator("[data-vibe64-ai-task-rename-dialog]");
      const field = dialog.getByLabel("Task name");
      const other = await page.context().newPage();
      try {
        await quietWorld(other, shared.server);
        await other.goto(page.url());
        await expect(title(other)).toHaveText("AI task");

        const pencil = window.getByRole("button", { name: "Rename AI task", exact: true });
        if (viewport.width < 600) {
          const box = await pencil.boundingBox();
          expect(Math.min(box!.width, box!.height)).toBeGreaterThanOrEqual(48);
        }
        // Escape keeps the name, and leaves the task's window open.
        await pencil.click();
        await expect(field).toHaveValue("AI task");
        await field.fill("Something else");
        await page.keyboard.press("Escape");
        await expect(dialog).toBeHidden();
        await expect(title(page)).toHaveText("AI task");
        await expect(window).toBeVisible();

        // Enter saves it on one line, and every open tab and the tray follow.
        await pencil.click();
        await field.fill("README   tidy-up");
        await field.press("Enter");
        await expect(title(page)).toHaveText("README tidy-up");
        await expect(title(other)).toHaveText("README tidy-up");
        await expect(page.locator("[data-vibe64-ai-task-tray]")).toHaveAttribute("aria-label", /^README tidy-up: /u);
        await expectPhase(page, "working");
        expect(captured.temporaryTurns.length, "a name sends nothing to the AI").toBe(turns);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

        await page.reload();
        await expect(title(page)).toHaveText("README tidy-up");

        // An empty name gives back the usual one.
        await window.getByRole("button", { name: "Rename README tidy-up", exact: true }).click();
        await field.fill("");
        await dialog.getByRole("button", { name: "Rename", exact: true }).click();
        await expect(title(page)).toHaveText("AI task");
        await expect(title(other)).toHaveText("AI task");
      } finally {
        await other.close();
      }
    });
  });
}
