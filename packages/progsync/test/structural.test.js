import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { validateImplementationCandidate } from "../src/candidate.js";
import { extractSourceFacts } from "../src/structural.js";

test("extracts actual JavaScript exports without matching comments", async () => {
  const facts = await extractSourceFacts({
    implementationPath: "src/module.js",
    projectRoot: process.cwd(),
    source: `// export function imaginary() {}
export default async function ({ alerts, jobs }) { return { alerts, jobs }; }
export { send as deliver } from "./sender.js";
export * from "./shared.js";
`,
    targetKind: "javascript"
  });

  assert.deepEqual(
    facts.exports.map(({ kind, name, parameters }) => ({ kind, name, parameters })),
    [
      { kind: "function", name: "default", parameters: ["alerts", "jobs"] },
      { kind: "forward", name: "deliver", parameters: [] },
      { kind: "forward", name: "*", parameters: [] }
    ]
  );
  assert.equal(facts.exports.some((entry) => entry.name === "imaginary"), false);
});

test("extracts CommonJS callable exports structurally", async () => {
  const facts = await extractSourceFacts({
    implementationPath: "src/module.js",
    projectRoot: process.cwd(),
    source: `const run = (request) => request;
module.exports = { run };
exports.stop = async function stop(reason) { return reason; };
`,
    targetKind: "javascript"
  });

  assert.deepEqual(
    facts.exports.map(({ kind, name, parameters }) => ({ kind, name, parameters })),
    [
      { kind: "function", name: "run", parameters: ["request"] },
      { kind: "function", name: "stop", parameters: ["reason"] }
    ]
  );
});

test("extracts nested CommonJS imports and reports ambiguous shadowing", async () => {
  const nestedRequire = await extractSourceFacts({
    implementationPath: "src/module.js",
    projectRoot: process.cwd(),
    source: `export function dispatch(value) {
  const { send } = require("./sender.js");
  return send(value);
}
`,
    targetKind: "javascript"
  });
  assert.equal(nestedRequire.imports[0].specifier, "./sender.js");
  assert.equal(nestedRequire.imports[0].names[0].called, true);
  assert.deepEqual(nestedRequire.diagnostics, []);

  const shadowedImport = await extractSourceFacts({
    implementationPath: "src/module.js",
    projectRoot: process.cwd(),
    source: `import { send } from "./sender.js";
export function dispatch(send) { return send(); }
`,
    targetKind: "javascript"
  });
  assert.equal(
    shadowedImport.diagnostics.some(({ code }) => code === "AMBIGUOUS_IMPORT_BINDING"),
    true
  );

  const indirectRequire = await extractSourceFacts({
    implementationPath: "src/module.js",
    projectRoot: process.cwd(),
    source: `export function dispatch(value) {
  return require("./sender.js").send(value);
}
`,
    targetKind: "javascript"
  });
  assert.equal(
    indirectRequire.diagnostics.some(({ code }) => code === "AMBIGUOUS_REQUIRE_USE"),
    true
  );
});

test("supports TypeScript script-setup attributes, macros, templates, and JSON blocks", async () => {
  const facts = await extractSourceFacts({
    implementationPath: "src/ProfileEditor.vue",
    projectRoot: process.cwd(),
    source: `<template><SaveButton @click="save()" /></template>
<script lang="ts" setup>
interface Props { profile: string }
defineProps<Props>()
defineEmits<{ saved: [profile: string] }>()
defineSlots<{ actions(): unknown }>()
import SaveButton from "./SaveButton.vue"
import { save } from "./profiles.js"
defineExpose({ save })
</script>
<route lang="json">{"name":"profile"}</route>
`,
    targetKind: "vue"
  });

  assert.deepEqual(facts.props, ["profile"]);
  assert.deepEqual(facts.emits, ["saved"]);
  assert.deepEqual(facts.slots, ["actions"]);
  assert.deepEqual(facts.exposes, ["save"]);
  assert.deepEqual(facts.templateComponents, ["SaveButton"]);
  assert.equal(facts.imports[0].names[0].used, true);
});

