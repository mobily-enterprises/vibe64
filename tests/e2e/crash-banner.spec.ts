import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test, type Locator, type Page } from "@playwright/test";

import { suppressAiOnboarding } from "./support/suppressAiOnboarding";

// The red crash banner on every page after a real crash of the editor server, until the workspace owner acknowledges
// it: a server of its own (tests/e2e/support/start-crash-test-server.mjs) crashes on an uncaught socket error and is
// started again, as a supervisor restarts it, and the banner is seen after a reload, on other pages, with a count
// after a second crash, on the Crashes page with its stack and Copy for a bug report, gone after Acknowledge (who
// and when on disk), and back after the next crash. A member's smaller line comes from the summary a member gets.

const APP_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const CRASH_SERVER = path.join(APP_ROOT, "tests/e2e/support/start-crash-test-server.mjs");
const SUMMARY_PATH = "/api/studio/health/crashes/summary";

async function freePort(): Promise<number> {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  server.close();
  await once(server, "close");
  if (!address || typeof address === "string") throw new Error("No free port.");
  return address.port;
}

/** The crash test server, started again on the same port and state after each crash. */
function crashTestServer(root: string, port: number) {
  const origin = `http://127.0.0.1:${port}`;
  let child: ChildProcess | null = null;
  let exited: Promise<unknown[]> | null = null;
  return {
    origin,
    async start() {
      child = spawn(process.execPath, [CRASH_SERVER], {
        cwd: APP_ROOT,
        env: { ...process.env, HOST: "127.0.0.1", PORT: String(port), VIBE64_CRASH_TEST_ROOT: root },
        stdio: ["ignore", "ignore", "ignore"]
      });
      exited = once(child, "exit");
      await expect.poll(async () => {
        if (child?.exitCode !== null) throw new Error("The crash test server exited at its start.");
        return fetch(`${origin}/api/health`).then((response) => response.ok, () => false);
      }, { timeout: 60_000, intervals: [100] }).toBe(true);
    },
    /** Makes the running server crash, and resolves with its exit code. */
    async crash() {
      await writeFile(path.join(root, "crash-now"), "");
      const [code] = (await exited) as [number | null];
      return code;
    },
    async stop() {
      if (child && child.exitCode === null && child.signalCode === null) {
        child.kill("SIGTERM");
        await exited;
      }
    }
  };
}

// A crash's time as the banner gives it in the browser's zone: HH:MM, after its day when that was not today.
const WHEN = "(?:\\d{1,2} [A-Z][a-z]{2} (?:\\d{4} )?)?\\d{2}:\\d{2}";

/** The crash notice is red, across the top of the page, with the app bar below it rather than over it. */
async function expectAtTheTop(page: Page, notice: Locator) {
  await expect(notice).toHaveClass(/\bbg-error\b/u);
  // The layout makes room for the notice once it has measured it.
  await expect.poll(async () => {
    const box = await notice.boundingBox();
    const bar = await page.locator(".v-app-bar").first().boundingBox();
    if (!box || !bar) return "not drawn";
    return box.x === 0 && box.y === 0 && box.width >= bar.width && bar.y >= Math.floor(box.height)
      ? "at the top"
      : `notice ${JSON.stringify(box)}, app bar ${JSON.stringify(bar)}`;
  }).toBe("at the top");
}

/** Reloads, and waits for the banner's read of the crashes before anything is checked. */
async function reloadAndReadCrashes(page: Page) {
  const summary = page.waitForResponse((response) => new URL(response.url()).pathname === SUMMARY_PATH);
  await page.reload();
  await summary;
}

