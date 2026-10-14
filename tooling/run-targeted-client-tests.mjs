import { statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { runSourceDevelopment, sourceDevelopmentSelected } from "./development/run.mjs";

const [target, ...extra] = process.argv.slice(2);
if (extra.length || !/^tests\/client\/[a-zA-Z0-9_-]+\.vitest\.js$/u.test(target || "") || !statSync(target).isFile()) {
  console.error("Pass exactly one client test file: npm run test:client:file -- tests/client/example.vitest.js");
  process.exitCode = 1;
} else {
  const require = createRequire(import.meta.url);
  if (sourceDevelopmentSelected()) {
    process.exitCode = await runSourceDevelopment({
      publicRoot: dirname(dirname(fileURLToPath(import.meta.url))),
      command: process.execPath, args: ["tooling/run-targeted-client-tests.mjs", target]
    });
  } else {
    const result = spawnSync(process.execPath, [join(dirname(require.resolve("vitest/package.json")), "vitest.mjs"), "run", target, "--maxWorkers=1", "--no-file-parallelism"], { stdio: "inherit" });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  }
}
