import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { GITHUB_ACCOUNT_MODE_USER, USER_CREDENTIAL_SCOPE } from "@local/vibe64-execution/server";

// Files in a person's tool home: optional reads, private JSON writes, and the
// tool home folder itself, which only an app credential context owns.

function isUserCredentialContext(context = {}) {
  return context.scope === USER_CREDENTIAL_SCOPE || context.accountMode === GITHUB_ACCOUNT_MODE_USER;
}

async function ensureToolHomeSource(context = {}) {
  if (!context.toolHomeSource) {
    return;
  }
  if (isUserCredentialContext(context)) {
    return;
  }
  await mkdir(context.toolHomeSource, {
    mode: 0o700,
    recursive: true
  });
}

async function readOptionalText(filePath = "") {
  if (!filePath) {
    return "";
  }
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

async function readOptionalJson(filePath = "") {
  const text = await readOptionalText(filePath);
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function writeJsonFile(filePath = "", value = {}) {
  await mkdir(path.dirname(filePath), {
    mode: 0o700,
    recursive: true
  });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600
  });
}

export {
  ensureToolHomeSource,
  isUserCredentialContext,
  readOptionalJson,
  readOptionalText,
  writeJsonFile
};
