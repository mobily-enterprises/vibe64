function tableIdentity(table) {
  return JSON.stringify([table.resource, table.schema, table.table]);
}

function subsystemEntries(map, programCity, databaseState) {
  const operationsByPath = new Map((programCity?.buildings || []).map(operation => [operation.path, operation]));
  const ownersByTable = new Map((map?.subsystems || []).flatMap(entry => entry.dataOwned.map(table => [tableIdentity(table), entry])));
  function resolveTable(reference) {
    const key = tableIdentity(reference);
    const owner = ownersByTable.get(key);
    const connection = databaseState?.connection;
    const defaultSchema = databaseState?.schema?.defaultSchema ||
      (connection?.engine === "mysql" ? connection.database : "");
    const schema = reference.schema === "default" ? defaultSchema : reference.schema;
    const canResolve = Boolean(connection?.resourceId === reference.resource && schema);
    const table = canResolve
      ? (databaseState.schema?.tables || []).find((entry) => entry.schema === schema && entry.name === reference.table)
      : null;
    return {
      ...reference,
      key,
      ownerId: owner?.id,
      ownerTitle: owner?.title,
      qualifiedName: table?.qualifiedName || "",
      resolution: table ? "resolved" : canResolve ? "missing" : "unavailable"
    };
  }
  return (map?.subsystems || []).map(entry => ({
    ...entry,
    operations: entry.program.map(path => ({
      path,
      title: path.split("/").at(-1).replace(/\.md$/u, "").replace(/-/gu, " "),
      ...operationsByPath.get(path)
    })),
    dataOwned: entry.dataOwned.map(resolveTable),
    dataUsed: entry.dataUsed.map(resolveTable)
  }));
}

// Spatial presentation of declared membership, never operation-to-table inference.
function subsystemCity(map, programCity) {
  if (map?.status !== "valid") {
    return programCity;
  }
  const entries = subsystemEntries(map, programCity, null);
  return {
    ...programCity,
    schema: "genesis.program-city.v1",
    schemaVersion: 1,
    status: "valid",
    links: [],
    districts: entries.map(entry => ({
      id: `subsystem:${entry.id}`,
      path: entry.id,
      title: entry.title,
      description: entry.description,
      parentId: null
    })),
    buildings: entries.flatMap((entry) => {
      const districtId = `subsystem:${entry.id}`;
      const operations = entry.operations.map((operation) => ({
        ...operation,
        id: `operation:${operation.path}`,
        districtId,
        subsystem: entry.id,
        sources: operation.sources || [],
        publicContract: operation.publicContract || "Refresh Cities to load this operation’s explanation.",
        implementationMap: operation.implementationMap || "",
        description: operation.description || "",
        sourceFileIds: operation.sourceFileIds || []
      }));
      const tables = entry.dataOwned.map((table) => ({
        id: `table:${table.key}`,
        kind: "table",
        title: table.table,
        tableReference: table,
        districtId,
        subsystem: entry.id,
        path: "genesis/subsystems.md",
        sources: [],
        sourceFileIds: [],
        description: `Data owned by ${entry.title}.`,
        publicContract: "",
        implementationMap: ""
      }));
      return [...operations, ...tables];
    })
  };
}

export { subsystemEntries, subsystemCity, tableIdentity };
