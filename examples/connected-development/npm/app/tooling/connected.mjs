// Links each connected npm source into node_modules without editing the
// tracked package.json or package-lock.json, then proves resolution.
import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const [phase, sourcesFile] = process.argv.slice(2);
const sources = JSON.parse(readFileSync(sourcesFile, "utf8"));
if (sources.contract !== "vibe64.connected-sources.v1") throw new Error("Unexpected sources map contract.");
const connected = sources.projects.filter(project => project.type === "npm" && project.relationship === "dependency");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

if (phase === "prepare") {
  if (connected.length) execFileSync(npm, ["install", "--no-save", "--install-links=false", "--no-audit", "--no-fund",
    ...connected.map(project => project.sourceRoot)], { stdio: "inherit" });
} else if (phase === "verify") {
  const require = createRequire(path.resolve("package.json"));
  for (const project of connected) {
    const name = JSON.parse(readFileSync(path.join(project.sourceRoot, "package.json"), "utf8")).name;
    const resolved = realpathSync(path.dirname(require.resolve(`${name}/package.json`)));
    if (resolved !== realpathSync(project.sourceRoot)) {
      throw new Error(`${name} resolves to ${resolved}, not the connected source ${project.sourceRoot}.`);
    }
    console.log(`${name} -> ${resolved}`);
  }
} else throw new Error("Usage: connected.mjs prepare|verify <sourcesFile>");
