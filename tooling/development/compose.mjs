import { cp, mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { resolveDevelopmentDependencySource } from "./source-roots.mjs";
import { linkNodeModulesEntries, materializeLocalDevelopmentPackages, selectLocalDevelopmentPackages } from "./source-packages.mjs";

const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));

// The ordinary installation remains untouched. Only the disposable app receives
// source packages, using the same closure and materialization as hosted development.
export async function composePublicDevelopment({ publicRoot, appRoot, env = process.env, includeTests = false }) {
  publicRoot = await realpath(publicRoot);
  const jskit = await resolveDevelopmentDependencySource(env.VIBE64_JSKIT_SOURCE_ROOT, "jskit-monorepo");
  const genesis = await resolveDevelopmentDependencySource(env.VIBE64_GENESIS_SOURCE_ROOT, "genesis-compiler");
  const manifest = await readJson(path.join(publicRoot, "package.json"));
  if (manifest.name !== "vibe64") throw new Error(`Expected a Public Vibe64 checkout at ${publicRoot}.`);
  const consumerDependencies = { ...manifest.dependencies, ...manifest.devDependencies };
  for (const name of Object.keys(manifest.dependencies).filter((name) => name.startsWith("@local/"))) {
    const dependency = await readJson(path.join(publicRoot, "node_modules", name, "package.json"));
    Object.assign(consumerDependencies, dependency.dependencies);
  }
  const selected = await selectLocalDevelopmentPackages({
    jskitRoot: jskit?.sourceRoot, genesisRoot: genesis?.sourceRoot,
    consumerDependencies, installedRoots: [publicRoot]
  });
  if (!selected.length) throw new Error("Select VIBE64_JSKIT_SOURCE_ROOT or VIBE64_GENESIS_SOURCE_ROOT for source development.");

  const require = createRequire(path.join(publicRoot, "package.json"));
  const catalogRoot = jskit ? path.join(jskit.sourceRoot, "tooling/jskit-catalog")
    : path.dirname(require.resolve("@jskit-ai/jskit-catalog/package.json"));
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
  return { appRoot, localPackages, sourceRoots: [publicRoot, jskit?.sourceRoot, genesis?.sourceRoot].filter(Boolean) };
}
