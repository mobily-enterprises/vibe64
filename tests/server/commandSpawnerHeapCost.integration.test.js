import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const PROBE = fileURLToPath(new URL("./fixtures/commandStartBlockProbe.mjs", import.meta.url));
const SMALL_HEAP_MB = 150;
const LARGE_HEAP_MB = 1500;

/** How long, at the median, starting a command held the main thread of a process grown to `rssMB`. */
async function medianStartBlock(rssMB) {
  const { stdout } = await promisify(execFile)(process.execPath, ["--max-old-space-size=4096", PROBE, String(rssMB), "15"], {
    env: { PATH: process.env.PATH },
    maxBuffer: 1024 * 1024,
    timeout: 120_000
  });
  return JSON.parse(stdout);
}

// Starting a command by forking the editor copies the page tables of its whole heap on the main thread: 10 ms at
// 158 MB and 33 ms at 1.5 GB on a test host. The editor's commands are started by its small spawner instead, so a
// start costs the editor the same fraction of a millisecond whatever its size.
test("starting a command holds the editor's main thread briefly, at a large heap as at a small one", {
  skip: process.platform === "win32",
  timeout: 300_000
}, async () => {
  const small = await medianStartBlock(SMALL_HEAP_MB);
  const large = await medianStartBlock(LARGE_HEAP_MB);
  const report = `median main-thread block per start: ${small.medianBlockMs.toFixed(2)} ms at ${small.rssMB} MB RSS, ` +
    `${large.medianBlockMs.toFixed(2)} ms at ${large.rssMB} MB RSS`;
  console.log(report);
  assert.ok(large.rssMB >= LARGE_HEAP_MB, `the probe reached ${large.rssMB} MB`);
  assert.ok(large.medianBlockMs < 5, report);
  assert.ok(large.medianBlockMs - small.medianBlockMs < 3, report);
});
