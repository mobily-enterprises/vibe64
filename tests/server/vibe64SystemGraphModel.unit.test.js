import assert from "node:assert/strict";
import { test } from "node:test";

import {
  decodeSystemDocument,
  encodeSystemDocument,
  serializeSystemDocument
} from "../../packages/vibe64-system-graph/src/server/documentCodec.js";
import { applySystemFindings } from "../../packages/vibe64-system-graph/src/server/findings.js";
import {
  entityDetails,
  fileConstellation,
  systemOverview
} from "../../packages/vibe64-system-graph/src/server/modelProjections.js";
import {
  compileJskitSystemModel
} from "../../packages/vibe64-system-graph/src/server/adapters/jskit/compileJskitSystemModel.js";

function provider({ entrypoint, exportName, packageId, side }) {
  return {
    id: `jskit:component:provider:${packageId}:${exportName}`,
    entrypoint,
    evidence: [{ path: `packages/${packageId.split("/").pop()}/package.descriptor.mjs` }],
    exportName,
    side
  };
}

function packageFact({ dependsOn = [], name, providers = [] }) {
  const packageId = `@local/${name}`;
  return {
    id: `jskit:subsystem:package:${packageId}`,
    packageId,
    version: "0.1.0",
    description: `${name} responsibility`,
    relativeDir: `packages/${name}`,
    descriptorPath: `packages/${name}/package.descriptor.mjs`,
    sourceType: "app-local-package",
    dependsOn,
    capabilities: {
      provides: [`feature.${name}`],
      requires: []
    },
    providers,
    executionSides: []
  };
}

function fileFact({
  calls = [],
  executionSide = "unknown",
  imports = [],
  lines = 10,
  packageId = "",
  path
}) {
  return {
    path,
    hash: `hash-${path}`,
    bytes: lines * 40,
    lines,
    packageId,
    executionSide,
    executionSideEvidence: [],
    exports: [],
    imports,
    calls,
    routes: []
  };
}

function extractionFixture({
  clientSuffix = "/terminal",
  routeSummary = "Start a terminal.",
  serverProviders = true
} = {}) {
  const clientPackageId = "@local/client-shell";
  const serverPackageId = "@local/terminal";
  const clientProvider = provider({
    entrypoint: "packages/client-shell/src/client/ClientProvider.js",
    exportName: "ClientProvider",
    packageId: clientPackageId,
    side: "client"
  });
  const terminalProvider = provider({
    entrypoint: "packages/terminal/src/server/TerminalProvider.js",
    exportName: "TerminalProvider",
    packageId: serverPackageId,
    side: "server"
  });
  return {
    schema: "vibe64.system.jskit-facts.v1",
    version: 1,
    input: {
      digest: "extract-digest",
      rootPackage: {
        name: "fixture-app",
        version: "0.1.0"
      }
    },
    scope: {
      mode: "full",
      requestedPackageIds: [],
      authoritativePackageIds: [clientPackageId, serverPackageId],
      fullScanRequired: false,
      unknownPackageIds: []
    },
    packages: [
      packageFact({
        dependsOn: [serverPackageId],
        name: "client-shell",
        providers: [clientProvider]
      }),
      packageFact({
        name: "terminal",
        providers: serverProviders ? [terminalProvider] : []
      })
    ],
    files: [
      fileFact({
        calls: [{
          arguments: [null, null, clientSuffix],
          contextCalls: ["useCommand"],
          line: 12,
          name: "vibe64SessionPath",
          ownerFunction: "startTerminalCommand"
        }],
        executionSide: "client",
        imports: [{
          kind: "import",
          line: 1,
          specifier: "./clientHelper.js",
          classification: "local-file",
          targetFile: "packages/client-shell/src/client/clientHelper.js",
          targetPackageId: clientPackageId
        }],
        packageId: clientPackageId,
        path: "packages/client-shell/src/client/ClientProvider.js"
      }),
      fileFact({
        executionSide: "client",
        lines: 24,
        packageId: clientPackageId,
        path: "packages/client-shell/src/client/clientHelper.js"
      }),
      fileFact({
        calls: [{
          arguments: [
            "POST",
            "/sessions/:sessionId/terminal",
            {
              body: { identifier: "terminalInputValidator" },
              summary: routeSummary
            }
          ],
          contextCalls: [],
          line: 30,
          name: "serviceRoute",
          ownerFunction: "registerRoutes"
        }],
        executionSide: "server",
        imports: [{
          kind: "import",
          line: 2,
          specifier: "./largeTerminalService.js",
          classification: "local-file",
          targetFile: "packages/terminal/src/server/largeTerminalService.js",
          targetPackageId: serverPackageId
        }],
        packageId: serverPackageId,
        path: "packages/terminal/src/server/registerRoutes.js"
      }),
      fileFact({
        executionSide: "server",
        lines: 1400,
        packageId: serverPackageId,
        path: "packages/terminal/src/server/largeTerminalService.js"
      }),
      fileFact({
        executionSide: "server",
        packageId: serverPackageId,
        path: "packages/terminal/src/server/TerminalProvider.js"
      })
    ],
    relationships: [],
    diagnostics: [],
    coverage: {}
  };
}

