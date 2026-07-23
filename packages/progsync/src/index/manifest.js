import fs from "node:fs/promises";
import path from "node:path";

import { absoluteProjectPath, slashPath } from "./paths.js";

function manifestTargetValues(value, output = []) {
  if (typeof value === "string") {
    output.push(value);
  } else if (Array.isArray(value)) {
    for (const entry of value) {
      manifestTargetValues(entry, output);
    }
  } else if (value && typeof value === "object") {
    for (const entry of Object.values(value)) {
      manifestTargetValues(entry, output);
    }
  }
  return output;
}

function normalizedManifestTarget(value) {
  return slashPath(String(value || "")).replace(/^\.\//u, "");
}

function manifestTargetMatches(pattern, relativeTarget) {
  const normalizedPattern = normalizedManifestTarget(pattern);
  const normalizedTarget = normalizedManifestTarget(relativeTarget);
  if (!normalizedPattern.includes("*")) {
    return normalizedPattern === normalizedTarget;
  }
  const pieces = normalizedPattern.split("*");
  const escaped = pieces.map((piece) => (
    piece.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")
  ));
  const expression = escaped
    .map((piece, index) => (
      index === 0
        ? piece
        : `${index === 1 ? "(.*)" : "\\1"}${piece}`
    ))
    .join("");
  return new RegExp(`^${expression}$`, "u").test(normalizedTarget);
}

function manifestPublicTargets(manifest = {}) {
  return [
    ...manifestTargetValues(manifest.exports),
    ...manifestTargetValues(manifest.bin),
    ...manifestTargetValues(manifest.main),
    ...manifestTargetValues(manifest.module)
  ];
}

async function nearestPackageManifest(root, targetFile, cache = new Map()) {
  let directory = path.posix.dirname(targetFile);
  while (directory !== "." && directory !== "") {
    if (cache.has(directory)) {
      const cached = cache.get(directory);
      if (cached) {
        return cached;
      }
    } else {
      const manifestPath = path.posix.join(directory, "package.json");
      try {
        const manifest = JSON.parse(await fs.readFile(
          absoluteProjectPath(root, manifestPath),
          "utf8"
        ));
        const result = { directory, manifest, manifestPath };
        cache.set(directory, result);
        return result;
      } catch (error) {
        if (error?.code !== "ENOENT") {
          throw error;
        }
        cache.set(directory, null);
      }
    }
    directory = path.posix.dirname(directory);
  }
  if (!cache.has(".")) {
    try {
      cache.set(".", {
        directory: ".",
        manifest: JSON.parse(await fs.readFile(
          absoluteProjectPath(root, "package.json"),
          "utf8"
        )),
        manifestPath: "package.json"
      });
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
      cache.set(".", null);
    }
  }
  return cache.get(".");
}

async function manifestBoundaryForTarget(root, targetFile, cache = new Map()) {
  const packageInfo = await nearestPackageManifest(root, targetFile, cache);
  if (!packageInfo) {
    return {
      directory: null,
      externallyInvoked: false,
      manifest: null,
      manifestPath: null,
      matchedTarget: null
    };
  }
  const relative = slashPath(path.posix.relative(packageInfo.directory, targetFile));
  const matchedTarget = manifestPublicTargets(packageInfo.manifest).find((candidate) => (
    manifestTargetMatches(candidate, relative)
  )) || null;
  return {
    directory: packageInfo.directory,
    externallyInvoked: Boolean(matchedTarget),
    manifest: packageInfo.manifest,
    manifestPath: packageInfo.manifestPath,
    matchedTarget
  };
}

export {
  manifestBoundaryForTarget
};
