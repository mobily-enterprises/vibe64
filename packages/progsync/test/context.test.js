import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  importProgram,
  statusFile,
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

const SENDER_PROGRAM = `# Alert sender

Sends one alert through the configured notification transport.

## Uses

- Nothing outside this file.

## Provides

### \`sendAlert()\`

The asynchronous function takes \`alert\`, an \`Alert\`, and returns a \`Notification\`.
`;

const DISPATCH_PROGRAM = `# Alert dispatch

Dispatches one alert through the sender.

## Uses

- [\`deliver()\`](@/src/sendAlert.js.md#sendalert)

## Provides

### \`dispatch()\`

The asynchronous function takes \`alert\`, an \`Alert\`, and returns the
\`Notification\` returned by \`deliver()\`.

It calls \`deliver()\` with \`alert\` so that transport remains owned by the
sender module.
`;

const SENDER_IMPLEMENTATION = `export async function sendAlert(alert) {
  return alert;
}
`;

const DISPATCH_IMPLEMENTATION = `import { sendAlert as deliver } from "./sendAlert.js";

export async function dispatch(alert) {
  return deliver(alert);
}
`;

test("supplies an imported provider interface when creating Program", async (t) => {
  const root = await createGitProject(t, {
    "program/src/sendAlert.js.md": SENDER_PROGRAM,
    "src/dispatch.js": DISPATCH_IMPLEMENTATION,
    "src/sendAlert.js": SENDER_IMPLEMENTATION
  });
  const runner = async ({ mode, workspaceRoot }) => {
    const context = await readContext(workspaceRoot);
    assert.equal(
      context.resolvedReferences.some((reference) => (
        reference.provider === "@/src/sendAlert.js.md#sendalert" &&
        reference.description.includes("Notification")
      )),
      true
    );
    await writeWorkspace(workspaceRoot, context.target.programPath, DISPATCH_PROGRAM);
    return synchronizationReport(mode);
  };

  const result = await importProgram({
    inputPath: "src/dispatch.js",
    projectRoot: root,
    runner,
    write: false
  });
  assert.equal(result.status, "updated");
});

test("preserves the callable surface of a renamed forwarding export", async (t) => {
  const root = await createGitProject(t, {
    "program/src/sendAlert.js.md": SENDER_PROGRAM,
    "src/forward.js": "export { sendAlert as dispatch } from \"./sendAlert.js\";\n",
    "src/sendAlert.js": SENDER_IMPLEMENTATION
  });
  const forwardedProgram = DISPATCH_PROGRAM
    .replaceAll("deliver", "dispatch")
    .replace("It calls `dispatch()` with `alert` so that transport remains owned by the\nsender module.\n", "It forwards the operation to the exact linked sender export.\n");
  const result = await importProgram({
    inputPath: "src/forward.js",
    projectRoot: root,
    runner: async ({ mode, workspaceRoot }) => {
      const context = await readContext(workspaceRoot);
      await writeWorkspace(workspaceRoot, context.target.programPath, forwardedProgram);
      return synchronizationReport(mode);
    },
    write: false
  });
  assert.equal(result.status, "updated");
});

test("blocks before AI when an imported provider cannot be closed atomically", async (t) => {
  const root = await createGitProject(t, {
    "src/dispatch.js": `import { missing } from "./missing.js";
export function dispatch(value) { return missing(value); }
`
  });
  let runnerCalled = false;
  await assert.rejects(
    importProgram({
      inputPath: "src/dispatch.js",
      projectRoot: root,
      runner: async () => {
        runnerCalled = true;
      },
      write: false
    }),
    (error) => error.code === "UNRESOLVED_CONTEXT"
  );
  assert.equal(runnerCalled, false);
});

test("includes referenced retained JSON as bounded read-only context", async (t) => {
  const root = await createGitProject(t, {
    "config.json": "{\"name\":\"fixture\"}\n",
    "src/configName.js": `import config from "../config.json" with { type: "json" };
export function configName() { return config.name; }
`
  });
  const program = `# Configuration name

Returns the retained configuration name.

## Uses

- [\`config\`](asset:config.json)

## Provides

### \`configName()\`

The function returns the \`name\` text from \`config\`.
`;
  const result = await importProgram({
    inputPath: "src/configName.js",
    projectRoot: root,
    runner: async ({ mode, workspaceRoot }) => {
      const context = await readContext(workspaceRoot);
      const retained = context.resolvedReferences.find((reference) => (
        reference.provider === "asset:config.json"
      ));
      assert.equal(retained.content, "{\"name\":\"fixture\"}\n");
      await writeWorkspace(workspaceRoot, context.target.programPath, program);
      return synchronizationReport(mode);
    },
    write: false
  });
  assert.equal(result.status, "updated");
});