function compiledModel(options = {}) {
  return applySystemFindings(compileJskitSystemModel(extractionFixture(options), {
    input: {
      sourceDigest: "source-digest",
      sourceHead: "abc123"
    }
  }));
}

test("model compiler creates the client plug to server socket to provider path", () => {
  const model = compiledModel();
  assert.deepEqual(
    model.adapter.fileCity.campuses.map((campus) => ({ id: campus.id, roots: campus.roots, title: campus.title })),
    [
      { id: "application", roots: ["src"], title: "Application (client side)" },
      { id: "packages", roots: ["packages"], title: "Packages" }
    ]
  );
  const operation = model.entities.find((entity) => entity.kind === "operation");
  assert.equal(operation.id, "http:operation:app:POST:/sessions/:sessionId/terminal");
  assert.equal(operation.title, "Start a terminal");
  assert.equal(operation.executionSide, "server");

  const consumes = model.relationships.find((relationship) => relationship.kind === "consumes");
  assert.equal(consumes.to, operation.id);
  assert.equal(consumes.value, "POST /sessions/:sessionId/terminal");
  const handles = model.relationships.find((relationship) => relationship.kind === "handles");
  assert.equal(handles.to, operation.id);
  assert.match(handles.from, /TerminalProvider/u);
  assert.equal(model.findings.some((finding) => finding.rule === "client_operation_without_server_operation"), false);
  assert.equal(model.findings.some((finding) => finding.rule === "operation_without_provider"), false);

  const largestFile = model.files.find((file) => file.path.endsWith("largeTerminalService.js"));
  assert.equal(largestFile.lines, 1400);
  assert.ok(largestFile.implementedEntityIds.length === 0);

  const terminalSubsystem = model.entities.find((entity) => (
    entity.id === "jskit:subsystem:package:@local/terminal"
  ));
  assert.deepEqual(terminalSubsystem.metadata.anchors.map(({ kind, path, relation, origin }) => ({
    kind,
    path,
    relation,
    origin
  })), [{
    kind: "directory",
    path: "packages/terminal",
    relation: "owns",
    origin: "derived"
  }]);
  assert.ok(terminalSubsystem.metadata.capabilities.some((capability) => (
    capability.kind === "api-operation" && capability.value === "POST /sessions/:sessionId/terminal"
  )));
});

