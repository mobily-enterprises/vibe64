// Grows this process's heap to the RSS given in MB, as an editor's caches do, then starts commands the way the
// capture engine does and prints how long each start held the main thread (the synchronous part of the call), as JSON.
// Usage: node --max-old-space-size=4096 commandStartBlockProbe.mjs <rssMB> <starts>
import { performance } from "node:perf_hooks";

const engines = new URL("../../../packages/vibe64-execution/src/server/engines/", import.meta.url);
const { startCaptureProcess } = await import(new URL("captureProcess.js", engines).href);
// The editor's server starts its spawner at boot, while it is small.
const { startCommandSpawner } = await import(new URL("commandSpawner.js", engines).href);
startCommandSpawner();

const targetMB = Number(process.argv[2]);
const starts = Number(process.argv[3] || 15);
const live = [];
while (process.memoryUsage().rss < targetMB * 1024 * 1024) {
  const chunk = new Array(50_000);
  for (let index = 0; index < chunk.length; index += 1) chunk[index] = { index, text: `value-${index}-${live.length}` };
  live.push(chunk);
}
globalThis.live = live;

// One start first, so the spawner is up and the command's binary is cached.
await startCaptureProcess("sh", ["-c", ":"], { env: { PATH: process.env.PATH }, timeout: 10_000 }).completion;
const blocks = [];
for (let index = 0; index < starts; index += 1) {
  const started = performance.now();
  const subprocess = startCaptureProcess("sh", ["-c", ":"], { env: { PATH: process.env.PATH }, timeout: 10_000 });
  blocks.push(performance.now() - started);
  const result = await subprocess.completion;
  if (result.exitCode !== 0) throw new Error(`The probe's command failed: ${result.shortMessage}`);
}
blocks.sort((left, right) => left - right);
process.stdout.write(JSON.stringify({
  medianBlockMs: blocks[Math.floor(blocks.length / 2)],
  rssMB: Math.round(process.memoryUsage().rss / 1048576)
}));
