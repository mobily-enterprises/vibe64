import assert from "node:assert/strict";
import test from "node:test";

import {
  targetScriptStartupScript,
  targetScriptTerminalArgs
} from "@local/studio-terminal-core/server/targetScriptTerminal";

test("target script terminals run host bash commands", () => {
  assert.deepEqual(targetScriptTerminalArgs({
    command: "npm run build",
    targetRoot: "/srv/vibe64/projects/project"
  }).slice(0, 1), ["-lc"]);

  const startupScript = targetScriptStartupScript("npm run build");
  assert.match(startupScript, /npm run build/u);
  assert.match(startupScript, /Vibe64 command HOME is required/u);
  assert.doesNotMatch(startupScript, /export HOME/u);
  assert.doesNotMatch(startupScript, /export PATH/u);
  assert.doesNotMatch(startupScript, /container run/u);
});
