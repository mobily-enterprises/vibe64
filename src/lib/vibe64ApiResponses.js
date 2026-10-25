// Failures name their message in errors[0], error (text or { message }) or message.
function vibe64ApiResponseError(response = {}, fallback = "Vibe64 request failed.") {
  const error = typeof response?.error === "string" ? response.error : response?.error?.message;
  return String(response?.errors?.[0]?.message || error || response?.message || fallback);
}

function vibe64ApiError(response = {}, fallback = "Vibe64 request failed.") {
  const error = new Error(vibe64ApiResponseError(response, fallback));
  error.code = String(response?.code || response?.errors?.[0]?.code || "");
  error.details = response?.details && typeof response.details === "object" && !Array.isArray(response.details)
    ? response.details
    : null;
  error.response = response;
  return error;
}

function vibe64ResourceResponseError(response = null, fallback = "Vibe64 request failed.") {
  if (!response || typeof response !== "object" || response.ok !== false) {
    return "";
  }
  return vibe64ApiResponseError(response, fallback);
}

// An action reports refusal as false or { ok: false }; anything else was accepted.
function vibe64RequestAccepted(result) {
  return result !== false && result?.ok !== false;
}

export {
  vibe64ApiError,
  vibe64ApiResponseError,
  vibe64RequestAccepted,
  vibe64ResourceResponseError
};
