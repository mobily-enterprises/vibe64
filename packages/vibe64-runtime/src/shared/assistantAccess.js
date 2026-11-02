import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { toText } from "@jskit-ai/kernel/shared/support/normalize";

const VIBE64_ASSISTANT_ACCESS_ERROR_CODES = Object.freeze({
  RESTRICTED: "vibe64_assistant_owner_required",
  UNAVAILABLE: "vibe64_assistant_connection_unavailable"
});

function defineVibe64AssistantAccess(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
  const ownerOnly = source.ownerOnly === true;
  return Object.freeze({
    accessLabel: toText(source.accessLabel) || (ownerOnly ? "Personal use" : "Workspace use"),
    available: source.available !== false,
    connectionIdentity: toText(source.connectionIdentity),
    endpointCode: toText(source.endpointCode),
    // The account the selection needs, named as AI Accounts names it, when the
    // reader knows that this account is what is not connected.
    missingAccountLabel: toText(source.missingAccountLabel),
    ownerOnly
  });
}

function canUseVibe64Assistant(accessValue = {}, vibe64User = null) {
  const access = defineVibe64AssistantAccess(accessValue);
  return access.available && (
    !access.ownerOnly ||
    !vibe64User ||
    vibe64User.role === "owner"
  );
}

function assertCanUseVibe64Assistant(accessValue = {}, vibe64User = null) {
  const access = defineVibe64AssistantAccess(accessValue);
  if (canUseVibe64Assistant(access, vibe64User)) {
    return access;
  }
  if (access.available !== false) {
    throw new AppError(403, "Only the workspace owner can use this personal AI connection.", {
      code: VIBE64_ASSISTANT_ACCESS_ERROR_CODES.RESTRICTED
    });
  }
  if (access.missingAccountLabel) {
    throw new AppError(409, `${access.missingAccountLabel} isn't connected. Reconnect it in AI Accounts or choose another model.`, {
      code: VIBE64_ASSISTANT_ACCESS_ERROR_CODES.UNAVAILABLE,
      messageCode: "vibe64_assistant_account_not_connected",
      messageParams: { accountLabel: access.missingAccountLabel }
    });
  }
  throw new AppError(409, "The selected AI connection is unavailable.", { code: VIBE64_ASSISTANT_ACCESS_ERROR_CODES.UNAVAILABLE });
}

export {
  VIBE64_ASSISTANT_ACCESS_ERROR_CODES,
  assertCanUseVibe64Assistant,
  canUseVibe64Assistant,
  defineVibe64AssistantAccess
};
