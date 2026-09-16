import { builtinModules } from "node:module";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const TOOLING_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(TOOLING_DIR, "..");
const WORKSPACE_PATTERN = "packages/*";
const SOURCE_EXTENSIONS = new Set([".cjs", ".js", ".mjs", ".ts", ".vue"]);
const NODE_BUILTINS = new Set([
  ...builtinModules,
  ...builtinModules.map((moduleName) => `node:${moduleName}`)
]);
const IMPORT_SPECIFIER_PATTERN =
  /\bimport\s+(?:[^'";]*?\s+from\s*)?["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)|\bexport\s+(?:[^'";]*?\s+from\s*)["']([^"']+)["']|\brequire\s*\(\s*["']([^"']+)["']\s*\)/g;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function relativePath(filePath) {
  return path.relative(ROOT_DIR, filePath).replaceAll(path.sep, "/");
}

function sortedValues(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function isNodeBuiltinSpecifier(specifier) {
  if (NODE_BUILTINS.has(specifier)) {
    return true;
  }
  if (!specifier.startsWith("node:")) {
    return false;
  }
  return NODE_BUILTINS.has(specifier.slice("node:".length));
}

function packageNameFromSpecifier(specifier) {
  const normalizedSpecifier = String(specifier || "").trim();
  if (
    !normalizedSpecifier ||
    normalizedSpecifier.startsWith(".") ||
    normalizedSpecifier.startsWith("/") ||
    isNodeBuiltinSpecifier(normalizedSpecifier)
  ) {
    return "";
  }
  if (normalizedSpecifier.startsWith("@")) {
    return normalizedSpecifier.split("/").slice(0, 2).join("/");
  }
  return normalizedSpecifier.split("/")[0];
}

function isWorkspaceDependency(packageName) {
  return String(packageName || "").startsWith("@local/");
}

function stripJavaScriptComments(source) {
  let output = "";
  let state = "code";
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const nextCharacter = source[index + 1] || "";

    if (state === "line-comment") {
      if (character === "\n") {
        state = "code";
        output += character;
      } else {
        output += " ";
      }
      continue;
    }

    if (state === "block-comment") {
      if (character === "*" && nextCharacter === "/") {
        state = "code";
        output += "  ";
        index += 1;
      } else {
        output += character === "\n" ? "\n" : " ";
      }
      continue;
    }

    if (state === "single-quote" || state === "double-quote" || state === "template") {
      output += character;
      if (escaped) {
        escaped = false;
        continue;
      }
      if (character === "\\") {
        escaped = true;
        continue;
      }
      if (
        (state === "single-quote" && character === "'") ||
        (state === "double-quote" && character === "\"") ||
        (state === "template" && character === "`")
      ) {
        state = "code";
      }
      continue;
    }

    if (character === "/" && nextCharacter === "/") {
      state = "line-comment";
      output += "  ";
      index += 1;
      continue;
    }
    if (character === "/" && nextCharacter === "*") {
      state = "block-comment";
      output += "  ";
      index += 1;
      continue;
    }
    if (character === "'") {
      state = "single-quote";
    } else if (character === "\"") {
      state = "double-quote";
    } else if (character === "`") {
      state = "template";
    }
    output += character;
  }

  return output;
}

function walkSourceFiles(directory, files = []) {
  if (!fs.existsSync(directory)) {
    return files;
  }

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if ([".git", "coverage", "dist", "node_modules", "test-results"].includes(entry.name)) {
      continue;
    }

    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walkSourceFiles(entryPath, files);
      continue;
    }

    if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(entryPath);
    }
  }

  return files;
}

function collectPackageImports(packageDirectory) {
  const imports = new Map();
  const sourceDirectory = path.join(packageDirectory, "src");

  for (const filePath of walkSourceFiles(sourceDirectory)) {
    const source = stripJavaScriptComments(fs.readFileSync(filePath, "utf8"));
    for (const match of source.matchAll(IMPORT_SPECIFIER_PATTERN)) {
      const specifier = match[1] || match[2] || match[3] || match[4] || "";
      const packageName = packageNameFromSpecifier(specifier);
      if (!packageName) {
        continue;
      }
      if (!imports.has(packageName)) {
        imports.set(packageName, new Set());
      }
      imports.get(packageName).add(relativePath(filePath));
    }
  }

  return imports;
}

