import { builtinModules, createRequire } from "node:module";
import { chmod, cp, lstat, mkdir, readFile, readdir, realpath, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildNodeBundle, buildServerBundle, SERVER_BUNDLE_EXTERNALS } from "./server-build.mjs";

const GENESIS_BOUNDARY = "@local/vibe64-genesis/server";
const RUNTIME_ENTRIES = [
  "bin/run.js",
  "bin/server.js",
  "node_modules/@local/vibe64-genesis/src/server/index.js",
  "node_modules/@local/vibe64-genesis/src/server/promptContext.js",
  "node_modules/@local/vibe64-genesis/bin/genesis",
  "node_modules/@local/vibe64-genesis/bin/vibe64-genesis-host-context",
  "node_modules/@local/vibe64-runtime/src/server/codexSessionCommandHook.js",
  "node_modules/@local/vibe64-terminals/src/server/sessionWorkOperationCommand.js",
  "node_modules/@local/vibe64-terminals/src/server/opencodeSessionEnvironmentPlugin.js"
];
const builtins = new Set(builtinModules.flatMap(name => [name, `node:${name}`]));
const json = async filename => JSON.parse(await readFile(filename, "utf8"));
const writeJson = (filename, value) => writeFile(filename, `${JSON.stringify(value, null, 2)}\n`);
const packageName = specifier => specifier.split("/").slice(0, specifier.startsWith("@") ? 2 : 1).join("/");

