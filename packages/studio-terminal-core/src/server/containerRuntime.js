import path from "node:path";
import {
  runHostCommand
} from "./shellCommands.js";

function containerWorkspacePath(targetRoot, absolutePath) {
  if (!targetRoot || !absolutePath) {
    return "";
  }
  const resolvedTargetRoot = path.resolve(targetRoot);
  const resolvedAbsolutePath = path.resolve(absolutePath);
  const relativePath = path.relative(resolvedTargetRoot, resolvedAbsolutePath);
  if (!relativePath || relativePath === ".") {
    return resolvedAbsolutePath;
  }
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return "";
  }
  return resolvedAbsolutePath;
}

async function dockerImageExists(imageName, {
  timeout = 12_000
} = {}) {
  const normalizedImageName = String(imageName || "").trim();
  if (!normalizedImageName) {
    return false;
  }

  const result = await runHostCommand("docker", [
    "image",
    "inspect",
    normalizedImageName,
    "--format",
    "{{.Id}}"
  ], {
    timeout
  });
  return result.ok;
}

export {
  containerWorkspacePath,
  dockerImageExists
};
