import assert from "node:assert/strict";
import test from "node:test";
import * as helperCommandGroups from "../../packages/vibe64-terminals/src/server/helperCommandGroups.js";
import * as genesisServer from "../../packages/vibe64-genesis/src/server/index.js";

// A composed host reaches what it extends Vibe64 with through the package names, as an app outside this repository
// does: the token its own vibe64-helper groups register under, and the Genesis read of the Stack's declared checks.
test("a host imports the helper-group token and the Genesis verification read through their package names", async () => {
  const groups = await import("@local/vibe64-terminals/server/helperCommandGroups");
  assert.equal(groups.TERMINALS_HELPER_COMMAND_GROUPS_TOKEN, "vibe64.terminals.helper-command-groups");
  assert.equal(groups.TERMINALS_HELPER_COMMAND_GROUPS_TOKEN, helperCommandGroups.TERMINALS_HELPER_COMMAND_GROUPS_TOKEN);
  const genesis = await import("@local/vibe64-genesis/server");
  assert.equal(typeof genesis.inspectGenesisVerification, "function");
  assert.equal(genesis.inspectGenesisVerification, genesisServer.inspectGenesisVerification);
});
