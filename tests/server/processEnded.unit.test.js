import assert from "node:assert/strict";
import test from "node:test";

import { linuxProcessStat, processEnded } from "../../packages/vibe64-execution/src/host/processEnded.js";

// A /proc/<pid>/stat line as Linux writes it; num_threads (field 20) is the 18th field after the command name.
const stat = (state, threads) =>
  `4242 (python3 (worker)) ${state} 4200 4242 4242 0 -1 4194560 0 0 0 0 0 0 0 0 20 0 ${threads} 0 987654 0 0`;

test("a zombie leader whose process still has another thread has not ended; a zombie on its last thread has", () => {
  assert.deepEqual(linuxProcessStat(stat("Z", 2)), {
    flags: 4194560,
    groupId: 4242,
    parentId: 4200,
    startTimeTicks: "987654",
    state: "Z",
    threads: 2
  });
  assert.equal(processEnded(linuxProcessStat(stat("Z", 2))), false, "a main thread's pthread_exit leaves the process running");
  assert.equal(processEnded(linuxProcessStat(stat("Z", 1))), true, "every thread has ended and the parent has yet to reap it");
  assert.equal(processEnded(linuxProcessStat(stat("X", 1))), true, "dead");
  for (const state of ["R", "S", "D", "T", "t", "I"]) {
    assert.equal(processEnded(linuxProcessStat(stat(state, 1))), false, state);
  }
  // ps shows no thread count; where Vibe64 reads ps (macOS), a zombie has no thread left.
  assert.equal(processEnded({ state: "Z" }), true);
  assert.equal(processEnded({ state: "S" }), false);
  assert.equal(processEnded(null), false, "nothing read proves nothing ended");
  assert.equal(linuxProcessStat("garbage"), null);
  assert.equal(linuxProcessStat(stat("Z", 2).replace(" 987654 ", " x ")), null);
});
