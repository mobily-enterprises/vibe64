// Irreversible publish steps run only after the person confirms the exact plan in
// Vibe64's own interface. A confirmation is a one-shot token bound to one plan hash
// and one person, with a short expiry. An assistant can ask for the prompt to open
// but can never be the actor that issues or redeems it. The caller stores the
// returned record (never the token) and persists the redeemed record before acting.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { publishError } from "./errors.js";

const VIBE64_PUBLISH_CONFIRMATION_CONTRACT = "vibe64.publish-confirmation.v1";
const DEFAULT_TTL_MS = 10 * 60 * 1000;
const MAX_TTL_MS = 60 * 60 * 1000;
const PLAN_HASH = /^sha256:[0-9a-f]{64}$/u;

/**
 * @param {string} code
 * @param {string} message
 * @param {{ messageCode?: string }} [options] messageCode: where several sentences share a code callers branch on
 */
function refuse(code, message, options = {}) {
  throw publishError(code, message, undefined, options);
}

function personId(actor) {
  if (actor?.kind !== "person") {
    refuse(
      "VIBE64_PUBLISH_CONFIRMATION_NOT_PERSON",
      "Only the person can confirm publishing, in Vibe64's own confirmation. An assistant's request is not a confirmation.",
      { messageCode: "VIBE64_PUBLISH_CONFIRMATION_ASSISTANT" }
    );
  }
  const id = typeof actor.id === "string" ? actor.id.trim() : "";
  if (!id) {
    refuse(
      "VIBE64_PUBLISH_CONFIRMATION_NOT_PERSON",
      "A publish confirmation needs the confirming person's identity.",
      { messageCode: "VIBE64_PUBLISH_CONFIRMATION_PERSON_REQUIRED" }
    );
  }
  return id;
}

function tokenHash(token) {
  return createHash("sha256").update(String(token)).digest();
}

function timestamp(value, label) {
  const time = typeof value === "number" ? value : Date.parse(value);
  if (!Number.isFinite(time)) throw new TypeError(`${label} must be a time.`);
  return time;
}

function issuePublishConfirmation({ planHash, actor, now = Date.now(), ttlMs = DEFAULT_TTL_MS } = {}) {
  const id = personId(actor);
  if (!PLAN_HASH.test(planHash || "")) {
    refuse(
      "VIBE64_PUBLISH_CONFIRMATION_INVALID",
      "A publish confirmation needs the plan hash.",
      { messageCode: "VIBE64_PUBLISH_CONFIRMATION_PLAN_HASH_REQUIRED" }
    );
  }
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0 || ttlMs > MAX_TTL_MS) {
    refuse(
      "VIBE64_PUBLISH_CONFIRMATION_INVALID",
      "A publish confirmation expires within an hour.",
      { messageCode: "VIBE64_PUBLISH_CONFIRMATION_TTL_TOO_LONG" }
    );
  }
  const issuedAt = timestamp(now, "now");
  const token = randomBytes(32).toString("base64url");
  return {
    token,
    record: {
      contract: VIBE64_PUBLISH_CONFIRMATION_CONTRACT,
      tokenHash: `sha256:${tokenHash(token).toString("hex")}`,
      planHash,
      actorId: id,
      issuedAt: new Date(issuedAt).toISOString(),
      expiresAt: new Date(issuedAt + ttlMs).toISOString(),
      usedAt: null
    }
  };
}

/**
 * Whether `token` is the one this record was issued for (constant-time hash
 * comparison). It says nothing about expiry, use, plan or person.
 */
function publishConfirmationTokenMatches(record, token) {
  if (record?.contract !== VIBE64_PUBLISH_CONFIRMATION_CONTRACT || typeof token !== "string" || !token) return false;
  const expected = Buffer.from(String(record.tokenHash || "").replace(/^sha256:/u, ""), "hex");
  const supplied = tokenHash(token);
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

/**
 * Returns the redeemed record; the caller must persist it (usedAt set) before the
 * irreversible step, so a second redemption of the same record is refused.
 */
function redeemPublishConfirmation({ token, planHash, actor, record, now = Date.now() } = {}) {
  const id = personId(actor);
  if (!publishConfirmationTokenMatches(record, token)) {
    refuse(
      "VIBE64_PUBLISH_CONFIRMATION_INVALID",
      "This publish confirmation is not valid.",
      { messageCode: "VIBE64_PUBLISH_CONFIRMATION_TOKEN_INVALID" }
    );
  }
  if (record.usedAt) {
    refuse("VIBE64_PUBLISH_CONFIRMATION_USED", "This publish confirmation was already used. Confirm again to publish again.");
  }
  if (record.planHash !== planHash) {
    refuse("VIBE64_PUBLISH_CONFIRMATION_PLAN_CHANGED", "The plan changed after it was confirmed. Review and confirm the new plan.");
  }
  if (record.actorId !== id) {
    refuse(
      "VIBE64_PUBLISH_CONFIRMATION_NOT_PERSON",
      "This publish confirmation belongs to someone else.",
      { messageCode: "VIBE64_PUBLISH_CONFIRMATION_OTHER_PERSON" }
    );
  }
  const time = timestamp(now, "now");
  if (time >= timestamp(record.expiresAt, "expiresAt")) {
    refuse("VIBE64_PUBLISH_CONFIRMATION_EXPIRED", "This publish confirmation expired. Confirm the plan again.");
  }
  return { ...record, usedAt: new Date(time).toISOString() };
}

export {
  VIBE64_PUBLISH_CONFIRMATION_CONTRACT,
  issuePublishConfirmation,
  publishConfirmationTokenMatches,
  redeemPublishConfirmation
};
