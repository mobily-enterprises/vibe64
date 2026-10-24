import { PUBLISHING_ACTIONS } from "./actions.js";

// Colleague's `publication` watch source: the project's latest release, read
// through the publication state action under the watcher's own project access
// (and Learn/Develop rule), never from files directly.

function releaseName(release) {
  return release.tags?.[0] || Object.values(release.versions || {})[0] || "The latest release";
}

function summary(release) {
  if (!release) return "Nothing has been released from this project yet.";
  const name = releaseName(release);
  if (release.status === "running") return `${name} is being released.`;
  if (release.status === "succeeded") return `${name} is live on every target.`;
  if (release.status === "partial") return `${name} reached only some of its targets.`;
  if (release.status === "interrupted") return `${name} stopped before it finished.`;
  return `${name} failed.`;
}

function publicationWatchSource({ actions }) {
  return {
    id: "publication",
    label: "Publication",
    description: "A project's latest release from its Publish page: whether it is live on every target, still running, or failed.",
    input: { projectSlug: "The exact project slug." },
    conditions: {
      live: "The latest release is live on every target (reported at once if it already is).",
      failed: "The latest release failed, reached only some targets, or stopped before it finished.",
      changed: "Anything about the latest release changed: a release started, finished or failed."
    },
    async read({ projectSlug }, context) {
      const state = await actions.execute({ actionId: PUBLISHING_ACTIONS.STATE_READ, input: {}, context: { ...context, projectSlug } });
      if (state?.ok === false) {
        throw Object.assign(new Error(state.error || "The publication could not be read."), { statusCode: state.statusCode || 409 });
      }
      const release = (state.releases || []).find((record) => record.kind === "release") || null;
      return {
        fingerprint: JSON.stringify([release?.id || "", release?.status || ""]),
        summary: summary(release),
        conditionsMet: release?.status === "succeeded" ? ["live"]
          : ["failed", "partial", "interrupted"].includes(release?.status) ? ["failed"] : []
      };
    }
  };
}

export { publicationWatchSource };