async function exists(filename) {
  try { await lstat(filename); return true; } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function packageRoot(name, from) {
  const require = createRequire(path.join(from, "package.json"));
  for (const modules of require.resolve.paths(`${name}/package.json`) || []) {
    const candidate = path.join(modules, name);
    if (await exists(path.join(candidate, "package.json"))) return candidate;
  }
  throw new Error(`Runtime dependency ${name} is not installed for ${from}.`);
}

async function buildRuntimeBundles({ appRoot, releaseAppRoot, extraEntries = [], extraExternals = [], serverEntry = "server.bundle.mjs" }) {
  if (!appRoot || !releaseAppRoot || await realpath(appRoot) === await realpath(releaseAppRoot)) {
    throw new Error("Runtime bundling requires a separate materialized release directory.");
  }
  const results = [];
  const outputPaths = [];
  for (const entry of [...RUNTIME_ENTRIES, ...extraEntries]) {
    const outfile = path.join(releaseAppRoot, entry);
    await mkdir(path.dirname(outfile), { recursive: true });
    if (await exists(outfile) && (await lstat(outfile)).isSymbolicLink()) {
      throw new Error(`Runtime output must be a materialized release file: ${outfile}`);
    }
    results.push(await buildNodeBundle({
      appRoot, entryPoint: path.join(appRoot, entry), outfile,
      external: [...SERVER_BUNDLE_EXTERNALS, GENESIS_BOUNDARY, ...extraExternals],
      plugins: [{
        name: "vibe64-published-server",
        setup(build) {
          build.onResolve({ filter: /^\.\.\/server\.js$/ }, args => {
            if (args.importer === path.join(appRoot, "bin/server.js")) {
              return { path: `../${serverEntry}`, external: true };
            }
          });
        }
      }]
    }));
    if (entry.startsWith("bin/") || entry.includes("/bin/")) await chmod(outfile, 0o755);
    outputPaths.push(outfile);
  }
  return { outputPaths, results };
}

// A release is assembled from build inputs and explicit external dependencies.
// Source checkouts and their node_modules are never pruned or rewritten.
async function createRuntimePackage({ appRoot, releaseAppRoot, extraEntries = [], extraExternals = [], runtimeDependencies = [], minify = true }) {
  appRoot = path.resolve(appRoot);
  releaseAppRoot = path.resolve(releaseAppRoot);
  if (releaseAppRoot === appRoot || appRoot.startsWith(`${releaseAppRoot}${path.sep}`)) {
    throw new Error("The release directory must not contain the source application.");
  }
  if (await exists(releaseAppRoot)) {
    if ((await readdir(releaseAppRoot)).length) throw new Error(`Release directory must be empty: ${releaseAppRoot}`);
  }
  await mkdir(releaseAppRoot, { recursive: true });
  for (const entry of ["app.json", "config", "dist"]) {
    await cp(path.join(appRoot, entry), path.join(releaseAppRoot, entry), { recursive: true, dereference: true });
  }
  for (const entry of ["LICENSE", "LICENSE.md", "LICENSE.txt", "README.md"]) {
    if (await exists(path.join(appRoot, entry))) await cp(path.join(appRoot, entry), path.join(releaseAppRoot, entry));
  }
  const serverEntry = minify ? "server.bundle.mjs" : "server.js";
  const server = await buildServerBundle({
    appRoot, outputPath: path.join(releaseAppRoot, serverEntry), minify,
    extraExternals: [GENESIS_BOUNDARY, ...extraExternals]
  });
  const helpers = await buildRuntimeBundles({ appRoot, releaseAppRoot, extraEntries, extraExternals, serverEntry });
  const results = [server, ...helpers.results];
  const inputs = new Set(results.flatMap(result => Object.keys(result.metafile.inputs)));
  const packages = new Set();
  for (const input of inputs) {
    const relative = path.relative(appRoot, path.resolve(appRoot, input)).split(path.sep).join("/");
    if (relative.startsWith("node_modules/")) packages.add(packageName(relative.slice("node_modules/".length)));
  }
  const optionalImports = new Set();
  for (const name of packages) {
    const manifest = await json(path.join(await packageRoot(name, appRoot), "package.json"));
    for (const name of Object.keys(manifest.optionalDependencies || {})) optionalImports.add(name);
    for (const [name, policy] of Object.entries(manifest.peerDependenciesMeta || {})) {
      if (policy.optional) optionalImports.add(name);
    }
  }
  // createRequire and computed imports cannot always be traced by esbuild.
  const externals = new Set(["genesis-stack", ...runtimeDependencies]);
  for (const result of results) {
    for (const output of Object.values(result.metafile.outputs)) {
      for (const entry of output.imports) {
        if (entry.external && !builtins.has(entry.path) && !entry.path.startsWith(".") && !path.isAbsolute(entry.path)) {
          externals.add(packageName(entry.path));
        }
      }
    }
  }
  externals.delete("@local/vibe64-genesis");
  const dependencies = {};
  const copied = new Set();
  async function copyDependency(name, from) {
    const source = await packageRoot(name, from);
    const relative = path.relative(appRoot, source);
    if (!relative.startsWith(`node_modules${path.sep}`)) throw new Error(`Dependency escapes the prepared application: ${source}`);
    if (copied.has(relative)) return;
    copied.add(relative);
    const destination = path.join(releaseAppRoot, relative);
    await cp(source, destination, {
      recursive: true, dereference: true,
      filter(filename) {
        const relativeFile = path.relative(source, filename);
        if (name === "node-pty" && relativeFile.startsWith(`prebuilds${path.sep}`)
          && relativeFile.split(path.sep)[1] !== `${process.platform}-${process.arch}`) return false;
        return !relativeFile.split(path.sep).includes("node_modules") && !/\.d\.[cm]?ts$|\.map$/u.test(filename);
      }
    });
    const manifest = await json(path.join(source, "package.json"));
    for (const dependency of Object.keys({ ...manifest.dependencies, ...manifest.optionalDependencies, ...manifest.peerDependencies })) {
      const optional = Object.hasOwn(manifest.optionalDependencies || {}, dependency)
        || Object.hasOwn(manifest.peerDependencies || {}, dependency);
      if (optional) {
        try { await packageRoot(dependency, source); } catch { continue; }
      }
      await copyDependency(dependency, source);
    }
  }
  for (const name of externals) {
    if (optionalImports.has(name)) {
      try { await packageRoot(name, appRoot); } catch { externals.delete(name); continue; }
    }
    const source = await packageRoot(name, appRoot);
    dependencies[name] = (await json(path.join(source, "package.json"))).version;
    await copyDependency(name, appRoot);
  }

  const bundled = new Set();
  const compiledEntries = new Set([...RUNTIME_ENTRIES, ...extraEntries]);
  // Metadata and data files remain at their original module-relative paths.
  // Their JavaScript is already in the bundles; their original dependency
  // declarations must not cause npm to reinstall the development graph.
  for (const name of packages) {
    if (externals.has(name)) continue;
    const source = await packageRoot(name, appRoot);
    if (copied.has(path.relative(appRoot, source))) continue;
    const destination = path.join(releaseAppRoot, "node_modules", name);
    const manifest = await json(path.join(source, "package.json"));
    await cp(source, destination, {
      recursive: true, dereference: true,
      filter(filename) {
        if (compiledEntries.has(path.relative(appRoot, filename).split(path.sep).join("/"))) return false;
        const relative = path.relative(source, filename);
        if (relative.split(path.sep).some(part => ["node_modules", "test", "tests", "__tests__", "docs", "examples", "client"].includes(part))) return false;
        return !/\.(?:[cm]?js|[cm]?ts|map|vue|jsx|tsx)$/u.test(filename) && path.basename(filename) !== "package.json";
      }
    });
    await mkdir(destination, { recursive: true });
    await writeJson(path.join(destination, "package.json"), {
      name, version: manifest.version, private: manifest.private, type: manifest.type, exports: manifest.exports, bin: manifest.bin,
      license: manifest.license
    });
    dependencies[name] = manifest.version;
    bundled.add(name);
  }
  // Entry-only packages may contain no imported code (for example a native hook).
  for (const entry of [...RUNTIME_ENTRIES, ...extraEntries]) {
    if (!entry.startsWith("node_modules/")) continue;
    const name = packageName(entry.slice("node_modules/".length));
    if (bundled.has(name)) continue;
    const source = await packageRoot(name, appRoot);
    const manifest = await json(path.join(source, "package.json"));
    await writeJson(path.join(releaseAppRoot, "node_modules", name, "package.json"), {
      name, version: manifest.version, private: manifest.private, type: "module", exports: manifest.exports, bin: manifest.bin, license: manifest.license
    });
    dependencies[name] = manifest.version;
    bundled.add(name);
  }
  const sourceManifest = await json(path.join(appRoot, "package.json"));
  await writeJson(path.join(releaseAppRoot, "package.json"), {
    name: sourceManifest.name, version: sourceManifest.version || "0.0.0", private: sourceManifest.private,
    description: sourceManifest.description, type: "module", engines: sourceManifest.engines,
    bin: { vibe64: "bin/run.js" },
    files: ["app.json", "bin", "config", "dist", serverEntry],
    scripts: { start: "node bin/server.js --no-open" },
    dependencies: Object.fromEntries(Object.entries(dependencies).sort(([a], [b]) => a.localeCompare(b))),
    bundleDependencies: [...bundled].sort()
  });
  const binRoot = path.join(releaseAppRoot, "node_modules/.bin");
  await mkdir(binRoot, { recursive: true });
  await symlink("../@local/vibe64-genesis/bin/genesis", path.join(binRoot, "genesis"));
  for (const entry of extraEntries.filter(entry => entry.includes("/bin/"))) {
    const name = packageName(entry.slice("node_modules/".length));
    const manifest = await json(path.join(releaseAppRoot, "node_modules", name, "package.json"));
    for (const [command, target] of Object.entries(manifest.bin || {})) {
      await symlink(`../${name}/${target}`, path.join(binRoot, command));
    }
  }
  return { releaseAppRoot, externalDependencies: [...externals].sort(), bundledPackages: [...bundled].sort() };
}

export { buildRuntimeBundles, createRuntimePackage, RUNTIME_ENTRIES };
