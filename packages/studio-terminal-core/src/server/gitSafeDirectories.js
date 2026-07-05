import path from "node:path";

function normalizeText(value = "") {
  return String(value || "").trim();
}

function absoluteUniqueGitPaths(paths = []) {
  const seen = new Set();
  const result = [];
  for (const value of Array.isArray(paths) ? paths : []) {
    const normalized = normalizeText(value);
    if (!normalized || !path.isAbsolute(normalized)) {
      continue;
    }
    const resolved = path.resolve(normalized);
    if (seen.has(resolved)) {
      continue;
    }
    seen.add(resolved);
    result.push(resolved);
  }
  return result;
}

function applyGitConfigEntriesToEnv(env = {}, entries = []) {
  const output = {
    ...(env && typeof env === "object" && !Array.isArray(env) ? env : {})
  };
  const currentCount = Number.parseInt(String(output.GIT_CONFIG_COUNT || "0"), 10);
  let index = Number.isSafeInteger(currentCount) && currentCount >= 0 ? currentCount : 0;
  for (const entry of Array.isArray(entries) ? entries : []) {
    const key = normalizeText(entry?.key);
    if (!key) {
      continue;
    }
    output[`GIT_CONFIG_KEY_${index}`] = key;
    output[`GIT_CONFIG_VALUE_${index}`] = String(entry?.value ?? "");
    index += 1;
  }
  output.GIT_CONFIG_COUNT = String(index);
  return output;
}

function gitSafeDirectoryEntries(paths = []) {
  return absoluteUniqueGitPaths(paths).map((directory) => ({
    key: "safe.directory",
    value: directory
  }));
}

function applyGitSafeDirectoriesToEnv(env = {}, directories = []) {
  return applyGitConfigEntriesToEnv(env, gitSafeDirectoryEntries(directories));
}

function gitSafeDirectoryArgs(paths = []) {
  return gitSafeDirectoryEntries(paths).flatMap((entry) => [
    "-c",
    `${entry.key}=${entry.value}`
  ]);
}

export {
  absoluteUniqueGitPaths,
  applyGitConfigEntriesToEnv,
  applyGitSafeDirectoriesToEnv,
  gitSafeDirectoryArgs,
  gitSafeDirectoryEntries
};
