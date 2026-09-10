export const DATA_OVERVIEW_PATH = "data-overview.json";
export const DATA_OVERVIEW_MAX_BYTES = 256 * 1024;
export const DATA_OVERVIEW_ABSTRACTIONS = [
  { value: "none", title: "Not abstract", description: "Make every physical table its own actor; do not combine tables." },
  { value: "balanced", title: "Balanced", description: "Aim for 5–10 business concepts, with supporting tables inside them and only the main business connections shown." },
  { value: "high", title: "Very abstract", description: "Aim for 3–5 broad business domains, including their supporting concepts across multiple relationships." }
];

export const DATA_OVERVIEW_INSTRUCTIONS = [
  "Vibe64's Data overview groups real database tables under main actors. It does not change the database.",
  "Read the refreshed schema and relevant application models, migrations and documentation to choose meaningful actors and their supporting tables. Relationship distance does not determine membership.",
  'Write data-overview.json in the project source root using: {"version":1,"abstraction":"balanced","reviewedTables":["public.bookings","public.invoice_groups","public.checklists","public.transactions"],"actors":[{"table":"public.bookings","name":"Bookings","description":"Bookings with invoice groups, checklists and transactions","tables":["public.bookings","public.invoice_groups","public.checklists","public.transactions"]}]}.',
  "Use exact qualified table names from the schema, including its actual schema/database prefix. Every actor's table must be included in its tables list. Each table has one home; put genuinely shared concepts in their own actor and retain their relationships. Technical or unclassified tables may remain outside the groups and appear under Other tables.",
  "Choose supporting tables explicitly, even several relationships away. A broader Booking actor may contain invoice groups, checklists and transactions; a smaller one may contain only bookings and invoice groups, leaving Checklists and Transactions as separate actors. Follow the application's meaning and the user's preference.",
  "Preserve existing authored groupings unless the task requires changing them. After a schema change, classify new tables, update renamed/removed references, then run vibe64-database refresh and vibe64-database overview --json to check coverage and warnings.",
  "abstraction is none (each physical table is its own actor), balanced (business actors with supporting tables), or high (a few broad business actors). Follow the generation request's selected level and scope. reviewedTables records every exact table name you have reviewed, including tables deliberately left under Other tables. Preserve this record on incremental work. For new-tables-only generation, process coverage.unreviewed only; preserve existing actors, memberships, names and manual choices, while allowing new tables to join existing actors. Full regeneration may replace the grouping and should review all current tables.",
  'Also author "rings": [["public.bookings"],["public.contacts","public.dogs","public.payments"]]. Rings run from the important business concepts in the centre out to smaller supporting concepts; each ring lists actors clockwise from the top. Include every actor exactly once. Choose the centre from application meaning, not just table count or technical foreign-key degree. Keep closely related actors in neighbouring angular sectors across rings. Use a few central actors, then major domains, then peripheral services; do not produce rows or a rectangular grid. Vibe64 calculates card sizes, generous spacing and routes. Preserve existing placement during incremental work, adding new actors near related concepts.',
  "Balanced should normally produce 5–10 actors; high should normally produce 3–5. These are useful targets, not quotas: use fewer for small schemas and explain any necessary excess. Avoid making each small feature or infrastructure service its own actor. Group related capabilities into understandable business concepts; put administration together where appropriate.",
  'For balanced and high, also write "mainRelationships": ["exact relationship id from schema.relationships"]. Choose the real foreign keys that best express the main business connections between actors. Typically each concept has one or two main connections. Do not select every cross-actor FK: workspace ownership, created_by/updated_by, audit authorship, shared attachments and similar administrative dependencies usually belong only in the detailed view. Keep any such relationship that is itself central to this application. An empty list is valid when no business links exist. Preserve existing choices on incremental work, adding main connections for new concepts where needed. Not abstract may omit this field to show all connections.',
  'Optional "positions" maps actor main-table names (or "other-tables") to {"x":number,"y":number}. These are user-dragged positions and override automatic rings. Preserve them during incremental updates; full regeneration may clear them to apply the new arrangement. Do not invent pixel coordinates.',
  "Do not invent relationships or cardinalities; mainRelationships must reference actual schema relationship IDs. Vibe64 retains the actual endpoints and all physical relationships in the ERD; users can also show all overview connections. Do not read data rows or credentials merely to classify tables. Do not edit Vibe64 runtime artifacts."
].join("\n");

