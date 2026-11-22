// What an adapter quotes from a toolchain command's output when it refuses or reports.

/** The output's last non-empty line, trimmed. */
function lastLine(text) {
  return String(text || "").trim().split("\n").at(-1).trim();
}

/** The first `error:` line and, when it differs, the last line: a toolchain's own summary of a failure. */
function errorSummary(text) {
  const first = String(text || "").split("\n").find(line => /^error:/u.test(line.trim()));
  const last = lastLine(text);
  return first && first.trim() !== last ? `${first.trim()} (${last})` : last;
}

export { errorSummary, lastLine };
