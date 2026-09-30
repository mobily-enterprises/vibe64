import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("the native plan viewer's focused client cases pass", () => {
  const result = spawnSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run",
    "tests/client/vibe64WorkPlan.vitest.js", "--maxWorkers=1", "--no-file-parallelism"], { encoding: "utf8" });
  process.stdout.write(result.stdout || "");
  process.stderr.write(result.stderr || "");
  assert.ifError(result.error);
  assert.equal(result.status, 0, "Focused plan viewer client checks failed");
});
