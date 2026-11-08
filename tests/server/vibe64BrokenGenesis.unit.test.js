import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { createVibe64HostContextRegistry } from "../../packages/vibe64-genesis/src/server/hostContextRegistry.js";
import {
  genesisCommandShimDirectory,
  initializeGenesisProject,
  vibe64ConversationInstructions,
  vibe64Driver,
  vibe64HostContextResolverPath
} from "../../packages/vibe64-genesis/src/server/index.js";
import { withTemporaryRoot } from "./vibe64TestHelpers.js";

// Nothing Genesis does on a person's path stops it: each test breaks Genesis
// in one way and checks that the conversation still gets what it needs.

const execFileAsync = promisify(execFile);
const boundary = new URL("../../packages/vibe64-genesis/src/server/index.js", import.meta.url).href;
const UNAVAILABLE = /^Genesis project guidance is unavailable for this conversation \(/u;
const PROMPT_CONTEXT = Object.freeze({
  conversationKind: "main",
  scope: "session",
  session: { managedDatabaseRefresh: true, managedEnvironment: true, managedGit: true, managedPreview: true }
});

async function initializedProject(root) {
  const projectRoot = path.join(root, "project");
  await execFileAsync("git", ["init", "--initial-branch=main", projectRoot]);
  await initializeGenesisProject({ projectRoot });
  return projectRoot;
}

// A Genesis whose prompt and session-guidance operations fail as BROKEN_GENESIS says, for every
// module that imports Genesis; everything else is the installed Genesis.
async function brokenGenesisLoader(root) {
  const stub = pathToFileURL(path.join(root, "broken-genesis.mjs")).href;
  await writeFile(new URL(stub), `export * from "genesis-compiler";
function broken() {
  const mode = process.env.BROKEN_GENESIS;
  if (mode === "throw") throw new TypeError("Cannot read properties of undefined (reading 'sections')");
  if (mode === "hang") return new Promise(() => {});
  return { contract: 7, output: ["not", "text"], prompt: { not: "text" }, task: 42 };
}
export const generatePrompt = broken;
export const projectSessionContext = broken;
`);
  const loader = path.join(root, "broken-genesis-loader.mjs");
  await writeFile(loader, `import { registerHooks } from "node:module";
registerHooks({ resolve(specifier, context, next) {
  if (specifier !== "genesis-compiler") return next(specifier, context);
  if (context.parentURL === ${JSON.stringify(stub)}) return next(specifier, { ...context, parentURL: ${JSON.stringify(boundary)} });
  return { url: ${JSON.stringify(stub)}, shortCircuit: true };
} });
`);
  return loader;
}

async function noCompilerLoader(root) {
  const loader = path.join(root, "no-compiler.mjs");
  await writeFile(loader, `import { registerHooks } from "node:module";
registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith("genesis-compiler")) throw new Error("Genesis cannot be loaded.");
  return next(specifier, context);
} });
`);
  return loader;
}

for (const mode of ["throw", "hang", "garbage"]) {
  test(`a Genesis that ${mode === "throw" ? "throws" : mode === "hang" ? "never answers" : "returns garbage"} sends the message with Vibe64's guidance`, {
    skip: process.platform === "win32"
  }, async () => {
    await withTemporaryRoot(async (root) => {
      const projectRoot = await initializedProject(root);
      const loader = await brokenGenesisLoader(root);
      const { stdout } = await execFileAsync(process.execPath, ["--import", loader, "--input-type=module", "-e", `
        import assert from "node:assert/strict";
        import { renderGenesisPrompt, vibe64ConversationInstructions } from ${JSON.stringify(boundary)};
        const projectRoot = ${JSON.stringify(projectRoot)};
        const unavailable = [];
        const onGenesisUnavailable = (error) => unavailable.push(error.code || error.message);
        const started = Date.now();
        const request = "Why does the project not start?";
        const rendered = await renderGenesisPrompt({ environment: process.env, input: { conversationRequest: request },
          onGenesisUnavailable, projectRoot, timeoutMs: 200 });
        assert.deepEqual(rendered, { prompt: request });
        const instructions = await vibe64ConversationInstructions({ workdir: projectRoot,
          promptContext: ${JSON.stringify(PROMPT_CONTEXT)} }, { onGenesisUnavailable, timeoutMs: 200 });
        process.stdout.write(JSON.stringify({ elapsedMs: Date.now() - started, instructions, unavailable }));
        process.exit(0);
      `], { env: { ...process.env, BROKEN_GENESIS: mode }, timeout: 20_000 });
      const { elapsedMs, instructions, unavailable } = JSON.parse(stdout);
      assert.match(instructions, UNAVAILABLE);
      assert.ok(instructions.endsWith(`\n\n${vibe64Driver(PROMPT_CONTEXT)}`), "the conversation keeps Vibe64's own guidance");
      assert.deepEqual(unavailable, {
        garbage: ["Genesis returned no prompt.", "Genesis returned no session guidance."],
        hang: ["vibe64_genesis_timeout", "vibe64_genesis_timeout"],
        throw: [
          "Cannot read properties of undefined (reading 'sections')",
          "Cannot read properties of undefined (reading 'sections')"
        ]
      }[mode]);
      assert.ok(elapsedMs < 5_000, `the message waited ${elapsedMs} ms for Genesis`);
    });
  });
}

test("a session Genesis cannot read keeps Vibe64's guidance with a note", async () => {
  await withTemporaryRoot(async (root) => {
    const reasons = [];
    const instructions = await vibe64ConversationInstructions({ workdir: path.join(root, "missing"), promptContext: PROMPT_CONTEXT },
      { onGenesisUnavailable: (error) => reasons.push(error) });
    assert.match(instructions, UNAVAILABLE);
    assert.ok(instructions.endsWith(`\n\n${vibe64Driver(PROMPT_CONTEXT)}`));
    assert.equal(reasons.length, 1);
  });
});

test("a registered conversation's session hook answers without Genesis", {
  skip: process.platform === "win32"
}, async () => {
  await withTemporaryRoot(async (root) => {
    const projectRoot = await initializedProject(root);
    const registry = await createVibe64HostContextRegistry();
    try {
      await registry.register("provider-session", PROMPT_CONTEXT, projectRoot);
      const result = await execFileAsync(process.execPath, [
        "--import", await noCompilerLoader(root), path.join(genesisCommandShimDirectory(), "genesis"), "hook", "session"
      ], { cwd: projectRoot, env: { ...process.env,
        GENESIS_HOST_CONTEXT_INPUT: JSON.stringify({ session_id: "provider-session" }),
        GENESIS_HOST_CONTEXT_RESOLVER: vibe64HostContextResolverPath(),
        GENESIS_HOST_CONTEXT_RESOLVER_DATA: JSON.stringify({ registryPath: registry.registryPath })
      } });
      assert.deepEqual([result.stdout, result.stderr], ["", ""]);
    } finally { await registry.close(); }
  });
});

test("a Genesis hook that cannot load Genesis exits cleanly so the conversation goes on", {
  skip: process.platform === "win32"
}, async () => {
  await withTemporaryRoot(async (root) => {
    const projectRoot = await initializedProject(root);
    const result = await execFileAsync(process.execPath, [
      "--import", await noCompilerLoader(root), path.join(genesisCommandShimDirectory(), "genesis"),
      "hook", "turn", "--project-root", projectRoot
    ], { cwd: projectRoot, env: { ...process.env,
      GENESIS_HOST_CONTEXT_INPUT: JSON.stringify({ sessionId: "unregistered" }),
      GENESIS_HOST_CONTEXT_RESOLVER_DATA: "",
      GENESIS_TURN_CONTEXT_ENABLED: "1"
    } });
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /Genesis cannot be loaded\.[\s\S]*The Genesis hook failed \(exit 1\); the conversation continues without its guidance\./u);
  });
});
