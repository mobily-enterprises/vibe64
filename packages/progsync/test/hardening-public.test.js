import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import {
  checkProgram,
  statusFile,
  syncChanged,
  synchronizeFile
} from "../src/index.js";
import {
  GREETING_PROGRAM,
  createGitProject,
  git,
  readContext,
  report,
  writeFiles,
  writeWorkspace
} from "./oracle-helpers.js";

const GREETING_IMPLEMENTATION =
  "export function greet(name) { return `Hello, ${name}!`; }\n";

const TYPES_PROGRAM = `# Project types

## Uses

- Nothing outside this file.

## Provides

### \`Shared value\`

A structured value containing a \`text\` field.
`;

const TYPE_CONSUMER_PROGRAM = `# Type consumer

Builds a shared value.

## Uses

- Nothing outside this file.

## Provides

### \`typeConsumer()\`

#### Parameters

No parameters.

#### What it does

It creates a [Shared value] whose \`text\` is \`ready\`.

#### Returns

The created [Shared value].
`;

const ASSET_CONSUMER_PROGRAM = `# Asset consumer

Reads retained configuration.

## Uses

- [\`configuration\`](asset:config.json)

## Provides

### \`configuredName()\`

#### Parameters

No parameters.

#### What it does

It reads the \`name\` field from \`configuration\`.

#### Returns

The configured name as text.
`;

const PACKAGE_CONSUMER_PROGRAM = `# Package consumer

Reports a fixed package-compatible value.

## Uses

- Nothing outside this file.

## Provides

### \`packageValue()\`

#### Parameters

No parameters.

#### What it does

It returns the number \`1\`.

#### Returns

The number \`1\`.
`;

function packageManifest(overrides = {}) {
  return `${JSON.stringify({
    name: "progsync-hardening-fixture",
    private: true,
    type: "module",
    exports: {
      "./asset": "./src/asset-consumer.js",
      "./package": "./src/package-consumer.js",
      "./type": "./src/type-consumer.js"
    },
    ...overrides
  }, null, 2)}\n`;
}

async function commitAll(root, message) {
  await git(root, ["add", "--all"]);
  await git(root, [
    "-c", "user.name=ProgSync Oracle",
    "-c", "user.email=oracle@local",
    "commit", "--quiet", "-m", message
  ]);
}

async function hiddenProgSyncFiles(root) {
  const found = [];
  async function visit(directory) {
    let entries = [];
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") {
        return;
      }
      throw error;
    }
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath);
      } else if (/\.progsync-(?:backup-)?/u.test(entry.name)) {
        found.push(path.relative(root, absolutePath));
      }
    }
  }
  await visit(root);
  return found.sort();
}

test("checkpoint selection remains safe across branches and linked worktrees", async (t) => {
  const root = await createGitProject(t, {
    "program/src/greet.js.md": GREETING_PROGRAM,
    "src/greet.js": GREETING_IMPLEMENTATION
  }, { exports: "./src/greet.js" });

  const accepted = await synchronizeFile({
    inputPath: "src/greet.js",
    projectRoot: root,
    runner: async () => {
      throw new Error("A Git-matching pair invoked the runner.");
    }
  });
  assert.equal(accepted.mode, "NO_CHANGE");
  assert.equal(accepted.checkpointed, true);

  await git(root, ["switch", "--quiet", "-c", "oracle-branch"]);
  const exactBranch = await statusFile({
    inputPath: "src/greet.js",
    projectRoot: root
  });
  assert.equal(exactBranch.mode, "NO_CHANGE");

  await writeFiles(root, {
    "program/src/greet.js.md": GREETING_PROGRAM.replace("Hello, ", "Welcome, ")
  });
  const changedBranch = await statusFile({
    inputPath: "program/src/greet.js.md",
    projectRoot: root
  });
  assert.equal(changedBranch.mode, "PROGRAM_TO_IMPLEMENTATION");

  await writeFiles(root, { "program/src/greet.js.md": GREETING_PROGRAM });
  const linked = await fs.mkdtemp(path.join(os.tmpdir(), "progsync-oracle-worktree-"));
  await fs.rmdir(linked);
  t.after(async () => {
    await git(root, ["worktree", "remove", "--force", linked]).catch(() => {});
    await fs.rm(linked, { force: true, recursive: true });
  });
  await git(root, [
    "worktree", "add", "--quiet", "-b", "oracle-linked-worktree", linked
  ]);

  const linkedInitial = await statusFile({
    inputPath: "src/greet.js",
    projectRoot: linked
  });
  assert.equal(linkedInitial.mode, "NO_CHANGE");
  assert.equal(linkedInitial.baselineKind, "git");

  await writeFiles(linked, {
    "program/src/greet.js.md": GREETING_PROGRAM.replace("Hello, ", "Welcome, ")
  });
  assert.equal((await statusFile({
    inputPath: "program/src/greet.js.md",
    projectRoot: linked
  })).mode, "PROGRAM_TO_IMPLEMENTATION");
  assert.equal((await statusFile({
    inputPath: "program/src/greet.js.md",
    projectRoot: root
  })).mode, "NO_CHANGE");
});

