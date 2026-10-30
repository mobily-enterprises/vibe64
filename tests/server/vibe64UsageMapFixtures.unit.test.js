import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { validateCityDocument } from "@local/vibe64-genesis/server";
import {
  USAGE_INTERACTION_ID_PATTERN,
  USAGE_RECORDING_ID_PATTERN,
  USAGE_RECORDING_SCHEMA,
  USAGE_RECORDING_STATES,
  USAGE_RECORDING_STOP_REASONS,
  USAGE_REQUEST_ID_PATTERN,
  usageTraceLineProblem
} from "@local/vibe64-usage-recording/shared/contract";

// Shared fixtures for the usage map: a small project, its Machine City with
// entry points and call-web summary, its call web, and one stopped recording.
const fixture = (name) => new URL(`../fixtures/usage-map/${name}`, import.meta.url);
const bytes = (name) => readFileSync(fixture(name));
const json = (name) => JSON.parse(bytes(name).toString("utf8"));
const ndjson = (name) => bytes(name).toString("utf8").trimEnd().split("\n").map((line) => JSON.parse(line));
const sha = (buffer) => `sha256:${createHash("sha256").update(buffer).digest("hex")}`;

const machine = json("machine-city.json");
const architecture = machine.architecture;
const callWeb = json("call-web.json");
const functionAt = (index) => callWeb.functions[index];
const fileOf = (fn) => callWeb.files[fn.file];
const before = (left, right) => left.line < right.line || (left.line === right.line && left.column <= right.column);
const inside = (range, owner) => before(owner.start, range.start) && before(range.end, owner.end);

const FUNCTION_KINDS = ["function", "method", "constructor", "arrow", "closure", "module"];
const CALL_METHODS = ["checker", "di-binding", "route-action", "argument-flow", "import-scope", "same-file-name", "self", "receiver-name", "none"];
const EXACT_METHODS = ["checker", "di-binding", "route-action", "self"];
const ENTRY_KINDS = ["page", "component", "route", "action", "library-export", "cli-command", "job", "program-operation", "test"];

test("the fixture Machine City is a valid Genesis Machine City of the fixture project", () => {
  assert.equal(validateCityDocument(machine, "machine"), machine);
  for (const file of architecture.files) {
    assert.equal(sha(bytes(`project/${file.path}`)), file.hash, file.path);
  }
});

test("the Machine City summarises the call web it names", () => {
  const summary = architecture.callWeb;
  assert.equal(summary.path, ".genesis/call-web.json");
  assert.equal(summary.identity, sha(bytes("call-web.json")));
  assert.equal(summary.sourceIdentity, callWeb.sourceIdentity);
  assert.equal(summary.sourceIdentity, architecture.sourceHash);
  const certainty = (value) => callWeb.calls.filter((call) => call.certainty === value).length;
  assert.deepEqual(summary.counts, {
    functions: callWeb.functions.length,
    calls: callWeb.calls.length,
    exact: certainty("exact"),
    probable: certainty("probable"),
    unresolved: certainty("unresolved")
  });
  assert.deepEqual(summary.coverage, {
    generic: callWeb.files.filter((file) => file.coverage === "generic").length,
    adapters: { jskit: callWeb.files.filter((file) => file.coverage === "adapter:jskit").length }
  });
});

test("call-web files and functions are indexed records of the same snapshot", () => {
  assert.equal(callWeb.schema, "genesis.call-web.v1");
  assert.deepEqual(callWeb.diagnostics, []);
  const indexed = new Map(architecture.files.map((file) => [file.path, file]));
  for (const file of callWeb.files) {
    assert.equal(indexed.get(file.path)?.hash, file.hash, file.path);
    assert.equal(indexed.get(file.path).subsystemId, file.subsystemId, file.path);
    assert.ok(["adapter:jskit", "generic", "none"].includes(file.coverage), file.path);
  }
  const ids = new Set();
  for (const fn of callWeb.functions) {
    const file = fileOf(fn);
    assert.ok(file, fn.id);
    assert.equal(fn.id, `fn:${file.path}#${fn.start.line}:${fn.start.column}`);
    assert.ok(!ids.has(fn.id), `duplicate ${fn.id}`);
    ids.add(fn.id);
    assert.ok(FUNCTION_KINDS.includes(fn.kind), fn.id);
    assert.equal(typeof fn.name, "string");
    assert.ok(before(fn.start, fn.end) && (fn.start.line !== fn.end.line || fn.start.column !== fn.end.column), fn.id);
    assert.ok(fn.end.line <= indexed.get(file.path).lines, fn.id);
    if (fn.kind === "module") assert.deepEqual([fn.name, fn.start], ["", { line: 1, column: 1 }]);
  }
  for (const file of callWeb.files) {
    const index = callWeb.files.indexOf(file);
    assert.equal(callWeb.functions.filter((fn) => fn.file === index && fn.kind === "module").length, 1, `${file.path} module`);
  }
  assert.ok(callWeb.functions.some((fn) => fn.name === "" && fn.kind === "arrow"), "anonymous functions are included");
});

