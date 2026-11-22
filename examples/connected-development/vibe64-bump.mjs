#!/usr/bin/env node
// Runs what Save asks of Vibe64's adapter for each typed connected dependency, from the consuming
// checkout: `locked` prints the checkout's version beside the one the tracked files pin, and `bump`
// moves the tracked manifest and lock to the checkout's version once it is published. The example
// proofs call it as the session's Save would.
//
//   node <this file> locked|bump <sourcesFile>
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const server = path.join(here, "../../packages/vibe64-project/src/server");
const { CONNECTED_ADAPTERS, sessionTrees } = await import(path.join(server, "connectedAdapters/index.js"));
const { writeManagedGitExcludes } = await import(path.join(server, "projectEnvironmentFiles.js"));

const [action, sourcesFile] = process.argv.slice(2);
if (!["locked", "bump"].includes(action) || !sourcesFile) {
  console.error("usage: node vibe64-bump.mjs locked|bump <sourcesFile>");
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
  const context = {
    connection,
    connections: typed.filter(entry => entry.type === connection.type),
    repositories,
    sessionSourceRoot,
    trees: sessionTrees(sessionSourceRoot, repositories),
    runCommand,
    writeGitExcludes: (tree, paths) => writeManagedGitExcludes(tree, paths, { section: `connected ${connection.type} packages` })
  };
  const result = await adapter[action](context);
  if (action === "locked") {
    console.log(JSON.stringify(result));
  } else {
    for (const line of result.lines) console.log(line);
    console.log(`bumped: ${JSON.stringify(result.bumped)}`);
  }
}
