import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";

const TARGETS = Object.freeze([
  "win32-arm64",
  "win32-x64"
]);

async function pathSize(targetPath) {
  let total = 0;
  const item = await stat(targetPath);
  if (!item.isDirectory()) {
    return item.size;
  }
  const entries = await readdir(targetPath, {
    withFileTypes: true
  });
  for (const entry of entries) {
    total += await pathSize(path.join(targetPath, entry.name));
  }
  return total;
}

async function pruneTarget(targetPath) {
  try {
    const size = await pathSize(targetPath);
    await rm(targetPath, {
      force: true,
      recursive: true
    });
    return {
      pruned: true,
      size
    };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {
        pruned: false,
        size: 0
      };
    }
    throw error;
  }
}

const prebuildsRoot = path.resolve("node_modules/node-pty/prebuilds");
let prunedBytes = 0;
let prunedTargets = 0;

for (const target of TARGETS) {
  const targetPath = path.join(prebuildsRoot, target);
  const result = await pruneTarget(targetPath);
  if (result.pruned) {
    prunedTargets += 1;
    prunedBytes += result.size;
    console.log(`Pruned ${path.relative(process.cwd(), targetPath)} (${result.size} bytes).`);
  }
}

console.log(`Pruned ${prunedTargets} node-pty Windows prebuild directories (${prunedBytes} bytes).`);
