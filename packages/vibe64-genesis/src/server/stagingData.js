// The `## Staging data` Stack section: what Staging's database holds. Staging has a database of its own (empty, or
// built from a dump of production's that the application's own command writes, whole or sampled by a recipe), or it
// uses production's database itself. Without the section Staging has its own empty database.
import {
  STACK_RESOURCE_ID,
  assertMatchingStackInspections,
  backtickedArguments,
  invalidStackOperation,
  isExplicitlyEmptyStackSection,
  processArguments,
  projectPath,
  runtimeArguments,
  stackOperationHash,
  stackResourcesById,
  unknownEntryMessage
} from "./stackOperation.js";

const VIBE64_STAGING_DATA_CONTRACT = "vibe64.staging-data.v1";
const VIBE64_STAGING_DATA_SECTION = "Staging data";
const CODE = "VIBE64_STAGING_DATA_INVALID";
const LOCATION = "genesis/stack.md#Staging data";

// Each mode's exact phrase and its name in the result.
const STAGING_DATA_MODES = Object.freeze({
  "own copy, empty": "empty",
  "own copy, full": "full",
  "own copy, sampled": "sampled",
  "shared with production": "shared",
  "shared with production, structure frozen": "frozen"
});
const MODE_PHRASES = Object.freeze(Object.fromEntries(Object.entries(STAGING_DATA_MODES).map(([phrase, mode]) => [mode, phrase])));
// What each mode needs beyond Database and Mode, and refuses otherwise: the command that writes production's dump, the
// size an unlisted table may have, the sampling parts (### Tables, ### Links, ### Keep together) and ### Contacts.
const MODE_NEEDS = Object.freeze({
  empty: Object.freeze({ source: false, unlisted: false, sampling: false, contacts: false }),
  full: Object.freeze({ source: true, unlisted: false, sampling: false, contacts: true }),
  sampled: Object.freeze({ source: true, unlisted: true, sampling: true, contacts: true }),
  shared: Object.freeze({ source: false, unlisted: false, sampling: false, contacts: false }),
  frozen: Object.freeze({ source: false, unlisted: false, sampling: false, contacts: false })
});
// Why a mode refuses the entries and headings another mode has.
const WITHOUT_DUMP = Object.freeze({
  empty: "Staging's own database starts empty",
  full: "a whole copy keeps every row",
  shared: "Staging uses production's database itself",
  frozen: "Staging uses production's database itself"
});
const DATABASE_ENGINES = Object.freeze(["mysql", "postgresql"]);
const DUMP_PLACEHOLDER = "{dump}";
const PLACEHOLDER = /\{[A-Za-z][A-Za-z0-9_:-]*\}/u;
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/u;
// The least and most of each number: an unlisted table's rows, and a recent rule's days and rows.
const STAGING_DATA_LIMITS = Object.freeze({
  unlistedRows: Object.freeze([1, 10_000_000]),
  days: Object.freeze([1, 36_500]),
  rows: Object.freeze([1, 100_000_000])
});

