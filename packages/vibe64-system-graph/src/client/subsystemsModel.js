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

export { subsystemEntries, tableIdentity };
