import { createHash } from "node:crypto";
import vm from "node:vm";

import {
  inspectVibe64ArchitectureInspection,
  readArchitecturePreviewLocator
} from "@local/vibe64-genesis/server";
import { sessionSourcePath } from "@local/vibe64-core/server/sessionSourcePath";

// The Preview locator is a technology-owned script, declared per inspector in
// `## Architecture inspection` as `- Preview locator:`, that the Preview bridge
// runs to map an element to its component file. It is a classic script (no
// import or export) that defines globalThis.__vibe64LocateElement(element) →
// { file, name? } | null and reads no text or values.
//
// readPreviewLocatorSource(session) → Promise<string>: the first declared
// locator of the session's project, read as Architecture inspection allows (a
// regular project .js file of at most 64 KiB, without symlinks) and parsed
// without being run. "" when none is declared or it cannot be used, so Preview
// never depends on it.
const MAX_CHECKED_SOURCES = 32;
const checkedSources = new Map();

// Whether the text parses as a classic script, remembered by content hash.
function parsesAsScript(source) {
  const hash = createHash("sha256").update(source).digest("hex");
  if (!checkedSources.has(hash)) {
    let parses = true;
    try {
      new vm.Script(source, { filename: "preview-locator.js" });
    } catch {
      parses = false;
    }
    if (checkedSources.size >= MAX_CHECKED_SOURCES) {
      checkedSources.delete(checkedSources.keys().next().value);
    }
    checkedSources.set(hash, parses);
  }
  return checkedSources.get(hash);
}

async function readPreviewLocatorSource(session = {}, {
  inspect = inspectVibe64ArchitectureInspection,
  read = readArchitecturePreviewLocator
} = {}) {
  const projectRoot = sessionSourcePath(session || {});
  if (!projectRoot) {
    return "";
  }
  try {
    const inspection = await inspect({ projectRoot });
    const locatorPath = (inspection?.inspectors || []).find((inspector) => inspector?.previewLocator)?.previewLocator;
    if (!locatorPath) {
      return "";
    }
    const { source } = await read(projectRoot, locatorPath);
    return typeof source === "string" && parsesAsScript(source) ? source : "";
  } catch {
    return "";
  }
}

export { readPreviewLocatorSource };
