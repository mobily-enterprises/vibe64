import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const TOOLING_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(TOOLING_DIR, "..");
const ROOT_PACKAGE_NAME = "@vibe64/run";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || ROOT_DIR,
    encoding: "utf8",
    env: {
      ...process.env,
      CI: "1",
      ...(options.env || {})
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  if (result.status === 0) {
    return result;
  }

  const renderedCommand = [command, ...args].join(" ");
  throw new Error([
    `Command failed: ${renderedCommand}`,
    result.stdout.trim(),
    result.stderr.trim()
  ].filter(Boolean).join("\n"));
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function tarballsIn(directory) {
  return fs.readdirSync(directory)
    .filter((entry) => entry.endsWith(".tgz"))
    .map((entry) => path.join(directory, entry))
    .sort((left, right) => left.localeCompare(right));
}

function verifierScript() {
  return `
    import fs from "node:fs";
    import path from "node:path";
    import { pathToFileURL } from "node:url";

    const rootPackageName = ${JSON.stringify(ROOT_PACKAGE_NAME)};
    const packageRoot = path.join(process.cwd(), "node_modules", ...rootPackageName.split("/"));
    const manifestPath = path.join(packageRoot, "package.json");
    if (!fs.existsSync(manifestPath)) {
      throw new Error(\`\${rootPackageName} was not installed at \${manifestPath}.\`);
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const dependencies = manifest.dependencies || {};
    const bundledDependencies = [
      ...(manifest.bundleDependencies || []),
      ...(manifest.bundledDependencies || [])
    ];

    for (const [dependencyName, versionSpec] of Object.entries(dependencies)) {
      if (dependencyName.startsWith("@local/") && String(versionSpec).startsWith("file:")) {
        throw new Error(\`\${dependencyName} is still published as \${versionSpec}.\`);
      }
    }

    if (bundledDependencies.length === 0) {
      throw new Error("The published root package does not declare bundled internal dependencies.");
    }

    for (const dependencyName of bundledDependencies) {
      if (!dependencyName.startsWith("@local/")) {
        continue;
      }

      const packagePathSegments = dependencyName.split("/");
      const candidates = [
        path.join(packageRoot, "node_modules", ...packagePathSegments, "package.json"),
        path.join(process.cwd(), "node_modules", ...packagePathSegments, "package.json")
      ];
      const internalManifestPath = candidates.find((candidate) => fs.existsSync(candidate));
      if (!internalManifestPath) {
        throw new Error(\`\${dependencyName} was not installed from the bundled release artifact.\`);
      }

      const internalManifest = JSON.parse(fs.readFileSync(internalManifestPath, "utf8"));
      if (internalManifest.private !== true) {
        throw new Error(\`\${dependencyName} must remain a private internal package.\`);
      }
    }

    const binTarget = path.join(packageRoot, manifest.bin["vibe64"]);
    if (!fs.existsSync(binTarget)) {
      throw new Error(\`The vibe64 bin target is missing: \${binTarget}\`);
    }

    const serverModule = await import(pathToFileURL(path.join(packageRoot, "server.js")).href);
    if (typeof serverModule.startServer !== "function") {
      throw new Error("The packaged server entry does not export startServer.");
    }

    const runModule = await import(pathToFileURL(path.join(packageRoot, "bin", "run.js")).href);
    if (!runModule.SERVER_ENTRYPOINT || !fs.existsSync(runModule.SERVER_ENTRYPOINT)) {
      throw new Error("The packaged CLI entry does not resolve its server entrypoint.");
    }
  `;
}

function packageSmoke() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vibe64-package-smoke-"));
  const packDirectory = path.join(tempRoot, "pack");
  const installDirectory = path.join(tempRoot, "install");
  fs.mkdirSync(packDirectory, { recursive: true });
  fs.mkdirSync(installDirectory, { recursive: true });

  try {
    run("npm", ["pack", "--pack-destination", packDirectory]);
    const tarballs = tarballsIn(packDirectory);
    if (tarballs.length !== 1) {
      throw new Error(`Expected one packed tarball in ${packDirectory}; found ${tarballs.length}.`);
    }

    const packedRootManifest = readJson(path.join(ROOT_DIR, "package.json"));
    fs.writeFileSync(path.join(installDirectory, "package.json"), `${JSON.stringify({
      private: true,
      type: "module",
      dependencies: {
        [ROOT_PACKAGE_NAME]: `file:${tarballs[0]}`
      }
    }, null, 2)}\n`);

    run("npm", ["install", "--omit=dev", "--no-audit", "--no-fund"], {
      cwd: installDirectory
    });
    run("node", ["--input-type=module", "--eval", verifierScript()], {
      cwd: installDirectory
    });

    console.log(`Package install smoke passed for ${packedRootManifest.name}@${packedRootManifest.version}.`);
  } finally {
    if (!process.env.VIBE64_KEEP_PACKAGE_SMOKE) {
      fs.rmSync(tempRoot, {
        force: true,
        recursive: true
      });
    } else {
      console.log(`Kept package smoke directory: ${tempRoot}`);
    }
  }
}

packageSmoke();
