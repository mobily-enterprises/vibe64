// Wording for saved project versions in the repository workspace.

function formatVersionDate(value = "") {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? "Unknown time"
    : new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short"
      }).format(parsed);
}

/** A saved version's accessible name in the Git log: kind, message, author, time and short commit. */
function versionButtonLabel(version = {}, index = -1) {
  const parts = [
    index === 0 ? "Latest saved version" : "Saved version",
    version.message || "Saved work",
    version.author || "Unknown author",
    formatVersionDate(version.committedAt),
    version.shortCommit
  ];
  if (version.isMerge) {
    parts.splice(1, 0, "merge");
  }
  return parts.filter(Boolean).join(", ");
}

export {
  formatVersionDate,
  versionButtonLabel
};
