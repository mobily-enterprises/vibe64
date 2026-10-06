import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("managed process owns adapter lifetime and drains it with native shutdown", { timeout: 10000 }, async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-adapter-lifetime-"));
  const fixture = path.join(root, "native.mjs");
  await writeFile(fixture, `#!${process.execPath}\nimport {writeFileSync} from "node:fs";
    if (process.argv[2] === "debug") { console.log(JSON.stringify({models:[{slug:"fixture-native"}]})); process.exit(0); }
    writeFileSync(process.argv[2],String(process.pid)); setInterval(()=>{},1000);`);
  await chmod(fixture, 0o700);
  const processPath = fileURLToPath(import.meta.resolve("@local/vibe64-runtime/server/codexAppServerProcess"));
  const child = spawn(process.execPath, [processPath, root, fixture, path.join(root, "native.pid")], {
    env: { ...process.env, VIBE64_CODEX_APP_SERVER_RUNTIME_TOKEN: randomUUID() }, stdio: "ignore"
  });
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); await rm(root, { recursive: true, force: true }); });
  let nativePid;
  for (let i = 0; i < 100; i += 1) {
    nativePid = await readFile(path.join(root, "native.pid"), "utf8").catch(() => "");
    if (nativePid) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.ok(nativePid);
  const { baseUrl } = JSON.parse(await readFile(path.join(root, "history-adapter.json"), "utf8"));
  assert.equal((await fetch(`${baseUrl}/not-an-upstream`)).status, 404);
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  await exited;
  assert.throws(() => process.kill(Number(nativePid), 0), { code: "ESRCH" });
  await assert.rejects(fetch(`${baseUrl}/not-an-upstream`));
  await assert.rejects(readFile(path.join(root, "history-adapter.json")), { code: "ENOENT" });
});
