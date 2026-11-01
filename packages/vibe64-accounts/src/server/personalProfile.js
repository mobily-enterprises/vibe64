import { authError } from "./accountsRuntime.js";

/** @typedef {import("@local/vibe64-core/server/types").PersonalAiProfileStore} PersonalAiProfileStore */

/**
 * The installation's personal AI profile, which a standalone local runtime keeps: Accounts status carries it and
 * the person saves their preferred name.
 * @param {object} dependencies
 * @param {PersonalAiProfileStore} dependencies.store
 */
function createPersonalProfile({ store }) {
  /**
   * The status fields that carry the saved profile.
   */
  async function statusFields() {
    return {
      personalProfile: {
        ...(await store.read()),
        available: true,
        scope: "installation"
      }
    };
  }

  /**
   * @param {object} input
   * @param {string} input.preferredName
   */
  async function save(input) {
    return {
      ok: true,
      personalProfile: {
        ...(await store.write({
          preferredName: input.preferredName
        })),
        available: true,
        scope: "installation"
      }
    };
  }

  return Object.freeze({
    statusFields,
    save
  });
}

/**
 * A runtime without a personal profile: status leaves it out.
 */
async function noPersonalProfileStatusFields() {
  return {};
}

/**
 * A runtime without a personal profile refuses a save.
 */
async function refusePersonalProfileSave() {
  return authError(
    "personal_profile_unavailable",
    "Personal profile settings are not available in this Vibe64 runtime."
  );
}

/** The personal profile of a runtime that keeps none. */
const NO_PERSONAL_PROFILE = Object.freeze({
  statusFields: noPersonalProfileStatusFields,
  save: refusePersonalProfileSave
});

export { createPersonalProfile, NO_PERSONAL_PROFILE };
