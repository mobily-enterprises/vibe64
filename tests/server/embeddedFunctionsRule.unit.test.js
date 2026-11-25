import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Linter } from "eslint";

// A program Vibe64 writes carries a function of its own source in one way: embeddedFunctions
// (packages/vibe64-execution/src/shared/embeddedFunctions.js), which binds the function's text to the name the
// program calls it by. The pages command once pasted `${parsePagesArgs.toString()}` and called parsePagesArgs: the
// minified release renamed the function, and every `vibe64-helper pages` command failed with "parsePagesArgs is not
// defined" while the tests, which run the source, passed. This reads every shipped source and refuses a function's
// text taken any other way: its toString(), String(), a template or a concatenation of it, or
// Function.prototype.toString.
const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SOURCE_FOLDERS = Object.freeze(["bin", "packages", "server", "src", "tooling"]);
const SKIPPED_FOLDERS = new Set([".git", "dist", "fixtures", "node_modules", "test", "tests"]);
const SOURCE_FILE = /\.(?:c?js|mjs|vue)$/u;
const TEST_FILE = /\.(?:test|spec|vitest)\.[cm]?js$/u;
const MECHANISM = "packages/vibe64-execution/src/shared/embeddedFunctions.js";

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

/** The JavaScript of a file: a Vue component's script blocks, other files whole. */
function scripts(file, text) {
  if (!file.endsWith(".vue")) return [text];
  return [...text.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gu)]
    .filter(([, attributes]) => !/\blang=["']ts["']/u.test(attributes))
    .map(([, , script]) => script);
}

const FUNCTION_VALUE = /^(?:ArrowFunctionExpression|FunctionExpression)$/u;

const functionTextRule = {
  meta: { type: "problem", schema: [] },
  create(context) {
    const { sourceCode } = context;
    function variableOf(node) {
      for (let scope = sourceCode.getScope(node); scope; scope = scope.upper) {
        const variable = scope.set.get(node.name);
        if (variable) return variable;
      }
      return null;
    }
    // Whether the name is bound to a function: declared here, or (for toString(), which nothing else in an
    // imported binding answers without arguments) imported.
    function namesFunction(node, { imported = false } = {}) {
      if (node?.type !== "Identifier") return false;
      const definition = variableOf(node)?.defs.at(-1);
      if (definition?.type === "FunctionName") return true;
      if (definition?.type === "ImportBinding") return imported;
      if (definition?.type === "Variable") return FUNCTION_VALUE.test(definition.node.init?.type || "");
      // A callback's parameter over a list of functions: [first, second].map((helper) => helper.toString()).
      if (definition?.type === "Parameter") {
        const call = definition.node.parent;
        return call?.type === "CallExpression" && call.arguments.includes(definition.node)
          && call.callee.type === "MemberExpression" && call.callee.object.type === "ArrayExpression"
          && call.callee.object.elements.some((element) => namesFunction(element, { imported: true }));
      }
      return false;
    }
    const refuse = (node, name) => context.report({ node, message: `takes ${name}'s text; embed it with embeddedFunctions` });
    return {
      CallExpression(node) {
        const { callee } = node;
        if (callee.type === "MemberExpression" && !callee.computed && callee.property.name === "toString"
          && node.arguments.length === 0 && namesFunction(callee.object, { imported: true })) {
          refuse(node, callee.object.name);
        }
        if (callee.type === "Identifier" && callee.name === "String" && namesFunction(node.arguments[0])) {
          refuse(node, node.arguments[0].name);
        }
      },
      TemplateLiteral(node) {
        for (const expression of node.expressions) {
          if (namesFunction(expression)) refuse(expression, expression.name);
        }
      },
      BinaryExpression(node) {
        if (node.operator !== "+") return;
        for (const [side, other] of [[node.left, node.right], [node.right, node.left]]) {
          if (namesFunction(side) && (other.type === "TemplateLiteral" || typeof other.value === "string")) refuse(side, side.name);
        }
      },
      MemberExpression(node) {
        if (!node.computed && node.property.name === "toString" && node.object.type === "MemberExpression"
          && node.object.object.type === "Identifier" && node.object.object.name === "Function"
          && node.object.property.name === "prototype") {
          refuse(node, "a function");
        }
      }
    };
  }
};

// Only a file that names toString, or puts a function it declares in a template, String() or a concatenation, can
// take a function's text: the rule parses those, not every file.
const DECLARED_FUNCTION = /\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)|\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\b\s*)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/gu;
function mayTakeFunctionText(text) {
  if (text.includes("toString")) return true;
  const names = new Set([...text.matchAll(DECLARED_FUNCTION)].map((match) => match[1] || match[2]));
  return [...names].some((name) => {
    const escaped = name.replaceAll("$", "\\$");
    return new RegExp(`\\$\\{\\s*${escaped}\\s*\\}|String\\(\\s*${escaped}\\s*\\)|${escaped}\\s*\\+|\\+\\s*${escaped}`, "u").test(text);
  });
}

