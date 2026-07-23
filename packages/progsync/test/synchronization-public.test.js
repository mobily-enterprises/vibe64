import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import {
  statusFile,
  syncChanged,
  synchronizeFile
} from "../src/index.js";
import {
  COMMAND_PROGRAM,
  GREETING_PROGRAM,
  createGitProject,
  git,
  readContext,
  report,
  writeFiles,
  writeWorkspace
} from "./oracle-helpers.js";

function runHarness(source, { env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", source], {
      env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({
      code,
      signal,
      stderr: Buffer.concat(stderr).toString("utf8"),
      stdout: Buffer.concat(stdout).toString("utf8")
    }));
  });
}

test("creates a primary target and private auxiliary as one owned module", async (t) => {
  const root = await createGitProject(t, {
    "program/src/greet.js.md": GREETING_PROGRAM
  }, { exports: "./src/greet.js" });
  const runner = async ({ allowedPathPrefixes, mode, workspaceRoot }) => {
    const context = await readContext(workspaceRoot);
    assert.deepEqual(allowedPathPrefixes, ["src/greet/"]);
    await writeWorkspace(
      workspaceRoot,
      "src/greet/format.js",
      "export function greet(name) { return `Hello, ${name}!`; }\n"
    );
    await writeWorkspace(
      workspaceRoot,
      context.target.implementationPath,
      'export { greet } from "./greet/format.js";\n'
    );
    return report(mode);
  };

  const result = await synchronizeFile({
    inputPath: "program/src/greet.js.md",
    operation: "compile",
    projectRoot: root,
    runner
  });
  assert.equal(result.mode, "CREATE_IMPLEMENTATION");
  assert.deepEqual(result.changedFiles.filter((file) => !file.startsWith(".program/")), [
    "src/greet.js",
    "src/greet/format.js"
  ]);
  assert.equal((await import(`${pathToFileURL(path.join(root, "src/greet.js")).href}?v=1`)).greet("Ada"), "Hello, Ada!");
  assert.notEqual((await git(root, ["show-ref", "refs/worktree/progsync/state"])).trim(), "");

  const status = await statusFile({
    inputPath: "src/greet.js",
    projectRoot: root
  });
  assert.equal(status.reconciled, true);
  assert.equal(status.mode, "NO_CHANGE");
});

test("rejects a concurrent synchronization while the pair lock is live", async (t) => {
  const root = await createGitProject(t, {
    "program/src/greet.js.md": GREETING_PROGRAM
  }, { exports: "./src/greet.js" });
  let enterRunner;
  let releaseRunner;
  const runnerEntered = new Promise((resolve) => {
    enterRunner = resolve;
  });
  const runnerGate = new Promise((resolve) => {
    releaseRunner = resolve;
  });
  const first = synchronizeFile({
    inputPath: "program/src/greet.js.md",
    projectRoot: root,
    runner: async ({ mode, workspaceRoot }) => {
      enterRunner();
      await runnerGate;
      await writeWorkspace(
        workspaceRoot,
        "src/greet.js",
        "export function greet(name) { return `Hello, ${name}!`; }\n"
      );
      return report(mode);
    }
  });

  await runnerEntered;
  try {
    await assert.rejects(
      synchronizeFile({
        inputPath: "program/src/greet.js.md",
        projectRoot: root,
        runner: async () => {
          throw new Error("A contending synchronization reached its runner.");
        }
      }),
      (error) => error.code === "PAIR_BUSY"
    );
  } finally {
    releaseRunner();
  }
  assert.equal((await first).status, "updated");
});

