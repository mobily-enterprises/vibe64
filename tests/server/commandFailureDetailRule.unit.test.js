import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Linter } from "eslint";

import {
  commandFailureMessage,
  commandFailureOutput
} from "../../packages/vibe64-core/src/server/commandFailureDetail.js";

// A failed command's error says why it failed. Since FINAL3 every managed browser run of whs2's test-data target
// failed with "Application preview identity command failed." while the command had printed its reason (its protocol
// answer's code and error) and exited 1: the identity command's runner dropped both, so neither the person nor the AI
// could see it. This reads every shipped source and refuses that shape: a `runCommand({ mode: "capture", ... })`
// whose result's failed `ok` check throws without the command's output (the result passed on, as to
// commandFailureMessage, or its stderr, stdout or output read). A site whose output must stay private says why with
// `command-failure-detail: allow <reason>` in its branch.
const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SOURCE_FOLDERS = Object.freeze(["bin", "packages", "server", "src", "tooling"]);
const SKIPPED_FOLDERS = new Set([".git", "dist", "fixtures", "node_modules", "test", "tests"]);
const SOURCE_FILE = /\.(?:c?js|mjs)$/u;
const TEST_FILE = /\.(?:test|spec|vitest)\.[cm]?js$/u;
const CAPTURE_MODE = /\bmode:\s*["']capture["']/u;
const OUTPUT_FIELDS = new Set(["output", "stderr", "stdout"]);
const ALLOW = "command-failure-detail: allow";

async function sourceFiles(folder) {
  const entries = await readdir(folder, { withFileTypes: true }).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(folder, entry.name);
    if (entry.isDirectory() && !SKIPPED_FOLDERS.has(entry.name)) files.push(...await sourceFiles(entryPath));
    if (entry.isFile() && SOURCE_FILE.test(entry.name) && !TEST_FILE.test(entry.name)) files.push(entryPath);
  }
  return files;
}

const FUNCTION_NODE = /^(?:ArrowFunctionExpression|FunctionDeclaration|FunctionExpression)$/u;

/** Whether the subtree throws, outside functions it declares. */
function throws(node) {
  if (!node || typeof node.type !== "string") return false;
  if (node.type === "ThrowStatement") return true;
  if (FUNCTION_NODE.test(node.type)) return false;
  return Object.entries(node).some(([key, value]) => key !== "parent" && (Array.isArray(value)
    ? value.some(throws)
    : value && typeof value === "object" && throws(value)));
}

const inside = (node, outer) => outer.range[0] <= node.range[0] && node.range[1] <= outer.range[1];

const captureFailureRule = {
  meta: { type: "problem", schema: [] },
  create(context) {
    const { sourceCode } = context;
    function resultVariable(call) {
      const awaited = call.parent?.type === "AwaitExpression" ? call.parent : call;
      const holder = awaited.parent;
      const name = holder?.type === "VariableDeclarator" && holder.init === awaited ? holder.id
        : holder?.type === "AssignmentExpression" && holder.right === awaited ? holder.left : null;
      if (name?.type !== "Identifier") return null;
      for (let scope = sourceCode.getScope(call); scope; scope = scope.upper) {
        const variable = scope.set.get(name.name);
        if (variable) return variable;
      }
      return null;
    }
    // The result passed on whole, or its output read: the branch can carry what the command said.
    function carriesOutput(variable, branch) {
      return variable.references.some(({ identifier }) => {
        if (!inside(identifier, branch)) return false;
        const { parent } = identifier;
        if (parent.type !== "MemberExpression" || parent.object !== identifier) return true;
        return !parent.computed && OUTPUT_FIELDS.has(parent.property.name);
      });
    }
    const allowed = (node) => sourceCode.getAllComments().some((comment) => comment.value.includes(ALLOW)
      && inside(comment, node));
    return {
      CallExpression(call) {
        const [request] = call.arguments;
        if (request?.type !== "ObjectExpression" || !request.properties.some((property) => property.type === "Property"
          && !property.computed && property.key.name === "mode" && property.value.value === "capture")) return;
        const variable = resultVariable(call);
        if (!variable) return;
        const reported = new Set();
        for (const { identifier } of variable.references) {
          const member = identifier.parent;
          if (member.type !== "MemberExpression" || member.object !== identifier || member.computed
            || member.property.name !== "ok") continue;
          let statement = member.parent;
          while (statement && statement.type !== "IfStatement" && !FUNCTION_NODE.test(statement.type)) {
            statement = statement.parent;
          }
          if (statement?.type !== "IfStatement" || !inside(member, statement.test) || reported.has(statement)) continue;
          for (const branch of [statement.consequent, statement.alternate].filter(Boolean)) {
            if (throws(branch) && !carriesOutput(variable, branch) && !allowed(branch)) {
              reported.add(statement);
              context.report({
                node: statement,
                message: "a failed capture throws without the command's output: use commandFailureMessage"
              });
            }
          }
        }
      }
    };
  }
};

