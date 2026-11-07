import { checkTimeBudgets, loadTimeBudgets } from "../../../tooling/test-time-budgets.mjs";

// A Playwright reporter: it prints the slowest spec files against their
// budgets in tooling/test-time-budgets.json, by the time their tests took, and
// fails the run when a file, all of them together or the run's wall-clock time
// (Playwright's own, its build and servers included) is over budget. A run of
// a few files or a shard keeps to the budgets too.
export default class TimeBudgetReporter {
  constructor({ output = process.stderr } = {}) {
    this.output = output;
    this.files = new Map();
  }

  onTestEnd(test, result) {
    const file = test.location.file;
    this.files.set(file, (this.files.get(file) ?? 0) + result.duration);
  }

  onEnd(result) {
    const wallMs = result.duration;
    const { overruns, report } = checkTimeBudgets({ suite: "browser", budgets: loadTimeBudgets("browser"), files: this.files, wallMs });
    this.output.write(report);
    return overruns.length > 0 ? { status: "failed" } : undefined;
  }

  printsToStdio() {
    return false;
  }
}
