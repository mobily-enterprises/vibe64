import assert from "node:assert/strict";
import test from "node:test";

import { readProgramAuthorPrompt } from "../src/index.js";
import { composeAtomicPrompt } from "../src/prompts.js";

test("ships the strict default Program-authoring prompt", async () => {
  const prompt = await readProgramAuthorPrompt();

  assert.match(prompt, /Every meaningful value must come from/u);
  assert.match(prompt, /use a numbered list/u);
  assert.match(prompt, /Types never appear in Uses/u);
  assert.match(prompt, /Never make an\s+Atomic Synchronizer invent their source/u);
});

test("guards JavaScript decimal rounding against unscaled binary tolerance", async () => {
  const prompt = await composeAtomicPrompt({
    allowedPaths: ["src/statistics.js"],
    capsule: {},
    mode: "CREATE_IMPLEMENTATION",
    target: { kind: "javascript", prompt: "javascript.txt" }
  });

  assert.match(prompt, /Scale any\s+tolerance to the rounded magnitude/u);
  assert.match(prompt, /unscaled `Number\.EPSILON` is not generally sufficient/u);
});
