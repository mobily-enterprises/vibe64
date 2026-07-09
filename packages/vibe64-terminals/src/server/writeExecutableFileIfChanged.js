import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

async function executableFileState(filePath = "", {
  mode = 0o755
} = {}) {
  try {
    const [content, stats] = await Promise.all([
      readFile(filePath, "utf8"),
      stat(filePath)
    ]);
    return {
      content,
      executableModeMatches: (stats.mode & 0o777) === mode,
      exists: true
    };
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
      return {
        content: "",
        executableModeMatches: false,
        exists: false
      };
    }
    throw error;
  }
}

async function writeExecutableFileIfChanged(filePath = "", content = "", {
  mode = 0o755
} = {}) {
  const resolvedPath = path.resolve(String(filePath || ""));
  await mkdir(path.dirname(resolvedPath), {
    recursive: true
  });
  const current = await executableFileState(resolvedPath, {
    mode
  });
  if (current.exists && current.content === content) {
    if (!current.executableModeMatches) {
      await chmod(resolvedPath, mode);
      return {
        changed: true,
        reason: "mode"
      };
    }
    return {
      changed: false,
      reason: "unchanged"
    };
  }
  await writeFile(resolvedPath, content, {
    mode
  });
  await chmod(resolvedPath, mode);
  return {
    changed: true,
    reason: current.exists ? "content" : "created"
  };
}

export {
  writeExecutableFileIfChanged
};
