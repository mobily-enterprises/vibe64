import { expect, test, type Page, type WebSocketRoute } from "@playwright/test";

import {
  DASHBOARD_PATH,
  DEVELOPMENT_PATH,
  WORKSPACE_SLUG,
  directChatSessionId
} from "./support/base-shell-data";
import { mockDirectChatSession } from "./support/base-shell-mocks";
import { fulfillJson, routeApiEndpoint } from "./support/base-shell/http";

// The recording indicator across the layout. The page's HTTP is mocked; the
// recording's changes arrive through a Socket.IO stand-in, as the server's
// realtime events would. The recorder itself is covered by the server tests.
const RECORDING_ID = "rec_e2erecordingfixturea";
const EVENT = "vibe64.usage-recording.changed";
const SCREENSHOTS = process.env.VIBE64_USAGE_SCREENSHOTS || "";

type Recording = Record<string, any>;

// A Socket.IO server over the page's WebSocket transport: enough for each of
// the page's sockets to connect, have its emits acknowledged and receive events.
async function mockRealtime(page: Page) {
  const sockets = new Set<WebSocketRoute>();
  let next = 0;
  await page.routeWebSocket(/\/socket\.io\//u, (socket) => {
    const sid = `e2e-${(next += 1)}`;
    sockets.add(socket);
    socket.onClose(() => sockets.delete(socket));
    socket.send(`0${JSON.stringify({ sid, upgrades: [], pingInterval: 300_000, pingTimeout: 300_000, maxPayload: 1_000_000 })}`);
    socket.onMessage((message) => {
      const packet = String(message);
      if (packet.startsWith("40")) socket.send(`40${JSON.stringify({ sid: `${sid}-socket` })}`);
      const ack = /^42(\d+)/u.exec(packet);
      if (ack) socket.send(`43${ack[1]}${JSON.stringify([{ ok: true }])}`);
    });
  });
  return {
    publish(recording: Recording) {
      const packet = `42${JSON.stringify([EVENT, {
        projectSlug: WORKSPACE_SLUG, sessionId: directChatSessionId, recordingId: recording.id,
        state: recording.state, counts: recording.counts, startedAt: recording.startedAt,
        stoppedAt: recording.stoppedAt, stopReason: recording.stopReason
      }])}`;
      for (const socket of sockets) socket.send(packet);
    }
  };
}

async function mockRecordings(page: Page) {
  const calls: string[] = [];
  const state: { recording: Recording | null } = { recording: null };
  const base = `/vibe64/usage-recordings/sessions/${directChatSessionId}`;
  await routeApiEndpoint(page, base, async (route) => {
    const request = route.request();
    const suffix = new URL(request.url()).pathname.replace(/^.*\/usage-recordings\/sessions\/[^/]+/u, "");
    calls.push(`${request.method()} ${suffix || "/"}`);
    if (request.method() === "GET" && suffix === "/current") {
      return fulfillJson(route, { recording: state.recording, serverTime: new Date().toISOString() });
    }
    if (request.method() === "POST" && suffix === "") {
      state.recording = {
        schema: "vibe64.usage-recording.v1", id: RECORDING_ID, sessionId: directChatSessionId, state: "starting",
        target: { id: "preview", kind: "web", label: "Preview" }, runtimes: ["nodejs"],
        tracers: [{ runtime: "nodejs", state: "starting", reason: "" }],
        // Started a minute ago, so a reload shows the elapsed time continuing.
        startedAt: new Date(Date.now() - 61_000).toISOString(), stoppedAt: null, stopReason: null,
        counts: { requests: 0, functions: 0 }, truncated: false, dismissedAt: null, sourceIdentity: null
      };
      return fulfillJson(route, { recording: state.recording });
    }
    if (request.method() === "POST" && suffix === `/${RECORDING_ID}/stop`) {
      if (state.recording?.state === "recording") {
        Object.assign(state.recording, { state: "stopping", stopReason: "person", stoppedAt: new Date().toISOString() });
      }
      return fulfillJson(route, { recording: state.recording });
    }
    if (request.method() === "POST" && suffix === `/${RECORDING_ID}/dismiss`) {
      state.recording = { ...state.recording, dismissedAt: new Date().toISOString() };
      return fulfillJson(route, { recording: state.recording });
    }
    return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "Not mocked." }) });
  }, { prefix: true });
  return { calls, state };
}

async function noHorizontalScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
}

// A phone header's own contents fit it: nothing is clipped off its end.
async function headerFits(page: Page) {
  expect(await page.locator(".studio-home-shell-heading").evaluate((heading) => heading.scrollWidth - heading.clientWidth)).toBeLessThanOrEqual(0);
}