function workspacePackageDirectories(rootManifest) {
  const workspaces = Array.isArray(rootManifest.workspaces) ? rootManifest.workspaces : [];
  if (!workspaces.includes(WORKSPACE_PATTERN)) {
    return [];
  }

  const packagesRoot = path.join(ROOT_DIR, "packages");
  return fs.readdirSync(packagesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(packagesRoot, entry.name))
    .filter((packageDirectory) => fs.existsSync(path.join(packageDirectory, "package.json")))
    .sort((left, right) => left.localeCompare(right));
}

function pushSetItems(target, values) {
  for (const value of values) {
    target.add(value);
  }
}

function packageDependencyNames(manifest) {
  const names = new Set();
  pushSetItems(names, Object.keys(manifest.dependencies || {}));
  pushSetItems(names, Object.keys(manifest.peerDependencies || {}));
  pushSetItems(names, Object.keys(manifest.optionalDependencies || {}));
  return names;
}

function verifyRootPackage({
  errors,
  packagesByName,
  rootManifest
}) {
  const workspaces = Array.isArray(rootManifest.workspaces) ? rootManifest.workspaces : [];
  if (!workspaces.includes(WORKSPACE_PATTERN)) {
    errors.push(`root package.json must declare workspaces including "${WORKSPACE_PATTERN}".`);
  }

  const rootDependencies = rootManifest.dependencies || {};
  const bundledDependencies = new Set([
    ...(rootManifest.bundleDependencies || []),
    ...(rootManifest.bundledDependencies || [])
  ]);
  if (bundledDependencies.size) {
    errors.push("The source manifest must not bundle complete dependency packages; the runtime release builder owns the staged manifest.");
  }

  for (const [packageName, workspacePackage] of packagesByName) {
    const declaredVersion = rootDependencies[packageName];
    if (declaredVersion !== workspacePackage.manifest.version) {
      errors.push(
        `root package.json must depend on ${packageName}@${workspacePackage.manifest.version}; found ${declaredVersion || "<missing>"}.`
      );
    }
  }

  for (const [dependencyName, versionSpec] of Object.entries(rootDependencies)) {
    if (!isWorkspaceDependency(dependencyName)) {
      continue;
    }
    if (!packagesByName.has(dependencyName)) {
      errors.push(`root package.json depends on unknown internal workspace package ${dependencyName}.`);
    }
    if (/^(?:file|workspace):/u.test(String(versionSpec))) {
      errors.push(
        `root package.json must use the exact workspace version for ${dependencyName}, not ${versionSpec}.`
      );
    }
  }

  for (const dependencySection of ["dependencies", "devDependencies", "optionalDependencies"]) {
    if (rootManifest[dependencySection]?.["@jskit-ai/jskit-cli"]) {
      errors.push(`root package.json ${dependencySection} must not restore the retired @jskit-ai/jskit-cli package.`);
    }
  }

  for (const [scriptName, scriptBody] of Object.entries(rootManifest.scripts || {})) {
    if (/\bjskit\s+(?:app|create(?:-app)?)\b/u.test(String(scriptBody))) {
      errors.push(`root package.json script "${scriptName}" must not invoke a retired JSKIT scaffolding command.`);
    }
  }
}

function verifyJskitMetadata({
  errors,
  manifest,
  packageDirectory,
  packageJsonPath
}) {
  const legacyDescriptorPath = path.join(packageDirectory, "package.descriptor.mjs");
  if (fs.existsSync(legacyDescriptorPath)) {
    errors.push(`${relativePath(legacyDescriptorPath)} uses the removed Beta 1 descriptor contract.`);
  }

  const metadataPath = `${relativePath(packageJsonPath)}#jskit`;
  const jskit = manifest.jskit;
  if (!jskit || typeof jskit !== "object" || Array.isArray(jskit)) {
    errors.push(`${metadataPath} must contain the package's JSKIT metadata.`);
    return;
  }

  if (!String(manifest.description || "").trim()) {
    errors.push(`${relativePath(packageJsonPath)} must declare its package description at the top level.`);
  }

  for (const legacyField of ["dependsOn", "description", "packageId", "packageVersion", "version"]) {
    if (Object.hasOwn(jskit, legacyField)) {
      errors.push(`${metadataPath} must not declare removed Beta 1 field ${legacyField}.`);
    }
  }
}

