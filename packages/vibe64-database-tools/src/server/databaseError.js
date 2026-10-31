import { vibe64Error } from "@local/vibe64-core/server/core";

// A database tools failure with its code and details.
function databaseError(message, code, details = {}) {
  const error = vibe64Error(message, code);
  error.details = details;
  return error;
}

export { databaseError };
