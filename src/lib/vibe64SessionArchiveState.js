function sessionArchiveOperation(session) {
  try {
    return JSON.parse(session?.metadata?.session_archive_operation || "null");
  } catch {
    return { status: "failed", error: "Session archive state could not be read." };
  }
}

// What a listed session's server metadata says about its archival. `archiving`
// is true while the server reports a running archive or an archived close that
// has not failed.
function sessionArchiveState(session) {
  const operation = sessionArchiveOperation(session);
  const failed = operation?.status === "failed";
  return {
    archiveError: failed ? operation.error : "",
    archiving: !failed && (
      operation?.status === "running" ||
      session?.metadata?.session_closing_reason === "archived"
    ),
    operation
  };
}

export { sessionArchiveState };
