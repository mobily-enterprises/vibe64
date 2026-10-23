// Irreversible publishing runs only after the person confirms the exact plan in
// Vibe64's own Publish page. An assistant can ask for that confirmation (it then
// appears on the page as a pending request), but it can never open or redeem
// one: confirmations come only from the person's own request on the "api"
// channel. Tokens are never stored; the record keeps their hash.
import path from "node:path";

import {
  issuePublishConfirmation,
  redeemPublishConfirmation
} from "@local/vibe64-packaging/server/confirmationToken";

import { readJsonFile, serialized, writeJsonFile } from "./state/jsonFile.js";

const CONFIRMATIONS_CONTRACT = "vibe64.publishing-confirmations.v1";
const PLAN_HASH = /^sha256:[0-9a-f]{64}$/u;
const KEEP = 20;

function confirmationError(message, code) {
  return Object.assign(new Error(message), { code });
}

// Who is acting, from the execution context: only a person's own page request
// is a person. Colleague turns, automation and internal calls never are.
function confirmingActor({ channel, assistant, user }) {
  if (assistant || channel !== "api") {
    return { kind: "assistant", id: "assistant" };
  }
  return { kind: "person", id: String(user?.id || user?.userKey || user?.username || "local-person") };
}

function createConfirmationService({ runtimeRoot, now = () => Date.now(), ttlMs } = {}) {
  if (!path.isAbsolute(runtimeRoot || "")) throw new TypeError("Confirmations need the project's publishing folder.");
  const file = path.join(runtimeRoot, "confirmations.json");
  const exclusive = serialized();

  async function read() {
    const value = await readJsonFile(file, () => ({ contract: CONFIRMATIONS_CONTRACT, records: [], pendingRequest: null }));
    if (value?.contract !== CONFIRMATIONS_CONTRACT) throw confirmationError("Saved confirmations are not readable.", "vibe64_publishing_state_invalid");
    return value;
  }

  async function write(value) {
    await writeJsonFile(file, { ...value, contract: CONFIRMATIONS_CONTRACT, records: value.records.slice(-KEEP) });
  }

  return Object.freeze({
    file,
    async pendingRequest() {
      return (await read()).pendingRequest || null;
    },
    // An assistant (or the person) asks for the confirmation prompt to open for
    // this plan. Nothing runs; the Publish page shows the request.
    request({ planHash, requestedBy = "assistant" } = {}) {
      return exclusive(async () => {
        if (!PLAN_HASH.test(planHash || "")) throw confirmationError("A confirmation request needs the plan hash.", "vibe64_publishing_confirmation_invalid");
        const value = await read();
        value.pendingRequest = { planHash, requestedBy: requestedBy === "person" ? "person" : "assistant", requestedAt: new Date(now()).toISOString() };
        await write(value);
        return value.pendingRequest;
      });
    },
    dismissRequest() {
      return exclusive(async () => {
        const value = await read();
        value.pendingRequest = null;
        await write(value);
        return null;
      });
    },
    // The person opens the confirmation for one plan: a one-shot token for this
    // page only, bound to the plan hash and to them.
    open({ planHash, actor } = {}) {
      return exclusive(async () => {
        const { token, record } = issuePublishConfirmation({ planHash, actor, now: now(), ...(ttlMs ? { ttlMs } : {}) });
        const value = await read();
        value.records.push(record);
        await write(value);
        return { token, expiresAt: record.expiresAt };
      });
    },
    // Redeems and persists the used record before anything irreversible runs.
    redeem({ planHash, token, actor } = {}) {
      return exclusive(async () => {
        if (actor?.kind !== "person") {
          throw confirmationError("Only you can confirm publishing, on the Publish page. An assistant's request is not a confirmation.", "VIBE64_PUBLISH_CONFIRMATION_NOT_PERSON");
        }
        const value = await read();
        const index = value.records.findIndex((record) => !record.usedAt && record.actorId === actor.id &&
          Date.parse(record.expiresAt) > now() && record.tokenHash && tokenMatches(record, token));
        const record = index === -1 ? value.records.filter((candidate) => candidate.actorId === actor.id).at(-1) : value.records[index];
        if (!record) throw confirmationError("Open the confirmation on the Publish page first.", "VIBE64_PUBLISH_CONFIRMATION_INVALID");
        const redeemed = redeemPublishConfirmation({ token, planHash, actor, record, now: now() });
        value.records[value.records.indexOf(record)] = redeemed;
        if (value.pendingRequest?.planHash === planHash) value.pendingRequest = null;
        await write(value);
        return redeemed;
      });
    }
  });
}

function tokenMatches(record, token) {
  try {
    redeemPublishConfirmation({ token, planHash: record.planHash, actor: { kind: "person", id: record.actorId }, record, now: Date.parse(record.issuedAt) });
    return true;
  } catch {
    return false;
  }
}

export { createConfirmationService, confirmingActor };
