/** @typedef {import("./types.js").SavedEnvValueLinks} SavedEnvValueLinks */

// A composed host lists the saved values a person may link (names,
// descriptions and fields, never values) and links or unlinks one to a project
// Env variable for the agent Env command through this token. The linked values
// themselves reach the project through vibe64.project.saved-env-values.
// Without one the command offers no saved values.
const TERMINALS_SAVED_ENV_VALUE_LINKS_TOKEN = "vibe64.terminals.saved-env-value-links";

/** Linking or unlinking answers that this workspace offers no saved values. */
async function savedValuesNotOffered() {
  return { ok: false, code: "vibe64_saved_env_values_unavailable", error: "This workspace offers no saved values." };
}

/**
 * The workspace without saved values: no label, nothing to list and nothing to link.
 * @type {SavedEnvValueLinks}
 */
const NO_SAVED_ENV_VALUE_LINKS = Object.freeze({
  label: "",
  list: async () => ({ ok: true, entries: [] }),
  link: savedValuesNotOffered,
  unlink: savedValuesNotOffered
});

/**
 * Whether a host supplied saved value links.
 * @param {SavedEnvValueLinks} links
 */
function offersSavedValueLinks(links) {
  return links !== NO_SAVED_ENV_VALUE_LINKS;
}

/**
 * Checks the saved value links a host supplies when they are received.
 * @param {unknown} links
 */
function assertSavedEnvValueLinks(links) {
  if (
    links && (typeof links !== "object" ||
    typeof links.label !== "string" || !links.label.trim() ||
    // readable-check: allow method-probe - input validation: a host's saved Env value links are checked when they are received
    ["list", "link", "unlink"].some((method) => typeof links[method] !== "function"))
  ) {
    throw new TypeError("Saved Env value links must have a label and expose list(), link() and unlink(), or be null.");
  }
}

export {
  NO_SAVED_ENV_VALUE_LINKS,
  TERMINALS_SAVED_ENV_VALUE_LINKS_TOKEN,
  assertSavedEnvValueLinks,
  offersSavedValueLinks
};
