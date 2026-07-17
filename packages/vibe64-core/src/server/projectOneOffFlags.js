import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import path from "node:path";

import {
  normalizeText
} from "./core.js";

const PROJECT_ONE_OFF_FLAGS_DIR = "one-off-flags";
const PROJECT_ONE_OFF_FLAG_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/u;

function normalizeProjectOneOffFlagName(value = "") {
  const name = normalizeText(value);
  if (!PROJECT_ONE_OFF_FLAG_NAME_PATTERN.test(name)) {
    const error = new Error(`Invalid project one-off flag name: ${name || "(empty)"}.`);
    error.code = "vibe64_project_one_off_flag_name_invalid";
    throw error;
  }
  return name;
}

function projectOneOffFlagPath({
  name = "",
  projectRuntimeRoot = ""
} = {}) {
  const root = normalizeText(projectRuntimeRoot);
  if (!root) {
    const error = new Error("Project one-off flags require a project runtime root.");
    error.code = "vibe64_project_runtime_root_required";
    throw error;
  }
  return path.join(
    path.resolve(root),
    PROJECT_ONE_OFF_FLAGS_DIR,
    `${normalizeProjectOneOffFlagName(name)}.json`
  );
}

async function writeProjectOneOffFlag({
  name = "",
  projectRuntimeRoot = "",
  value = null
} = {}) {
  const filePath = projectOneOffFlagPath({
    name,
    projectRuntimeRoot
  });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await mkdir(path.dirname(filePath), {
    recursive: true
  });
  try {
    await writeFile(temporaryPath, `${JSON.stringify({ value }, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600
    });
    await rename(temporaryPath, filePath);
  } finally {
    await rm(temporaryPath, {
      force: true
    });
  }
  return value;
}

async function readProjectOneOffFlag({
  name = "",
  projectRuntimeRoot = ""
} = {}) {
  const filePath = projectOneOffFlagPath({
    name,
    projectRuntimeRoot
  });
  try {
    const record = JSON.parse(await readFile(filePath, "utf8"));
    return Object.hasOwn(record || {}, "value") ? record.value : null;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function consumeProjectOneOffFlag({
  name = "",
  projectRuntimeRoot = ""
} = {}) {
  await rm(projectOneOffFlagPath({
    name,
    projectRuntimeRoot
  }), {
    force: true
  });
}

export {
  PROJECT_ONE_OFF_FLAGS_DIR,
  consumeProjectOneOffFlag,
  normalizeProjectOneOffFlagName,
  readProjectOneOffFlag,
  writeProjectOneOffFlag
};
