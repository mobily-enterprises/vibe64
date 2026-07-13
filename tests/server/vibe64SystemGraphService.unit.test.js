import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  sourceContractRootEntryIsAllowed
} from "../../packages/vibe64-core/src/server/projectManifest.js";

import {
  applySystemFindings
} from "../../packages/vibe64-system-graph/src/server/findings.js";
import {
  JSKIT_SYSTEM_ADAPTER_VERSION
} from "../../packages/vibe64-system-graph/src/server/adapters/jskit/JskitSystemAdapter.js";
import {
  createService
} from "../../packages/vibe64-system-graph/src/server/service.js";
import {
  readSystemDocument,
  systemDeclarationsDigest,
  writeSystemDocument
} from "../../packages/vibe64-system-graph/src/server/systemDocument.js";

function projectServiceFor(root, adapterId = "jskit") {
  return {
    async createRuntime() {
      return {
        adapter: {
          id: adapterId
        },
        async getSession(sessionId) {
          return {
            metadata: {
              adapter_id: adapterId
            },
            sessionId,
            sourcePath: root,
            targetRoot: root
          };
        }
      };
    }
  };
}

function modelFixture({
  declarations = [],
  sourceDigest = "source-digest",
  sourceHead = "source-head"
} = {}) {
  const model = {
    adapter: {
      id: "jskit",
      version: JSKIT_SYSTEM_ADAPTER_VERSION
    },
    input: {
      declarationsDigest: systemDeclarationsDigest(declarations),
      extractionDigest: "extract-digest",
      sourceDigest,
      sourceHead
    },
    declarations,
    files: [{
      bytes: 6400,
      executionSide: "client",
      hash: "client-hash",
      id: "file:packages/client/src/client.js",
      implementedEntityIds: ["component:client"],
      imports: [],
      lines: 160,
      packageId: "@local/client",
      path: "packages/client/src/client.js"
    }],
    entities: [{
      description: "Fixture system.",
      executionSide: "shared",
      id: "system:fixture",
      kind: "system",
      metadata: {
        descriptorPath: "",
        executionSides: ["client", "server"],
        inputKnown: false,
        method: "",
        outputKnown: false,
        packageId: "",
        path: "",
        sourceLine: 0,
        sourcePath: "",
        summary: ""
      },
      origin: "derived",
      parentId: "",
      title: "Fixture"
    }, {
      description: "Client shell.",
      executionSide: "client",
      id: "subsystem:client",
      kind: "subsystem",
      metadata: {
        descriptorPath: "packages/client/package.descriptor.mjs",
        executionSides: ["client"],
        inputKnown: false,
        method: "",
        outputKnown: false,
        packageId: "@local/client",
        path: "",
        sourceLine: 0,
        sourcePath: "",
        summary: ""
      },
      origin: "derived",
      parentId: "system:fixture",
      title: "Client"
    }, {
      description: "Uses a missing operation.",
      executionSide: "client",
      id: "component:client",
      kind: "component",
      metadata: {
        descriptorPath: "",
        executionSides: [],
        inputKnown: false,
        method: "",
        outputKnown: false,
        packageId: "@local/client",
        path: "",
        sourceLine: 12,
        sourcePath: "packages/client/src/client.js",
        summary: ""
      },
      origin: "derived",
      parentId: "subsystem:client",
      title: "Client request"
    }],
    relationships: [{
      evidenceIds: [],
      from: "system:fixture",
      id: "relationship:contains:client",
      kind: "contains",
      origin: "derived",
      packageId: "@local/client",
      to: "subsystem:client",
      value: ""
    }, {
      evidenceIds: ["evidence:client-request"],
      from: "component:client",
      id: "relationship:consumes:missing",
      kind: "consumes",
      origin: "derived",
      packageId: "@local/client",
      to: "",
      value: "POST /sessions/:sessionId/missing"
    }],
    evidence: [{
      column: 1,
      id: "evidence:client-request",
      kind: "client-request",
      line: 12,
      path: "packages/client/src/client.js"
    }],
    findings: [],
    diagnostics: [],
    coverage: {},
    provenance: {
      authoritativeScopeIds: ["@local/client"],
      updateMode: "full"
    }
  };
  return applySystemFindings(model);
}

function constantSnapshot() {
  return {
    changed: [],
    changedPaths: [],
    digest: "source-digest",
    head: "source-head"
  };
}