test("a pair mutation during generation prevents every candidate write", async (t) => {
  const root = await createGitProject(t, {
    "program/src/greet.js.md": GREETING_PROGRAM,
    "src/greet.js": GREETING_IMPLEMENTATION
  }, { exports: "./src/greet.js" });
  const changedProgram = GREETING_PROGRAM.replace("Hello, ", "Welcome, ");
  const concurrentImplementation =
    "// Concurrent human edit.\nexport function greet(name) { return name; }\n";
  await writeFiles(root, { "program/src/greet.js.md": changedProgram });

  await assert.rejects(
    synchronizeFile({
      inputPath: "program/src/greet.js.md",
      projectRoot: root,
      runner: async ({ mode, workspaceRoot }) => {
        await writeWorkspace(
          workspaceRoot,
          "src/greet.js",
          GREETING_IMPLEMENTATION.replace("Hello, ", "Welcome, ")
        );
        await writeFiles(root, { "src/greet.js": concurrentImplementation });
        return report(mode);
      }
    }),
    (error) => typeof error?.code === "string" && /changed/u.test(error.message)
  );

  assert.equal(
    await fs.readFile(path.join(root, "src/greet.js"), "utf8"),
    concurrentImplementation
  );
  await assert.rejects(
    fs.stat(path.join(root, ".program/index/src/greet.js.md.json")),
    /ENOENT/u
  );
});

test("a shared-types mutation during source assimilation is never overwritten", async (t) => {
  const initialTypes = `# Project types

## Uses

- Nothing outside this file.

## Provides

### \`Existing type\`

An existing structured value.
`;
  const concurrentTypes = `${initialTypes}\n### \`Concurrent type\`\n\nA separately added type.\n`;
  const candidateTypes = `${initialTypes}
### \`Line item\`

A value containing a numeric \`amount\` field.
`;
  const amountProgram = `# Amount

Returns an amount from one line item.

## Uses

- Nothing outside this file.

## Provides

### \`amount()\`

#### Parameters

* \`line\`: a [Line item]

#### What it does

It reads the \`amount\` field from \`line\`.

#### Returns

The numeric amount.
`;
  const root = await createGitProject(t, {
    "program/types.md": initialTypes,
    "src/amount.js": "export function amount(line) { return line.amount; }\n"
  }, { exports: "./src/amount.js" });

  await assert.rejects(
    synchronizeFile({
      inputPath: "src/amount.js",
      operation: "import",
      projectRoot: root,
      runner: async ({ mode, workspaceRoot }) => {
        await writeWorkspace(workspaceRoot, "program/src/amount.js.md", amountProgram);
        await writeWorkspace(workspaceRoot, "program/types.md", candidateTypes);
        await writeFiles(root, { "program/types.md": concurrentTypes });
        return report(mode);
      }
    }),
    (error) => typeof error?.code === "string"
  );

  assert.equal(
    await fs.readFile(path.join(root, "program/types.md"), "utf8"),
    concurrentTypes
  );
  await assert.rejects(fs.stat(path.join(root, "program/src/amount.js.md")), /ENOENT/u);
});

