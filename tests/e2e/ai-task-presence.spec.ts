import { expect, test, type Page } from "@playwright/test";
import { temporaryConversationId } from "@local/vibe64-sessions/shared/conversation";
import { DASHBOARD_PATH, WORKSPACE_SLUG } from "./support/base-shell-data";
import { assistantStatusServer } from "./support/assistant-status-server";
import { quietWorld, taskWindow } from "./support/ai-task-world";
import { suppressAiOnboarding } from "./support/suppressAiOnboarding";

for (const engineId of ["codex", "opencode"]) {
  test(`${engineId} typing in an AI task's chat reaches the other tabs and stays in that task`, async ({ browser }, info) => {
    const server = await assistantStatusServer({ temporaryEngineId: engineId });
    server.temporary!.captured.nativeTurn = () => ({ status: "inProgress" });
    Object.assign(server.state.session, { assistantSelection: { engineId } });
    const context = await browser.newContext();
    // AI onboarding would otherwise cover the window in this fixture.
    await suppressAiOnboarding(context);
    const pages = [await context.newPage(), await context.newPage()];
    const presence: Record<string, unknown>[] = [];
    const pageErrors: string[] = [];
    const composer = (page: Page) => taskWindow(page).getByRole("textbox", { name: "Message the AI" });
    const typing = (page: Page) => taskWindow(page).getByText("John is typing…", { exact: true });
    try {
      const { task } = await server.aiTasks.start("free", { message: "Look at the failing build." });
      // Typing shows once the AI's turn has ended: while it works, the chat says so instead.
      const { captured } = server.temporary!;
      await expect.poll(() => [captured.temporaryTurns.length, captured.startedTurns]).toEqual([1, 1]);
      await server.temporary!.endNativeTurn(task.id, { text: "The build fails in lint.", message: "The build fails in lint." });
      await server.aiTasks.settled();
      const openChat = async (page: Page) => {
        await page.goto(`${server.url}${DASHBOARD_PATH}/repository?aiTask=${encodeURIComponent(task.id)}`);
        await taskWindow(page).getByRole("tab", { name: "Chat" }).click();
        await expect(composer(page)).toBeVisible();
      };
      for (const [index, page] of pages.entries()) {
        page.on("pageerror", (error) => pageErrors.push(error.message));
        await quietWorld(page, server);
        await page.route("**/presence", async (route) => {
          const body = route.request().postDataJSON();
          presence.push(body);
          server.presence({
            ...body,
            actorId: `member-${index}`, displayName: index === 0 ? "John" : "Mary",
            projectSlug: WORKSPACE_SLUG, sessionId: server.state.session.sessionId,
            updatedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3000).toISOString()
          });
          await route.fulfill({ json: { ok: true } });
        });
        await openChat(page);
      }

      const [writer, reader] = pages;
      for (const width of [390, 960, 1600]) {
        await reader.setViewportSize({ width, height: 900 });
        await composer(writer).fill(`Question at ${width}px`);
        await expect(typing(reader)).toBeVisible();
        await expect(typing(writer)).toHaveCount(0);
        await reader.screenshot({ path: info.outputPath(`typing-${width}.png`) });
        expect(await reader.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      }

      // Hiding the window leaves nothing about the task's typing on the page.
      await taskWindow(reader).getByRole("button", { name: "Hide", exact: true }).click();
      await expect(taskWindow(reader)).toHaveCount(0);
      await expect(reader.getByText("John is typing…", { exact: true })).toHaveCount(0);

      // Coming back receives the next heartbeat, without copying draft text.
      await openChat(reader);
      await composer(writer).fill("Ready to send");
      await expect(typing(reader)).toBeVisible();
      await taskWindow(writer).getByRole("button", { name: /^(Send message|Steer assistant)$/ }).click();
      await expect(typing(reader)).toHaveCount(0);
      // Typing presence expires by itself; the client sends no "stopped typing" request.
      expect(presence.some((entry) => entry.conversationId === task.id && entry.typing === true)).toBe(true);
      expect(presence.every((entry) => !Object.hasOwn(entry, "draft"))).toBe(true);
      expect(pageErrors).toEqual([]);
      const id = temporaryConversationId({ projectSlug: WORKSPACE_SLUG, sessionId: server.state.session.sessionId, conversationId: task.id });
      const canonical = `/api/assistant/app/conversations/${encodeURIComponent(id)}`;
      expect(server.state.requests.filter(request => request === `POST ${canonical}/messages`)).toHaveLength(1);
      expect(server.state.subscriptions).toContain(id);
    } finally {
      await context.close();
      await server.close();
    }
  });
}
