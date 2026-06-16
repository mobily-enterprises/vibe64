import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

async function writeTextFileAtomic(filePath = "", text = "") {
  await mkdir(path.dirname(filePath), {
    recursive: true
  });
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tempPath, text, "utf8");
  await rename(tempPath, filePath);
}

export {
  writeTextFileAtomic
};
