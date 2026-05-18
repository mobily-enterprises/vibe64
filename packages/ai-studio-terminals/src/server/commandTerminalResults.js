import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const COMMAND_RESULT_ENV = "AI_STUDIO_COMMAND_RESULT_FILE";

async function createCommandResultFile() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ai-studio-command-"));
  return {
    directory,
    path: path.join(directory, "result.tsv")
  };
}

function decodeResultValue(encodedValue = "") {
  return Buffer.from(String(encodedValue || ""), "base64").toString("utf8");
}

function parseCommandResultLine(line = "") {
  const [operation, name, encodedValue = ""] = String(line || "").split("\t");
  if (operation === "fact:set" && name) {
    return {
      name,
      operation,
      value: decodeResultValue(encodedValue)
    };
  }
  return null;
}

async function readCommandResultFile(filePath = "") {
  if (!filePath) {
    return {
      facts: {}
    };
  }

  let contents = "";
  try {
    contents = await readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {
        facts: {}
      };
    }
    throw error;
  }

  const effects = contents
    .split(/\r?\n/u)
    .map(parseCommandResultLine)
    .filter(Boolean);
  return {
    facts: Object.fromEntries(effects
      .filter((effect) => effect.operation === "fact:set")
      .map((effect) => [effect.name, effect.value]))
  };
}

async function removeCommandResultFile(resultFile = {}) {
  if (!resultFile.directory) {
    return;
  }
  await rm(resultFile.directory, {
    force: true,
    recursive: true
  });
}

export {
  COMMAND_RESULT_ENV,
  createCommandResultFile,
  readCommandResultFile,
  removeCommandResultFile
};
