import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  STAGING_DATA_ENTRY_FORMS,
  STAGING_DATA_MODES,
  VIBE64_STAGING_DATA_CONTRACT,
  VIBE64_STAGING_DATA_SECTION,
  initializeGenesisProject,
  inspectVibe64StagingData,
  parseVibe64StagingDataLines,
  vibe64StagingDataInspection
} from "@local/vibe64-genesis/server";
import { runAgentSpecCli } from "../../server/lib/agentSpecCli.js";

// The `## Staging data` section: what Staging's database holds, and for a sampled own copy the recipe a host builds
// it by, from a dump of production's that the application's own command writes.
const SOURCE = "- Source: dump written by command with `nodejs` in `.`: `node` `scripts/production-dump.js` `{dump}`";
// The host takes production's dump from the backups of the database it runs production with.
const BACKUP = "- Source: production backup";
const SAMPLED = Object.freeze([
  "- Database: `database`",
  "- Mode: own copy, sampled",
  SOURCE,
  "- Unlisted tables: all up to `10000` rows",
  "",
  "### Tables",
  "",
  "- `countries`: all",
  "- `jobs`: recent by `created_at`, last `180` days",
  "- `job_events`: recent by `id`, newest `200000` rows",
  "- `messages`: recent by `sent_at`, last `90` days, newest `50000` rows",
  "- `sessions`: none",
  "",
  "### Links",
  "",
  "- `jobs.vessel_id` to `vessels.id`",
  "",
  "### Keep together",
  "",
  "- `invoices` keeps every `invoice_lines` row by `invoice_id`",
  "",
  "### Contacts",
  "",
  "- `users.email`: email",
  "- `users.mobile`: phone"
]);
// Line numbers in SAMPLED.
const AT = Object.freeze({ mode: 2, source: 3, unlisted: 4, tables: 6, links: 14, keepTogether: 18, contacts: 22 });
const SAMPLED_MODEL = Object.freeze({
  database: "database",
  mode: "sampled",
  dumpSource: { argv: ["node", "scripts/production-dump.js", "{dump}"], workdir: ".", runtimeRequirements: ["nodejs"] },
  unlistedTables: { maxRows: 10000 },
  tables: [
    { table: "countries", rule: "all" },
    { table: "jobs", rule: "recent", by: "created_at", days: 180, rows: null },
    { table: "job_events", rule: "recent", by: "id", days: null, rows: 200000 },
    { table: "messages", rule: "recent", by: "sent_at", days: 90, rows: 50000 },
    { table: "sessions", rule: "none" }
  ],
  links: [{ from: { table: "jobs", column: "vessel_id" }, to: { table: "vessels", column: "id" } }],
  keepTogether: [{ parent: "invoices", child: "invoice_lines", column: "invoice_id" }],
  contacts: [
    { table: "users", column: "email", kind: "email" },
    { table: "users", column: "mobile", kind: "phone" }
  ]
});
const FULL = Object.freeze(["- Database: `database`", "- Mode: own copy, full", SOURCE, "", "### Contacts", "", "- Nothing."]);
const RESOURCES = Object.freeze([
  { component: "mysql", resource: { id: "database", kind: "mysql" } },
  { component: "redis", resource: { id: "cache", kind: "redis" } },
  { component: "jskit-storage", resource: { id: "files", kind: "bucket" } }
]);
const SECTION_SOURCE = Object.freeze({ path: "genesis/stack.md", line: 40 });

/** SAMPLED (or other lines) with line N replaced by a line or lines, or removed with null. */
function changed(changes, lines = SAMPLED) {
  const result = [...lines];
  for (const [line, replacement] of Object.entries(changes).sort(([a], [b]) => Number(b) - Number(a))) {
    result.splice(Number(line) - 1, 1, ...(replacement === null ? [] : [replacement].flat()));
  }
  return result;
}

function inspect(lines, resources = RESOURCES, section = {}) {
  return vibe64StagingDataInspection({
    environment: { stackHash: "sha256:stack", resources },
    section: {
      status: "ready",
      stackHash: "sha256:stack",
      lines,
      components: ["mysql", "redis"],
      source: SECTION_SOURCE,
      diagnostics: [],
      ...section
    }
  });
}

/** Refused with VIBE64_STAGING_DATA_INVALID at that line of the section, saying what the pattern matches. */
function refused(run, line, pattern) {
  assert.throws(run, (error) => {
    assert.equal(error?.code, "VIBE64_STAGING_DATA_INVALID", error?.message);
    assert.equal(error.details?.path, "genesis/stack.md#Staging data", error.message);
    assert.equal(error.details?.line, line, error.message);
    assert.match(error.message, pattern);
    assert.match(error.message, / Exact grammar: vibe64-helper spec staging-data\.$/u);
    return true;
  });
}