test("a rejected multi-file candidate installs none of its writes", async (t) => {
  const primary = 'export { greet } from "./greet/format.js";\n';
  const auxiliary = "export function greet(name) { return `Hello, ${name}!`; }\n";
  const root = await createGitProject(t, {
    "program/src/greet.js.md": GREETING_PROGRAM,
    "src/greet.js": primary,
    "src/greet/format.js": auxiliary
  }, { exports: "./src/greet.js" });
  await writeFiles(root, {
    "program/src/greet.js.md": GREETING_PROGRAM.replace("Hello, ", "Welcome, ")
  });

  let attempts = 0;
  await assert.rejects(
    synchronizeFile({
      inputPath: "program/src/greet.js.md",
      projectRoot: root,
      runner: async ({ mode, workspaceRoot }) => {
        attempts += 1;
        await writeWorkspace(
          workspaceRoot,
          "src/greet.js",
          `// Keep this public forwarder.\n${primary}`
        );
        await writeWorkspace(
          workspaceRoot,
          "src/greet/format.js",
          "export function greet( {\n"
        );
        return report(mode);
      }
    }),
    (error) => error.code === "INVALID_IMPLEMENTATION"
  );

  assert.equal(attempts, 3);
  assert.equal(await fs.readFile(path.join(root, "src/greet.js"), "utf8"), primary);
  assert.equal(
    await fs.readFile(path.join(root, "src/greet/format.js"), "utf8"),
    auxiliary
  );
  assert.deepEqual(await hiddenProgSyncFiles(root), []);
});

test("syncChanged propagates shared types, retained assets, and package context", async (t) => {
  const root = await createGitProject(t, {
    "config.json": "{\"name\":\"before\"}\n",
    "program/src/asset-consumer.js.md": ASSET_CONSUMER_PROGRAM,
    "program/src/package-consumer.js.md": PACKAGE_CONSUMER_PROGRAM,
    "program/src/type-consumer.js.md": TYPE_CONSUMER_PROGRAM,
    "program/types.md": TYPES_PROGRAM,
    "src/asset-consumer.js":
      'import configuration from "../config.json" with { type: "json" };\nexport function configuredName() { return configuration.name; }\n',
    "src/package-consumer.js": "export function packageValue() { return 1; }\n",
    "src/type-consumer.js":
      'export function typeConsumer() { return { text: "ready" }; }\n'
  }, {
    exports: {
      "./asset": "./src/asset-consumer.js",
      "./package": "./src/package-consumer.js",
      "./type": "./src/type-consumer.js"
    }
  });

  await writeFiles(root, {
    "program/types.md": TYPES_PROGRAM.replace(
      "containing a `text` field",
      "containing a required `text` field"
    )
  });
  const typeCalls = [];
  const typeResult = await syncChanged({
    projectRoot: root,
    runner: async ({ mode, workspaceRoot }) => {
      typeCalls.push((await readContext(workspaceRoot)).target.programPath);
      return report(mode, "unchanged", "The type refinement needs no code change.");
    }
  });
  assert.deepEqual(typeCalls, ["program/src/type-consumer.js.md"]);
  assert.equal(typeResult.results.length, 1);
  assert.equal(typeResult.results[0].mode, "PROGRAM_TO_IMPLEMENTATION");
  await commitAll(root, "refine shared type");

  await writeFiles(root, { "config.json": "{\"name\":\"after\"}\n" });
  const assetCalls = [];
  const assetResult = await syncChanged({
    projectRoot: root,
    runner: async ({ mode, workspaceRoot }) => {
      const context = await readContext(workspaceRoot);
      assetCalls.push(context.target.programPath);
      assert.equal(context.resolvedReferences.some((reference) => (
        reference.provider === "asset:config.json" &&
        reference.content.includes("after")
      )), true);
      return report(mode, "unchanged", "Only retained data changed.");
    }
  });
  assert.deepEqual(assetCalls, ["program/src/asset-consumer.js.md"]);
  assert.deepEqual(assetResult.skippedPaths, []);
  await commitAll(root, "update retained configuration");

  await writeFiles(root, {
    "package.json": packageManifest({ dependencies: { "mail-client": "1.0.0" } })
  });
  const packageCalls = [];
  const packageResult = await syncChanged({
    projectRoot: root,
    runner: async ({ mode, workspaceRoot }) => {
      const context = await readContext(workspaceRoot);
      packageCalls.push(context.target.programPath);
      assert.equal(context.retainedPackageContext.dependencies["mail-client"], "1.0.0");
      return report(mode, "unchanged", "The module remains package-compatible.");
    }
  });
  assert.deepEqual(packageCalls.sort(), [
    "program/src/asset-consumer.js.md",
    "program/src/package-consumer.js.md",
    "program/src/type-consumer.js.md"
  ]);
  assert.equal(packageResult.results.length, 3);
  assert.deepEqual(packageResult.skippedPaths, []);
});