test("compact document round-trips deterministically with one current snapshot", () => {
  const model = compiledModel();
  const first = serializeSystemDocument(model);
  const second = serializeSystemDocument(model);
  assert.equal(second, first);
  assert.equal(first.includes("\n  "), false);

  const document = encodeSystemDocument(model);
  assert.deepEqual(Object.keys(document), [
    "schemaVersion",
    "adapter",
    "input",
    "declarations",
    "strings",
    "files",
    "entities",
    "relationships",
    "connections",
    "evidence",
    "findings",
    "coverage",
    "diagnostics",
    "provenance"
  ]);
  assert.equal(Object.hasOwn(document, "previous"), false);
  assert.equal(Object.hasOwn(document, "layout"), false);

  const decoded = decodeSystemDocument(JSON.parse(first));
  assert.deepEqual(decoded.files, model.files);
  assert.deepEqual(decoded.entities, model.entities);
  assert.deepEqual(decoded.relationships, model.relationships);
  assert.deepEqual(decoded.connections, model.connections);
  assert.deepEqual(decoded.findings, model.findings);
  assert.ok(decoded.entities.some((entity) => (
    entity.kind === "subsystem" &&
    entity.metadata.anchors.length > 0 &&
    entity.metadata.capabilities.length > 0
  )));
});

test("JSKIT derives the web-site subsystem and its file-backed URLs mechanically", () => {
  const extraction = extractionFixture();
  extraction.files.push(
    fileFact({ executionSide: "unknown", lines: 40, path: "src/pages/index.vue" }),
    fileFact({ executionSide: "unknown", lines: 55, path: "src/pages/projects/[slug].vue" })
  );
  const model = compileJskitSystemModel(extraction);
  const website = model.entities.find((entity) => entity.id === "jskit:subsystem:directory:src/pages");

  assert.equal(website.title, "Web site app");
  assert.equal(website.executionSide, "client");
  assert.deepEqual(website.metadata.anchors.map(({ kind, path, relation, origin }) => ({
    kind,
    path,
    relation,
    origin
  })), [{
    kind: "directory",
    path: "src/pages",
    relation: "owns",
    origin: "derived"
  }]);
  assert.deepEqual(
    website.metadata.capabilities.map((capability) => capability.value),
    ["/", "/projects/:slug"]
  );

  const overview = systemOverview(model);
  assert.deepEqual(
    overview.files
      .filter((entry) => entry.path.startsWith("src/pages/"))
      .map((entry) => entry.subsystemTitle),
    ["Web site app", "Web site app"]
  );
  assert.equal(overview.subsystems.find((subsystem) => subsystem.id === website.id).fileCount, 2);
});

test("a more specific inferred subsystem owns nested code without erasing adapter facts", () => {
  const extraction = extractionFixture();
  extraction.files.push(fileFact({
    executionSide: "server",
    lines: 80,
    packageId: "@local/terminal",
    path: "packages/terminal/src/server/session/sessionQueue.js"
  }));
  const model = compileJskitSystemModel(extraction, {
    declarations: [{
      kind: "subsystem",
      id: "codex:subsystem:terminal-session",
      title: "Terminal session lifecycle",
      description: "Coordinates terminal session work.",
      authoredBy: "codex",
      executionSide: "server",
      anchors: [{
        kind: "directory",
        path: "packages/terminal/src/server/session",
        relation: "owns"
      }],
      capabilities: [{
        id: "terminal-session-lifecycle",
        kind: "workflow",
        direction: "provides",
        title: "Terminal session lifecycle"
      }]
    }]
  });
  const inferred = model.entities.find((entity) => entity.id === "codex:subsystem:terminal-session");
  const packageSubsystem = model.entities.find((entity) => entity.id === "jskit:subsystem:package:@local/terminal");
  const nestedFile = systemOverview(model).files.find((entry) => entry.path.endsWith("sessionQueue.js"));

  assert.equal(inferred.origin, "inferred");
  assert.equal(inferred.metadata.status, "proposed");
  assert.equal(inferred.metadata.authoredBy, "codex");
  assert.equal(nestedFile.subsystemId, inferred.id);
  assert.deepEqual(nestedFile.subsystemIds.sort(), [inferred.id, packageSubsystem.id].sort());
  assert.ok(packageSubsystem.metadata.capabilities.some((capability) => capability.kind === "api-operation"));
});

