import assert from "node:assert/strict";
import test from "node:test";
import { cleanAuthOutput, deviceUserCode, redactedAuthOutputTail } from "../../packages/vibe64-accounts/src/shared/authOutput.js";
import { validateGitIdentityInputs } from "../../packages/vibe64-accounts/src/shared/gitIdentityInput.js";

test("server and browser read login output through one parser", () => {
  const output = "\u001b[1mOpen\u001b[0m ¤[32mhttps://auth.openai.com/codex/device?state=private¤[0m\nEnter code: ABCD-12345\n" +
    "key sk-abcdefghijklmnopqrstuvwxyz";
  assert.equal(cleanAuthOutput(output).includes("\u001b"), false);
  assert.equal(cleanAuthOutput(output).includes("¤"), false);
  assert.equal(deviceUserCode(output), "ABCD-12345");
  assert.equal(deviceUserCode("no code here"), "");
  const tail = redactedAuthOutputTail(output);
  assert.match(tail, /https:\/\/auth\.openai\.com\/codex\/device(?!\?)/u);
  assert.doesNotMatch(tail, /state=private|ABCD-12345|sk-abcdefghij/u);
  assert.match(tail, /\[redacted-code\][\s\S]*\[redacted-openai-api-key\]/u);
});

test("one Git identity rule serves the Account card and the save", () => {
  assert.deepEqual(validateGitIdentityInputs({ name: " Ada ", email: "ada@example.test" }), { email: "ada@example.test", name: "Ada", ok: true });
  assert.equal(validateGitIdentityInputs({ name: "Ada", email: "not-an-email" }).ok, false);
  assert.equal(validateGitIdentityInputs({ name: "", email: "ada@example.test" }).ok, false);
});
