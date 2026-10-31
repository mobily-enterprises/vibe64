import crypto from "node:crypto";
import path from "node:path";

import { normalizeText } from "@local/vibe64-core/server/core";
import { SOURCE_EXPLANATION_PROMPT_VERSION, sourceExplanationGuidance } from "@local/vibe64-genesis/server";

import { isPlainObject, sourceEditorError, sourceEditorHash, sourceEditorLanguageForPath } from "./sourceFiles.js";

// The text a source explanation reads and asks with: line ranges and
// selections, bounded code and context, prompts, titles and summaries.
// Source explanations: helper agent routing, cache, cleanup ledger, prompts
// and streamed turns.
const SOURCE_EDITOR_EXPLANATION_CONTEXT_LINES = 6;

const SOURCE_EDITOR_EXPLANATION_CONTEXT_MAX_CHARS = 12_000;

const SOURCE_EDITOR_EXPLANATION_CODE_MAX_CHARS = 60_000;

const SOURCE_EDITOR_EXPLANATION_MAX_LINES = 240;

const SOURCE_EDITOR_EXPLANATION_ANSWER_MAX_CHARS = 5_000;

const SOURCE_EDITOR_FOLLOWUP_ANSWER_MAX_CHARS = 4_000;

const SOURCE_EDITOR_FOLLOWUP_CONTEXT_MAX_CHARS = 8_000;

const SOURCE_EDITOR_FOLLOWUP_MAX_LENGTH = 2000;

const SOURCE_EDITOR_EXPLANATION_PROMPT_VERSION = "source-explanation-chat-v3";

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

function sourceEditorExplanationId() {
  return `exp_${crypto.randomUUID().replaceAll("-", "").slice(0, 18)}`;
}

function sourceEditorExplanationMessageId() {
  return `msg_${crypto.randomUUID().replaceAll("-", "").slice(0, 18)}`;
}

function sourceEditorTextHash(text = "") {
  return sourceEditorHash(Buffer.from(String(text ?? ""), "utf8"));
}

function normalizeSourceEditorLineRange(input = {}, lineCount = 1) {
  const boundedLineCount = Math.max(1, Number(lineCount || 1));
  const startLine = Math.min(boundedLineCount, positiveInteger(input.startLine, 1));
  const endLine = Math.min(boundedLineCount, positiveInteger(input.endLine, startLine));
  return {
    endColumn: positiveInteger(input.endColumn, 1),
    endLine: Math.max(startLine, endLine),
    startColumn: positiveInteger(input.startColumn, 1),
    startLine
  };
}

function sourceEditorRangeWithSelectionColumns(range = {}, input = {}, lines = []) {
  const lastLine = lines[range.endLine - 1] || "";
  const hasEndColumn = Number.isSafeInteger(Number(input.endColumn)) && Number(input.endColumn) > 0;
  const hasStartColumn = Number.isSafeInteger(Number(input.startColumn)) && Number(input.startColumn) > 0;
  const startColumn = hasStartColumn ? range.startColumn : 1;
  const endColumn = hasEndColumn ? range.endColumn : lastLine.length + 1;
  return {
    ...range,
    endColumn: range.startLine === range.endLine
      ? Math.max(startColumn, endColumn)
      : endColumn,
    startColumn
  };
}

function sourceEditorLines(text = "") {
  return String(text ?? "").split(/\r?\n/u);
}

function sourceEditorSelectionForRange(text = "", range = {}) {
  const lines = sourceEditorLines(text);
  const selectedLines = lines
    .slice(range.startLine - 1, range.endLine)
    .map((line, index, selected) => {
      const firstLine = index === 0;
      const lastLine = index === selected.length - 1;
      const startIndex = firstLine
        ? sourceEditorColumnIndex(line, range.startColumn, 0)
        : 0;
      const endIndex = lastLine
        ? sourceEditorColumnIndex(line, range.endColumn, line.length)
        : line.length;
      return line.slice(startIndex, Math.max(startIndex, endIndex));
    });
  return selectedLines.join("\n");
}

function sourceEditorColumnIndex(line = "", column = 1, fallback = 0) {
  const index = positiveInteger(column, fallback + 1) - 1;
  return Math.min(String(line || "").length, Math.max(0, index));
}

