import { builtinModules } from "node:module";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

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

function looksLikePackageDependency(value) {
  const dependency = String(value || "").trim();
  if (!dependency) {
    return false;
  }
  if (dependency.startsWith("@")) {
    const segments = dependency.split("/");
    return segments.length === 2 && segments.every(Boolean);
  }
  return /^[a-z0-9][a-z0-9._-]*$/iu.test(dependency);
}

function isWorkspaceDependency(packageName) {
  return String(packageName || "").startsWith("@local/");
}

function isDescriptorDependency(packageName) {
  return isWorkspaceDependency(packageName) || packageName === "@jskit-ai/kernel";
}

function isExternalRuntimeDependency(packageName) {
  return !isDescriptorDependency(packageName);
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

async function readDescriptor(packageDirectory) {
  const descriptorPath = path.join(packageDirectory, "package.descriptor.mjs");
  if (!fs.existsSync(descriptorPath)) {
    return {
      descriptor: null,
      descriptorPath
    };
  }

  const moduleUrl = pathToFileURL(descriptorPath);
  moduleUrl.searchParams.set("mtime", String(fs.statSync(descriptorPath).mtimeMs));
  const descriptorModule = await import(moduleUrl.href);
  return {
    descriptor: descriptorModule.default,
    descriptorPath
  };
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

  for (const [packageName, workspacePackage] of packagesByName) {
    const declaredVersion = rootDependencies[packageName];
    if (declaredVersion !== workspacePackage.manifest.version) {
      errors.push(
        `root package.json must depend on ${packageName}@${workspacePackage.manifest.version}; found ${declaredVersion || "<missing>"}.`
      );
    }
    if (!bundledDependencies.has(packageName)) {
      errors.push(`root package.json must bundle internal workspace package ${packageName}.`);
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
        `root package.json must not publish ${dependencyName} as a ${versionSpec} dependency; use the workspace package version and bundle it.`
      );
    }
  }

  for (const dependencyName of bundledDependencies) {
    if (isWorkspaceDependency(dependencyName) && !packagesByName.has(dependencyName)) {
      errors.push(`root package.json bundles unknown internal workspace package ${dependencyName}.`);
    }
  }

  for (const [scriptName, scriptBody] of Object.entries(rootManifest.scripts || {})) {
    if (/(^|[;&|]\s*)jskit\s/u.test(String(scriptBody))) {
      errors.push(`root package.json script "${scriptName}" invokes bare jskit; use npx jskit.`);
    }
  }
}

function verifyDescriptorMetadata({
  descriptor,
  descriptorPath,
  errors,
  manifest
}) {
  if (!descriptor) {
    errors.push(`${relativePath(path.join(path.dirname(descriptorPath || ""), "package.descriptor.mjs"))} is missing.`);
    return;
  }

  if (descriptor.packageId !== manifest.name) {
    errors.push(
      `${relativePath(descriptorPath)} packageId must match package.json name ${manifest.name}; found ${descriptor.packageId || "<missing>"}.`
    );
  }
  if (descriptor.version !== manifest.version) {
    errors.push(
      `${relativePath(descriptorPath)} version must match package.json version ${manifest.version}; found ${descriptor.version || "<missing>"}.`
    );
  }
}

function verifyPackageContract({
  errors,
  packageInfo,
  packagesByName
}) {
  const {
    descriptor,
    descriptorPath,
    directImports,
    manifest,
    packageJsonPath
  } = packageInfo;
  const dependencyNames = packageDependencyNames(manifest);
  const runtimeDependencies = manifest.dependencies || {};
  const descriptorDependsOn = new Set(
    (descriptor?.dependsOn || []).filter((dependencyName) => looksLikePackageDependency(dependencyName))
  );
  const mutationRuntimeDependencies = descriptor?.mutations?.dependencies?.runtime || {};
  const mutationDevDependencies = descriptor?.mutations?.dependencies?.dev || {};
  const requiredDependencies = new Set();

  verifyDescriptorMetadata({
    descriptor,
    descriptorPath,
    errors,
    manifest
  });

  if (manifest.private !== true) {
    errors.push(`${relativePath(packageJsonPath)} must remain private while it is named ${manifest.name}.`);
  }

  for (const [packageName, files] of directImports) {
    if (packageName === manifest.name) {
      continue;
    }
    requiredDependencies.add(packageName);
    if (!dependencyNames.has(packageName)) {
      errors.push(
        `${manifest.name} imports ${packageName} from ${sortedValues(files).join(", ")} but does not declare it in package.json dependencies.`
      );
    }
  }

  for (const dependencyName of descriptorDependsOn) {
    requiredDependencies.add(dependencyName);
    if (!dependencyNames.has(dependencyName)) {
      errors.push(
        `${relativePath(descriptorPath)} dependsOn includes ${dependencyName}, but ${relativePath(packageJsonPath)} does not declare it.`
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

    if (isDescriptorDependency(dependencyName) && !descriptorDependsOn.has(dependencyName)) {
      errors.push(
        `${manifest.name} declares ${dependencyName}, but ${relativePath(descriptorPath)} does not list it in dependsOn.`
      );
    }

    if (
      !requiredDependencies.has(dependencyName) &&
      !Object.hasOwn(mutationRuntimeDependencies, dependencyName)
    ) {
      errors.push(
        `${manifest.name} declares unused runtime dependency ${dependencyName}; it is not imported, in descriptor dependsOn, or in descriptor runtime mutations.`
      );
    }
  }

  for (const [dependencyName, versionSpec] of Object.entries(mutationRuntimeDependencies)) {
    if (!isExternalRuntimeDependency(dependencyName)) {
      errors.push(
        `${relativePath(descriptorPath)} mutations.dependencies.runtime must only list external runtime packages; move ${dependencyName} to dependsOn.`
      );
    }
    if (runtimeDependencies[dependencyName] !== versionSpec) {
      errors.push(
        `${relativePath(descriptorPath)} runtime mutation ${dependencyName}@${versionSpec} disagrees with package.json (${runtimeDependencies[dependencyName] || "<missing>"}).`
      );
    }
  }

  for (const [dependencyName, versionSpec] of Object.entries(mutationDevDependencies)) {
    if ((manifest.devDependencies || {})[dependencyName] !== versionSpec) {
      errors.push(
        `${relativePath(descriptorPath)} dev mutation ${dependencyName}@${versionSpec} disagrees with package.json devDependencies (${(manifest.devDependencies || {})[dependencyName] || "<missing>"}).`
      );
    }
  }
}

async function main() {
  const errors = [];
  const rootManifest = readJson(path.join(ROOT_DIR, "package.json"));
  const packageDirectories = workspacePackageDirectories(rootManifest);
  const packages = [];
  const packagesByName = new Map();

  for (const packageDirectory of packageDirectories) {
    const packageJsonPath = path.join(packageDirectory, "package.json");
    const manifest = readJson(packageJsonPath);
    const { descriptor, descriptorPath } = await readDescriptor(packageDirectory);
    const packageInfo = {
      descriptor,
      descriptorPath,
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

await main();