test("rejects a Program candidate that omits a used outside operation", async (t) => {
  const root = await createGitProject(t, {
    "program/src/sendAlert.js.md": SENDER_PROGRAM,
    "src/dispatch.js": DISPATCH_IMPLEMENTATION,
    "src/sendAlert.js": SENDER_IMPLEMENTATION
  });
  const invalid = DISPATCH_PROGRAM.replace(
    "- [`deliver()`](@/src/sendAlert.js.md#sendalert)",
    "- Nothing outside this file."
  );
  let attempts = 0;
  await assert.rejects(
    importProgram({
      inputPath: "src/dispatch.js",
      projectRoot: root,
      runner: async ({ mode, workspaceRoot }) => {
        attempts += 1;
        const context = await readContext(workspaceRoot);
        await writeWorkspace(workspaceRoot, context.target.programPath, invalid);
        return synchronizationReport(mode);
      },
      write: true
    }),
    (error) => error.code === "PAIR_SURFACE_MISMATCH"
  );
  assert.equal(attempts, 2);
  await assert.rejects(fs.stat(path.join(root, "program/src/dispatch.js.md")), /ENOENT/u);
});

test("invalidates an accepted consumer when a referenced interface changes", async (t) => {
  const root = await createGitProject(t, {
    "program/src/dispatch.js.md": DISPATCH_PROGRAM,
    "program/src/sendAlert.js.md": SENDER_PROGRAM,
    "src/dispatch.js": DISPATCH_IMPLEMENTATION,
    "src/sendAlert.js": SENDER_IMPLEMENTATION
  });
  await syncFile({
    inputPath: "src/dispatch.js",
    projectRoot: root,
    runner: async () => {
      throw new Error("Git-matching pair must not invoke AI");
    }
  });
  await writeFiles(root, {
    "program/src/sendAlert.js.md": SENDER_PROGRAM.replace(
      "takes `alert`, an `Alert`",
      "takes `alert`, a validated `Alert`"
    )
  });

  const result = await statusFile({
    inputPath: "src/dispatch.js",
    projectRoot: root
  });
  assert.equal(result.mode, "PROGRAM_TO_IMPLEMENTATION");
  assert.equal(
    result.discovery.some((record) => record.code === "CONTEXT_CHANGED"),
    true
  );
});

test("sync --changed schedules consumers of changed shared definitions", async (t) => {
  const types = `# Types

## Uses

- Nothing outside this file.

## Provides

### \`Greeting\`

A structured greeting containing display text.
`;
  const program = `# Greeting

Builds a greeting value.

## Uses

- [\`Greeting\`](@/types.md#greeting)

## Provides

### \`greet()\`

The function returns a \`Greeting\`.
`;
  const root = await createGitProject(t, {
    "program/src/greet.js.md": program,
    "program/types.md": types,
    "src/greet.js": "export function greet() { return { text: \"hello\" }; }\n"
  });
  await writeFiles(root, {
    "program/types.md": types.replace("display text", "display text and locale")
  });
  let runnerCalls = 0;
  const result = await syncChanged({
    projectRoot: root,
    runner: async ({ mode }) => {
      runnerCalls += 1;
      assert.equal(mode, "PROGRAM_TO_IMPLEMENTATION");
      return synchronizationReport(
        mode,
        "unchanged",
        "The expanded type description requires no implementation change."
      );
    }
  });
  assert.equal(runnerCalls, 1);
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].discovery.some((entry) => entry.code === "CONTEXT_CHANGED"), true);

  const repeated = await syncChanged({
    projectRoot: root,
    runner: async () => {
      throw new Error("accepted dependency context must not invoke AI again");
    }
  });
  assert.equal(repeated.results.length, 1);
  assert.equal(repeated.results[0].mode, "NO_CHANGE");
});
