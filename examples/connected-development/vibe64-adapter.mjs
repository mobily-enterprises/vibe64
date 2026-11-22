#!/usr/bin/env node
// Runs Vibe64's own adapter for a session's typed connected dependencies from the consuming checkout,
// as Vibe64 does: `apply` puts each in effect and `proof` proves it (with the toolchain checks
// preparation runs), `bump` is Save's part (the tracked manifest and lockfile move to a connected
// version once it is published; the lines say what Staging and Production use), and `locked` prints
// each connection's versions as session status shows them. The proofs call it in place of a
// project's own commands.
//
//   node <this file> apply|proof|bump|locked <sourcesFile>
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const { bumpConnectedDependencies, inspectConnectedAdapters, runConnectedAdapterStep } = await import(
  path.join(here, "../../packages/vibe64-project/src/server/connectedAdapters/index.js")
);

const [action, sourcesFile] = process.argv.slice(2);
if (!["apply", "proof", "bump", "locked"].includes(action) || !sourcesFile) {
  console.error("usage: node vibe64-adapter.mjs apply|proof|bump|locked <sourcesFile>");
  process.exit(2);
}
const sessionSourceRoot = process.cwd();
const { repositories = [] } = JSON.parse(await readFile(path.resolve(sessionSourceRoot, sourcesFile), "utf8"));

/** What Vibe64's managed command runner answers, from a child process with this one's environment. */
function runCommand({ command, args, cwd, timeout, env }) {
  return new Promise(resolve => {
    execFile(command, args, { cwd, timeout, env: { ...process.env, ...env }, maxBuffer: 256 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (process.env.VIBE64_ADAPTER_TRACE) console.error(`+ (${cwd}) ${command} ${args.join(" ")}${error ? ` -> ${error.code}` : ""}`);
      resolve(error
        ? { ok: false, stdout: String(stdout), stderr: String(stderr), error: error.message, exitCode: error.code }
        : { ok: true, stdout: String(stdout), stderr: String(stderr), exitCode: 0 });
    });
  });
}

if (action === "locked") {
  for (const { name, published } of await inspectConnectedAdapters({ repositories, sessionSourceRoot })) {
    console.log(JSON.stringify({ name, published }));
  }
  process.exit(0);
}
if (action === "bump") {
  const { lines } = await bumpConnectedDependencies({ repositories, sessionSourceRoot, runCommand });
  for (const line of lines) console.log(line);
  process.exit(0);
}
let failed = false;
for (const connection of repositories) {
  if (connection.relationship !== "dependency" || connection.type === "custom") continue;
  const result = await runConnectedAdapterStep({ action, repository: connection.repository, repositories, sessionSourceRoot, runCommand });
  if (result.output) console.log(result.output);
  if (!result.ok) {
    console.error(`connected ${action}: ${result.error}`);
    failed = true;
  }
}
process.exit(failed ? 1 : 0);
