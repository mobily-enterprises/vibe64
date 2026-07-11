function vibe64ErrorResponse(error, {
  fallbackCode = "vibe64_request_failed",
  fallbackMessage = "Vibe64 request failed."
} = {}) {
  const code = String(error?.code || fallbackCode);
  const message = String(error?.message || error || fallbackMessage);
  const details = vibe64ErrorDetails(error, code);
  return {
    code,
    details,
    error: message,
    errors: [
      {
        code,
        message
      }
    ],
    ok: false,
    operationOutcome: String(error?.operationOutcome || ""),
    refreshRecommended: error?.refreshRecommended === true,
    sessionId: error?.sessionId || "",
    revision: error?.revision ?? null,
    currentStep: error?.currentStep || "",
    stepRevision: error?.stepRevision ?? null,
    expectedInput: error?.expectedInput || null,
    stepStatus: error?.stepStatus || "",
    projectConfig: error?.projectConfig || null,
    projectType: error?.projectType || null,
    setup: error?.setup || null
  };
}

function vibe64ErrorDetails(error = {}, code = "") {
  const details = error?.details && typeof error.details === "object" && !Array.isArray(error.details)
    ? {
        ...error.details
      }
    : {};
  for (const [key, value] of Object.entries({
    code,
    operationOutcome: String(error?.operationOutcome || ""),
    refreshRecommended: error?.refreshRecommended === true,
    sessionId: error?.sessionId || "",
    revision: error?.revision ?? null,
    currentStep: error?.currentStep || "",
    stepRevision: error?.stepRevision ?? null,
    stepStatus: error?.stepStatus || ""
  })) {
    if (value !== "" && value !== null && value !== false) {
      details[key] = value;
    }
  }
  return Object.keys(details).length > 0 ? details : null;
}

async function vibe64Result(operation, options = {}) {
  try {
    return await operation();
  } catch (error) {
    return vibe64ErrorResponse(error, options);
  }
}

function vibe64StatusCode(response, { missingStatus = 404 } = {}) {
  const code = response?.errors?.[0]?.code || response?.code || "";
  if (code === "vibe64_session_not_found") {
    return missingStatus;
  }
  if (code.startsWith("vibe64_invalid") || code === "vibe64_project_type_missing") {
    return 400;
  }
  if (
    code === "vibe64_action_disabled" ||
    code === "vibe64_action_not_available" ||
    code === "vibe64_command_requires_terminal" ||
    code === "vibe64_project_config_missing" ||
    code === "vibe64_project_not_selected" ||
    code === "vibe64_setup_not_ready" ||
    code === "vibe64_project_not_ready" ||
    code === "vibe64_step_input_state_changed" ||
    code === "vibe64_step_not_ready" ||
    code === "vibe64_project_template_active_sessions" ||
    code === "vibe64_project_template_destination_not_empty" ||
    code === "vibe64_project_template_unavailable"
  ) {
    return 409;
  }
  return response?.ok === false ? 400 : 200;
}

function requestBodyObject(request) {
  const body = request.input?.body || request.body || {};
  return body && typeof body === "object" && !Array.isArray(body) ? body : {};
}

function requestQueryObject(request) {
  const query = request.input?.query || request.query || {};
  return query && typeof query === "object" && !Array.isArray(query) ? query : {};
}

function normalizePlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export {
  vibe64ErrorResponse,
  vibe64Result,
  vibe64StatusCode,
  normalizePlainObject,
  requestBodyObject,
  requestQueryObject
};
