import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);

async function packageSmoke(tarball, { dependencyOverrides = {} } = {}) {
  if (!tarball) throw new Error("Provide a release tarball: npm run smoke:package -- /absolute/path/vibe64-version.tgz");
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-package-smoke-"));
  try {
    const install = path.join(root, "install");
    await mkdir(install);
    await writeFile(path.join(install, "package.json"), JSON.stringify({
      private: true, dependencies: { vibe64: `file:${path.resolve(tarball)}` }, overrides: dependencyOverrides
    }));
    // Lifecycle scripts are required for platform-native dependencies such as node-pty.
    console.log("[release] Installing the tarball in a fresh directory and checking its runtime");
    await execute("npm", ["install", "--omit=dev", "--no-audit", "--no-fund", "--foreground-scripts"], {
      cwd: install, maxBuffer: 8 * 1024 * 1024, timeout: 180000
    });
    const appRoot = path.join(install, "node_modules/vibe64");
    // A fresh process proves that the source checkout's loaded modules cannot mask missing files.
    const verification = new URL("./release/verify-runtime.mjs", import.meta.url).href;
    const { stdout } = await execute(process.execPath, ["--input-type=module", "--eval",
      `import {verifyRuntime} from ${JSON.stringify(verification)}; await verifyRuntime(${JSON.stringify(appRoot)});`
    ], { cwd: install, maxBuffer: 4 * 1024 * 1024, timeout: 90000 });
    process.stdout.write(stdout);
    console.log(`Package install smoke passed: ${tarball}`);
  } finally {
    if (process.env.VIBE64_KEEP_PACKAGE_SMOKE === "1") console.log(`Kept package smoke: ${root}`);
    else await rm(root, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await packageSmoke(process.argv[2]);
}
export { packageSmoke };
