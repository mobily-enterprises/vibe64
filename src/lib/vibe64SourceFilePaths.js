// What a source file's path says about it: its name, and whether it is a
// Markdown document.

function basename(filePath = "") {
  const segments = String(filePath || "").split("/");
  return segments.at(-1) || filePath;
}

function sourceEditorPathIsMarkdown(filePath = "") {
  const lowerPath = String(filePath || "").toLowerCase();
  return /\.(md|markdown|todo)$/u.test(lowerPath) || /(^|\/)todo$/u.test(lowerPath);
}

export {
  basename,
  sourceEditorPathIsMarkdown
};
