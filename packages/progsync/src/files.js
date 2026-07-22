import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

async function stageFileWrite(absolutePath, source, permissions = 0o644) {
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  const temporaryPath = path.join(
    path.dirname(absolutePath),
    `.${path.basename(absolutePath)}.progsync-${crypto.randomBytes(8).toString("hex")}`
  );
  try {
    await fs.writeFile(temporaryPath, source, {
      encoding: "utf8",
      mode: permissions
    });
    await fs.chmod(temporaryPath, permissions);
    return temporaryPath;
  } catch (error) {
    await fs.rm(temporaryPath, { force: true });
    throw error;
  }
}

async function writeFileAtomic(absolutePath, source, permissions = 0o644) {
  const temporaryPath = await stageFileWrite(absolutePath, source, permissions);
  try {
    await fs.rename(temporaryPath, absolutePath);
  } finally {
    await fs.rm(temporaryPath, { force: true });
  }
}

export {
  stageFileWrite,
  writeFileAtomic
};