test("every call follows the certainty rules and never claims exact from the generic baseline", () => {
  for (const call of callWeb.calls) {
    const from = functionAt(call.from);
    const label = `${from.id} ${call.callee}`;
    assert.ok(from && call.targets.every((target) => functionAt(target)), label);
    assert.ok(CALL_METHODS.includes(call.method), label);
    assert.ok(call.callee.length > 0 && call.callee.length <= 120, label);
    assert.ok(inside(call.site, from), `${label} site lies inside its function`);
    if (call.certainty === "exact") {
      assert.equal(call.targets.length, 1, label);
      assert.ok(EXACT_METHODS.includes(call.method), label);
      assert.equal(fileOf(from).coverage.startsWith("adapter:"), true, `${label}: only adapters claim exact`);
    } else if (call.certainty === "probable") {
      assert.ok(call.targets.length === 1 || (call.targets.length >= 2 && call.targets.length <= 16), label);
      assert.notEqual(call.method, "none", label);
    } else {
      assert.equal(call.certainty, "unresolved", label);
      assert.deepEqual([call.targets, call.method], [[], "none"], label);
    }
  }
  const kinds = new Set(callWeb.calls.map((call) => `${call.certainty}:${call.targets.length > 1 ? "ambiguous" : call.targets.length}`));
  for (const kind of ["exact:1", "probable:1", "probable:ambiguous", "unresolved:0"]) assert.ok(kinds.has(kind), kind);
});

test("bridges join transport uses to route controllers", () => {
  assert.ok(callWeb.bridges.length > 0);
  for (const bridge of callWeb.bridges) {
    assert.ok(functionAt(bridge.from) && functionAt(bridge.to));
    assert.equal(bridge.kind, "operation");
    assert.ok(["exact", "probable"].includes(bridge.certainty));
    const { protocol, scope, method, operation } = bridge.operationKey;
    assert.ok(protocol && scope && method === method.toUpperCase() && operation);
    const route = architecture.entryPoints.find((entry) => entry.kind === "route" && entry.functionIds.includes(functionAt(bridge.to).id));
    assert.deepEqual(route?.operationKey, bridge.operationKey);
  }
});

test("entry points reference indexed files and call-web functions", () => {
  const files = new Map(architecture.files.map((file) => [file.path, file]));
  const functionIds = new Set(callWeb.functions.map((fn) => fn.id));
  const ids = new Set();
  for (const entry of architecture.entryPoints) {
    assert.ok(!ids.has(entry.id) && entry.id.startsWith(`entry:${entry.kind}:`), entry.id);
    ids.add(entry.id);
    assert.ok(ENTRY_KINDS.includes(entry.kind), entry.id);
    assert.equal(entry.resolution, "resolved");
    assert.ok(entry.title && files.has(entry.file), entry.id);
    assert.ok(entry.functionIds.every((id) => functionIds.has(id)), entry.id);
    for (const evidence of entry.evidence) assert.equal(sha(bytes(`project/${evidence.path}`)), evidence.hash, entry.id);
    for (const field of ["pageId", "componentId", "operationKey", "actionId"]) assert.ok(Object.hasOwn(entry, field), `${entry.id} ${field}`);
    if (["page", "component"].includes(entry.kind)) assert.deepEqual(entry.functionIds, [], `${entry.id} starts from its file`);
    if (entry.kind === "route") assert.ok(entry.operationKey && entry.functionIds.length === 1, entry.id);
    if (entry.kind === "action") assert.ok(entry.actionId && entry.functionIds.length === 1, entry.id);
    if (entry.kind === "test") {
      const index = callWeb.files.findIndex((file) => file.path === entry.file);
      assert.deepEqual(entry.functionIds, callWeb.functions.filter((fn) => fn.file === index).map((fn) => fn.id));
    }
  }
  const kinds = new Set(architecture.entryPoints.map((entry) => entry.kind));
  assert.deepEqual([...kinds].sort(), ENTRY_KINDS.filter((kind) => kind !== "job").sort(), "every kind except job is present");
});

test("one fixture file is reached only through a type-only import", () => {
  const typeOnly = architecture.relations.filter((relation) => relation.typeOnly && relation.resolution === "resolved");
  assert.ok(typeOnly.some((relation) => !architecture.relations.some((other) => !other.typeOnly && other.targetFileId === relation.targetFileId)));
  const untouched = architecture.subsystems.filter((subsystem) => subsystem.root === "packages/reports");
  assert.equal(untouched.length, 1, "a subsystem that the component entry never reaches");
});

