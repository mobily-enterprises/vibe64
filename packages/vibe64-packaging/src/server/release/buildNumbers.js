// Android refuses an update whose build number (versionCode) does not grow, so
// each app package gets one above every number a release has used, from the
// whole history. Retrying an unfinished release of the same saved commit and
// version keeps its number, so its plan (and confirmation) stays the same.
import { nextVersionCode } from "../packers/capacitor/generateShell.js";

// Statuses of a release that did not finish and can be retried.
const UNFINISHED_RELEASE_STATUSES = Object.freeze(["failed", "partial", "interrupted"]);

// `releases` are the history's records, a run that is no longer live already
// shown as "interrupted"; `packages` are the plan's packages with their version.
function nextBuildNumbers({ releases = [], packages = [], savedCommit = "" } = {}) {
  const used = releases.filter((record) => record.kind === "release");
  const numbers = {};
  for (const entry of packages.filter((candidate) => candidate.packer === "capacitor")) {
    const unfinished = used.find((record) => UNFINISHED_RELEASE_STATUSES.includes(record.status) && record.savedCommit === savedCommit
      && (record.versions?.[entry.id] ?? null) === (entry.version ?? null) && Number.isInteger(record.buildNumbers?.[entry.id]));
    if (unfinished) {
      numbers[entry.id] = unfinished.buildNumbers[entry.id];
      continue;
    }
    const previous = used.map((record) => record.buildNumbers?.[entry.id]).filter(Number.isInteger);
    numbers[entry.id] = nextVersionCode(previous.length ? Math.max(...previous) : null);
  }
  return numbers;
}

export { UNFINISHED_RELEASE_STATUSES, nextBuildNumbers };
