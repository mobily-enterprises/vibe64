// The words for a crash record (crashRecords.js), the same in the editor's banner, its Crashes page, a bug report
// and a chat note about an interrupted turn. Times are left to the reader, who shows them in the viewer's own zone.

/**
 * What happened, in one line: the error's message (with its name when that says more than Error), or that the
 * process stopped without a trace, with the exit the host gave.
 * @param {any} record
 */
function crashMessage(record = {}) {
  if (record.kind === "stopped-without-trace") {
    const exit = [record.exit?.result, record.exit?.code, record.exit?.status].filter(Boolean).join(", ");
    return exit ? `it stopped without a trace (${exit})` : "it stopped without a trace";
  }
  if (record.kind === "unreadable") return "its crash record could not be read";
  const name = String(record.error?.name || "").trim();
  const message = String(record.error?.message || "").trim();
  if (!message) return name || "an unknown error";
  return name && name !== "Error" ? `${name}: ${message}` : message;
}

/**
 * What became of the AI work running when it crashed, or "" when that is not known yet.
 * @param {any} record
 */
function crashTurnsText(record = {}) {
  const active = record.activeTurns;
  if (!Number.isSafeInteger(active)) return "";
  if (active === 0) return "No AI work was running.";
  const resumed = Number.isSafeInteger(record.resumed) ? record.resumed : 0;
  if (resumed >= active) return active === 1 ? "The AI work that was running was resumed." : `The ${active} AI turns that were running were resumed.`;
  if (resumed === 0) return active === 1 ? "The AI work that was running was stopped." : `The ${active} AI turns that were running were stopped.`;
  return `${resumed} of the ${active} AI turns that were running were resumed; the others were stopped.`;
}

/**
 * Everything a record says, as plain text to paste into a bug report.
 * @param {any} record
 */
function crashBugReport(record = {}) {
  const lines = [
    `Vibe64 crash: ${crashMessage(record)}`,
    `Recorded: ${record.at || "unknown"}`,
    `Kind: ${record.kind}${record.origin ? ` (${record.origin})` : ""}`,
    `Version: ${record.version || "unknown"}`,
    `Process: ${record.pid ?? "unknown"}, up ${record.uptimeSeconds ?? "unknown"} s`
  ];
  if (record.lastHeartbeatAt !== undefined) lines.push(`Last heard from: ${record.lastHeartbeatAt || "unknown"}`);
  if (record.exit) lines.push(`Exit (from the host): ${JSON.stringify(record.exit)}`);
  lines.push(`AI turns working: ${record.activeTurns ?? "not counted"}, resumed: ${record.resumed ?? "not reported"}`);
  if (record.error) {
    lines.push(`Error: ${record.error.name || "Error"}: ${record.error.message || ""}${record.error.code ? ` (code ${record.error.code})` : ""}`);
    if (record.error.stack) lines.push("", record.error.stack);
  }
  return `${lines.join("\n")}\n`;
}

export { crashBugReport, crashMessage, crashTurnsText };
