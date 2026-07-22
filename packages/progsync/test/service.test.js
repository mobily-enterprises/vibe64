import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  compileProgram,
  checkProgram,
  importProgram,
  syncChanged,
  syncFile
} from "../src/index.js";
import {
  createGitProject,
  readContext,
  synchronizationReport,
  writeFiles,
  writeWorkspace
} from "./helpers.js";

const PROGRAM = `# Greeting

Returns the configured greeting.

## Uses

- Nothing outside this file.

## Provides

### \`greet()\`

The function returns \`hello\`.
`;

const LINE_TOTAL_PROGRAM = `# Line total calculation

Calculates the monetary parts of one order line.

## Uses

- Nothing outside this file.

## Provides

### \`calculateLineTotal()\`

The function takes \`line\`, a [Line item], and \`taxRate\`, a decimal tax
rate, and returns a [Line total].

It multiplies the line's \`unitPrice\` by its \`quantity\` to obtain the
subtotal, multiplies that subtotal by \`taxRate\` to obtain the tax, and returns
the subtotal, tax, and their sum as the total.
`;

const SHARED_TYPES = `# Project types

## Uses

- Nothing outside this file.

## Provides

### \`Line item\`

A \`Line item\` contains \`unitPrice\`, its numeric price for one unit, and
\`quantity\`, the number of units.

### \`Line total\`

A \`Line total\` contains \`subtotal\`, the price before tax; \`tax\`, the tax
amount; and \`total\`, their sum.
`;

test("imports source into a dry-run Program proposal", async (t) => {
  const root = await createGitProject(t, {
    "src/greet.js": "function greet() { return \"hello\"; }\n\nexport { greet };\n"
  });
  const runner = async ({ mode, workspaceRoot }) => {
    const context = await readContext(workspaceRoot);
    await writeWorkspace(workspaceRoot, context.target.programPath, PROGRAM);
    return synchronizationReport(mode);
  };

  const result = await importProgram({
    inputPath: "src/greet.js",
    projectRoot: root,
    runner,
    write: false
  });
  assert.equal(result.mode, "CREATE_PROGRAM");
  assert.equal(result.status, "updated");
  assert.equal(result.applied, false);
  assert.match(result.diff, /new file mode/u);
  await assert.rejects(fs.stat(path.join(root, "program/src/greet.js.md")), /ENOENT/u);
});

test("applies imported Program and its deterministic projection", async (t) => {
  const root = await createGitProject(t, {
    "src/greet.js": "function greet() { return \"hello\"; }\n\nexport { greet };\n"
  });
  const runner = async ({ mode, workspaceRoot }) => {
    const context = await readContext(workspaceRoot);
    await writeWorkspace(workspaceRoot, context.target.programPath, PROGRAM);
    return synchronizationReport(mode);
  };

  const result = await importProgram({
    inputPath: "src/greet.js",
    projectRoot: root,
    runner,
    write: true
  });
  assert.equal(result.applied, true);
  assert.equal(
    await fs.readFile(path.join(root, "program/src/greet.js.md"), "utf8"),
    PROGRAM
  );
  const projection = JSON.parse(
    await fs.readFile(path.join(root, ".program/index/src/greet.js.md.json"), "utf8")
  );
  assert.equal(projection.targetFile, "src/greet.js");
});

test("creates shared public types while importing an implementation", async (t) => {
  const implementation = `/**
 * @typedef {{ unitPrice: number, quantity: number }} LineItem
 * @typedef {{ subtotal: number, tax: number, total: number }} LineTotal
 */
export function calculateLineTotal(line, taxRate) {
  const subtotal = line.unitPrice * line.quantity;
  const tax = subtotal * taxRate;
  return { subtotal, tax, total: subtotal + tax };
}
`;
  const root = await createGitProject(t, {
    "src/calculateLineTotal.js": implementation
  });
  const runner = async ({ mode, workspaceRoot }) => {
    const context = await readContext(workspaceRoot);
    assert.equal(context.sharedTypes.exists, false);
    assert.equal(context.target.allowedPaths.includes("program/types.md"), true);
    await writeWorkspace(workspaceRoot, context.target.programPath, LINE_TOTAL_PROGRAM);
    await writeWorkspace(workspaceRoot, "program/types.md", SHARED_TYPES);
    return synchronizationReport(mode);
  };

  const result = await importProgram({
    inputPath: "src/calculateLineTotal.js",
    projectRoot: root,
    runner,
    write: true
  });
  assert.equal(result.status, "updated");
  assert.equal(
    await fs.readFile(path.join(root, "program/types.md"), "utf8"),
    SHARED_TYPES
  );
  const projection = JSON.parse(
    await fs.readFile(path.join(root, ".program/index/types.md.json"), "utf8")
  );
  assert.deepEqual(
    projection.provides.map((provided) => provided.name),
    ["Line item", "Line total"]
  );
});

test("rejects Program proposals that obscure exact exported function symbols", async (t) => {
  const root = await createGitProject(t, {
    "src/greet.js": "function greet(name) { return `hello ${name}`; }\n\nexport { greet };\n"
  });
  const invalidProgram = PROGRAM.replace("`greet()`", "`greet`");
  const runner = async ({ mode, workspaceRoot }) => {
    const context = await readContext(workspaceRoot);
    await writeWorkspace(workspaceRoot, context.target.programPath, invalidProgram);
    return synchronizationReport(mode);
  };

  await assert.rejects(
    importProgram({
      inputPath: "src/greet.js",
      projectRoot: root,
      runner,
      write: true
    }),
    (error) => error.code === "PAIR_SURFACE_MISMATCH"
  );
  await assert.rejects(fs.stat(path.join(root, "program/src/greet.js.md")), /ENOENT/u);
});

