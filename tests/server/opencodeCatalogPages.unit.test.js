import assert from "node:assert/strict";
import test from "node:test";
import { readAllOpenCodeCapabilityRows } from "../../packages/vibe64-accounts/src/server/opencodeCatalogPages.js";

const page = (models, nextCursor = "") => ({ ok: true, engines: [{ engineId: "opencode",
  page: { hasMore: Boolean(nextCursor), nextCursor }, modelProviders: [{ id: "opencode", models }] }] });

test("OpenCode catalogue pages are read once each and a repeated cursor stops the read", async () => {
  const queries = [];
  const pages = { "": page([{ id: "a" }], "c1"), c1: page([{ id: "b", status: "unavailable" }], "c2"), c2: page([{ id: "c" }]) };
  const read = await readAllOpenCodeCapabilityRows(async (query) => { queries.push(query); return pages[query.cursor || ""]; },
    { modelProviderId: "opencode" });
  assert.deepEqual(read.rows.map(({ id }) => id), ["a", "b", "c"]);
  assert.equal(read.provider.id, "opencode");
  assert.deepEqual(queries.map(({ cursor }) => cursor), [undefined, "c1", "c2"]);
  await assert.rejects(readAllOpenCodeCapabilityRows(async () => page([], "c1")),
    { code: "vibe64_ai_catalog_cursor_stalled" });
  await assert.rejects(readAllOpenCodeCapabilityRows(async () => ({ engines: [] })), { code: "vibe64_ai_catalog_invalid" });
  await assert.rejects(readAllOpenCodeCapabilityRows(async () => page([]), { modelProviderId: "missing" }),
    { code: "vibe64_ai_provider_unavailable" });
});
