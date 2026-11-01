import {
  createHash,
  randomUUID
} from "node:crypto";

import { isPlainObject, vibe64Error } from "@local/vibe64-core/server/core";
import { ERD_LAYOUT_MAX_BYTES } from "../shared/erdModel.js";
import { toText } from "@local/vibe64-core/shared/toText";

/** @typedef {import("@local/vibe64-runtime/server/types").Vibe64SessionStore} Vibe64SessionStore */

const SCHEMA_ARTIFACT_PATH = "database/schema.json";
const ERD_LAYOUT_ARTIFACT_PATH = "database/erd-layout.json";
const HISTORY_LIMIT = 50;
const SNIPPET_LIMIT = 100;
const LAYOUT_NODE_LIMIT = 2_000;
const writes = new Map();

function actorIdentity(vibe64User = null) {
  return toText(
    vibe64User?.username ||
    vibe64User?.id ||
    vibe64User?.email ||
    "local-owner"
  );
}

function actorKey(vibe64User = null) {
  return createHash("sha256")
    .update(`vibe64-database-user\u0000${actorIdentity(vibe64User)}`)
    .digest("hex")
    .slice(0, 20);
}

function workspaceArtifactPath(vibe64User = null) {
  return `database/workspace-${actorKey(vibe64User)}.json`;
}

function parseArtifact(value = "", label = "Database state") {
  const source = String(value || "").trim();
  if (!source) {
    return null;
  }
  try {
    return JSON.parse(source);
  } catch {
    throw vibe64Error(
      `${label} is damaged and could not be read.`,
      "vibe64_database_session_state_invalid"
    );
  }
}

/**
 * @param {Vibe64SessionStore} store
 * @param {string} [sessionId]
 */
async function readSchemaSnapshot(store, sessionId = "") {
  return parseArtifact(
    await store.readArtifact(sessionId, SCHEMA_ARTIFACT_PATH),
    "The refreshed database schema"
  );
}

/**
 * @param {Vibe64SessionStore} store
 * @param {string} [sessionId]
 * @param {object} [schema]
 */
async function writeSchemaSnapshot(store, sessionId = "", schema = {}) {
  await store.writeJsonArtifact(sessionId, SCHEMA_ARTIFACT_PATH, schema);
  return schema;
}

function emptyWorkspace() {
  return {
    history: [],
    snippets: [],
    version: 1
  };
}

function normalizedWorkspace(value = null) {
  const record = isPlainObject(value) ? value : {};
  return {
    history: Array.isArray(record.history) ? record.history.slice(0, HISTORY_LIMIT) : [],
    snippets: Array.isArray(record.snippets) ? record.snippets.slice(0, SNIPPET_LIMIT) : [],
    version: 1
  };
}

/**
 * @param {Vibe64SessionStore} store
 * @param {string} [sessionId]
 * @param {object | null} [vibe64User]
 */
async function readWorkspace(store, sessionId = "", vibe64User = null) {
  const value = parseArtifact(
    await store.readArtifact(sessionId, workspaceArtifactPath(vibe64User)),
    "The database workspace"
  );
  return value ? normalizedWorkspace(value) : emptyWorkspace();
}

function serializeWrite(key, operation) {
  const previous = writes.get(key) || Promise.resolve();
  const current = previous.catch(() => null).then(operation);
  writes.set(key, current);
  return current.finally(() => {
    if (writes.get(key) === current) {
      writes.delete(key);
    }
  });
}

/**
 * @param {Vibe64SessionStore} store
 * @param {string} [sessionId]
 * @param {object | null} [vibe64User]
 * @param {(workspace: object) => object | Promise<object>} operation
 */
async function mutateWorkspace(store, sessionId, vibe64User, operation) {
  const path = workspaceArtifactPath(vibe64User);
  return serializeWrite(`${sessionId}\u0000${path}`, async () => {
    const workspace = await readWorkspace(store, sessionId, vibe64User);
    const next = normalizedWorkspace(await operation(workspace) || workspace);
    await store.writeJsonArtifact(sessionId, path, next);
    return next;
  });
}

async function recordQueryHistory(store, sessionId = "", vibe64User = null, entry = {}) {
  return mutateWorkspace(store, sessionId, vibe64User, (workspace) => ({
    ...workspace,
    history: [{
      affectedRows: Number(entry.affectedRows || 0),
      at: toText(entry.at) || new Date().toISOString(),
      durationMs: Number(entry.durationMs || 0),
      id: randomUUID(),
      kind: toText(entry.kind),
      ok: entry.ok !== false,
      readOnly: entry.readOnly !== false,
      sql: String(entry.sql || "")
    }, ...workspace.history].slice(0, HISTORY_LIMIT)
  }));
}

async function saveSnippet(store, sessionId = "", vibe64User = null, input = {}) {
  const sql = String(input.sql || "").trim();
  if (!sql) {
    throw vibe64Error("Snippet SQL is required.", "vibe64_database_snippet_sql_required");
  }
  const id = toText(input.id) || randomUUID();
  const name = toText(input.name) || "Untitled query";
  return mutateWorkspace(store, sessionId, vibe64User, (workspace) => ({
    ...workspace,
    snippets: [{
      id,
      name: name.slice(0, 120),
      sql,
      updatedAt: new Date().toISOString()
    }, ...workspace.snippets.filter((snippet) => snippet.id !== id)].slice(0, SNIPPET_LIMIT)
  }));
}

async function deleteSnippet(store, sessionId = "", vibe64User = null, snippetId = "") {
  const id = toText(snippetId);
  return mutateWorkspace(store, sessionId, vibe64User, (workspace) => ({
    ...workspace,
    snippets: workspace.snippets.filter((snippet) => snippet.id !== id)
  }));
}