test("malformed Vue and HTML candidates are rejected through synchronization", async (t) => {
  const cases = [
    {
      implementationPath: "src/Broken.vue",
      programPath: "program/src/Broken.vue.md",
      programSource: `# Broken component

## Uses

- Nothing outside this file.

## Provides

### \`Broken\`

A component that displays one message.
`,
      source: "<template><div></template>\n"
    },
    {
      implementationPath: "public/broken.html",
      programPath: "program/public/broken.html.md",
      programSource: `# Broken document

## Uses

- Nothing outside this file.

## Provides

### \`broken\`

An HTML document that displays one message.
`,
      source: "<!doctype html><html><script>const value = ;</script></html>\n"
    }
  ];

  for (const fixture of cases) {
    await t.test(fixture.implementationPath, async (subtest) => {
      const root = await createGitProject(subtest, {
        [fixture.programPath]: fixture.programSource
      });
      let attempts = 0;
      await assert.rejects(
        synchronizeFile({
          inputPath: fixture.programPath,
          projectRoot: root,
          runner: async ({ mode, workspaceRoot }) => {
            attempts += 1;
            await writeWorkspace(workspaceRoot, fixture.implementationPath, fixture.source);
            return report(mode);
          }
        }),
        (error) => error.code === "INVALID_IMPLEMENTATION"
      );
      assert.equal(attempts, 3);
      await assert.rejects(fs.stat(path.join(root, fixture.implementationPath)), /ENOENT/u);
    });
  }
});

test("CommonJS and renamed forwarding exports conform to one Program surface", async (t) => {
  const commonRoot = await createGitProject(t, {
    "program/src/greet.js.md": GREETING_PROGRAM
  }, { type: "commonjs" });
  const commonResult = await synchronizeFile({
    inputPath: "program/src/greet.js.md",
    projectRoot: commonRoot,
    runner: async ({ mode, workspaceRoot }) => {
      await writeWorkspace(
        workspaceRoot,
        "src/greet.js",
        "const greet = (name) => `Hello, ${name}!`;\nmodule.exports = { greet };\n"
      );
      return report(mode);
    }
  });
  assert.equal(commonResult.status, "updated");
  assert.equal(
    createRequire(import.meta.url)(path.join(commonRoot, "src/greet.js")).greet("Ada"),
    "Hello, Ada!"
  );

  const forwardRoot = await createGitProject(t, {
    "program/src/greet.js.md": GREETING_PROGRAM
  });
  const forwardResult = await synchronizeFile({
    inputPath: "program/src/greet.js.md",
    projectRoot: forwardRoot,
    runner: async ({ mode, workspaceRoot }) => {
      await writeWorkspace(
        workspaceRoot,
        "src/greet.js",
        'export { formatGreeting as greet } from "./greet/format.js";\n'
      );
      await writeWorkspace(
        workspaceRoot,
        "src/greet/format.js",
        "export function formatGreeting(name) { return `Hello, ${name}!`; }\n"
      );
      return report(mode);
    }
  });
  assert.equal(forwardResult.status, "updated");
  assert.equal(
    (await import(pathToFileURL(path.join(forwardRoot, "src/greet.js")).href)).greet("Ada"),
    "Hello, Ada!"
  );
  assert.deepEqual(
    forwardResult.changedFiles.filter((entry) => !entry.startsWith(".program/")),
    ["src/greet.js", "src/greet/format.js"]
  );
});

test("Program checking never traverses a symlinked projection tree", async (t) => {
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "progsync-oracle-index-"));
  t.after(() => fs.rm(outside, { force: true, recursive: true }));
  const victim = path.join(outside, "orphan.js.md.json");
  await fs.writeFile(victim, "do not alter\n", "utf8");
  const root = await createGitProject(t, { "program/types.md": TYPES_PROGRAM });
  await fs.mkdir(path.join(root, ".program"), { recursive: true });
  await fs.symlink(outside, path.join(root, ".program/index"));

  await assert.rejects(
    checkProgram({ projectRoot: root }),
    (error) => error.code === "SYMLINKED_PROJECT_PATH"
  );
  assert.equal(await fs.readFile(victim, "utf8"), "do not alter\n");
});