test("treats exported arrow values as exact callable symbols", async (t) => {
  const root = await createGitProject(t, {
    "src/greet.js": "export const greet = (name) => `hello ${name}`;\n"
  });
  const runner = async ({ mode, workspaceRoot }) => {
    const context = await readContext(workspaceRoot);
    await writeWorkspace(
      workspaceRoot,
      context.target.programPath,
      PROGRAM.replace("returns `hello`", "takes `name` and returns a greeting")
    );
    return synchronizationReport(mode);
  };

  const result = await importProgram({
    inputPath: "src/greet.js",
    projectRoot: root,
    runner,
    write: false
  });
  assert.equal(result.status, "updated");
});

test("retries one deterministically rejected candidate with its diagnostic", async (t) => {
  const root = await createGitProject(t, {
    "src/greet.js": "function greet() { return \"hello\"; }\n\nexport { greet };\n"
  });
  let attempts = 0;
  const runner = async ({ mode, prompt, workspaceRoot }) => {
    attempts += 1;
    const context = await readContext(workspaceRoot);
    await writeWorkspace(
      workspaceRoot,
      context.target.programPath,
      attempts === 1 ? PROGRAM.replace("`greet()`", "`greet`") : PROGRAM
    );
    if (attempts === 2) {
      assert.match(prompt, /PAIR_SURFACE_MISMATCH/u);
    }
    return synchronizationReport(mode);
  };

  const result = await importProgram({
    inputPath: "src/greet.js",
    projectRoot: root,
    runner,
    write: false
  });
  assert.equal(attempts, 2);
  assert.equal(result.status, "updated");
});

test("creates missing implementation from Program", async (t) => {
  const root = await createGitProject(t, {
    "program/src/greet.js.md": PROGRAM
  });
  const runner = async ({ mode, workspaceRoot }) => {
    const context = await readContext(workspaceRoot);
    await writeWorkspace(
      workspaceRoot,
      context.target.implementationPath,
      "function greet() { return \"hello\"; }\n\nexport { greet };\n"
    );
    return synchronizationReport(mode);
  };

  const result = await compileProgram({
    inputPath: "program/src/greet.js.md",
    projectRoot: root,
    runner
  });
  assert.equal(result.mode, "CREATE_IMPLEMENTATION");
  assert.equal(result.applied, true);
  assert.match(await fs.readFile(path.join(root, "src/greet.js"), "utf8"), /export \{ greet \}/u);
});

test("preserves implementation-only realization changes without Program noise", async (t) => {
  const implementation = "function greet() { return \"hello\"; }\n\nexport { greet };\n";
  const root = await createGitProject(t, {
    "program/src/greet.js.md": PROGRAM,
    "src/greet.js": implementation
  });
  await writeFiles(root, {
    "src/greet.js": `// Tuned implementation note.\n${implementation}`
  });
  const runner = async ({ mode }) => synchronizationReport(
    mode,
    "unchanged",
    "Only compatible realization details changed."
  );

  const result = await syncFile({
    inputPath: "src/greet.js",
    projectRoot: root,
    runner
  });
  assert.equal(result.mode, "IMPLEMENTATION_TO_PROGRAM");
  assert.equal(result.status, "unchanged");
  assert.equal(await fs.readFile(path.join(root, "program/src/greet.js.md"), "utf8"), PROGRAM);
});

test("sync --changed uses Git to reconcile each changed supported pair", async (t) => {
  const implementation = "function greet() { return \"hello\"; }\n\nexport { greet };\n";
  const root = await createGitProject(t, {
    "program/src/greet.js.md": PROGRAM,
    "src/greet.js": implementation
  });
  await writeFiles(root, {
    "program/src/greet.js.md": PROGRAM.replace("returns `hello`", "returns `hello world`")
  });
  const runner = async ({ mode, workspaceRoot }) => {
    const context = await readContext(workspaceRoot);
    await writeWorkspace(
      workspaceRoot,
      context.target.implementationPath,
      implementation.replace("hello", "hello world")
    );
    return synchronizationReport(mode);
  };

  const result = await syncChanged({
    projectRoot: root,
    runner
  });
  assert.equal(result.status, "updated");
  assert.equal(result.results.length, 1);
  assert.match(await fs.readFile(path.join(root, "src/greet.js"), "utf8"), /hello world/u);
});

test("check deterministically materializes missing Program projections", async (t) => {
  const root = await createGitProject(t, {
    ".program/index/deleted.js.md.json": "{}\n",
    "program/types.md": `# Types

## Uses

- Nothing outside this file.

## Provides

### \`Greeting\`

A structured greeting with text and a recipient.
`
  });

  const result = await checkProgram({ projectRoot: root });
  assert.equal(result.status, "ok");
  assert.equal(result.files[0].projectionUpdated, true);
  assert.deepEqual(result.removedProjectionPaths, [".program/index/deleted.js.md.json"]);
  await assert.rejects(
    fs.stat(path.join(root, ".program/index/deleted.js.md.json")),
    /ENOENT/u
  );
  const projection = JSON.parse(
    await fs.readFile(path.join(root, ".program/index/types.md.json"), "utf8")
  );
  assert.equal(projection.provides[0].name, "Greeting");
  assert.equal(projection.targetKind, "types");
});