test("recovers an abandoned pair owner without prescribing its private lock layout", async (t) => {
  const root = await createGitProject(t, {
    "program/src/greet.js.md": GREETING_PROGRAM
  }, { exports: "./src/greet.js" });
  let ownerPath;
  let ownerRecord;
  await synchronizeFile({
    inputPath: "program/src/greet.js.md",
    projectRoot: root,
    runner: async ({ mode, workspaceRoot }) => {
      const gitDirectory = (await git(root, [
        "rev-parse",
        "--path-format=absolute",
        "--git-dir"
      ])).trim();
      const candidates = [];
      async function visit(directory) {
        for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
          const entryPath = path.join(directory, entry.name);
          if (entry.isDirectory()) await visit(entryPath);
          else if (entry.isFile()) {
            try {
              const value = JSON.parse(await fs.readFile(entryPath, "utf8"));
              if (value.pid === process.pid) candidates.push(entryPath);
            } catch {
              // Most Git files are not owner records.
            }
          }
        }
      }
      await visit(gitDirectory);
      assert.equal(candidates.length, 1);
      [ownerPath] = candidates;
      ownerRecord = JSON.parse(await fs.readFile(ownerPath, "utf8"));
      await writeWorkspace(
        workspaceRoot,
        "src/greet.js",
        "export function greet(name) { return `Hello, ${name}!`; }\n"
      );
      return report(mode);
    }
  });
  assert.ok(ownerPath);

  const abandonedOwnerRecord = {
    ...ownerRecord,
    pid: 99_999_999,
  };
  for (const [key, value] of Object.entries(abandonedOwnerRecord)) {
    if (!/(?:claimed|created|started)At$/u.test(key)) continue;
    abandonedOwnerRecord[key] = typeof value === "number"
      ? 0
      : new Date(0).toISOString();
  }
  const abandonedOwner = `${JSON.stringify(abandonedOwnerRecord)}\n`;
  const synchronizeWithoutRunner = () => synchronizeFile({
    inputPath: "program/src/greet.js.md",
    projectRoot: root,
    runner: async () => {
      throw new Error("A reconciled pair invoked its runner during lock recovery.");
    }
  });

  await fs.mkdir(path.dirname(ownerPath), { recursive: true });
  await fs.writeFile(ownerPath, abandonedOwner, "utf8");
  assert.equal((await synchronizeWithoutRunner()).status, "unchanged");
  await assert.rejects(fs.stat(ownerPath), /ENOENT/u);
});

test("replaces an incompatible private state object without invoking the runner", async (t) => {
  const root = await createGitProject(t, {
    "program/src/greet.js.md": GREETING_PROGRAM,
    "src/greet.js": "export function greet(name) { return `Hello, ${name}!`; }\n"
  }, { exports: "./src/greet.js" });
  const blob = (await git(root, ["hash-object", "-w", "package.json"])).trim();
  await git(root, ["update-ref", "refs/worktree/progsync/state", blob]);

  const result = await synchronizeFile({
    inputPath: "program/src/greet.js.md",
    projectRoot: root,
    runner: async () => {
      throw new Error("An unchanged pair invoked the runner.");
    }
  });

  assert.equal(result.mode, "NO_CHANGE");
  assert.equal(result.checkpointed, true);
  const stateObject = (await git(root, [
    "rev-parse",
    "refs/worktree/progsync/state"
  ])).trim();
  assert.notEqual(stateObject, blob);
  assert.equal((await statusFile({
    inputPath: "src/greet.js",
    projectRoot: root
  })).reconciled, true);
});

test("creates Program and shared complex types from source-only input", async (t) => {
  const implementation = `/**
 * @param {{ unitPrice: number, quantity: number }} item
 */
export function lineTotal(item) {
  return { subtotal: item.unitPrice * item.quantity };
}
`;
  const program = `# Line total

Calculates one merchandise line total.

## Uses

- Nothing outside this file.

## Provides

### \`lineTotal()\`

#### Parameters

* \`item\`: a [Line item]

#### What it does

It multiplies the \`unitPrice\` and \`quantity\` fields from \`item\`.

#### Returns

A [Line total] whose \`subtotal\` is that product.
`;
  const types = `# Project types

## Uses

- Nothing outside this file.

## Provides

### \`Line item\`

A merchandise line containing numeric \`unitPrice\` and \`quantity\` fields.

### \`Line total\`

A calculated line containing numeric \`subtotal\`.
`;
  const root = await createGitProject(t, {
    "src/line-total.js": implementation
  }, { exports: "./src/line-total.js" });

  const result = await synchronizeFile({
    inputPath: "src/line-total.js",
    operation: "import",
    projectRoot: root,
    runner: async ({ mode, workspaceRoot }) => {
      await writeWorkspace(workspaceRoot, "program/src/line-total.js.md", program);
      await writeWorkspace(workspaceRoot, "program/types.md", types);
      return report(mode, "updated", "Created readable Program and shared types.", {
        programChanges: [
          "Created program/src/line-total.js.md.",
          "Created the Line item and Line total shared types."
        ],
        implementationChanges: []
      });
    }
  });

  assert.equal(result.mode, "CREATE_PROGRAM");
  assert.deepEqual(result.changedFiles.filter((file) => !file.startsWith(".program/")), [
    "program/src/line-total.js.md",
    "program/types.md"
  ]);
  assert.match(await fs.readFile(path.join(root, "program/types.md"), "utf8"), /Line total/u);
  assert.equal((await statusFile({
    inputPath: "src/line-total.js",
    projectRoot: root
  })).reconciled, true);
});

