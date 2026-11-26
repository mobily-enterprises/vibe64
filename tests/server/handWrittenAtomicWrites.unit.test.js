// Every file Vibe64 replaces or creates whole goes through its one atomic writer (@local/vibe64-atomic-file), so each
// write has the same temporary-file name, cleanup and durability rules. A file written under another name and then
// renamed or linked into place is a hand-written copy of that writer, which this test refuses.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SHIPPED_ROOTS = ["bin", "config", "packages", "scripts", "server", "src", "tooling"];
const SOURCE_FILE = /\.(?:c?js|mjs|ts|vue)$/u;
const WRITER_PACKAGE = "packages/vibe64-atomic-file/";
// What writes a file at a path: its first argument, or for a copy its second.
const WRITES = /\b(?:writeFile|writeFileSync|appendFile|appendFileSync|open|openSync|createWriteStream)\(/gu;
const COPIES = /\b(?:copyFile|copyFileSync)\(/gu;
const PUBLISHES = /\b(?:rename|renameSync|link|linkSync)\(/gu;

// A rename or link of a file the same source wrote that is not a write in place, with why.
const NOT_IN_PLACE = [
  {
    file: "packages/vibe64-core/src/server/sessionTimeline.js",
    source: "writer.paths.current",
    reason: "The timeline's rotation: the full current file, appended to line by line, becomes the previous one."
  },
  {
    file: "packages/vibe64-runtime/src/server/sessionRenewalArchives.js",
    source: "stagedArchivePath",
    reason: "A renewal's archive and its metadata are copied into the renewal's own publishing folder, checked, and " +
      "moved into the archives folder as a pair; the publishing folder goes whole afterwards."
  },
  {
    file: "packages/vibe64-runtime/src/server/sessionRenewalArchives.js",
    source: "stagedMetadataPath",
    reason: "The metadata half of the same pair."
  },
  {
    file: "packages/vibe64-terminals/src/server/codexAttachments.js",
    source: "partialPath",
    reason: "A new upload into a folder made for it alone: its .uploading- name is what the attachment readers and " +
      "the expiry sweep recognise, in folders kept from every earlier release."
  }
];

/** The text of a call's argument at index, from just after its opening parenthesis, whitespace collapsed. */
function callArgument(text, start, index) {
  const found = [];
  let current = "";
  let depth = 0;
  let quote = "";
  for (let at = start; at < text.length; at += 1) {
    const character = text[at];
    if (quote) {
      current += character;
      if (character === "\\") current += text[++at] ?? "";
      else if (character === quote) quote = "";
      continue;
    }
    if (`'"\``.includes(character)) quote = character;
    else if ("([{".includes(character)) depth += 1;
    else if (")]}".includes(character)) {
      if (depth === 0) {
        found.push(current);
        break;
      }
      depth -= 1;
    } else if (character === "," && depth === 0) {
      found.push(current);
      current = "";
      if (found.length > index) break;
      continue;
    }
    current += character;
  }
  return found[index]?.split(/\s+/u).filter(Boolean).join(" ") || "";
}

/** Each rename or link in text whose source the same text writes as a file: { line, call, source }. */
function handWrittenPublications(text) {
  const written = new Set();
  for (const match of text.matchAll(WRITES)) written.add(callArgument(text, match.index + match[0].length, 0));
  for (const match of text.matchAll(COPIES)) written.add(callArgument(text, match.index + match[0].length, 1));
  written.delete("");
  return [...text.matchAll(PUBLISHES)]
    .map((match) => ({
      call: match[0].slice(0, -1),
      line: text.slice(0, match.index).split("\n").length,
      source: callArgument(text, match.index + match[0].length, 0)
    }))
    .filter(({ source }) => written.has(source));
}

function shippedSources() {
  return execFileSync("git", ["ls-files", "-z", "--", ...SHIPPED_ROOTS], { cwd: REPO_ROOT, encoding: "utf8" })
    .split("\0")
    .filter((file) => SOURCE_FILE.test(file) && !file.startsWith(WRITER_PACKAGE) && !/(?:^|\/)tests?\//u.test(file));
}

test("the check finds a temporary file written and renamed into place, and passes the atomic writer", () => {
  const handWritten = [
    'const temporary = `${file}.${process.pid}.tmp`;',
    "await writeFile(temporary, text, { mode: 0o600 });",
    "await rename(temporary, file);",
    "copyFileSync(source, `${target}.partial`);",
    "fs.renameSync(`${target}.partial`, target);",
    "const handle = await open(staged, \"wx\");",
    "await link(staged, lockPath);"
  ].join("\n");
  assert.deepEqual(handWrittenPublications(handWritten), [
    { call: "rename", line: 3, source: "temporary" },
    { call: "renameSync", line: 5, source: "`${target}.partial`" },
    { call: "link", line: 7, source: "staged" }
  ]);
  assert.deepEqual(handWrittenPublications([
    "await writeFileAtomic(file, text, { fileMode: 0o600 });",
    "await rename(sessionRoot, closingRoot);",
    "await writeFile(file, text);"
  ].join("\n")), []);
});

test("no shipped source writes a temporary file and renames or links it into place by hand", () => {
  const exempt = new Map(NOT_IN_PLACE.map((entry) => [`${entry.file} ${entry.source}`, entry]));
  const seen = new Set();
  const findings = [];
  for (const file of shippedSources()) {
    for (const { call, line, source } of handWrittenPublications(readFileSync(path.join(REPO_ROOT, file), "utf8"))) {
      const key = `${file} ${source}`;
      if (exempt.has(key)) seen.add(key);
      else findings.push(`${file}:${line}: ${call}(${source}, ...): write it with writeFileAtomic or writeFileAtomicSync`);
    }
  }
  assert.deepEqual(findings, []);
  // An exemption the code no longer needs goes too.
  assert.deepEqual([...exempt.keys()].filter((key) => !seen.has(key)), []);
});
