import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

// Each package type's example proof (examples/connected-development/<type>/prove.sh) runs Vibe64's own
// adapter end to end with that ecosystem's real toolchain, offline: the connected checkout takes
// effect, the tracked files stay as they were, and the proof fails once the connection is undone.
// They need the toolchains, so they run in the toolchain proof run (VIBE64_CONNECTED_TOOLCHAIN_PROOFS=1,
// with each toolchain on PATH), not in every suite run.
const exec = promisify(execFile);
const examples = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../examples/connected-development");
const NEEDS = Object.freeze({
  npm: ["node", "npm", "tar"],
  composer: ["php", "composer"],
  pip: ["python3"],
  bundler: ["ruby", "bundle"],
  gomod: ["go", "zip"],
  cargo: ["cargo", "rustc"],
  maven: ["java", "mvn"],
  gradle: ["java", "javac", "gradle"],
  nuget: ["dotnet"]
});

async function onPath(tool) {
  return exec("sh", ["-c", `command -v ${tool}`]).then(() => true, () => false);
}

for (const [type, tools] of Object.entries(NEEDS)) {
  test(`${type}: the example proof puts a connected checkout in effect through Vibe64's adapter`, { timeout: 1_200_000 }, async t => {
    if (process.env.VIBE64_CONNECTED_TOOLCHAIN_PROOFS !== "1") {
      t.skip("runs in the toolchain proof run (VIBE64_CONNECTED_TOOLCHAIN_PROOFS=1)");
      return;
    }
    const missing = [];
    for (const tool of tools) if (!(await onPath(tool))) missing.push(tool);
    if (missing.length) {
      t.skip(`needs ${missing.join(", ")} on PATH`);
      return;
    }
    const started = Date.now();
    const { stdout } = await exec("bash", [path.join(examples, type, "prove.sh")], { timeout: 1_200_000, maxBuffer: 64 * 1024 * 1024 })
      .catch(error => assert.fail(`${type} proof failed:\n${String(error.stdout || "").slice(-4000)}\n${String(error.stderr || "").slice(-4000)}`));
    t.diagnostic(`${type} proof took ${Math.round((Date.now() - started) / 1000)} s`);
    assert.match(stdout, new RegExp(`PASS ${type}`, "u"));
  });
}