const linter = new Linter();
const RULE_CONFIG = Object.freeze({
  languageOptions: { ecmaVersion: "latest", sourceType: "module" },
  linterOptions: { reportUnusedDisableDirectives: "off" },
  plugins: { capture: { rules: { "failure-detail": captureFailureRule } } },
  rules: { "capture/failure-detail": "error" }
});

function captureFailureProblems(text, file) {
  return linter.verify(text, RULE_CONFIG)
    .filter((message) => message.fatal || message.ruleId === "capture/failure-detail")
    .map((message) => `${file}:${message.line}: ${message.message}`);
}

test("every failed capture's error carries the command's own output", async () => {
  const files = (await Promise.all(SOURCE_FOLDERS.map((folder) => sourceFiles(path.join(REPO_ROOT, folder))))).flat();
  assert.ok(files.length > 500, `read ${files.length} source files`);
  const problems = [];
  let checked = 0;
  for (const file of files) {
    const text = await readFile(file, "utf8");
    if (!CAPTURE_MODE.test(text)) continue;
    checked += 1;
    problems.push(...captureFailureProblems(text, path.relative(REPO_ROOT, file).split(path.sep).join("/")));
  }
  assert.ok(checked > 20, `checked ${checked} files that capture a command`);
  assert.deepEqual(problems, []);
});

test("the rule refuses a failed capture's generic error and accepts one with the command's output", () => {
  const capture = "const result = await runCommand({ command: \"tool\", mode: \"capture\" });\n";
  const examples = [
    // The incident's shape, and the same with the exit code alone.
    [`${capture}if (result?.ok !== true) throw new Error("The tool failed.");`, 1],
    [`${capture}if (!result.ok) { throw new Error(\`The tool failed (\${result.exitCode}).\`); }`, 1],
    [`let result;\nresult = await runCommand({ mode: "capture" });\nif (result.ok === false) throw new Error(result.error);`, 1],
    // The command's output carried: passed on, or read.
    [`${capture}if (result?.ok !== true) throw new Error(commandFailureMessage("The tool failed.", result));`, 0],
    [`${capture}if (result?.ok !== true) throw new Error(result.stderr || "The tool failed.");`, 0],
    // A timeout's own message beside the detail, a failure that is not thrown, and a private output that says why.
    [`${capture}if (result?.ok !== true) {\n  if (result.timedOut) throw new Error("timed out");\n`
      + "  throw new Error(commandFailureMessage(\"failed\", result));\n}", 0],
    [`${capture}if (result?.ok !== true) return null;`, 0],
    [`${capture}if (result?.ok !== true) {\n  // ${ALLOW} its output carries tokens\n  throw new Error("failed");\n}`, 0],
    // Not a capture.
    ["const result = await runCommand({ mode: \"pty\" });\nif (!result.ok) throw new Error(\"failed\");", 0]
  ];
  for (const [text, count] of examples) {
    assert.equal(captureFailureProblems(`async function run() {\n${text}\n}`, "example.js").length, count, text);
  }
});

test("a failed command's detail is bounded plain text that never quotes a protocol answer whole", () => {
  assert.equal(commandFailureMessage("The tool failed.", { exitCode: 3, stderr: "", stdout: "" }),
    "The tool failed (exit status 3).");
  assert.equal(commandFailureMessage("The tool failed.", { exitCode: 1, signal: "SIGKILL", stderr: "killed" }),
    "The tool failed (ended by SIGKILL): killed");
  // A JSON answer without code or error is not quoted: its fields may hold the cookies it set.
  assert.equal(commandFailureOutput({ stdout: JSON.stringify({ ok: false, setCookie: ["app_session=private"] }) }), "");
  assert.equal(commandFailureOutput({
    outputEncoding: "base64",
    stderr: Buffer.from("Authorization: Bearer private-bearer-value\nfatal: no such ref").toString("base64")
  }), "Authorization: [redacted]\nfatal: no such ref");
  assert.ok(commandFailureOutput({ stderr: "x".repeat(5000) }).length <= 501);
});