test("an explicit Git base bypasses an accepted dirty pair", async (t) => {
  const root = await createGitProject(t, {
    "program/src/greet.js.md": GREETING_PROGRAM,
    "src/greet.js": GREETING_IMPLEMENTATION
  }, { exports: "./src/greet.js" });
  await synchronizeFile({
    inputPath: "src/greet.js",
    projectRoot: root,
    runner: async () => {
      throw new Error("A Git-matching pair invoked the runner.");
    }
  });
  await writeFiles(root, {
    "program/src/greet.js.md": GREETING_PROGRAM.replace("Hello, ", "Welcome, "),
    "src/greet.js": GREETING_IMPLEMENTATION.replace("Hello, ", "Welcome, ")
  });
  await synchronizeFile({
    inputPath: "src/greet.js",
    projectRoot: root,
    runner: async ({ mode }) => report(
      mode,
      "unchanged",
      "Both artifacts already express the compatible change."
    )
  });

  const accepted = await statusFile({ inputPath: "src/greet.js", projectRoot: root });
  assert.equal(accepted.mode, "NO_CHANGE");
  assert.equal(typeof accepted.baselineKind, "string");

  const explicit = await statusFile({
    base: "HEAD",
    inputPath: "src/greet.js",
    projectRoot: root
  });
  assert.equal(explicit.mode, "RECONCILE_BOTH");
  assert.notEqual(explicit.baselineKind, accepted.baselineKind);
});

test("an explicit Git base ignores stale accepted dependency context", async (t) => {
  const root = await createGitProject(t, {
    "config.json": "{\"name\":\"before\"}\n",
    "program/src/asset-consumer.js.md": ASSET_CONSUMER_PROGRAM,
    "src/asset-consumer.js":
      'import configuration from "../config.json" with { type: "json" };\nexport function configuredName() { return configuration.name; }\n'
  }, { exports: "./src/asset-consumer.js" });

  const accepted = await synchronizeFile({
    inputPath: "src/asset-consumer.js",
    projectRoot: root,
    runner: async () => {
      throw new Error("A Git-matching pair invoked the runner.");
    }
  });
  assert.equal(accepted.mode, "NO_CHANGE");

  await writeFiles(root, { "config.json": "{\"name\":\"after\"}\n" });
  await commitAll(root, "update retained configuration");

  assert.equal((await statusFile({
    inputPath: "src/asset-consumer.js",
    projectRoot: root
  })).mode, "PROGRAM_TO_IMPLEMENTATION");

  const explicitStatus = await statusFile({
    base: "HEAD",
    inputPath: "src/asset-consumer.js",
    projectRoot: root
  });
  assert.equal(explicitStatus.mode, "NO_CHANGE");

  const explicitSync = await synchronizeFile({
    base: "HEAD",
    inputPath: "src/asset-consumer.js",
    projectRoot: root,
    runner: async () => {
      throw new Error("An explicit current Git base invoked the runner.");
    }
  });
  assert.equal(explicitSync.mode, "NO_CHANGE");
  assert.equal(explicitSync.status, "unchanged");
});

test("syncChanged dry-run reports its patch without changing either side", async (t) => {
  const root = await createGitProject(t, {
    "program/src/greet.js.md": GREETING_PROGRAM,
    "src/greet.js": GREETING_IMPLEMENTATION
  }, { exports: "./src/greet.js" });
  await writeFiles(root, {
    "program/src/greet.js.md": GREETING_PROGRAM.replace("Hello, ", "Welcome, ")
  });

  const result = await syncChanged({
    projectRoot: root,
    runner: async ({ mode, workspaceRoot }) => {
      await writeWorkspace(
        workspaceRoot,
        "src/greet.js",
        GREETING_IMPLEMENTATION.replace("Hello, ", "Welcome, ")
      );
      return report(mode);
    },
    write: false
  });

  assert.equal(result.status, "updated");
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].applied, false);
  assert.match(result.results[0].diff, /Welcome/u);
  assert.equal(
    await fs.readFile(path.join(root, "src/greet.js"), "utf8"),
    GREETING_IMPLEMENTATION
  );
  assert.equal((await statusFile({
    inputPath: "src/greet.js",
    projectRoot: root
  })).mode, "PROGRAM_TO_IMPLEMENTATION");
});
