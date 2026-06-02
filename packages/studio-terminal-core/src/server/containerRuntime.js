import path from "node:path";
import {
  runHostCommand
} from "./shellCommands.js";

function containerWorkspacePath(targetRoot, absolutePath) {
  const relativePath = path.relative(targetRoot, absolutePath);
  if (!relativePath || relativePath === ".") {
    return "/workspace";
  }
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return "";
  }
  return path.posix.join("/workspace", ...relativePath.split(path.sep));
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
