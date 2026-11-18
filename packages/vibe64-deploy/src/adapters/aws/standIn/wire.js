// The stand-in's wire: a refusal as AWS gives one, and the Query protocol's form read into plain values. A Query form
// numbers a list's items from 1 (`Filter.1.Name`, `Tags.member.1.Key`); `unflatten` makes those objects keyed "1",
// "2" ..., and `listOf` reads one back as an array in order.

/** A refusal: the HTTP status, AWS's error code and its message. */
class Fault extends Error {
  /** @param {number} status @param {string} code @param {string} message */
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const fault = (status, code, message) => new Fault(status, code, message);

/** A form's pairs as nested plain values: `A.1.B=x` is `{ A: { 1: { B: "x" } } }`. @param {Iterable<[string, string]>} pairs */
function unflatten(pairs) {
  const root = {};
  for (const [key, value] of pairs) {
    const parts = key.split(".");
    let node = root;
    for (const part of parts.slice(0, -1)) {
      if (typeof node[part] !== "object") node[part] = {};
      node = node[part];
    }
    node[parts.at(-1)] = value;
  }
  return root;
}

/** A numbered list of a form (under its member element, when it has one) as an array in order. */
function listOf(node, member) {
  const items = member ? node?.[member] : node;
  if (!items || typeof items !== "object") return [];
  return Object.keys(items).filter((key) => /^\d+$/u.test(key)).sort((one, other) => Number(one) - Number(other)).map((key) => items[key]);
}

/** Tags of a form's numbered list of { Key, Value } as a plain object. */
function tagsOfList(items) {
  return Object.fromEntries(items.map((tag) => [tag.Key, tag.Value ?? ""]));
}

/** A required parameter, or the refusal AWS gives without it. */
function required(params, name) {
  const value = params?.[name];
  if (value === undefined || value === null || value === "") throw fault(400, "ValidationError", `The parameter ${name} is required.`);
  return value;
}

/** Whether text matches an IAM ARN pattern with * and ? wildcards. @param {string} pattern @param {string} text */
function matchesPattern(pattern, text) {
  const source = String(pattern).replace(/[.+^${}()|[\]\\]/gu, "\\$&").replace(/\*/gu, ".*").replace(/\?/gu, ".");
  return new RegExp(`^${source}$`, "u").test(text);
}

export { Fault, fault, listOf, matchesPattern, required, tagsOfList, unflatten };
