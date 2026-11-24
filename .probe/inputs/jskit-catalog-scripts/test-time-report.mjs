import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { toPosixPath } from "./files.mjs";
import { STOPPED_PREFIX } from "./test-file-stop.mjs";

// How long `jskit test` took, file by file. The node --test reporter below runs beside a run's own reporters and writes
// the run's file and top-level test durations to the file `jskit test` names. After its last run, `jskit test` lists the
// ten slowest files and tests, records each file's time in node_modules/.cache/jskit-test/file-times.json, and fails
// when a file or the whole command went past a coarse bound that only a clearly broken suite reaches: a file waiting
// out its timeouts, a suite that would run for hours. An application whose measured suite needs more writes its own
// bounds in test-time-bounds.json, `{ "runMs": ..., "fileMs": ..., "files": { "<path>": ... } }`, with the measurement.
// A file that has not finished by a generous multiple of its time is stopped while it runs (test-file-stop.mjs), so
// one file that never ends fails by name instead of holding up the whole run until a runner's own ceiling ends it.
const SHOWN = 10;
// Stops a file at twice its bound (at least two seconds, well past any file's start-up), or at ten times its recorded
// time (at least two minutes, more than a cold compile cache or a loaded machine needs), whichever comes first. A file
// with its own bound in test-time-bounds.json is stopped at twice that bound.
const STOP_BOUND_TIMES = 2;
const STOP_BOUND_MIN_MS = 2000;
const STOP_RECORDED_TIMES = 10;
const STOP_RECORDED_MIN_MS = 2 * 60_000;
const BOUNDS_FILE = "test-time-bounds.json";
const DEFAULT_BOUNDS = Object.freeze({ runMs: 45 * 60_000, fileMs: 10 * 60_000, files: Object.freeze({}) });
const FILE_TIMES = path.join("node_modules", ".cache", "jskit-test", "file-times.json");

const seconds = (ms) => (ms >= 60_000 ? `${(ms / 60_000).toFixed(1)} min` : `${(ms / 1000).toFixed(1)} s`);

/** @param {AsyncIterable<{ type: string, data: any }>} source node --test's events */
export default async function* collectTestTimes(source) {
  const relative = (file) => toPosixPath(path.relative(process.cwd(), file));
  const files = {};
  const tests = [];
  // Files that skipped a test: their time says little about how long they take when every test runs.
  const skipped = new Set();
  for await (const event of source) {
    if (event.type === "test:summary" && event.data.file) {
      files[relative(event.data.file)] = event.data.duration_ms;
    } else if ((event.type === "test:pass" || event.type === "test:fail") && event.data.file) {
      if (event.data.skip != null && event.data.skip !== false) skipped.add(relative(event.data.file));
      if (event.data.nesting === 0) {
        tests.push({ file: relative(event.data.file), name: event.data.name, ms: event.data.details?.duration_ms ?? 0 });
      }
    }
  }
  yield `${JSON.stringify({ files, tests, skipped: [...skipped] })}\n`;
}

/** The application's bounds over JSKIT's defaults; each must be a positive number of milliseconds. */
function readTestTimeBounds(cwd) {
  const file = path.join(cwd, BOUNDS_FILE);
  if (!existsSync(file)) return DEFAULT_BOUNDS;
  const own = JSON.parse(readFileSync(file, "utf8"));
  const bounds = { ...DEFAULT_BOUNDS, ...own, files: { ...own.files } };
  for (const [name, ms] of [["runMs", bounds.runMs], ["fileMs", bounds.fileMs], ...Object.entries(bounds.files)]) {
    if (!(Number.isFinite(ms) && ms > 0)) throw new Error(`${BOUNDS_FILE}: ${name} must be a positive number of milliseconds.`);
  }
  return bounds;
}

/**
 * When a file still running is stopped, and why: twice its bound, or ten times its recorded time when that comes first.
 * @param {{ bound: number, recorded?: number }} times milliseconds; `recorded` is the file's last time, if any
 * @returns {{ ms: number, reason: string }}
 */
function fileStop({ bound, recorded }) {
  const byBound = Math.max(STOP_BOUND_MIN_MS, STOP_BOUND_TIMES * bound);
  const byRecorded = recorded > 0 ? Math.max(STOP_RECORDED_MIN_MS, STOP_RECORDED_TIMES * recorded) : Infinity;
  return byRecorded < byBound
    ? { ms: byRecorded, reason: `past ten times its last time of ${seconds(recorded)}` }
    : { ms: byBound, reason: `past twice its ${seconds(bound)} bound` };
}

/**
 * Writes when each of the run's files is stopped, keyed by its absolute path, for test-file-stop.mjs; returns the file.
 * @param {{ cwd: string, files: string[], directory: string }} options `files`: the run's test files, relative to cwd
 */
