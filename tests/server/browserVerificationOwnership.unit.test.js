import assert from "node:assert/strict";
import test from "node:test";
import { assistantModePrompt } from "../../packages/vibe64-runtime/src/shared/assistantRouting.js";

test("a sole agent invites the user before continuing its own browser checks", () => {
  const prompt = assistantModePrompt("custom", "Implement the feature.");
  assert.match(prompt, /Preview is responding.*Ready to try.*give it a spin/);
  assert.match(prompt, /Do not claim full completion before verification/);
  assert.match(prompt, /You own the remaining verification, including relevant browser checks/);
  assert.ok(prompt.endsWith("Implement the feature."));
});

test("automatic implementation hands browser verification to its separate Senior", () => {
  const prompt = assistantModePrompt("junior", "Implement the feature.", {
    intent: "explicit_implementation", browserReview: true
  });
  assert.match(prompt, /Senior review owns in-depth browser testing and visual inspection/);
  assert.match(prompt, /Do not run those checks in this implementation turn/);
  assert.match(prompt, /Run relevant focused code tests/);
  assert.match(prompt, /basic smoke checks: confirm server startup, relevant routes and API responses/);
  assert.match(prompt, /brief managed-browser check that the changed page renders and its main control is present/);
  assert.match(prompt, /Leave full end-to-end browser suites, multi-step user journeys and visual inspection to Senior/);
  assert.match(prompt, /Tell the user that Senior will perform the remaining browser checks/);
  assert.doesNotMatch(prompt, /You own the remaining verification/);
  // A direct Junior request without automatic review must retain verification.
  assert.match(assistantModePrompt("junior", "Implement the feature."), /You own the remaining verification/);
});

test("Senior review explicitly owns functional browser and visual verification", () => {
  const prompt = assistantModePrompt("review", "Review the feature.", { intent: "review" });
  assert.match(prompt, /You own browser verification for this review/);
  assert.match(prompt, /implementer's code tests do not replace these checks/);
  assert.match(prompt, /do not claim verified completion while required checks remain unfinished/);
  assert.doesNotMatch(prompt, /Do not run those checks in this implementation turn/);
});

test("discussion, planning and cleanup do not invite use of an unimplemented feature", () => {
  for (const intent of ["discussion", "planning", "deslop"]) {
    assert.doesNotMatch(assistantModePrompt("junior", "Discuss the feature.", {
      intent, browserReview: true
    }), /Ready to try|You own the remaining verification/);
  }
});
