import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import vue from "@vitejs/plugin-vue";
import { createServer } from "vite";
import { readPinnedTopic } from "../../packages/vibe64-training/src/server/catalogue.js";
import { runTrainingCli } from "../../packages/vibe64-training/src/server/cli.js";
import { createInstalledTrainingContent } from "../../packages/vibe64-training/src/server/installedContent.js";
import { alternateVisualResource, browserVisualResource } from "../fixtures/trainingVisualFixture.js";

const enabled = process.env.VIBE64_TRAINING_VISUAL_BROWSER_INTEGRATION === "1";
const publicRoot = fileURLToPath(new URL("../../", import.meta.url));

async function fixture(t) {
  const topicRoot = process.env.VIBE64_TRAINING_VISUAL_TOPIC_SOURCE;
  assert.ok(topicRoot, "Set VIBE64_TRAINING_VISUAL_TOPIC_SOURCE to the clean authored topic checkout.");
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-training-visual-browser-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const systemRoot = path.join(root, "system");
  const sourcePin = await readPinnedTopic(topicRoot);
  const pin = { schemaVersion: 1, topicId: sourcePin.topicId, release: sourcePin.release,
    repository: sourcePin.repository, commit: sourcePin.commit, topicHash: sourcePin.topicHash };
  const parent = path.join(systemRoot, "training", "content", pin.topicId);
  await mkdir(parent, { recursive: true });
  const snapshotRoot = path.join(parent, pin.commit);
  await runTrainingCli(["bundle", topicRoot, snapshotRoot], { write() {} });
  await writeFile(path.join(snapshotRoot, "pin.json"), JSON.stringify(pin));
  const reader = createInstalledTrainingContent({ systemRoot });
  const topic = await reader.readTopic(pin);
  const lesson = topic.bundles.find(bundle => bundle.status === "published" && bundle.lesson.visuals.some(visual => visual.id === "client-server"));
  assert.ok(lesson, "The original published client-server lesson must be present.");
  const resource = await reader.readVisual({ ...pin, lessonCode: lesson.lesson.code, lessonHash: lesson.hash, visualId: "client-server" });
  assert.deepEqual(resource.svg.bytes, await readFile(path.join(topicRoot, resource.svg.path)));
  assert.deepEqual(resource.controller.bytes, await readFile(path.join(topicRoot, resource.controller.path)));
  const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
  t.diagnostic(JSON.stringify({ commit: pin.commit, topicHash: pin.topicHash, lessonCode: lesson.lesson.code,
    lessonHash: lesson.hash, controllerSha256: sha256(resource.controller.bytes), svgSha256: sha256(resource.svg.bytes) }));

  const browserRoot = path.join(root, "browser");
  await mkdir(browserRoot);
  await symlink(path.join(publicRoot, "node_modules"), path.join(browserRoot, "node_modules"), "dir");
  await writeFile(path.join(browserRoot, "index.html"), '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="app"></div><script type="module" src="/main.js"></script></body></html>');
  await writeFile(path.join(browserRoot, "main.js"), `
    import { createApp, h, ref } from 'vue';
    import { createVuetify } from 'vuetify';
    import * as components from 'vuetify/components';
    import 'vuetify/styles';
    import Player from ${JSON.stringify(path.join(publicRoot, "packages/vibe64-training/src/client/TrainingVisualPlayer.vue"))};
    const pilot = ${JSON.stringify(browserVisualResource(resource))};
    const alternate = ${JSON.stringify(alternateVisualResource())};
    createApp({ setup() {
      const player = ref(); const resource = ref(pilot); const attempt = ref('attempt-one');
      const motion = ref(false); const visible = ref(true); const events = []; let state;
      window.visualFixture = {
        command: input => player.value.command(input), snapshot: () => player.value.snapshot(),
        restore: value => player.value.restore(value), state: () => state, events: () => events,
        alternate() { resource.value = alternate; attempt.value = 'attempt-alternate'; },
        pilot() { resource.value = pilot; attempt.value = 'attempt-pilot'; },
        reduced(value) { motion.value = value; }, close() { visible.value = false; }
      };
      return () => h('main', { style: 'max-width:900px;margin:auto;padding:8px' }, visible.value ? h(Player, {
        ref: player, resource: resource.value, attemptId: attempt.value, reducedMotion: motion.value,
        onState(value) { state = value; events.push(value); }
      }) : []);
    } }).use(createVuetify({ components })).mount('#app');
  `);
  let privateRequests = 0;
  const server = await createServer({ root: browserRoot, configFile: false, logLevel: "error",
    cacheDir: path.join(root, "vite-cache"), plugins: [vue()],
    server: { host: "127.0.0.1", port: 0, fs: { allow: [publicRoot, root] } } });
  server.middlewares.use((request, response, next) => {
    if (request.url === "/api/private") { privateRequests++; response.end("not accessible"); }
    else next();
  });
  await server.listen();
  t.after(() => server.close());
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 800, height: 800 } });
  page.on("pageerror", error => t.diagnostic(`Browser error: ${error.message}`));
  page.on("console", message => { if (message.type() === "error") t.diagnostic(`Browser console: ${message.text()}`); });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
  try {
    await page.waitForFunction(() => window.visualFixture?.state()?.phase === "ready");
  } catch (cause) {
    t.diagnostic(JSON.stringify(await page.evaluate(() => ({ state: window.visualFixture?.state(), body: document.body.innerText }))));
    await page.screenshot({ path: "/tmp/vibe64-training-visual-player-startup.png", fullPage: true });
    throw cause;
  }
  return { page, privateRequests: () => privateRequests, title: resource.visual.title };
}

