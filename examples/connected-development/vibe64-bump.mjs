#!/usr/bin/env node
// Runs what Save runs for a session's typed connected dependencies: each adapter's `bump` moves the
// consuming checkout's tracked manifest and lockfile to the version its connected copy declares,
// once that version is published. The proofs call it from the consuming checkout.
//
//   node <this file> <sourcesFile>
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const server = path.join(here, "../../packages/vibe64-project/src/server");
const { CONNECTED_ADAPTERS, sessionTrees } = await import(path.join(server, "connectedAdapters/index.js"));
const { writeManagedGitExcludes } = await import(path.join(server, "projectEnvironmentFiles.js"));

const [sourcesFile] = process.argv.slice(2);
if (!sourcesFile) {
  console.error("usage: node vibe64-bump.mjs <sourcesFile>");
  process.exit(2);
}
const sessionSourceRoot = process.cwd();
const { repositories = [] } = JSON.parse(await readFile(path.resolve(sessionSourceRoot, sourcesFile), "utf8"));

/** What Vibe64's managed command runner answers, from a child process with this one's environment. */
function runCommand({ command, args, cwd, timeout, env }) {
  return new Promise(resolve => {
    execFile(command, args, { cwd, timeout, env: { ...process.env, ...env }, maxBuffer: 256 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve(error
        ? { ok: false, stdout: String(stdout), stderr: String(stderr), error: error.message, exitCode: error.code }
        : { ok: true, stdout: String(stdout), stderr: String(stderr), exitCode: 0 });
    });
  });
}

const typed = repositories.filter(entry => entry.relationship === "dependency" && entry.type !== "custom");
for (const connection of typed) {
  const adapter = CONNECTED_ADAPTERS[connection.type];
  if (!adapter?.bump) continue;
  const { lines } = await adapter.bump({
    connection,
    connections: typed.filter(entry => entry.type === connection.type),
    repositories,
    sessionSourceRoot,
    trees: sessionTrees(sessionSourceRoot, repositories),
    runCommand,
    writeGitExcludes: (tree, paths) => writeManagedGitExcludes(tree, paths, { section: `connected ${connection.type} packages` })
  });
  for (const line of lines) console.log(line);
}
