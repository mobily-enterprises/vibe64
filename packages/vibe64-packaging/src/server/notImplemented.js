import { publishError } from "./errors.js";

// Registry entries exist before their implementation lands; calling one fails honestly.
function notImplemented(kind, id, operation) {
  return async () => {
    throw publishError(
      "VIBE64_PUBLISH_NOT_IMPLEMENTED",
      `The ${id} ${kind} cannot ${operation} yet.`,
      { kind, id, operation }
    );
  };
}

export { notImplemented };