for (const viewport of [{ name: "desktop", width: 1280, height: 800 }, { name: "phone", width: 390, height: 844 }]) {
  test.describe(viewport.name, () => {
    const phone = viewport.name === "phone";
    test.use({ viewport: { width: viewport.width, height: viewport.height }, hasTouch: phone, isMobile: phone });

    // A phone's header has no room for it: there it is a full-width strip below the header.
    test("the recording indicator stays in the header across panes, chat and reload", async ({ page }) => {
      test.setTimeout(90_000);
      const shot = async (step: string) => {
        if (SCREENSHOTS) await page.screenshot({ path: `${SCREENSHOTS}/usage-recording-${viewport.name}-${step}.png` });
      };
      try {
        await mockDirectChatSession(page);
        const realtime = await mockRealtime(page);
        const recordings = await mockRecordings(page);
        const host = page.locator(phone ? "#studio-home-shell-usage-recording-strip" : "#studio-home-shell-usage-recording");
        const pill = host.locator(".usage-recording-indicator__text");
        const inHeader = page.locator("#studio-home-shell-usage-recording .usage-recording-indicator__pill");

        await page.goto(DASHBOARD_PATH);
        await expect(host).toBeAttached({ timeout: 15_000 });
        await expect(host.locator(".usage-recording-indicator__pill")).toHaveCount(0);
        expect((await host.boundingBox())?.width || 0).toBe(0);

        // Started through the API: the change reaches the header through realtime.
        await page.evaluate(async ({ slug, sessionId }) => {
          await fetch(`/api/app/${slug}/vibe64/usage-recordings/sessions/${sessionId}`, {
            method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ targetId: "preview" })
          });
        }, { slug: WORKSPACE_SLUG, sessionId: directChatSessionId });
        realtime.publish(recordings.state.recording!);
        await expect(pill).toHaveText("Starting recording…");
        Object.assign(recordings.state.recording!, { state: "recording", tracers: [{ runtime: "nodejs", state: "ready", reason: "" }] });
        realtime.publish(recordings.state.recording!);
        await expect(pill).toHaveText(/^Recording 1:0\d · 0 requests$/u);
        await expect(host.getByRole("button", { name: "Stop recording" })).toBeVisible();
        if (phone) {
          await expect(inHeader).toHaveCount(0);
          const stop = await host.getByRole("button", { name: "Stop recording" }).boundingBox();
          expect(Math.min(stop?.width || 0, stop?.height || 0)).toBeGreaterThanOrEqual(48);
          await headerFits(page);
        }
        await shot("1-dashboard");

        // Preview, the chat, and (on a desktop) a collapsed chat all keep it.
        if (phone) {
          await page.goto(DEVELOPMENT_PATH);
          await expect(pill).toBeVisible();
          await shot("2-chat");
          await page.getByRole("button", { name: "Show project", exact: true }).click();
        } else {
          await page.getByRole("tab", { name: "Preview" }).click();
        }
        await expect(pill).toBeVisible();
        await shot("3-preview");
        if (!phone) {
          await page.locator(".studio-home-shell-chat-toggle").click();
          await expect(pill).toBeVisible();
          await shot("4-chat-collapsed");
          await page.locator(".studio-home-shell-chat-toggle").click();
        }
        await noHorizontalScroll(page);

        // A reload reads the recording again; the time continues from the server's start.
        await page.reload();
        // Beside Preview's toolbar a desktop header may be too narrow for the wide pill.
        await expect(pill).toHaveText(phone ? /^Recording 1:\d\d · 0 requests$/u : /^(?:Recording )?1:\d\d · 0(?: requests)?$/u, { timeout: 15_000 });

        // Requests made in Preview raise the count.
        for (const requests of [1, 2, 3]) {
          recordings.state.recording!.counts = { requests, functions: requests * 4 };
          realtime.publish(recordings.state.recording!);
        }
        await expect(pill).toHaveText(/· 3(?: requests)?$/u, { timeout: 3_000 });

        // The strip and the header both fit a 360 px phone.
        if (phone) {
          await page.setViewportSize({ width: 360, height: viewport.height });
          await expect(pill).toBeVisible();
          await noHorizontalScroll(page);
          await headerFits(page);
          await shot("4-recording-360");
          await page.setViewportSize({ width: viewport.width, height: viewport.height });
        }

        // Stop from the Preview pane: Stopping… until the server confirms, then ready.
        await host.getByRole("button", { name: "Stop recording" }).click();
        await expect(pill).toHaveText("Stopping…");
        await expect(host.getByRole("button", { name: "Stop recording" })).toBeEnabled();
        recordings.state.recording!.state = "stopped";
        realtime.publish(recordings.state.recording!);
        await expect(pill).toHaveText(phone ? "Recording ready · 3 requests" : /^(?:Recording ready · 3 requests|Ready · 3)$/u);
        await shot("5-ready");
        await noHorizontalScroll(page);
        if (phone) await headerFits(page);

        // Open results (on a phone, by tapping the strip): the Architecture
        // tool of the dashboard, asked to show this recording.
        if (phone) await host.locator(".usage-recording-indicator__body").click();
        else await host.getByRole("button", { name: /^Open(?: results)?$/u }).click();
        await expect(page).toHaveURL(new RegExp(`${DASHBOARD_PATH}/system`, "u"));
        await expect(page.locator(".studio-autopilot__architecture-pane")).toBeVisible();
        await expect.poll(() => recordings.calls).toContain(`POST /${RECORDING_ID}/dismiss`);
        await expect(host.locator(".usage-recording-indicator__pill")).toHaveCount(0);
        await shot("6-opened");
      } finally {
        await page.close().catch(() => {});
      }
    });
  });
}
