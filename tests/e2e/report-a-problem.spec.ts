import { readFile } from "node:fs/promises";

import { expect, test, type Page, type Route } from "@playwright/test";

import { BASE_URL, DEVELOPMENT_PATH, directChatSessionId, directChatSessionPayload } from "./support/base-shell-data";
import { mockDirectChatSession } from "./support/base-shell/codex-mocks";
import { fulfillJson, routeApiEndpoint } from "./support/base-shell/http";
import { suppressAiOnboarding } from "./support/suppressAiOnboarding";

// Report a problem in the browser: the Account menu's entry on every page, and a failed AI request's own button, open
// one dialog that gathers a report of the page as it opens (the page, its route, the errors it saw, the session and
// chat it shows), lets the person review all of it, hides secrets they type in the note, and gives it as a file
// (Download) or text (Copy), or sends it when the host delivers reports. What the server puts in a report and what
// it hides is tested through the real collect route in tests/server/problemReportCollect.unit.test.js and
// problemReportMasking.unit.test.js; here the collect and send answers are the page's own fixtures.

const PLANTED_ERROR = "planted browser failure";
const NOTE_SECRET = "hunter2-example-value";

type Collected = Record<string, any>;

/** The report the collect route would give for a request: the server's shape, with the request's own facts. */
function bundleFor(request: Collected) {
  return {
    schema: "vibe64.problem-report.v1",
    reportId: "report-in-browser",
    createdAt: "2026-11-25T10:00:00.000Z",
    window: { from: "2026-11-25T04:00:00.000Z", to: "2026-11-25T10:00:00.000Z" },
    reporter: { username: "local", role: "owner" },
    place: { page: request.page, route: request.route, projectSlug: "example-target-app", sessionId: request.sessionId || "",
      chat: request.chat || null },
    note: "",
    versions: { app: "0.1.83", jskit: "0.2.33", genesis: "1.10.29", node: "v26.5.0", engine: null, host: {} },
    client: request.client,
    server: { crashes: [] },
    session: null,
    host: [],
    chat: request.includeChat ? { kind: "main", id: "", messages: [{ role: "user", text: "Make the bookings page faster." }] } : null,
    masking: { rules: "v1", hidden: 2 }
  };
}

const DELIVERY = {
  label: "Send to the host",
  description: "Sends this report to the people who run this workspace's editor.",
  consents: [{ id: "access", label: "Let the host's team look at this to fix it", description: "Read-only, for 14 days.", default: true }]
};

/** The shell with its session, and the page's collect and send answered by this test. */
async function reportWorld(page: Page, { delivery = null as typeof DELIVERY | null, metadata = {} as Record<string, string> } = {}) {
  const collected: Collected[] = [];
  const sent: Collected[] = [];
  await suppressAiOnboarding(page);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await mockDirectChatSession(page);
  await routeApiEndpoint(page, `/vibe64/sessions/${directChatSessionId}`, (route: Route) => fulfillJson(route, {
    ...directChatSessionPayload, metadata: { ...directChatSessionPayload.metadata, ...metadata }
  }));
  await routeApiEndpoint(page, "/vibe64/problem-report", async (route: Route) => {
    const request = route.request().postDataJSON();
    collected.push(request);
    await fulfillJson(route, { ok: true, draftId: `draft-${collected.length}`, bundle: bundleFor(request), delivery });
  });
  await routeApiEndpoint(page, "/studio/problem-report/send", async (route: Route) => {
    sent.push(route.request().postDataJSON());
    await fulfillJson(route, { ok: true, reference: "PR-7K2M9Q", message: "" });
  });
  await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);
  await expect(page.locator(`[data-vibe64-session-id="${directChatSessionId}"]:visible`).first()).toBeVisible();
  return { collected, sent };
}

const reportDialog = (page: Page) => page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Report a problem" }) });

async function openFromAccountMenu(page: Page) {
  await page.getByRole("button", { name: "Account menu", exact: true }).click();
  await page.locator(".vibe64-auth-settings__menu").getByText("Report a problem", { exact: true }).click();
  await expect(reportDialog(page)).toBeVisible();
}

