import assert from "node:assert/strict";
import test from "node:test";
import { createOpenCodeSessionRenewalPreparation } from "../../packages/vibe64-terminals/src/server/openCodeSessionRenewal.js";
import { __testables } from "../../packages/vibe64-terminals/src/server/sessionRenewalHandover.js";

const { sessionRenewalHandoverHash } = __testables;

const source = Object.freeze({
  authority: "github",
  commit: "a".repeat(40),
  ref: "refs/heads/main",
  repository: "https://github.com/example/project.git"
});

const handover = [
  "# Session handover",
  "## Objective",
  "Finish the project safely.",
  "## Decisions",
  "Keep the current architecture.",
  "## Saved source",
  "- Authority: github",
  "- Repository: https://github.com/example/project.git",
  "- Ref: refs/heads/main",
  `- Commit: ${"a".repeat(40)}`,
  "## Touched areas",
  "The server.",
  "## Verification",
  "Focused tests passed.",
  "## Unresolved work",
  "One follow-up remains.",
  "## Next action",
  "Implement that follow-up."
].join("\n");

async function seedTurn() {
  const processRelease = { failure: (error) => { throw error; } };
  const preparation = createOpenCodeSessionRenewalPreparation({
    mainMessagePreparation: { contextFor: async () => ({}) },
    hostPreparation: { prepareProcess: async () => ({}), upstreamSessionOptions: () => ({}) },
    lifecyclePreparation: { processRelease }
  });
  const prepared = await preparation.prepareRenewalSeed("session-1", {
    handover,
    handoverHash: sessionRenewalHandoverHash(handover),
    operationId: "renewal-1",
    source
  });
  const turn = prepared.turn({ selection: {} });
  assert.equal(turn.release, processRelease, "the seed turn stops the successor's process when it ends");
  return turn;
}

// The seed turn stops the successor's OpenCode process when it ends, and its
// proof decides the result. A missing proof once counted as a stopped process.
test("an OpenCode renewal seed succeeds only on proof that its process stopped", async () => {
  const turn = await seedTurn();
  const result = (processExitProof) => turn.completeResult({ text: "", threadId: "thread", turnId: "turn",
    ...(processExitProof === undefined ? {} : { processExitProof }) });
  assert.equal((await result({ exited: true })).ok, true);
  assert.equal((await result({ exited: true, sharedProcessRetained: true })).ok, true);
  assert.equal((await result({ exited: false })).ok, false);
  for (const unproven of [undefined, null, {}, { exited: "yes" }]) {
    assert.equal((await result(unproven)).ok, false, `no proof is no stop: ${JSON.stringify(unproven)}`);
  }
});
