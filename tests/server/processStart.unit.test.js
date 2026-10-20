import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  processGroupHasLiveMember,
  processStartIdentityPlatform,
  readProcessStart
} from "@local/vibe64-execution/server";

const LINUX_STAT = "4242 (node (worker)) S 4200 4242 4242 0 -1 4194560 0 0 0 0 0 0 0 0 20 0 1 0 987654 0 0";

test("Linux start identity comes from /proc stat, including command names with parentheses", async () => {
  const observed = await readProcessStart(4242, {
    platform: "linux",
    readFileFn: async (file) => {
      assert.equal(file, "/proc/4242/stat");
      return LINUX_STAT;
    }
  });
  assert.deepEqual(observed, {
    status: "exact",
    groupId: 4242,
    startTimeTicks: "987654",
    state: "S"
  });
  const missing = Object.assign(new Error("gone"), { code: "ENOENT" });
  assert.equal((await readProcessStart(4242, {
    platform: "linux",
    readFileFn: async () => { throw missing; }
  })).status, "absent");
  assert.equal((await readProcessStart(4242, {
    platform: "linux",
    readFileFn: async () => "garbage"
  })).status, "ambiguous");
});

test("macOS start identity comes from ps lstart as epoch seconds", async () => {
  const observed = await readProcessStart(4242, {
    platform: "darwin",
    async execFileFn(command, args, options) {
      assert.equal(command, "ps");
      assert.deepEqual(args, ["-o", "pgid=,stat=,lstart=", "-p", "4242"]);
      assert.equal(options.env.LC_ALL, "C");
      return { stdout: " 4242 Ss   Tue Oct 21 10:00:00 2026\n" };
    }
  });
  assert.equal(observed.status, "exact");
  assert.equal(observed.groupId, 4242);
  assert.equal(observed.state, "S");
  assert.equal(observed.startTimeTicks, String(Math.floor(Date.parse("Tue Oct 21 10:00:00 2026") / 1000)));

  const absent = Object.assign(new Error("exit 1"), { code: 1, stdout: "" });
  assert.equal((await readProcessStart(4242, {
    platform: "darwin",
    execFileFn: async () => { throw absent; }
  })).status, "absent");
  assert.equal((await readProcessStart(4242, {
    platform: "darwin",
    execFileFn: async () => { throw Object.assign(new Error("no ps"), { code: "ENOENT" }); }
  })).status, "ambiguous");
  assert.equal((await readProcessStart(4242, { platform: "win32" })).status, "ambiguous");
});

test("ps-based identity tracks this real process and its process group", async () => {
  const observed = await readProcessStart(process.pid, { platform: "darwin" });
  assert.equal(observed.status, "exact");
  assert.match(observed.startTimeTicks, /^\d+$/u);
  assert.equal(await processGroupHasLiveMember(observed.groupId, { platform: "darwin" }), true);
  if (process.platform === "linux") {
    const linux = await readProcessStart(process.pid);
    const stat = await readFile(`/proc/${process.pid}/stat`, "utf8");
    assert.equal(linux.startTimeTicks, stat.slice(stat.lastIndexOf(")") + 1).trim().split(/\s+/u)[19]);
    assert.equal(linux.groupId, observed.groupId);
    assert.equal(await processGroupHasLiveMember(linux.groupId), true);
  }
});

test("a finished process group has no live member", async () => {
  const child = spawn(process.execPath, ["-e", ""], { detached: true, stdio: "ignore" });
  await new Promise((resolve) => child.once("exit", resolve));
  assert.equal(await processGroupHasLiveMember(child.pid, { platform: "darwin" }), false);
  assert.equal((await readProcessStart(child.pid, { platform: "darwin" })).status, "absent");
  if (process.platform === "linux") {
    assert.equal(await processGroupHasLiveMember(child.pid), false);
    assert.equal((await readProcessStart(child.pid)).status, "absent");
  }
});

test("identity tags name the reader that produced them", () => {
  assert.equal(processStartIdentityPlatform("linux"), "linux-proc");
  assert.equal(processStartIdentityPlatform("darwin"), "darwin-ps");
  assert.equal(processStartIdentityPlatform("win32"), "");
});
