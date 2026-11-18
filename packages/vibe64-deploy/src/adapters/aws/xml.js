// The little XML the AWS adapter reads and its stand-in writes: AWS's Query services (EC2, Auto Scaling, Elastic Load
// Balancing, RDS, IAM) and S3 answer in XML. `parseXml` turns a document into plain values: an element with child
// elements is an object of them by name (a name repeated becomes an array), any other its text, with XML's entities
// decoded; attributes are dropped. `asList` reads a list however many members it had. `xmlOf` writes the other way.

const ENTITIES = Object.freeze({ amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'" });

/** Text with XML's entities decoded. @param {string} text */
function decodeText(text) {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/gu, (whole, name) => {
    if (name.startsWith("#x")) return String.fromCodePoint(Number.parseInt(name.slice(2), 16));
    if (name.startsWith("#")) return String.fromCodePoint(Number.parseInt(name.slice(1), 10));
    return ENTITIES[name] ?? whole;
  });
}

/** Text with &, <, > and quotes escaped. @param {unknown} value */
function escapeText(value) {
  return String(value).replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;").replace(/"/gu, "&quot;");
}

/**
 * A document's root element: `{ name, value }`.
 * @param {string} text
 * @returns {{ name: string, value: any }}
 */
function parseXml(text) {
  const tokens = /<\?[^>]*\?>|<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[^\s=>/]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/gu;
  const stack = [{ name: "", children: [], text: "" }];
  for (const match of String(text).matchAll(tokens)) {
    const [whole, cdata, closing, name, , selfClosing, chars] = match;
    const top = stack.at(-1);
    if (chars !== undefined) top.text += decodeText(chars);
    else if (cdata !== undefined) top.text += cdata;
    else if (whole.startsWith("<?") || whole.startsWith("<!--")) continue;
    else if (closing) {
      const done = stack.pop();
      if (done.name !== name) throw new SyntaxError(`XML: </${name}> closes <${done.name}>.`);
      stack.at(-1).children.push(done);
    } else {
      const element = { name, children: [], text: "" };
      if (selfClosing) top.children.push(element);
      else stack.push(element);
    }
  }
  if (stack.length !== 1 || stack[0].children.length !== 1) throw new SyntaxError("XML: not one root element.");
  // An element's value: its text when it has no child elements (whitespace alone is ""), else its children by name.
  const valueOf = (element) => {
    if (element.children.length === 0) return element.text.trim() === "" ? "" : element.text;
    const byName = new Map();
    for (const child of element.children) byName.set(child.name, [...(byName.get(child.name) ?? []), valueOf(child)]);
    return Object.fromEntries([...byName].map(([name, values]) => [name, values.length === 1 ? values[0] : values]));
  };
  const root = stack[0].children[0];
  return { name: root.name, value: valueOf(root) };
}

/** A list however the XML gave it: none, one or several members. @param {unknown} value */
function asList(value) {
  if (value === undefined || value === null || value === "") return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * An element of these children: an object's keys are its elements in order, an array repeats its element (or, under
 * `member`, writes each as that element), any other value is text. Undefined values are left out.
 * @param {string} name @param {unknown} value @param {string} [attributes] such as ` xmlns="..."`
 */
function xmlOf(name, value, attributes = "") {
  if (value === undefined) return "";
  if (Array.isArray(value)) return value.map((one) => xmlOf(name, one)).join("");
  if (value && typeof value === "object") {
    const inner = Object.entries(value).map(([key, child]) => xmlOf(key, child)).join("");
    return `<${name}${attributes}>${inner}</${name}>`;
  }
  return `<${name}${attributes}>${escapeText(value ?? "")}</${name}>`;
}

/** A list as AWS's Query XML writes one: each item under its member element. @param {unknown[]} items @param {string} [member] */
function members(items, member = "member") {
  return { [member]: items };
}

export { asList, decodeText, escapeText, members, parseXml, xmlOf };
