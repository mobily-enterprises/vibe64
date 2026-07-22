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
  assert.match(prompt, /The exported class \[`ClassName`\]\(#class-classname\)/u);
  assert.match(prompt, /Preserve argument grouping/u);
  assert.match(prompt, /When positional arguments and an object argument are combined/u);
  assert.match(prompt, /never obscure\s+that boundary as one object containing `source` and `options`/u);
  assert.match(prompt, /Preserve the argument boundaries of every outside call/u);
  assert.match(prompt, /Listing the values without saying which argument contains them is\s+insufficient/u);
  assert.match(prompt, /For a returned complex value, preserve every public field name/u);
  assert.match(prompt, /ASSIMILATING AN EXISTING IMPLEMENTATION/u);
  assert.match(prompt, /Account for every fact in Program or explicitly\s+classify it as private realization/u);
  assert.match(prompt, /small normative input-to-result examples/u);
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
  assert.match(prompt, /The exported class \[`ClassName`\]\(#class-classname\)/u);
  assert.match(prompt, /including a command entrypoint[\s\S]*explicitly say what it returns/u);
  assert.match(prompt, /each entry is one actual argument/u);
  assert.match(prompt, /never\s+`\(\{ source, options \}\)`/u);
  assert.match(prompt, /Never collapse all groups into a\s+single object/u);
  assert.match(prompt, /resolved complex return type is a field-level contract/u);
  assert.match(prompt, /asynchronous imported operation\s+must be awaited or its Promise returned/u);
  assert.match(prompt, /reads fields, iterates, branches on, or otherwise\s+uses an imported operation's returned value/u);
  assert.match(prompt, /temporal-dead-zone\s+access and accidental shadowing/u);
  assert.match(prompt, /SEMANTIC COVERAGE CHECK/u);
  assert.match(prompt, /omits one explicit Program condition is incomplete/u);
  assert.match(prompt, /normative example as an observable acceptance case/u);
  assert.match(prompt, /Trusted verification evidence that the case currently fails overrides/u);
  assert.match(prompt, /Never claim that a known failing case is\s+already realized/u);
});
