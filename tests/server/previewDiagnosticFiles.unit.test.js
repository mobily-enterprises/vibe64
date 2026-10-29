import assert from "node:assert/strict";
import test from "node:test";
import { previewLastPath, previewLogPath } from "@local/vibe64-terminals/server/previewDiagnosticFiles";

// A host's storage report names these files through their owner rather than
// repeating the file names the Preview launcher writes.
test("the Preview's diagnostic files are named by their owner's package export", () => {
  assert.equal(previewLogPath({ sessionRoot: "/state/sessions/active/s1" }), "/state/sessions/active/s1/preview-log.jsonl");
  assert.equal(previewLastPath({ sessionRoot: "/state/sessions/active/s1" }), "/state/sessions/active/s1/preview-last.json");
  assert.equal(previewLogPath({}), "", "an archived session has no Preview log of its own");
});
