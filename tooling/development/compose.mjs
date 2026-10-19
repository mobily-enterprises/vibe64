import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { readConnectedDevelopmentSources, resolveDevelopmentDependencySource } from "./source-roots.mjs";
import { linkNodeModulesEntries, materializeLocalDevelopmentPackages, selectLocalDevelopmentPackages } from "./source-packages.mjs";

const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));
const exec = promisify(execFile);

// The ordinary installation remains untouched. Only the disposable app receives
// source packages, using the same closure and materialization as hosted development.
export async function composePublicDevelopment({ publicRoot, appRoot, env = process.env, includeTests = false,
  connectedSourcesFile = env.VIBE64_CONNECTED_SOURCES_FILE }) {
  publicRoot = await realpath(publicRoot);
  const connected = connectedSourcesFile
    ? await readConnectedDevelopmentSources(connectedSourcesFile, { projectRoot: publicRoot }) : null;
  // Public Vibe64's own Stack gives only npm dependencies a Node treatment;
  // other declared ecosystems would otherwise be silently left unconsumed.
  const untreated = connected?.projects.find(project => !["npm", "custom"].includes(project.type));
  if (untreated) {
    throw new Error(`Public Vibe64 source development treats only npm dependencies and custom connections; it has no treatment for ${untreated.type} connections. Use npm, or a project-owned custom treatment.`);
  }
  if (connected?.projects.some(project => project.relationship === "composition" && project.type === "npm")) {
    throw new Error("Public Vibe64 source development supports npm dependencies, not npm composition projects. Declare a project-owned custom treatment for this composition.");
  }
  const dependencyRoots = connected?.projects.filter(project => project.relationship === "dependency" && project.type === "npm")
    .map(project => project.sourceRoot) || [];
  if (dependencyRoots.includes(publicRoot)) throw new Error("The development application cannot be its own connected dependency.");
  // A prepared task selection is authoritative over older standalone Env pins.
  const jskit = connected ? null : await resolveDevelopmentDependencySource(env.VIBE64_JSKIT_SOURCE_ROOT, "jskit-monorepo");
  const genesis = connected ? null : await resolveDevelopmentDependencySource(env.VIBE64_GENESIS_SOURCE_ROOT, "genesis-compiler");
  const manifest = await readJson(path.join(publicRoot, "package.json"));
  if (manifest.name !== "vibe64") throw new Error(`Expected a Public Vibe64 checkout at ${publicRoot}.`);
  const consumerDependencies = { ...manifest.dependencies, ...manifest.devDependencies };
  for (const name of Object.keys(manifest.dependencies).filter((name) => name.startsWith("@local/"))) {
    const dependency = await readJson(path.join(publicRoot, "node_modules", name, "package.json"));
    Object.assign(consumerDependencies, dependency.dependencies);
  }
  const selected = await selectLocalDevelopmentPackages({
    jskitRoot: jskit?.sourceRoot, genesisRoot: genesis?.sourceRoot, sourceRoots: dependencyRoots,
    consumerDependencies, installedRoots: [publicRoot]
  });
  if (!selected.length && !connected) throw new Error("No declared application dependencies match the selected development sources.");

  const require = createRequire(path.join(publicRoot, "package.json"));
  const catalogRoot = selected.find(entry => entry.packageId === "@jskit-ai/jskit-catalog")?.root
    || path.dirname(require.resolve("@jskit-ai/jskit-catalog/package.json"));
  const catalog = await readJson(path.join(catalogRoot, "catalog/packages.json"));
  const tools = await import(pathToFileURL(path.join(catalogRoot, "scripts/project-packages.mjs")).href);
  const sourcePackages = Object.fromEntries(selected.map(({ packageId, root }) => [packageId, root]));
  const sourceCheck = await tools.checkProject({ projectRoot: publicRoot, catalog, checkInstalled: true, sourcePackages });
  if (sourceCheck.issues.length) throw new Error(`Development dependencies are inconsistent:\n${sourceCheck.issues.join("\n")}`);

  await mkdir(appRoot, { recursive: true });
  // Copy application and test inputs, never local state, credentials or Git data.
  for (const entry of await readdir(publicRoot, { withFileTypes: true })) {
    const includedDirectory = ["bin", "config", "examples", "genesis", "packages", "server", "src", "tooling",
      ...(includeTests ? ["tests", "docs"] : [])].includes(entry.name);
    const includedFile = entry.isFile() && /\.(?:[cm]?js|json|html|svg)$/u.test(entry.name)
      && !["package-lock.json", "server.static.mjs", "server.bundle.mjs"].includes(entry.name);
    if (!includedDirectory && !includedFile) continue;
    await cp(path.join(publicRoot, entry.name), path.join(appRoot, entry.name), {
      recursive: true, filter: (file) => !path.relative(publicRoot, file).split(path.sep)
        .some((part) => ["node_modules", ".git", ".genesis", ".cache"].includes(part) || part.startsWith(".env"))
    });
  }
  if (!includeTests) {
    await cp(path.join(publicRoot, "docs/colleague-usage"), path.join(appRoot, "docs/colleague-usage"), { recursive: true });
  }
  const nodeModules = path.join(appRoot, "node_modules");
  await linkNodeModulesEntries({ sourceNodeModules: path.join(publicRoot, "node_modules"), targetNodeModules: nodeModules });
  const localPackages = await materializeLocalDevelopmentPackages({ appRoot, nodeModules, publicRoot, localPackages: selected });
  const dependencies = { ...manifest.dependencies };
  for (const entry of localPackages) {
    if (Object.hasOwn(dependencies, entry.packageId)) dependencies[entry.packageId] = `file:${entry.targetRoot}`;
  }
  await writeFile(path.join(appRoot, "package.json"), `${JSON.stringify({ ...manifest, private: true, dependencies }, null, 2)}\n`);
  const installed = Object.fromEntries(localPackages.map(({ packageId, targetRoot }) => [packageId, targetRoot]));
  const graph = await tools.checkInstalledGraph({ catalog, manifestPaths: [path.join(appRoot, "package.json")], sourcePackages: installed });
  if (graph.issues.length) throw new Error(`Composed development dependencies are inconsistent:\n${graph.issues.join("\n")}`);
  return { appRoot, localPackages,
    sourceRoots: [...new Set([publicRoot, ...(connected?.projects.map(project => project.sourceRoot) || []),
      jskit?.sourceRoot, genesis?.sourceRoot].filter(Boolean))],
    connectedSourcesFile: connected?.file || "" };
}

