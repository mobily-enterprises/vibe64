// Stopping the phone share ends a download in progress at once instead of
// waiting for the phone to finish it.
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createLanShare } from "../../packages/vibe64-publishing/src/server/lanShare.js";

test("stopping the share ends an open download at once", async (t) => {
  const base = await mkdtemp(path.join(os.tmpdir(), "vibe64-lan-share-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const file = path.join(base, "app.apk");
  await writeFile(file, Buffer.alloc(32 * 1024 * 1024, 1));
  const share = createLanShare({ host: "127.0.0.1", addresses: () => ["127.0.0.1"] });
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
