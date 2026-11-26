/**
 * The managed command gateway's runner, loaded when first called. Session work modules name it as their default
 * runner; the session work child always passes its own, so it never loads the gateway's modules, on every work read,
 * update check and Save it runs.
 * @param {object} request
 */
async function runVibe64Command(request) {
  const execution = await import("@local/vibe64-execution/server");
  return execution.runVibe64Command(request);
}

export { runVibe64Command };
