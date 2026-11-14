import { expect, test } from "@playwright/test";
import { DASHBOARD_PATH } from "./support/base-shell-data";
import { assistantStatusServer } from "./support/assistant-status-server";
import { suppressAiOnboarding } from "./support/suppressAiOnboarding";

// A dropped connection, its reconnect and a reload are browser events, and none of them may stop a
// temporary chat's running turn: only Stop, Cancel, closing the chat or a server shutdown end it.
for (const engineId of ["codex", "opencode"] as const) {
  test(`${engineId} temporary chat keeps its running turn through a dropped connection and a reload`, async ({ page, context }, info) => {
    const server = await assistantStatusServer({ temporaryEngineId: engineId });
    const captured = server.temporary!.captured;
    // The AI is still working on the message when the browser loses it.
    captured.nativeTurn = () => ({ status: "inProgress" });
    server.state.session.agentSession.turn.active = false;
    Object.assign(server.state.session, { assistantSelection: { engineId } });
    await suppressAiOnboarding(page);
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    const workspace = page.getByRole("region", { name: "Temporary AI workspace" });
    const composer = workspace.getByRole("textbox", { name: "Message temporary AI" });
    const working = workspace.getByLabel("Assistant working");
    const openTemporaryAi = async () => {
      await page.getByRole("button", { name: "Open temporary AI", exact: true }).click();
      await expect(composer).toBeVisible();
    };
    try {
      await server.temporary!.seed([{ conversationId: "reasoning", title: "Reasoning", draft: "", agentSettings: {} }]);
      await page.route("**/agent-goal", (route) => route.fulfill({ json: { ok: true, status: "unsupported" } }));
      await page.route("**/agent-plan-usage", (route) => route.fulfill({ json: { ok: true, status: "unsupported" } }));
      await page.route(/\/assistants\/capabilities(?:\?|$)/u, (route) => route.fulfill({ json: { ok: true, engines: [] } }));
      await page.route("**/presence", (route) => route.fulfill({ json: { ok: true } }));
      await page.goto(`${server.url}${DASHBOARD_PATH}/env`);
      await openTemporaryAi();
      await composer.fill("Think it through.");
      await workspace.getByRole("button", { name: /^(Send message|Steer assistant)$/u }).click();
      await expect.poll(() => captured.temporaryTurns.length).toBe(1);
      await expect(working).toBeVisible();

      // The connection drops while the AI works, and the AI goes on; when the connection
      // returns, the chat shows the turn still running with what the AI said meanwhile.
      await context.setOffline(true);
      server.disconnect();
      await expect.poll(() => server.connectionCount()).toBe(0);
      await server.temporary!.say("reasoning", "Reading the schema first.");
      await context.setOffline(false);
      // Socket.IO retries on its own backoff, up to a few seconds after going back online.
      await expect.poll(() => server.connectionCount(), { timeout: 20_000 }).toBe(1);
      await expect(working).toBeVisible();
      await expect(workspace.getByText("Reading the schema first.", { exact: true })).toBeVisible({ timeout: 15_000 });

      // A reload finds the same turn still running.
      await page.reload();
      await openTemporaryAi();
      await expect(working).toBeVisible();
      await expect(workspace.getByText("Reading the schema first.", { exact: true })).toBeVisible();

      // That turn finishes, and its answer reaches the chat.
      await server.temporary!.endNativeTurn("reasoning", { text: "Both are fine.", message: "Both are fine." });
      await expect(workspace.getByText("Both are fine.", { exact: true })).toBeVisible();
      await expect(working).toHaveCount(0);
      await page.screenshot({ path: info.outputPath("finished.png") });
      expect(captured.temporaryTurns).toHaveLength(1);
      expect(captured.nativeStops).toBe(0);
      expect(captured.nativeDeletes).toBe(0);
      expect(captured.temporaryDeletes).toBe(0);
      // The page itself asked for no Stop and no Close.
      expect(server.state.requests.filter((request) => /^(?:POST .*\/temporary-conversations\/reasoning\/stop|DELETE .*\/temporary-conversations\/reasoning)$/u
        .test(request))).toEqual([]);
      expect(pageErrors).toEqual([]);
    } finally {
      await server.close();
    }
  });
}
