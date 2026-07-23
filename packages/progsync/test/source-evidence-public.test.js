import assert from "node:assert/strict";
import test from "node:test";

import { checkProgram, synchronizeFile } from "../src/index.js";
import {
  GREETING_PROGRAM,
  createGitProject,
  readContext,
  report
} from "./oracle-helpers.js";

test("source assimilation receives package and production-consumer evidence", async (t) => {
  const root = await createGitProject(t, {
    "src/calculate.js": "export function calculate(value) { return value * 2; }\n",
    "src/first.js": "import { calculate } from './calculate.js';\nexport function first(value) { return calculate(value); }\n",
    "src/second.js": "export { calculate as second } from './calculate.js';\n",
    "test/calculate.test.js": "import { calculate } from '../src/calculate.js';\ncalculate(2);\n"
  }, {
    exports: {
      "./*": "./src/*.js"
    }
  });
  let capsule = null;

  const result = await synchronizeFile({
    inputPath: "src/calculate.js",
    operation: "import",
    projectRoot: root,
    runner: async ({ mode, workspaceRoot }) => {
      capsule = await readContext(workspaceRoot);
      return report(mode, "blocked", "Observed the assimilation capsule.");
    }
  });

  assert.equal(result.status, "blocked");
  assert.equal(capsule.capsuleVersion, 4);
  assert.deepEqual(capsule.retainedPackageContext.exports, {
    "./*": "./src/*.js"
  });
  assert.equal(capsule.retainedPackageContext.manifestPath, "package.json");
  assert.equal(capsule.sourceSurfaceEvidence.complete, true);
  const evidence = capsule.sourceSurfaceEvidence.exports.map((entry) => ({
    externallyInvoked: entry.externallyInvoked
      ?? entry.externalPackageOrProcessBoundary
      ?? entry.packageOrProcessBoundary,
    name: entry.name,
    productionConsumers: entry.productionConsumers,
    testConsumers: entry.testConsumers ?? entry.testOnlyConsumers
  }));
  assert.equal(evidence[0].externallyInvoked, true);
  assert.deepEqual(evidence, [{
    externallyInvoked: true,
    name: "calculate",
    productionConsumers: ["src/first.js", "src/second.js"],
    testConsumers: ["test/calculate.test.js"]
  }]);
});

test("Program checking recognizes wildcard package export targets", async (t) => {
  const root = await createGitProject(t, {
    "program/src/features/greet.js.md": GREETING_PROGRAM
  }, {
    exports: {
      "./features/*": {
        import: "./src/features/*.js"
      }
    }
  });

  const result = await checkProgram({ projectRoot: root });
  assert.equal(result.status, "ok");
  assert.deepEqual(result.files[0].diagnostics, []);
  assert.equal(result.files[0].provides[0].externallyInvoked, true);
});
