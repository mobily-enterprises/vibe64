import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { createRuntimePackage } from "./runtime-package.mjs";
import { packageSmoke } from "../package-install-smoke.mjs";

const execute = promisify(execFile);
const APP_ROOT = fileURLToPath(new URL("../../", import.meta.url));

async function packRelease({ appRoot = APP_ROOT, outputDirectory = path.join(appRoot, ".vibe64-release"), smoke = true } = {}) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "vibe64-release-"));
  try {
    for (const command of ["verify:packages", "build"]) {
      console.log(`[release] Running ${command}`);
      await new Promise((resolve, reject) => {
        const child = spawn("npm", ["run", command], { cwd: appRoot, stdio: "inherit" });
        child.once("error", reject);
        child.once("exit", code => code === 0 ? resolve() : reject(new Error(`${command} failed with exit code ${code}.`)));
      });
    }
    await createRuntimePackage({ appRoot, releaseAppRoot: path.join(temporary, "app") });
    await mkdir(outputDirectory, { recursive: true });
    const artifactDirectory = await mkdtemp(path.join(outputDirectory, "build-"));
    const { stdout } = await execute("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", artifactDirectory], {
      cwd: path.join(temporary, "app"), maxBuffer: 8 * 1024 * 1024
    });
    const [packed] = JSON.parse(stdout);
    const tarball = path.join(artifactDirectory, packed.filename);
    console.log(`[release] ${tarball}: ${packed.size} bytes packed, ${packed.unpackedSize} bytes unpacked`);
    if (smoke) await packageSmoke(tarball);
    return tarball;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await packRelease();
}

export { packRelease };
