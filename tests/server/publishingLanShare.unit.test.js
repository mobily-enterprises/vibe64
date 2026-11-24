// Stopping the phone share ends a download in progress at once instead of
// waiting for the phone to finish it. Neither a phone that goes away nor an
// APK removed while shared ends the editor that shares it.
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import { connect as netConnect } from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { createLanShare } from "../../packages/vibe64-publishing/src/server/lanShare.js";

const SHARE_PROCESS = fileURLToPath(new URL("../fixtures/lanShareProcess.js", import.meta.url));
const WAIT_MS = 20_000;
const quietLogger = { warn() {} };

test("stopping the share ends an open download at once", async (t) => {
  const base = await mkdtemp(path.join(os.tmpdir(), "vibe64-lan-share-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const file = path.join(base, "app.apk");
  await writeFile(file, Buffer.alloc(32 * 1024 * 1024, 1));
  const share = createLanShare({ host: "127.0.0.1", addresses: () => ["127.0.0.1"], logger: quietLogger });
  const started = await share.start({ key: "r-1/app", file, fileName: "app.apk" });
  t.after(() => share.stop());

  // A slow phone: it reads the first bytes, then stops reading.
  const response = await new Promise((resolve, reject) => http.get(started.url, resolve).on("error", reject));
  assert.equal(response.statusCode, 200);
  await new Promise((resolve) => response.once("data", resolve));
  response.pause();

  const before = Date.now();
  const stopped = await Promise.race([share.stop(), new Promise((resolve) => setTimeout(() => resolve("still waiting"), 2000).unref())]);
  assert.deepEqual(stopped, { sharing: false }, "stop does not wait for the download");
  assert.ok(Date.now() - before < 2000);
  response.on("error", () => {});
  const ended = new Promise((resolve) => response.once("close", resolve));
  response.resume();
  await ended;
  assert.equal(response.complete, false, "the phone's download was cut off");
  assert.deepEqual(share.status(), { sharing: false });
});

test("an APK removed while shared is refused to the phone, and the editor keeps running", async (t) => {
  const base = await mkdtemp(path.join(os.tmpdir(), "vibe64-lan-share-gone-"));
  const file = path.join(base, "app.apk");
  await writeFile(file, Buffer.alloc(1024, 1));
  const share = await startShareProcess(t, base, file);

  await rm(file);
  const answer = await phoneGet(share.url);
  await share.settle();
  share.assertRunning();
  assert.equal(answer.statusCode, 410);
  assert.match(answer.body, /no longer on the computer that shared it/u);
  const { warnings } = await share.ask("state");
  assert.deepEqual(warnings.map((warning) => [warning.event, warning.code]), [["vibe64.publishing.shared_apk_unreadable", "ENOENT"]]);
  assert.deepEqual(await share.stop(), { code: 0, signal: null });
});

test("a phone that resets mid-download leaves the editor running and the APK closed", async (t) => {
  const base = await mkdtemp(path.join(os.tmpdir(), "vibe64-lan-share-reset-"));
  const file = path.join(base, "app.apk");
  await writeFile(file, Buffer.alloc(32 * 1024 * 1024, 1));
  const share = await startShareProcess(t, base, file);

  // The phone reads the first bytes, then its connection resets.
  const url = new URL(share.url);
  const phone = netConnect({ host: url.hostname, port: Number(url.port) });
  phone.on("error", () => {});
  await once(phone, "connect");
  phone.write(`GET ${url.pathname} HTTP/1.1\r\nHost: ${url.host}\r\n\r\n`);
  await once(phone, "data");
  phone.resetAndDestroy();

  await waitFor(async () => {
    share.assertRunning();
    return (await share.ask("state")).openFiles === 0;
  }, "the share closed the APK");
  assert.deepEqual(await share.stop(), { code: 0, signal: null });
});

/** The share in a child process, removed with its folder when the test ends. */
async function startShareProcess(t, base, file) {
  const child = fork(SHARE_PROCESS, [file], { execArgv: [], stdio: ["ignore", "pipe", "pipe", "ipc"] });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  child.stdout.resume();
  let exit = null;
  const exited = once(child, "exit").then(([code, signal]) => {
    exit = { code, signal };
    return exit;
  });
  t.after(async () => {
    if (!exit) child.kill("SIGKILL");
    await exited;
    await rm(base, { force: true, recursive: true });
  });
  const report = () => `exit ${JSON.stringify(exit)}\nstderr:\n${stderr}`;
  const messages = [];
  child.on("message", (message) => messages.push(message));
  async function next(type) {
    let message = null;
    await waitFor(() => {
      assert.equal(exit, null, `the share's process ended while the test waited for "${type}":\n${report()}`);
      const index = messages.findIndex((candidate) => candidate.type === type);
      if (index >= 0) [message] = messages.splice(index, 1);
      return Boolean(message);
    }, `the share's process sent "${type}"`);
    return message;
  }
  const { url } = await next("ready");
  return {
    url,
    async ask(message) {
      child.send(message);
      return next(message);
    },
    assertRunning() {
      assert.equal(exit, null, `the share's process ended:\n${report()}`);
    },
    async settle() {
      await Promise.race([exited, delay(200)]);
    },
    async stop() {
      child.send("stop");
      return Promise.race([exited, delay(WAIT_MS).then(() => assert.fail(`the share's process did not stop:\n${report()}`))]);
    }
  };
}

/** A phone's download: its status and body, or how it failed. */
function phoneGet(url) {
  return new Promise((resolve) => {
    http.get(url, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("error", (error) => resolve({ statusCode: response.statusCode, body, error }));
      response.on("end", () => resolve({ statusCode: response.statusCode, body }));
    }).on("error", (error) => resolve({ statusCode: 0, body: "", error }));
  });
}

async function waitFor(check, description) {
  const deadline = Date.now() + WAIT_MS;
  while (!(await check())) {
    assert.ok(Date.now() < deadline, `timed out waiting until ${description}`);
    await delay(25);
  }
}
