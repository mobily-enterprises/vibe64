import assert from "node:assert/strict";
import test from "node:test";
import { createPageDesignGuide, pageStylesheet } from "../../packages/vibe64-pages/src/server/pageStylesheet.js";

const STATUSES = ["done", "running", "waiting", "attention", "error", "later", "neutral"];

function tokens(css) {
  return new Map([...css.matchAll(/(--v64-[a-z-]+):\s*([^;]+);/gu)].map(([, name, value]) => [name, value]));
}

test("the page design guide shows only classes and colour tokens the stylesheet has", async () => {
  const guide = await createPageDesignGuide()();
  const css = pageStylesheet("");
  const classes = new Set([...guide.matchAll(/class="([^"]+)"/gu)].flatMap(([, list]) => list.split(/\s+/u)));
  assert.ok(classes.size >= 15, "the guide shows the components");
  for (const name of classes) {
    assert.match(css, new RegExp(`\\.${name}(?![\\w-])`, "u"), `${name} is in page.css`);
  }
  const defined = tokens(css);
  for (const [, name] of guide.matchAll(/(--v64-[a-z-]+)(?![a-z<-])/gu)) {
    assert.ok(defined.has(name), `${name} is defined`);
  }
  assert.ok(guide.split("\n").length < 170, "the guide stays short enough to read in full before every page");
});

test("page.css gives every status a colour and a tint in light and dark, and every status component a rule", () => {
  const light = tokens(pageStylesheet("light"));
  const dark = tokens(pageStylesheet("dark"));
  assert.deepEqual([...dark.keys()].sort(), [...light.keys()].sort(), "dark defines every light token");
  for (const status of STATUSES) {
    for (const name of [`--v64-${status}`, `--v64-${status}-tint`]) {
      assert.ok(light.has(name) && dark.has(name), `${name} in both themes`);
      assert.notEqual(light.get(name), dark.get(name), `${name} differs in dark`);
    }
    const css = pageStylesheet("light");
    for (const selector of [`.v64-pill--${status}`, `.v64-tile--${status}`, `.v64-callout--${status}`, `.v64-progress--${status} > i`]) {
      assert.ok(css.includes(selector), `${selector} has a rule`);
    }
  }
  const deviceSetting = pageStylesheet("");
  assert.match(deviceSetting, /@media \(prefers-color-scheme: dark\)/u, "without a theme the device setting decides");
  assert.match(deviceSetting, /max-width: 880px;[\s\S]*padding: 28px max\(16px/u, "one readable column with a 16px phone gutter");
});
