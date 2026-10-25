// Preflight for registry releases (npm, PyPI, GitHub Releases). The checks stay
// pure over facts the caller gathered; gatherCredentialFacts is the one helper
// that asks each destination, read-only, whether its sign-in works.
import { vibe64Destination } from "../destinations/index.js";
import { credentialSpecs, withStageCredentials } from "../stages.js";
import { VIBE64_PREFLIGHT_CHECKS, definePreflightCheck } from "./index.js";

// facts.tags: [{ tag, commit }] for every existing tag the plan would create.
const releaseTagsFree = definePreflightCheck({
  id: "release-tags-free",
  label: "Release tags",
  severity: "block",
  run: ({ plan = {}, tags = [] }) => {
    const taken = (plan.tags || []).flatMap((tag) => tags.filter((entry) => entry.tag === tag && entry.commit !== plan.savedCommit));
    if (taken.length) {
      return { ok: false, message: `${taken.map(({ tag }) => tag).join(", ")} already names a different commit. Choose a new version.` };
    }
    return { ok: true, message: (plan.tags || []).length ? `Will tag ${plan.tags.join(", ")} on the saved commit.` : "No tag needed." };
  }
});

// facts.verification: { commit, status: "passed" | "failed" | "running" | ... }
// from the project's own ## Verification on exactly the saved commit.
const verificationPassed = definePreflightCheck({
  id: "verification-passed",
  label: "Checks on the saved commit",
  severity: "block",
  run: ({ plan = {}, verification = null }) => {
    if (!verification || verification.commit !== plan.savedCommit) {
      return { ok: false, message: "Run the project's checks on the saved commit before releasing." };
    }
    if (verification.status !== "passed") return { ok: false, message: "The project's checks did not pass on the saved commit." };
    return { ok: true, message: "The project's checks passed on the saved commit." };
  }
});

// facts.credentials: { [targetId]: { ok, verified, message } } from gatherCredentialFacts.
const credentialsValid = definePreflightCheck({
  id: "credentials-valid",
  label: "Publishing sign-ins",
  severity: "block",
  run: ({ plan = {}, credentials = {} }) => {
    const failing = (plan.targets || []).filter((target) => credentials[target.id]?.ok !== true);
    if (failing.length) {
      return { ok: false, message: failing.map((target) => credentials[target.id]?.message || `${target.id} has no working sign-in.`).join(" ") };
    }
    const unverified = (plan.targets || []).filter((target) => credentials[target.id]?.verified === false).map(({ id }) => id);
    return {
      ok: true,
      message: unverified.length ? `Sign-ins found; ${unverified.join(", ")} can only be proven by the upload.` : "Every sign-in works."
    };
  }
});

// The registry checks alone, and composed after the shared checks.
const REGISTRY_CHECKS = Object.freeze([releaseTagsFree, verificationPassed, credentialsValid]);
const VIBE64_REGISTRY_PREFLIGHT_CHECKS = Object.freeze([...VIBE64_PREFLIGHT_CHECKS, ...REGISTRY_CHECKS]);

// targets: the plan's targets with their settings; obtainCredential as for Stage 2.
async function gatherCredentialFacts({ targets = [], obtainCredential, tempRoot, toolchains = {} } = {}) {
  const facts = {};
  for (const target of targets) {
    const destination = vibe64Destination(target.destination);
    if (typeof destination.verifyCredential !== "function") {
      facts[target.id] = { ok: false, message: `${destination.label} cannot be released to yet.` };
      continue;
    }
    try {
      facts[target.id] = await withStageCredentials({
        credentials: credentialSpecs(destination, "credentials", target),
        obtainCredential,
        tempRoot
      }, (credentials) => destination.verifyCredential({ target, credentials, toolchains }));
    } catch (error) {
      facts[target.id] = { ok: false, message: error?.message || `${destination.label} sign-in could not be checked.` };
    }
  }
  return facts;
}

export { REGISTRY_CHECKS, VIBE64_REGISTRY_PREFLIGHT_CHECKS, gatherCredentialFacts };
