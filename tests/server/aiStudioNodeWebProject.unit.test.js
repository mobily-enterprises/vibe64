import assert from "node:assert/strict";
import test from "node:test";

import {
  studioCommandScript
} from "@local/ai-studio-adapters/server/nodeWebProject";

test("studio command scripts print a readable intro and preview before the command", () => {
  assert.equal(
    studioCommandScript({
      command: "node --version",
      commandPreview: "npm test",
      intro: "Running checks."
    }),
    [
      "set -e",
      "printf '[studio] %s\\n' 'Running checks.'",
      "printf '[studio] $ %s\\n\\n' 'npm test'",
      "node --version"
    ].join("\n")
  );
});
