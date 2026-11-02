// How a source explanation reads on screen: its conversation's messages and
// the labels for the source range it explains.
import { normalizeSourceEditorPath } from "@/lib/vibe64SourceEditorLinks.js";

/**
 * The explanation's conversation. Older explanations without messages read as
 * their answer followed by their follow-ups.
 * @param {{ body?: string, followups?: object[], messages?: object[] } | null} explanation
 * @returns {{ id: string, role: string, status?: string, text?: string }[]}
 */
function sourceExplanationMessages(explanation) {
  return Array.isArray(explanation?.messages) && explanation.messages.length
    ? explanation.messages
    : [
        ...(explanation?.body
          ? [{
              id: "body",
              role: "assistant",
              text: explanation.body
            }]
          : []),
        ...(Array.isArray(explanation?.followups) ? explanation.followups : [])
      ];
}

function sourceRangeLineSuffix({
  endLine,
  startLine
} = {}) {
  const start = Number(startLine);
  const end = Number(endLine);
  if (!Number.isFinite(start) || start < 1) {
    return "";
  }
  if (!Number.isFinite(end) || end < 1 || end === start) {
    return `:${start}`;
  }
  return `:${start}-${end}`;
}

function compactSourcePath(path = "", {
  maxLength = 36
} = {}) {
  const normalized = normalizeSourceEditorPath(path);
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `...${normalized.slice(-maxLength)}`;
}

function sourceRangePathDisplayLabel(range = {}) {
  const path = normalizeSourceEditorPath(range?.path);
  if (!path) {
    return "Source";
  }
  return compactSourcePath(path);
}

function sourceRangeDisplayLabel(range = {}) {
  const path = normalizeSourceEditorPath(range?.path);
  if (!path) {
    return "Source";
  }
  return `${path}${sourceRangeLineSuffix(range)}`;
}

export {
  sourceExplanationMessages,
  sourceRangeDisplayLabel,
  sourceRangeLineSuffix,
  sourceRangePathDisplayLabel
};
