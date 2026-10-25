import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import {
  REPOSITORY_CANONICAL_RECHECK_REASONS,
  REPOSITORY_STATUS_SESSION_REASONS
} from "../../src/lib/vibe64RepositoryRealtime.js";

// The client refreshes repository status only for reasons it names, so a name
// no server publishes silently disables that refresh.
test("every repository status refresh reason is one a server publishes", async () => {
  const packagesRoot = new URL("../../packages/", import.meta.url);
  const entries = await readdir(packagesRoot, { recursive: true });
  const serverSources = await Promise.all(entries
    .filter((entry) => /^[^/]+\/src\/server\/.+\.js$/u.test(entry))
    .map((entry) => readFile(new URL(entry, packagesRoot), "utf8")));
  const published = serverSources.join("\n");
  for (const reason of [...REPOSITORY_STATUS_SESSION_REASONS, ...REPOSITORY_CANONICAL_RECHECK_REASONS]) {
    assert.ok(published.includes(`"${reason}"`), `${reason} is not published by any server`);
  }
  for (const reason of REPOSITORY_CANONICAL_RECHECK_REASONS) {
    assert.ok(REPOSITORY_STATUS_SESSION_REASONS.has(reason), `${reason} rechecks without refreshing`);
  }
});
