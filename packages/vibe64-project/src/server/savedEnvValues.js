// vibe64.saved-env-values.v1: a host may keep values of its own and fill an
// ordinary project Env variable with one, but only after the person explicitly
// linked that variable. Public never stores such values and never names the
// host: it shows the host's own label and provenance line verbatim. This is the
// read side, the values the project's Development Env receives; listing,
// linking and unlinking belong to the agent Env command's
// vibe64.terminals.saved-env-value-links capability.
import { vibe64Error } from "@local/vibe64-core/server/core";
import {
  RUNTIME_CONFIG_OWNERS,
  RUNTIME_CONFIG_SCOPES,
  runtimeConfigKeyIsVibe64Reserved
} from "@local/vibe64-core/server/runtimeConfig";
import { SAVED_ENV_VALUE_SOURCE } from "../shared/contracts.js";

/** @typedef {import("./types.js").SavedEnvValues} SavedEnvValues */

const SAVED_ENV_VALUES_CONTRACT = "vibe64.saved-env-values.v1";
// A composed host provides the values it fills into the project's Development
// Env through this token.
const PROJECT_SAVED_ENV_VALUES_TOKEN = "vibe64.project.saved-env-values";
const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const LABEL_MAX_LENGTH = 200;

/**
 * Checks the saved values a host supplies when they are received.
 * @param {unknown} values
 */
function assertSavedEnvValues(values) {
  if (
    values && (typeof values !== "object" ||
    typeof values.label !== "string" || !values.label.trim() ||
    // readable-check: allow method-probe - input validation: a host's saved Env values are checked when they are received
    typeof values.valuesForProject !== "function")
  ) {
    throw new TypeError("Saved Env values must have a label and expose valuesForProject(), or be null.");
  }
}

function unavailable(message = "") {
  return vibe64Error(
    String(message || "Saved values are unavailable right now. Retry in a moment."),
    "vibe64_saved_env_values_unavailable"
  );
}

/**
 * The workspace without saved values: no label and nothing to fill.
 * @type {SavedEnvValues}
 */
const NO_SAVED_ENV_VALUES = Object.freeze({
  label: "",
  valuesForProject: async () => ({ contract: SAVED_ENV_VALUES_CONTRACT, values: [] })
});

/**
 * Whether a host supplied saved values.
 * @param {SavedEnvValues} values
 */
function offersSavedValues(values) {
  return values !== NO_SAVED_ENV_VALUES;
}

function savedLabel(value, fallback) {
  const label = typeof value === "string" ? value.trim() : "";
  return label && label.length <= LABEL_MAX_LENGTH && !/[\r\n]/u.test(label) ? label : fallback;
}

/**
 * The Development Env records a host fills for the selected project. Reserved
 * names (VIBE64_*, NODE_OPTIONS) are dropped; anything malformed fails the read.
 * @param {SavedEnvValues} provider
 * @param {{ projectContextRoot: string, projectRuntimeRoot: string, projectSlug: string }} input
 */
async function savedEnvValueRecords(provider, input) {
  let result;
  try {
    result = await provider.valuesForProject(input);
  } catch (error) {
    throw unavailable(error?.message);
  }
  if (result?.ok === false) throw unavailable(result.error);
  if (result?.contract !== SAVED_ENV_VALUES_CONTRACT || !Array.isArray(result.values)) {
    throw unavailable("Saved values were returned in an unknown format.");
  }
  const records = [];
  const seen = new Set();
  for (const entry of result.values) {
    const key = typeof entry?.key === "string" ? entry.key.trim() : "";
    if (!KEY_PATTERN.test(key) || typeof entry.value !== "string" || seen.has(key)) {
      throw unavailable("Saved values were returned in an unknown format.");
    }
    seen.add(key);
    if (runtimeConfigKeyIsVibe64Reserved(key) || key === "NODE_OPTIONS") continue;
    records.push({
      editable: false,
      key,
      label: savedLabel(entry.label, provider.label.trim()),
      owner: RUNTIME_CONFIG_OWNERS.SYSTEM,
      requiredFor: [],
      scope: RUNTIME_CONFIG_SCOPES.DEV,
      secret: entry.secret !== false,
      source: SAVED_ENV_VALUE_SOURCE,
      value: entry.value,
      valuePresent: entry.value.length > 0
    });
  }
  return records;
}

export {
  NO_SAVED_ENV_VALUES,
  PROJECT_SAVED_ENV_VALUES_TOKEN,
  SAVED_ENV_VALUES_CONTRACT,
  SAVED_ENV_VALUE_SOURCE,
  assertSavedEnvValues,
  offersSavedValues,
  savedEnvValueRecords
};
