// Each person's starred files in a project, as personal stars:
//   <project state>/source-editor/stars/<hash of the person>.json   { "paths": [...] }
import path from "node:path";
import { changePersonalStar, personalStarsFile, readPersonalStars } from "@local/vibe64-core/server/personalStars";
import { sourceEditorError } from "./sourceEditorPaths.js";

const MAX_STARRED_FILES = 100;
const STARRED_FILES = Object.freeze({
  field: "paths",
  limit: MAX_STARRED_FILES,
  overLimit: () => sourceEditorError(`You can star up to ${MAX_STARRED_FILES} files per project.`, "vibe64_source_editor_star_limit", {}, 400, {
    params: { limit: MAX_STARRED_FILES }
  })
});

function starredFilesPath(stateRoot, user) {
  if (!stateRoot) {
    throw new Error("Starred files require the project's runtime state root.");
  }
  return personalStarsFile(path.join(stateRoot, "source-editor", "stars"), user);
}

function readStarredFilePaths(filePath) {
  return readPersonalStars(filePath, STARRED_FILES);
}

function writeStarredFile(filePath, relativePath, starred) {
  return changePersonalStar(filePath, STARRED_FILES, relativePath, starred);
}

export { readStarredFilePaths, starredFilesPath, writeStarredFile };
