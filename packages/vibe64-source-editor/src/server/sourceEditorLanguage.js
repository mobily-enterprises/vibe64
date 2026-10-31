import path from "node:path";

// The editor language of a file, from its name.
function sourceEditorLanguageForPath(filePath = "") {
  const basename = path.posix.basename(String(filePath || "")).toLowerCase();
  const extension = path.posix.extname(basename);
  if ([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".vue"].includes(extension)) {
    return "javascript";
  }
  if (extension === ".json") {
    return "json";
  }
  if ([".c", ".cc", ".cpp", ".cxx", ".h", ".hh", ".hpp", ".hxx"].includes(extension)) {
    return "cpp";
  }
  if ([".sh", ".bash", ".zsh", ".fish"].includes(extension) || ["bashrc", "zshrc"].includes(basename)) {
    return "shell";
  }
  if ([".md", ".markdown", ".todo"].includes(extension) || basename === "todo") {
    return "markdown";
  }
  return "text";
}

export {
  sourceEditorLanguageForPath
};