function sourceEditorContextWindow(text = "", range = {}) {
  const lines = sourceEditorLines(text);
  const startLine = Math.max(1, range.startLine - SOURCE_EDITOR_EXPLANATION_CONTEXT_LINES);
  const endLine = Math.min(lines.length, range.endLine + SOURCE_EDITOR_EXPLANATION_CONTEXT_LINES);
  return boundedSourceEditorPromptText(lines
    .slice(startLine - 1, endLine)
    .map((line, index) => `${startLine + index}: ${line}`)
    .join("\n"), SOURCE_EDITOR_EXPLANATION_CONTEXT_MAX_CHARS);
}

function boundedSourceEditorPromptText(value = "", maxChars = 0) {
  const text = String(value || "");
  const limit = Math.max(1, Number(maxChars || 0));
  if (text.length <= limit) {
    return text;
  }
  const marker = `\n\n... ${text.length - limit} characters omitted ...\n\n`;
  const available = Math.max(2, limit - marker.length);
  const headLength = Math.ceil(available * 0.6);
  const tailLength = available - headLength;
  return `${text.slice(0, headLength)}${marker}${text.slice(-tailLength)}`;
}

function sourceEditorExplanationPromptCode({
  range = {},
  selectedText = ""
} = {}) {
  const text = String(selectedText || "");
  const lines = sourceEditorLines(text);
  if (
    (range.scope !== "file" || range.presentation === 'description' || lines.length <= SOURCE_EDITOR_EXPLANATION_MAX_LINES) &&
    text.length <= SOURCE_EDITOR_EXPLANATION_CODE_MAX_CHARS
  ) {
    return {
      label: range.scope === "file" ? "File contents" : "Selected code",
      note: "",
      text
    };
  }

  const excerptedByLines = lines.length > SOURCE_EDITOR_EXPLANATION_MAX_LINES;
  const headLineCount = excerptedByLines
    ? Math.ceil(SOURCE_EDITOR_EXPLANATION_MAX_LINES * 0.6)
    : lines.length;
  const tailLineCount = excerptedByLines
    ? SOURCE_EDITOR_EXPLANATION_MAX_LINES - headLineCount
    : 0;
  const omittedLineCount = Math.max(0, lines.length - headLineCount - tailLineCount);
  const excerpt = excerptedByLines
    ? [
        ...lines.slice(0, headLineCount),
        "",
        `... ${omittedLineCount} lines omitted from the middle ...`,
        "",
        ...lines.slice(-tailLineCount)
      ].join("\n")
    : text;
  return {
    label: "File excerpt",
    note: `The whole file has ${lines.length} lines and ${text.length} characters, so this bounded excerpt may omit content. Explain only what the supplied excerpt supports and state any resulting uncertainty.`,
    text: boundedSourceEditorPromptText(excerpt, SOURCE_EDITOR_EXPLANATION_CODE_MAX_CHARS)
  };
}

function sourceEditorExplanationTitle({
  file = {},
  range = {}
} = {}) {
  if (range.scope === "file") {
    return `${path.posix.basename(file.path || "Source")} full file`;
  }
  return `${path.posix.basename(file.path || "Source")} lines ${range.startLine}-${range.endLine}`;
}

function sourceEditorExplanationSummary(text = "") {
  const firstParagraph = String(text || "")
    .split(/\n\s*\n/u)
    .map((line) => line.trim())
    .find(Boolean) || "";
  return firstParagraph.slice(0, 280);
}

function sourceEditorExplanationDisplayPrompt({
  file = {},
  range = {}
} = {}) {
  if (range.scope === "file") {
    return `Explain the whole file ${file.path}.`;
  }
  return `Explain ${file.path}:${range.startLine}-${range.endLine}.`;
}

const SOURCE_EXPLANATION_GENERAL_SHAPE = "Prefer this shape: brief summary; role in the system; how it works; important data/control flow; key dependencies or callers/callees; risks, edge cases, or things to know.";

