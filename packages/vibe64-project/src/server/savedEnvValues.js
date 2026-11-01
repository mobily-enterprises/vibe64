// vibe64.saved-env-values.v1: a host may keep values of its own and fill an
// ordinary project Env variable with one, but only after the person explicitly
// linked that variable. Public never stores such values and never names the
// host: it shows the host's own label and provenance line verbatim.
import { vibe64Error } from "@local/vibe64-core/server/core";
import {
  RUNTIME_CONFIG_OWNERS,
  RUNTIME_CONFIG_SCOPES,
  runtimeConfigKeyIsVibe64Reserved
} from "@local/vibe64-core/server/runtimeConfig";
import { SAVED_ENV_VALUE_SOURCE } from "../shared/contracts.js";

/** @typedef {import("./types.js").SavedEnvValueProvider} SavedEnvValueProvider */

const SAVED_ENV_VALUES_CONTRACT = "vibe64.saved-env-values.v1";
// A composed host provides its saved values to the project and to the agent
// Env command through this token.
const SAVED_ENV_VALUES_TOKEN = "vibe64.env.saved-values";
const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const LABEL_MAX_LENGTH = 200;

/** @param {unknown} provider */
function assertSavedEnvValueProvider(provider) {
  if (
    provider && (typeof provider !== "object" ||
    typeof provider.label !== "string" || !provider.label.trim() ||
    // readable-check: allow method-probe - input validation: a host's saved Env value provider is checked when it is received
    ["valuesForProject", "list", "link", "unlink"].some((method) => typeof provider[method] !== "function"))
  ) {
    throw new TypeError("A saved Env value provider must have a label and expose valuesForProject(), list(), link() and unlink(), or be null.");
  }
}

function unavailable(message = "") {
  return vibe64Error(
    String(message || "Saved values are unavailable right now. Retry in a moment."),
    "vibe64_saved_env_values_unavailable"
  );
}

async function savedValuesNotOffered() {
  return { ok: false, code: "vibe64_saved_env_values_unavailable", error: "This workspace offers no saved values." };
}

/**
 * The workspace without saved values: no label, nothing to fill or list, and
 * nothing to link.
 * @type {SavedEnvValueProvider}
 */
const NO_SAVED_ENV_VALUES = Object.freeze({
  label: "",
  valuesForProject: async () => ({ contract: SAVED_ENV_VALUES_CONTRACT, values: [] }),
  list: async () => ({ ok: true, entries: [] }),
  link: savedValuesNotOffered,
  unlink: savedValuesNotOffered
});

/** @param {SavedEnvValueProvider} provider */
function offersSavedValues(provider) {
  return provider !== NO_SAVED_ENV_VALUES;
}

function savedLabel(value, fallback) {
  const label = typeof value === "string" ? value.trim() : "";
  return label && label.length <= LABEL_MAX_LENGTH && !/[\r\n]/u.test(label) ? label : fallback;
}

/**
 * The Development Env records a host fills for the selected project. Reserved
 * names (VIBE64_*, NODE_OPTIONS) are dropped; anything malformed fails the read.
 * @param {SavedEnvValueProvider} provider
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
  SAVED_ENV_VALUES_CONTRACT,
  SAVED_ENV_VALUES_TOKEN,
  SAVED_ENV_VALUE_SOURCE,
  assertSavedEnvValueProvider,
  offersSavedValues,
  savedEnvValueRecords
};