const SOURCE_VALUE = /^dump written by command with (.+?) in `([^`\r\n]+)`: (.+)$/u;
const UNLISTED_VALUE = /^all up to `([^`\r\n]*)` rows$/u;
const NAMED_LINE = /^- `([^`\r\n]*)`: (.+)$/u;
const RECENT_RULE = /^recent by `([^`\r\n]*)`(?:, last `([^`\r\n]*)` days)?(?:, newest `([^`\r\n]*)` rows)?$/u;
const LINK_LINE = /^- `([^`\r\n]*)` to `([^`\r\n]*)`$/u;
const KEEP_TOGETHER_LINE = /^- `([^`\r\n]*)` keeps every `([^`\r\n]*)` row by `([^`\r\n]*)`$/u;
const CONTACT_KINDS = Object.freeze(["email", "phone"]);
const NOTHING = "- Nothing.";

const MODE_FORMS = Object.freeze(Object.keys(STAGING_DATA_MODES).map((phrase) => `- Mode: ${phrase}`));
const SOURCE_FORM = "- Source: dump written by command with `runtime` in `workdir`: `command` `argument`... `{dump}`";
const UNLISTED_FORM = "- Unlisted tables: all up to `n` rows";
const STAGING_DATA_ENTRY_FORMS = Object.freeze({
  section: Object.freeze([
    "- Database: `resource`",
    ...MODE_FORMS,
    SOURCE_FORM,
    UNLISTED_FORM
  ]),
  tables: Object.freeze([
    "- `table`: all",
    "- `table`: none",
    "- `table`: recent by `column`, last `n` days",
    "- `table`: recent by `column`, newest `n` rows",
    "- `table`: recent by `column`, last `n` days, newest `n` rows"
  ]),
  links: Object.freeze(["- `table.column` to `table.column`"]),
  keepTogether: Object.freeze(["- `parent` keeps every `child` row by `column`"]),
  contacts: Object.freeze(["- `table.column`: email", "- `table.column`: phone", NOTHING])
});
const STAGING_DATA_HEADINGS = new Map([
  ["### Tables", "tables"],
  ["### Links", "links"],
  ["### Keep together", "keepTogether"],
  ["### Contacts", "contacts"]
]);
const STAGING_DATA_HEADING_FORMS = Object.freeze([...STAGING_DATA_HEADINGS.keys()]);
const HEADING_OF = Object.freeze(Object.fromEntries([...STAGING_DATA_HEADINGS].map(([heading, part]) => [part, heading])));
const PART_LABELS = Object.freeze({
  tables: "table rule",
  links: "link",
  keepTogether: "Keep together entry",
  contacts: "contact"
});

function readDatabase(read, value, line) {
  const [id] = backtickedArguments(value, CODE, read.location, "Staging data Database", line, { count: 1 });
  if (!STACK_RESOURCE_ID.test(id)) {
    read.fail(`Database names a database resource of genesis/stack.md's ## Resources by its id, such as \`database\`; ${JSON.stringify(id)} isn't one.`, line);
  }
  read.model.database = id;
}

function readMode(read, phrase, line) {
  if (!Object.hasOwn(STAGING_DATA_MODES, phrase)) {
    read.fail(unknownEntryMessage("Staging data Mode", phrase, Object.keys(STAGING_DATA_MODES)), line);
  }
  read.model.mode = STAGING_DATA_MODES[phrase];
}

// The dump goes to the one file the host names: `{dump}` is the Source's one placeholder, an argument of its own, once.
function checkDumpArgument(read, argv, line) {
  const embedded = argv.find((argument) => argument !== DUMP_PLACEHOLDER && argument.includes(DUMP_PLACEHOLDER));
  if (embedded) {
    read.fail(`Source passes \`{dump}\` inside \`${embedded}\`: give it as an argument of its own, such as \`--output\` \`{dump}\`.`, line);
  }
  const other = argv.find((argument) => argument !== DUMP_PLACEHOLDER && PLACEHOLDER.test(argument));
  if (other) read.fail(`Source has the placeholder \`${other.match(PLACEHOLDER)[0]}\`; \`{dump}\` is its only one.`, line);
  const dumps = argv.filter((argument) => argument === DUMP_PLACEHOLDER).length;
  if (dumps !== 1) {
    read.fail(dumps
      ? `Source passes \`{dump}\` ${dumps} times; its command writes one dump, so pass it once.`
      : `Source's command must pass \`{dump}\`, the file it writes production's dump to, as an argument of its own. Use: ${SOURCE_FORM}`, line);
  }
}

function readSource(read, value, line) {
  const entry = value.match(SOURCE_VALUE);
  if (!entry) read.fail(`Staging data Source must use: ${SOURCE_FORM}`, line);
  const argv = processArguments(entry[3], CODE, read.location, "Staging data Source command", line);
  checkDumpArgument(read, argv, line);
  read.model.dumpSource = {
    argv,
    workdir: projectPath(entry[2], CODE, read.location, "Staging data Source workdir", line),
    runtimeRequirements: runtimeArguments(entry[1], CODE, read.location, "Staging data Source runtimes", line)
  };
}

function wholeNumber(read, value, [minimum, maximum], label, line) {
  const number = /^[1-9][0-9]*$/u.test(value) ? Number(value) : Number.NaN;
  if (!(number >= minimum && number <= maximum)) {
    read.fail(`${label} must be a whole number from ${minimum} to ${maximum}; \`${value}\` isn't one.`, line);
  }
  return number;
}

function readUnlisted(read, value, line) {
  const match = value.match(UNLISTED_VALUE);
  if (!match) read.fail(`Staging data Unlisted tables must use: ${UNLISTED_FORM}`, line);
  read.model.unlistedTables = { maxRows: wholeNumber(read, match[1], STAGING_DATA_LIMITS.unlistedRows, "Unlisted tables' rows", line) };
}

// The entries before the first heading, each at most once.
const SECTION_ENTRIES = Object.freeze([
  { prefix: "- Database: ", key: "database", label: "Database", read: readDatabase },
  { prefix: "- Mode: ", key: "mode", label: "Mode", read: readMode },
  { prefix: "- Source: ", key: "source", label: "Source", read: readSource },
  { prefix: "- Unlisted tables: ", key: "unlisted", label: "Unlisted tables", read: readUnlisted }
]);

