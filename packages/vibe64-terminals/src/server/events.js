import { createVibe64ProjectChangedPublisher } from "@local/vibe64-project/server/actions";

function createProjectRuntimeChangedPublisher(events) {
  const publishProjectChanged = createVibe64ProjectChangedPublisher({ events });
  return async function publishProjectRuntimeChanged(result = {}, { action = "", dormant = false } = {}) {
    const source = result || {};
    const projectSlug = String(source.projectSlug || "").trim();
    if (source.ok === false || !projectSlug || !source.runtime) {
      return null;
    }
    return publishProjectChanged({ action, projectSlug, runtime: source.runtime,
      ...(action === "runtime-closed" && source.runtime.open === false ? {
        runtimeCloseReason: String(source.reason || "").trim().slice(0, 100),
        ...(dormant === true ? { runtimeDormantClose: true } : {})
      } : {})
    }, { reason: action });
  };
}

export {
  createProjectRuntimeChangedPublisher
};
