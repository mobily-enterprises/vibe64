import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

// Session files are published by rename from a private temporary file, so a
// reader sees either the old or the new whole file.
async function writeTextFile(filePath, text) {
  const directory = path.dirname(filePath);
  const tempPath = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`);
  await mkdir(directory, {
    recursive: true
  });
  try {
    await writeFile(tempPath, String(text), "utf8");
    // Rename keeps this inode and modification time, so the result names the
    // published file exactly.
    const identity = fileIdentity(await stat(tempPath, { bigint: true }));
    await rename(tempPath, filePath);
    return identity;
  } catch (error) {
    await rm(tempPath, {
      force: true
    });
    throw error;
  }
}

async function writeJsonFile(filePath, value) {
  await writeTextFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function fileIdentity(stats) {
  return `${stats.dev}:${stats.ino}:${stats.size}:${stats.mtimeNs}`;
}

export {
  fileIdentity,
  writeJsonFile,
  writeTextFile
};
