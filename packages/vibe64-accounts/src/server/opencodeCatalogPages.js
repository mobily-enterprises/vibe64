import { aiConnectionError } from "./aiConnectionError.js";

// Reads every page of the OpenCode capability catalogue. With a
// modelProviderId the rows are that provider's models; without one they are
// the engine's providers. The first page's result, engine and provider are
// returned for the caller's metadata.
async function readAllOpenCodeCapabilityRows(readCapabilities, { modelProviderId = "" } = {}) {
  const rows = [];
  const seenCursors = new Set();
  let cursor = "";
  let first = null;
  do {
    const result = await readCapabilities({
      ...(cursor ? { cursor } : {}),
      engineId: "opencode",
      limit: "100",
      ...(modelProviderId ? { modelProviderId } : {})
    });
    const engine = Array.isArray(result?.engines)
      ? result.engines.find((candidate) => candidate?.engineId === "opencode")
      : null;
    if (!engine) {
      throw aiConnectionError("vibe64_ai_catalog_invalid", "OpenCode returned an invalid provider catalog.", 502);
    }
    const provider = modelProviderId && Array.isArray(engine.modelProviders)
      ? engine.modelProviders.find((candidate) => candidate?.id === modelProviderId) || null
      : null;
    if (modelProviderId && !provider) {
      throw aiConnectionError("vibe64_ai_provider_unavailable",
        "The current OpenCode catalog did not return this provider.", 404);
    }
    first ||= { result, engine, provider };
    const pageRows = modelProviderId ? provider.models : engine.modelProviders;
    rows.push(...(Array.isArray(pageRows) ? pageRows : []));
    cursor = engine.page?.hasMore === true ? String(engine.page.nextCursor || "").trim() : "";
    if (cursor && seenCursors.has(cursor)) {
      throw aiConnectionError("vibe64_ai_catalog_cursor_stalled",
        "OpenCode could not finish reading its provider catalog.", 502);
    }
    if (cursor) seenCursors.add(cursor);
  } while (cursor);
  return { ...first, rows };
}

export { readAllOpenCodeCapabilityRows };
