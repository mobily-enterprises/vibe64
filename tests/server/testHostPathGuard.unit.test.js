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
