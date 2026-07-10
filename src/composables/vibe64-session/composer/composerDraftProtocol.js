const COMPOSER_DRAFT_KIND = Object.freeze({
  DRAFT: "draft",
  SUBMISSION_REJECTED: "submission_rejected",
  SUBMISSION_START: "submission_start"
});

function normalizedDraftKind(value = "") {
  const kind = String(value || "").trim();
  return Object.values(COMPOSER_DRAFT_KIND).includes(kind)
    ? kind
    : COMPOSER_DRAFT_KIND.DRAFT;
}

function normalizedDraftRevision(value = 0) {
  const revision = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(revision) && revision > 0 ? revision : 0;
}

function draftUpdatedAtMs(value = "") {
  const timestamp = Date.parse(String(value || ""));
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export {
  COMPOSER_DRAFT_KIND,
  draftUpdatedAtMs,
  normalizedDraftKind,
  normalizedDraftRevision
};
