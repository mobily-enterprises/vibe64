import { expect, test, type Page } from "@playwright/test";
import { DASHBOARD_PATH, viewports } from "./support/base-shell-data";
import { assistantStatusServer, json } from "./support/assistant-status-server";

let server: Awaited<ReturnType<typeof assistantStatusServer>>;
let pageErrors: string[];
test.beforeEach(async ({ page }) => {
  server = await assistantStatusServer();
  pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
});
test.afterEach(async ({ page }, info) => {
  if (!page.isClosed()) {
    await page.screenshot({ path: info.outputPath("final.png"), fullPage: true });
  }
  await info.attach("requests", { body: JSON.stringify({
    checks: server.state.checkCount, details: server.state.detailCount,
    checkTimes: server.state.checkTimes, requests: server.state.requests,
    unexpectedRequests: server.state.unexpectedRequests,
    messages: server.state.messages, interrupts: server.state.interrupts,
    pageErrors
  }, null, 2), contentType: "application/json" });
  await server.close();
  expect(pageErrors).toEqual([]);
  expect(server.state.unexpectedRequests).toEqual([]);
});

const warning = (page: Page) => page.getByText("Assistant status could not be verified.", { exact: true }).first();
const steer = (page: Page) => page.getByRole("button", { name: "Steer assistant" });
const composer = (page: Page) => page.getByLabel("Message AI assistant");
const busy = (response) => json(response, { ok: false, code: "vibe64_agent_write_mode_busy", error: "Another assistant operation is starting.", retryable: true });

async function openChat(page: Page) {
  await page.goto(`${server.url}${DASHBOARD_PATH}/env`);
  await expect(composer(page)).toBeVisible();
}

test("healthy assistant can receive steering in the built client", async ({ page }) => {
  await page.goto(`${server.url}${DASHBOARD_PATH}/env`);
  await expect(page.getByLabel("Message AI assistant")).toBeVisible();
  await expect(page.getByRole("button", { name: "Starred files (0)", exact: true })).toHaveText("0");
  await page.getByLabel("Message AI assistant").fill("Preserve my work.");
  await expect(page.getByRole("button", { name: "Steer assistant" })).toBeEnabled();
  await page.getByRole("button", { name: "Steer assistant" }).click();
  await expect.poll(() => server.state.messages.length).toBe(1);
  expect(server.state.messages[0].message).toBe("Preserve my work.");
  await expect(page.getByLabel("Message AI assistant")).toHaveValue("");
});