test("preserves and checkpoints an implementation-only auxiliary refinement", async (t) => {
  const root = await createGitProject(t, {
    "program/src/greet.js.md": GREETING_PROGRAM,
    "src/greet.js": 'export { greet } from "./greet/format.js";\n',
    "src/greet/format.js": "export function greet(name) { return `Hello, ${name}!`; }\n"
  }, { exports: "./src/greet.js" });
  await writeFiles(root, {
    "src/greet/format.js": "// Tuned after profiling.\nexport function greet(name) { return `Hello, ${name}!`; }\n"
  });
  let observedContext;
  const result = await synchronizeFile({
    inputPath: "src/greet.js",
    projectRoot: root,
    runner: async ({ mode, workspaceRoot }) => {
      observedContext = await readContext(workspaceRoot);
      return report(mode, "unchanged", "The refinement preserves Program meaning.");
    }
  });
  assert.equal(result.mode, "IMPLEMENTATION_TO_PROGRAM");
  assert.equal(observedContext.current.auxiliaryImplementations[0].path, "src/greet/format.js");
  assert.match(observedContext.current.auxiliaryImplementations[0].source, /profiling/u);
  assert.match(await fs.readFile(path.join(root, "src/greet/format.js"), "utf8"), /profiling/u);
  assert.equal((await statusFile({ inputPath: "src/greet.js", projectRoot: root })).reconciled, true);
});

test("retries a structurally rejected candidate with the complete diagnostic", async (t) => {
  const root = await createGitProject(t, {
    "program/src/greet.js.md": GREETING_PROGRAM
  }, { exports: "./src/greet.js" });
  let attempts = 0;
  let firstWorkspace;
  const result = await synchronizeFile({
    inputPath: "program/src/greet.js.md",
    projectRoot: root,
    runner: async ({ mode, prompt, workspaceRoot }) => {
      attempts += 1;
      if (attempts === 1) {
        firstWorkspace = workspaceRoot;
      }
      if (attempts === 2) {
        assert.equal(workspaceRoot, firstWorkspace);
        assert.match(
          await fs.readFile(path.join(workspaceRoot, "src/greet.js"), "utf8"),
          /farewell/u
        );
        assert.match(prompt, /PAIR_SURFACE_MISMATCH/u);
        assert.match(prompt, /Program provides greet\(\)/u);
        assert.match(prompt, /Repair that candidate in place/u);
        assert.match(prompt, /Re-audit the complete Program/u);
      }
      await writeWorkspace(
        workspaceRoot,
        "src/greet.js",
        attempts === 1
          ? "export function farewell(name) { return name; }\n"
          : "export function greet(name) { return `Hello, ${name}!`; }\n"
      );
      return report(mode);
    }
  });
  assert.equal(attempts, 2);
  assert.equal(result.status, "updated");
});

