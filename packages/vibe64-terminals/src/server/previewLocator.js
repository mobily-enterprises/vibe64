// The Preview locator is a technology-owned script, declared per inspector in
// `## Architecture inspection` as `- Preview locator:`, that the Preview bridge
// inlines to map an element to its component file.
//
// readPreviewLocatorSource(session) → Promise<string>: the validated locator
// source for the session's project, or "" when none is declared.
// Placeholder: always "" until locator reading lands.
async function readPreviewLocatorSource() {
  return "";
}

export { readPreviewLocatorSource };