const parseRefused = (lines, line, pattern) => refused(() => parseVibe64StagingDataLines(lines), line, pattern);

test("a sampled own copy reads every entry, rule, link, keep-together and contact form", () => {
  assert.equal(VIBE64_STAGING_DATA_CONTRACT, "vibe64.staging-data.v1");
  assert.equal(VIBE64_STAGING_DATA_SECTION, "Staging data");
  assert.deepEqual(STAGING_DATA_MODES, {
    "own copy, empty": "empty",
    "own copy, full": "full",
    "own copy, sampled": "sampled",
    "shared with production": "shared",
    "shared with production, structure frozen": "frozen"
  });
  assert.deepEqual(parseVibe64StagingDataLines(SAMPLED), SAMPLED_MODEL);
  // Headings come in any order, and blank lines are ignored.
  const reordered = [...SAMPLED.slice(0, 4), ...SAMPLED.slice(21), ...SAMPLED.slice(17, 21), ...SAMPLED.slice(4, 17)]
    .filter(Boolean);
  assert.deepEqual(parseVibe64StagingDataLines(reordered), SAMPLED_MODEL);
  // A Source's runtimes, its workdir and `{dump}` anywhere in its arguments.
  assert.deepEqual(parseVibe64StagingDataLines(changed({
    [AT.source]: "- Source: dump written by command with `nodejs` `php` in `tools/dump`: `php` `artisan` `dump` `--to` `{dump}` `--gzip`"
  })).dumpSource, { argv: ["php", "artisan", "dump", "--to", "{dump}", "--gzip"], workdir: "tools/dump", runtimeRequirements: ["nodejs", "php"] });
  // A Keep together child may be kept by two columns, and a table and column name may be 64 characters.
  const long = `t${"x".repeat(63)}`;
  assert.deepEqual(parseVibe64StagingDataLines(changed({
    [AT.keepTogether + 2]: ["- `invoices` keeps every `invoice_lines` row by `invoice_id`", "- `credits` keeps every `invoice_lines` row by `credit_id`"],
    [AT.contacts + 2]: `- \`${long}.${long}\`: email`
  })).keepTogether, [
    { parent: "invoices", child: "invoice_lines", column: "invoice_id" },
    { parent: "credits", child: "invoice_lines", column: "credit_id" }
  ]);
});

test("each mode takes exactly the entries it needs", () => {
  const base = { dumpSource: null, unlistedTables: null, tables: [], links: [], keepTogether: [], contacts: [] };
  for (const [phrase, mode] of [["own copy, empty", "empty"], ["shared with production", "shared"], ["shared with production, structure frozen", "frozen"]]) {
    assert.deepEqual(parseVibe64StagingDataLines(["- Mode: " + phrase, "- Database: `database`"]), { ...base, database: "database", mode });
  }
  assert.deepEqual(parseVibe64StagingDataLines(FULL), { ...base, database: "database", mode: "full", dumpSource: SAMPLED_MODEL.dumpSource });
  assert.deepEqual(parseVibe64StagingDataLines(changed({ 7: ["- `users.email`: email", "- `staff.phone`: phone"] }, FULL)).contacts, [
    { table: "users", column: "email", kind: "email" },
    { table: "staff", column: "phone", kind: "phone" }
  ]);
  // A sampled copy's Links and Keep together are optional; its Contacts may be `- Nothing.`.
  const bare = parseVibe64StagingDataLines(changed({ [AT.links]: null, [AT.links + 2]: null, [AT.keepTogether]: null, [AT.keepTogether + 2]: null, [AT.contacts + 2]: "- Nothing.", [AT.contacts + 3]: null }));
  assert.deepEqual({ links: bare.links, keepTogether: bare.keepTogether, contacts: bare.contacts }, { links: [], keepTogether: [], contacts: [] });
});

