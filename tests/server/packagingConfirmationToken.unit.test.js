import assert from "node:assert/strict";
import test from "node:test";

import {
  issuePublishConfirmation,
  redeemPublishConfirmation
} from "../../packages/vibe64-packaging/src/server/confirmationToken.js";

const PLAN = `sha256:${"1".repeat(64)}`;
const OTHER_PLAN = `sha256:${"2".repeat(64)}`;
const PERSON = { kind: "person", id: "user-7" };
const NOW = Date.parse("2026-10-23T10:00:00Z");

function refused(run, code) {
  assert.throws(run, (error) => error.code === code, code);
}

test("an assistant can neither issue nor redeem a publish confirmation", () => {
  for (const actor of [{ kind: "assistant", id: "colleague" }, { kind: "automation", id: "x" }, { id: "user-7" }, null]) {
    refused(() => issuePublishConfirmation({ planHash: PLAN, actor, now: NOW }), "VIBE64_PUBLISH_CONFIRMATION_NOT_PERSON");
  }
  const { token, record } = issuePublishConfirmation({ planHash: PLAN, actor: PERSON, now: NOW });
  refused(() => redeemPublishConfirmation({ token, planHash: PLAN, actor: { kind: "assistant", id: "user-7" }, record, now: NOW }), "VIBE64_PUBLISH_CONFIRMATION_NOT_PERSON");
  refused(() => redeemPublishConfirmation({ token, planHash: PLAN, actor: { kind: "person", id: "user-8" }, record, now: NOW }), "VIBE64_PUBLISH_CONFIRMATION_NOT_PERSON");
});

test("the record stores only a token hash, bound to the plan and person", () => {
  const { token, record } = issuePublishConfirmation({ planHash: PLAN, actor: PERSON, now: NOW });
  assert.match(token, /^[A-Za-z0-9_-]{43}$/u);
  assert.ok(!JSON.stringify(record).includes(token));
  assert.deepEqual({ ...record, tokenHash: "" }, {
    contract: "vibe64.publish-confirmation.v1",
    tokenHash: "",
    planHash: PLAN,
    actorId: "user-7",
    issuedAt: "2026-10-23T10:00:00.000Z",
    expiresAt: "2026-10-23T10:10:00.000Z",
    usedAt: null
  });
  assert.notEqual(issuePublishConfirmation({ planHash: PLAN, actor: PERSON, now: NOW }).token, token);
});

test("a wrong token, a changed plan or an expired confirmation is refused", () => {
  const { token, record } = issuePublishConfirmation({ planHash: PLAN, actor: PERSON, now: NOW, ttlMs: 60_000 });
  refused(() => redeemPublishConfirmation({ token: `${token}x`, planHash: PLAN, actor: PERSON, record, now: NOW }), "VIBE64_PUBLISH_CONFIRMATION_INVALID");
  refused(() => redeemPublishConfirmation({ token: "", planHash: PLAN, actor: PERSON, record, now: NOW }), "VIBE64_PUBLISH_CONFIRMATION_INVALID");
  refused(() => redeemPublishConfirmation({ token, planHash: OTHER_PLAN, actor: PERSON, record, now: NOW }), "VIBE64_PUBLISH_CONFIRMATION_PLAN_CHANGED");
  refused(() => redeemPublishConfirmation({ token, planHash: PLAN, actor: PERSON, record, now: NOW + 60_000 }), "VIBE64_PUBLISH_CONFIRMATION_EXPIRED");
  refused(() => issuePublishConfirmation({ planHash: "plan", actor: PERSON, now: NOW }), "VIBE64_PUBLISH_CONFIRMATION_INVALID");
  refused(() => issuePublishConfirmation({ planHash: PLAN, actor: PERSON, now: NOW, ttlMs: 2 * 60 * 60 * 1000 }), "VIBE64_PUBLISH_CONFIRMATION_INVALID");
});

test("a confirmation is one-shot", () => {
  const { token, record } = issuePublishConfirmation({ planHash: PLAN, actor: PERSON, now: NOW });
  const redeemed = redeemPublishConfirmation({ token, planHash: PLAN, actor: PERSON, record, now: NOW + 1000 });
  assert.equal(redeemed.usedAt, "2026-10-23T10:00:01.000Z");
  assert.equal(record.usedAt, null, "the caller's stored record is not mutated");
  refused(() => redeemPublishConfirmation({ token, planHash: PLAN, actor: PERSON, record: redeemed, now: NOW + 2000 }), "VIBE64_PUBLISH_CONFIRMATION_USED");
});
