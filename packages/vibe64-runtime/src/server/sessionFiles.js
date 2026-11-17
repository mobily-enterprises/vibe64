import { writeFileAtomic } from "@local/vibe64-core/server/atomicFile";

/**
 * Session files are published durably by rename from a private temporary file
 * (Core's atomic file writer), so a reader sees either the old or the new whole
 * file, and so does the next start after a power cut. The result names the
 * published file exactly.
 */
async function writeTextFile(filePath, text) {
  return fileIdentity(await writeFileAtomic(filePath, String(text)));
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