for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 900 }]) {
  test(`the Account menu reports this page with its errors; Download and Copy give the reviewed report at ${viewport.width}px`, async ({ page }, info) => {
    await page.setViewportSize(viewport);
    const { collected } = await reportWorld(page);
    // An error the page saw before the person opened the dialog.
    await page.evaluate((message) => { setTimeout(() => { throw new Error(message); }); }, PLANTED_ERROR);
    await openFromAccountMenu(page);
    const dialog = reportDialog(page);
    const chat = dialog.getByRole("checkbox", { name: "Include the messages of the chat I was in" });

    // Gathered as it opened: this page, its route, the error, and the session's chat, ticked in by default.
    await expect(dialog.getByRole("heading", { name: "What this report includes" })).toBeVisible();
    expect(collected).toHaveLength(1);
    expect(collected[0]).toMatchObject({ route: DEVELOPMENT_PATH, sessionId: directChatSessionId, chat: { kind: "main" }, includeChat: true });
    // The browser words an uncaught error as "Uncaught Error: ..."; the page's other errors come along too.
    const seen = collected[0].client.errors.map((error: Collected) => error.message);
    expect(seen).toContainEqual(expect.stringContaining(PLANTED_ERROR));
    expect(collected[0].client.viewport).toBe(`${viewport.width}x${viewport.height}`);
    await expect(chat).toBeChecked();
    await expect(dialog.locator("li").filter({ hasText: "Chat messages:" })).toContainText("1 message");
    await expect(dialog.locator("li").filter({ hasText: "Errors this page saw:" })).toHaveText(new RegExp(`^\\s*Errors this page saw:\\s*${seen.length}\\s*$`, "u"));
    await expect(dialog.getByText("2 values hidden", { exact: true })).toBeVisible();
    // This editor sends reports nowhere: no Send, only Download and Copy.
    await expect(dialog.getByRole("button", { name: /^Send/u })).toHaveCount(0);

    // Unticking the chat gathers the report again without it.
    await chat.uncheck();
    await expect.poll(() => collected.length).toBe(2);
    expect(collected[1]).toMatchObject({ sessionId: directChatSessionId, includeChat: false });
    await expect(dialog.locator("li").filter({ hasText: "Chat messages:" })).toContainText("not included");

    // A secret typed in the note is hidden in the report the person reviews, downloads and copies.
    await dialog.getByLabel("What went wrong (optional)").fill(`It froze after Save. DB_PASSWORD=${NOTE_SECRET}`);
    await expect(dialog.getByText("3 values hidden", { exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "Show the whole report" }).click();
    const whole = dialog.locator("[data-vibe64-problem-report-json]");
    await expect(whole).toContainText("It froze after Save. DB_PASSWORD=[hidden]");
    await expect(whole).not.toContainText(NOTE_SECRET);

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      dialog.getByRole("button", { name: "Download" }).click()
    ]);
    expect(download.suggestedFilename()).toBe("vibe64-problem-report-20261125T100000.json");
    const file = JSON.parse(await readFile(await download.path(), "utf8"));
    expect(file).toMatchObject({ schema: "vibe64.problem-report.v1", note: "It froze after Save. DB_PASSWORD=[hidden]",
      masking: { hidden: 3 }, chat: null, place: { route: DEVELOPMENT_PATH } });
    expect(JSON.stringify(file)).not.toContain(NOTE_SECRET);

    await dialog.getByRole("button", { name: "Copy" }).click();
    await expect(dialog.getByRole("button", { name: "Copied" })).toBeVisible();
    expect(JSON.parse(await page.evaluate(() => navigator.clipboard.readText()))).toEqual(file);

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`report-a-problem-${viewport.width}.png`) });
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
  });
}

test("with a host's delivery, Send carries the note and the consents as ticked and shows the reference", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const { sent } = await reportWorld(page, { delivery: DELIVERY });
  await openFromAccountMenu(page);
  const dialog = reportDialog(page);
  const access = dialog.getByRole("checkbox", { name: "Let the host's team look at this to fix it" });
  // The host's consent, on as it declared.
  await expect(access).toBeChecked();
  await dialog.getByLabel("What went wrong (optional)").fill("The preview never started.");
  await access.uncheck();
  await dialog.getByRole("button", { name: "Send to the host" }).click();
  await expect(dialog.getByText("Sent. Your reference is PR-7K2M9Q.", { exact: true })).toBeVisible();
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({ draftId: "draft-1", note: "The preview never started." });
  expect(sent[0].consents).toEqual({ access: false });
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(dialog).toBeHidden();
  // Opened again, it starts over: a new report, nothing ticked from before.
  await openFromAccountMenu(page);
  await expect(dialog.getByRole("checkbox", { name: "Let the host's team look at this to fix it" })).toBeChecked();
  await expect(dialog.getByLabel("What went wrong (optional)")).toHaveValue("");
});

test("a failed AI request offers Report a problem, which reports it with its chat", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const failed = { schemaVersion: 7, messageId: "handoff-request", mode: "auto", resolvedMode: "junior", status: "waiting",
    delivery: "failed", stage: "review", workflow: true, followup: { messageId: "review-followup", message: "Continue review." },
    input: { message: "Build the plan." }, error: "Scheduling disconnected before the handoff was sent." };
  const { collected } = await reportWorld(page, { metadata: {
    // A chat's saved routing holds its after-plan passes (every saved record has since their state upgrade), with
    // Review and Security pass, which always run.
    assistant_routing: JSON.stringify({ mode: "auto", afterPlan: ["review", "security-pass", "data-pass", "quality-pass", "ui-pass", "deslop"],
      afterPlanDeep: [], autoSave: true }),
    assistant_routing_request: JSON.stringify(failed)
  } });
  const notice = page.locator(".vibe64-routing-notice").filter({ hasText: failed.error });
  await notice.getByRole("button", { name: "Report a problem", exact: true }).click();
  const dialog = reportDialog(page);
  await expect(dialog.getByRole("checkbox", { name: "Include the messages of the chat I was in" })).toBeChecked();
  await expect(dialog.getByRole("heading", { name: "What this report includes" })).toBeVisible();
  expect(collected).toEqual([expect.objectContaining({ sessionId: directChatSessionId, chat: { kind: "main", id: "" }, includeChat: true })]);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});
