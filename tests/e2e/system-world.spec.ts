import { expect, test } from "@playwright/test";

import {
  codexPromptSessionId,
  codexPromptSessionPayload,
  codexPromptStepDefinitions,
  DASHBOARD_PATH,
  DEVELOPMENT_PATH,
  SCOPED_API_PREFIX
} from "./support/base-shell-data";
import {
  mockCodexPromptSession
} from "./support/base-shell-mocks";
import {
  apiEndpointPattern,
  fulfillJson,
  routeApiEndpoint
} from "./support/base-shell/http";

const sessionApi = `/vibe64/system-graph/sessions/${codexPromptSessionId}`;
const serverSubsystem = {
  description: "Owns terminal commands and their public HTTP contract.",
  executionSide: "server",
  id: "subsystem:terminal",
  key: "terminal-key",
  kind: "subsystem",
  metadata: {
    executionSides: ["server"],
    packageId: "@local/terminal"
  },
  parentId: "system:fixture",
  title: "Terminal"
};
const clientSubsystem = {
  description: "Owns the browser shell that calls Terminal.",
  executionSide: "client",
  id: "subsystem:shell",
  key: "shell-key",
  kind: "subsystem",
  metadata: {
    executionSides: ["client"],
    packageId: "@local/shell"
  },
  parentId: "system:fixture",
  title: "Shell"
};
const selectedFile = {
  bytes: 72_000,
  directory: "packages/terminal/src/server",
  executionSide: "server",
  hash: "large-service-hash",
  id: "file:large-service",
  implementedEntityIds: [],
  imports: [{
    classification: "local-file",
    kind: "import",
    line: 4,
    specifier: "./helper.js",
    targetFile: "packages/terminal/src/server/helper.js",
    targetPackageId: "@local/terminal"
  }],
  key: "large-service-key",
  lines: 1_800,
  packageId: "@local/terminal",
  path: "packages/terminal/src/server/largeTerminalService.js",
  subsystemId: serverSubsystem.id,
  subsystemIds: [serverSubsystem.id]
};

