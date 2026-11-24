import { readdir, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { toPosixPath } from "./files.mjs";

// The files `jskit check`'s data part (data-access.mjs) reads: the app's own source, but what its ESLint config ignores
// outside server source (SERVER_FILE), which no lint reads either; and the source of its installed @jskit-ai packages.
// With them, each app file's ESLint config, which data/lint-config judges, and the paths it skipped, which it lists.

// The root of the app or of one of its packages, where a folder's name says what the whole tree is: a migrations/ or
// test/ folder deeper in server code is server code (as in @jskit-ai/config-eslint's dataAccess.js).
const ROOT = String.raw`(?:(?:packages|tooling)/[^/]+/)?`;
// Server source, which the app's ESLint config may not ignore, as @jskit-ai/config-eslint's base.js and dataAccess.js
// lint it: at a root (ROOT), its files (a root server.js) and its src/ (an app's whole src/, src/jobs/ and its server
// code with it; a package's src/server and src/shared), server/, scripts/, bin/ and config/. Anything else the config
// ignores, a vendored copy of old code or generated output, is not data-access code.
const SERVER_FILE = new RegExp(`^${ROOT}(?:[^/]+$|(?:src|server|scripts|bin|config)/)`, "u");
const FRAMEWORK_DIRECTORY = path.join("node_modules", "@jskit-ai");
const SOURCE_FILE = /\.[cm]?js$/u;
const VUE_FILE = /\.vue$/u;
const SKIPPED_FILE = /\.(?:test|spec|vitest)\.[cm]?js$/u;
// Code that defines no table resource or system scope an app runs: dependencies, anywhere; and, at a root (ROOT), build
// output, tests and fixtures, migrations and seeds, and the examples, templates and documentation JSKIT packages carry.
const SKIPPED_ROOT_DIRECTORIES = new Set([
  "dist", "build", "coverage", "test", "tests", "__tests__", "e2e", "fixtures", "test-results", "migrations", "seed",
  "seeds", "templates", "patterns", "examples", "docs", "site", "skills", "test-support", "src/test"
]);
const PACKAGE_DIRECTORY = /^(?:packages|tooling)\/[^/]+\/(.+)$/u;
const skipsDirectory = (name) => path.posix.basename(name) === "node_modules" ||
  SKIPPED_ROOT_DIRECTORIES.has(PACKAGE_DIRECTORY.exec(name)?.[1] ?? name);

async function walk(root, directory, files, pattern = SOURCE_FILE) {
  let entries;
  try {
    entries = await readdir(path.join(root, directory), { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return;
    throw error;
  }
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const relative = directory ? path.join(directory, entry.name) : entry.name;
    if (entry.isDirectory()) {
      if (!entry.name.startsWith(".") && !skipsDirectory(toPosixPath(relative))) await walk(root, relative, files, pattern);
    } else if (entry.isFile() && pattern.test(entry.name) && !SKIPPED_FILE.test(entry.name)) {
      files.push(relative);
    }
  }
}

// The installed @jskit-ai packages outside the app's own tree (a workspace's linked packages are read as app source),
// each as { directory, real }: where the app sees it and where it is.
async function frameworkPackages(root) {
  let entries;
  try {
    entries = await readdir(path.join(root, FRAMEWORK_DIRECTORY), { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const packages = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const directory = path.join(FRAMEWORK_DIRECTORY, entry.name);
    const real = await realpath(path.join(root, directory)).catch(() => "");
    const inside = path.relative(root, real);
    const appSource = real && !inside.startsWith("..") && !path.isAbsolute(inside) && !inside.split(path.sep).includes("node_modules");
    if (real && !appSource) packages.push({ directory, real });
  }
  return packages;
}

// A file directly in a directory, for asking ESLint about the directory: its API judges files, not directories.
const DIRECTORY_PROBE = "jskit-directory-probe.js";

// The app's ESLint, from the app or else beside this check, set to find each file's config as `eslint` does, with
// its ESLint class; null when neither has one, or the app has no config: then the lint itself cannot run, which fails
// on its own.
async function appEslint(root) {
  for (const base of [path.join(root, "package.json"), fileURLToPath(import.meta.url)]) {
    let resolved;
    try {
      resolved = createRequire(base).resolve("eslint");
    } catch {
      continue;
    }
    const api = await import(pathToFileURL(resolved).href);
    const { ESLint } = api.ESLint ? api : api.default;
    const eslint = new ESLint({ cwd: root });
    return await eslint.findConfigFile(path.join(root, "package.json")) ? { eslint, ESLint } : null;
  }
  return null;
}

// For a config file, the config whose ignores keep `eslint .`, run at the app's root, out of its directory; undefined
// when it enters it. ESLint enters a directory unless the config of the directory above ignores it, so a parent config
// ignores a nested config's directory whole, and past it the nested config alone judges what it holds. The directory's
// verdict is that of a file directly in it, asked of an ESLint bound to the config above alone.
function configIgnoredBy(root, { eslint, ESLint }) {
  const verdicts = new Map();
  const bound = new Map();
  const boundTo = (configFile) => {
    if (!bound.has(configFile)) bound.set(configFile, new ESLint({ cwd: path.dirname(configFile), overrideConfigFile: configFile }));
    return bound.get(configFile);
  };
  async function verdict(configFile) {
    const directory = path.dirname(configFile);
    const inside = path.relative(root, directory);
    if (!inside || inside.startsWith("..") || path.isAbsolute(inside)) return undefined;
    // The config of the directory above, which ESLint asks before entering this one.
    const above = await eslint.findConfigFile(directory);
    if (!above) return undefined;
    return await ignoredBy(above) ??
      (await boundTo(above).isPathIgnored(path.join(directory, DIRECTORY_PROBE)) ? above : undefined);
  }
  function ignoredBy(configFile) {
    if (!verdicts.has(configFile)) verdicts.set(configFile, verdict(configFile));
    return verdicts.get(configFile);
  }
  return ignoredBy;
}

// The ESLint config of each app file that one governs, read as `eslint .` reads it: each { file, governed, config },
// `governed` the file's path from that config's directory and `config` undefined when the config ignores the file, or
// when a config above ignores the directory of the file's nested config (configIgnoredBy), as `eslint .` never reaches
// it: `governed` is then told from the directory of the config that ignores it. And the first error reading one, after
// which no more are read. None when the app has no ESLint config (appEslint).
async function lintConfigs(root, files) {
  const configs = [];
  const app = await appEslint(root);
  const ignoredBy = app && configIgnoredBy(root, app);
  for (const file of app ? files : []) {
    const absolute = path.join(root, file);
    try {
      const configFile = await app.eslint.findConfigFile(absolute);
      if (!configFile) continue;
      const outer = await ignoredBy(configFile);
      const governed = toPosixPath(path.relative(path.dirname(outer ?? configFile), absolute));
      configs.push({ file, governed, config: outer ? undefined : await app.eslint.calculateConfigForFile(absolute) });
    } catch (error) {
      return { configs, error: { file, message: String(error?.message || error).split("\n")[0] } };
    }
  }
  return { configs };
}

// Code the app's ESLint config ignores that is not server source: no lint reads it, so neither does this check.
const lintIgnores = ({ governed, config }) => !config && !SERVER_FILE.test(governed);

// The fewest paths that name the app files skipped: for each, the highest directory holding no file that is read, written
// with a trailing "/", or else the file itself.
function skippedPaths(files, skipped) {
  const directories = (file) => file.split("/").slice(0, -1).map((_, index, parts) => parts.slice(0, index + 1).join("/"));
  const read = new Set(files.filter((file) => !skipped.has(file)).flatMap(directories));
  return [...new Set([...skipped].map((file) => {
    const directory = directories(file).find((name) => !read.has(name));
    return directory ? `${directory}/` : file;
  }))].sort();
}

// The app's source files but those its ESLint config ignores outside server source (lintIgnores), and those of its
// installed @jskit-ai packages (framework: true), each { file, absolute, framework }; with each app file's ESLint config
// (lintConfigs) and the paths of the files skipped (skippedPaths).
async function sourceFiles(root) {
  const appFiles = [];
  await walk(root, "", appFiles);
  const names = appFiles.map(toPosixPath);
  const lint = await lintConfigs(root, names);
  const skipped = new Set(lint.configs.filter(lintIgnores).map(({ file }) => file));
  const sources = names.filter((file) => !skipped.has(file)).map((file) => ({ file, absolute: path.join(root, file), framework: false }));
  for (const { directory, real } of await frameworkPackages(root)) {
    const files = [];
    await walk(real, "", files);
    sources.push(...files.map((file) => ({ file: path.join(directory, file), absolute: path.join(real, file), framework: true })));
  }
  return { sources, lint, skipped: skippedPaths(names, skipped) };
}

// The app's own Vue components, which data/search-q reads for the list screens they show.
async function vueFiles(root) {
  const files = [];
  await walk(root, "", files, VUE_FILE);
  return files.map((file) => ({ file: toPosixPath(file), absolute: path.join(root, file) }));
}

export { ROOT, lintIgnores, sourceFiles, vueFiles };