test("subsystem projections aggregate declared, imported, and external dependencies", () => {
  const extraction = extractionFixture();
  extraction.files[0].imports.push({
    classification: "cross-package",
    kind: "import",
    line: 3,
    specifier: "@local/terminal/server",
    targetFile: "packages/terminal/src/server/TerminalProvider.js",
    targetPackageId: "@local/terminal"
  });
  extraction.files.at(-1).imports.push(
    {
      classification: "external-package",
      kind: "import",
      line: 1,
      specifier: "node:crypto",
      targetFile: "",
      targetPackageId: "node:crypto"
    },
    {
      classification: "external-package",
      kind: "import",
      line: 2,
      specifier: "ws",
      targetFile: "",
      targetPackageId: "ws"
    }
  );
  const overview = systemOverview(compileJskitSystemModel(extraction));
  const client = overview.subsystems.find((subsystem) => subsystem.packageId === "@local/client-shell");
  const terminal = overview.subsystems.find((subsystem) => subsystem.packageId === "@local/terminal");

  const outgoing = client.dependencies.outgoing[0];
  assert.equal(outgoing.subsystemId, terminal.id);
  assert.equal(outgoing.declared, true);
  assert.deepEqual(outgoing.kinds, ["declaration", "import"]);
  assert.equal(outgoing.importCount, 1);
  assert.equal(outgoing.fileConnections[0].fromPath, "packages/client-shell/src/client/ClientProvider.js");
  assert.equal(outgoing.fileConnections[0].toPath, "packages/terminal/src/server/TerminalProvider.js");
  assert.deepEqual(outgoing.fileConnections[0].references, ["@local/terminal/server"]);

  const incoming = terminal.dependencies.incoming[0];
  assert.equal(incoming.subsystemId, client.id);
  assert.deepEqual(incoming.kinds, ["declaration", "import"]);
  assert.equal(incoming.fileConnections.length, 1);
  assert.deepEqual(terminal.dependencies.external, [
    {
      connectionCount: 1,
      fileCount: 1,
      importCount: 1,
      kind: "package",
      packageId: "ws",
      sourceFileIds: ["file:packages/terminal/src/server/TerminalProvider.js"],
      title: "ws"
    }
  ]);
});

test("two subsystems cannot claim the same physical ownership anchor", () => {
  assert.throws(() => compileJskitSystemModel(extractionFixture(), {
    declarations: [{
      kind: "subsystem",
      id: "codex:subsystem:duplicate-terminal-owner",
      title: "Duplicate terminal owner",
      authoredBy: "codex",
      anchors: [{
        kind: "directory",
        path: "packages/terminal",
        relation: "owns"
      }]
    }]
  }), /ownership conflict.*packages\/terminal/iu);
});

test("subsystem details lead into the largest relevant file and preserve subsystem context", () => {
  const model = compiledModel();
  const subsystemId = "jskit:subsystem:package:@local/terminal";
  const details = entityDetails(model, subsystemId);

  assert.ok(details.children.some((entity) => entity.kind === "component"));
  assert.equal(details.files[0].path, "packages/terminal/src/server/largeTerminalService.js");
  assert.equal(details.files[0].lines, 1400);

  const constellation = fileConstellation(model, details.files[0].id);
  assert.equal(constellation.selectedFile.subsystemId, subsystemId);
  assert.ok(constellation.files.some((file) => file.path.endsWith("registerRoutes.js")));
  assert.ok(constellation.entities.some((entity) => entity.id === subsystemId));
});

test("non-literal route summaries cannot leak object coercion into operation titles", () => {
  const model = compiledModel({
    routeSummary: { identifier: "dynamicSummary" }
  });
  const operation = model.entities.find((entity) => entity.kind === "operation");
  assert.equal(operation.title, "Terminal");
  assert.notEqual(operation.description, "[object Object]");
});

test("findings map missing server operations and providers to connector failures", () => {
  const missingSocket = compiledModel({
    clientSuffix: "/missing"
  });
  assert.ok(missingSocket.findings.some((finding) => (
    finding.rule === "client_operation_without_server_operation" &&
    finding.title === "Client plug has no server socket"
  )));

  const missingProvider = compiledModel({
    serverProviders: false
  });
  assert.ok(missingProvider.findings.some((finding) => (
    finding.rule === "operation_without_provider" &&
    finding.title === "Operation without provider"
  )));
});