test("System renders the current repository as a LOC-scaled file city", async ({ page }) => {
  test.setTimeout(60_000);
  await mockCodexPromptSession(page);
  await page.unroute(apiEndpointPattern("/vibe64/sessions"));
  await routeApiEndpoint(page, "/vibe64/sessions", async (route) => {
    await fulfillJson(route, {
      limits: {
        maxOpenSessions: 5,
        openSessionCount: 1
      },
      ok: true,
      sessions: [codexPromptSessionPayload],
      stepDefinitions: codexPromptStepDefinitions
    });
  });

  const overview = {
    adapter: {
      fileCity: {
        campuses: [
          { description: "The main app tree.", id: "application", roots: ["src"], title: "Application" },
          { description: "The package ecosystem.", id: "packages", roots: ["packages"], title: "Packages" }
        ]
      },
      id: "jskit",
      version: 2
    },
    coverage: { entities: 6, files: 3, findings: 1 },
    diagnostics: [],
    entities: [
      {
        description: "Fixture application.",
        executionSide: "shared",
        id: "system:fixture",
        key: "system-key",
        kind: "system",
        metadata: {},
        parentId: "",
        title: "Fixture"
      },
      clientSubsystem,
      serverSubsystem,
      {
        description: "Start a terminal.",
        executionSide: "server",
        id: "operation:start-terminal",
        key: "operation-key",
        kind: "operation",
        metadata: {
          method: "POST",
          packageId: "@local/terminal",
          path: "/sessions/:sessionId/terminal"
        },
        parentId: "interface:terminal",
        title: "Start a terminal"
      },
      {
        description: "Browser caller.",
        executionSide: "client",
        id: "consumer:start-terminal",
        key: "consumer-key",
        kind: "consumer",
        metadata: { packageId: "@local/shell" },
        parentId: clientSubsystem.id,
        title: "Terminal command"
      },
      {
        description: "Runs terminal commands.",
        executionSide: "server",
        id: "provider:terminal",
        key: "provider-key",
        kind: "component",
        metadata: { packageId: "@local/terminal" },
        parentId: serverSubsystem.id,
        title: "Terminal provider"
      }
    ],
    files: [
      {
        bytes: selectedFile.bytes,
        directory: selectedFile.directory,
        executionSide: selectedFile.executionSide,
        id: selectedFile.id,
        importCount: 1,
        importedByCount: 0,
        key: selectedFile.key,
        lines: selectedFile.lines,
        packageId: selectedFile.packageId,
        path: selectedFile.path,
        purpose: "Runs terminal commands for the active session.",
        roles: [],
        subsystemDescription: serverSubsystem.description,
        subsystemId: serverSubsystem.id,
        subsystemIds: [serverSubsystem.id],
        subsystemTitle: serverSubsystem.title
      },
      {
        bytes: 1_600,
        directory: "packages/terminal/src/server",
        executionSide: "server",
        id: "file:helper",
        importCount: 0,
        importedByCount: 1,
        key: "helper-key",
        lines: 40,
        packageId: "@local/terminal",
        path: "packages/terminal/src/server/helper.js",
        purpose: serverSubsystem.description,
        roles: [],
        subsystemDescription: serverSubsystem.description,
        subsystemId: serverSubsystem.id,
        subsystemIds: [serverSubsystem.id],
        subsystemTitle: serverSubsystem.title
      },
      {
        bytes: 4_200,
        directory: "src/client",
        executionSide: "client",
        id: "file:app",
        importCount: 0,
        importedByCount: 0,
        key: "app-key",
        lines: 100,
        packageId: "@local/shell",
        path: "src/client/App.vue",
        purpose: clientSubsystem.description,
        roles: [],
        subsystemDescription: clientSubsystem.description,
        subsystemId: clientSubsystem.id,
        subsystemIds: [clientSubsystem.id],
        subsystemTitle: clientSubsystem.title
      }
    ],
    fileMass: [
      { files: 2, lines: 240, subsystemId: clientSubsystem.id },
      { files: 8, lines: 4_200, subsystemId: serverSubsystem.id }
    ],
    input: {},
    lineStats: {
      files: 3,
      largest: 1_800,
      smallest: 40,
      total: 1_940
    },
    provenance: {},
    relationships: [
      {
        evidenceIds: [],
        from: "consumer:start-terminal",
        fromKey: "consumer-key",
        id: "relationship:consumes",
        kind: "consumes",
        packageId: "@local/shell",
        to: "operation:start-terminal",
        toKey: "operation-key",
        value: "POST /sessions/:sessionId/terminal"
      },
      {
        evidenceIds: [],
        from: "provider:terminal",
        fromKey: "provider-key",
        id: "relationship:handles",
        kind: "handles",
        packageId: "@local/terminal",
        to: "operation:start-terminal",
        toKey: "operation-key",
        value: ""
      }
    ],
    subsystems: [
      {
        authoredBy: "adapter",
        anchors: [{
          evidenceIds: [],
          kind: "directory",
          origin: "derived",
          path: "src/client",
          relation: "owns"
        }],
        capabilities: [],
        dependencies: {
          external: [],
          incoming: [],
          outgoing: [{
            classifications: ["package-specifier"],
            declared: true,
            fileCount: 1,
            fileConnections: [{
              fromFileId: "file:app",
              importCount: 1,
              toFileId: selectedFile.id
            }],
            importCount: 1,
            sourceFileIds: ["file:app"],
            subsystemId: serverSubsystem.id,
            title: serverSubsystem.title
          }]
        },
        description: clientSubsystem.description,
        executionSide: "client",
        fileCount: 1,
        id: clientSubsystem.id,
        key: clientSubsystem.key,
        lines: 100,
        meaningOrigin: "derived",
        origin: "derived",
        packageId: "@local/shell",
        parentId: "system:fixture",
        status: "current",
        title: clientSubsystem.title,
        unmatchedAnchorCount: 0
      },
      {
        authoredBy: "adapter",
        anchors: [{
          evidenceIds: [],
          kind: "directory",
          origin: "derived",
          path: "packages/terminal",
          relation: "owns"
        }],
        capabilities: [{
          description: "Starts a terminal.",
          direction: "provides",
          evidenceIds: [],
          id: "terminal-api",
          kind: "api-operation",
          origin: "derived",
          sourcePath: "packages/terminal/src/server/largeTerminalService.js",
          title: "Start a terminal",
          value: "POST /sessions/:sessionId/terminal"
        }],
        description: serverSubsystem.description,
        dependencies: {
          external: [{
            fileCount: 1,
            importCount: 1,
            kind: "package",
            packageId: "ws",
            sourceFileIds: [selectedFile.id],
            title: "ws"
          }],
          incoming: [{
            classifications: ["package-specifier"],
            declared: true,
            fileCount: 1,
            fileConnections: [{
              fromFileId: "file:app",
              importCount: 1,
              toFileId: selectedFile.id
            }],
            importCount: 1,
            sourceFileIds: ["file:app"],
            subsystemId: clientSubsystem.id,
            title: clientSubsystem.title
          }],
          outgoing: []
        },
        executionSide: "server",
        fileCount: 2,
        id: serverSubsystem.id,
        key: serverSubsystem.key,
        lines: 1_840,
        meaningOrigin: "derived",
        origin: "derived",
        packageId: "@local/terminal",
        parentId: "system:fixture",
        status: "current",
        title: serverSubsystem.title,
        unmatchedAnchorCount: 0
      }
    ]
  };
  const findings = [{
    entityIds: [serverSubsystem.id],
    id: "finding:contract",
    message: "The operation output is not yet described.",
    severity: "warning",
    status: "open",
    title: "Incomplete public contract"
  }];
  const constellation = {
    directoryAncestry: [
      { name: "packages", path: "packages" },
      { name: "terminal", path: "packages/terminal" },
      { name: "src", path: "packages/terminal/src" },
      { name: "server", path: "packages/terminal/src/server" }
    ],
    documentLineStats: {
      files: 3,
      largest: 1_800,
      smallest: 40,
      total: 1_940
    },
    edges: [{
      classification: "local-file",
      fromFileId: selectedFile.id,
      kind: "import",
      line: 4,
      specifier: "./helper.js",
      targetPackageId: "@local/terminal",
      toFileId: "file:helper"
    }],
    entities: [serverSubsystem],
    files: [
      selectedFile,
      {
        ...selectedFile,
        bytes: 1_600,
        hash: "helper-hash",
        id: "file:helper",
        imports: [],
        key: "helper-key",
        lines: 40,
        path: "packages/terminal/src/server/helper.js"
      }
    ],
    selectedFile
  };
  let streamPathname = "";

  await routeApiEndpoint(page, `${sessionApi}/status`, async (route) => {
    await fulfillJson(route, {
      adapterId: "jskit",
      coverage: overview.coverage,
      current: true,
      documentExists: true,
      ok: true,
      status: "current",
      update: null
    });
  });
  await routeApiEndpoint(page, `${sessionApi}/overview`, async (route) => {
    await fulfillJson(route, { ok: true, overview });
  });
  await routeApiEndpoint(page, `${sessionApi}/findings`, async (route) => {
    await fulfillJson(route, { findings, ok: true });
  });
  await routeApiEndpoint(page, `${sessionApi}/entities/terminal-key`, async (route) => {
    await fulfillJson(route, {
      details: {
        children: [],
        entity: serverSubsystem,
        files: [selectedFile],
        findings,
        relationships: overview.relationships
      },
      ok: true
    });
  });
  await routeApiEndpoint(page, `${sessionApi}/files/large-service-key/constellation`, async (route) => {
    await fulfillJson(route, { constellation, ok: true });
  });
  await routeApiEndpoint(page, `${sessionApi}/updates`, async (route) => {
    await fulfillJson(route, {
      ok: true,
      update: {
        adapterId: "jskit",
        eventCount: 1,
        reused: false,
        sessionId: codexPromptSessionId,
        status: "running",
        updateId: "update-1"
      }
    });
  });
  await routeApiEndpoint(page, `${sessionApi}/updates/update-1/stream`, async (route) => {
    streamPathname = new URL(route.request().url()).pathname;
    await route.fulfill({
      contentType: "text/event-stream",
      body: "event: system-update.completed\ndata: {\"type\":\"system-update.completed\"}\n\n"
    });
  });

  await page.goto(DEVELOPMENT_PATH);
  await expect(page.getByRole("button", { name: "New session" })).toBeVisible({ timeout: 15_000 });
  await page.goto(`${DASHBOARD_PATH}/system`);

  await expect(page.getByText(/File City · 034/u)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Folders" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Subsystems" })).toBeVisible();
  await expect(page.getByText("Drag / arrows to move", { exact: true })).toBeVisible();
  await expect(page.getByText("2-finger ↕ / W S forward–back", { exact: true })).toBeVisible();
  await expect(page.locator("canvas[aria-label^='Interactive 3D file city']")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "File city campuses" })).toBeVisible();

  await page.getByRole("button", { name: "Subsystems" }).click();
  const connectionsLayer = page.getByRole("button", { exact: true, name: "Connections" });
  const librariesLayer = page.getByRole("button", { exact: true, name: "Libraries" });
  await expect(connectionsLayer).toHaveAttribute("aria-pressed", "false");
  await expect(librariesLayer).toHaveAttribute("aria-pressed", "false");
  await connectionsLayer.click();
  await librariesLayer.click();
  await expect(connectionsLayer).toHaveAttribute("aria-pressed", "true");
  await expect(librariesLayer).toHaveAttribute("aria-pressed", "true");
  await connectionsLayer.click();
  await librariesLayer.click();
  await expect(page.getByRole("navigation", { name: "File City subsystems" })).toBeVisible();
  await page.getByRole("button", { name: /^Terminal 2 files/u }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Terminal" })).toBeVisible();
  await expect(page.getByText("Start a terminal", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /used by.*Shell.*1 import from 1 file/iu })).toBeVisible();
  await expect(page.getByText("ws", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Discover more" }).click();
  await expect(page.getByRole("textbox")).toHaveValue(
    /discover meaningful subsystems/iu
  );
  await page.getByRole("button", { name: "Folders" }).click();

  await page.getByRole("button", { name: /^Packages/u }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Packages" })).toBeVisible();
  await expect(page.getByText("JSKIT gives this source tree its own land parcel.", { exact: false })).toBeVisible();
  await expect(page.getByText("Terminal", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Largest building.*largeTerminalService\.js/u }).click();

  await expect(page.getByRole("heading", { level: 2, name: "largeTerminalService.js" })).toBeVisible();
  await expect(page.getByText("1,800", { exact: true })).toBeVisible();
  await expect(page.getByText("Terminal", { exact: true })).toBeVisible();
  await expect(page.getByText("This file is structurally enormous.", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: /imports.*helper\.js/u })).toBeVisible();

  await page.getByRole("button", { name: "Refresh map" }).click();
  await expect.poll(() => streamPathname).toBe(
    `${SCOPED_API_PREFIX}${sessionApi}/updates/update-1/stream`
  );
  await expect(page.getByText("Current file city ready.", { exact: true })).toBeVisible();
});