test("a crash shows the red banner on every page until the owner acknowledges it, and the next crash raises it again", async ({ context, page }) => {
  test.setTimeout(240_000);
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-crash-banner-"));
  const server = crashTestServer(root, await freePort());
  try {
    await suppressAiOnboarding(page);
    await server.start();
    const summary = page.waitForResponse((response) => new URL(response.url()).pathname === SUMMARY_PATH);
    await page.goto(`${server.origin}/app/crashes`);
    await summary;
    const banner = page.getByTestId("vibe64-crash-banner");
    await expect(page.getByText("Vibe64 has not crashed here.")).toBeVisible();
    await expect(banner).toHaveCount(0);

    expect(await server.crash()).toBe(1);
    await server.start();
    await reloadAndReadCrashes(page);
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(new RegExp(`Vibe64 crashed at ${WHEN}: read ECONNRESET\\. No AI work was running\\.`, "u"));
    await expectAtTheTop(page, banner);
    await reloadAndReadCrashes(page);
    await expect(banner).toBeVisible();
    await page.goto(`${server.origin}/app/learning`);
    await expect(banner).toBeVisible();
    await expect(page.getByTestId("vibe64-crash-line")).toHaveCount(0);

    expect(await server.crash()).toBe(1);
    await server.start();
    await reloadAndReadCrashes(page);
    await expect(banner).toContainText(new RegExp(`Vibe64 crashed 2 times; the last at ${WHEN}: read ECONNRESET\\.`, "u"));

    await banner.getByRole("link", { name: "See crashes" }).click();
    await expect(page).toHaveURL(`${server.origin}/app/crashes`);
    const records = page.getByTestId("vibe64-crash-record");
    await expect(records).toHaveCount(2);
    await expect(records.first()).toContainText("Not acknowledged yet.");
    await expect(records.first().locator("pre")).toContainText("Error: read ECONNRESET");

    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: server.origin });
    await banner.getByRole("button", { name: "Copy for a bug report" }).click();
    await expect(banner.getByRole("button", { name: "Copied" })).toBeVisible();
    const report = await page.evaluate(() => navigator.clipboard.readText());
    expect(report).toMatch(/^Vibe64 crash: read ECONNRESET\n/u);
    expect(report).toContain("Kind: fatal-error (uncaughtException)");
    expect(report).toContain("Error: Error: read ECONNRESET (code ECONNRESET)");

    await banner.getByRole("button", { name: "Acknowledge" }).click();
    await expect(banner).toHaveCount(0);
    await expect(records.first()).toContainText(new RegExp(`Acknowledged by .+ at ${WHEN}\\.`, "u"));
    await reloadAndReadCrashes(page);
    await expect(banner).toHaveCount(0);
    const recordsFolder = path.join(root, "state", "crashes", "records");
    const stored = await Promise.all((await readdir(recordsFolder)).map(async (name) => JSON.parse(await readFile(path.join(recordsFolder, name), "utf8"))));
    expect(stored).toHaveLength(2);
    for (const record of stored) {
      expect(record.acknowledged.by.username).toBe(os.userInfo().username);
      expect(Number.isFinite(Date.parse(record.acknowledged.at))).toBe(true);
    }

    expect(await server.crash()).toBe(1);
    await server.start();
    await reloadAndReadCrashes(page);
    await expect(banner).toContainText(new RegExp(`Vibe64 crashed at ${WHEN}: read ECONNRESET\\.`, "u"));
    await expect(records).toHaveCount(3);
  } finally {
    await server.stop();
    await rm(root, { force: true, recursive: true });
  }
});

test("a member sees a smaller red line, without the error or the owner's buttons", async ({ page }) => {
  await suppressAiOnboarding(page);
  await page.route(`**${SUMMARY_PATH}`, (route) => route.fulfill({
    contentType: "application/json",
    json: {
      ok: true,
      canAcknowledge: false,
      unacknowledged: 1,
      latest: { id: "20261124T041805123Z-4242-0a1b", at: "2026-11-24T04:18:05.123Z", kind: "fatal-error", lastHeartbeatAt: null, activeTurns: 1, resumed: 1 }
    }
  }));
  await page.goto("/app/learning");
  const line = page.getByTestId("vibe64-crash-line");
  await expect(line).toBeVisible();
  await expect(line).toContainText(new RegExp(
    `Vibe64 crashed at ${WHEN} and restarted\\. The AI work that was running was resumed\\. The workspace owner can see what happened\\.`,
    "u"
  ));
  await expect(line).not.toContainText("ECONNRESET");
  await expectAtTheTop(page, line);
  await expect(page.getByTestId("vibe64-crash-banner")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Acknowledge" })).toHaveCount(0);
});
