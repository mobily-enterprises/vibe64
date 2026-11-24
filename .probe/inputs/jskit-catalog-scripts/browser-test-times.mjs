import path from "node:path";
import process from "node:process";

const SLOWEST_REPORTED = 10;

// A Playwright reporter (browser-tests.mjs adds it beside "list"): every run ends with its slowest tests and their
// times, so a test that got slow shows instead of hiding inside a longer run.
class SlowestTests {
  constructor() {
    this.times = [];
  }

  onTestEnd(test, result) {
    const file = path.relative(process.cwd(), test.location.file);
    this.times.push({ name: `${file}:${test.location.line} ${test.title}`, duration: result.duration, status: result.status });
  }

  onEnd() {
    const slowest = [...this.times].sort((left, right) => right.duration - left.duration).slice(0, SLOWEST_REPORTED);
    if (slowest.length < 1) return;
    const lines = [`[test-time] Slowest ${slowest.length} of ${this.times.length} tests:`];
    for (const { name, duration, status } of slowest) {
      lines.push(`[test-time]   ${(duration / 1000).toFixed(1)} s  ${name}${status === "passed" ? "" : ` (${status})`}`);
    }
    process.stdout.write(`${lines.join("\n")}\n`);
  }

  printsToStdio() {
    return true;
  }
}

export default SlowestTests;
