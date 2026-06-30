const DIFF_SECTION_LARGE_BYTES = 300_000;
const DIFF_SECTION_LARGE_LINES = 1_800;

function normalizeDiffText(value = "") {
  return String(value || "").replace(/\r\n/g, "\n").trim();
}

function unquoteGitPath(value = "") {
  const trimmed = String(value || "").trim();
  if (!trimmed.startsWith("\"") || !trimmed.endsWith("\"")) {
    return trimmed;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed.slice(1, -1);
  }
}

function normalizeGitDiffPath(value = "") {
  const path = unquoteGitPath(value).trim();
  if (!path || path === "/dev/null") {
    return "";
  }
  return path.replace(/^[ab]\//u, "");
}

function diffHeaderPath(line = "") {
  const normalized = String(line || "").trim();
  if (!normalized.startsWith("diff --git ")) {
    return "";
  }
  const parts = normalized.slice("diff --git ".length).match(/"[^"]+"|\S+/gu) || [];
  return normalizeGitDiffPath(parts[1] || parts[0] || "");
}

function diffMarkerPath(line = "") {
  const normalized = String(line || "").trim();
  if (!normalized.startsWith("--- ") && !normalized.startsWith("+++ ")) {
    return "";
  }
  return normalizeGitDiffPath(normalized.slice(4).split(/\t/u)[0]);
}

function diffSectionPath(diff = "") {
  const lines = normalizeDiffText(diff).split("\n");
  const plusPath = diffMarkerPath(lines.find((line) => line.startsWith("+++ ")) || "");
  if (plusPath) {
    return plusPath;
  }
  const minusPath = diffMarkerPath(lines.find((line) => line.startsWith("--- ")) || "");
  if (minusPath) {
    return minusPath;
  }
  return diffHeaderPath(lines.find((line) => line.startsWith("diff --git ")) || "");
}

function diffSectionStatus(diff = "") {
  if (/^new file mode /mu.test(diff)) {
    return "added";
  }
  if (/^deleted file mode /mu.test(diff)) {
    return "deleted";
  }
  if (/^rename from /mu.test(diff) || /^rename to /mu.test(diff)) {
    return "renamed";
  }
  if (/^Binary files .+ differ$/mu.test(diff) || /^GIT binary patch$/mu.test(diff)) {
    return "binary";
  }
  return "modified";
}

function countDiffLineChanges(diff = "") {
  return normalizeDiffText(diff).split("\n").reduce((counts, line) => {
    if (line.startsWith("+++") || line.startsWith("---")) {
      return counts;
    }
    if (line.startsWith("+")) {
      counts.added += 1;
    } else if (line.startsWith("-")) {
      counts.removed += 1;
    }
    return counts;
  }, {
    added: 0,
    removed: 0
  });
}

function splitGitDiffText(diff = "") {
  const text = normalizeDiffText(diff);
  if (!text) {
    return [];
  }
  const sections = [];
  let current = [];
  for (const line of text.split("\n")) {
    if (line.startsWith("diff --git ")) {
      if (current.length > 0) {
        sections.push(current.join("\n"));
      }
      current = [line];
      continue;
    }
    if (current.length > 0) {
      current.push(line);
    }
  }
  if (current.length > 0) {
    sections.push(current.join("\n"));
  }
  return sections.length > 0 ? sections : [text];
}

function diffStageSections({
  diff = "",
  stage = "",
  stageLabel = ""
} = {}) {
  return splitGitDiffText(diff).map((sectionDiff, index) => {
    const lineCount = sectionDiff.split("\n").length;
    const path = diffSectionPath(sectionDiff) || `${stage || "diff"} file ${index + 1}`;
    return {
      ...countDiffLineChanges(sectionDiff),
      diff: sectionDiff,
      id: `${stage || "diff"}:${index}:${path}`,
      large: sectionDiff.length > DIFF_SECTION_LARGE_BYTES || lineCount > DIFF_SECTION_LARGE_LINES,
      lineCount,
      path,
      stage,
      stageLabel,
      status: diffSectionStatus(sectionDiff)
    };
  });
}

function sessionDiffSections(payload = {}) {
  return [
    ...diffStageSections({
      diff: payload.stagedDiff,
      stage: "staged",
      stageLabel: "Staged"
    }),
    ...diffStageSections({
      diff: payload.unstagedDiff,
      stage: "unstaged",
      stageLabel: "Unstaged"
    }),
    ...diffStageSections({
      diff: payload.untrackedDiff,
      stage: "untracked",
      stageLabel: "Untracked"
    })
  ];
}

function diffSectionStatusLabel(status = "") {
  switch (status) {
    case "added":
      return "Added";
    case "deleted":
      return "Deleted";
    case "renamed":
      return "Renamed";
    case "binary":
      return "Binary";
    default:
      return "Modified";
  }
}

function filterDiffSections(sections = [], query = "") {
  const normalizedQuery = String(query || "").trim().toLowerCase();
  if (!normalizedQuery) {
    return sections;
  }
  return sections.filter((section) => [
    section.path,
    section.stageLabel,
    diffSectionStatusLabel(section.status)
  ].some((value) => String(value || "").toLowerCase().includes(normalizedQuery)));
}

export {
  DIFF_SECTION_LARGE_BYTES,
  DIFF_SECTION_LARGE_LINES,
  diffSectionStatusLabel,
  filterDiffSections,
  sessionDiffSections
};
