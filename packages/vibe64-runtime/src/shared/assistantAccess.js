const VIBE64_ASSISTANT_ACCESS_ERROR_CODES = Object.freeze({
  RESTRICTED: "vibe64_assistant_owner_required",
  UNAVAILABLE: "vibe64_assistant_connection_unavailable"
});

function text(value = "") {
  return String(value ?? "").trim();
}

function defineVibe64AssistantAccess(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
  const ownerOnly = source.ownerOnly === true;
  return Object.freeze({
    accessLabel: text(source.accessLabel) || (ownerOnly ? "Personal use" : "Workspace use"),
    available: source.available !== false,
    connectionIdentity: text(source.connectionIdentity),
    endpointCode: text(source.endpointCode),
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
  const unavailable = access.available === false;
  const error = new Error(unavailable
    ? "The selected AI connection is unavailable."
    : "Only the workspace owner can use this personal AI connection.");
  error.code = unavailable
    ? VIBE64_ASSISTANT_ACCESS_ERROR_CODES.UNAVAILABLE
    : VIBE64_ASSISTANT_ACCESS_ERROR_CODES.RESTRICTED;
  error.statusCode = unavailable ? 409 : 403;
  throw error;
}

export {
  VIBE64_ASSISTANT_ACCESS_ERROR_CODES,
  assertCanUseVibe64Assistant,
  canUseVibe64Assistant,
  defineVibe64AssistantAccess
};
