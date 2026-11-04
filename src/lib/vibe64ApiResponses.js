import { isRecord, normalizeObject } from "@jskit-ai/kernel/shared/support/normalize";

// Failures name their message in errors[0], error (text or { message }) or message. A refused request may have no
// body at all.
function vibe64ApiResponseError(response, fallback = "Vibe64 request failed.") {
  const body = normalizeObject(response);
  const error = typeof body.error === "string" ? body.error : body.error?.message;
  return String(body.errors?.[0]?.message || error || body.message || fallback);
}

function vibe64ApiError(response = {}, fallback = "Vibe64 request failed.") {
  const body = normalizeObject(response);
  const error = new Error(vibe64ApiResponseError(response, fallback));
  error.code = String(body.code || body.errors?.[0]?.code || "");
  error.details = isRecord(body.details) ? body.details : null;
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
