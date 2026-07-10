import {
  draftFieldsEqual,
  normalizedDraftFields
} from "@/composables/vibe64-session/composer/composerDraftFields.js";
import {
  draftUpdatedAtMs
} from "@/composables/vibe64-session/composer/composerDraftProtocol.js";

function textChangeSpan(base = "", next = "") {
  const baseText = String(base || "");
  const nextText = String(next || "");
  if (baseText === nextText) {
    return null;
  }
  let start = 0;
  while (
    start < baseText.length &&
    start < nextText.length &&
    baseText[start] === nextText[start]
  ) {
    start += 1;
  }
  let suffix = 0;
  while (
    suffix < baseText.length - start &&
    suffix < nextText.length - start &&
    baseText[baseText.length - 1 - suffix] === nextText[nextText.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  return {
    end: baseText.length - suffix,
    start,
    text: nextText.slice(start, nextText.length - suffix)
  };
}

function textSpansOverlap(left = {}, right = {}) {
  if (left.start === right.start && left.end === right.end) {
    return true;
  }
  return left.start < right.end && right.start < left.end;
}

function applyTextSpan(source = "", span = {}) {
  const text = String(source || "");
  return `${text.slice(0, span.start)}${String(span.text || "")}${text.slice(span.end)}`;
}

function applyNonOverlappingTextSpans(base = "", spans = []) {
  return [...spans]
    .sort((left, right) => right.start - left.start)
    .reduce((text, span) => applyTextSpan(text, span), String(base || ""));
}

function mergeDraftText({
  appendLocalOnEmptyBaseConflict = false,
  base = "",
  local = "",
  localEditedAt = 0,
  remote = "",
  remoteUpdatedAt = ""
} = {}) {
  const baseText = String(base || "");
  const localText = String(local || "");
  const remoteText = String(remote || "");
  if (localText === remoteText) {
    return {
      text: localText,
      winner: "same"
    };
  }
  if (localText === baseText) {
    return {
      text: remoteText,
      winner: "remote"
    };
  }
  if (remoteText === baseText) {
    return {
      text: localText,
      winner: "local"
    };
  }
  if (appendLocalOnEmptyBaseConflict && !baseText && localText && remoteText) {
    return {
      text: `${remoteText.trimEnd()}\n\n${localText.trimStart()}`,
      winner: "merged"
    };
  }
  const localSpan = textChangeSpan(baseText, localText);
  const remoteSpan = textChangeSpan(baseText, remoteText);
  if (localSpan && remoteSpan && !textSpansOverlap(localSpan, remoteSpan)) {
    return {
      text: applyNonOverlappingTextSpans(baseText, [
        localSpan,
        remoteSpan
      ]),
      winner: "merged"
    };
  }
  return draftUpdatedAtMs(remoteUpdatedAt) >= Number(localEditedAt || 0)
    ? {
        text: remoteText,
        winner: "remote"
      }
    : {
        text: localText,
        winner: "local"
      };
}

function mergeDraftFields({
  appendLocalOnEmptyBaseConflict = false,
  baseFields = {},
  localEditedAt = 0,
  localFields = {},
  remoteFields = {},
  remoteUpdatedAt = ""
} = {}) {
  const base = normalizedDraftFields(baseFields);
  const local = normalizedDraftFields(localFields);
  const remote = normalizedDraftFields(remoteFields);
  const fieldNames = new Set([
    ...Object.keys(base),
    ...Object.keys(local),
    ...Object.keys(remote)
  ]);
  const fields = {};
  for (const fieldName of fieldNames) {
    fields[fieldName] = mergeDraftText({
      appendLocalOnEmptyBaseConflict,
      base: base[fieldName],
      local: local[fieldName],
      localEditedAt,
      remote: remote[fieldName],
      remoteUpdatedAt
    }).text;
  }
  return {
    fields,
    shouldPublish: !draftFieldsEqual(fields, remote)
  };
}

export {
  mergeDraftFields,
  mergeDraftText
};
