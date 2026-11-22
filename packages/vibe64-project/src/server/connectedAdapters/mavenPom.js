// What the maven adapter reads from pom.xml files as text, without Maven: a project's own
// coordinates and modules, and the version a consumer's pom names for one dependency, with the
// exact edit that moves it. A version Maven would compute (a parent's, a profile's, an expression it
// cannot follow here) reads as null, never as a guess.
import { readFile } from "node:fs/promises";
import path from "node:path";

const NESTED = ["profiles", "build", "reporting", "dependencyManagement", "dependencies", "modules", "properties", "repositories",
  "pluginRepositories", "distributionManagement", "parent"];
const MODULE_DEPTH = 3;

function withoutComments(xml) {
  return xml.replace(/<!--[\s\S]*?-->/gu, "");
}

function element(xml, name) {
  const match = new RegExp(`<${name}>\\s*([^<]*?)\\s*</${name}>`, "u").exec(xml);
  return match ? match[1] : null;
}

function block(xml, name) {
  return new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "u").exec(xml)?.[1] || "";
}

function properties(xml) {
  const values = {};
  for (const match of block(xml, "properties").matchAll(/<([A-Za-z0-9_.-]+)>\s*([^<]*?)\s*<\/\1>/gu)) values[match[1]] = match[2];
  return values;
}

/** A literal version, or one property of the same pom; anything else is null. */
function resolved(version, values) {
  if (!version) return null;
  const property = /^\$\{([A-Za-z0-9_.-]+)\}$/u.exec(version);
  if (!property) return version.includes("$") ? null : version;
  const value = values[property[1]];
  return value && !value.includes("$") ? value : null;
}

/** A pom's own groupId:artifactId and version (the parent's when it names none), and its modules. */
function pomCoordinates(text) {
  const xml = withoutComments(text);
  const parent = block(xml, "parent");
  const own = NESTED.reduce((rest, name) => rest.replace(new RegExp(`<${name}>[\\s\\S]*?</${name}>`, "gu"), ""), xml);
  const values = properties(xml);
  const groupId = element(own, "groupId") || element(parent, "groupId");
  return {
    groupId,
    artifactId: element(own, "artifactId"),
    version: resolved(element(own, "version") || element(parent, "version"), values),
    modules: [...block(xml, "modules").matchAll(/<module>\s*([^<]+?)\s*<\/module>/gu)].map(match => match[1])
  };
}

/** The artifacts a connected checkout builds: its pom's and its modules'. */
async function connectedArtifacts(root, depth = 0) {
  const text = await readFile(path.join(root, "pom.xml"), "utf8").catch(() => null);
  if (text === null) return [];
  const own = pomCoordinates(text);
  const artifacts = own.groupId && own.artifactId ? [{ package: `${own.groupId}:${own.artifactId}`, version: own.version }] : [];
  if (depth >= MODULE_DEPTH) return artifacts;
  for (const module of own.modules) {
    if (module.includes("..") || path.isAbsolute(module)) continue;
    artifacts.push(...await connectedArtifacts(path.join(root, module), depth + 1));
  }
  return artifacts;
}

/**
 * The version a consumer's pom names for one dependency, and the edit to move it: `found` is
 * false when the pom does not name it; `version` is null when its version comes from elsewhere
 * (a parent, a BOM, two different values).
 */
function dependencyVersion(text, packageName) {
  const [groupId, artifactId] = packageName.split(":");
  // Comments blanked in place, so a position in `masked` is the same position in `text`.
  const masked = text.replace(/<!--[\s\S]*?-->/gu, comment => comment.replace(/[^\n]/gu, " "));
  const values = properties(masked);
  const named = [...masked.matchAll(/<dependency>[\s\S]*?<\/dependency>/gu)]
    .filter(match => element(match[0], "groupId") === groupId && element(match[0], "artifactId") === artifactId)
    .map(match => ({
      start: match.index,
      end: match.index + match[0].length,
      written: element(match[0], "version")
    }));
  const versioned = named.filter(entry => entry.written);
  const versions = [...new Set(versioned.map(entry => resolved(entry.written, values)))];
  const version = versions.length === 1 ? versions[0] : null;
  return {
    found: named.length > 0,
    version,
    /** The pom with that version moved to `to`, or null when no single exact edit does it. */
    edit(to) {
      if (!version || versioned.length !== 1) return null;
      const [{ start, end, written }] = versioned;
      const property = /^\$\{([A-Za-z0-9_.-]+)\}$/u.exec(written);
      if (property) {
        const matches = [...masked.matchAll(/<([A-Za-z0-9_.-]+)>(\s*)([^<]*?)\s*<\/\1>/gu)]
          .filter(match => match[1] === property[1] && match[3] === version);
        if (matches.length !== 1) return null;
        const at = matches[0].index + property[1].length + 2 + matches[0][2].length;
        return `${text.slice(0, at)}${to}${text.slice(at + version.length)}`;
      }
      const inner = /<version>(\s*)([^<]*?)\s*<\/version>/u.exec(masked.slice(start, end));
      const at = start + inner.index + "<version>".length + inner[1].length;
      return `${text.slice(0, at)}${to}${text.slice(at + inner[2].length)}`;
    }
  };
}

export { connectedArtifacts, dependencyVersion, pomCoordinates };
