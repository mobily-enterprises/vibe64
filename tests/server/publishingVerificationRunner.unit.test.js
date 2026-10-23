// Checks on the saved commit: a failure keeps which check failed and the end of
// its output (with the throwaway home hidden), so the Publish page can show why
// without a terminal. A pass keeps neither.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createVerificationRunner } from "../../packages/vibe64-publishing/src/server/verificationRunner.js";

async function runner(t, verify) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-publishing-checks-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repository = { withCheckout: async (_root, _commit, operation) => operation(root) };
  return createVerificationRunner({ runtimeRoot: root, repository, verify });
}

test("a failed check records which one failed and the end of its output", async (t) => {
  const checks = await runner(t, async ({ onEvent, environment }) => {
    await onEvent({ code: "VERIFICATION_STARTED", details: { label: "Lint" } });
    await onEvent({ code: "VERIFICATION_STARTED", details: { label: "Tests" } });
    return {
      status: "failed",
      summary: "node failed: node exited with status 1.",
      commands: [],
      diagnostics: [{ code: "VERIFICATION_FAILED", details: { stdout: `${"x".repeat(5000)}\n✖ slug keeps accents\n`, stderr: `at ${environment.HOME}/index.js:1` } }]
    };
  });
  const result = await checks.run({ repositoryRoot: "/project", commit: "a".repeat(40) });
  assert.equal(result.status, "failed");
  assert.equal(result.failedCommand, "Tests");
  assert.ok(result.output.length <= 4000);
  assert.match(result.output, /✖ slug keeps accents\nat ~\/index\.js:1$/u, "the end of the output, home hidden");
  assert.deepEqual(await checks.status("a".repeat(40)), result);
});

test("passing checks keep no output", async (t) => {
  const checks = await runner(t, async () => ({ status: "passed", summary: "Passed 1.", commands: [{ label: "Tests" }], diagnostics: [] }));
  const result = await checks.run({ repositoryRoot: "/project", commit: "b".repeat(40) });
  assert.equal(result.status, "passed");
  assert.deepEqual(result.commands, ["Tests"]);
  assert.equal("output" in result, false);
  assert.equal("failedCommand" in result, false);
});