// Each presentation's prose and its interpretation version sit together.
// Changing the instructions must change the version: saved and cached
// interpretations from the old prose then report as stale, not current.
// Genesis's sourceExplanationGuidance supplies the shared rules (bounded
// context, no tools, the opening overview sentence); these add only the shape.
const SOURCE_EXPLANATION_PRESENTATIONS = Object.freeze({
  description: Object.freeze({
    version: "overview-v6",
    instructions: ({ wholeFile }) => [wholeFile
      ? "After the overview sentence, write a readable file overview in 150–250 words, using fewer words when the artifact is simple. Explain its scope, responsibilities, main parts, behavior and role in the surrounding system, in concise prose or at most 3 bullets for important behavior, configuration, effects, constraints and dependencies. Do not add Inputs or Outputs and use sections, even when the file contains callable exports; parameter and practical-return contracts belong only in function explanations. Describe behavior, not syntax. Distinguish inference or omitted context in one short note only when needed. Do not include a chat greeting, repeat the request, or invent empty sections."
      : SOURCE_EXPLANATION_GENERAL_SHAPE]
  }),
  steps: Object.freeze({
    version: "pseudocode-v6",
    instructions: ({ functionExplanation }) => [
      ...(functionExplanation ? [
        "For a real callable or runtime data interface, the caller's inputs and practical outputs are essential. Include **Inputs** and **Outputs and use** only when each describes a meaningful interface established by this source; absent sections must be omitted, not filled with 'no runtime parameters' or 'does not return data'. Explain observable effects where useful, without disguising them as returned data.",
        "When Inputs applies: name the parameters or runtime configuration callers supply, their practical meaning and expected shape, and important required/optional distinctions, defaults or constraints evidenced by this code. Group related options instead of documenting every parameter.",
        "Outputs and use: state what is actually returned and how callers use it. Name the useful returned fields and operations, what callers read or invoke and what those operations provide. Distinguish live state from snapshots, awaitable results and no useful return value when evidenced. Explain observable effects separately from returned data; merely saying 'returns an object', 'reactive state' or a type name is insufficient.",
        "If a parameter contract, return shape or usage cannot be established from the supplied code, state that briefly rather than guessing. A tiny usage example is welcome only when its calls and member names are evidenced; do not invent callers or dependencies."
      ] : []),
      `After the overview sentence, ${functionExplanation ? "explain the applicable input/output interface, then " : ""}write **Steps** with at most 12 concise numbered steps, within 300 words total. Each step describes an action, decision, effect or return; include meaningful failure conditions in the step where they occur. Group related handlers or returned operations rather than writing an essay about each one. Do not add introductory, API-intent or cache commentary.`
    ]
  })
});

function sourceEditorInterfacePromptVersion(presentation) {
  return `${SOURCE_EDITOR_EXPLANATION_PROMPT_VERSION}:${presentation}:${SOURCE_EXPLANATION_PROMPT_VERSION}:${SOURCE_EXPLANATION_PRESENTATIONS[presentation].version}`;
}

function sourceEditorExplanationPrompt({
  contextWindow = "",
  file = {},
  promptCode = {},
  range = {},
  selectedText = ""
} = {}) {
  const wholeFile = range.scope === "file";
  const functionExplanation = range.scope === "selection" && range.presentation === "steps" && Boolean(range.symbolId);
  const presentation = SOURCE_EXPLANATION_PRESENTATIONS[range.presentation];
  const inlineCode = isPlainObject(promptCode) ? promptCode : {};
  const codeLabel = normalizeText(inlineCode.label) || (wholeFile ? "File contents" : "Selected code");
  const codeNote = normalizeText(inlineCode.note);
  const codeText = String(inlineCode.text ?? selectedText ?? "");
  return [
    "You are Vibe64's senior source-code explainer.",
    "Explain what this code is responsible for in the system. Do not teach language basics and do not explain obvious syntax such as `const`, imports, braces, or function declarations unless they are architecturally relevant.",
    wholeFile
      ? "The user asked about the whole file. Explain the file's role, its major sections, and how other parts of the project are likely to interact with it."
      : "The user selected a specific range. Explain that range first, then explain how it fits into the surrounding file and wider project.",
    ...(presentation ? [
      sourceExplanationGuidance({ presentation: range.presentation, scope: range.scope }),
      ...presentation.instructions({ functionExplanation, wholeFile })
    ] : [
      "Use only the bounded source context supplied below. Do not inspect the repository, use tools, access the network, or edit files. Be explicit when you infer something from context.",
      SOURCE_EXPLANATION_GENERAL_SHAPE
    ]),
    "Be concrete and project-aware. Avoid generic rewrite advice unless there is a direct behavioral risk.",
    `Return concise user-facing Markdown no longer than ${SOURCE_EDITOR_EXPLANATION_ANSWER_MAX_CHARS.toLocaleString("en-US")} characters.`,
    "",
    `File: ${file.path}`,
    `Target: ${wholeFile ? "whole file" : `lines ${range.startLine}-${range.endLine}, columns ${range.startColumn}-${range.endColumn}`}`,
    `Language: ${range.language || file.language || sourceEditorLanguageForPath(file.path)}`,
    "",
    ...(codeNote
      ? [
          "Important context:",
          codeNote,
          ""
        ]
      : []),
    `${codeLabel}:`,
    "```",
    codeText,
    "```",
    "",
    ...(contextWindow
      ? [
          "Nearby context:",
          "```",
          contextWindow,
          "```"
        ]
      : [])
  ].join("\n");
}

