import assert from "node:assert/strict";
import test from "node:test";

import { sessionRenewalSeedTurnId } from "../../packages/vibe64-terminals/src/server/sessionRenewalReceipts.js";

const stored = {
  metadata: {
    agent_renewal_seed_operation_id: "seed-1",
    agent_renewal_seed_thread_id: "successor",
    agent_renewal_seed_turn_id: "turn-1"
  }
};

test("seed turn id reuses only the stored turn of the same operation and thread", () => {
  assert.equal(sessionRenewalSeedTurnId({}, stored, "seed-1", "successor"), "turn-1");
  assert.equal(sessionRenewalSeedTurnId({}, stored, "seed-2", "successor"), "",
    "a retried seed with a new operation starts fresh");
  assert.equal(sessionRenewalSeedTurnId({}, stored, "seed-1", "other-thread"), "",
    "a different successor thread starts fresh");
  assert.equal(sessionRenewalSeedTurnId({}, { metadata: {} }, "seed-1", "successor"), "");
  assert.equal(sessionRenewalSeedTurnId({ expectedTurnId: "explicit" }, stored, "seed-2", "x"), "explicit");
});