test("a mode, its Source and its Unlisted tables are refused where the mode does not take them, at their line", () => {
  parseRefused(changed({ [AT.mode]: "- Mode: own copy" }), AT.mode,
    /^Unknown Staging data Mode: own copy\. Use one of: own copy, empty; own copy, full; own copy, sampled; shared with production; shared with production, structure frozen\./u);
  parseRefused(changed({ [AT.mode]: "- Mode: `own copy, sampled`" }), AT.mode, /Unknown Staging data Mode: `own copy, sampled`/u);
  for (const phrase of ["shared with production", "shared with production, structure frozen"]) {
    parseRefused(["- Database: `database`", `- Mode: ${phrase}`, SOURCE], 3, new RegExp(`Mode ${phrase} has no Source: Staging uses production's database itself\\.`, "u"));
    parseRefused(["- Database: `database`", `- Mode: ${phrase}`, "- Unlisted tables: all up to `5` rows"], 3, /has no Unlisted tables: Staging uses production's database itself/u);
  }
  parseRefused(["- Database: `database`", "- Mode: own copy, empty", SOURCE], 3, /Mode own copy, empty has no Source: Staging's own database starts empty\./u);
  parseRefused(changed({ 3: [SOURCE, "- Unlisted tables: all up to `5` rows"] }, FULL), 4, /Mode own copy, full has no Unlisted tables: a whole copy keeps every row/u);
  // Missing entries are named at the Mode line.
  parseRefused(changed({ [AT.source]: null }), AT.mode, /Mode own copy, sampled builds Staging's own database from a dump of production's: add - Source: production backup or - Source: dump written by command with `runtime` in `workdir`: `command` `argument`\.\.\. `\{dump\}`/u);
  parseRefused(changed({ 3: null }, FULL), 2, /Mode own copy, full builds Staging's own database from a dump/u);
  parseRefused(changed({ [AT.unlisted]: null }), AT.mode, /Mode own copy, sampled says how many rows a table it doesn't list may have: add - Unlisted tables: all up to `n` rows/u);
  parseRefused(["- Mode: own copy, empty"], 1, /needs `- Database: `resource``/u);
  parseRefused(["", "- Database: `database`"], 2, /needs a Mode\. Use one of: - Mode: own copy, empty; - Mode: own copy, full;/u);
  // Each entry once.
  parseRefused(changed({ [AT.unlisted]: [SAMPLED[AT.unlisted - 1], "- Database: `other`"] }), AT.unlisted + 1, /a second Database entry; the first is on line 1\./u);
  parseRefused(changed({ [AT.unlisted]: [SAMPLED[AT.unlisted - 1], "- Mode: own copy, full"] }), AT.unlisted + 1, /a second Mode entry; the first is on line 2\./u);
});

test("a Source passes `{dump}` once, as an argument of its own, and runs a safe command", () => {
  const source = (argv) => parseRefused.bind(null, changed({ [AT.source]: `- Source: dump written by command with \`nodejs\` in \`.\`: ${argv}` }), AT.source);
  source("`node` `dump.js`")(/Source's command must pass `\{dump\}`, the file it writes production's dump to, as an argument of its own/u);
  source("`node` `dump.js` `{dump}` `{dump}`")(/Source passes `\{dump\}` 2 times; its command writes one dump, so pass it once\./u);
  source("`node` `dump.js` `--out={dump}`")(/Source passes `\{dump\}` inside `--out=\{dump\}`: give it as an argument of its own/u);
  source("`node` `dump.js` `{dump}` `{port}`")(/Source has the placeholder `\{port\}`; `\{dump\}` is its only one\./u);
  source("`node` `dump.js` `{dump}` `--name={host}`")(/Source has the placeholder `\{host\}`/u);
  source("`/usr/bin/node` `dump.js` `{dump}`")(/Staging data Source command must begin with a safe executable/u);
  source("node dump.js {dump}")(/Staging data Source command must contain separate non-empty backticked values/u);
  parseRefused(changed({ [AT.source]: "- Source: `node` `dump.js` `{dump}`" }), AT.source, /^Staging data Source must use one of: - Source: production backup; - Source: dump written by command with `runtime` in `workdir`: /u);
  parseRefused(changed({ [AT.source]: "- Source: dump written by command with `nodejs`: `node` `dump.js` `{dump}`" }), AT.source, /Staging data Source must use/u);
  parseRefused(changed({ [AT.source]: SOURCE.replace("in `.`", "in `../elsewhere`") }), AT.source, /Staging data Source workdir must be a canonical project-relative path/u);
  parseRefused(changed({ [AT.source]: SOURCE.replace("`nodejs`", "`Node JS`") }), AT.source, /Staging data Source runtimes must use lowercase technology ids/u);
});

test("a full or sampled copy may take production's dump from the backups of the database the host runs production with, written exactly", () => {
  const base = { dumpSource: null, unlistedTables: null, tables: [], links: [], keepTogether: [], contacts: [] };
  assert.deepEqual(STAGING_DATA_ENTRY_FORMS.section.filter((form) => form.startsWith("- Source: ")), [
    BACKUP,
    "- Source: dump written by command with `runtime` in `workdir`: `command` `argument`... `{dump}`"
  ]);
  assert.deepEqual(parseVibe64StagingDataLines(changed({ 3: BACKUP }, FULL)), { ...base, database: "database", mode: "full", dumpSource: { productionBackup: true } });
  assert.deepEqual(parseVibe64StagingDataLines(changed({ [AT.source]: BACKUP })), { ...SAMPLED_MODEL, dumpSource: { productionBackup: true } });
  // Anywhere among the section's own entries, as a command Source may be.
  assert.deepEqual(parseVibe64StagingDataLines([BACKUP, ...changed({ 3: null }, FULL)]).dumpSource, { productionBackup: true });
  // Only a copy has a Source of either form.
  for (const phrase of ["own copy, empty", "shared with production", "shared with production, structure frozen"]) {
    parseRefused(["- Database: `database`", `- Mode: ${phrase}`, BACKUP], 3, new RegExp(`^Mode ${phrase} has no Source: `, "u"));
  }
  // One Source: the backup and a command are not both taken.
  parseRefused(changed({ 3: [SOURCE, BACKUP] }, FULL), 4, /^Staging data has a second Source entry; the first is on line 3\./u);
  // Exactly the two words: anything more, less or other is refused, naming both forms.
  for (const wrong of ["production backup now", "production backups", "production backup.", "Production backup", "`production backup`",
    "production  backup", "the production backup", "production backup of `database`", "backup"]) {
    parseRefused(changed({ 3: `- Source: ${wrong}` }, FULL), 3,
      /^Staging data Source must use one of: - Source: production backup; - Source: dump written by command with `runtime` in `workdir`: `command` `argument`\.\.\. `\{dump\}`\. /u);
  }
  // The inspection carries it, as a recipe of its own.
  const ready = inspect(changed({ 3: BACKUP }, FULL), [{ resource: { id: "database", kind: "postgresql" } }]);
  assert.deepEqual([ready.status, ready.engine, ready.dumpSource], ["ready", "postgresql", { productionBackup: true }]);
  assert.notEqual(ready.recipeHash, inspect(FULL, [{ resource: { id: "database", kind: "postgresql" } }]).recipeHash);
});

test("table rules, numbers and names are exact, and each table is named once", () => {
  const table = (rule) => changed({ [AT.tables + 2]: rule });
  parseRefused(table("- `jobs`: some"), AT.tables + 2, /^Unknown table rule: some\. Use one of: - `table`: all; - `table`: none; - `table`: recent by `column`, last `n` days;/u);
  parseRefused(table("- `jobs`: recent by `created_at`"), AT.tables + 2, /A recent rule keeps its table's rows of the last `n` days, its newest `n` rows, or both/u);
  parseRefused(table("- `jobs`: recent by `id`, newest `5` rows, last `3` days"), AT.tables + 2, /Unknown table rule: recent by `id`, newest `5` rows, last `3` days\./u);
  parseRefused(table("- jobs: all"), AT.tables + 2, /Unknown Staging data table rule: - jobs: all\./u);
  parseRefused(table("- `9jobs`: all"), AT.tables + 2, /`9jobs` isn't a table name: use up to 64 letters, digits and _/u);
  parseRefused(table(`- \`t${"x".repeat(64)}\`: all`), AT.tables + 2, /isn't a table name/u);
  parseRefused(table("- `jobs`: recent by `created-at`, last `1` days"), AT.tables + 2, /`created-at` isn't a column name/u);
  parseRefused(table("- `jobs.id`: all"), AT.tables + 2, /`jobs\.id` isn't a table name/u);
  for (const [rule, label, range] of [
    ["recent by `id`, last `0` days", "A recent rule's days", "1 to 36500"],
    ["recent by `id`, last `36501` days", "A recent rule's days", "1 to 36500"],
    ["recent by `id`, newest `0` rows", "A recent rule's rows", "1 to 100000000"],
    ["recent by `id`, newest `100000001` rows", "A recent rule's rows", "1 to 100000000"],
    ["recent by `id`, newest `1e3` rows", "A recent rule's rows", "1 to 100000000"],
    ["recent by `id`, last `07` days", "A recent rule's days", "1 to 36500"],
    ["recent by `id`, last `` days", "A recent rule's days", "1 to 36500"]
  ]) {
    parseRefused(table(`- \`jobs\`: ${rule}`), AT.tables + 2, new RegExp(`^${label} must be a whole number from ${range}; `, "u"));
  }
  assert.deepEqual(parseVibe64StagingDataLines(table("- `countries`: recent by `id`, last `36500` days, newest `100000000` rows")).tables[0],
    { table: "countries", rule: "recent", by: "id", days: 36500, rows: 100000000 });
  for (const value of ["0", "10000001", "-5", "1,000", "ten"]) {
    parseRefused(changed({ [AT.unlisted]: `- Unlisted tables: all up to \`${value}\` rows` }), AT.unlisted, /^Unlisted tables' rows must be a whole number from 1 to 10000000; /u);
  }
  assert.equal(parseVibe64StagingDataLines(changed({ [AT.unlisted]: "- Unlisted tables: all up to `10000000` rows" })).unlistedTables.maxRows, 10000000);
  parseRefused(changed({ [AT.unlisted]: "- Unlisted tables: up to `5` rows" }), AT.unlisted, /Staging data Unlisted tables must use: - Unlisted tables: all up to `n` rows/u);
  parseRefused(changed({ [AT.tables + 6]: ["- `sessions`: none", "- `countries`: none"] }), AT.tables + 7, /### Tables names `countries` twice; give each table one rule\./u);
});

test("links, keep-together entries and contacts are exact, each named once", () => {
  const link = (entry) => changed({ [AT.links + 2]: entry });
  parseRefused(link("- `jobs.vessel_id` to `vessels`"), AT.links + 2, /`vessels` isn't a column: name it `table\.column`/u);
  parseRefused(link("- `a.b.c` to `vessels.id`"), AT.links + 2, /`a\.b\.c` isn't a column/u);
  parseRefused(link("- `jobs.vessel_id` -> `vessels.id`"), AT.links + 2, /^Unknown Staging data link: - `jobs\.vessel_id` -> `vessels\.id`\. Use one of: - `table\.column` to `table\.column`\./u);
  parseRefused(link("- `jobs.id` to `jobs.id`"), AT.links + 2, /`jobs\.id` links to itself/u);
  parseRefused(link(["- `jobs.vessel_id` to `vessels.id`", "- `jobs.vessel_id` to `ships.id`"]), AT.links + 3, /### Links links `jobs\.vessel_id` twice; a column refers to one column\./u);
  const kept = (entry) => changed({ [AT.keepTogether + 2]: entry });
  parseRefused(kept("- `invoices` keeps every `invoices` row by `parent_id`"), AT.keepTogether + 2, /`invoices` keeps its own rows/u);
  parseRefused(kept("- `invoices` keeps every `invoice_lines` row by `invoices.id`"), AT.keepTogether + 2, /`invoices\.id` isn't a column name/u);
  parseRefused(kept("- `invoices` keeps all `invoice_lines` rows"), AT.keepTogether + 2, /^Unknown Staging data Keep together entry: .*Use one of: - `parent` keeps every `child` row by `column`\./u);
  parseRefused(kept(["- `invoices` keeps every `invoice_lines` row by `invoice_id`", "- `orders` keeps every `invoice_lines` row by `invoice_id`"]),
    AT.keepTogether + 3, /### Keep together keeps `invoice_lines` rows by `invoice_id` twice/u);
  const contact = (entry) => changed({ [AT.contacts + 3]: entry });
  parseRefused(contact("- `users.mobile`: mobile"), AT.contacts + 3, /Contact `users\.mobile` is an `email` or a `phone` column, written without backticks/u);
  parseRefused(contact("- `users.mobile`: `phone`"), AT.contacts + 3, /Contact `users\.mobile` is an `email` or a `phone` column/u);
  parseRefused(contact("- `mobile`: phone"), AT.contacts + 3, /`mobile` isn't a column: name it `table\.column`/u);
  parseRefused(contact("- `users.email`: phone"), AT.contacts + 3, /### Contacts names `users\.email` twice; name each column once\./u);
  parseRefused(contact("- Nothing."), AT.contacts + 3, /`- Nothing\.` under ### Contacts says no column holds one, so it is the heading's only entry\./u);
  parseRefused(changed({ [AT.contacts + 2]: "- Nothing." }), AT.contacts + 3, /### Contacts says `- Nothing\.` on line 24: remove it, or this contact\./u);
  parseRefused(contact("- users.mobile: phone"), AT.contacts + 3, /^Unknown Staging data contact: - users\.mobile: phone\./u);
});

test("headings are the four, once each, and only where the mode takes them", () => {
  parseRefused(changed({ [AT.links]: "### Columns" }), AT.links,
    /^Unknown Staging data heading: ### Columns\. Use one of: ### Tables; ### Links; ### Keep together; ### Contacts\./u);
  for (const heading of ["## Tables", "#### Tables", "### tables", "### Tables:"]) {
    parseRefused(changed({ [AT.tables]: heading }), AT.tables, /^Unknown Staging data heading: /u);
  }
  parseRefused([...SAMPLED, "### Tables", "- `orders`: all"], SAMPLED.length + 1, /a second `### Tables` heading; the first is on line 6\./u);
  // Unknown entries list the section's own forms; a heading's entry above the headings says where it goes.
  parseRefused(changed({ [AT.unlisted]: "- Owner: `x`" }), AT.unlisted, (() => {
    const forms = STAGING_DATA_ENTRY_FORMS.section.map((form) => form.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")).join("; ");
    return new RegExp(`^Unknown Staging data entry: - Owner: \`x\`\\. Use one of: ${forms}\\.`, "u");
  })());
  parseRefused(changed({ [AT.unlisted]: "- `countries`: all" }), AT.unlisted, /`- `countries`: all` is a table rule: put it under `### Tables`, after the section's own entries\./u);
  parseRefused(changed({ [AT.unlisted]: "- `users.email`: email" }), AT.unlisted, /is a contact: put it under `### Contacts`/u);
  parseRefused(changed({ [AT.unlisted]: "- `jobs.vessel_id` to `vessels.id`" }), AT.unlisted, /is a link: put it under `### Links`/u);
  parseRefused(changed({ [AT.unlisted]: "- `invoices` keeps every `invoice_lines` row by `invoice_id`" }), AT.unlisted, /is a Keep together entry: put it under `### Keep together`/u);
  // Tables, Links and Keep together only in a sampled copy; Contacts only in a copy.
  for (const heading of ["### Tables", "### Links", "### Keep together"]) {
    parseRefused(changed({ 4: heading }, FULL), 4, new RegExp(`Mode own copy, full has no \`${heading}\`: a whole copy keeps every row; only own copy, sampled samples its tables\\.`, "u"));
    parseRefused(["- Database: `database`", "- Mode: shared with production", heading], 3, new RegExp(`Mode shared with production has no \`${heading}\``, "u"));
  }
  for (const phrase of ["own copy, empty", "shared with production", "shared with production, structure frozen"]) {
    parseRefused(["- Database: `database`", `- Mode: ${phrase}`, "### Contacts", "- Nothing."], 3, new RegExp(`Mode ${phrase} has no \`### Contacts\`: .*, so there is nothing to replace\\.`, "u"));
  }
  parseRefused(changed({ [AT.tables]: null, [AT.tables + 2]: null, [AT.tables + 3]: null, [AT.tables + 4]: null, [AT.tables + 5]: null, [AT.tables + 6]: null }),
    AT.mode, /Mode own copy, sampled samples production's tables: add `### Tables` with a rule for at least one table\./u);
  parseRefused(changed({ [AT.tables + 2]: null, [AT.tables + 3]: null, [AT.tables + 4]: null, [AT.tables + 5]: null, [AT.tables + 6]: null }),
    AT.tables, /`### Tables` has no entries: add one \(- `table`: all\) or remove the heading\./u);
  parseRefused(changed({ [AT.links + 2]: null }), AT.links, /`### Links` has no entries: add one/u);
  parseRefused(changed({ [AT.keepTogether + 2]: null }), AT.keepTogether, /`### Keep together` has no entries: add one/u);
  parseRefused(changed({ 5: null, 7: null }, FULL), 2, /Mode own copy, full copies production's data, which holds people's email addresses and phone numbers: add `### Contacts`/u);
  parseRefused(changed({ [AT.contacts]: null, [AT.contacts + 2]: null, [AT.contacts + 3]: null }), AT.mode, /Mode own copy, sampled copies production's data/u);
  parseRefused(changed({ 7: null }, FULL), 5, /`### Contacts` has no entries: name each column that holds an email address or phone number, or write `- Nothing\.` when none does\./u);
});

test("a section of only `- Nothing.` declares no mode, and Database is a resource id", () => {
  parseRefused(["- Nothing."], 1, /^`- Nothing\.` declares no Staging data: declare a mode .* or remove the section, which gives Staging its own empty database\./u);
  parseRefused(["", "- Nothing.", ""], 2, /declares no Staging data/u);
  parseRefused(["- Mode: own copy, empty", "- Nothing."], 2, /Unknown Staging data entry: - Nothing\./u);
  parseRefused(["- Database: database", "- Mode: own copy, empty"], 1, /Staging data Database must contain exactly 1 backticked value/u);
  parseRefused(["- Database: `a` `b`", "- Mode: own copy, empty"], 1, /Staging data Database must contain exactly 1 backticked value/u);
  parseRefused(["- Database: `9db`", "- Mode: own copy, empty"], 1, /Database names a database resource of genesis\/stack\.md's ## Resources by its id, such as `database`; "9db" isn't one\./u);
  assert.throws(() => parseVibe64StagingDataLines("- Mode: own copy, empty"), (error) => error.code === "VIBE64_STAGING_DATA_INVALID" && error.details.line === undefined);
  // A caller may name another location.
  assert.throws(() => parseVibe64StagingDataLines(["- Nothing."], { path: "elsewhere.md#Staging data" }), (error) => error.details.path === "elsewhere.md#Staging data");
});

test("without the section Staging has its own empty database; Genesis diagnostics block it", () => {
  const empty = {
    database: "",
    engine: "",
    mode: "empty",
    dumpSource: null,
    unlistedTables: null,
    tables: [],
    links: [],
    keepTogether: [],
    contacts: []
  };
  assert.deepEqual(inspect([], RESOURCES, { status: "unconfigured", source: null }), {
    contract: "vibe64.staging-data.v1",
    status: "unconfigured",
    stackHash: "sha256:stack",
    recipeHash: "",
    source: null,
    components: ["mysql", "redis"],
    diagnostics: [],
    ...empty
  });
  const diagnostics = [{ code: "STACK_SECTION_AMBIGUOUS", message: "Two components propose Staging data." }];
  const blocked = inspect(["- Nothing."], RESOURCES, { status: "blocked", diagnostics });
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.recipeHash, "");
  assert.deepEqual(blocked.diagnostics, diagnostics);
  assert.deepEqual(blocked, {
    contract: "vibe64.staging-data.v1",
    status: "blocked",
    stackHash: "sha256:stack",
    recipeHash: "",
    source: SECTION_SOURCE,
    components: ["mysql", "redis"],
    diagnostics,
    ...empty
  }, "a blocked section is not read");
  // A section's parse errors throw, as Deployment's do.
  refused(() => inspect(["- Nothing."]), 1, /declares no Staging data/u);
  assert.throws(() => vibe64StagingDataInspection({ environment: { stackHash: "sha256:other" }, section: { status: "ready", stackHash: "sha256:stack", lines: FULL } }),
    { code: "VIBE64_STACK_CHANGED" });
});

test("a ready section names its database resource's engine, and only a MySQL or PostgreSQL resource", () => {
  const ready = inspect(SAMPLED);
  assert.match(ready.recipeHash, /^sha256:[0-9a-f]{64}$/u);
  assert.deepEqual(ready, {
    contract: VIBE64_STAGING_DATA_CONTRACT,
    status: "ready",
    stackHash: "sha256:stack",
    recipeHash: ready.recipeHash,
    source: SECTION_SOURCE,
    components: ["mysql", "redis"],
    diagnostics: [],
    engine: "mysql",
    ...SAMPLED_MODEL
  });
  assert.equal(inspect(FULL, [{ resource: { id: "database", kind: "postgresql" } }]).engine, "postgresql");
  refused(() => inspect(changed({ 1: "- Database: `db`" })), 1,
    /^Database `db`: genesis\/stack\.md's ## Resources declares no resource `db`; name one of its databases: `database`\./u);
  refused(() => inspect(changed({ 1: "- Database: `cache`" })), 1,
    /^Database `cache` is a redis resource, and Staging data is for a `mysql` or `postgresql` database; name one of its databases: `database`\./u);
  refused(() => inspect(FULL, [{ resource: { id: "database", kind: "sqlite" } }]), 1,
    /Database `database` is a sqlite resource, and Staging data is for a `mysql` or `postgresql` database; it declares no `mysql` or `postgresql` database; add one to the Stack, or remove the section\./u);
  refused(() => inspect(FULL, null), 1, /declares no resource `database`; it declares no `mysql` or `postgresql` database/u);
  // The Database line is named wherever it is.
  refused(() => inspect(["- Mode: own copy, empty", "", "- Database: `files`"]), 3, /Database `files` is a bucket resource/u);
});

test("the recipe hash is the recipe's: stable across layout and location, and changed by every part of the recipe", () => {
  const hash = inspect(SAMPLED).recipeHash;
  const reordered = [...SAMPLED.slice(0, 4), ...SAMPLED.slice(21), ...SAMPLED.slice(17, 21), ...SAMPLED.slice(4, 17)];
  assert.equal(inspect(["", ...reordered.filter(Boolean), ""]).recipeHash, hash);
  assert.equal(inspect(SAMPLED, RESOURCES, { source: { path: "genesis/stack.md", line: 99 }, components: [], stackHash: "sha256:stack" }).recipeHash, hash);
  assert.equal(inspect([SAMPLED[1], SAMPLED[0], SAMPLED[3], SAMPLED[2], ...SAMPLED.slice(4)]).recipeHash, hash);
  const changes = [
    changed({ [AT.mode]: "- Mode: own copy, full", [AT.unlisted]: null, [AT.tables]: null, 7: null, 8: null, 9: null, 10: null, 11: null, 12: null, [AT.links]: null, 16: null, [AT.keepTogether]: null, 20: null }),
    changed({ [AT.source]: SOURCE.replace("`{dump}`", "`--gzip` `{dump}`") }),
    changed({ [AT.source]: SOURCE.replace("in `.`", "in `tools`") }),
    changed({ [AT.source]: BACKUP }),
    changed({ [AT.unlisted]: "- Unlisted tables: all up to `10001` rows" }),
    changed({ [AT.tables + 2]: "- `countries`: none" }),
    changed({ [AT.tables + 3]: "- `jobs`: recent by `created_at`, last `181` days" }),
    changed({ [AT.tables + 4]: "- `job_events`: recent by `created_at`, newest `200000` rows" }),
    changed({ [AT.tables + 6]: ["- `sessions`: none", "- `audit`: none"] }),
    changed({ [AT.links + 2]: "- `jobs.vessel_id` to `ships.id`" }),
    changed({ [AT.keepTogether + 2]: "- `invoices` keeps every `invoice_lines` row by `invoice_ref`" }),
    changed({ [AT.contacts + 3]: "- `users.mobile`: email" })
  ];
  const hashes = changes.map((lines) => inspect(lines).recipeHash);
  assert.equal(new Set([hash, ...hashes]).size, changes.length + 1);
  // The engine is part of the recipe: the same section for a PostgreSQL database is another recipe.
  assert.notEqual(inspect(SAMPLED, [{ resource: { id: "database", kind: "postgresql" } }]).recipeHash, hash);
});

test("the Staging data spec prints the parser's own forms, and its example parses", async () => {
  const out = [];
  assert.equal(await runAgentSpecCli(["staging-data"], { write: (text) => out.push(text), writeError: assert.fail }), 0);
  const spec = out.join("\n");
  for (const form of Object.values(STAGING_DATA_ENTRY_FORMS).flat()) assert.ok(spec.includes(`    ${form}\n`), form);
  for (const phrase of Object.keys(STAGING_DATA_MODES)) assert.ok(spec.includes(`  - \`${phrase}\`: `), phrase);
  assert.match(spec, /`mariadb-dump` or `mysqldump`/u);
  assert.match(spec, /`pg_dump` custom format \(`-Fc`\)/u);
  assert.match(spec, /never `--databases` or `--all-databases`/u);
  assert.match(spec, /\(1 to 36500\).*\(1 to 100000000\).*\(1 to 10000000\)/u);
  assert.doesNotMatch(spec, /hosted|mobilynet|workspace/iu, "the public spec describes no hosting service");
  const [example] = [...spec.matchAll(/```markdown\n([\s\S]*?)\n```/gu)].map((match) => match[1]);
  const [heading, ...lines] = example.split("\n");
  assert.equal(heading, "## Staging data");
  assert.deepEqual(parseVibe64StagingDataLines(lines), SAMPLED_MODEL);
});

test("the pinned Genesis transports Staging data and the database resource it names", async (t) => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "vibe64-staging-data-"));
  t.after(() => rm(projectRoot, { recursive: true, force: true }));
  await promisify(execFile)("git", ["init", "--quiet"], { cwd: projectRoot });
  await initializeGenesisProject({ projectRoot });
  const unconfigured = await inspectVibe64StagingData({ projectRoot });
  assert.equal(unconfigured.status, "unconfigured");
  assert.equal(unconfigured.mode, "empty");
  assert.equal(unconfigured.recipeHash, "");
  await writeFile(path.join(projectRoot, "genesis", "stack.md"), [
    "# Stack",
    "",
    "## Components",
    "",
    "- `mysql`",
    "",
    "## Resources",
    "",
    "```json genesis-resource",
    JSON.stringify({ id: "database", kind: "mysql", environmentAlternatives: [{ bindings: { url: "DATABASE_URL" }, preferred: true }] }),
    "```",
    "",
    "## Staging data",
    "",
    ...FULL,
    ""
  ].join("\n"), "utf8");
  const ready = await inspectVibe64StagingData({ projectRoot });
  assert.deepEqual(ready.diagnostics, []);
  assert.equal(ready.status, "ready");
  assert.equal(ready.contract, "vibe64.staging-data.v1");
  assert.equal(ready.database, "database");
  assert.equal(ready.engine, "mysql");
  assert.equal(ready.mode, "full");
  assert.deepEqual(ready.dumpSource, SAMPLED_MODEL.dumpSource);
  assert.deepEqual(ready.components, ["mysql"]);
  assert.match(ready.recipeHash, /^sha256:/u);
  assert.ok(ready.stackHash);
});
