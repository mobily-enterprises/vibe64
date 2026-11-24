// Preloaded (`--import`) by `jskit test` into every process of its node --test runs. In a test file's own process
// (node --test starts one per file, with NODE_TEST_CONTEXT set), it stops the file at the time `jskit test` gave it
// (fileStop in test-time-report.mjs): a file that never finishes, because a test has no timeout or a server, child
// process, timer or socket was left open, then fails by name and the rest of the run still finishes and reports. The
// runner's own process, worker threads and the processes a test starts do nothing.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { isMainThread } from "node:worker_threads";

const STOPS_VARIABLE = "JSKIT_TEST_FILE_STOPS";
const STOPPED_PREFIX = "stopped-";

const stopsFile = process.env[STOPS_VARIABLE];
const runsTestFiles = process.execArgv.some((argument) => argument === "--test" || argument.startsWith("--test="));
if (stopsFile && isMainThread && process.env.NODE_TEST_CONTEXT && !runsTestFiles) {
  // A process this file starts is not one of the run's files.
  delete process.env[STOPS_VARIABLE];
  const stop = JSON.parse(readFileSync(stopsFile, "utf8"))[path.resolve(process.argv[1] || "")];
  if (stop) {
    const started = performance.now();
    // Unreferenced: a file that finishes exits as it would have.
    setTimeout(() => {
      const stopped = { ...stop, ms: Math.round(performance.now() - started) };
      writeFileSync(path.join(path.dirname(stopsFile), `${STOPPED_PREFIX}${process.pid}.json`), JSON.stringify(stopped));
      writeFileSync(2, `\njskit test: stopped ${stopped.file} after ${(stopped.ms / 1000).toFixed(1)} s, ${stopped.reason}.\n`);
      process.exit(1);
    }, stop.ms).unref();
  }
}

export { STOPPED_PREFIX, STOPS_VARIABLE };
