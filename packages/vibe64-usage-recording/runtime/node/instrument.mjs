// Inserts one counter call at the start of every function body of a project
// file, and one at the start of its top-level code, without adding a line:
// line numbers in stack traces stay the same. The top-level code is the file's
// module function: name "", from 1:1 to the end of its last non-blank line.
// Positions follow the Genesis rule: the start of the tree-sitter function node
// (decorators excluded), 1-based line and column; the end is the column just
// after the function's last character.

const FUNCTION_TYPES = new Set([
  "ArrowFunctionExpression",
  "ClassMethod",
  "ClassPrivateMethod",
  "FunctionDeclaration",
  "FunctionExpression",
  "ObjectMethod"
]);
const SKIPPED_KEYS = new Set(["loc", "start", "end", "extra", "leadingComments", "trailingComments", "innerComments", "range"]);
const HIT = "__vibe64UsageHit";

function keyName(key, computed) {
  if (!key || computed) return "";
  if (key.type === "Identifier") return key.name;
  if (key.type === "StringLiteral") return key.value;
  if (key.type === "NumericLiteral") return String(key.value);
  if (key.type === "PrivateName") return `#${key.id?.name || ""}`;
  return "";
}

function functionName(node, parent) {
  if (node.id?.name) return node.id.name;
  if (node.type === "ObjectMethod" || node.type === "ClassMethod" || node.type === "ClassPrivateMethod") {
    return keyName(node.key, node.computed);
  }
  if (!parent) return "";
  if (parent.type === "VariableDeclarator" && parent.id?.type === "Identifier") return parent.id.name;
  if (["ObjectProperty", "ClassProperty", "ClassPrivateProperty", "ClassAccessorProperty"].includes(parent.type) && parent.value === node) {
    return keyName(parent.key, parent.computed);
  }
  return "";
}

function lineStarts(source) {
  const starts = [0];
  for (let index = source.indexOf("\n"); index !== -1; index = source.indexOf("\n", index + 1)) starts.push(index + 1);
  return starts;
}

function pointAt(starts, offset) {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (starts[middle] <= offset) low = middle;
    else high = middle - 1;
  }
  return { line: low + 1, column: offset - starts[low] + 1 };
}

// The first token after a function's decorators: whitespace and comments skipped.
function afterDecorators(source, offset) {
  let index = offset;
  for (;;) {
    while (index < source.length && /\s/u.test(source[index])) index += 1;
    if (source.startsWith("//", index)) {
      const end = source.indexOf("\n", index);
      index = end === -1 ? source.length : end + 1;
    } else if (source.startsWith("/*", index)) {
      const end = source.indexOf("*/", index + 2);
      index = end === -1 ? source.length : end + 2;
    } else {
      return index;
    }
  }
}

function parseOptions({ typescript, commonjs }) {
  return {
    sourceType: commonjs ? "script" : "module",
    allowReturnOutsideFunction: commonjs,
    errorRecovery: false,
    plugins: typescript ? ["typescript", "decorators"] : ["decorators"]
  };
}

// The file's own counter call: after a hashbang line and after its directives.
function moduleInsert(source, program, starts, call) {
  const last = program.directives?.at(-1);
  if (last) return [last.end, source[last.end - 1] === ";" ? `${call};` : `;${call};`];
  if (!program.interpreter) return [0, `${call};`];
  return starts.length > 1 ? [starts[1], `${call};`] : [source.length, `\n${call};`];
}

// instrumentSource(source, { parse, typescript, commonjs, nextFunctionIndex })
//   → { code, functions: [{ functionIndex, name, start, end }] }, the module
//     function first
// parse is @babel/parser's parse; it throws on a syntax error, which the caller
// reports as a diagnostic and loads the file unchanged.
function instrumentSource(source, { parse, typescript = false, commonjs = false, nextFunctionIndex = 0 } = {}) {
  const ast = parse(source, parseOptions({ typescript, commonjs }));
  const starts = lineStarts(source);
  const functions = [{
    functionIndex: nextFunctionIndex,
    name: "",
    start: { line: 1, column: 1 },
    end: pointAt(starts, source.trimEnd().length)
  }];
  const inserts = [moduleInsert(source, ast.program, starts, `${HIT}(${nextFunctionIndex})`)];
  const stack = [[ast.program, null]];
  while (stack.length > 0) {
    const [node, parent] = stack.pop();
    if (FUNCTION_TYPES.has(node.type) && node.body) {
      const functionIndex = nextFunctionIndex + functions.length;
      const decorators = Array.isArray(node.decorators) ? node.decorators : [];
      const startOffset = decorators.length > 0
        ? afterDecorators(source, Math.max(...decorators.map((decorator) => decorator.end)))
        : node.start;
      functions.push({
        functionIndex,
        name: functionName(node, parent),
        start: pointAt(starts, startOffset),
        end: { line: node.loc.end.line, column: node.loc.end.column + 1 }
      });
      const call = `${HIT}(${functionIndex})`;
      if (node.body.type === "BlockStatement") {
        const directives = node.body.directives || [];
        const last = directives.at(-1);
        if (last) inserts.push([last.end, source[last.end - 1] === ";" ? `${call};` : `;${call};`]);
        else inserts.push([node.body.start + 1, `${call};`]);
      } else {
        inserts.push([node.body.start, `(${call}, `]);
        inserts.push([node.body.end, ")"]);
      }
    }
    for (const key of Object.keys(node)) {
      if (SKIPPED_KEYS.has(key)) continue;
      const value = node[key];
      if (Array.isArray(value)) {
        for (let index = value.length - 1; index >= 0; index -= 1) {
          const child = value[index];
          if (child && typeof child.type === "string") stack.push([child, node]);
        }
      } else if (value && typeof value.type === "string") {
        stack.push([value, node]);
      }
    }
  }
  functions.sort((left, right) => left.functionIndex - right.functionIndex);
  inserts.sort((left, right) => left[0] - right[0]);
  const parts = [];
  let cursor = 0;
  for (const [offset, text] of inserts) {
    parts.push(source.slice(cursor, offset), text);
    cursor = offset;
  }
  parts.push(source.slice(cursor));
  return { code: parts.join(""), functions };
}

export { instrumentSource };
