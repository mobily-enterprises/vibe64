import { computed, inject, isRef } from "vue";
import { SAVED_ENV_VALUE_SOURCE } from "@local/vibe64-project/shared/contracts";

// A host that keeps saved values (the vibe64.saved-env-values.v1 contract) may
// let the person fill an Env variable from one. It provides { label, component }
// under this key. Public mounts `component` with the props
// { variable, environment: "development"|"production", secret, placement:
// "env-row"|"env-add"|"integration-credential", projectSlug }, plus the hints
// hasValue (the project already has its own value) and provider (the
// integration's catalogue id) where known. Public reloads Env on its `changed`
// event; `linked` (boolean) reports whether the variable is filled from a
// saved value. Without a provider nothing is rendered.
export const VIBE64_SAVED_ENV_VALUES_KEY = Symbol("vibe64.saved-env-values");

export { SAVED_ENV_VALUE_SOURCE };

export function recordIsSavedEnvValue(record = {}) {
  return record?.source === SAVED_ENV_VALUE_SOURCE && record?.editable !== true;
}

export function savedEnvValueEnvironment(environmentLabel = "") {
  return String(environmentLabel).toLowerCase() === "production" ? "production" : "development";
}

export function useVibe64SavedEnvValues() {
  const provided = inject(VIBE64_SAVED_ENV_VALUES_KEY, null);
  return computed(() => {
    const host = isRef(provided) ? provided.value : provided;
    return host && host.component && typeof host.label === "string" ? host : null;
  });
}
