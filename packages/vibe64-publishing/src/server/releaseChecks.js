// The preflight checks a release runs: the shared packaging checks, plus the local custody rules for phone install
// keys and the GitHub repository a release tag goes to.
import { VIBE64_PREFLIGHT_CHECKS, definePreflightCheck } from "@local/vibe64-packaging/server";
import { REGISTRY_CHECKS } from "@local/vibe64-packaging/server/preflight/registries";
import { ANDROID_CHECKS } from "@local/vibe64-packaging/server/preflight/android";
import { publishingKeysUnlocked, recoveryKitCovers } from "@local/vibe64-packaging/server/keys";

import { sideloadKeyEntryId } from "./credentialBroker.js";

/**
 * A phone target's install key as preflight and the page judge it.
 */
function installKey(target, keys) {
  const entryId = sideloadKeyEntryId(target);
  return {
    entryId,
    exists: Boolean(target.settings?.certificateSha256 && (keys?.entries || []).some((entry) => entry.id === entryId)),
    coveredByRecoveryKit: recoveryKitCovers(keys, entryId)
  };
}

// Local custody rules that sit on top of the shared checks.
const sideloadKeyReady = definePreflightCheck({
  id: "phone-install-key",
  label: "Phone install key",
  severity: "block",
  applies: ({ plan }) => (plan?.targets || []).some((target) => target.destination === "android-sideload"),
  run: ({ plan, keys }) => {
    const problems = [];
    for (const target of plan.targets.filter((entry) => entry.destination === "android-sideload")) {
      const key = installKey(target, keys);
      if (!key.exists) {
        problems.push(`${target.id} has no install key yet. Create it on its card.`);
      } else if (!key.coveredByRecoveryKit) {
        problems.push(
          `Download a recovery kit that includes ${target.id}'s install key: without it, losing this computer means phones can never update the app.`
        );
      }
    }
    return problems.length ? { ok: false, message: problems.join(" ") } : { ok: true, message: "Install key saved, with a recovery kit." };
  }
});

const githubRepositoryMatches = definePreflightCheck({
  id: "github-release-repository",
  label: "GitHub repository",
  severity: "block",
  applies: ({ plan }) => (plan?.targets || []).some((target) => target.destination === "github-releases"),
  run: ({ plan, baseline }) => {
    const remote = baseline?.remote?.githubRepository || null;
    const wrong = plan.targets.filter((target) => target.destination === "github-releases" && target.settings?.repository !== remote);
    if (!remote) return {
      ok: false,
      message: "GitHub Releases needs this project's remote on GitHub, so the release tag can be pushed there."
    };
    if (wrong.length) return {
      ok: false,
      message: `${wrong.map(({ id }) => id).join(", ")} publishes to another repository than this project's remote (${remote}).`
    };
    return { ok: true, message: `The tag goes to ${remote} with the release.` };
  }
});

const LOCAL_CHECKS = Object.freeze([publishingKeysUnlocked, sideloadKeyReady, githubRepositoryMatches]);
const RELEASE_CHECKS = Object.freeze([...VIBE64_PREFLIGHT_CHECKS, ...REGISTRY_CHECKS, ...ANDROID_CHECKS, ...LOCAL_CHECKS]);

export { RELEASE_CHECKS, installKey };
