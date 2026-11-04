import { repositoryUpdateRelationship } from "@local/vibe64-core/shared";
import { formatVersionDate } from "@/lib/vibe64RepositoryVersionLabels.js";

// What the repository workspace says about a session's saved work and its updates, read from the workspace's state:
// the session, its current changes, its update check and the project history, the newest repository status either
// reported, and the label of the session's Update action.

/**
 * @typedef {object} RepositoryStatusState
 * @property {string} sessionId
 * @property {{ error: string, loading: boolean, payload: object | null }} changes
 * @property {{ canonicalChangePending: boolean, checking: boolean, error: string, payload: object | null }} updates
 * @property {{ loading: boolean, payload: object | null }} history
 * @property {object | null} repositoryStatus
 * @property {string} sessionUpdateLabel
 */

/** @param {RepositoryStatusState} state */
function summaryTitle({ sessionId, changes, updates }) {
  if (!sessionId) {
    return "Project versions";
  }
  if (changes.loading) {
    return "Checking this session…";
  }
  if (updates.checking || updates.canonicalChangePending) {
    return "Checking the latest saved project version…";
  }
  if (updates.error || !updates.payload) {
    return "Saved project status unavailable";
  }
  if (changes.error || !changes.payload) {
    return "Save status unavailable";
  }
  return changes.payload?.unsaved ? "This session has unsaved work" : "This session is saved";
}

/** @param {RepositoryStatusState} state */
function summaryDetail({ sessionId, changes, updates, repositoryStatus, sessionUpdateLabel }) {
  if (!sessionId) {
    return "Select a session to see its work. Saved project history remains available.";
  }
  if (changes.loading) {
    return "Comparing this session with the project’s saved version.";
  }
  if (updates.checking || updates.canonicalChangePending) {
    return "Save will be available after the latest project version has been checked.";
  }
  if (updates.error || !updates.payload) {
    return "Save is unavailable until Vibe64 can safely compare this session with the saved project.";
  }
  if (changes.error || !changes.payload) {
    return "Check for updates to compare this session with the project’s saved version.";
  }
  const count = Number(changes.payload?.totalCount || 0);
  const behind = Number(repositoryStatus?.behind || 0);
  if (behind > 0) {
    if (changes.payload?.unsaved === true) {
      return `${behind} newer saved ${behind === 1 ? "version is" : "versions are"} available. Updating this session will preserve its unsaved work.`;
    }
    return `${behind} newer saved ${behind === 1 ? "version is" : "versions are"} available. ${sessionUpdateLabel} to use ${behind === 1 ? "it" : "them"}.`;
  }
  if (count > 0) {
    return `${count} ${count === 1 ? "file differs" : "files differ"} from the project’s saved version.`;
  }
  return "No files differ from the project’s saved version.";
}

/** @param {RepositoryStatusState} state */
function updateTitle({ sessionId, updates, history, repositoryStatus }) {
  if (!sessionId) {
    return "No session selected";
  }
  if (updates.checking) {
    return "Checking for updates…";
  }
  if (updates.error) {
    return "Update status unavailable";
  }
  if (history.loading && !history.payload) {
    return "Loading update status…";
  }
  if (!repositoryStatus) {
    return "Updates have not been checked";
  }
  const relationship = repositoryUpdateRelationship(
    repositoryStatus.ahead,
    repositoryStatus.behind
  );
  const ahead = Number(repositoryStatus.ahead || 0);
  const behind = Number(repositoryStatus.behind || 0);
  if (updates.payload?.historyReview) return "The local project history was rewritten";
  if (relationship === "diverged") {
    return "This session and the saved project have both changed";
  }
  if (behind > 0) {
    return `${behind} ${behind === 1 ? "update" : "updates"} available`;
  }
  if (relationship === "ahead" && ahead > 0) {
    return "This session has work not in the saved project";
  }
  return "This session is up to date";
}

/**
 * The saved versions a session behind the project needs, newest first.
 * @param {object | null} repositoryStatus
 */
function incomingVersions(repositoryStatus) {
  const relationship = repositoryUpdateRelationship(
    repositoryStatus?.ahead,
    repositoryStatus?.behind
  );
  return relationship === "behind" && Array.isArray(repositoryStatus?.incomingVersions)
    ? repositoryStatus.incomingVersions
    : [];
}

/** @param {RepositoryStatusState} state */
function updateDetail({ sessionId, changes, updates, history, repositoryStatus }) {
  if (!sessionId) {
    return "Select a session to check it against the project’s saved version.";
  }
  if (updates.checking) {
    return "Reading the latest saved project version.";
  }
  if (updates.error) {
    return "Review the problem below, then try checking again.";
  }
  if (history.loading && !history.payload) {
    return "Reading the last successful update check for this session.";
  }
  if (!repositoryStatus) {
    return "Use Check for updates to compare this session with the latest saved project version.";
  }
  const relationship = repositoryUpdateRelationship(
    repositoryStatus.ahead,
    repositoryStatus.behind
  );
  const ahead = Number(repositoryStatus.ahead || 0);
  const behind = Number(repositoryStatus.behind || 0);
  if (updates.payload?.historyReview) return "Review this session’s retained changes before reconciling them with the new project history.";
  const checked = repositoryStatus.checkedAt
    ? ` Last checked ${formatVersionDate(repositoryStatus.checkedAt)}.`
    : "";
  if (relationship === "diverged") {
    return `Someone saved new project work after this session started, and this session also has its own saved work. Vibe64 cannot simply move it forward. Updating this session will try to combine both without discarding either. If the same files conflict, nothing changes and Fix it with AI can help.${checked}`;
  }
  if (behind > 0) {
    const updateEffect = changes.payload?.unsaved === true
      ? "will replay its unsaved work on the latest saved version before Save is allowed"
      : "will move it to the latest saved version";
    return `This session is ${behind} saved ${behind === 1 ? "version" : "versions"} behind. Updating this session ${updateEffect}.${checked}`;
  }
  if (relationship === "ahead" && ahead > 0) {
    return `There are no incoming updates. This session contains ${ahead} ${ahead === 1 ? "version" : "versions"} not yet in the saved project.${checked}`;
  }
  return `It already includes the latest saved project version.${checked}`;
}

export {
  incomingVersions,
  summaryDetail,
  summaryTitle,
  updateDetail,
  updateTitle
};
