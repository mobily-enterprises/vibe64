const PREVIEW_DIAGNOSTICS_MAX_TEXT_CHARACTERS = 700000;
const PREVIEW_DIAGNOSTICS_MAX_VALUE_CHARACTERS = 24000;

function clippedDiagnosticsValue(value, limit = PREVIEW_DIAGNOSTICS_MAX_VALUE_CHARACTERS) {
  const text = String(value ?? "");
  return text.length > limit
    ? `${text.slice(0, Math.max(0, limit - 18))}… [truncated]`
    : text;
}

function diagnosticsUrl(value = "") {
  const text = clippedDiagnosticsValue(value, 12000);
  try {
    const url = new URL(text);
    url.searchParams.delete("vibe64_preview_token");
    return url.toString();
  } catch {
    return text;
  }
}

function diagnosticsObject(value = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function diagnosticsHeaders(value = {}) {
  return Object.fromEntries(Object.entries(diagnosticsObject(value))
    .slice(0, 100)
    .map(([name, headerValue]) => [
      clippedDiagnosticsValue(name, 500),
      clippedDiagnosticsValue(headerValue, 4000)
    ]));
}

function diagnosticsJson(value = {}) {
  return JSON.stringify(value, null, 2);
}

function indentedDiagnosticsValue(value = "") {
  const text = clippedDiagnosticsValue(value);
  return text
    ? text.split("\n").map((line) => `    ${line}`).join("\n")
    : "    (empty)";
}

function previewConsoleEntryText(entry = {}) {
  const source = clippedDiagnosticsValue(entry.source || "console", 80);
  const level = clippedDiagnosticsValue(entry.level || "log", 40).toUpperCase();
  const timestamp = clippedDiagnosticsValue(entry.timestamp || "unknown time", 80);
  return `[${timestamp}] [${level}] [${source}] ${clippedDiagnosticsValue(entry.text)}`;
}

function previewNetworkEntryText(entry = {}) {
  const timestamp = clippedDiagnosticsValue(entry.timestamp || "unknown time", 80);
  const kind = clippedDiagnosticsValue(entry.kind || "resource", 80);
  const method = clippedDiagnosticsValue(entry.method || "GET", 40).toUpperCase();
  const phase = clippedDiagnosticsValue(entry.phase || "complete", 40);
  const status = Number(entry.status) || 0;
  const statusText = clippedDiagnosticsValue(entry.statusText || "", 500);
  const durationMs = Number.isFinite(Number(entry.durationMs))
    ? Math.max(0, Number(entry.durationMs))
    : 0;
  const details = [
    `  Result: ${phase}${status ? ` · ${status}${statusText ? ` ${statusText}` : ""}` : ""}${durationMs ? ` · ${durationMs} ms` : ""}`
  ];
  const error = clippedDiagnosticsValue(entry.error || "");
  if (error) {
    details.push(`  Error:\n${indentedDiagnosticsValue(error)}`);
  }
  const requestHeaders = diagnosticsHeaders(entry.requestHeaders);
  if (Object.keys(requestHeaders).length > 0) {
    details.push(`  Request headers:\n${indentedDiagnosticsValue(diagnosticsJson(requestHeaders))}`);
  }
  if (entry.requestBody !== undefined && String(entry.requestBody || "")) {
    details.push(`  Request body:\n${indentedDiagnosticsValue(entry.requestBody)}`);
  }
  const responseHeaders = diagnosticsHeaders(entry.responseHeaders);
  if (Object.keys(responseHeaders).length > 0) {
    details.push(`  Response headers:\n${indentedDiagnosticsValue(diagnosticsJson(responseHeaders))}`);
  }
  if (entry.responseBody !== undefined && String(entry.responseBody || "")) {
    details.push(`  Response body:\n${indentedDiagnosticsValue(entry.responseBody)}`);
  }
  if (Number(entry.transferSize) > 0) {
    details.push(`  Transfer size: ${Number(entry.transferSize)} bytes`);
  }
  return [
    `[${timestamp}] [${kind}] ${method} ${diagnosticsUrl(entry.url) || "(unknown URL)"}`,
    ...details
  ].join("\n");
}

function diagnosticsSection(title, entries = [], formatEntry) {
  const values = Array.isArray(entries) ? entries : [];
  return [
    `## ${title} (${values.length})`,
    values.length > 0 ? values.map(formatEntry).join("\n\n") : "(none captured)"
  ].join("\n");
}

function previewDiagnosticsText(snapshot = {}) {
  const source = diagnosticsObject(snapshot);
  const consoleData = diagnosticsObject(source.console);
  const networkData = diagnosticsObject(source.network);
  const text = [
    "# Vibe64 proxied app diagnostics",
    "",
    "This snapshot was collected inside the proxied app iframe only.",
    `Captured: ${clippedDiagnosticsValue(source.capturedAt || new Date().toISOString(), 80)}`,
    `Page: ${diagnosticsUrl(source.href) || "(unknown)"}`,
    `Title: ${clippedDiagnosticsValue(source.title || "(untitled)", 1000)}`,
    `Dropped console entries before capture: ${Math.max(0, Number(consoleData.droppedEntryCount) || 0)}`,
    `Dropped network entries before capture: ${Math.max(0, Number(networkData.droppedEntryCount) || 0)}`,
    `Routine passive resource entries omitted: ${Math.max(0, Number(networkData.suppressedResourceCount) || 0)}`,
    "Network details retain fetch, XHR, WebSocket activity, and passive resource failures.",
    "",
    diagnosticsSection("Console", consoleData.entries, previewConsoleEntryText),
    "",
    diagnosticsSection("Network", networkData.entries, previewNetworkEntryText),
    ""
  ].join("\n");
  return text.length > PREVIEW_DIAGNOSTICS_MAX_TEXT_CHARACTERS
    ? `${text.slice(0, PREVIEW_DIAGNOSTICS_MAX_TEXT_CHARACTERS - 38)}\n\n[attachment truncated by Vibe64]\n`
    : text;
}

function previewDiagnosticsFileName(date = new Date(), sequence = 1) {
  const captureDate = date instanceof Date ? date : new Date(date);
  const timestamp = captureDate.toISOString().replace(/[:.]/gu, "-");
  return `vibe64-preview-diagnostics-${timestamp}-${String(sequence).padStart(2, "0")}.log`;
}

function previewDiagnosticsFile(snapshot = {}, {
  fileConstructor = globalThis.File,
  now = new Date(),
  sequence = 1
} = {}) {
  if (typeof fileConstructor !== "function") {
    throw new Error("This browser cannot create the preview diagnostics attachment.");
  }
  return new fileConstructor([
    previewDiagnosticsText(snapshot)
  ], previewDiagnosticsFileName(now, sequence), {
    lastModified: now.getTime(),
    type: "text/plain"
  });
}

export {
  PREVIEW_DIAGNOSTICS_MAX_TEXT_CHARACTERS,
  previewDiagnosticsFile,
  previewDiagnosticsFileName,
  previewDiagnosticsText
};