test("retries a candidate whose private named import cannot link", async (t) => {
  const root = await createGitProject(t, {
    "program/src/greet.js.md": GREETING_PROGRAM
  }, { exports: "./src/greet.js" });
  let attempts = 0;
  let firstWorkspace;
  const result = await synchronizeFile({
    inputPath: "program/src/greet.js.md",
    projectRoot: root,
    runner: async ({ mode, prompt, workspaceRoot }) => {
      attempts += 1;
      firstWorkspace ||= workspaceRoot;
      assert.equal(workspaceRoot, firstWorkspace);
      await writeWorkspace(
        workspaceRoot,
        "src/greet.js",
        'export { greet } from "./greet/format.js";\n'
      );
      await writeWorkspace(
        workspaceRoot,
        "src/greet/helpers.js",
        "export const available = true;\n"
      );
      await writeWorkspace(
        workspaceRoot,
        "src/greet/format.js",
        attempts === 1
          ? 'import { missing } from "./helpers.js";\nexport function greet(name) { void missing; return `Hello, ${name}!`; }\n'
          : 'import { available } from "./helpers.js";\nexport function greet(name) { void available; return `Hello, ${name}!`; }\n'
      );
      if (attempts === 2) {
        assert.match(prompt, /missing/u);
        assert.match(prompt, /src\/greet\/format\.js/u);
        assert.match(prompt, /export/u);
        assert.match(prompt, /src\/greet\/helpers\.js/u);
        assert.match(prompt, /Repair that candidate in place/u);
      }
      return report(mode);
    }
  });
  assert.equal(attempts, 2);
  assert.equal(result.status, "updated");
  assert.equal((await statusFile({ inputPath: "src/greet.js", projectRoot: root })).reconciled, true);
});

test("NO_CHANGE follows a project provider's forwarded public export", async (t) => {
  const welcomeProgram = `# Welcome

Produces a welcome message through the public greeting module.

## Uses

- [\`greet()\`](@/src/greet.js.md#greet)

## Provides

### \`welcome()\`

#### Parameters

* \`name\`: the recipient name as text

#### What it does

It calls \`greet()\` with \`name\`.

#### Returns

The text returned by \`greet()\`.
`;
  const root = await createGitProject(t, {
    "program/src/greet.js.md": GREETING_PROGRAM,
    "program/src/welcome.js.md": welcomeProgram,
    "src/greet.js": 'export { greet } from "./greet/format.js";\n',
    "src/greet/format.js":
      'export function greet(name) { return `Hello, ${name}!`; }\n',
    "src/welcome.js":
      'import { greet } from "./greet.js";\nexport function welcome(name) { return greet(name); }\n'
  }, {
    exports: {
      "./greet": "./src/greet.js",
      "./welcome": "./src/welcome.js"
    }
  });
  const result = await synchronizeFile({
    inputPath: "program/src/welcome.js.md",
    projectRoot: root,
    runner: async () => {
      throw new Error("NO_CHANGE must not invoke a runner.");
    }
  });

  assert.equal(result.mode, "NO_CHANGE");
  assert.equal(result.status, "unchanged");
  const module = await import(`${pathToFileURL(path.join(root, "src/welcome.js")).href}?v=${Date.now()}`);
  assert.equal(module.welcome("Ada"), "Hello, Ada!");
});

test("rejects candidate writes outside exact paths and the owned root", async (t) => {
  const root = await createGitProject(t, {
    "program/src/greet.js.md": GREETING_PROGRAM
  });
  await assert.rejects(
    synchronizeFile({
      inputPath: "program/src/greet.js.md",
      projectRoot: root,
      runner: async ({ mode, workspaceRoot }) => {
        await writeWorkspace(workspaceRoot, "src/greet.js", "export function greet(name) { return name; }\n");
        await writeWorkspace(workspaceRoot, "src/unowned.js", "export const bad = true;\n");
        await writeWorkspace(workspaceRoot, "src/greeting.js", "export const sibling = true;\n");
        return report(mode);
      }
    }),
    (error) => error.code === "ATOMIC_WRITE_BOUNDARY_VIOLATION" &&
      error.details.forbidden.includes("src/unowned.js") &&
      error.details.forbidden.includes("src/greeting.js")
  );
  await assert.rejects(fs.stat(path.join(root, "src/greet.js")), /ENOENT/u);
});

