// An embedding application may supply a resource-decision control. The editor
// carries only the opaque admission ID; policy, authorization and retry stay with
// that application.
const VIBE64_RESOURCE_RECOVERY_KEY = Symbol("vibe64-resource-recovery");

export { VIBE64_RESOURCE_RECOVERY_KEY };
