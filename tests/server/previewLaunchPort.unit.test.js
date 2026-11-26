// A Preview's port is checked free by Vibe64 and bound later by the project's Run command, in its own process. In the
// host's ephemeral range an outgoing connection can take it in between, and the Preview then cannot listen (a test's
// Preview did so on 26 Nov 2026: EADDRINUSE on a port get-port gave it), so the range is never offered.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { configureVibe64Host } from "@local/vibe64-execution/server/hostProfile";
// The package export Online's own port allocators read, the one owner of the range.
import { ephemeralPortRange } from "@local/vibe64-terminals/server/ephemeralPortRange";
import { reserveAvailableWebLaunchTargetPort } from "../../packages/vibe64-terminals/src/server/launchTargetTerminal.js";
import { portBelowEphemeralRange } from "../fixtures/portBelowEphemeralRange.js";

const RANGE_FILE = "/proc/sys/net/ipv4/ip_local_port_range";

async function rangeFile(t, text) {
  const root = await mkdtemp(path.join(os.tmpdir(), "v64-port-range-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, "ip_local_port_range");
  if (text !== null) await writeFile(file, text);
  return file;
}

test("the ephemeral range comes from the kernel's range file wherever it exists, and IANA's only off Linux", async (t) => {
  const kernel = await rangeFile(t, "32768\t60999\n");
  assert.deepEqual(await ephemeralPortRange({ rangeFile: kernel, platform: "linux" }), { first: 32768, last: 60999 });
  assert.deepEqual(await ephemeralPortRange({ rangeFile: kernel, platform: "darwin" }), { first: 32768, last: 60999 });
  const missing = await rangeFile(t, null);
  assert.deepEqual(await ephemeralPortRange({ rangeFile: missing, platform: "darwin" }), { first: 49152, last: 65535 });
  assert.deepEqual(await ephemeralPortRange({ rangeFile: missing, platform: "win32" }), { first: 49152, last: 65535 });
  // On Linux the file is how the kernel names its range: without it nothing is guessed.
  await assert.rejects(ephemeralPortRange({ rangeFile: missing, platform: "linux" }), { code: "ENOENT" });
  await assert.rejects(ephemeralPortRange({ rangeFile: await rangeFile(t, "60999 32768\n"), platform: "linux" }),
    /does not hold a port range: 60999 32768/u);
});

test("a Preview is never offered a port in the host's ephemeral range: a preferred port inside it is passed over", async (t) => {
  // This host's own range, read here as the kernel gives it.
  const host = existsSync(RANGE_FILE)
    ? readFileSync(RANGE_FILE, "utf8").trim().split(/\s+/u).map(Number)
    : [49152, 65535];
  const inside = await reserveAvailableWebLaunchTargetPort(host[0] + 100);
  t.after(() => inside.release());
  assert.ok(inside.port < host[0] || inside.port > host[1], `${inside.port} is in ${host[0]}-${host[1]}`);

  // A range of 20 ports just above a free one: the scan from inside it goes on past its end, and the free port below
  // it is the one offered when preferred.
  const free = await portBelowEphemeralRange();
  const narrow = await rangeFile(t, `${free + 1} ${free + 20}\n`);
  const past = await reserveAvailableWebLaunchTargetPort(free + 6, { rangeFile: narrow });
  t.after(() => past.release());
  assert.ok(past.port > free + 20, `${past.port} is in ${free + 1}-${free + 20}`);
  const below = await reserveAvailableWebLaunchTargetPort(free, { rangeFile: narrow });
  t.after(() => below.release());
  assert.equal(below.port, free);
});

test("a Preview is never offered a port the host claims for its own services, which may be free when it is chosen", async (t) => {
  t.after(() => configureVibe64Host(null));
  const free = await portBelowEphemeralRange();
  configureVibe64Host({ claimedPorts: [{ first: free - 5, last: free + 10 }, { first: free + 11, last: free + 12 }] });
  // Inside the first claim, and across the claim right after it.
  const past = await reserveAvailableWebLaunchTargetPort(free);
  t.after(() => past.release());
  assert.ok(past.port > free + 12, `${past.port} is claimed by the host (${free - 5}-${free + 12})`);
  // The same port once nothing claims it.
  configureVibe64Host(null);
  const unclaimed = await reserveAvailableWebLaunchTargetPort(free);
  t.after(() => unclaimed.release());
  assert.equal(unclaimed.port, free);
});
