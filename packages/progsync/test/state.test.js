import assert from "node:assert/strict";
import test from "node:test";

import { classifyPair } from "../src/index.js";

const missing = () => ({ exists: false, source: null });
const file = (source) => ({ exists: true, source });

test("classifies every ordinary synchronization direction", () => {
  assert.equal(classifyPair({
    P0: missing(), P1: missing(), I0: file("code"), I1: file("code")
  }), "CREATE_PROGRAM");
  assert.equal(classifyPair({
    P0: file("program"), P1: file("program"), I0: missing(), I1: missing()
  }), "CREATE_IMPLEMENTATION");
  assert.equal(classifyPair({
    P0: file("old"), P1: file("new"), I0: file("code"), I1: file("code")
  }), "PROGRAM_TO_IMPLEMENTATION");
  assert.equal(classifyPair({
    P0: file("program"), P1: file("program"), I0: file("old"), I1: file("new")
  }), "IMPLEMENTATION_TO_PROGRAM");
  assert.equal(classifyPair({
    P0: file("old program"), P1: file("new program"), I0: file("old code"), I1: file("new code")
  }), "RECONCILE_BOTH");
  assert.equal(classifyPair({
    P0: file("program"), P1: file("program"), I0: file("code"), I1: file("code")
  }), "NO_CHANGE");
});

test("does not infer deletions", () => {
  assert.throws(
    () => classifyPair({
      P0: file("program"), P1: missing(), I0: file("code"), I1: file("code")
    }),
    (error) => error.code === "EXPLICIT_PROGRAM_DELETION_REQUIRED"
  );
});