test("long goal keeps Pause and full-goal Close visible on small screens", async ({ page }, info) => {
  Object.assign(server.state.session, { assistantSelection: { engineId: "codex" } });
  const objective = "Complete the approved customer configuration plan, preserving existing work and checking each stage. ".repeat(45);
  const actions: Record<string, unknown>[] = [];
  const goal = { threadId: "thread-long-goal", status: "active", objective, createdAt: 20, timeUsedSeconds: 390 };
  await page.route("**/agent-goal", async (route) => {
    if (route.request().method() === "POST") {
      const action = route.request().postDataJSON();
      actions.push(action);
      goal.status = action.action === "pause" ? "paused" : "active";
    }
    await route.fulfill({ json: { ok: true, status: "available", goal } });
  });
  await page.route("**/agent-plan-usage", (route) => route.fulfill({ json: { ok: true, status: "unsupported" } }));
  await page.route(/\/assistants\/capabilities(?:\?|$)/u, (route) => route.fulfill({ json: { ok: true, engines: [] } }));
  await page.route("**/temporary-conversations", (route) => route.fulfill({ json: { ok: true, conversations: [] } }));
  await openChat(page);
  for (const viewport of [{ width: 320, height: 640 }, { width: 390, height: 420 }, { width: 768, height: 1024 }, { width: 1280, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.getByRole("button", { name: "Goal running", exact: true }).click();
    const pause = page.getByRole("button", { name: "Pause goal", exact: true });
    const full = page.getByRole("button", { name: "View full goal", exact: true });
    await expect(pause).toBeInViewport({ ratio: 1 });
    await expect(full).toBeInViewport({ ratio: 1 });
    await expect(page.locator(".assistant-goal__details")).not.toContainText(objective);
    await page.screenshot({ path: info.outputPath(`goal-${viewport.width}x${viewport.height}.png`), animations: "disabled" });
    await full.click();
    const dialog = page.getByRole("dialog", { name: "Full goal", exact: true });
    await expect(dialog).toContainText(objective);
    const close = dialog.getByRole("button", { name: "Close", exact: true });
    await expect(close).toBeInViewport({ ratio: 1 });
    await expect.poll(() => dialog.locator(".v-card-text").evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
    await page.screenshot({ path: info.outputPath(`full-goal-${viewport.width}x${viewport.height}.png`), animations: "disabled" });
    await close.click();
    await expect(dialog).toHaveCount(0);
    if (await pause.isVisible()) await page.keyboard.press("Escape");
  }
  await page.getByRole("button", { name: "Goal running", exact: true }).click();
  await page.getByRole("button", { name: "Pause goal", exact: true }).click();
  await expect(page.getByRole("button", { name: "Resume goal", exact: true })).toBeEnabled();
  expect(actions).toEqual([expect.objectContaining({ action: "pause", objective })]);
});

test("a hung initial session read recovers after its deadline", async ({ page }) => {
  test.setTimeout(90_000);
  server.state.detailHandler = (response) => {
    if (server.state.detailCount > 1) json(response, server.state.session);
  };
  await openChat(page);
  await expect.poll(() => server.state.detailCount).toBe(1);
  await composer(page).fill("Keep this unsent draft.");
  await expect(steer(page)).toBeEnabled({ timeout: 65_000 });
  await expect(composer(page)).toHaveValue("Keep this unsent draft.");
  expect(server.state.detailCount).toBeGreaterThan(1);
  expect(server.state.interrupts).toBe(0);
});

for (const viewport of viewports) {
  test(`busy status recovers with draft and layout intact at ${viewport.width}px`, async ({ page }, info) => {
    const draft = "Do not lose this draft or send it automatically.";
    await page.setViewportSize(viewport);
    server.state.checks.push(busy, busy);
    await openChat(page);
    await composer(page).fill(draft);
    await expect(warning(page)).toBeVisible();
    await page.screenshot({ path: info.outputPath("busy.png") });
    await expect(page.getByRole("button", { name: "Waiting for the connection to recover" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeEnabled();
    server.progress("The assistant kept working during verification recovery.");
    await expect(page.getByText("The assistant kept working during verification recovery.", { exact: true })).toBeVisible();
    await expect(steer(page)).toBeEnabled();
    await expect(warning(page)).toHaveCount(0);
    await expect(composer(page)).toHaveValue(draft);
    expect(server.state.checkCount).toBe(3);
    expect(server.state.messages).toHaveLength(0);
    expect(server.state.interrupts).toBe(0);
    const bounds = await steer(page).boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath("recovered.png") });
    await steer(page).click();
    await expect.poll(() => server.state.messages.length).toBe(1);
    expect(server.state.messages[0].message).toBe(draft);
    await expect(composer(page)).toHaveValue("");
  });
}

for (const failure of ["http-503", "connection-reset", "invalid-json"]) {
  test(`recovers from ${failure} without reloading`, async ({ page }) => {
    server.state.checks.push(async (response) => {
      if (failure === "http-503") json(response, { ok: false, error: "Temporarily unavailable" }, 503);
      else if (failure === "invalid-json") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end('{"ok":');
      }
      else {
        // Chromium may transparently retry a reused socket closed before any
        // response. Reset mid-body so the failure reaches the application.
        response.writeHead(200, { "content-type": "application/json" });
        response.write('{"ok":');
        await new Promise((resolve) => setTimeout(resolve, 100));
        response.destroy();
      }
    });
    await openChat(page);
    await composer(page).fill("Keep my draft.");
    await expect(warning(page)).toBeVisible();
    await expect(steer(page)).toBeEnabled();
    await expect(composer(page)).toHaveValue("Keep my draft.");
    expect(server.state.checkCount).toBe(2);
    expect(server.state.messages).toHaveLength(0);
  });
}

test("repeated failures back off instead of flooding the server", async ({ page }) => {
  server.state.checks.push(busy, busy, busy, busy);
  await openChat(page);
  await composer(page).fill("Waiting for recovery.");
  await expect(steer(page)).toBeEnabled({ timeout: 25_000 });
  expect(server.state.checkCount).toBe(5);
  for (let index = 1; index < 5; index += 1) {
    expect(server.state.checkTimes[index] - server.state.checkTimes[index - 1]).toBeGreaterThanOrEqual(900 * 2 ** (index - 1));
  }
});

for (const viewport of viewports) {
  test(`normal session loading and reload show no recovery banner at ${viewport.width}px`, async ({ page }, info) => {
    await page.setViewportSize(viewport);
    const draft = "Keep this draft while the assistant loads.";
    for (const [index, load] of ["initial", "reload"].entries()) {
      const release = Promise.withResolvers<void>();
      server.state.checks.push(async (response) => {
        await release.promise;
        json(response, { ok: true });
      });
      try {
        if (load === "initial") await openChat(page);
        else await page.reload();
        await expect.poll(() => server.state.checkCount).toBe(index + 1);
        await expect(page.getByText("Loading assistant…", { exact: true }).first()).toBeVisible();
        await expect(page.locator("[data-vibe64-connection-recovery]")).toHaveCount(0);
        await expect(warning(page)).toHaveCount(0);
        await expect(page.getByRole("button", { name: "Waiting for the assistant to load" })).toBeDisabled();
        await composer(page).fill(draft);
        await expect(composer(page)).toHaveValue(draft);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: info.outputPath(`${load}.png`) });
      } finally {
        release.resolve();
      }
      await expect(steer(page)).toBeEnabled();
      await expect(composer(page)).toHaveValue(draft);
      expect(server.state.messages).toHaveLength(0);
      expect(server.state.interrupts).toBe(0);
    }
  });
}

test("hung provider check times out and a late response cannot undo recovery", async ({ page }) => {
  test.setTimeout(75_000);
  let heldResponse;
  server.state.checks.push((response) => { heldResponse = response; });
  await openChat(page);
  await composer(page).fill("Preserve this through the timeout.");
  await expect(steer(page)).toBeEnabled({ timeout: 55_000 });
  expect(server.state.checkCount).toBe(2);
  expect(heldResponse.destroyed).toBe(true);
  json(heldResponse, { ok: false, error: "Late obsolete failure" });
  await expect(steer(page)).toBeEnabled();
  await expect(warning(page)).toHaveCount(0);
  await expect(composer(page)).toHaveValue("Preserve this through the timeout.");
});

test("reconnect cancels a pending check and recovers once", async ({ page }) => {
  let heldResponse;
  server.state.checks.push((response) => { heldResponse = response; });
  await openChat(page);
  await composer(page).fill("Reconnect without losing this.");
  await expect.poll(() => server.state.checkCount).toBe(1);
  server.disconnect();
  await expect(steer(page)).toBeEnabled();
  expect(server.state.checkCount).toBe(2);
  expect(heldResponse.destroyed).toBe(true);
  await expect(composer(page)).toHaveValue("Reconnect without losing this.");
});

test("offline then online restores steering without a reload", async ({ page, context }) => {
  await openChat(page);
  await composer(page).fill("Survive going offline.");
  await expect(steer(page)).toBeEnabled();
  await context.setOffline(true);
  server.disconnect();
  await expect(page.getByText("Connection lost — assistant status unknown.", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Waiting for the connection to recover" })).toBeDisabled();
  await context.setOffline(false);
  await expect(steer(page)).toBeEnabled();
  await expect(composer(page)).toHaveValue("Survive going offline.");
  expect(server.state.messages).toHaveLength(0);
});

for (const viewport of viewports) {
  test(`server-forced disconnect recovers automatically at ${viewport.width}px`, async ({ page }, info) => {
    await page.setViewportSize(viewport);
    await openChat(page);
    await composer(page).fill("Keep this draft while HTTP still works.");
    await expect(steer(page)).toBeEnabled();
    server.state.rejectConnections = true;
    server.forceDisconnect();
    const banner = page.locator("[data-vibe64-connection-recovery]");
    await expect(banner).toContainText("Connection lost. Reconnecting automatically.");
    const retry = page.getByRole("button", { name: "Reconnect live updates", exact: true });
    await expect(retry).toBeEnabled();
    const bounds = await retry.boundingBox();
    expect(bounds!.width).toBeGreaterThanOrEqual(48);
    expect(bounds!.height).toBeGreaterThanOrEqual(48);
    await expect(page.getByRole("button", { name: "Waiting for the connection to recover" })).toHaveText("Reconnecting…");
    await expect.poll(() => server.state.connectionAttempts).toBeGreaterThanOrEqual(2);
    expect((await page.request.get(`${server.url}/api/vibe64/sessions/${server.state.session.sessionId}`)).ok()).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath("disconnected.png") });
    server.state.rejectConnections = false;
    await expect(steer(page)).toBeEnabled();
    await expect(banner).toHaveCount(0);
    await expect(composer(page)).toHaveValue("Keep this draft while HTTP still works.");
    server.progress("Live updates resumed after the forced disconnect.");
    await expect(page.getByText("Live updates resumed after the forced disconnect.", { exact: true })).toBeVisible();
    expect(server.state.messages).toHaveLength(0);
    expect(server.state.interrupts).toBe(0);
  });
}

for (const control of ["indicator", "banner"]) {
  test(`manual reconnect through the ${control} preserves the draft`, async ({ page }) => {
    await openChat(page);
    await composer(page).fill("Reconnect without sending me.");
    await expect(steer(page)).toBeEnabled();
    server.state.rejectConnections = true;
    server.forceDisconnect();
    await expect(page.locator("[data-vibe64-connection-recovery]")).toBeVisible();
    const button = control === "indicator"
      ? page.getByRole("button", { name: "Reconnect live updates", exact: true })
      : page.locator("[data-vibe64-connection-recovery]").getByRole("button", { name: "Reconnect", exact: true });
    // Keep automatic timers pending so the click has to cause recovery.
    await page.clock.pauseAt(new Date());
    const attempts = server.state.connectionAttempts;
    server.state.rejectConnections = false;
    await button.click();
    await expect.poll(() => server.state.connectionAttempts).toBe(attempts + 1);
    await page.clock.resume();
    await expect(steer(page)).toBeEnabled();
    await expect(composer(page)).toHaveValue("Reconnect without sending me.");
    expect(server.state.messages).toHaveLength(0);
    expect(server.state.interrupts).toBe(0);
  });
}

test("failed display refresh does not invalidate a successful provider check", async ({ page }) => {
  server.state.detailHandler = (response) => {
    if (server.state.detailCount > 1) json(response, { ok: false, error: "Display refresh unavailable" }, 503);
    else json(response, server.state.session);
  };
  await openChat(page);
  await composer(page).fill("The provider is verified.");
  await expect(steer(page)).toBeEnabled();
  await expect.poll(() => server.state.detailCount).toBeGreaterThan(2);
  await expect(steer(page)).toBeEnabled();
  await expect(warning(page)).toHaveCount(0);
  expect(server.state.checkCount).toBe(1);
});

test("Stop remains available while status recovery is pending", async ({ page }) => {
  server.state.checks.push(busy, busy);
  await openChat(page);
  await expect(warning(page)).toBeVisible();
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect.poll(() => server.state.interrupts).toBe(1);
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toHaveCount(0);
  expect(server.state.session.agentSession.turn.active).toBe(false);
});

test("leaving the page cancels retries without interrupting the assistant", async ({ page }) => {
  server.state.checks.push(busy, busy, busy);
  await openChat(page);
  await expect(warning(page)).toBeVisible();
  await page.goto("about:blank");
  const checks = server.state.checkCount;
  await page.waitForTimeout(2_000);
  expect(server.state.checkCount).toBe(checks);
  expect(server.state.interrupts).toBe(0);
});

test("navigation and browser history preserve recovery and the draft", async ({ page }) => {
  await openChat(page);
  await composer(page).fill("Keep this through navigation.");
  await expect(steer(page)).toBeEnabled();
  server.state.checks.push(busy, busy);
  server.disconnect();
  await expect(warning(page)).toBeVisible();
  await page.getByRole("link", { name: "Session info", exact: true }).click();
  await expect(page).toHaveURL(`${server.url}${DASHBOARD_PATH}/session`);
  await page.goBack();
  await expect(page).toHaveURL(`${server.url}${DASHBOARD_PATH}/env`);
  await page.goForward();
  await expect(page).toHaveURL(`${server.url}${DASHBOARD_PATH}/session`);
  await expect(steer(page)).toBeEnabled();
  await expect(composer(page)).toHaveValue("Keep this through navigation.");
  expect(server.state.messages).toHaveLength(0);
  expect(server.state.interrupts).toBe(0);
});

test("two browsers recover independently without sending either draft", async ({ page, browser }) => {
  const otherContext = await browser.newContext();
  const releaseChecks = Promise.withResolvers<void>();
  try {
    const otherPage = await otherContext.newPage();
    otherPage.on("pageerror", (error) => pageErrors.push(error.message));
    await openChat(page);
    await composer(page).fill("First browser draft.");
    await expect(steer(page)).toBeEnabled();
    await openChat(otherPage);
    await composer(otherPage).fill("Second browser draft.");
    await expect(steer(otherPage)).toBeEnabled();
    expect(server.state.checkCount).toBe(2);
    const failAfterBothBrowsersCheck = async (response) => {
      await releaseChecks.promise;
      busy(response);
    };
    server.state.checks.push(failAfterBothBrowsersCheck, failAfterBothBrowsersCheck);
    server.disconnect();
    await expect.poll(() => server.state.checkCount).toBe(4);
    releaseChecks.resolve();
    await Promise.all([expect(warning(page)).toBeVisible(), expect(warning(otherPage)).toBeVisible()]);
    await expect(steer(page)).toBeEnabled();
    await expect(steer(otherPage)).toBeEnabled();
    await expect(composer(page)).toHaveValue("First browser draft.");
    await expect(composer(otherPage)).toHaveValue("Second browser draft.");
    expect(server.state.checkCount).toBe(6);
    expect(server.state.messages).toHaveLength(0);
    expect(server.state.interrupts).toBe(0);
  } finally {
    releaseChecks.resolve();
    await otherContext.close();
  }
});

test("goal steering replies appear immediately, preserve the composer and survive reload", async ({ page }) => {
  await openChat(page);
  const replies = ["I am checking the remaining ownership cases.", "Next I will verify recovery without resending."];
  for (const [index, question] of ["Why are you stuck?", "What happens next?"].entries()) {
    await composer(page).fill(question);
    await expect(steer(page)).toBeEnabled();
    await steer(page).click();
    await expect.poll(() => server.state.messages.length).toBe(index + 1);
    await expect(composer(page)).toHaveValue("");
    await composer(page).fill("Keep my next reply draft.");
    await composer(page).evaluate((element: HTMLTextAreaElement) => {
      element.focus();
      element.setSelectionRange(5, 5);
    });
    const at = new Date().toISOString();
    const turn = {
      turnId: `turn-status-${index + 1}`,
      user: { messageId: server.state.messages[index].messageId, role: "user", text: question, at },
      assistant: { messageId: `native-final-${index}`, role: "assistant", text: replies[index], at },
      commentary: [], thinking: []
    };
    server.state.conversationLog.push(turn);
    server.sessionChanged("assistant-response-bundle", { conversationLogPatch: { type: "upsert-turn", turn } });
    await expect(page.getByText(replies[index], { exact: true })).toBeVisible();
    await expect(composer(page)).toHaveValue("Keep my next reply draft.");
    await expect(composer(page)).toBeFocused();
    expect(await composer(page).evaluate((element: HTMLTextAreaElement) => element.selectionStart)).toBe(5);
    await expect(steer(page)).toBeEnabled();
    await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeEnabled();
  }
  // Native continuation updates execution state separately from the replies.
  server.state.session.agentSession.turn.id = "goal-successor";
  server.publishTurn();
  await expect(steer(page)).toBeEnabled();
  expect(server.state.interrupts).toBe(0);
  await page.reload();
  for (const reply of replies) await expect(page.getByText(reply, { exact: true })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeEnabled();
  await composer(page).fill("Continue with this guidance after reload.");
  await expect(steer(page)).toBeEnabled();
  expect(server.state.messages).toHaveLength(2);
});

for (const provider of ["codex", "opencode"]) {
test(`${provider} continuation groups saved reasoning rows and follows execution state`, async ({ page }) => {
  server.state.session.agentSession.providerId = provider;
  server.state.session.agentSession.transportId = provider === "codex" ? "codex_app_server" : "opencode_server";
  const at = new Date().toISOString();
  server.state.conversationLog = [{
    turnId: "completed-request",
    user: { role: "user", text: "Complete the plan.", at },
    assistant: { role: "assistant", text: "The first stage is complete.", at }
  }];
  const progress = (index: number) => {
    const turn = {
      turnId: `standalone-progress-${index}`,
      thinking: [{ role: "thinking", text: `Reasoning summary ${index}`, at }]
    };
    server.state.conversationLog.push(turn);
    server.sessionChanged("codex-app-server-live-progress", { conversationLogPatch: { type: "upsert-turn", turn } });
  };
  progress(1);
  progress(2);
  progress(3);
  await openChat(page);
  const groups = page.locator(".assistant-progress");
  const summaries = page.locator(".assistant-progress__message");
  await expect(groups).toHaveCount(1);
  await expect(summaries).toHaveText(["Reasoning summary 2", "Reasoning summary 3"]);
  await composer(page).fill("Keep this draft through continuation.");
  await composer(page).evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(5, 9));
  server.state.session.agentSession.turn.id = "next-native-turn";
  server.publishTurn();
  progress(4);
  await expect(groups).toHaveCount(1);
  await expect(summaries).toHaveText(["Reasoning summary 3", "Reasoning summary 4"]);
  await expect(composer(page)).toBeFocused();
  expect(await composer(page).evaluate((element: HTMLTextAreaElement) => [element.selectionStart, element.selectionEnd])).toEqual([5, 9]);
  server.state.session.agentSession.turn.active = false;
  server.publishTurn();
  await expect(summaries).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Show all 4 progress updates" })).toBeVisible();
  server.state.session.agentSession.turn.active = true;
  server.publishTurn();
  await expect(summaries).toHaveText(["Reasoning summary 3", "Reasoning summary 4"]);
  await expect(composer(page)).toHaveValue("Keep this draft through continuation.");
  await page.reload();
  await expect(groups).toHaveCount(1);
  await expect(summaries).toHaveText(["Reasoning summary 3", "Reasoning summary 4"]);
  expect(server.state.interrupts).toBe(0);
  expect(server.state.messages).toHaveLength(0);
});
}
