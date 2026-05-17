function aiStudioErrorResponse(error, {
  fallbackCode = "ai_studio_request_failed",
  fallbackMessage = "AI Studio request failed."
} = {}) {
  const code = String(error?.code || fallbackCode);
  const message = String(error?.message || error || fallbackMessage);
  return {
    code,
    error: message,
    errors: [
      {
        code,
        message
      }
    ],
    ok: false,
    projectConfig: error?.projectConfig || null,
    projectType: error?.projectType || null,
    setup: error?.setup || null
  };
}

async function aiStudioResult(operation, options = {}) {
  try {
    return await operation();
  } catch (error) {
    return aiStudioErrorResponse(error, options);
  }
}

function aiStudioStatusCode(response, { missingStatus = 404 } = {}) {
  const code = response?.errors?.[0]?.code || "";
  if (code === "ai_studio_session_not_found") {
    return missingStatus;
  }
  if (code.startsWith("ai_studio_invalid") || code === "ai_studio_project_type_missing") {
    return 400;
  }
  if (
    code === "ai_studio_action_disabled" ||
    code === "ai_studio_command_requires_terminal" ||
    code === "ai_studio_project_config_missing" ||
    code === "ai_studio_setup_not_ready" ||
    code === "ai_studio_step_not_ready"
  ) {
    return 409;
  }
  return response?.ok === false ? 400 : 200;
}

function requestBodyObject(request) {
  const body = request.input?.body || request.body || {};
  return body && typeof body === "object" && !Array.isArray(body) ? body : {};
}

function normalizePlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export {
  aiStudioErrorResponse,
  aiStudioResult,
  aiStudioStatusCode,
  normalizePlainObject,
  requestBodyObject
};
