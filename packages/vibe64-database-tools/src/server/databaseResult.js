import { vibe64Result } from "@local/vibe64-core/server/serverResponses";

/**
 * Runs a database tools operation and returns its result, or a failure
 * response carrying the error's code and message.
 */
function databaseResult(operation) {
  return vibe64Result(operation, {
    fallbackCode: "vibe64_database_operation_failed",
    fallbackMessage: "The session database operation failed."
  });
}

export { databaseResult };
