// The CodeMirror language and line wrapping a source file opens with, chosen
// from its path.
import { EditorView } from "@codemirror/view";
import { StreamLanguage } from "@codemirror/language";
import {
  javascript,
  jsxLanguage,
  tsxLanguage,
  typescriptLanguage
} from "@codemirror/lang-javascript";
import { html } from "@codemirror/lang-html";
import { json } from "@codemirror/lang-json";
import { cpp } from "@codemirror/lang-cpp";
import { markdown } from "@codemirror/lang-markdown";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { sourceEditorPathIsMarkdown } from "@/lib/vibe64SourceFilePaths.js";

function htmlSourceLanguage(options = {}) {
  return html({
    selfClosingTags: true,
    ...options,
    nestedLanguages: [
      {
        attrs: (attrs = {}) => ["ts", "typescript"].includes(String(attrs.lang || "").toLowerCase()),
        parser: typescriptLanguage.parser,
        tag: "script"
      },
      {
        attrs: (attrs = {}) => String(attrs.lang || "").toLowerCase() === "jsx",
        parser: jsxLanguage.parser,
        tag: "script"
      },
      {
        attrs: (attrs = {}) => String(attrs.lang || "").toLowerCase() === "tsx",
        parser: tsxLanguage.parser,
        tag: "script"
      }
    ]
  });
}

function languageExtension(filePath = "") {
  const lowerPath = String(filePath || "").toLowerCase();
  if (lowerPath.endsWith(".vue")) {
    return htmlSourceLanguage({
      matchClosingTags: false
    });
  }
  if (/\.(html|htm|xhtml|svg)$/u.test(lowerPath)) {
    return htmlSourceLanguage();
  }
  if (/\.(js|jsx|mjs|cjs)$/u.test(lowerPath)) {
    return javascript({
      jsx: true
    });
  }
  if (/\.(ts|tsx)$/u.test(lowerPath)) {
    return javascript({
      jsx: lowerPath.endsWith(".tsx"),
      typescript: true
    });
  }
  if (lowerPath.endsWith(".json")) {
    return json();
  }
  if (/\.(c|cc|cpp|cxx|h|hh|hpp|hxx)$/u.test(lowerPath)) {
    return cpp();
  }
  if (/\.(sh|bash|zsh|fish)$/u.test(lowerPath)) {
    return StreamLanguage.define(shell);
  }
  if (sourceEditorPathIsMarkdown(lowerPath)) {
    return markdown();
  }
  return [];
}

function sourceEditorLineWrappingExtension(filePath = "") {
  return sourceEditorPathIsMarkdown(filePath) ? EditorView.lineWrapping : [];
}

export {
  languageExtension,
  sourceEditorLineWrappingExtension
};