// A line before the first heading that reads as one of a heading's entries says which heading it belongs under.
function misplacedPart(source) {
  if (source === NOTHING) return "";
  if (KEEP_TOGETHER_LINE.test(source)) return "keepTogether";
  if (LINK_LINE.test(source)) return "links";
  const named = source.match(NAMED_LINE);
  if (!named) return "";
  return named[1].includes(".") ? "contacts" : "tables";
}

function readSectionEntry(read, source, line) {
  const entry = SECTION_ENTRIES.find(({ prefix }) => source.startsWith(prefix));
  if (!entry) {
    const part = misplacedPart(source);
    read.fail(part
      ? `\`${source}\` is a ${PART_LABELS[part]}: put it under \`${HEADING_OF[part]}\`, after the section's own entries.`
      : unknownEntryMessage("Staging data entry", source, STAGING_DATA_ENTRY_FORMS.section), line);
  }
  if (read.at[entry.key]) {
    read.fail(`Staging data has a second ${entry.label} entry; the first is on line ${read.at[entry.key]}.`, line);
  }
  read.at[entry.key] = line;
  entry.read(read, source.slice(entry.prefix.length), line);
}

function identifier(read, value, label, line) {
  if (!IDENTIFIER.test(value)) {
    read.fail(`\`${value}\` isn't a ${label} name: use up to 64 letters, digits and _, starting with a letter or _.`, line);
  }
  return value;
}

function qualifiedColumn(read, value, line) {
  const names = value.split(".");
  if (names.length !== 2 || !names.every((name) => IDENTIFIER.test(name))) {
    read.fail(`\`${value}\` isn't a column: name it \`table.column\`, each up to 64 letters, digits and _, starting with a letter or _.`, line);
  }
  return { table: names[0], column: names[1] };
}

// Each table, link column, kept (child, column) pair and contact column is named once in its part.
function once(read, part, key, message, line) {
  if (read.named[part].has(key)) read.fail(message, line);
  read.named[part].add(key);
}

function tableRule(read, rule, line) {
  if (rule === "all" || rule === "none") return { rule };
  const recent = rule.match(RECENT_RULE);
  if (!recent) read.fail(`Unknown table rule: ${rule}. Use one of: ${STAGING_DATA_ENTRY_FORMS.tables.join("; ")}.`, line);
  if (recent[2] === undefined && recent[3] === undefined) {
    read.fail("A recent rule keeps its table's rows of the last `n` days, its newest `n` rows, or both: add `, last `n` days`, `, newest `n` rows` or both, in that order.", line);
  }
  return {
    rule: "recent",
    by: identifier(read, recent[1], "column", line),
    days: recent[2] === undefined ? null : wholeNumber(read, recent[2], STAGING_DATA_LIMITS.days, "A recent rule's days", line),
    rows: recent[3] === undefined ? null : wholeNumber(read, recent[3], STAGING_DATA_LIMITS.rows, "A recent rule's rows", line)
  };
}

function readTable(read, source, line) {
  const match = source.match(NAMED_LINE);
  if (!match) read.fail(unknownEntryMessage("Staging data table rule", source, STAGING_DATA_ENTRY_FORMS.tables), line);
  const table = identifier(read, match[1], "table", line);
  once(read, "tables", table, `### Tables names \`${table}\` twice; give each table one rule.`, line);
  read.model.tables.push({ table, ...tableRule(read, match[2], line) });
}

function readLink(read, source, line) {
  const match = source.match(LINK_LINE);
  if (!match) read.fail(unknownEntryMessage("Staging data link", source, STAGING_DATA_ENTRY_FORMS.links), line);
  const from = qualifiedColumn(read, match[1], line);
  const to = qualifiedColumn(read, match[2], line);
  if (match[1] === match[2]) read.fail(`\`${match[1]}\` links to itself; a link names the column another column refers to.`, line);
  once(read, "links", match[1], `### Links links \`${match[1]}\` twice; a column refers to one column.`, line);
  read.model.links.push({ from, to });
}

function readKeepTogether(read, source, line) {
  const match = source.match(KEEP_TOGETHER_LINE);
  if (!match) read.fail(unknownEntryMessage("Staging data Keep together entry", source, STAGING_DATA_ENTRY_FORMS.keepTogether), line);
  const parent = identifier(read, match[1], "table", line);
  const child = identifier(read, match[2], "table", line);
  const column = identifier(read, match[3], "column", line);
  if (parent === child) {
    read.fail(`\`${parent}\` keeps its own rows; Keep together names a parent table and another table whose rows refer to it.`, line);
  }
  once(read, "keepTogether", `${child}.${column}`, `### Keep together keeps \`${child}\` rows by \`${column}\` twice; name each once.`, line);
  read.model.keepTogether.push({ parent, child, column });
}