function verifyPackageContract({
  errors,
  packageInfo,
  packagesByName
}) {
  const {
    directImports,
    manifest,
    packageDirectory,
    packageJsonPath
  } = packageInfo;
  const dependencyNames = packageDependencyNames(manifest);
  const runtimeDependencies = manifest.dependencies || {};
  const mutationRuntimeDependencies = manifest.jskit?.mutations?.dependencies?.runtime || {};
  const mutationDevDependencies = manifest.jskit?.mutations?.dependencies?.dev || {};

  verifyJskitMetadata({
    errors,
    manifest,
    packageDirectory,
    packageJsonPath
  });

  if (manifest.name !== "@local/vibe64-genesis") {
    const directGenesisImports = directImports.get("genesis-compiler");
    if (directGenesisImports) {
      errors.push(
        `${manifest.name} imports genesis-compiler from ${sortedValues(directGenesisImports).join(", ")}; only @local/vibe64-genesis may interpret Genesis contracts.`
      );
    }
    if (dependencyNames.has("genesis-compiler")) {
      errors.push(
        `${manifest.name} must consume Genesis through @local/vibe64-genesis, not depend on genesis-compiler directly.`
      );
    }
    if (dependencyNames.has("genesis-stack")) {
      errors.push(
        `${manifest.name} must consume the curated Stack catalog through @local/vibe64-genesis, not depend on genesis-stack directly.`
      );
    }
  }

  if (manifest.private !== true) {
    errors.push(`${relativePath(packageJsonPath)} must remain private while it is named ${manifest.name}.`);
  }

  for (const [packageName, files] of directImports) {
    if (packageName === manifest.name) {
      continue;
    }
    if (!dependencyNames.has(packageName)) {
      errors.push(
        `${manifest.name} imports ${packageName} from ${sortedValues(files).join(", ")} but does not declare it in package.json dependencies.`
      );
    }
  }

  for (const [dependencyName, versionSpec] of Object.entries(runtimeDependencies)) {
    if (isWorkspaceDependency(dependencyName)) {
      const workspacePackage = packagesByName.get(dependencyName);
      if (!workspacePackage) {
        errors.push(`${manifest.name} declares unknown internal workspace dependency ${dependencyName}.`);
      } else if (versionSpec !== workspacePackage.manifest.version) {
        errors.push(
          `${manifest.name} must depend on ${dependencyName}@${workspacePackage.manifest.version}; found ${versionSpec}.`
        );
      }
    }

    if (dependencyName.startsWith("@jskit-ai/") && !/^\d+\.\d+\.\d+$/u.test(String(versionSpec))) {
      errors.push(
        `${manifest.name} must pin ${dependencyName} to an exact version; found ${versionSpec}.`
      );
    }
  }

  for (const [dependencyName, versionSpec] of Object.entries(mutationRuntimeDependencies)) {
    if (runtimeDependencies[dependencyName] !== versionSpec) {
      errors.push(
        `${relativePath(packageJsonPath)}#jskit runtime mutation ${dependencyName}@${versionSpec} disagrees with package.json (${runtimeDependencies[dependencyName] || "<missing>"}).`
      );
    }
  }

  for (const [dependencyName, versionSpec] of Object.entries(mutationDevDependencies)) {
    if ((manifest.devDependencies || {})[dependencyName] !== versionSpec) {
      errors.push(
        `${relativePath(packageJsonPath)}#jskit dev mutation ${dependencyName}@${versionSpec} disagrees with package.json devDependencies (${(manifest.devDependencies || {})[dependencyName] || "<missing>"}).`
      );
    }
  }
}

function main() {
  const errors = [];
  const rootManifest = readJson(path.join(ROOT_DIR, "package.json"));
  const packageDirectories = workspacePackageDirectories(rootManifest);
  const packages = [];
  const packagesByName = new Map();

  for (const packageDirectory of packageDirectories) {
    const packageJsonPath = path.join(packageDirectory, "package.json");
    const manifest = readJson(packageJsonPath);
    const packageInfo = {
      directImports: collectPackageImports(packageDirectory),
      manifest,
      packageDirectory,
      packageJsonPath
    };
    packages.push(packageInfo);
    if (packagesByName.has(manifest.name)) {
      errors.push(`Duplicate workspace package name ${manifest.name}.`);
    }
    packagesByName.set(manifest.name, packageInfo);
  }

  verifyRootPackage({
    errors,
    packagesByName,
    rootManifest
  });

  for (const packageInfo of packages) {
    verifyPackageContract({
      errors,
      packageInfo,
      packagesByName
    });
  }

  if (errors.length > 0) {
    console.error("Package boundary verification failed:");
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`Verified ${packages.length} workspace package contracts.`);
}

main();