test("a dry run changes neither files nor private accepted state", async (t) => {
  const root = await createGitProject(t, {
    "program/src/greet.js.md": GREETING_PROGRAM
  });
  const result = await synchronizeFile({
    inputPath: "program/src/greet.js.md",
    projectRoot: root,
    runner: async ({ mode, workspaceRoot }) => {
      await writeWorkspace(workspaceRoot, "src/greet.js", "export function greet(name) { return `Hello, ${name}!`; }\n");
      return report(mode);
    },
    write: false
  });
  assert.equal(result.applied, false);
  assert.match(result.diff, /src\/greet\.js/u);
  await assert.rejects(fs.stat(path.join(root, "src/greet.js")), /ENOENT/u);
  await assert.rejects(git(root, ["show-ref", "--verify", "refs/worktree/progsync/state"]));
});

test("a failed default runner leaves no descendant process behind", async (t) => {
  const root = await createGitProject(t, {
    "program/src/greet.js.md": GREETING_PROGRAM
  });
  const childPidPath = path.join(root, "runner-child.pid");
  const fakeCodex = `#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";

const child = spawn(process.execPath, [
  "-e",
  "process.on('SIGTERM', () => {}); process.send?.('ready'); setInterval(() => {}, 1000)",
  "progsync-oracle-runner-child"
], { stdio: ["ignore", "ignore", "ignore", "ipc"] });

child.once("message", () => {
  fs.writeFileSync(process.env.PROGSYNC_ORACLE_CHILD_PID_PATH, String(child.pid));
  process.stdout.write(Buffer.alloc(17 * 1024 * 1024, 120));
});
setInterval(() => {}, 1000);
`;
  await writeFiles(root, { "fake-bin/codex": fakeCodex });
  await fs.chmod(path.join(root, "fake-bin/codex"), 0o755);

  const packageEntry = new URL("../src/index.js", import.meta.url).href;
  const harnessSource = `
import { synchronizeFile } from ${JSON.stringify(packageEntry)};
try {
  await synchronizeFile({
    inputPath: "program/src/greet.js.md",
    projectRoot: ${JSON.stringify(root)}
  });
  process.stdout.write(JSON.stringify({ code: null }));
} catch (error) {
  process.stdout.write(JSON.stringify({ code: error.code }));
}
`;
  let childPid = null;
  try {
    const completion = await runHarness(harnessSource, {
      env: {
        ...process.env,
        PATH: `${path.join(root, "fake-bin")}:${process.env.PATH}`,
        PROGSYNC_ORACLE_CHILD_PID_PATH: childPidPath
      }
    });
    assert.equal(completion.code, 0, completion.stderr);
    assert.deepEqual(JSON.parse(completion.stdout), { code: "CODEX_EXEC_FAILED" });
    childPid = Number(await fs.readFile(childPidPath, "utf8"));
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.throws(
      () => process.kill(childPid, 0),
      (error) => error.code === "ESRCH"
    );
  } finally {
    if (childPid) {
      try {
        process.kill(childPid, "SIGKILL");
      } catch {
        // The assertion above expects the child to be gone; this is only
        // best-effort cleanup when that assertion fails.
      }
    }
  }
});

