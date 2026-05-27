function resolveResponseErrorMessage(response = {}, fallback = "Vibe64 request failed.") {
  return String(response?.errors?.[0]?.message || response?.error || fallback);
}

export {
  resolveResponseErrorMessage
};
