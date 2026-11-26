// Every listing of a session's passes is planPasses.js's listSessionPasses, which gives Genesis the session's connected
// copies' roots beside its source, and every prompt is the runtime's, which gives them too: a listing or prompt made
// anywhere else would size a deep run, and scope a run over the whole app, by the session's own source alone.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
// A call, never a definition, a parameter or a reference passed on.
const CALLS = /(?<!function\s)\b(listPasses|listGenesisPasses|renderGenesisPrompt|promptRenderer)\(/gu;
const ALLOWED = new Map([
  ["packages/vibe64-terminals/src/server/planPasses.js",
    ["listPasses({ projectRoot: sessionSourcePath(session), connectedRoots: sessionConnectedRoots(session) })"]],
  ["packages/vibe64-runtime/src/server/runtime.js", ["promptRenderer({"]]
]);

test("every listing of a session's passes is listSessionPasses and every prompt the runtime's, so each takes in the connected copies", () => {
  const files = execFileSync("git", ["ls-files", "-z", "--", "packages/*/src"], { cwd: REPO_ROOT, encoding: "utf8" })
    .split("\0").filter((file) => /\.(?:c?js|mjs|vue)$/u.test(file));
  const found = [];
  for (const file of files) {
    const source = readFileSync(path.join(REPO_ROOT, file), "utf8");
    for (const match of source.matchAll(CALLS)) {
      const line = source.slice(match.index, source.indexOf("\n", match.index));
      if (/^\s*\*/u.test(source.slice(source.lastIndexOf("\n", match.index) + 1, match.index))) continue;
      if (!(ALLOWED.get(file) || []).some((allowed) => line.startsWith(allowed))) found.push(`${file}: ${line.trim()}`);
    }
  }
  assert.deepEqual(found, []);
  // The two allowed calls give Genesis the copies' roots.
  assert.match(readFileSync(path.join(REPO_ROOT, "packages/vibe64-runtime/src/server/runtime.js"), "utf8"),
    /this\.promptRenderer\(\{[\s\S]*?connectedRoots: sessionConnectedRoots\(session\),[\s\S]*?\}\);/u);
});