function readContact(read, source, line) {
  if (source === NOTHING) {
    if (read.entries.contacts > 0) read.fail("`- Nothing.` under ### Contacts says no column holds one, so it is the heading's only entry.", line);
    read.contactsNothing = line;
    return;
  }
  if (read.contactsNothing) {
    read.fail(`### Contacts says \`- Nothing.\` on line ${read.contactsNothing}: remove it, or this contact.`, line);
  }
  const match = source.match(NAMED_LINE);
  if (!match) read.fail(unknownEntryMessage("Staging data contact", source, STAGING_DATA_ENTRY_FORMS.contacts), line);
  const { table, column } = qualifiedColumn(read, match[1], line);
  if (!CONTACT_KINDS.includes(match[2])) {
    read.fail(`Contact \`${match[1]}\` is an \`email\` or a \`phone\` column, written without backticks: ${STAGING_DATA_ENTRY_FORMS.contacts.slice(0, 2).join(" or ")}.`, line);
  }
  once(read, "contacts", match[1], `### Contacts names \`${match[1]}\` twice; name each column once.`, line);
  read.model.contacts.push({ table, column, kind: match[2] });
}

const PART_READERS = Object.freeze({
  tables: readTable,
  links: readLink,
  keepTogether: readKeepTogether,
  contacts: readContact
});

function readHeading(read, source, line) {
  const part = STAGING_DATA_HEADINGS.get(source);
  if (!part) read.fail(unknownEntryMessage("Staging data heading", source, STAGING_DATA_HEADING_FORMS), line);
  if (read.at[part]) read.fail(`Staging data has a second \`${source}\` heading; the first is on line ${read.at[part]}.`, line);
  read.at[part] = line;
  return part;
}

// What the mode needs and refuses, once every line is read: a missing entry is named at the Mode line, a refused one
// at its own line.
function checkSourceAndUnlisted(read, phrase, needs, reason) {
  const { at, fail } = read;
  if (needs.source && !at.source) fail(`Mode ${phrase} builds Staging's own database from a dump of production's: add ${SOURCE_FORM}`, at.mode);
  if (!needs.source && at.source) fail(`Mode ${phrase} has no Source: ${reason}.`, at.source);
  if (needs.unlisted && !at.unlisted) {
    fail(`Mode ${phrase} says how many rows a table it doesn't list may have: add ${UNLISTED_FORM}`, at.mode);
  }
  if (!needs.unlisted && at.unlisted) fail(`Mode ${phrase} has no Unlisted tables: ${reason}; only a sampled copy lists its tables.`, at.unlisted);
}

function checkParts(read, phrase, needs, reason) {
  const { at, entries, fail } = read;
  for (const part of ["tables", "links", "keepTogether"]) {
    if (!needs.sampling && at[part]) {
      fail(`Mode ${phrase} has no \`${HEADING_OF[part]}\`: ${reason}; only own copy, sampled samples its tables.`, at[part]);
    }
    if (at[part] && entries[part] === 0) fail(`\`${HEADING_OF[part]}\` has no entries: add one (${STAGING_DATA_ENTRY_FORMS[part][0]}) or remove the heading.`, at[part]);
  }
  if (needs.sampling && !at.tables) fail(`Mode ${phrase} samples production's tables: add \`### Tables\` with a rule for at least one table.`, at.mode);
  if (needs.contacts && !at.contacts) {
    fail(`Mode ${phrase} copies production's data, which holds people's email addresses and phone numbers: add \`### Contacts\` naming each column that holds one, or \`- Nothing.\` under it when none does.`, at.mode);
  }
  if (!needs.contacts && at.contacts) fail(`Mode ${phrase} has no \`### Contacts\`: ${reason}, so there is nothing to replace.`, at.contacts);
  if (at.contacts && entries.contacts === 0 && !read.contactsNothing) {
    fail("`### Contacts` has no entries: name each column that holds an email address or phone number, or write `- Nothing.` when none does.", at.contacts);
  }
}