test("native isolated SVG player preserves authored transitions, receipts, semantic restoration and recovery", { skip: !enabled, timeout: 120000 }, async t => {
  const { page, privateRequests, title } = await fixture(t);
  const frame = () => page.frames().find(value => value !== page.mainFrame());
  const command = input => page.evaluate(value => window.visualFixture.command(value), input);
  const state = () => page.evaluate(() => window.visualFixture.state());
  const snapshot = () => page.evaluate(() => window.visualFixture.snapshot());
  await t.test("real topic animation acknowledges before completion and cached receipts do not rewind display", async () => {
    assert.equal(await page.locator("iframe").getAttribute("sandbox"), "allow-scripts");
    assert.equal(await page.locator("iframe").getAttribute("title"), title);
    assert.equal(await frame().evaluate(() => { try { return Boolean(parent.document.body); } catch { return false; } }), false);
    const request = { commandId: "request-one", name: "sendRequest", parameters: { method: "GET", path: "/" } };
    await page.evaluate(input => {
      window.commandFinished = false;
      window.commandResult = window.visualFixture.command(input).then(result => { window.commandFinished = true; return result; });
    }, request);
    await page.waitForFunction(() => window.visualFixture.state().phase === "accepted");
    assert.equal(await page.evaluate(() => window.commandFinished), false);
    assert.ok(await frame().evaluate(() => document.getAnimations().some(animation => animation.playState === "running")));
    assert.equal((await page.evaluate(() => window.commandResult)).state, "request-arrived");
    const arrived = await snapshot();
    assert.equal(arrived.state, "request-arrived");
    assert.equal(arrived.labels.request, "GET /");
    assert.equal((await command({ commandId: "response-one", name: "sendResponse", parameters: { label: "A real reply" } })).state, "response-arrived");
    await snapshot();
    const oldReceipt = await command(request);
    assert.equal(oldReceipt.state, "request-arrived");
    assert.equal((await snapshot()).state, "response-arrived");
    assert.equal((await state()).state, "response-arrived");
  });
  await t.test("pause interrupts real motion and restore copies semantic labels into a fresh instance without replay", async () => {
    await page.evaluate(() => {
      window.interrupted = window.visualFixture.command({ commandId: 'request-interrupted', name: 'sendRequest', parameters: { method: 'POST', path: '/save' } })
        .then(() => ({ unexpectedlyCompleted: true }), error => ({ code: error.code, message: error.message }));
    });
    await page.waitForFunction(() => window.visualFixture.state().phase === "accepted");
    await command({ commandId: "pause-one", name: "pause" });
    assert.equal((await page.evaluate(() => window.interrupted)).code, "interrupted");
    const saved = await snapshot();
    assert.equal(saved.paused, true);
    assert.equal(saved.labels.request, "POST /save");
    const previousId = (await state()).playerInstanceId;
    await page.evaluate(value => window.visualFixture.restore(value), saved);
    assert.notEqual((await state()).playerInstanceId, previousId);
    assert.deepEqual(await snapshot(), saved);
    assert.equal(await frame().locator("#request-label").textContent(), "POST /save");
    const refused = await page.evaluate(() => window.visualFixture.command({ commandId: 'request-one', name: 'sendRequest', parameters: { method: 'GET', path: '/' } }).catch(error => error.message));
    assert.match(refused, /receipt are gone/u);
    await page.evaluate(() => window.visualFixture.reduced(true));
    await page.evaluate(value => window.visualFixture.restore(value), saved);
    assert.equal((await command({ commandId: "reduced-response", name: "sendResponse", parameters: { label: "Reduced motion reply" } })).state, "response-arrived");
    assert.equal(await frame().evaluate(() => document.getAnimations().length), 0);
    assert.equal((await snapshot()).labels.response, "Reduced motion reply");
  });
  await t.test("a different descriptor uses the same host; native sandbox/CSP, timeout and Reload remain honest", async () => {
    await page.evaluate(() => window.visualFixture.alternate());
    await page.waitForFunction(() => window.visualFixture.state().attemptId === "attempt-alternate" && window.visualFixture.state().phase === "ready");
    assert.equal(await page.locator("iframe").getAttribute("title"), "Alternate diagram");
    await command({ commandId: "probe-one", name: "probe" });
    assert.equal((await snapshot()).labels.caption, "Isolation confirmed");
    assert.equal(privateRequests(), 0);
    await command({ commandId: "alternate-one", name: "advance", parameters: { label: "Different vocabulary" } });
    assert.equal((await snapshot()).state, "shown");
    for (const width of [320, 800, 1365]) {
      await page.setViewportSize({ width, height: 800 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
      assert.ok(await page.locator('[role="status"]').textContent());
      assert.equal(await page.getByRole("button", { name: /Expand|Reduce/u }).count(), 0);
      assert.ok(await frame().locator("text").evaluate(node => parseFloat(getComputedStyle(node).fontSize) >= 16));
    }
    const before = (await state()).playerInstanceId;
    const failure = await page.evaluate(() => window.visualFixture.command({ commandId: 'stall-one', name: 'stall' }).then(() => 'unexpected completion', error => error.message));
    assert.match(failure, /not confirm.*not be replayed/u);
    assert.equal((await state()).phase, "failed");
    const recovery = page.getByRole("button", { name: "Reload diagram" });
    assert.ok((await recovery.boundingBox()).height >= 48);
    await recovery.click();
    await page.waitForFunction(() => window.visualFixture.state().phase === "ready");
    assert.notEqual((await state()).playerInstanceId, before);
    assert.deepEqual(await snapshot(), { state: "shown", paused: false, labels: { caption: "Different vocabulary" } });
    await page.evaluate(() => {
      window.closedResult = window.visualFixture.command({ commandId: 'close-pending', name: 'stall' }).catch(error => error.message);
    });
    await page.waitForFunction(() => window.visualFixture.state().phase === "accepted");
    await page.evaluate(() => window.visualFixture.close());
    assert.match(await page.evaluate(() => window.closedResult), /player closed/u);
    assert.equal(await page.locator("iframe").count(), 0);
  });
});


