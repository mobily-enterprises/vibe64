import { computed, inject, unref } from "vue";
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
  return record.source === SAVED_ENV_VALUE_SOURCE && record.editable !== true;
}

export function savedEnvValueEnvironment(environmentLabel = "") {
  return String(environmentLabel).toLowerCase() === "production" ? "production" : "development";
}

/**
 * What a host offers to fill Env values from.
 * @typedef {object} SavedEnvValuesHost
 * @property {string} label
 * @property {import("vue").Component | null} component
 */

/** What an application without saved values supplies: nothing to offer. */
export const NO_SAVED_ENV_VALUES = Object.freeze({ label: "", component: null });

/**
 * The host's saved-value picker, or null when it offers none (it may provide null while it has nothing).
 * @returns {import("vue").ComputedRef<SavedEnvValuesHost | null>}
 */
export function useVibe64SavedEnvValues() {
  /** @type {import("vue").MaybeRef<SavedEnvValuesHost | null>} */
  const provided = inject(VIBE64_SAVED_ENV_VALUES_KEY, NO_SAVED_ENV_VALUES);
  return computed(() => {
    const host = unref(provided);
    return host === NO_SAVED_ENV_VALUES ? null : host;
  });
}
