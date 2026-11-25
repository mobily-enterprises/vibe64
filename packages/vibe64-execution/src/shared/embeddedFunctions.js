// The one way a program Vibe64 writes (a helper command, the preview browser's worker, a diagram's frame) carries a
// function from Vibe64's own source: its text, bound to the name the program calls it by.
//
// A release bundle minifies Vibe64's server and client: parsePagesArgs's text there reads `function Z4t(e){…}`, so a
// program that pastes that text and then calls parsePagesArgs finds no such name. Each function arrives here as
// `const <name> = <its text>;`, under the name given (write `{ parsePagesArgs }`), whatever the bundle named it.
// An embedded function uses nothing but its arguments and the language's and platform's globals: never another
// function, constant or import of its module, which the program does not have under any name.
// tests/server/embeddedFunctionsBundled.unit.test.js checks every such program in a minified bundle, and
// tests/server/embeddedFunctionsRule.unit.test.js refuses a function's text taken any other way.

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/u;
// A function whose text is an expression: a function or an arrow function, async or not. A method's text
// (`name() {…}`) is not one.
const FUNCTION_EXPRESSION_TEXT = /^(?:async\s*)?(?:function\b|\(|[A-Za-z_$][A-Za-z0-9_$]*\s*=>)/u;

/**
 * Program text declaring each function under its name.
 * @param {Record<string, Function>} functions the name the program calls each function by, and the function
 * @returns {string} one `const` line per function, each ending in a newline
 */
function embeddedFunctions(functions = {}) {
  return Object.entries(functions).map(([name, fn]) => {
    if (!IDENTIFIER.test(name)) {
      throw new TypeError(`An embedded function needs a name a program can call: ${JSON.stringify(name)}.`);
    }
    const text = typeof fn === "function" ? Function.prototype.toString.call(fn) : "";
    if (!FUNCTION_EXPRESSION_TEXT.test(text)) {
      throw new TypeError(`${name} cannot be embedded: only a function or an arrow function's text can be.`);
    }
    return `const ${name} = ${text};\n`;
  }).join("");
}

export { embeddedFunctions };
