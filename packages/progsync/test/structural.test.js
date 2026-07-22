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