export async function verifyPublicConnectedDevelopment({ publicRoot, connectedSourcesFile, env = process.env }) {
  const parent = path.join(publicRoot, ".vibe64-local", "connected-development");
  await mkdir(parent, { recursive: true });
  const appRoot = await mkdtemp(path.join(parent, "verify-"));
  try {
    const composition = await composePublicDevelopment({ publicRoot, appRoot, connectedSourcesFile, env });
    // Exercise the real application's interpretation boundary in a fresh Node
    // process. Its imports must use the composed graph, not this tool's graph.
    const { stdout } = await exec(process.execPath, ["--input-type=module", "-e", `
import assert from 'node:assert/strict';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
for (const entry of JSON.parse(process.argv[1])) {
  assert.equal(await realpath(path.join('node_modules', entry.packageId)), await realpath(entry.targetRoot));
}
const { inspectVibe64ConnectedDevelopment } = await import('@local/vibe64-genesis/server');
const result = await inspectVibe64ConnectedDevelopment({ projectRoot: process.cwd() });
assert.equal(result.contract, 'vibe64.connected-development.v1');
assert.equal(result.status, 'ready', JSON.stringify(result.diagnostics));
console.log('Public Vibe64 imported and inspected Connected development through its composed package graph.');
`, JSON.stringify(composition.localPackages)], {
      cwd: appRoot, env: { ...env, VIBE64_DEVELOPMENT_COMPOSED: "1" }, timeout: 60_000
    });
    return { packages: composition.localPackages.map(entry => entry.packageId), output: stdout.trim() };
  } finally {
    await rm(appRoot, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [operation, connectedSourcesFile, extra] = process.argv.slice(2);
  if (operation !== "verify" || !connectedSourcesFile || extra) {
    throw new Error("Usage: node tooling/development/compose.mjs verify <connected-sources-file>");
  }
  const result = await verifyPublicConnectedDevelopment({ publicRoot: process.cwd(), connectedSourcesFile });
  console.log(result.output);
  console.log(`Connected source packages: ${result.packages.join(", ")}`);
}
