import path from "node:path";
import { execa } from "execa";

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

async function removeDockerContainer(containerName) {
  const normalizedContainerName = String(containerName || "").trim();
  if (!normalizedContainerName) {
    return;
  }
  await execa("docker", ["rm", "-f", normalizedContainerName], {
    reject: false,
    timeout: 10_000
  }).catch(() => null);
}

export {
  containerWorkspacePath,
  removeDockerContainer
};
