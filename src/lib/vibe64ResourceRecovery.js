import { defineComponent } from "vue";

// An embedding application may supply a resource-decision control. The editor
// carries only the opaque admission ID; policy, authorization and retry stay with
// that application.
const VIBE64_RESOURCE_RECOVERY_KEY = Symbol("vibe64-resource-recovery");

/** What an application without resource decisions supplies: a control that renders nothing. */
const NO_RESOURCE_RECOVERY_CONTROL = defineComponent({
  name: "Vibe64NoResourceRecoveryControl",
  render: () => null
});

export { NO_RESOURCE_RECOVERY_CONTROL, VIBE64_RESOURCE_RECOVERY_KEY };
