import { extractMarkedOutput, stripTerminalControlSequences } from "@/lib/codexOutput.js";

const DESLOP_RESULT_MARKER = "deslop_result";
const AUTO_RESOLVE_PRIORITIES = new Set(["high", "medium"]);

function normalizeDeslopPriority(value = "") {
  const priority = String(value || "")
    .trim()
    .replace(/^\[|\]$/gu, "")
    .toLowerCase();
  return ["high", "medium", "low"].includes(priority) ? priority : "";
}

function normalizeDeslopFieldName(value = "") {
  return String(value || "")
    .trim()
    .replace(/[_-]+/gu, " ")
    .toLowerCase();
}

function deslopFieldKey(value = "") {
  const fieldName = normalizeDeslopFieldName(value);
  return {
    category: "category",
    files: "files",
    id: "id",
    priority: "priority",
    reason: "reason",
    "recommended action": "recommendedAction",
    recommended_action: "recommendedAction",
    title: "title"
  }[fieldName] || "";
}

function pushDeslopFinding(findings, finding) {
  const priority = normalizeDeslopPriority(finding.priority);
  const title = String(finding.title || "").trim();
  const reason = String(finding.reason || "").trim();
  if (!priority || (!title && !reason)) {
    return;
  }
  findings.push({
    category: String(finding.category || "").trim(),
    files: Array.isArray(finding.files) ? finding.files.filter(Boolean) : [],
    id: String(finding.id || "").trim(),
    priority,
    reason,
    recommendedAction: String(finding.recommendedAction || "").trim(),
    title
  });
}

function parseDeslopResultBlock(block = "") {
  const findings = [];
  let currentFinding = null;
  let currentField = "";

  for (const rawLine of stripTerminalControlSequences(block).split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    const fieldMatch = /^([A-Za-z][\w -]*):\s*(.*)$/u.exec(line);
    if (fieldMatch) {
      const key = deslopFieldKey(fieldMatch[1]);
      const value = fieldMatch[2].trim();
      if (!key) {
        continue;
      }
      if (key === "priority") {
        if (currentFinding) {
          pushDeslopFinding(findings, currentFinding);
        }
        currentFinding = {
          files: [],
          priority: value
        };
        currentField = "priority";
        continue;
      }
      if (!currentFinding) {
        currentFinding = {
          files: []
        };
      }
      currentField = key;
      if (key === "files") {
        currentFinding.files = value ? [value] : [];
      } else {
        currentFinding[key] = value;
      }
      continue;
    }
    if (!currentFinding) {
      continue;
    }
    if (currentField === "files" && /^-\s+/u.test(line)) {
      currentFinding.files.push(line.replace(/^-\s+/u, "").trim());
      continue;
    }
    if (currentField && currentField !== "priority") {
      currentFinding[currentField] = [currentFinding[currentField], line]
        .filter(Boolean)
        .join("\n");
    }
  }

  if (currentFinding) {
    pushDeslopFinding(findings, currentFinding);
  }

  return findings;
}

function parseDeslopResult(output = "", marker = DESLOP_RESULT_MARKER) {
  return parseDeslopResultBlock(extractMarkedOutput(output, marker || DESLOP_RESULT_MARKER));
}

function deslopFindingsByPriority(findings = [], priorities = AUTO_RESOLVE_PRIORITIES) {
  return findings.filter((finding) => priorities.has(normalizeDeslopPriority(finding.priority)));
}

function deslopFindingLabel(finding = {}, index = 0) {
  return String(finding.id || "").trim() ||
    `finding-${String(index + 1).padStart(2, "0")}`;
}

function formatDeslopFindingForPrompt(finding = {}, index = 0) {
  return [
    `id: ${deslopFindingLabel(finding, index)}`,
    `priority: ${finding.priority}`,
    finding.category ? `category: ${finding.category}` : "",
    finding.title ? `title: ${finding.title}` : "",
    finding.files?.length ? `files: ${finding.files.join(", ")}` : "",
    finding.reason ? `reason: ${finding.reason}` : "",
    finding.recommendedAction ? `recommended_action: ${finding.recommendedAction}` : ""
  ].filter(Boolean).join("\n");
}

function buildResolveDeslopFindingsPrompt(findings = [], template = "") {
  const actionableFindings = findings.filter((finding) => normalizeDeslopPriority(finding.priority));
  const promptTemplate = String(template || "").trim();
  if (!promptTemplate) {
    return "";
  }
  return promptTemplate.replace(
    "{{findings}}",
    actionableFindings.map(formatDeslopFindingForPrompt).join("\n\n")
  ).trim();
}

export {
  AUTO_RESOLVE_PRIORITIES,
  buildResolveDeslopFindingsPrompt,
  deslopFindingsByPriority,
  parseDeslopResult,
  parseDeslopResultBlock
};