export function validateDataOverview(value) {
  const fail = (message) => { throw new Error(`Data overview: ${message}`); };
  const record = (item, fields, label) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) fail(`${label} must be an object.`);
    if (Object.keys(item).some((key) => !fields.includes(key))) fail(`${label} contains unknown fields.`);
  };
  const text = (item, label, limit) => {
    if (typeof item !== "string" || !item.trim() || item.length > limit) fail(`${label} must be non-empty text of at most ${limit} characters.`);
    return item.trim();
  };
  record(value, ["version", "actors", "abstraction", "reviewedTables", "rings", "mainRelationships", "positions"], "document");
  if (value.version !== 1) fail("version must be 1.");
  if (!Array.isArray(value.actors) || value.actors.length > 2000) fail("actors must be an array of at most 2000 items.");
  if (value.abstraction !== undefined && !DATA_OVERVIEW_ABSTRACTIONS.some((item) => item.value === value.abstraction)) fail("abstraction must be none, balanced or high.");
  let reviewedTables;
  if (value.reviewedTables !== undefined) {
    if (!Array.isArray(value.reviewedTables) || value.reviewedTables.length > 2000) fail("reviewedTables must be an array of at most 2000 table names.");
    reviewedTables = value.reviewedTables.map((entry) => text(entry, "reviewed table name", 512));
    if (new Set(reviewedTables).size !== reviewedTables.length) fail("reviewedTables must not repeat a table.");
  }
  const assigned = new Set();
  const actors = value.actors.map((actor) => {
    record(actor, ["table", "name", "description", "tables"], "actor");
    const table = text(actor.table, "actor table", 512);
    const name = text(actor.name, "actor name", 120);
    if (typeof actor.description !== "string" || actor.description.length > 600) fail("description must be text of at most 600 characters.");
    if (!Array.isArray(actor.tables) || !actor.tables.length || actor.tables.length > 2000) fail(`${name} must include between 1 and 2000 tables.`);
    const tables = actor.tables.map((entry) => {
      const id = text(entry, "table name", 512);
      if (assigned.has(id)) fail(`${id} belongs to more than one group or is repeated.`);
      assigned.add(id);
      return id;
    });
    if (!tables.includes(table)) fail(`${name} must include its main table ${table}.`);
    return { table, name, description: actor.description.trim(), tables };
  });
  if (assigned.size > 2000) fail("at most 2000 tables may be classified.");
  let rings;
  if (value.rings !== undefined) {
    if (!Array.isArray(value.rings) || value.rings.length > 2000) fail("rings must be an array of at most 2000 rings.");
    const mainTables = new Set(actors.map((actor) => actor.table));
    const placed = new Set();
    rings = value.rings.map((ring) => {
      if (!Array.isArray(ring) || !ring.length || ring.length > 2000) fail("each ring must contain actor main tables.");
      return ring.map((entry) => {
        const table = text(entry, "ring actor", 512);
        if (!mainTables.has(table) || placed.has(table)) fail("rings must contain each actor exactly once, using its main table.");
        placed.add(table);
        return table;
      });
    });
    if (placed.size !== actors.length) fail("rings must place every actor.");
  }
  let mainRelationships;
  if (value.mainRelationships !== undefined) {
    if (!Array.isArray(value.mainRelationships) || value.mainRelationships.length > 2000) fail("mainRelationships must be an array of at most 2000 relationship IDs.");
    mainRelationships = value.mainRelationships.map((entry) => text(entry, "main relationship ID", 1024));
    if (new Set(mainRelationships).size !== mainRelationships.length) fail("mainRelationships must not repeat an ID.");
  }
  let positions;
  if (value.positions !== undefined) {
    const allowed = new Set([...actors.map(actor => actor.table), "other-tables"]);
    record(value.positions, [...allowed], "positions");
    positions = Object.fromEntries(Object.entries(value.positions).map(([table, position]) => {
      record(position, ["x", "y"], "actor position");
      if (![position.x, position.y].every(n => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= 1000000)) fail("actor coordinates must be finite numbers between -1000000 and 1000000.");
      return [table, { x: position.x, y: position.y }];
    }));
  }
  return {
    version: 1,
    actors,
    ...(value.abstraction !== undefined ? { abstraction: value.abstraction } : {}),
    ...(reviewedTables ? { reviewedTables } : {}),
    ...(rings ? { rings } : {}),
    ...(mainRelationships ? { mainRelationships } : {}),
    ...(positions ? { positions } : {})
  };
}

export function dataOverviewCoverage(schema = {}, definition = { actors: [] }) {
  const tables = new Set((schema.tables || []).map((table) => table.qualifiedName));
  const assigned = new Set(definition.actors.flatMap((actor) => actor.tables));
  const relationships = new Set((schema.relationships || []).map((relationship) => relationship.id));
  const reviewed = new Set([...(definition.reviewedTables || []), ...assigned]);
  return {
    total: tables.size,
    classified: [...tables].filter((table) => assigned.has(table)).length,
    others: [...tables].filter((table) => !assigned.has(table)),
    reviewed: [...tables].filter((table) => reviewed.has(table)).length,
    unreviewed: [...tables].filter((table) => !reviewed.has(table)),
    missing: [...assigned].filter((table) => !tables.has(table)),
    missingRelationships: (definition.mainRelationships || []).filter((id) => !relationships.has(id))
  };
}
