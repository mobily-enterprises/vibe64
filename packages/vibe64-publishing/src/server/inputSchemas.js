import { createSchema } from "json-rest-schema";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";

function validator(fields) {
  return deepFreeze({ mode: "create", schema: createSchema({ vibe64User: { additionalProperties: true, required: false, type: "object" }, ...fields }) });
}

const text = (maxLength = 200, required = false) => ({ type: "string", noTrim: false, required, maxLength });
const id = (required = true) => ({ type: "string", noTrim: false, required, minLength: 1, maxLength: 64 });
const ids = { type: "array", required: false, maxItems: 50, items: { type: "string", minLength: 1, maxLength: 64 } };
const planHash = { type: "string", noTrim: false, required: true, minLength: 71, maxLength: 71 };
const secret = (maxLength = 4096) => ({ type: "string", noTrim: true, required: true, minLength: 1, maxLength });
const objectOf = (required = false) => ({ type: "object", required, additionalProperties: true });

const publishingStateInput = validator({});
const publishingPrepareInput = validator({ sessionId: id(), versions: objectOf(true), notes: { type: "string", noTrim: true, required: true, minLength: 1, maxLength: 20_000 } });
const publishingTargetAddInput = validator({ destination: id(), package: id(), channel: text(64), account: text(64), settings: objectOf() });
const publishingTargetUpdateInput = validator({ targetId: id(), channel: text(64), account: text(64) });
const publishingTargetInput = validator({ targetId: id() });
const publishingPlanInput = validator({ targetIds: ids, acknowledged: ids });
const publishingPlanHashInput = validator({ planHash, targetIds: ids, acknowledged: ids });
const publishingConfirmInput = validator({ planHash, token: { type: "string", noTrim: true, required: true, minLength: 20, maxLength: 200 }, targetIds: ids, acknowledged: ids });
const publishingReleaseInput = validator({ releaseId: { type: "string", noTrim: false, required: true, minLength: 10, maxLength: 40 } });
const publishingHistoryInput = validator({ limit: { type: "integer", required: false, min: 1, max: 100 } });
const publishingPassphraseInput = validator({ passphrase: secret(1024), windowMinutes: { type: "integer", required: false, min: 1, max: 480 } });
const publishingAccountAddInput = validator({ kind: id(), label: text(80), address: text(300), token: { type: "string", noTrim: true, required: false, maxLength: 4096 }, source: text(20) });
const publishingAccountInput = validator({ accountId: id() });
const publishingRecoveryRestoreInput = validator({ passphrase: secret(1024), data: secret(8 * 1024 * 1024) });
const publishingLicenceAcceptInput = validator({ id: text(100, true), hash: text(100, true) });
const publishingShareInput = validator({ releaseId: { type: "string", noTrim: false, required: true, minLength: 10, maxLength: 40 }, targetId: id() });

export {
  publishingAccountAddInput,
  publishingAccountInput,
  publishingConfirmInput,
  publishingHistoryInput,
  publishingLicenceAcceptInput,
  publishingPassphraseInput,
  publishingPlanHashInput,
  publishingPlanInput,
  publishingPrepareInput,
  publishingRecoveryRestoreInput,
  publishingReleaseInput,
  publishingShareInput,
  publishingStateInput,
  publishingTargetAddInput,
  publishingTargetInput,
  publishingTargetUpdateInput
};
