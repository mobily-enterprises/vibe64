export function dataOverviewSchema() {
  const names = ["contacts", "addresses", "dogs", "bookings", "invoice_groups", "checklists", "transactions", "audit_log"];
  const relationships = [
    ["contacts", "addresses"], ["contacts", "dogs"], ["contacts", "bookings"],
    ["dogs", "bookings"], ["bookings", "invoice_groups"], ["invoice_groups", "checklists"], ["invoice_groups", "transactions"]
  ].map(([parent, child]) => ({
    id: `${parent}_${child}`, constraintName: `${child}_${parent}_fk`,
    sourceTable: `public.${child}`, referencedTable: `public.${parent}`,
    columns: [`${parent}_id`], referencedColumns: ["id"], deleteAction: "CASCADE", updateAction: "NO ACTION"
  }));
  return {
    engine: "postgresql", database: "erd_test", refreshedAt: "2026-09-10T00:00:00Z", schemas: [{ name: "public" }], relationships,
    tables: names.map((name) => ({
      name, schema: "public", qualifiedName: `public.${name}`, kind: "table",
      columns: [{ name: "id", nativeType: "integer", nullable: false }, { name: "notes", nativeType: "text", nullable: true },
        ...relationships.filter((rel) => rel.sourceTable === `public.${name}`).map((rel) => ({ name: rel.columns[0], nativeType: "integer", nullable: false }))],
      keys: [{ primary: true, name: `${name}_pk`, columns: ["id"] }]
    }))
  };
}

export function bookingOverview({ split = false } = {}) {
  const actor = (name, table, tables) => ({ name, table: `public.${table}`, description: `${name} and supporting information`, tables: tables.map((value) => `public.${value}`) });
  return { version: 1, actors: [
    actor("Contacts", "contacts", ["contacts", "addresses"]), actor("Dogs", "dogs", ["dogs"]),
    actor("Bookings", "bookings", ["bookings", "invoice_groups", ...(split ? [] : ["checklists", "transactions"])]),
    ...(split ? [actor("Checklists", "checklists", ["checklists"]), actor("Transactions", "transactions", ["transactions"])] : [])
  ] };
}
