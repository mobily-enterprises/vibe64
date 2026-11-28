import { expect, test, type Page } from "@playwright/test";
import { BASE_URL, DEVELOPMENT_PATH, directChatSessionId, directChatSessionPayload } from "./support/base-shell-data";
import { mockDirectChatSession } from "./support/base-shell/codex-mocks";
import { fulfillJson, routeApiEndpoint } from "./support/base-shell/http";

// The address names the session on screen, so a reload, a copied link or the address opened again shows that
// session, never the one shown before it.
const otherSessionId = "2026-05-12_02-00-00";
const otherSession = {
  ...directChatSessionPayload,
  manifest: { ...directChatSessionPayload.manifest, sessionId: otherSessionId },
  sessionId: otherSessionId,
  sessionName: "Other session"
};

/** Two sessions; the list names the last one opened, which the page's PUT of the current session moves. */
async function twoSessions(page: Page, { lastOpenedSessionId = directChatSessionId } = {}) {
  await mockDirectChatSession(page);
  const server = { lastOpenedSessionId };
  await routeApiEndpoint(page, "/vibe64/sessions", route => fulfillJson(route, {
    ok: true, creation: { canCreate: true, mode: "direct" }, limits: { openSessionCount: 2 },
    lastOpenedSessionId: server.lastOpenedSessionId, sessions: [directChatSessionPayload, otherSession]
  }));
  await routeApiEndpoint(page, "/vibe64/sessions/current", async route => {
    if (route.request().method() === "PUT") server.lastOpenedSessionId = route.request().postDataJSON().sessionId;
    await fulfillJson(route, { ok: true, sessionId: server.lastOpenedSessionId });
  });
  await routeApiEndpoint(page, `/vibe64/sessions/${otherSessionId}`, route => fulfillJson(route, otherSession));
  await routeApiEndpoint(page, `/vibe64/sessions/${otherSessionId}/temporary-conversations`, route => (
    route.request().method() === "GET" ? fulfillJson(route, { ok: true, conversations: [] }) : route.fallback()));
  await routeApiEndpoint(page, `/vibe64/sessions/${otherSessionId}/conversation-log`, route => fulfillJson(route, {
    ok: true, conversationLog: [], sessionId: otherSessionId,
    pagination: { count: 0, hasMoreBefore: false, limit: 20, totalTurnCount: 0 }
  }));
  return server;
}

const tab = (page: Page, sessionId: string) => page.locator(`[data-vibe64-session-id="${sessionId}"]:visible`).first();
const addressQuery = (page: Page) => Object.fromEntries(new URL(page.url()).searchParams);

async function expectShown(page: Page, sessionId: string, hidden: string) {
  await expect(tab(page, sessionId)).toHaveClass(/studio-ai-sessions__tab--active/u);
  await expect(tab(page, hidden)).not.toHaveClass(/studio-ai-sessions__tab--active/u);
}

test.describe("the address names the session on screen", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("switching session names it in the address, and a reload opens it", async ({ page }) => {
    await twoSessions(page);
    await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}?session=${directChatSessionId}`);
    await expectShown(page, directChatSessionId, otherSessionId);

    await tab(page, otherSessionId).click();
    await expectShown(page, otherSessionId, directChatSessionId);
    await expect.poll(() => addressQuery(page)).toEqual({ session: otherSessionId });

    await page.reload();
    await expectShown(page, otherSessionId, directChatSessionId);
    expect(addressQuery(page)).toEqual({ session: otherSessionId });

    await tab(page, directChatSessionId).click();
    await expectShown(page, directChatSessionId, otherSessionId);
    await expect.poll(() => addressQuery(page)).toEqual({ session: directChatSessionId });
  });

  test("an address opens exactly the session it names, whichever was opened last", async ({ page }) => {
    await twoSessions(page, { lastOpenedSessionId: directChatSessionId });
    await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}?session=${otherSessionId}`);
    await expectShown(page, otherSessionId, directChatSessionId);
    expect(addressQuery(page)).toEqual({ session: otherSessionId });
  });

  test("an address naming a session that has gone opens the last one opened and names it", async ({ page }) => {
    await twoSessions(page, { lastOpenedSessionId: otherSessionId });
    await routeApiEndpoint(page, "/vibe64/sessions/2026-01-01_00-00-00/renewal", route => fulfillJson(route, { ok: true, renewal: null }));
    await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}?session=2026-01-01_00-00-00&chat=main`);
    await expectShown(page, otherSessionId, directChatSessionId);
    await expect.poll(() => addressQuery(page)).toEqual({ session: otherSessionId });

    await page.reload();
    await expectShown(page, otherSessionId, directChatSessionId);
  });
});
