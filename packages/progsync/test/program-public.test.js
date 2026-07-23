import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  buildProgramProjection,
  checkProgram,
  parseProgram,
  readProgramAuthorPrompt,
  synchronizeFile
} from "../src/index.js";
import {
  GREETING_PROGRAM,
  createGitProject,
  report,
  writeWorkspace,
  writeFiles
} from "./oracle-helpers.js";

test("exports only the seven public library operations", async () => {
  const library = await import("../src/index.js");
  assert.deepEqual(Object.keys(library).sort(), [
    "buildProgramProjection",
    "checkProgram",
    "parseProgram",
    "readProgramAuthorPrompt",
    "statusFile",
    "syncChanged",
    "synchronizeFile"
  ]);
});

test("parses the three-part public function format", () => {
  const parsed = parseProgram(GREETING_PROGRAM, {
    programPath: "program/src/greet.js.md"
  });
  assert.equal(parsed.valid, true);
  assert.equal(parsed.title, "Greeting");
  assert.deepEqual(parsed.provides[0].parameters, [{
    description: "`name`: the recipient name as text",
    fields: [],
    name: "name"
  }]);
  assert.match(parsed.provides[0].behavior, /Hello/u);
  assert.match(parsed.provides[0].returns, /greeting/u);
});

test("parses positional and object arguments without flattening them", () => {
  const source = GREETING_PROGRAM.replace(
    "* `name`: the recipient name as text",
    "* `prefix`: text placed first\n* an object containing:\n  * `name`: recipient text\n  * `punctuation`: optional text defaulting to `!`"
  );
  const parsed = parseProgram(source, { programPath: "program/src/greet.js.md" });
  assert.equal(parsed.valid, true);
  assert.deepEqual(parsed.provides[0].parameters.map((parameter) => ({
    fields: parameter.fields.map((field) => field.name),
    name: parameter.name
  })), [
    { fields: [], name: "prefix" },
    { fields: ["name", "punctuation"], name: null }
  ]);
});

test("reports malformed operation sections instead of guessing", () => {
  const parsed = parseProgram(
    GREETING_PROGRAM.replace("#### Returns", "#### Result"),
    { programPath: "program/src/greet.js.md" }
  );
  assert.equal(parsed.valid, false);
  assert.equal(parsed.diagnostics.some((entry) => (
    entry.code === "INVALID_RETURNS_COUNT"
  )), true);
  assert.equal(parsed.diagnostics.some((entry) => (
    entry.code === "UNEXPECTED_OPERATION_SECTION"
  )), true);

  const ambiguousUse = parseProgram(GREETING_PROGRAM.replace(
    "- Nothing outside this file.",
    "- [`format()`](@/src/first.js.md#format)\n- [`format()`](@/src/second.js.md#format)"
  ), { programPath: "program/src/greet.js.md" });
  assert.equal(ambiguousUse.valid, false);
  assert.equal(ambiguousUse.diagnostics.some((entry) => (
    entry.message.includes("format()")
  )), true);

  const duplicateUse = parseProgram(GREETING_PROGRAM.replace(
    "- Nothing outside this file.",
    "- [`format()`](@/src/format.js.md#format)\n- [`format()`](@/src/format.js.md#format)"
  ), { programPath: "program/src/greet.js.md" });
  assert.equal(duplicateUse.valid, false);
});

test("keeps types implicit and excludes Markdown links and code examples", () => {
  const source = GREETING_PROGRAM.replace(
    "The resulting greeting as text.",
    "A [Greeting result]; `[Not a type]`, ``[Still not a type]` inside one tick``, ```[Also not a type]```, `````[Not a type at any delimiter length]`````, and [`link`](@/other.md#link) are examples."
  );
  const parsed = parseProgram(source, { programPath: "program/src/greet.js.md" });
  assert.deepEqual(parsed.typeReferences.map((entry) => entry.name), ["Greeting result"]);
});

