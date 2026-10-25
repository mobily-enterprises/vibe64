import path from "node:path";

// Whether `candidate` lies inside `root`; `allowRoot` says whether `root` itself counts.
function pathWithin(root, candidate, { allowRoot }) {
  const relative = path.relative(root, candidate);
  if (relative === "") return allowRoot;
  return !relative.startsWith("..") && !path.isAbsolute(relative);
}

export { pathWithin };
