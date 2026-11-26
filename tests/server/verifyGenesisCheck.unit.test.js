import assert from "node:assert/strict";
import test from "node:test";
import { genesisCheckFailures } from "../../tooling/verify-genesis-check.mjs";

const passing = { status: "attention", program: "valid", skills: "current", diagnostics: [] };

test("verify's Genesis step passes a check whose only findings are attention, such as evidence never saved", () => {
  assert.deepEqual(genesisCheckFailures(passing), []);
  assert.deepEqual(genesisCheckFailures({ ...passing, status: "ok" }), []);
});

test("verify's Genesis step fails an invalid Program and names the module", () => {
  const diagnostic = {
    code: "PROGRAM_INVALID",
    message: "genesis/program/conversation/repeated-commands.md: has no `## Public contract` heading"
  };
  const result = { ...passing, status: "invalid", program: "invalid", diagnostics: [diagnostic] };
  assert.deepEqual(genesisCheckFailures(result), [
    "Genesis check is invalid (Program: invalid, Agent Skills: current).",
    "PROGRAM_INVALID: genesis/program/conversation/repeated-commands.md: has no `## Public contract` heading"
  ]);
});

test("verify's Genesis step fails managed skill copies that are not the pinned Genesis's, naming the sync", () => {
  for (const skills of ["outdated", "missing", "customized"]) {
    assert.deepEqual(genesisCheckFailures({ ...passing, skills }), [
      `Agent Skills are ${skills}, not current: run \`genesis skills sync\` and commit the refreshed `
        + ".agents/skills copies."
    ]);
  }
});
