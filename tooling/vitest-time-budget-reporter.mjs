import { checkTimeBudgets, loadTimeBudgets } from "./test-time-budgets.mjs";

// A file's time is all of its phases, as Vitest adds them up for its own
// summary: most of a client file's time is importing what it tests.
function fileTime({ environmentSetupDuration, prepareDuration, collectDuration, setupDuration, duration }) {
  return environmentSetupDuration + prepareDuration + collectDuration + setupDuration + duration;
}

// A Vitest reporter for npm run test:client: it prints the slowest test files
// against their budgets in tooling/test-time-budgets.json, and fails the run
// when a file, the suite's total or its wall-clock time is over budget.
export default class VitestTimeBudgetReporter {
  constructor({ output = process.stderr } = {}) {
    this.output = output;
    this.started = Date.now();
  }

  onTestRunStart() {
    this.started = Date.now();
  }

  onTestRunEnd(testModules) {
    const files = new Map(testModules.map((testModule) => [testModule.moduleId, fileTime(testModule.diagnostic())]));
    const wallMs = Date.now() - this.started;
    const { overruns, report } = checkTimeBudgets({ suite: "client", budgets: loadTimeBudgets("client"), files, wallMs });
    if (overruns.length > 0) process.exitCode = 1;
    this.output.write(report);
  }
}