test("extracts runtime-array Vue props and rejects unresolved macro types", async () => {
  const runtime = await extractSourceFacts({
    implementationPath: "src/RuntimeProps.vue",
    projectRoot: process.cwd(),
    source: `<script setup>defineProps(["title", "count"])</script>\n`,
    targetKind: "vue"
  });
  assert.deepEqual(runtime.props, ["title", "count"]);

  const imported = await extractSourceFacts({
    implementationPath: "src/ImportedProps.vue",
    projectRoot: process.cwd(),
    source: `<script setup lang="ts">
import type { ImportedProps } from "./types"
defineProps<ImportedProps>()
</script>
`,
    targetKind: "vue"
  });
  assert.equal(
    imported.diagnostics.some(({ code }) => code === "UNRESOLVED_VUE_MACRO_TYPE"),
    true
  );

  const dynamicRuntime = await extractSourceFacts({
    implementationPath: "src/DynamicProps.vue",
    projectRoot: process.cwd(),
    source: `<script setup>const names = ["title"]; defineProps(names)</script>\n`,
    targetKind: "vue"
  });
  assert.equal(
    dynamicRuntime.diagnostics.some(({ code }) => code === "UNRESOLVED_VUE_MACRO_RUNTIME"),
    true
  );
});

test("extracts HTML resources and dependencies from inline scripts", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "progsync-html-facts-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "public"), { recursive: true });
  await fs.writeFile(path.join(root, "public/boot.js"), "export function boot() {}\n", "utf8");
  const facts = await extractSourceFacts({
    implementationPath: "public/index.html",
    projectRoot: root,
    source: `<!doctype html>
<html>
  <head><link rel="stylesheet" href="./screen.css"></head>
  <body>
    <script src="/runtime.js"></script>
    <script type="module">import { boot } from "./boot.js"; boot();</script>
  </body>
</html>
`,
    targetKind: "html"
  });
  assert.deepEqual(facts.htmlResources, [
    { provider: "asset:runtime.js", symbol: "/runtime.js" },
    { provider: "asset:public/screen.css", symbol: "./screen.css" }
  ]);
  assert.equal(facts.imports[0].specifier, "./boot.js");
  assert.equal(facts.imports[0].names[0].called, true);
});

test("validates nested candidate imports against the project root", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "progsync-candidate-root-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "src/deep"), { recursive: true });
  await fs.mkdir(path.join(root, "lib"), { recursive: true });
  await fs.writeFile(path.join(root, "lib/value.js"), "export const value = 1;\n", "utf8");
  const candidatePath = path.join(root, "src/deep/module.js");
  await fs.writeFile(
    candidatePath,
    `import { value } from "../../lib/value.js";\nexport { value };\n`,
    "utf8"
  );

  await validateImplementationCandidate({
    absolutePath: candidatePath,
    implementationPath: "src/deep/module.js",
    projectRoot: root,
    targetKind: "javascript"
  });
});

test("rejects unsupported or malformed Vue and HTML candidates", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "progsync-structural-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const ordinaryVue = path.join(root, "Ordinary.vue");
  const malformedVue = path.join(root, "Malformed.vue");
  const malformedHtml = path.join(root, "malformed.html");
  const invalidInlineScript = path.join(root, "script.html");
  await fs.writeFile(ordinaryVue, "<script>export default {}</script>\n", "utf8");
  await fs.writeFile(malformedVue, "<template><div></template>\n", "utf8");
  await fs.writeFile(malformedHtml, "<div><span></div>\n", "utf8");
  await fs.writeFile(
    invalidInlineScript,
    "<!doctype html><html><script>const value = ;</script></html>\n",
    "utf8"
  );

  await assert.rejects(
    validateImplementationCandidate({ absolutePath: ordinaryVue, targetKind: "vue" }),
    (error) => error.code === "UNSUPPORTED_VUE_SCRIPT"
  );
  await assert.rejects(
    validateImplementationCandidate({ absolutePath: malformedVue, targetKind: "vue" }),
    (error) => error.code === "INVALID_IMPLEMENTATION"
  );
  await assert.rejects(
    validateImplementationCandidate({ absolutePath: malformedHtml, targetKind: "html" }),
    (error) => error.code === "INVALID_IMPLEMENTATION"
  );
  await assert.rejects(
    validateImplementationCandidate({
      absolutePath: invalidInlineScript,
      targetKind: "html"
    }),
    (error) => error.code === "INVALID_IMPLEMENTATION"
  );
});
