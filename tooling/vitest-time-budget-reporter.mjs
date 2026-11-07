import { checkTimeBudgets, loadTimeBudgets } from "./test-time-budgets.mjs";

// A file's time is all of its phases, as Vitest adds them up for its own
// summary: most of a client file's time is importing what it tests.
function fileTime({ environmentSetupDuration, prepareDuration, collectDuration, setupDuration, duration }) {
  return environmentSetupDuration + prepareDuration + collectDuration + setupDuration + duration;
}

// A Vitest reporter for npm run test:client: it prints the slowest test files
// against their budgets in tooling/test-time-budgets.json, and fails the run
// when a file or the suite's total is over budget.
export default class VitestTimeBudgetReporter {
  constructor({ output = process.stderr } = {}) {
    this.output = output;
  }

  onTestRunEnd(testModules) {
    const files = new Map(testModules.map((testModule) => [testModule.moduleId, fileTime(testModule.diagnostic())]));
    const { overruns, report } = checkTimeBudgets({ suite: "client", budgets: loadTimeBudgets("client"), files });
    if (overruns.length > 0) process.exitCode = 1;
    this.output.write(report);
  }
}