function finiteCoordinate(value) {
  const coordinate = Number(value);
  return Number.isFinite(coordinate)
    ? Math.max(-10_000_000, Math.min(10_000_000, coordinate))
    : 0;
}

function normalizedDiagram(value = null) {
  const record = isPlainObject(value) ? value : {};
  const nodes = Array.isArray(record.nodes) ? record.nodes : [];
  if (nodes.length > LAYOUT_NODE_LIMIT) {
    throw vibe64Error("The ERD layout contains too many nodes.", "vibe64_database_erd_layout_too_large");
  }
  return {
    routes: normalizedRoutes(record.routes),
    nodes: nodes.map((node) => ({
      collapsed: node?.collapsed === true,
      expanded: node?.expanded === true,
      pinned: node?.pinned === true,
      group: toText(node?.group).slice(0, 80),
      hidden: node?.hidden === true,
      table: toText(node?.table).slice(0, 512),
      x: finiteCoordinate(node?.x),
      y: finiteCoordinate(node?.y)
    })).filter((node) => node.table),
    columnMode: record.columnMode === "all" ? "all" : "keys",
    focusTable: toText(record.focusTable).slice(0, 512),
    activeGroup: toText(record.activeGroup).slice(0, 524),
    groups: (Array.isArray(record.groups) ? record.groups : []).slice(0, 50)
      .map((group) => ({ id: toText(group?.id).slice(0, 80), name: toText(group?.name).slice(0, 80) }))
      .filter((group) => group.id && group.name),
    viewport: {
      x: finiteCoordinate(record.viewport?.x),
      y: finiteCoordinate(record.viewport?.y),
      zoom: Math.max(0.08, Math.min(1.8, Number(record.viewport?.zoom) || 1))
    }
  };
}

function normalizedRoutes(value = []) {
  if (!Array.isArray(value) || value.length > 10_000 || Buffer.byteLength(JSON.stringify(value)) > ERD_LAYOUT_MAX_BYTES) {
    throw vibe64Error("The ERD connection paths are too large.", "vibe64_database_erd_layout_too_large");
  }
  return value.map((route) => {
    if (!toText(route?.id) ||
        !["left", "right"].includes(route.sourcePosition) ||
        !["left", "right"].includes(route.targetPosition) ||
      !Array.isArray(route.points) || route.points.length < 2 || route.points.length > 512 ||
      route.points.some((point) => !Number.isFinite(point?.x) || !Number.isFinite(point?.y))) {
      throw vibe64Error("The ERD connection path is invalid.", "vibe64_database_erd_route_invalid");
    }
    return {
      id: toText(route.id).slice(0, 1024),
      sourcePosition: route.sourcePosition,
      targetPosition: route.targetPosition,
      points: route.points.map(({ x, y }) => ({ x: finiteCoordinate(x), y: finiteCoordinate(y) })),
      obstructed: route.obstructed === true
    };
  });
}

function normalizedLayout(value = null) {
  return {
    ...normalizedDiagram(value),
    views: (Array.isArray(value?.views) ? value.views : []).slice(0, 20).map((view) => ({
      ...normalizedDiagram(view),
      id: toText(view?.id).slice(0, 80),
      name: toText(view?.name).slice(0, 80)
    })).filter((view) => view.id && view.name),
    updatedAt: toText(value?.updatedAt),
    revision: Number.isSafeInteger(value?.revision) ? value.revision : 0,
    version: 1
  };
}

/**
 * @param {Vibe64SessionStore} store
 * @param {string} [sessionId]
 */
async function readErdLayout(store, sessionId = "") {
  return normalizedLayout(parseArtifact(
    await store.readArtifact(sessionId, ERD_LAYOUT_ARTIFACT_PATH),
    "The database ERD layout"
  ));
}

/**
 * @param {Vibe64SessionStore} store
 * @param {string} [sessionId]
 * @param {object} [layout]
 * @param {object} [options]
 * @param {number} [options.expectedRevision]
 */
async function saveErdLayout(store, sessionId = "", layout = {}, options = {}) {
  const { expectedRevision } = options;
  const normalized = normalizedLayout(layout);
  if (Buffer.byteLength(JSON.stringify(normalized)) > ERD_LAYOUT_MAX_BYTES) {
    throw vibe64Error("The ERD layout is too large.", "vibe64_database_erd_layout_too_large");
  }
  return serializeWrite(`${sessionId}\u0000${ERD_LAYOUT_ARTIFACT_PATH}`, async () => {
    const previous = parseArtifact(await store.readArtifact(sessionId, ERD_LAYOUT_ARTIFACT_PATH), "The database ERD layout");
    if (expectedRevision !== undefined && expectedRevision !== (previous?.revision || 0)) {
      throw vibe64Error(
        "The ERD changed since you inspected it. Read it again before moving tables.",
        "vibe64_database_erd_layout_conflict"
      );
    }
    normalized.revision = (previous?.revision || 0) + 1;
    normalized.updatedAt = new Date().toISOString();
    await store.writeJsonArtifact(sessionId, ERD_LAYOUT_ARTIFACT_PATH, normalized);
    return normalized;
  });
}

export {
  HISTORY_LIMIT,
  LAYOUT_NODE_LIMIT,
  SCHEMA_ARTIFACT_PATH,
  SNIPPET_LIMIT,
  actorIdentity,
  actorKey,
  deleteSnippet,
  mutateWorkspace,
  readErdLayout,
  readSchemaSnapshot,
  readWorkspace,
  recordQueryHistory,
  saveErdLayout,
  saveSnippet,
  workspaceArtifactPath,
  writeSchemaSnapshot
};
