import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  createService
} from "../../packages/current-app/src/server/service.js";
import {
  withTemporaryRoot
} from "./vibe64TestHelpers.js";

function projectService(root, {
  sessionSourceRoot = "",
  userEnvironment = {}
} = {}) {
  return {
    async createRuntime() {
      return {
        async getSession(sessionId) {
          return {
            metadata: {
              source_kind: "session_clone",
              source_path: sessionSourceRoot,
              source_path_authority: "managed_session_source"
            },
            sessionId,
            sessionRoot: path.join(root, "runtime", sessionId),
            sourcePath: sessionSourceRoot
          };
        }
      };
    },
    currentProjectSourceRoot() {
      return root;
    },
    currentTargetRoot() {
      return root;
    },
    async projectInspectionEnvironment() {
      return userEnvironment;
    }
  };
}

test("current app returns the explicit Vibe64 Outputs contract", async () => {
  await withTemporaryRoot(async (root) => {
    const calls = [];
    const service = createService({
      env: {
        PLATFORM_VALUE: "platform"
      },
      inspectOutputs(input) {
        calls.push(input);
        return {
          components: ["nodejs"],
          diagnostics: [],
          resources: [],
          runtimeRequirements: ["node"],
          stackHash: "stack-hash",
          status: "ready",
          targets: [{
            id: "web",
            label: "Web"
          }]
        };
      },
      projectService: projectService(root, {
        userEnvironment: {
          BOOKS_ORIGIN: "http://books.test"
        }
      })
    });

    const response = await service.inspectCurrentApp();

    assert.equal(response.ok, true);
    assert.equal(response.ready, true);
    assert.equal(response.status, "ready");
    assert.equal(response.root, root);
    assert.deepEqual(response.components, ["nodejs"]);
    assert.deepEqual(response.targets, [{ id: "web", label: "Web" }]);
    assert.equal(calls[0].environment.PLATFORM_VALUE, "platform");
    assert.equal(calls[0].environment.BOOKS_ORIGIN, "http://books.test");
  });
});

test("missing Vibe64 Outputs declarations are unconfigured, not guessed", async () => {
  await withTemporaryRoot(async (root) => {
    const service = createService({
      inspectOutputs() {
        const error = new Error("Genesis requires genesis/stack.md. Run genesis init first.");
        error.code = "STACK_REQUIRED";
        throw error;
      },
      projectService: projectService(root)
    });

    const response = await service.inspectCurrentApp();

    assert.equal(response.ok, true);
    assert.equal(response.ready, false);
    assert.equal(response.status, "unconfigured");
    assert.deepEqual(response.targets, []);
    assert.match(response.message, /stack\.md/u);
  });
});

test("a project without a baseline source is unconfigured until a session exists", async () => {
  let inspected = false;
  const service = createService({
    inspectOutputs() {
      inspected = true;
      return {};
    },
    projectService: projectService("")
  });

  const response = await service.inspectCurrentApp();

  assert.equal(response.ok, true);
  assert.equal(response.status, "unconfigured");
  assert.equal(inspected, false);
  assert.match(response.message, /Choose a project/u);
});

test("current app never inspects a project namespace as source", async () => {
  let inspected = false;
  const projectNamespace = "/home/merc/.local/state/vibe64/managed-sources/merc/projects/demo";
  const service = createService({
    inspectOutputs() {
      inspected = true;
      return {};
    },
    projectService: {
      ...projectService(""),
      currentTargetRoot() {
        return projectNamespace;
      }
    }
  });

  const response = await service.inspectCurrentApp();

  assert.equal(response.ok, true);
  assert.equal(response.status, "unconfigured");
  assert.equal(inspected, false);
  assert.equal(response.root, "");
});

test("session inspection uses that session's source directory", async () => {
  await withTemporaryRoot(async (root) => {
    const sessionSourceRoot = path.join(
      path.dirname(root),
      "managed-source",
      "sessions",
      "active",
      "session-1",
      "source"
    );
    let inspectedRoot = "";
    const service = createService({
      inspectOutputs({ projectRoot }) {
        inspectedRoot = projectRoot;
        return {
          status: "unconfigured",
          targets: []
        };
      },
      projectService: projectService(root, {
        sessionSourceRoot
      })
    });

    const response = await service.inspectCurrentApp({
      sessionId: "session-1"
    });

    assert.equal(response.ok, true);
    assert.equal(inspectedRoot, sessionSourceRoot);
    assert.equal(response.root, sessionSourceRoot);
  });
});

test("unexpected Genesis inspection errors remain visible", async () => {
  await withTemporaryRoot(async (root) => {
    const service = createService({
      inspectOutputs() {
        const error = new Error("Cannot read Stack file.");
        error.code = "EACCES";
        throw error;
      },
      projectService: projectService(root)
    });

    const response = await service.inspectCurrentApp();

    assert.equal(response.ok, false);
    assert.equal(response.code, "EACCES");
    assert.match(response.error, /Cannot read Stack/u);
  });
});