async function withTempRoot(operation) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-system-service-"));
  try {
    await operation(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("vibe64.system.json is a portable root source-contract file", () => {
  assert.equal(sourceContractRootEntryIsAllowed("vibe64.system.json"), true);
});

test("System status is explicitly unsupported when Vibe64 has no System adapter", async () => {
  await withTempRoot(async (root) => {
    const service = createService({
      projectService: projectServiceFor(root, "laravel"),
      snapshotReader: async () => constantSnapshot()
    });
    const status = await service.readStatus({ sessionId: "session-1" });
    assert.equal(status.ok, true);
    assert.equal(status.status, "unsupported");
    assert.equal(status.adapterId, "laravel");
  });
});

test("manual update streams progress, writes one document, and exposes focused projections", async () => {
  await withTempRoot(async (root) => {
    const model = modelFixture();
    const service = createService({
      modelBuilder: async ({ adapterId, snapshot }) => {
        assert.equal(adapterId, "jskit");
        model.input.sourceDigest = snapshot.digest;
        model.input.sourceHead = snapshot.head;
        return {
          delta: {
            addedEntityIds: model.entities.map((entity) => entity.id),
            changedFiles: [],
            removedEntityIds: []
          },
          fallbackReason: "",
          model,
          scopes: [],
          updateMode: "full",
          updateReason: "missing-document"
        };
      },
      projectService: projectServiceFor(root),
      snapshotReader: async () => constantSnapshot()
    });

    const missing = await service.readStatus({ sessionId: "session-1" });
    assert.equal(missing.status, "missing");
    const started = await service.startUpdate({ sessionId: "session-1" });
    assert.equal(started.ok, true);
    const events = [];
    await service.streamUpdate({
      sessionId: "session-1",
      updateId: started.update.updateId
    }, {
      emit: (event) => events.push(event),
      isClosed: () => false
    });
    assert.ok(events.some((event) => event.type === "system-update.analysis-started"));
    assert.equal(events.at(-1).type, "system-update.completed");

    const written = await readSystemDocument(root);
    assert.equal(written.exists, true);
    assert.equal(written.model.entities.length, 3);
    const status = await service.readStatus({ sessionId: "session-1" });
    assert.equal(status.status, "current");

    const overview = await service.readOverview({ sessionId: "session-1" });
    assert.equal(overview.ok, true);
    assert.equal(overview.overview.entities.length, 3);
    assert.equal(overview.overview.fileMass[0].lines, 160);
    assert.equal(overview.overview.files.length, 1);
    assert.equal(overview.overview.files[0].subsystemTitle, "Client");
    assert.equal(overview.overview.files[0].purpose, "Uses a missing operation.");
    assert.deepEqual(overview.overview.lineStats, {
      files: 1,
      largest: 160,
      smallest: 160,
      total: 160
    });
    const fileKey = overview.overview.entities.find((entity) => entity.id === "component:client").key;
    const invalidEntity = await service.readEntity({
      entityKey: `${fileKey}!`,
      sessionId: "session-1"
    });
    assert.equal(invalidEntity.ok, false);
    assert.equal(invalidEntity.code, "vibe64_system_graph_failed");
  });
});

test("accepting a finding writes an evidence-bound declaration without changing source code", async () => {
  await withTempRoot(async (root) => {
    const model = modelFixture();
    model.input.declarationsDigest = "initial";
    await writeSystemDocument(root, model);
    const service = createService({
      projectService: projectServiceFor(root),
      snapshotReader: async () => constantSnapshot()
    });
    const finding = model.findings.find((candidate) => candidate.rule === "client_operation_without_server_operation");
    const accepted = await service.acceptFinding({
      findingId: finding.id,
      reason: "External service is intentionally absent in this fixture.",
      sessionId: "session-1"
    });
    assert.equal(accepted.ok, true);
    assert.equal(accepted.finding.status, "accepted");

    const written = await readSystemDocument(root);
    assert.equal(written.model.declarations.length, 1);
    assert.equal(written.model.declarations[0].kind, "finding-acceptance");
    assert.equal(written.model.findings[0].status, "accepted");
  });
});

test("subsystem strata persist in the current-state document and can return to baseline", async () => {
  await withTempRoot(async (root) => {
    const model = modelFixture();
    await writeSystemDocument(root, model);
    const service = createService({
      projectService: projectServiceFor(root),
      snapshotReader: async () => constantSnapshot()
    });
    const initialOverview = await service.readOverview({ sessionId: "session-1" });
    const subsystem = initialOverview.overview.subsystems.find((candidate) => candidate.id === "subsystem:client");

    const lowered = await service.setSubsystemDepth({
      depth: 4,
      sessionId: "session-1",
      subsystemKey: subsystem.key
    });
    assert.equal(lowered.ok, true);
    assert.equal(lowered.depth, 4);
    const loweredOverview = await service.readOverview({ sessionId: "session-1" });
    assert.equal(loweredOverview.overview.subsystems[0].depth, 4);
    let written = await readSystemDocument(root);
    assert.deepEqual(written.model.declarations, [{
      depth: 4,
      kind: "subsystem-depth",
      subsystemId: "subsystem:client"
    }]);
    assert.equal(
      written.model.input.declarationsDigest,
      systemDeclarationsDigest(written.model.declarations)
    );

    const restored = await service.setSubsystemDepth({
      depth: 0,
      sessionId: "session-1",
      subsystemKey: subsystem.key
    });
    assert.equal(restored.ok, true);
    written = await readSystemDocument(root);
    assert.deepEqual(written.model.declarations, []);
  });
});