function writeFileStops({ cwd, files, directory }) {
  const bounds = readTestTimeBounds(cwd);
  const record = path.join(cwd, FILE_TIMES);
  const recorded = existsSync(record) ? JSON.parse(readFileSync(record, "utf8")) : {};
  const stops = Object.fromEntries(files.map((file) => [
    path.resolve(cwd, file),
    // A file's own bound is the application's measured statement of its time, so it alone sets the stop.
    { file, ...fileStop(file in bounds.files ? { bound: bounds.files[file] } : { bound: bounds.fileMs, recorded: recorded[file] }) }
  ]));
  const stopsFile = path.join(directory, "file-stops.json");
  writeFileSync(stopsFile, JSON.stringify(stops));
  return stopsFile;
}

/**
 * The slowest files and tests of a `jskit test` command against its bounds, and the bounds it went past.
 * @param {{ bounds: { runMs: number, fileMs: number, files: Record<string, number> }, files: Record<string, number>,
 *   tests: Array<{ file: string, name: string, ms: number }>, wallMs: number,
 *   stopped?: Array<{ file: string, ms: number, reason: string }> }} times `stopped`: the files stopped while running
 */
function checkTestTimes({ bounds, files, tests, wallMs, stopped = [] }) {
  const rows = Object.entries(files).map(([name, ms]) => ({ name, ms, bound: bounds.files[name] ?? bounds.fileMs }));
  const overruns = [
    ...stopped.map((stop) => `${stop.file} was stopped after ${seconds(stop.ms)}, ${stop.reason}: it did not finish.`),
    ...rows.filter((row) => row.ms > row.bound && !stopped.some((stop) => stop.file === row.name))
      .map((row) => `${row.name} took ${seconds(row.ms)}, past its ${seconds(row.bound)} bound.`)
  ];
  if (wallMs > bounds.runMs) overruns.push(`The run took ${seconds(wallMs)}, past its ${seconds(bounds.runMs)} bound.`);
  const lines = [
    `jskit test: ${rows.length} test file(s) in ${seconds(wallMs)} (bound ${seconds(bounds.runMs)}); the slowest, time / bound:`,
    ...rows.sort((a, b) => b.ms - a.ms).slice(0, SHOWN).map((row) => `  ${seconds(row.ms)} / ${seconds(row.bound)}  ${row.name}`),
    "jskit test: the slowest tests:",
    ...[...tests].sort((a, b) => b.ms - a.ms).slice(0, SHOWN)
      .map((entry) => `  ${seconds(entry.ms)}  ${entry.file}: ${entry.name.slice(0, 120)}`)
  ];
  if (overruns.length > 0) {
    lines.push(
      "jskit test: past a time bound, so something is clearly broken:",
      ...overruns.map((overrun) => `  ${overrun}`),
      `Find what got slow and fix it; raise a bound in ${BOUNDS_FILE} only when the work itself grew, with the measurement.`
    );
  }
  return { overruns, report: `${lines.join("\n")}\n` };
}

/**
 * Reads what the runs' reporters wrote and which files test-file-stop.mjs stopped, records each finished file's time
 * for the next command (a stopped file, or one that skipped a test, keeps the time it last finished all its tests in,
 * since the next stop is reckoned from it), and checks the times. A run whose
 * reporters were replaced (inside another node --test run) wrote nothing, and has no report unless a file was stopped.
 * @param {{ cwd: string, collected: string[], directory: string, wallMs: number }} options `collected`: the reporters'
 *   destination files; `directory`: where the stopped files are written
 * @returns {{ overruns: string[], report: string } | null}
 */
function reportTestTimes({ cwd, collected, directory, wallMs }) {
  const runs = collected.filter((file) => existsSync(file) && readFileSync(file, "utf8").trim())
    .map((file) => JSON.parse(readFileSync(file, "utf8")));
  const stopped = readdirSync(directory).filter((name) => name.startsWith(STOPPED_PREFIX)).sort()
    .map((name) => JSON.parse(readFileSync(path.join(directory, name), "utf8")));
  const files = Object.assign({}, ...runs.map((run) => run.files));
  if (Object.keys(files).length === 0 && stopped.length === 0) return null;
  const unrepresentative = new Set([...stopped.map((stop) => stop.file), ...runs.flatMap((run) => run.skipped ?? [])]);
  const finished = Object.fromEntries(Object.entries(files).filter(([name]) => !unrepresentative.has(name)));
  const record = path.join(cwd, FILE_TIMES);
  const recorded = existsSync(record) ? JSON.parse(readFileSync(record, "utf8")) : {};
  mkdirSync(path.dirname(record), { recursive: true });
  // Written whole, then renamed, so a command beside this one never reads half a file.
  writeFileSync(`${record}.${process.pid}`, `${JSON.stringify({ ...recorded, ...finished }, null, 2)}\n`);
  renameSync(`${record}.${process.pid}`, record);
  return checkTestTimes({ bounds: readTestTimeBounds(cwd), files, tests: runs.flatMap((run) => run.tests), wallMs, stopped });
}

export { BOUNDS_FILE, FILE_TIMES, checkTestTimes, fileStop, reportTestTimes, writeFileStops };