function checkMode(read, top) {
  if (!read.at.database) read.fail("Staging data needs `- Database: `resource``, naming the database resource of genesis/stack.md's ## Resources whose Staging data it declares.", top);
  if (!read.at.mode) read.fail(`Staging data needs a Mode. Use one of: ${MODE_FORMS.join("; ")}.`, top);
  const phrase = MODE_PHRASES[read.model.mode];
  const needs = MODE_NEEDS[read.model.mode];
  const reason = WITHOUT_DUMP[read.model.mode] || "";
  checkSourceAndUnlisted(read, phrase, needs, reason);
  checkParts(read, phrase, needs, reason);
}

// The section, with the line of each entry and heading for the checks only the inspection can make.
function parseStagingData(lines, location) {
  const fail = (message, line) => invalidStackOperation(CODE, location, message, line || undefined);
  if (!Array.isArray(lines)) fail("Staging data requires exact Stack section lines.");
  const top = lines.findIndex((text) => typeof text === "string" && text.trim()) + 1;
  if (isExplicitlyEmptyStackSection(lines)) {
    fail("`- Nothing.` declares no Staging data: declare a mode (`- Database: `database`` and `- Mode: own copy, empty` at least), or remove the section, which gives Staging its own empty database.", top);
  }
  const read = {
    location,
    fail,
    model: { database: "", mode: "", dumpSource: null, unlistedTables: null, tables: [], links: [], keepTogether: [], contacts: [] },
    at: {},
    entries: { tables: 0, links: 0, keepTogether: 0, contacts: 0 },
    named: { tables: new Set(), links: new Set(), keepTogether: new Set(), contacts: new Set() },
    contactsNothing: 0
  };
  let part = "";
  for (const [index, text] of lines.entries()) {
    const source = String(text).trim();
    if (!source) continue;
    const line = index + 1;
    if (source.startsWith("#")) {
      part = readHeading(read, source, line);
    } else if (part) {
      PART_READERS[part](read, source, line);
      read.entries[part] += 1;
    } else {
      readSectionEntry(read, source, line);
    }
  }
  checkMode(read, top);
  return read;
}

function parseVibe64StagingDataLines(lines, options = {}) {
  const {
    path: location = LOCATION
  } = options;
  return parseStagingData(lines, location).model;
}

// The engine of the database resource the section names, which must be a MySQL or PostgreSQL resource of the Stack.
function databaseEngine(read, declarations) {
  const resources = stackResourcesById(declarations);
  const { database } = read.model;
  const databases = [...resources.values()].filter((resource) => DATABASE_ENGINES.includes(resource.kind)).map(({ id }) => `\`${id}\``);
  const fix = databases.length
    ? `name one of its databases: ${databases.join(", ")}`
    : "it declares no `mysql` or `postgresql` database; add one to the Stack, or remove the section";
  const declared = resources.get(database);
  if (!declared) read.fail(`Database \`${database}\`: genesis/stack.md's ## Resources declares no resource \`${database}\`; ${fix}.`, read.at.database);
  if (!DATABASE_ENGINES.includes(declared.kind)) {
    read.fail(`Database \`${database}\` is a ${declared.kind} resource, and Staging data is for a \`mysql\` or \`postgresql\` database; ${fix}.`, read.at.database);
  }
  return declared.kind;
}

function vibe64StagingDataInspection({ environment = {}, section = {} } = {}) {
  assertMatchingStackInspections(section, environment, "Staging data section");
  const diagnostics = [...(section.diagnostics || [])];
  const read = section.status === "ready" && diagnostics.length === 0 ? parseStagingData(section.lines, LOCATION) : null;
  const model = read?.model;
  const recipe = {
    database: model?.database || "",
    engine: read ? databaseEngine(read, environment.resources) : "",
    mode: model?.mode || "empty",
    dumpSource: model?.dumpSource || null,
    unlistedTables: model?.unlistedTables || null,
    tables: model?.tables || [],
    links: model?.links || [],
    keepTogether: model?.keepTogether || [],
    contacts: model?.contacts || []
  };
  return {
    contract: VIBE64_STAGING_DATA_CONTRACT,
    status: diagnostics.length > 0 ? "blocked" : read ? "ready" : "unconfigured",
    stackHash: section.stackHash,
    recipeHash: read ? stackOperationHash({ version: 1, ...recipe }) : "",
    source: section.source || null,
    components: [...(section.components || [])],
    diagnostics,
    ...recipe
  };
}

export {
  STAGING_DATA_ENTRY_FORMS,
  STAGING_DATA_HEADING_FORMS,
  STAGING_DATA_LIMITS,
  STAGING_DATA_MODES,
  VIBE64_STAGING_DATA_CONTRACT,
  VIBE64_STAGING_DATA_SECTION,
  parseVibe64StagingDataLines,
  vibe64StagingDataInspection
};
