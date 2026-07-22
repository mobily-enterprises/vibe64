import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createCodexExecRunner,
  validateRunnerResult
} from "../src/codexRunner.js";
import { synchronizationReport } from "./helpers.js";

test("exercises the default Codex runner protocol without invoking an LLM", async (t) => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "progsync-runner-"));
  const workspaceRoot = path.join(temporaryRoot, "workspace");
  await fs.mkdir(workspaceRoot);
  t.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));
  const events = [];
  const execute = async (command, args, options) => {
    assert.equal(command, "codex-fixture");
    assert.equal(options.cwd, workspaceRoot);
    assert.equal(options.input, "trusted prompt");
    assert.equal(args.includes("--ephemeral"), true);
    const resultPath = args[args.indexOf("--output-last-message") + 1];
    await fs.writeFile(
      resultPath,
      `${JSON.stringify(synchronizationReport("CREATE_PROGRAM"))}\n`,
      "utf8"
    );
    options.onOutput('{"type":"turn.started"}\n');
    return {
      exitCode: 0,
      ok: true,
      signal: null,
      stderr: "",
      stdout: "",
      timedOut: false
    };
  };
  const runner = createCodexExecRunner({ command: "codex-fixture", execute });

  const result = await runner({
    onEvent: (event) => events.push(event),
    prompt: "trusted prompt",
    workspaceRoot
  });
  assert.equal(result.mode, "CREATE_PROGRAM");
  assert.deepEqual(events, [{ type: "turn.started" }]);
});

test("rejects structured runner fields outside the output contract", () => {
  assert.throws(
    () => validateRunnerResult({
      ...synchronizationReport("NO_CHANGE", "unchanged"),
      invented: true
    }),
    (error) => error.code === "CODEX_RESULT_INVALID"
  );
});
