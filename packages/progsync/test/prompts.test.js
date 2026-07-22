import assert from "node:assert/strict";
import test from "node:test";

import { readProgramAuthorPrompt } from "../src/index.js";

test("ships the strict default Program-authoring prompt", async () => {
  const prompt = await readProgramAuthorPrompt();

  assert.match(prompt, /Every meaningful value must come from/u);
  assert.match(prompt, /use a numbered list/u);
  assert.match(prompt, /Types never appear in Uses/u);
  assert.match(prompt, /Never make an\s+Atomic Synchronizer invent their source/u);
});
