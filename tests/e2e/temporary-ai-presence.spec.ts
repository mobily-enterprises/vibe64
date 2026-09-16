import { expect, test, type Page } from "@playwright/test";
import { DASHBOARD_PATH, WORKSPACE_SLUG } from "./support/base-shell-data";
import { assistantStatusServer } from "./support/assistant-status-server";

for (const engineId of ["codex", "opencode"]) {
  test(`${engineId} temporary typing stays in its conversation across browser tabs`, async ({ browser }, info) => {
    const server = await assistantStatusServer();
    server.state.session.agentSession.turn.active = false;
    Object.assign(server.state.session, { assistantSelection: { engineId } });
    const context = await browser.newContext();
    const pages = [await context.newPage(), await context.newPage()];
    const presence: Record<string, unknown>[] = [];
    const pageErrors: string[] = [];
    const chats = ["one", "two"].map((conversationId) => ({
      conversationId, title: `Chat ${conversationId}`, status: "ready", state: "open",
      draft: "", messages: [], attachments: [], agentSettings: {}
    }));
    const workspace = (page: Page) => page.getByRole("region", { name: "Temporary AI workspace" });
    const composer = (page: Page) => workspace(page).getByRole("textbox", { name: "Message temporary AI" });
    const typing = (page: Page) => workspace(page).locator("[data-assistant-composer-support]")
      .filter({ hasText: "John is typing…" });
    try {
      for (const [index, page] of pages.entries()) {
        page.on("pageerror", (error) => pageErrors.push(error.message));
        await page.route("**/agent-goal", (route) => route.fulfill({ json: { ok: true, status: "unsupported" } }));
        await page.route("**/agent-plan-usage", (route) => route.fulfill({ json: { ok: true, status: "unsupported" } }));
        await page.route(/\/assistants\/capabilities(?:\?|$)/u, (route) => route.fulfill({ json: { ok: true, engines: [] } }));
        await page.route("**/temporary-conversations**", async (route) => {
          const request = route.request();
          const pathname = new URL(request.url()).pathname;
          if (request.method() === "GET") {
            await route.fulfill({ json: { ok: true, conversations: chats } });
          } else if (pathname.endsWith("/turns")) {
            await route.fulfill({ json: { ok: true, runId: "sent", status: "completed" } });
          } else {
            await route.fulfill({ json: { ok: true } });
          }
        });
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
        await page.goto(`${server.url}${DASHBOARD_PATH}/env`);
        await expect(composer(page)).toBeVisible();
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

      await workspace(reader).getByRole("button", { name: "Chat two", exact: true }).click();
      await composer(writer).fill("Still in the first chat");
      await expect(typing(reader)).toHaveCount(0);
      await workspace(reader).getByRole("button", { name: "Main chat", exact: true }).click();
      await expect(reader.getByText("John is typing…", { exact: true })).toHaveCount(0);

      // Returning to the saved chat receives the next heartbeat, without copying draft text.
      await reader.reload();
      await expect(composer(reader)).toBeVisible();
      await composer(writer).fill("Ready to send");
      await expect(typing(reader)).toBeVisible();
      await workspace(writer).getByRole("button", { name: "Send to temporary AI" }).click();
      await expect(typing(reader)).toHaveCount(0);
      await composer(writer).fill("Close this conversation");
      await expect(typing(reader)).toBeVisible();
      await workspace(writer).getByRole("button", { name: "Close Chat one", exact: true }).click();
      await expect(typing(reader)).toHaveCount(0);
      expect(presence.some((entry) => entry.conversationId === "one" && entry.typing === true)).toBe(true);
      expect(presence.some((entry) => entry.conversationId === "one" && entry.typing === false)).toBe(true);
      expect(presence.every((entry) => !Object.hasOwn(entry, "draft"))).toBe(true);
      expect(pageErrors).toEqual([]);
    } finally {
      await context.close();
      await server.close();
    }
  });
}
