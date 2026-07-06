import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDoctorTerminalArgs,
  buildDoctorHostCommandArgs
} from "@local/setup-doctor-core/server/doctorHostCommand";

test("doctor host commands are host command argv", () => {
  assert.deepEqual(buildDoctorHostCommandArgs(["npm", "prefix", "-g"]), [
    "npm",
    "prefix",
    "-g"
  ]);
});

test("doctor terminal args preserve the host command argv", () => {
  assert.deepEqual(buildDoctorTerminalArgs(["bash", "-lc", "git status"], {
    targetRoot: "/srv/vibe64/projects/example",
    toolHomeSource: "/home/ada"
  }), [
    "bash",
    "-lc",
    "git status"
  ]);
});