function counterProgram() {
  return `# Counters

Creates and advances named counters.

## Uses

- Nothing outside this file.

## Provides

- The exported class [\`Counter\`](#class-counter).

## Class \`Counter\`

Tracks one numeric value.

### \`constructor()\`

#### Parameters

* \`initialValue\`: the starting number

#### What it does

It creates a counter whose value is \`initialValue\`.

#### Returns

The new \`Counter\`.

### \`increment()\`

#### Parameters

No parameters.

#### What it does

It increases the counter's value by one.

#### Returns

The resulting number.

### \`static fromText()\`

#### Parameters

* \`source\`: text containing one number

#### What it does

It creates a counter from the number in \`source\`.

#### Returns

The new \`Counter\`.
`;
}

test("parses canonical class constructors and instance and static methods", () => {
  const source = counterProgram();
  const parsed = parseProgram(source, {
    programPath: "program/src/counter.js.md"
  });
  assert.equal(parsed.valid, true, JSON.stringify(parsed.diagnostics));
  assert.deepEqual(parsed.provides.map((provided) => ({
    kind: provided.kind,
    memberKind: provided.memberKind || null,
    name: provided.name,
    owner: provided.owner || null
  })), [
    { kind: "class", memberKind: null, name: "Counter", owner: null },
    { kind: "method", memberKind: "constructor", name: "constructor()", owner: "Counter" },
    { kind: "method", memberKind: "instance", name: "increment()", owner: "Counter" },
    { kind: "method", memberKind: "static", name: "fromText()", owner: "Counter" }
  ]);

  const projection = buildProgramProjection({
    programPath: "program/src/counter.js.md",
    programSource: source
  });
  assert.equal(new Set(projection.provides.map((provided) => provided.id)).size, 4);
  assert.equal(projection.provides.every((provided) => (
    provided.id.startsWith("@/src/counter.js.md#")
  )), true);
  assert.equal(projection.provides[3].memberKind, "static");

  const missingConstructor = parseProgram(
    source.replace(/### `constructor\(\)`[\s\S]*?(?=### `increment\(\)`)/u, ""),
    { programPath: "program/src/counter.js.md" }
  );
  assert.equal(missingConstructor.valid, false);

  const staticConstructor = parseProgram(
    source.replace("### `constructor()`", "### `static constructor()`"),
    { programPath: "program/src/counter.js.md" }
  );
  assert.equal(staticConstructor.valid, false);
});

test("rejects a candidate that changes a static class method into an instance method", async (t) => {
  const root = await createGitProject(t, {
    "program/src/counter.js.md": counterProgram()
  }, { exports: "./src/counter.js" });
  let attempts = 0;
  await synchronizeFile({
    inputPath: "program/src/counter.js.md",
    projectRoot: root,
    runner: async ({ mode, prompt, workspaceRoot }) => {
      attempts += 1;
      if (attempts === 2) {
        assert.match(prompt, /PAIR_SURFACE_MISMATCH/u);
        assert.match(prompt, /fromText\(\)/u);
        assert.match(prompt, /static/u);
      }
      await writeWorkspace(workspaceRoot, "src/counter.js", `export class Counter {
  constructor(initialValue) { this.value = initialValue; }
  increment() { this.value += 1; return this.value; }
  ${attempts === 1 ? "" : "static "}fromText(source) { return new Counter(Number(source)); }
}
`);
      return report(mode);
    }
  });
  assert.equal(attempts >= 2 && attempts <= 3, true);
});

test("ignores headings and type syntax inside an info-string code fence", () => {
  const source = GREETING_PROGRAM.replace(
    "It places `Hello, ` before `name` and `!` after it.",
    "It preserves the requested greeting form.\n\n````markdown\n```\n#### Returns\nA [Not a project type].\n````\n\n~~~~text\n~~~\n#### Parameters\nAn [Also hidden type].\n~~~~"
  );
  const parsed = parseProgram(source, { programPath: "program/src/greet.js.md" });
  assert.equal(parsed.valid, true);
  assert.deepEqual(parsed.typeReferences, []);
  assert.equal(parsed.provides[0].returns, "The resulting greeting as text.");

  const carriageReturns = parseProgram(GREETING_PROGRAM.replaceAll("\n", "\r"), {
    programPath: "program/src/greet.js.md"
  });
  assert.equal(carriageReturns.valid, true);
  assert.equal(carriageReturns.source, GREETING_PROGRAM);
});

test("builds a deterministic schema-version-2 City projection", () => {
  const first = buildProgramProjection({
    programPath: "program/src/greet.js.md",
    programSource: GREETING_PROGRAM
  });
  const second = buildProgramProjection({
    programPath: "program/src/greet.js.md",
    programSource: GREETING_PROGRAM
  });
  assert.deepEqual(first, second);
  assert.equal(first.schemaVersion, 2);
  assert.equal(first.targetFile, "src/greet.js");
  assert.equal(first.auxiliaryRoot, "src/greet/");
  assert.equal(first.provides[0].id, "@/src/greet.js.md#greet");
  assert.equal(first.provides[0].parameters[0].name, "name");
});

test("classifies root Program libraries as generation dependencies", () => {
  const source = GREETING_PROGRAM.replace(
    "- Nothing outside this file.",
    "- [`Primary action`](@/interface.md#primary-action)"
  );
  const projection = buildProgramProjection({
    programPath: "program/src/greet.js.md",
    programSource: source
  });
  assert.equal(projection.uses[0].kind, "generation");
});

test("classifies targeted values and omits inapplicable projection fields", () => {
  const descriptor = buildProgramProjection({
    programPath: "program/package.descriptor.mjs.md",
    programSource: `# Descriptor

## Uses

- Nothing outside this file.

## Provides

### \`default\`

The exported descriptor value.
`
  });
  assert.equal(descriptor.provides[0].kind, "value");
  assert.equal(Object.hasOwn(descriptor.provides[0], "owner"), false);

  const command = buildProgramProjection({
    programPath: "program/bin/example.js.md",
    programSource: `# Example command

## Uses

- [\`run()\`](@/src/run.js.md#run)

## Provides

### \`example\`

#### Parameters

No parameters.

#### What it does

It calls \`run()\` without arguments.

#### Returns

No direct value.
`
  });
  assert.equal(command.provides[0].kind, "command");
  assert.equal(Object.hasOwn(command.provides[0], "owner"), false);
  assert.equal(Object.hasOwn(command.uses[0], "description"), false);
});

test("the packaged author prompt states the golden rule and canonical format", async () => {
  const prompt = await readProgramAuthorPrompt();
  assert.match(prompt, /at least two distinct production Program\s+modules/u);
  assert.match(prompt, /Tests never count as consumers/u);
  assert.match(prompt, /#### Parameters/u);
  assert.match(prompt, /#### What it does/u);
  assert.match(prompt, /#### Returns/u);
  assert.match(prompt, /Never name a private helper/u);
  assert.match(prompt, /- The exported class \[`Name`\]\(#class-name\)\./u);
  assert.match(prompt, /### `constructor\(\)`/u);
  assert.match(prompt, /### `static create\(\)`/u);
});

test("the public prompt reader observes packaged prompt updates in one process", async (t) => {
  const packageRoot = fileURLToPath(new URL("../", import.meta.url));
  const copyRoot = await fs.mkdtemp(path.join(packageRoot, ".prompt-freshness-"));
  t.after(() => fs.rm(copyRoot, { force: true, recursive: true }));
  await Promise.all([
    fs.cp(path.join(packageRoot, "src"), path.join(copyRoot, "src"), { recursive: true }),
    fs.cp(path.join(packageRoot, "prompts"), path.join(copyRoot, "prompts"), { recursive: true }),
    fs.copyFile(path.join(packageRoot, "package.json"), path.join(copyRoot, "package.json"))
  ]);
  const copiedLibrary = await import(pathToFileURL(path.join(copyRoot, "src/index.js")).href);
  const marker = "Prompt freshness marker.";
  assert.doesNotMatch(await copiedLibrary.readProgramAuthorPrompt(), new RegExp(marker, "u"));
  await fs.appendFile(path.join(copyRoot, "prompts/program-author.txt"), `\n${marker}\n`, "utf8");
  assert.match(await copiedLibrary.readProgramAuthorPrompt(), new RegExp(marker, "u"));
});

test("check writes projections and separates external and one-consumer symbols", async (t) => {
  const provider = GREETING_PROGRAM.replaceAll("greet", "formatGreeting");
  const consumer = `# Consumer\n\n## Uses\n\n- [\`formatGreeting()\`](@/src/provider.js.md#formatgreeting)\n\n## Provides\n\n### \`consume()\`\n\n#### Parameters\n\n* \`name\`: text\n\n#### What it does\n\nIt calls \`formatGreeting()\` with \`name\` and returns that result.\n\n#### Returns\n\nThe formatted text.\n`;
  const root = await createGitProject(t, {
    "program/src/provider.js.md": provider,
    "program/src/public.js.md": GREETING_PROGRAM,
    "program/src/consumer.js.md": consumer,
    "program/types.md": "# Types\n\n## Uses\n\n- Nothing outside this file.\n\n## Provides\n\n### `Unused shape`\n\nAn object with `value`.\n"
  }, {
    exports: { ".": "./src/public.js", "./consumer": "./src/consumer.js" }
  });

  const result = await checkProgram({ projectRoot: root });
  const providerCheck = result.files.find((file) => file.programPath.endsWith("provider.js.md"));
  const publicCheck = result.files.find((file) => file.programPath.endsWith("public.js.md"));
  assert.equal(result.status, "invalid");
  assert.equal(providerCheck.diagnostics.some((entry) => (
    entry.code === "PROGRAM_SYMBOL_HAS_TOO_FEW_PRODUCTION_CONSUMERS"
  )), true);
  assert.equal(publicCheck.provides[0].externallyInvoked, true);
  assert.deepEqual(providerCheck.provides[0].productionConsumers, [
    "program/src/consumer.js.md"
  ]);
  assert.equal(
    JSON.parse(await fs.readFile(
      path.join(root, ".program/index/src/public.js.md.json"),
      "utf8"
    )).schemaVersion,
    2
  );

  await writeFiles(root, {
    "program/src/public.js.md": GREETING_PROGRAM.replace(
      "The resulting greeting as text.",
      "A [Missing public type]."
    )
  });
  const missingType = await checkProgram({ projectRoot: root });
  assert.equal(missingType.files.some((file) => file.diagnostics.some((entry) => (
    entry.code === "UNRESOLVED_PROGRAM_TYPE"
  ))), true);
});

test("check rejects Program tests and callables used only by tests", async (t) => {
  const helper = GREETING_PROGRAM.replaceAll("greet", "testHelper");
  const testConsumer = `# Test consumer

## Uses

- [\`testHelper()\`](@/src/helper.js.md#testhelper)

## Provides

### \`testCase()\`

#### Parameters

No parameters.

#### What it does

It calls \`testHelper()\` with \`test\`.

#### Returns

No value.
`;
  const root = await createGitProject(t, {
    "program/src/helper.js.md": helper,
    "program/test/helper.test.js.md": testConsumer
  });

  const result = await checkProgram({ projectRoot: root });
  const helperCheck = result.files.find((file) => file.programPath.endsWith("helper.js.md"));
  const testCheck = result.files.find((file) => file.programPath.includes("/test/"));
  assert.equal(result.status, "invalid");
  assert.equal(helperCheck.diagnostics.some((entry) => (
    entry.code === "TEST_ONLY_PROGRAM_SYMBOL"
  )), true);
  assert.equal(testCheck.diagnostics.some((entry) => (
    entry.code === "PROGRAM_TEST_MODULE_FORBIDDEN"
  )), true);
});
