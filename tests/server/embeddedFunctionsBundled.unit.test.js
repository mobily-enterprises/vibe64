import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { webcrypto } from "node:crypto";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { MessageChannel } from "node:worker_threads";
import { Linter } from "eslint";
import { buildNodeBundle } from "../../tooling/release/server-build.mjs";
import { alternateVisualResource } from "../fixtures/trainingVisualFixture.js";

// The programs Vibe64 writes from functions of its own source, written by a bundle built as a release builds its
// server (buildNodeBundle: esbuild, minified), so the functions carry the bundle's names, not their own. The other
// tests run the source, where the names agree: the pages command passed them while every `vibe64-helper pages`
// command on a hosted workspace failed with "parsePagesArgs is not defined".
const run = promisify(execFile);
const sourceRoot = fileURLToPath(new URL("../../", import.meta.url));
const source = (file) => JSON.stringify(path.join(sourceRoot, file));
const ENTRY = `export { createAgentPagesCommandService, prepareAgentPagesCommand } from ${source("packages/vibe64-terminals/src/server/agentPagesCommand.js")};
export { agentPreviewBrowserWorkerSource } from ${source("packages/vibe64-execution/src/server/runtime/agentPreviewBrowserWorkerSource.js")};
export { createTrainingVisualPlayer } from ${source("packages/vibe64-training/src/client/visualPlayer.js")};
`;
// What a browser frame has that Node does not.
const BROWSER_GLOBALS = Object.freeze(["DOMParser", "document", "parent", "window"]);

let bundled = null;
after(async () => {
  if (bundled) await rm((await bundled).root, { recursive: true, force: true });
});

/** The bundle, built once for this file, in a folder that resolves the bundle's external packages from the source. */
function bundle() {
  bundled ||= (async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-embedded-functions-"));
    await symlink(path.join(sourceRoot, "node_modules"), path.join(root, "node_modules"));
    await writeFile(path.join(root, "entry.mjs"), ENTRY);
    const outfile = path.join(root, "bundle.mjs");
    await buildNodeBundle({ appRoot: sourceRoot, entryPoint: path.join(root, "entry.mjs"), outfile });
    return { root, module: await import(pathToFileURL(outfile).href), text: await readFile(outfile, "utf8") };
  })();
  return bundled;
}

async function pagesCommand(t) {
  const { module, root } = await bundle();
  const wrapperHostDir = await mkdtemp(path.join(root, "wrappers-"));
  const project = {
    readCurrentProject: async () => ({ slug: "demo", projectRoot: path.join(root, "project") }),
    runInProjectContext: (slug, operation) => operation(),
    createSessionStore: async () => ({ readConversationTail: async () => [] })
  };
  const pages = { listPages: async () => ({ pages: [] }) };
  const quiet = { debug() {}, info() {}, warn() {}, error() {} };
  const commandService = module.createAgentPagesCommandService({ logger: quiet, project, readPages: () => pages });
  const prepared = await module.prepareAgentPagesCommand({ commandService, sessionId: "session-1", wrapperHostDir });
  t.after(() => commandService.closeAllForSession("session-1"));
  const command = async (...args) => {
    try {
      const { stdout, stderr } = await run(process.execPath, [prepared.hostWrapperPath, ...args], { env: { ...process.env, ...prepared.env } });
      return { code: 0, stdout, stderr };
    } catch (error) {
      return { code: error.code, stdout: error.stdout, stderr: error.stderr };
    }
  };
  return { command, wrapper: await readFile(prepared.hostWrapperPath, "utf8") };
}

function visualFrameScript(module) {
  const view = { crypto: webcrypto, atob, btoa, MessageChannel, addEventListener() {}, removeEventListener() {} };
  const iframe = { ownerDocument: { defaultView: view }, srcdoc: "", setAttribute() {}, removeAttribute() {},
    contentWindow: { postMessage() {} } };
  const player = module.createTrainingVisualPlayer({ iframe, resource: alternateVisualResource(), attemptId: "attempt-one", onState() {} });
  const script = iframe.srcdoc.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/u)?.[1] || "";
  player.dispose();
  return script;
}

/** Each name a program reads that it neither declares nor finds among the platform's globals, and each syntax error. */
function undeclaredNames(program, { sourceType = "module", globals = [] } = {}) {
  const platform = Object.fromEntries([...Object.getOwnPropertyNames(globalThis), ...globals].map((name) => [name, "readonly"]));
  return new Linter().verify(program, {
    languageOptions: { ecmaVersion: "latest", sourceType, globals: platform },
    rules: { "no-undef": "error" }
  }).map((message) => `${message.line}:${message.column} ${message.message}`);
}

test("the minified release's pages command runs, reads its arguments and reaches the pages service", async (t) => {
  const { command } = await pagesCommand(t);
  const help = await command("--help");
  assert.equal(help.code, 0, help.stderr);
  assert.match(help.stdout, /vibe64-helper pages publish <file\.html \| folder>/u);
  const list = await command("list");
  assert.equal(list.code, 0, list.stderr);
  assert.equal(list.stdout, "This project has no pages yet.\n");
  const refused = await command("list", "--every");
  assert.equal(refused.code, 2, refused.stderr);
  assert.match(refused.stderr, /--every, --daily, --time-zone, --command, --prompt and --off go with refresh\./u);
});

test("every program the minified release writes from embedded functions declares each name it reads", async (t) => {
  const { module, text } = await bundle();
  assert.doesNotMatch(text, /\bfunction parsePagesArgs\(/u, "the bundle is minified, as a release's is");
  const programs = {
    "pages command": [(await pagesCommand(t)).wrapper],
    "preview browser worker": [module.agentPreviewBrowserWorkerSource({ playwrightModulePath: "/runtime/playwright/index.js" })],
    "diagram frame": [visualFrameScript(module), { sourceType: "script", globals: BROWSER_GLOBALS }]
  };
  const undeclared = Object.fromEntries(Object.entries(programs).map(([name, [program, options]]) => {
    assert.ok(program, `${name} was written`);
    return [name, undeclaredNames(program, options)];
  }));
  assert.deepEqual(undeclared, Object.fromEntries(Object.keys(programs).map((name) => [name, []])));
});
