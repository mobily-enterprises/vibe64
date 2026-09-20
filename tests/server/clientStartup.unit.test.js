import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

test("the initial document contains an accessible loading shell without JavaScript", async () => {
  const html = await readFile(new URL("../../index.html", import.meta.url), "utf8");
  assert.match(html, /<div id="app">\s*<div id="startup-shell">/u);
  assert.match(html, /id="startup-status" role="status" aria-live="polite">Loading Vibe64…/u);
  assert.match(html, /<a href="">Reload page<\/a>/u);
  assert.match(html, /<noscript>JavaScript must be enabled/u);
  assert.match(html, /<style>[\s\S]*#startup-shell[\s\S]*<\/style>/u);
  assert.ok(html.indexOf('id="startup-shell"') < html.indexOf('src="/src/main.js"'));
});

test("bootstrap failure replaces the loading message without exposing the exception", async () => {
  const source = await readFile(new URL("../../src/main.js", import.meta.url), "utf8");
  const handler = source.match(/\}\)\.catch\(\(error\) => \{([\s\S]*)\}\);\s*$/u);
  assert.ok(handler, "bootstrap must retain its failure handler");
  const status = { textContent: "Loading Vibe64…" };
  const context = {
    error: new Error("private diagnostic"),
    console: { error() {} },
    document: { getElementById: (id) => id === "startup-status" ? status : null }
  };
  vm.runInNewContext(handler[1], context);
  assert.equal(status.textContent, "Vibe64 could not open. Reload the page to try again.");
  context.document.getElementById = () => null;
  assert.doesNotThrow(() => vm.runInNewContext(handler[1], { ...context }));
});
