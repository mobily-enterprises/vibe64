const STALE_OPERATION_CODES = new Set([
  "vibe64_action_disabled",
  "vibe64_action_not_available",
  "vibe64_advance_state_changed",
  "vibe64_intent_state_changed",
  "vibe64_stale_command_start",
  "vibe64_step_input_state_changed"
]);

function plainObject(value = null) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function responseDetails(source = {}) {
  return plainObject(source.details);
}

function responseCode(source = {}) {
  return String(source?.code || source?.errors?.[0]?.code || responseDetails(source).code || "").trim();
}

function responseStatus(source = {}) {
  const value = source?.status ?? source?.statusCode ?? responseDetails(source).status ?? responseDetails(source).statusCode ?? null;
  if (value == null || value === "") {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function responseOperationOutcome(source = {}) {
  return String(source?.operationOutcome || responseDetails(source).operationOutcome || "").trim();
}

function responseRefreshRecommended(source = {}) {
  return source?.refreshRecommended === true || responseDetails(source).refreshRecommended === true;
}

function isVibe64StaleOperation(source = {}) {
  const code = responseCode(source);
  const operationOutcome = responseOperationOutcome(source);
  if (responseRefreshRecommended(source)) {
    return true;
  }
  if (operationOutcome === "stale_operation") {
    return true;
  }
  if (operationOutcome === "state_rejected" && STALE_OPERATION_CODES.has(code)) {
    return true;
  }
  return responseStatus(source) === 409 && STALE_OPERATION_CODES.has(code);
}

function vibe64StaleOperationResult(source = {}) {
  const stale = isVibe64StaleOperation(source);
  const operationOutcome = responseOperationOutcome(source);
  return {
    code: responseCode(source),
    ok: false,
    operationOutcome: operationOutcome || (stale ? "stale_operation" : ""),
    refreshRecommended: responseRefreshRecommended(source) || stale,
    stale: true,
    status: responseStatus(source)
  };
}

export {
  isVibe64StaleOperation,
  responseCode,
  responseOperationOutcome,
  responseRefreshRecommended,
  responseStatus,
  vibe64StaleOperationResult
};