function sourceEditorExplanationFollowupMessage(value = "") {
  const message = String(value || "").trim();
  if (!message) {
    throw sourceEditorError("Enter a question before sending a follow-up.", "vibe64_source_explanation_followup_empty");
  }
  if (message.length > SOURCE_EDITOR_FOLLOWUP_MAX_LENGTH) {
    throw sourceEditorError("Follow-up question is too long.", "vibe64_source_explanation_followup_too_large", {
      maxLength: SOURCE_EDITOR_FOLLOWUP_MAX_LENGTH
    }, 413);
  }
  return message;
}

function sourceEditorExplanationFollowupPrompt(explanation = {}, message = "") {
  const range = explanation.sourceRange || {};
  const wholeFile = range.scope === "file";
  return [
    "Continue the Vibe64 source-code explanation thread.",
    wholeFile
      ? "Answer the user's follow-up about the same whole-file explanation and its role in the project."
      : "Answer the user's follow-up about the same selected source range and its role in the project.",
    "Assume the user knows the programming language; focus on project behavior, relationships, data/control flow, risks, and intent.",
    "Use only the bounded context below. Do not inspect the repository, use tools, access the network, or edit files. If the current explanation is stale, say so plainly before answering.",
    `Return concise user-facing Markdown no longer than ${SOURCE_EDITOR_FOLLOWUP_ANSWER_MAX_CHARS.toLocaleString("en-US")} characters.`,
    "",
    `File: ${range.path}`,
    `Target: ${wholeFile ? "whole file" : `lines ${range.startLine}-${range.endLine}, columns ${range.startColumn}-${range.endColumn}`}`,
    explanation.stale ? `Stale status: ${explanation.staleReason || "The source changed."}` : "Stale status: current",
    "",
    "Current explanation summary:",
    explanation.summary || "(none)",
    "",
    "Current explanation body:",
    boundedSourceEditorPromptText(explanation.body || "(none)", SOURCE_EDITOR_FOLLOWUP_CONTEXT_MAX_CHARS),
    "",
    "User follow-up:",
    message
  ].join("\n");
}

export {
  boundedSourceEditorPromptText,
  normalizeSourceEditorLineRange,
  positiveInteger,
  SOURCE_EDITOR_EXPLANATION_ANSWER_MAX_CHARS,
  SOURCE_EDITOR_EXPLANATION_CODE_MAX_CHARS,
  SOURCE_EDITOR_EXPLANATION_CONTEXT_LINES,
  SOURCE_EDITOR_EXPLANATION_CONTEXT_MAX_CHARS,
  SOURCE_EDITOR_EXPLANATION_MAX_LINES,
  SOURCE_EDITOR_EXPLANATION_PROMPT_VERSION,
  SOURCE_EDITOR_FOLLOWUP_ANSWER_MAX_CHARS,
  SOURCE_EDITOR_FOLLOWUP_CONTEXT_MAX_CHARS,
  SOURCE_EDITOR_FOLLOWUP_MAX_LENGTH,
  SOURCE_EXPLANATION_GENERAL_SHAPE,
  SOURCE_EXPLANATION_PRESENTATIONS,
  sourceEditorColumnIndex,
  sourceEditorContextWindow,
  sourceEditorExplanationDisplayPrompt,
  sourceEditorExplanationFollowupMessage,
  sourceEditorExplanationFollowupPrompt,
  sourceEditorExplanationId,
  sourceEditorExplanationMessageId,
  sourceEditorExplanationPrompt,
  sourceEditorExplanationPromptCode,
  sourceEditorExplanationSummary,
  sourceEditorExplanationTitle,
  sourceEditorInterfacePromptVersion,
  sourceEditorLines,
  sourceEditorRangeWithSelectionColumns,
  sourceEditorSelectionForRange,
  sourceEditorTextHash
};
