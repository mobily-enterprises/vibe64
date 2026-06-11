function vibe64ApiResponseError(response = {}, fallback = "Vibe64 request failed.") {
  return String(response.errors?.[0]?.message || response.error || response.message || fallback);
}

function vibe64ResourceResponseError(response = null, fallback = "Vibe64 request failed.") {
  if (!response || typeof response !== "object" || response.ok !== false) {
    return "";
  }
  return vibe64ApiResponseError(response, fallback);
}

export {
  vibe64ApiResponseError,
  vibe64ResourceResponseError
};
