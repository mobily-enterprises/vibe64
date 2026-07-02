import assert from "node:assert/strict";
import process from "node:process";
import test from "node:test";

import {
  runHostCommand
} from "@local/studio-terminal-core/server/shellCommands";

test("runHostCommand streams combined output without changing the result", async () => {
  const chunks = [];
  const result = await runHostCommand(process.execPath, [
    "-e",
    "process.stdout.write('stdout chunk\\n'); process.stderr.write('stderr chunk\\n');"
  ], {
    onOutput(chunk) {
      chunks.push(String(chunk));
    }
  });

  assert.equal(result.ok, true);
  assert.match(result.output, /stdout chunk/u);
  assert.match(result.output, /stderr chunk/u);
  assert.match(chunks.join(""), /stdout chunk/u);
  assert.match(chunks.join(""), /stderr chunk/u);
});
