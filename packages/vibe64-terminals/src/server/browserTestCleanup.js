function browserTestNeedsCleanup(result) {
  return ["vibe64_execution_cleanup_required", "vibe64_execution_drain_failed"].includes(result?.code)
    && result?.execution?.state !== "rejected";
}

async function drainBrowserTestExecutions(executionIds, stopExecution) {
  // Keep unproven IDs for the caller's next explicit recovery attempt.
  for (const id of executionIds) {
    const stopped = await stopExecution(id, { reason: "browser-test-cancelled" }).catch(() => null);
    if (stopped?.scopeEmpty === true) executionIds.delete(id);
  }
}

export {
  browserTestNeedsCleanup,
  drainBrowserTestExecutions
};