const linter = new Linter();
const RULE_CONFIG = Object.freeze({
  linterOptions: { reportUnusedDisableDirectives: "off" },
  plugins: { embedded: { rules: { "function-text": functionTextRule } } },
  rules: { "embedded/function-text": "error" }
});

function functionTextProblems(text, file) {
  const sourceTypes = file.endsWith(".cjs") ? ["commonjs"] : ["module", "script"];
  let messages = [];
  for (const sourceType of sourceTypes) {
    messages = linter.verify(text, { ...RULE_CONFIG, languageOptions: { ecmaVersion: "latest", sourceType } });
    if (!messages.some((message) => message.fatal)) break;
  }
  return messages.filter((message) => message.fatal || message.ruleId === "embedded/function-text")
    .map((message) => `${file}:${message.line}: ${message.message}`);
}

test("a function's text reaches a written program only through embeddedFunctions", async () => {
  const files = (await Promise.all(SOURCE_FOLDERS.map((folder) => sourceFiles(path.join(REPO_ROOT, folder))))).flat();
  assert.ok(files.length > 500, `read ${files.length} source files`);
  const problems = [];
  for (const file of files) {
    const relative = path.relative(REPO_ROOT, file).split(path.sep).join("/");
    if (relative === MECHANISM) continue;
    const text = await readFile(file, "utf8");
    if (!mayTakeFunctionText(text)) continue;
    for (const script of scripts(file, text)) problems.push(...functionTextProblems(script, relative));
  }
  assert.deepEqual(problems, []);
});

test("the rule finds each way of taking a function's text", () => {
  const examples = [
    ["function parse() {}\nconst wrapper = `${parse.toString()}\\nparse(args);`;", 1],
    ["import { parse } from \"./parse.js\";\nconst wrapper = `${parse.toString()}`;", 1],
    ["const parse = (args) => args;\nconst wrapper = `${parse}` + String(parse) + (parse + \"\");", 3],
    ["function a() {}\nfunction b() {}\nconst text = [a, b].map((helper) => helper.toString()).join(\"\\n\");", 1],
    ["const text = Function.prototype.toString.call(globalThis.parse);", 1],
    // Not a function's text: a URL, search parameters, a number, a string constant and an imported constant.
    ["import { NAME } from \"./name.js\";\nconst url = new URL(\"https://example.test\");\nconst params = new URLSearchParams();\n"
      + "const text = `${url.toString()}?${params.toString()}${(12).toString(16)}${NAME}${String(NAME)}`;", 0]
  ];
  for (const [text, count] of examples) {
    assert.equal(mayTakeFunctionText(text), true, text);
    assert.equal(functionTextProblems(text, "example.js").length, count, text);
  }
  assert.equal(mayTakeFunctionText("const name = \"page\";\nconst label = `${name} ` + name;"), false);
});
