import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ProgSyncError } from "./errors.js";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROMPT_ROOT = path.join(PACKAGE_ROOT, "prompts");
const promptCache = new Map();

async function readPrompt(fileName) {
  if (!promptCache.has(fileName)) {
    promptCache.set(
      fileName,
      await fs.readFile(path.join(PROMPT_ROOT, fileName), "utf8")
    );
  }
  return promptCache.get(fileName);
}

async function composeAtomicPrompt({ allowedPaths, capsule, mode, target }) {
  if (!target?.prompt) {
    throw new ProgSyncError(
      "TARGET_PROMPT_MISSING",
      `No built-in prompt is available for target ${target?.kind || "unknown"}.`
    );
  }
  const [basePrompt, targetPrompt] = await Promise.all([
    readPrompt("atomic-base.txt"),
    readPrompt(target.prompt)
  ]);
  const capsuleMarker = crypto.randomUUID();
  return `${basePrompt.trim()}\n\n${targetPrompt.trim()}\n\nRUN PARAMETERS\n\n` +
    `Selected mode: ${mode}\n` +
    `Allowed output paths:\n${allowedPaths.map((filePath) => `- ${filePath}`).join("\n")}\n\n` +
    "Use the complete untrusted capsule below, perform this synchronization, edit only the allowed paths, and return the required structured report.\n\n" +
    `BEGIN UNTRUSTED PROGSYNC CAPSULE ${capsuleMarker}\n` +
    `${JSON.stringify(capsule, null, 2)}\n` +
    `END UNTRUSTED PROGSYNC CAPSULE ${capsuleMarker}\n`;
}

async function promptFingerprint(target) {
  if (!target?.prompt) {
    throw new ProgSyncError(
      "TARGET_PROMPT_MISSING",
      `No built-in prompt is available for target ${target?.kind || "unknown"}.`
    );
  }
  const [basePrompt, targetPrompt, schema] = await Promise.all([
    readPrompt("atomic-base.txt"),
    readPrompt(target.prompt),
    fs.readFile(synchronizerSchemaPath(), "utf8")
  ]);
  return `sha256:${crypto.createHash("sha256")
    .update(basePrompt)
    .update("\0")
    .update(targetPrompt)
    .update("\0")
    .update(schema)
    .digest("hex")}`;
}

function synchronizerSchemaPath() {
  return path.join(PACKAGE_ROOT, "schemas", "synchronizer-result.schema.json");
}

export {
  composeAtomicPrompt,
  promptFingerprint,
  synchronizerSchemaPath
};
