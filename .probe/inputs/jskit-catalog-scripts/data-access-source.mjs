import { blankJsComments, lineIndex } from "./material3-source.mjs";

// JavaScript source read as `jskit check`'s data part reads it, never run: the code with its comments blanked, a masked
// copy with the contents of its strings blanked too, every offset kept, and the object literals, keys and literal values
// found in them.

const blank = (text) => text.replace(/[^\n]/gu, " ");

// Code with its comments and the contents of its strings and templates blanked to spaces, every offset kept: calls
// and keys are found in it, values are read from the code at the same offsets.
function maskStrings(code) {
  let output = "";
  let index = 0;
  while (index < code.length) {
    const quote = code[index];
    if (quote !== "\"" && quote !== "'" && quote !== "`") {
      output += quote;
      index += 1;
      continue;
    }
    let end = index + 1;
    while (end < code.length && code[end] !== quote && (quote === "`" || code[end] !== "\n")) {
      end += code[end] === "\\" ? 2 : 1;
    }
    output += quote + blank(code.slice(index + 1, end)) + code.slice(end, end + 1);
    index = end + 1;
  }
  return output;
}

// The offset just past the bracket that closes the one at `start`, in masked code; -1 when it never closes.
function closingOffset(masked, start) {
  let depth = 0;
  for (let index = start; index < masked.length; index += 1) {
    if ("([{".includes(masked[index])) depth += 1;
    else if (")]}".includes(masked[index]) && --depth === 0) return index + 1;
  }
  return -1;
}

const nextCodeOffset = (text, offset) => offset + (/^\s*/u.exec(text.slice(offset))?.[0].length || 0);

// The string a top-level `const NAME = "..."` gives, or null.
function constantValue(code, name) {
  const match = new RegExp(`(?:^|[\\s;])const\\s+${name}\\s*=\\s*(["'\`])((?:\\\\.|(?!\\1)[^\\\\\\n])*)\\1\\s*[;,\\n]`, "u").exec(code);
  return match && !(match[1] === "`" && match[2].includes("${")) ? match[2] : null;
}

/**
 * The value written at an offset, read up to the comma or bracket that ends it: { text } for a string literal, a
 * template without expressions, or a const holding one; { text: null } for anything else.
 */
function readValue(code, masked, offset) {
  const start = nextCodeOffset(code, offset);
  const quote = code[start];
  if (quote === "\"" || quote === "'" || quote === "`") {
    let end = start + 1;
    while (end < code.length && code[end] !== quote) end += code[end] === "\\" ? 2 : 1;
    const after = masked[nextCodeOffset(masked, end + 1)];
    const text = code.slice(start + 1, end);
    const whole = after === "," || after === "}" || after === ")";
    return { text: whole && !(quote === "`" && text.includes("${")) ? text.replace(/\\(.)/gu, "$1") : null };
  }
  const identifier = /^[A-Za-z_$][\w$]*(?=\s*[,})])/u.exec(code.slice(start));
  return { text: identifier ? constantValue(code, identifier[0]) : null };
}

// The top-level keys of the object literal between `start` and `end`, in masked code: for each wanted key, the offset
// just past its colon, or "shorthand" for `{ name }`.
function topLevelKeys(masked, start, end, names) {
  let depth = 0;
  let top = "";
  for (let index = start; index < end; index += 1) {
    const char = masked[index];
    if ("([{".includes(char)) depth += 1;
    top += depth === 1 || char === "\n" ? char : " ";
    if (")]}".includes(char)) depth -= 1;
  }
  const keys = new Map();
  for (const match of top.matchAll(/(?:^|[{,])\s*([A-Za-z_$][\w$]*)\s*(:|(?=[,}]))/gu)) {
    const [whole, key, colon] = match;
    if (names.includes(key) && !keys.has(key)) keys.set(key, colon ? start + match.index + whole.length : "shorthand");
  }
  return keys;
}

// The object literal a call at `callOffset` takes as its first argument: { start, end } in masked code, or null when the
// call is a declaration (`function defineFeature(`) or its first argument is anything else.
function objectArgument(masked, callOffset, matchLength) {
  if (/function\s*\*?\s*$/u.test(masked.slice(Math.max(0, callOffset - 20), callOffset))) return null;
  const start = nextCodeOffset(masked, callOffset + matchLength);
  if (masked[start] !== "{") return null;
  const end = closingOffset(masked, start);
  return end < 0 ? null : { start, end };
}

// The value of one key of an object literal, as readValue reads it; undefined when the object has no such key.
function keyValue(code, masked, keys, key) {
  const at = keys.get(key);
  if (at === undefined) return undefined;
  return at === "shorthand" ? { text: constantValue(code, key) } : readValue(code, masked, at);
}

function readSourceFile(source) {
  const code = blankJsComments(source);
  return { source, code, masked: maskStrings(code), position: lineIndex(source) };
}

// Every key of the object literal between `start` and `end` (masked code), in order, and whether the literal also
// spreads or computes keys, so that its keys are not all known.
function objectKeys(masked, start, end) {
  let depth = 0;
  let top = "";
  for (let index = start; index < end; index += 1) {
    const char = masked[index];
    if ("([{".includes(char)) depth += 1;
    top += depth === 1 || char === "\n" ? char : " ";
    if (")]}".includes(char)) depth -= 1;
  }
  const keys = [...top.matchAll(/(?:^|[{,])\s*([A-Za-z_$][\w$]*)\s*(?::|(?=[,}]))/gu)].map((match) => ({
    key: match[1],
    at: start + match.index + match[0].length
  }));
  return { keys, partial: /(?:^|[{,])\s*(?:\.\.\.|["'`[])/u.test(top) };
}

// The object literal written at an offset: { start, end } in masked code, or null for anything else.
function objectAt(masked, offset) {
  const start = nextCodeOffset(masked, offset);
  if (masked[start] !== "{") return null;
  const end = closingOffset(masked, start);
  return end < 0 ? null : { start, end };
}

// The variable a declaration just before an offset assigns: `const name = ` ends the text before it.
const assignedVariable = (masked, offset) =>
  /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*$/u.exec(masked.slice(Math.max(0, offset - 120), offset))?.[1] ?? null;

// The identifier written at an offset, or null.
const identifierAt = (code, offset) => /^\s*([A-Za-z_$][\w$]*)\s*[,})]/u.exec(code.slice(offset))?.[1] ?? null;

// The object literal around an offset, in masked code: { start, end }, or null when the offset is in none.
function enclosingObject(masked, offset) {
  let depth = 0;
  for (let index = offset - 1; index >= 0; index -= 1) {
    if (")]}".includes(masked[index])) depth += 1;
    else if ("([{".includes(masked[index]) && depth-- === 0) {
      const end = masked[index] === "{" ? closingOffset(masked, index) : -1;
      return end < 0 ? null : { start: index, end };
    }
  }
  return null;
}

export {
  assignedVariable,
  blank,
  closingOffset,
  enclosingObject,
  identifierAt,
  keyValue,
  nextCodeOffset,
  objectArgument,
  objectAt,
  objectKeys,
  readSourceFile,
  readValue,
  topLevelKeys
};
