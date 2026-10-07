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
import { createTrainingLearnerState } from "../../packages/vibe64-training/src/server/learnerState.js";
import { createTrainingTeachingOwner } from "../../packages/vibe64-training/src/server/teaching.js";
import { alternateVisualResource, browserVisualResource } from "../fixtures/trainingVisualFixture.js";

const enabled = process.env.VIBE64_TRAINING_VISUAL_BROWSER_INTEGRATION === "1";
const publicRoot = fileURLToPath(new URL("../../", import.meta.url));

async function fixture(t, { presentation = false } = {}) {
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

  const actor = { uid: 42, username: "fixture-member" };
  const learners = createTrainingLearnerState({ systemRoot });
  const teaching = createTrainingTeachingOwner({ learners, content: reader });
  let attempt;
  if (presentation) {
    const reserved = await learners.reserveAttempt({ actor, requestId: "native-browser", expectedRevision: 0,
      pin: { course: { courseId: "browser-intro", release: "0.1.0" }, topic: pin,
        lesson: { code: lesson.lesson.code, hash: lesson.hash } } });
    await learners.beginPreparation({ actor, attemptId: reserved.attempt.attemptId, expectedRevision: 1 });
    attempt = (await learners.recordPreparationReady({ actor, attemptId: reserved.attempt.attemptId,
      initialSessionId: `training-${reserved.attempt.attemptId}`, expectedRevision: 2 })).attempt;
  }
  const browserRoot = path.join(root, "browser");
  await mkdir(browserRoot);
  await symlink(path.join(publicRoot, "node_modules"), path.join(browserRoot, "node_modules"), "dir");
  await writeFile(path.join(browserRoot, "index.html"), '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="app"></div><script type="module" src="/main.js"></script></body></html>');
  if (presentation) await writeFile(path.join(browserRoot, "retained-app.html"), `<!doctype html><html><body><h1>Retained application</h1><label>Application draft<input aria-label="Application draft"></label><button onclick="document.querySelector('output').textContent=String(++window.presses)">Use application</button><output>0</output><script>window.presses=0;window.appInstanceId=crypto.randomUUID();</script></body></html>`);
  const presentationScript = `
    import { createApp, h, ref } from 'vue';
    import { createVuetify } from 'vuetify';
    import * as components from 'vuetify/components';
    import 'vuetify/styles';
    import Presentation from '@local/vibe64-training/client/preview-presentation';
    import { VIBE64_ASSISTANT_VIEWER_KEY } from '/src/lib/vibe64AssistantHost.js';
    const app = createApp({ setup() {
      const wrapper = ref(); const mounted = ref(true); let appLoads = 0;
      window.presentationFixture = {
        get handle() { return wrapper.value?.presentation; }, appLoads: () => appLoads,
        close() { mounted.value = false; }, reopen() { mounted.value = true; }
      };
      return () => h('main', { style: 'max-width:1100px;margin:auto;padding:8px;height:calc(100dvh - 16px)' },
        mounted.value ? h(Presentation, { ref: wrapper, active: true,
          projectSlug: ${JSON.stringify(attempt?.projectSlug)}, sessionId: ${JSON.stringify(attempt?.preparation.initialSessionId)} }, {
          default: () => h('iframe', { title: 'Retained application', src: '/retained-app.html',
            style: 'width:100%;height:100%;border:0', onLoad: () => appLoads++ })
        }) : []);
    } });
    app.provide(VIBE64_ASSISTANT_VIEWER_KEY, ref({ actorKey: 'fixture-member' }));
    app.use(createVuetify({ components })).mount('#app');
  `;
  await writeFile(path.join(browserRoot, "main.js"), presentation ? presentationScript : `
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
  const resourceRequests = [];
  const checkpointBodies = [];
  let loseNextSave = false;
  const server = await createServer({ root: browserRoot, configFile: false, logLevel: "error",
    cacheDir: path.join(root, "vite-cache"), plugins: [vue(), ...(presentation ? [{
      name: "training-resource-fixture",
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          if (request.url === "/api/session") {
            response.setHeader("content-type", "application/json");
            response.end(JSON.stringify({ csrfToken: "native-browser-fixture" }));
            return;
          }
          if (request.url !== `/api/vibe64/training/attempts/${attempt.attemptId}/visuals/client-server`) return next();
          resourceRequests.push({ method: request.method, path: request.url });
          response.setHeader("content-type", "application/json");
          void (async () => {
            if (request.method === "POST") {
              let body = "";
              for await (const chunk of request) body += chunk;
              const input = JSON.parse(body);
              assert.equal(input.projectSlug, attempt.projectSlug);
              assert.equal(input.sessionId, attempt.preparation.initialSessionId);
              checkpointBodies.push(structuredClone(input));
              const result = await teaching.saveVisualCheckpoint({ actor, attemptId: attempt.attemptId,
                visualId: "client-server", requestId: input.requestId, expectedRevision: input.expectedRevision, snapshot: input.snapshot });
              if (loseNextSave) response.destroy();
              else response.end(JSON.stringify(result));
            } else {
              const saved = await learners.readState({ actor, includeCompletion: true });
              const checkpoint = saved.active.learning?.resume?.visuals.find(item => item.visualId === "client-server");
              response.end(JSON.stringify({ ...browserVisualResource(resource), revision: saved.revision,
                ...(checkpoint ? { snapshot: checkpoint.snapshot } : {}) }));
            }
          })().catch(error => { response.statusCode = error.statusCode || 400; response.end(JSON.stringify({ code: error.code, error: error.message })); });
        });
      }
    }] : [])],
    ...(presentation ? { resolve: { alias: { "/src": path.join(publicRoot, "src"), "@": path.join(publicRoot, "src") } } } : {}), server: { host: "127.0.0.1", port: 0, fs: { allow: [publicRoot, root] } } });
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
    if (presentation) await page.waitForFunction(() => window.presentationFixture?.handle && document.querySelector('iframe[title="Retained application"]')?.contentWindow?.appInstanceId);
    else await page.waitForFunction(() => window.visualFixture?.state()?.phase === "ready");
  } catch (cause) {
    t.diagnostic(JSON.stringify(await page.evaluate(() => ({ state: window.visualFixture?.state() || window.presentationFixture?.handle.state, body: document.body.innerText }))));
    await page.screenshot({ path: "/tmp/vibe64-training-visual-player-startup.png", fullPage: true });
    throw cause;
  }
  return { page, privateRequests: () => privateRequests, resourceRequests, title: resource.visual.title, attempt,
    readSaved: () => learners.readState({ actor, includeCompletion: true }), checkpointBodies,
    loseNextCheckpoint() { loseNextSave = true; }, allowCheckpointResponses() { loseNextSave = false; },
    async prepareQuestion() {
      const current = await learners.readState({ actor, includeCompletion: true });
      return teaching.prepareQuestion({ actor, attemptId: attempt.attemptId, expectedRevision: current.revision,
        requestId: "native-next-question", assessmentId: lesson.lesson.assessments.find(item => item.kind === "answer").id,
        text: "Explain the application you just used.", assistance: "none" });
    } };
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


test("native Preview wrapper retains the App frame while real diagram recovery and text-only cues settle at desktop and phone widths", { skip: !enabled, timeout: 120000 }, async t => {
  const { page, resourceRequests, title, attempt, readSaved, checkpointBodies, loseNextCheckpoint, allowCheckpointResponses, prepareQuestion } = await fixture(t, { presentation: true });
  await page.evaluate(slug => window.history.replaceState(null, "", `/app/project/${slug}`), attempt.projectSlug);
  assert.equal(new URL(page.url()).pathname, `/app/project/${attempt.projectSlug}`);
  const identity = { attemptId: attempt.attemptId, visualId: "client-server" };
  const app = page.frameLocator('iframe[title="Retained application"]');
  const command = input => page.evaluate(value => window.presentationFixture.handle.command(value), { ...identity, ...input });
  const snapshot = () => page.evaluate(value => window.presentationFixture.handle.snapshot(value), identity);
  const state = () => page.evaluate(() => window.presentationFixture.handle.state);
  await page.evaluate(() => {
    window.expectedAppNode = document.querySelector('iframe[title="Retained application"]');
    window.expectedAppWindow = window.expectedAppNode.contentWindow;
  });
  const appInstanceId = await app.locator("body").evaluate(() => window.appInstanceId);
  for (const width of [1280, 390]) {
    try {
      await page.setViewportSize({ width, height: 844 });
      await app.getByRole("textbox", { name: "Application draft" }).fill(`Keep my ${width} draft`);
      await app.getByRole("button", { name: "Use application" }).click();
      await page.evaluate(value => window.presentationFixture.handle.open(value), identity);
      const opened = await state();
      assert.equal(opened.phase, "ready");
      assert.equal(opened.visible, true);
      assert.equal(await page.locator("iframe").count(), 2);
      const diagram = page.locator('iframe[sandbox="allow-scripts"]');
      assert.equal(await diagram.getAttribute("title"), title);
      assert.equal(await page.locator('iframe[title="Retained application"]').isVisible(), false);
      assert.equal(await page.evaluate(() => document.querySelector('iframe[title="Retained application"]') === window.expectedAppNode &&
        window.expectedAppNode.contentWindow === window.expectedAppWindow), true);
      const diagramWindow = await diagram.elementHandle();
      const frame = await diagramWindow.contentFrame();
      assert.equal(await frame.evaluate(() => { try { return Boolean(parent.document.body); } catch { return false; } }), false);
      const result = await command({ commandId: `work-${width}`, name: "showServerWork", parameters: { label: `Seen result ${width}` } });
      assert.equal(result.phase, "completed");
      assert.equal(result.state, "server-working");
      await command({ commandId: `pause-${width}`, name: "pause" });
      const saved = (await snapshot()).snapshot;
      assert.equal(saved.paused, true);
      assert.equal(saved.labels.work, `Seen result ${width}`);

      await page.getByRole("button", { name: "App preview", exact: true }).click();
      assert.equal(await page.locator('iframe[title="Retained application"]').isVisible(), true);
      assert.equal(await app.getByRole("textbox", { name: "Application draft" }).inputValue(), `Keep my ${width} draft`);
      assert.equal(await app.locator("body").evaluate(() => window.appInstanceId), appInstanceId);
      assert.equal(await page.evaluate(() => window.presentationFixture.appLoads()), 1);
      await page.getByRole("button", { name: "Colleague presentation", exact: true }).click();
      await page.waitForFunction(() => window.presentationFixture.handle.state.visible);
      assert.equal((await state()).playerInstanceId, opened.playerInstanceId);
      assert.deepEqual((await snapshot()).snapshot, saved);

      // Real document navigation disposes the original controller's MessagePort.
      // Recovery must use the actual player's timeout and Reload control.
      await frame.goto("about:blank");
      const interrupted = await page.evaluate(value => window.presentationFixture.handle.command(value)
        .then(() => "unexpected completion", error => error.message), { ...identity, commandId: `lost-frame-${width}`, name: "showOverview" });
      assert.match(interrupted, /not confirm.*not be replayed/u);
      assert.equal((await state()).phase, "failed");
      const reload = page.getByRole("button", { name: "Reload diagram", exact: true });
      assert.ok((await reload.boundingBox()).height >= 48);
      await reload.click();
      await page.waitForFunction(() => window.presentationFixture.handle.state.phase === "ready");
      assert.notEqual((await state()).playerInstanceId, opened.playerInstanceId);
      assert.deepEqual((await snapshot()).snapshot, saved);
      const restoredFrame = await (await diagram.elementHandle()).contentFrame();
      assert.equal(await restoredFrame.locator("#work-label").textContent(), `Seen result ${width}`);
      await command({ commandId: `reset-${width}`, name: "reset" });
      const initial = (await snapshot()).snapshot;
      const armed = await page.evaluate(value => window.presentationFixture.handle.armCue(value), {
        ...identity, cueId: `cue-${width}`, commandId: `cue-command-${width}`, navigationId: `navigation-${width}`,
        conversationId: "conversation-one", turnId: `turn-${width}`, clientId: "browser-one", name: "sendResponse",
        parameters: { label: `Greeting ${width}` }
      });
      assert.equal(armed.phase, "armed");
      assert.equal(await page.getByRole("button", { name: "Continue", exact: true }).count(), 0);
      assert.equal(await page.evaluate(value => window.presentationFixture.handle.observeCue(value, { readAloud: false }), {
        ...armed, canonicalFinal: false, outputId: "unfinished-output", phase: "bound"
      }), false);
      assert.deepEqual((await snapshot()).snapshot, initial);
      assert.equal(await page.evaluate(value => window.presentationFixture.handle.observeCue(value, { readAloud: false }), {
        ...armed, canonicalFinal: true, outputId: `output-${width}`, phase: "bound"
      }), true);
      assert.equal((await state()).cue.phase, "awaiting-continue");
      assert.deepEqual((await snapshot()).snapshot, initial, "canonical final alone cannot play a text-only diagram");
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await page.waitForFunction(() => window.presentationFixture.handle.state.cue.phase === "playing");
      assert.ok(await restoredFrame.evaluate(() => document.getAnimations().some(animation => animation.playState === "running")));
      await page.waitForFunction(() => window.presentationFixture.handle.state.cue.phase === "completed");
      const completed = await state();
      assert.equal(completed.cue.visualPhase, "completed");
      assert.equal(completed.cue.audioPhase, "off");
      assert.equal(completed.cue.outputId, `output-${width}`);
      assert.equal((await snapshot()).snapshot.labels.response, `Greeting ${width}`);
      assert.equal((await snapshot()).snapshot.state, "response-arrived");
      const bounds = await diagram.boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1);
      assert.ok(bounds.height >= 256);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
      await page.getByRole("button", { name: "App preview", exact: true }).click();
      await page.waitForFunction(() => !window.presentationFixture.handle.state.visible);
      assert.equal(await page.evaluate(() => document.querySelector('iframe[title="Retained application"]') === window.expectedAppNode &&
        window.expectedAppNode.contentWindow === window.expectedAppWindow), true);
      assert.equal(await app.getByRole("textbox", { name: "Application draft" }).inputValue(), `Keep my ${width} draft`);
      assert.equal(await app.locator("output").textContent(), width === 1280 ? "1" : "2");
      assert.equal(await page.evaluate(() => window.presentationFixture.appLoads()), 1);
    } finally {
      await page.screenshot({ path: `/tmp/vibe64-training-preview-wrapper-${width}-20261007.png`, fullPage: true });
      t.diagnostic(JSON.stringify({ width, state: await state(), appLoads: await page.evaluate(() => window.presentationFixture.appLoads()) }));
    }
  }
  assert.deepEqual(resourceRequests[0], { method: "GET", path: `/api/vibe64/training/attempts/${identity.attemptId}/visuals/client-server` });
  assert.ok(resourceRequests.some(item => item.method === "POST"));
  assert.equal(resourceRequests.every(item => ["GET", "POST"].includes(item.method) &&
    item.path === `/api/vibe64/training/attempts/${identity.attemptId}/visuals/client-server`), true);
  for (let index = 0; index < 100; index++) {
    if ((await readSaved()).active.learning?.resume?.visuals[0]?.snapshot.paused === true) break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal((await readSaved()).active.learning.resume.visuals[0].snapshot.paused, true);
  const issued = await prepareQuestion();
  await page.evaluate(value => window.presentationFixture.handle.open(value), identity);
  loseNextCheckpoint();
  const actual = await command({ commandId: "uncertain-checkpoint", name: "showServerWork", parameters: { label: "Confirmed before response loss" } });
  assert.equal(actual.phase, "completed", "A lost save response cannot erase actual diagram completion.");
  t.diagnostic(JSON.stringify({ lostResponseBodies: checkpointBodies.slice(-3),
    checkpointNotice: await page.locator('[role="alert"]').allTextContents(),
    buttons: await page.getByRole("button").allTextContents() }));
  assert.ok(await page.getByRole("button", { name: "Retry diagram checkpoint", exact: true }).isVisible());
  const retained = structuredClone(checkpointBodies.at(-1));
  assert.equal(retained.expectedRevision, issued.revision, "Fresh revision is read after preparing a new question, before snapshot capture.");
  allowCheckpointResponses();
  await page.getByRole("button", { name: "Retry diagram checkpoint", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('[role="alert"]'));
  assert.deepEqual(checkpointBodies.at(-1), retained, "Unknown save retry preserves its exact ID, revision and semantic body.");
  assert.deepEqual((await readSaved()).active.learning.resume.pendingQuestion, issued.snapshot.question);
  await command({ commandId: "durable-pause", name: "pause" });
  await page.waitForFunction(() => !document.querySelector('[role="alert"]'));
  const saved = (await snapshot()).snapshot;
  const durable = await readSaved();
  assert.deepEqual(durable.active.learning.resume.visuals, [{ visualId: "client-server", snapshot: saved }]);
  assert.equal(saved.paused, true);
  const oldInstance = (await state()).playerInstanceId;
  await page.evaluate(() => window.presentationFixture.close());
  await page.waitForFunction(() => !window.presentationFixture.handle);
  await page.evaluate(() => window.presentationFixture.reopen());
  await page.waitForFunction(() => window.presentationFixture.handle);
  await page.evaluate(value => window.presentationFixture.handle.open(value), identity);
  assert.notEqual((await state()).playerInstanceId, oldInstance);
  assert.deepEqual((await snapshot()).snapshot, saved);
  assert.equal((await state()).cue, undefined);
  const restored = await (await page.locator('iframe[sandbox="allow-scripts"]').elementHandle()).contentFrame();
  assert.equal(await restored.evaluate(() => document.getAnimations().some(animation => animation.playState === "running")), false);
  assert.deepEqual((await readSaved()).active.learning.resume, durable.active.learning.resume, "mount/restore remains write-free");
});
