// Only the person, on the Publish page, confirms publishing. Chat (Colleague),
// automation and internal callers are never the person; tokens are one-shot,
// bound to the plan the person saw, and expire. Stale plans are refused.
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createConfirmationService, confirmingActor } from "../../packages/vibe64-publishing/src/server/confirmationService.js";
import { PERSON_ONLY, PUBLISHING_ACTIONS, createPublishingActions } from "../../packages/vibe64-publishing/src/server/actions.js";

const PLAN = `sha256:${"a".repeat(64)}`;
const OTHER_PLAN = `sha256:${"b".repeat(64)}`;

async function service(t, options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-publishing-confirm-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return createConfirmationService({ runtimeRoot: root, ...options });
}

test("chat, automation and internal callers are never the person", () => {
  assert.deepEqual(confirmingActor({ channel: "api", assistant: false, user: { id: "u1" } }), { kind: "person", id: "u1" });
  assert.deepEqual(confirmingActor({ channel: "api", assistant: false, user: null }), { kind: "person", id: "local-person" });
  assert.equal(confirmingActor({ channel: "api", assistant: true, user: { id: "u1" } }).kind, "assistant", "a Colleague turn is not the person even on the api channel");
  assert.equal(confirmingActor({ channel: "automation", user: { id: "u1" } }).kind, "assistant");
  assert.equal(confirmingActor({ channel: "internal", user: { id: "u1" } }).kind, "assistant");
  assert.equal(confirmingActor({}).kind, "assistant");
});

test("confirmation actions accept only the person's own page requests", () => {
  const actions = createPublishingActions({ publishing: new Proxy({}, { get: () => () => ({ ok: true }) }) });
  const byId = new Map(actions.map((action) => [action.id, action]));
  for (const id of [PUBLISHING_ACTIONS.BASELINE_PUSH, PUBLISHING_ACTIONS.CONFIRMATION_OPEN, PUBLISHING_ACTIONS.RELEASE_CONFIRM, PUBLISHING_ACTIONS.KEYS_UNLOCK, PUBLISHING_ACTIONS.ACCOUNT_ADD, PUBLISHING_ACTIONS.RECOVERY_KIT_CREATE]) {
    assert.deepEqual(byId.get(id).channels, PERSON_ONLY, `${id} is person-only`);
    assert.equal(byId.get(id).extensions.assistant, undefined, `${id} is no assistant tool`);
  }
  assert.ok(byId.get(PUBLISHING_ACTIONS.PUBLISH_RUN).extensions.assistant, "the assistant may ask for the confirmation");
  assert.equal(byId.get(PUBLISHING_ACTIONS.PUBLISH_RUN).channels, undefined);
});

test("an assistant request only waits for the person; it confirms nothing", async (t) => {
  const confirmations = await service(t);
  const pending = await confirmations.request({ planHash: PLAN });
  assert.equal(pending.requestedBy, "assistant");
  await assert.rejects(confirmations.open({ planHash: PLAN, actor: { kind: "assistant", id: "assistant" } }), { code: "VIBE64_PUBLISH_CONFIRMATION_NOT_PERSON" });
  await assert.rejects(confirmations.redeem({ planHash: PLAN, token: "x".repeat(43), actor: { kind: "assistant", id: "assistant" } }), { code: "VIBE64_PUBLISH_CONFIRMATION_NOT_PERSON" });
  assert.equal((await confirmations.pendingRequest()).planHash, PLAN);
});

test("a token is one-shot, bound to the plan and person, and never stored", async (t) => {
  const confirmations = await service(t);
  const person = { kind: "person", id: "ada" };
  const { token } = await confirmations.open({ planHash: PLAN, actor: person });
  assert.doesNotMatch(await readFile(confirmations.file, "utf8"), new RegExp(token), "only the token's hash is stored");
  await assert.rejects(confirmations.redeem({ planHash: OTHER_PLAN, token, actor: person }), { code: "VIBE64_PUBLISH_CONFIRMATION_PLAN_CHANGED" });
  await assert.rejects(confirmations.redeem({ planHash: PLAN, token, actor: { kind: "person", id: "bob" } }), { code: "VIBE64_PUBLISH_CONFIRMATION_INVALID" });
  await assert.rejects(confirmations.redeem({ planHash: PLAN, token: "y".repeat(43), actor: person }), { code: "VIBE64_PUBLISH_CONFIRMATION_INVALID" });
  await confirmations.request({ planHash: PLAN });
  const redeemed = await confirmations.redeem({ planHash: PLAN, token, actor: person });
  assert.ok(redeemed.usedAt);
  assert.equal(await confirmations.pendingRequest(), null, "confirming clears the request");
  await assert.rejects(confirmations.redeem({ planHash: PLAN, token, actor: person }), { code: "VIBE64_PUBLISH_CONFIRMATION_USED" });
});

test("an expired confirmation is refused", async (t) => {
  let clock = Date.parse("2026-10-23T10:00:00Z");
  const confirmations = await service(t, { now: () => clock, ttlMs: 60_000 });
  const person = { kind: "person", id: "ada" };
  const { token } = await confirmations.open({ planHash: PLAN, actor: person });
  clock += 61_000;
  await assert.rejects(confirmations.redeem({ planHash: PLAN, token, actor: person }), { code: "VIBE64_PUBLISH_CONFIRMATION_EXPIRED" });
});
