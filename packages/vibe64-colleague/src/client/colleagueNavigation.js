// Runs one pending navigation command in this browser and acknowledges it,
// caching the receipt so a failed acknowledgement retries without navigating
// again. beforeNavigate applies the compact-screen policy first.
function createColleagueNavigation({ scope, navigate, beforeNavigate, acknowledge, error }) {
  let navigating = null;
  let navigationReceipt = null;

  async function handle(command) {
    if (navigating || command?.status !== "pending" || !navigate()) return;
    navigating = command.id;
    const expectedActor = scope().actorKey;
    try {
      const before = beforeNavigate(command);
      if (before) await before;
      if (navigationReceipt?.commandId !== command.id) {
        let receipt;
        try {
          const result = await navigate()(command);
          receipt = { commandId: command.id, clientId: scope().clientId, ok: true,
            ...(command.guide ? { ...(result.focus ? { focus: result.focus } : {}), guide: result.guide } : { focus: result }) };
        }
        catch (error) { receipt = { commandId: command.id, clientId: scope().clientId, ok: false, error: error.message }; }
        if (!scope().mounted || expectedActor !== scope().actorKey) return;
        navigationReceipt = receipt;
      }
      if (!scope().mounted || expectedActor !== scope().actorKey) return;
      await acknowledge(navigationReceipt);
    } catch (cause) { if (scope().mounted && expectedActor === scope().actorKey) error.value = cause.message; }
    finally { if (expectedActor === scope().actorKey) navigating = null; }
  }

  function reset() { navigationReceipt = null; navigating = null; }
  return { handle, reset };
}

export { createColleagueNavigation };