test("the recording trace is well formed and declares before it uses", () => {
  const lines = ndjson("recording/hits-nodejs-4242.ndjson");
  for (const line of lines) assert.equal(usageTraceLineProblem(line), "", JSON.stringify(line));
  assert.equal(lines[0].type, "header");
  assert.deepEqual(lines.at(-1), { type: "tracer", state: "idle" });
  const files = new Set();
  const functions = new Set();
  const scopes = new Set();
  for (const line of lines) {
    if (line.type === "file") files.add(line.fileIndex);
    if (line.type === "function") {
      assert.ok(files.has(line.fileIndex), `file ${line.fileIndex} declared first`);
      functions.add(line.functionIndex);
    }
    if (line.type === "scope") scopes.add(line.scope);
    if (line.type === "hits") {
      assert.ok(scopes.has(line.scope), `${line.scope} declared first`);
      for (const [index] of line.counts) assert.ok(functions.has(index), `function ${index} declared first`);
    }
  }
  for (const line of lines) assert.ok(Buffer.byteLength(JSON.stringify(line)) <= 64 * 1024);
});

test("the recording files match the recording API fixtures", () => {
  const recording = json("recording/recording.json");
  assert.equal(recording.schema, USAGE_RECORDING_SCHEMA);
  assert.ok(USAGE_RECORDING_ID_PATTERN.test(recording.id));
  assert.ok(USAGE_RECORDING_STATES.includes(recording.state));
  assert.ok(USAGE_RECORDING_STOP_REASONS.includes(recording.stopReason));
  assert.equal(recording.sourceIdentity, callWeb.sourceIdentity);
  const apiRecording = Object.fromEntries(Object.entries(recording).filter(([key]) => !["schema", "sourceIdentity", "limits"].includes(key)));
  assert.deepEqual(json("recording/api/current.json").recording, apiRecording);
  assert.deepEqual(json("recording/api/list.json").recordings, [apiRecording]);
  assert.deepEqual(json("recording/control.json"), { state: "stopping" });

  const requests = ndjson("recording/requests.ndjson");
  requests.forEach((request, index) => {
    assert.ok(USAGE_REQUEST_ID_PATTERN.test(request.id));
    assert.equal(request.seq, index + 1);
    assert.ok(!/[?#]/u.test(request.path), "paths never keep a query or fragment");
  });
  const interactions = ndjson("recording/interactions.ndjson");
  for (const interaction of interactions) assert.ok(USAGE_INTERACTION_ID_PATTERN.test(interaction.id));
  const all = json("recording/api/requests-include-empty.json");
  assert.deepEqual(all.requests.map((row) => row.id), requests.map((request) => request.id));
  assert.deepEqual(json("recording/api/requests.json").requests, all.requests.filter((row) => row.functionCount > 0));
  assert.ok(all.requests.some((row) => row.functionCount === 0), "one request ran no project code");

  const captured = all.requests.filter((row) => row.functionCount > 0);
  assert.equal(recording.counts.requests, captured.length);
  const ranIn = new Map();
  for (const row of captured) {
    const { functions, total, truncated } = json(`recording/api/request-functions/${row.id}.json`);
    assert.deepEqual([total, truncated, row.functionCount, row.fileCount], [functions.length, false, functions.length, new Set(functions.map((fn) => fn.path)).size]);
    for (const fn of functions) ranIn.set(`${fn.path}#${fn.start.line}:${fn.start.column}`, (ranIn.get(`${fn.path}#${fn.start.line}:${fn.start.column}`) || 0) + 1);
  }
  for (const row of captured) {
    for (const fn of json(`recording/api/request-functions/${row.id}.json`).functions) {
      const share = ranIn.get(`${fn.path}#${fn.start.line}:${fn.start.column}`) / captured.length;
      assert.equal(fn.plumbing, captured.length >= 3 && share >= 0.8, `${row.id} ${fn.name}`);
    }
  }
});

test("the expected join covers exact, name-line, stale and unknown functions", () => {
  const { functions } = json("recording/api/join/r_000004-request.json");
  const { joined, edges, subsystems } = json("recording/api/join/r_000004-response.json");
  const files = new Map(callWeb.files.map((file) => [file.path, file]));
  const byId = new Map(callWeb.functions.map((fn) => [fn.id, fn]));
  assert.equal(joined.length, functions.length);
  joined.forEach((result, index) => {
    const candidate = functions[index];
    const file = files.get(candidate.path);
    assert.equal(result.index, index);
    if (result.join === "exact" || result.join === "name-line") {
      const fn = byId.get(result.functionId);
      assert.equal(file.hash, candidate.hash);
      assert.equal(fileOf(fn).path, candidate.path);
      if (result.join === "exact") assert.deepEqual(fn.start, candidate.start);
      else assert.ok(fn.name === candidate.name && Math.abs(fn.start.line - candidate.start.line) <= 3);
    } else if (result.join === "stale") {
      assert.ok(file && file.hash !== candidate.hash && result.functionId === null);
    } else {
      assert.deepEqual([result.join, result.functionId, files.has(candidate.path)], ["none", null, false]);
    }
  });
  assert.deepEqual([...new Set(joined.map((result) => result.join))].sort(), ["exact", "name-line", "none", "stale"]);
  for (const edge of edges) {
    for (const end of [edge.from, edge.to]) assert.ok(["exact", "name-line"].includes(joined[end].join), "edges join only joined functions");
  }
  assert.deepEqual(subsystems.map((subsystem) => subsystem.id), [...new Set(joined.map((result) => result.subsystemId).filter(Boolean))].sort());
});
