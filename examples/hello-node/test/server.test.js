import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../server.js";

test("the example serves its page, health endpoint, and missing-route status", async () => {
  const app = createApp();
  await new Promise((resolve) => app.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${app.address().port}`;
  try {
    const page = await fetch(origin);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Hello, Node\./u);
    assert.deepEqual(await (await fetch(`${origin}/api/health`)).json(), { ok: true });
    assert.equal((await fetch(`${origin}/missing`)).status, 404);
    assert.equal((await fetch(origin, { method: "POST" })).status, 405);
  } finally {
    await new Promise((resolve) => app.close(resolve));
  }
});
