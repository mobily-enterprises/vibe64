// Small JSON state files written atomically (temporary file + rename), so a
// crash never leaves half a record behind.
import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

async function readJsonFile(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return typeof fallback === "function" ? fallback() : fallback;
    if (error instanceof SyntaxError) {
      throw Object.assign(new Error(`${path.basename(file)} is not valid JSON.`), { code: "vibe64_publishing_state_invalid" });
    }
    throw error;
  }
}

async function writeJsonFile(file, value, { mode = 0o600, directoryMode = 0o700 } = {}) {
  await mkdir(path.dirname(file), { recursive: true, mode: directoryMode });
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode });
    await rename(temporary, file);
    await chmod(file, mode);
  } finally {
    await rm(temporary, { force: true });
  }
  return value;
}

// One writer at a time per file inside this process.
function serialized() {
  let tail = Promise.resolve();
  return (operation) => {
    const run = tail.then(operation, operation);
    tail = run.catch(() => {});
    return run;
  };
}

export { readJsonFile, serialized, writeJsonFile };
