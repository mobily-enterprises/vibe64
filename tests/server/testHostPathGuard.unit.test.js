import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

const GUARD = new URL("../../tooling/test-host-path-guard.mjs", import.meta.url).href;

// Each change aims inside a folder that does not exist, so a missing guard fails with ENOENT instead of writing. The
// folders are other software's, which host neutrality lets tests name.
const PROBE = `
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const outcome = (run) => { try { run(); return "ran"; } catch (error) { return error.message; } };
// The guard refuses before the promise exists, so a refusal throws where a missing file rejects.
const settled = async (run) => { try { await run(); return "ran"; } catch (error) { return error.message; } };
const scratch = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "vibe64-guard-proof-")), "file");
const ownRuntime = outcome(() => fs.writeFileSync(\`/run/user/\${process.getuid()}/vibe64-guard-proof-missing/file\`, ""));
console.log(JSON.stringify({
  loadEnvFile: outcome(() => process.loadEnvFile("/etc/codex/vibe64-guard-proof.env")),
  writeFileSync: outcome(() => fs.writeFileSync("/etc/codex/vibe64-guard-proof-missing/file", "")),
  writeFile: await settled(() => fs.promises.writeFile("/opt/homebrew/vibe64-guard-proof-missing/file", "")),
  openForWriting: outcome(() => fs.openSync("/var/lib/mysql/vibe64-guard-proof-missing/file", "w")),
  ownRuntime: ownRuntime.includes("system location") ? "refused" : "allowed",
  scratch: outcome(() => fs.writeFileSync(scratch, "")),
  names: [fs.writeFileSync.name, fs.promises.writeFile.name, process.loadEnvFile.name],
  constants: typeof fs.constants.O_WRONLY
}));
fs.rmSync(path.dirname(scratch), { recursive: true });
`;

test("the test host path guard refuses changes to system locations and keeps everything else as it was", () => {
  const result = spawnSync(process.execPath, [`--import=${GUARD}`, "--input-type=module", "--eval", PROBE], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    loadEnvFile: "test changed a system location: /etc/codex/vibe64-guard-proof.env (loadEnvFile)",
    writeFileSync: "test changed a system location: /etc/codex/vibe64-guard-proof-missing/file (writeFileSync)",
    writeFile: "test changed a system location: /opt/homebrew/vibe64-guard-proof-missing/file (writeFile)",
    openForWriting: "test changed a system location: /var/lib/mysql/vibe64-guard-proof-missing/file (openSync)",
    ownRuntime: "allowed",
    scratch: "ran",
    names: ["writeFileSync", "writeFile", "loadEnvFile"],
    constants: "number"
  });
});

// CI installs Node in GitHub's tool cache under /opt. The probe names such a Node before it loads the guard, then
// starts it, its npm and another program in that cache; none exists, so a missing guard refusal shows as ENOENT,
// never as a started program.
const OWN_NODE_PROBE = `
import childProcess from "node:child_process";
process.execPath = "/opt/hostedtoolcache/node/vibe64-guard-proof/bin/node";
await import(${JSON.stringify(GUARD)});
const outcome = (program) => {
  try { return childProcess.spawnSync(program, ["--version"]).error?.code || "ran"; } catch (error) { return error.message; }
};
console.log(JSON.stringify({
  node: outcome(process.execPath),
  npm: outcome("/opt/hostedtoolcache/node/vibe64-guard-proof/bin/npm"),
  other: outcome("/opt/hostedtoolcache/vibe64-guard-proof-tool/bin/tool")
}));
`;

test("the guard lets a test start the Node that runs it, and the npm beside it, from a system location", () => {
  // Without the inherited --import, the probe loads the guard itself, after naming its Node.
  const env = { ...process.env, NODE_OPTIONS: "" };
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", OWN_NODE_PROBE], { encoding: "utf8", env });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    node: "ENOENT",
    npm: "ENOENT",
    other: "test changed a system location: /opt/hostedtoolcache/vibe64-guard-proof-tool/bin/tool (spawnSync)"
  });
});
