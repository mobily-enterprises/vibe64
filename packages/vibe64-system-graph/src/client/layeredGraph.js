// Consumer -> dependency. Condense cycles before ranking; never delete back edges.
export function layeredGraph(nodes = [], edges = []) {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const outgoing = new Map([...byId.keys()].map(id => [id, new Set()]));
  const incoming = new Map([...byId.keys()].map(id => [id, new Set()]));
  const validEdges = edges.filter(edge => byId.has(edge.fromId) && byId.has(edge.toId) && edge.fromId !== edge.toId);
  for (const edge of validEdges) { outgoing.get(edge.fromId).add(edge.toId); incoming.get(edge.toId).add(edge.fromId); }
  const visited = new Set();
  const finish = [];
  // Iterative DFS keeps large graphs independent of the JavaScript call-stack limit.
  for (const id of [...byId.keys()].sort()) {
    if (visited.has(id)) continue;
    const stack = [[id, false]];
    while (stack.length) {
      const [current, complete] = stack.pop();
      if (complete) { finish.push(current); continue; }
      if (visited.has(current)) continue;
      visited.add(current); stack.push([current, true]);
      for (const target of outgoing.get(current)) if (!visited.has(target)) stack.push([target, false]);
    }
  }
  const groupById = new Map();
  const groups = [];
  for (const id of finish.reverse()) {
    if (groupById.has(id)) continue;
    const members = [];
    const stack = [id];
    const group = { id: '', members, dependencies: new Set(), consumers: new Set(), rank: 0 };
    while (stack.length) {
      const current = stack.pop();
      if (groupById.has(current)) continue;
      groupById.set(current, group); members.push(current);
      for (const source of incoming.get(current)) if (!groupById.has(source)) stack.push(source);
    }
    members.sort(); group.id = JSON.stringify(members); group.cyclic = members.length > 1; groups.push(group);
  }
  for (const edge of validEdges) {
    const source = groupById.get(edge.fromId); const target = groupById.get(edge.toId);
    if (source === target) continue;
    source.dependencies.add(target); target.consumers.add(source);
  }
  const remaining = new Map(groups.map(group => [group, group.dependencies.size]));
  const queue = groups.filter(group => !group.dependencies.size);
  for (let index = 0; index < queue.length; index++) {
    const group = queue[index];
    for (const consumer of group.consumers) {
      consumer.rank = Math.max(consumer.rank, group.rank + 1);
      remaining.set(consumer, remaining.get(consumer) - 1);
      if (!remaining.get(consumer)) queue.push(consumer);
    }
  }
  const rows = new Map();
  for (const group of groups) {
    if (!rows.has(group.rank)) rows.set(group.rank, []);
    rows.get(group.rank).push(group);
  }
  const layers = [...rows].sort(([a], [b]) => b - a).map(([rank, row]) => ({ rank, groups: row.sort((a, b) => a.id.localeCompare(b.id)).map(group => ({ id: group.id, rank, cyclic: group.cyclic, members: group.members.map(id => byId.get(id)) })) }));
  return { layers, edges: validEdges, disconnectedIds: new Set([...byId.keys()].filter(id => !outgoing.get(id).size && !incoming.get(id).size)), nodeRanks: new Map([...groupById].map(([id, group]) => [id, group.rank])), cyclicIds: new Set([...groupById].filter(([, group]) => group.cyclic).map(([id]) => id)) };
}

export function architectureGraph(architecture, subsystemId = '', { includeTypeOnly = false } = {}) {
  const files = architecture?.files || [];
  const subsystems = architecture?.subsystems || [];
  const packages = architecture?.packages || [];
  const relations = (architecture?.relations || []).filter(relation => (includeTypeOnly || !(relation.typeOnly || relation.kind === 'type-import')) && relation.resolution === 'resolved' && (relation.targetFileId || relation.targetPackageId));
  const usedPackages = new Set(relations.map(relation => relation.targetPackageId));
  const boundaries = packages.map(entry => ({ ...entry, title: entry.name, kind: 'package', path: entry.root, fileIds: [], provenance: 'package' }));
  const filesById = new Map([...files, ...boundaries].map(file => [file.id, file]));
  const sourceFileIds = new Set(files.map(file => file.id));
  const fileEdges = relations.map(relation => ({ fromId: relation.fromFileId, toId: relation.targetFileId || relation.targetPackageId, evidence: [relation] }));
  const concrete = layeredGraph(files, fileEdges.filter(edge => sourceFileIds.has(edge.toId)));
  const externalCycleFileIds = new Set();
  if (subsystemId) for (const row of concrete.layers) for (const component of row.groups) {
    if (component.cyclic && component.members.some(file => file.subsystemId === subsystemId) && component.members.some(file => file.subsystemId !== subsystemId)) {
      for (const file of component.members) if (file.subsystemId === subsystemId) externalCycleFileIds.add(file.id);
    }
  }
  const localPackageIds = new Set(relations.filter(relation => filesById.get(relation.fromFileId)?.subsystemId === subsystemId && !relation.targetFileId).map(relation => relation.targetPackageId));
  const nodes = subsystemId ? [...files.filter(file => file.subsystemId === subsystemId), ...boundaries.filter(entry => localPackageIds.has(entry.id))] : subsystems.filter(entry => !entry.opaque || usedPackages.has(entry.packageId));
  const aggregated = new Map();
  const boundary = [];
  for (const edge of fileEdges) {
    const from = filesById.get(edge.fromId); const to = filesById.get(edge.toId);
    if (!from || !to) continue;
    if (subsystemId) {
      if (from.subsystemId === subsystemId && (to.subsystemId === subsystemId || localPackageIds.has(to.id))) {
        const key = JSON.stringify([edge.fromId, edge.toId]);
        if (!aggregated.has(key)) aggregated.set(key, { ...edge, evidence: [] });
        aggregated.get(key).evidence.push(...edge.evidence);
      }
      else if (from.subsystemId === subsystemId || to.subsystemId === subsystemId) boundary.push({ ...edge, from, to });
    } else if (from.subsystemId !== to.subsystemId) {
      const key = `${from.subsystemId}->${to.subsystemId}`;
      if (!aggregated.has(key)) aggregated.set(key, { fromId: from.subsystemId, toId: to.subsystemId, evidence: [] });
      aggregated.get(key).evidence.push(...edge.evidence);
    }
  }
  const graph = layeredGraph(nodes, [...aggregated.values()]);
  const groupByOwner = new Map(graph.layers.flatMap(layer => layer.groups.flatMap(group => group.members.map(member => [member.id, group.id]))));
  const concreteCycleGroups = new Set();
  if (!subsystemId) for (const row of concrete.layers) for (const component of row.groups) {
    if (!component.cyclic) continue;
    const owners = new Set(component.members.map(file => file.subsystemId));
    const groups = new Set([...owners].map(id => groupByOwner.get(id)));
    if (owners.size > 1 && groups.size === 1) concreteCycleGroups.add(groups.values().next().value);
  }
  for (const layer of graph.layers) for (const group of layer.groups) {
    group.cycleLabel = group.cyclic && !subsystemId && !concreteCycleGroups.has(group.id) ? 'Bidirectional subsystem coupling' : 'Dependency cycle';
  }
  return { ...graph, boundary, externalCycleFileIds };
}