test("cancelling the default runner leaves no detached descendant", async (t) => {
  const root = await createGitProject(t, {
    "program/src/greet.js.md": GREETING_PROGRAM
  });
  const childPidPath = path.join(root, "cancelled-runner-child.pid");
  const fakeCodex = `#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";

const child = spawn(process.execPath, [
  "-e",
  "process.on('SIGTERM', () => {}); process.send?.('ready'); setInterval(() => {}, 1000)",
  "progsync-oracle-cancelled-child"
], { stdio: ["ignore", "ignore", "ignore", "ipc"] });

child.once("message", () => {
  fs.writeFileSync(process.env.PROGSYNC_ORACLE_CHILD_PID_PATH, String(child.pid));
});
setInterval(() => {}, 1000);
`;
  await writeFiles(root, { "fake-bin/codex": fakeCodex });
  await fs.chmod(path.join(root, "fake-bin/codex"), 0o755);

  const packageEntry = new URL("../src/index.js", import.meta.url).href;
  const harnessSource = `
import { synchronizeFile } from ${JSON.stringify(packageEntry)};
await synchronizeFile({
  inputPath: "program/src/greet.js.md",
  projectRoot: ${JSON.stringify(root)}
});
`;
  const harness = spawn(process.execPath, ["--input-type=module", "-e", harnessSource], {
    env: {
      ...process.env,
      PATH: `${path.join(root, "fake-bin")}:${process.env.PATH}`,
      PROGSYNC_ORACLE_CHILD_PID_PATH: childPidPath
    },
    stdio: "ignore"
  });
  let childPid = null;
  let completionTimer = null;
  try {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      try {
        childPid = Number(await fs.readFile(childPidPath, "utf8"));
        break;
      } catch (error) {
        if (error?.code !== "ENOENT") {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
    assert.ok(Number.isInteger(childPid) && childPid > 0, "fake Codex child did not start");

    const completionPromise = Promise.race([
      new Promise((resolve) => harness.once("close", (code, signal) => resolve({ code, signal }))),
      new Promise((_, reject) => {
        completionTimer = setTimeout(
          () => reject(new Error("cancelled ProgSync process did not exit")),
          10_000
        );
      })
    ]);
    harness.kill("SIGINT");
    const completion = await completionPromise;
    assert.equal(completion.signal, "SIGINT");
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.throws(
      () => process.kill(childPid, 0),
      (error) => error.code === "ESRCH"
    );
  } finally {
    if (completionTimer) {
      clearTimeout(completionTimer);
    }
    if (harness.exitCode === null && harness.signalCode === null) {
      harness.kill("SIGKILL");
    }
    if (childPid) {
      try {
        process.kill(childPid, "SIGKILL");
      } catch {
        // Best-effort cleanup if the assertion above fails.
      }
    }
  }
});

test("the default runner is pinned and receives no ambient agent capabilities", async (t) => {
  const root = await createGitProject(t, {
    "program/src/greet.js.md": GREETING_PROGRAM
  });
  const argsPath = path.join(root, "runner-args.json");
  const fakeCodex = `#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
fs.writeFileSync(process.env.PROGSYNC_ORACLE_ARGS_PATH, JSON.stringify(args));
fs.mkdirSync(path.join(process.cwd(), "src"), { recursive: true });
fs.writeFileSync(path.join(process.cwd(), "src/greet.js"), "export function greet(name) { return \\"Hello, \\" + name + \\"!\\"; }\\n");
const outputIndex = args.indexOf("--output-last-message");
const report = {
  status: "updated",
  mode: "CREATE_IMPLEMENTATION",
  summary: "Created the greeting implementation.",
  programChanges: [],
  implementationChanges: ["Created src/greet.js."],
  preservedImplementationDetails: [],
  sharedDefinitionProposals: [],
  diagnostics: [],
  verificationPerformed: [],
  verificationStillRequired: []
};
fs.writeFileSync(args[outputIndex + 1], JSON.stringify(report));
`;
  await writeFiles(root, { "fake-bin/codex": fakeCodex });
  await fs.chmod(path.join(root, "fake-bin/codex"), 0o755);

  const packageEntry = new URL("../src/index.js", import.meta.url).href;
  const completion = await runHarness(`
import { synchronizeFile } from ${JSON.stringify(packageEntry)};
const result = await synchronizeFile({
  inputPath: "program/src/greet.js.md",
  projectRoot: ${JSON.stringify(root)}
});
process.stdout.write(JSON.stringify({ status: result.status }));
`, {
    env: {
      ...process.env,
      PATH: `${path.join(root, "fake-bin")}:${process.env.PATH}`,
      PROGSYNC_ORACLE_ARGS_PATH: argsPath
    }
  });
  assert.equal(completion.code, 0, completion.stderr);
  assert.deepEqual(JSON.parse(completion.stdout), { status: "updated" });
  const args = JSON.parse(await fs.readFile(argsPath, "utf8"));
  const valuesFor = (name) => args.flatMap((value, index) => (
    value === name ? [args[index + 1]] : []
  ));
  assert.equal(args[0], "exec");
  assert.equal(valuesFor("--model")[0], "gpt-5.6-sol");
  assert.equal(valuesFor("--config").includes('model_reasoning_effort="xhigh"'), true);
  assert.equal(valuesFor("--config").includes('web_search="disabled"'), true);
  assert.equal(args.includes("--ephemeral"), true);
  assert.equal(args.includes("--ignore-user-config"), true);
  assert.equal(args.includes("--ignore-rules"), true);
  assert.equal(args.includes("--dangerously-bypass-approvals-and-sandbox"), true);
  assert.equal(args.includes("--output-schema"), true);
  assert.equal(args.includes("--output-last-message"), true);
  assert.equal(args.includes("--cd"), true);
  assert.deepEqual(valuesFor("--sandbox"), []);
  const reportPath = path.relative(
    valuesFor("--cd")[0],
    valuesFor("--output-last-message")[0]
  );
  assert.equal(reportPath.startsWith(".."), false);
  assert.notEqual(reportPath, "");
  await assert.rejects(fs.access(valuesFor("--output-last-message")[0]));
  assert.deepEqual(valuesFor("--disable").sort(), [
    "apps",
    "goals",
    "hooks",
    "memories",
    "multi_agent",
    "remote_plugin",
    "shell_snapshot",
    "shell_tool",
    "web_search"
  ]);
});

test("candidate Git ignores hostile ambient routing, signing, identity, and hooks", async (t) => {
  const root = await createGitProject(t, {
    "program/src/greet.js.md": GREETING_PROGRAM
  }, { exports: "./src/greet.js" });
  const hostileRoot = await fs.mkdtemp(path.join(os.tmpdir(), "progsync-hostile-git-"));
  t.after(() => fs.rm(hostileRoot, { recursive: true, force: true }));
  const hooksPath = path.join(hostileRoot, "hooks");
  const hookMarker = path.join(hostileRoot, "hook-ran");
  await fs.mkdir(hooksPath, { recursive: true });
  await fs.writeFile(
    path.join(hooksPath, "pre-commit"),
    `#!/bin/sh\nprintf ran > ${JSON.stringify(hookMarker)}\nexit 1\n`,
    "utf8"
  );
  await fs.chmod(path.join(hooksPath, "pre-commit"), 0o755);
  await fs.writeFile(
    path.join(hostileRoot, ".gitconfig"),
    `[user]\n\tuseConfigOnly = true\n[commit]\n\tgpgSign = true\n[core]\n\thooksPath = ${hooksPath}\n`,
    "utf8"
  );

  const packageEntry = new URL("../src/index.js", import.meta.url).href;
  const completion = await runHarness(`
import fs from "node:fs/promises";
import path from "node:path";
import { statusFile, synchronizeFile } from ${JSON.stringify(packageEntry)};
const root = ${JSON.stringify(root)};
const result = await synchronizeFile({
  inputPath: "program/src/greet.js.md",
  projectRoot: root,
  runner: async ({ mode, workspaceRoot }) => {
    await fs.mkdir(path.join(workspaceRoot, "src"), { recursive: true });
    await fs.writeFile(
      path.join(workspaceRoot, "src/greet.js"),
      "export function greet(name) { return 'Hello, ' + name + '!'; }\\n",
      "utf8"
    );
    return {
      diagnostics: [], implementationChanges: [], mode,
      preservedImplementationDetails: [], programChanges: [],
      sharedDefinitionProposals: [], status: "updated",
      summary: "Created the implementation.", verificationPerformed: [],
      verificationStillRequired: []
    };
  }
});
const status = await statusFile({ inputPath: "src/greet.js", projectRoot: root });
process.stdout.write(JSON.stringify({ reconciled: status.reconciled, status: result.status }));
`, {
    env: {
      ...process.env,
      GIT_DIR: path.join(hostileRoot, "redirected.git"),
      GIT_INDEX_FILE: path.join(hostileRoot, "redirected.index"),
      GIT_WORK_TREE: hostileRoot,
      HOME: hostileRoot
    }
  });
  assert.equal(completion.code, 0, completion.stderr);
  assert.deepEqual(JSON.parse(completion.stdout), {
    reconciled: true,
    status: "updated"
  });
  assert.match(await fs.readFile(path.join(root, "src/greet.js"), "utf8"), /greet/u);
  await assert.rejects(fs.stat(hookMarker), /ENOENT/u);
});

test("commands become executable and then converge without another runner", async (t) => {
  const root = await createGitProject(t, {
    "program/bin/example.js.md": COMMAND_PROGRAM
  }, { bin: { example: "./bin/example.js" } });
  await synchronizeFile({
    inputPath: "program/bin/example.js.md",
    projectRoot: root,
    runner: async ({ mode, workspaceRoot }) => {
      await writeWorkspace(workspaceRoot, "bin/example.js", "#!/usr/bin/env node\nprocess.exitCode = 0;\n");
      return report(mode);
    }
  });
  assert.notEqual((await fs.stat(path.join(root, "bin/example.js"))).mode & 0o111, 0);
  const second = await synchronizeFile({
    inputPath: "bin/example.js",
    projectRoot: root,
    runner: async () => { throw new Error("Converged synchronization invoked a runner."); }
  });
  assert.equal(second.status, "unchanged");
});

test("syncChanged finds a Program edit and updates its implementation", async (t) => {
  const implementation = "export function greet(name) { return `Hello, ${name}!`; }\n";
  const root = await createGitProject(t, {
    "program/src/greet.js.md": GREETING_PROGRAM,
    "src/greet.js": implementation
  }, { exports: "./src/greet.js" });
  await writeFiles(root, {
    "program/src/greet.js.md": GREETING_PROGRAM.replace("Hello, ", "Welcome, ")
  });
  const result = await syncChanged({
    projectRoot: root,
    runner: async ({ mode, workspaceRoot }) => {
      await writeWorkspace(workspaceRoot, "src/greet.js", implementation.replace("Hello, ", "Welcome, "));
      return report(mode);
    }
  });
  assert.equal(result.status, "updated");
  assert.equal(result.results.length, 1);
  assert.match(await fs.readFile(path.join(root, "src/greet.js"), "utf8"), /Welcome/u);
});

test("requires Git and rejects a module path through a symlink", async (t) => {
  const plain = await fs.mkdtemp(path.join(os.tmpdir(), "progsync-oracle-nongit-"));
  t.after(() => fs.rm(plain, { recursive: true, force: true }));
  await writeFiles(plain, { "program/src/greet.js.md": GREETING_PROGRAM });
  await assert.rejects(
    synchronizeFile({ inputPath: "program/src/greet.js.md", projectRoot: plain }),
    (error) => error.code === "GIT_REPOSITORY_REQUIRED"
  );

  const root = await createGitProject(t, {
    "src/real.js": "export function real() { return true; }\n"
  });
  await fs.symlink(path.join(root, "src/real.js"), path.join(root, "linked.js"));
  await assert.rejects(
    synchronizeFile({ inputPath: "linked.js", projectRoot: root }),
    (error) => error.code === "SYMLINKED_PROJECT_PATH"
  );
});

test("works when the explicit project root is a nested Git subtree", async (t) => {
  const repository = await createGitProject(t, {
    "tool/package.json": "{\n  \"name\": \"nested-tool\",\n  \"type\": \"module\",\n  \"exports\": \"./src/greet.js\"\n}\n",
    "tool/program/src/greet.js.md": GREETING_PROGRAM
  });
  const projectRoot = path.join(repository, "tool");
  const result = await synchronizeFile({
    inputPath: "program/src/greet.js.md",
    projectRoot,
    runner: async ({ mode, workspaceRoot }) => {
      await writeWorkspace(workspaceRoot, "src/greet.js", 'export { greet } from "./greet/private.js";\n');
      await writeWorkspace(workspaceRoot, "src/greet/private.js", "export function greet(name) { return `Hello, ${name}!`; }\n");
      return report(mode);
    }
  });
  assert.equal(result.status, "updated");
  assert.equal((await statusFile({ inputPath: "src/greet.js", projectRoot })).reconciled, true);

  await writeFiles(projectRoot, {
    "src/greet/private.js": "// Preserved nested-root refinement.\nexport function greet(name) { return `Hello, ${name}!`; }\n"
  });
  await synchronizeFile({
    inputPath: "src/greet.js",
    projectRoot,
    runner: async ({ mode }) => report(
      mode,
      "unchanged",
      "The private refinement does not change Program meaning."
    )
  });
  assert.equal((await statusFile({ inputPath: "src/greet.js", projectRoot })).reconciled, true);
});
