import path from "node:path";

// Whether `candidate` lies inside `root`; `allowRoot` says whether `root` itself
// counts. A child named `..cache` is inside; `..` and `../x` are not.
function pathWithin(root, candidate, { allowRoot }) {
  const relative = path.relative(root, candidate);
  if (relative === "") return allowRoot;
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export { pathWithin };
