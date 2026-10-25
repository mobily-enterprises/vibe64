import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { pathInside, pathInsideOrEqual, relativePathInside } from "../../packages/vibe64-core/src/server/core.js";
import { pathWithin } from "../../packages/vibe64-packaging/src/server/paths.js";

const root = path.resolve("/srv/vibe64/source");

test("path containment treats dot-dot-named children as inside and parents, siblings and empty input as outside", () => {
  for (const child of ["..cache", "..foo/file.txt", "src/..hidden", "a/b"]) {
    const candidate = path.join(root, child);
    assert.equal(pathInsideOrEqual(root, candidate), true, child);
    assert.equal(pathInside(root, candidate), true, child);
    assert.equal(pathWithin(root, candidate, { allowRoot: false }), true, child);
  }
  for (const candidate of [path.dirname(root), path.join(root, "..", "sibling"), "/etc/passwd"]) {
    assert.equal(pathInsideOrEqual(root, candidate), false, candidate);
    assert.equal(pathInside(root, candidate), false, candidate);
    assert.equal(pathWithin(root, candidate, { allowRoot: true }), false, candidate);
  }
  assert.equal(pathInsideOrEqual(root, root), true);
  assert.equal(pathInside(root, root), false);
  assert.equal(relativePathInside(root, `${root}/`), "");
  assert.equal(relativePathInside(root, path.join(root, "x", "..", "y")), "y");
  for (const [left, right] of [["", root], [root, ""], ["  ", root], [null, undefined]]) {
    assert.equal(pathInsideOrEqual(left, right), false);
    assert.equal(relativePathInside(left, right), null);
  }
});
