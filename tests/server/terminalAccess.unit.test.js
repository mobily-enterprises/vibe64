import assert from "node:assert/strict";
import test from "node:test";

import {
  createOwnedTerminalAccessors
} from "@local/studio-terminal-core/server/terminalAccess";

function recordingOperations(calls) {
  return {
    close(terminalSessionId, options) {
      calls.push(["close", terminalSessionId, options]);
      return {
        ok: true,
        operation: "close"
      };
    },
    read(terminalSessionId, options) {
      calls.push(["read", terminalSessionId, options]);
      return {
        ok: true,
        operation: "read"
      };
    },
    resize(terminalSessionId, size, options) {
      calls.push(["resize", terminalSessionId, size, options]);
      return {
        ok: true,
        operation: "resize"
      };
    },
    subscribe(terminalSessionId, subscriber, options) {
      calls.push(["subscribe", terminalSessionId, subscriber, options]);
      return {
        ok: true,
        operation: "subscribe"
      };
    },
    write(terminalSessionId, data, options) {
      calls.push(["write", terminalSessionId, data, options]);
      return {
        ok: true,
        operation: "write"
      };
    }
  };
}

test("owned terminal accessors delegate all operations with computed access options", () => {
  const calls = [];
  const accessors = createOwnedTerminalAccessors({
    accessOptions(input) {
      return {
        input,
        namespace: `unit:${input.project}`
      };
    },
    operations: recordingOperations(calls)
  });
  const subscriber = () => {};

  assert.deepEqual(accessors.read("terminal-1", {
    project: "alpha"
  }), {
    ok: true,
    operation: "read"
  });
  assert.deepEqual(accessors.close("terminal-2", {
    project: "beta"
  }), {
    ok: true,
    operation: "close"
  });
  assert.deepEqual(accessors.subscribe("terminal-3", subscriber, {
    project: "gamma"
  }), {
    ok: true,
    operation: "subscribe"
  });
  assert.deepEqual(accessors.write("terminal-4", "hello", {
    project: "delta"
  }), {
    ok: true,
    operation: "write"
  });
  assert.deepEqual(accessors.resize("terminal-5", {
    cols: 120,
    rows: 40
  }, {
    project: "epsilon"
  }), {
    ok: true,
    operation: "resize"
  });

  assert.deepEqual(calls, [
    ["read", "terminal-1", {
      input: {
        project: "alpha"
      },
      namespace: "unit:alpha"
    }],
    ["close", "terminal-2", {
      input: {
        project: "beta"
      },
      namespace: "unit:beta"
    }],
    ["subscribe", "terminal-3", subscriber, {
      input: {
        project: "gamma"
      },
      namespace: "unit:gamma"
    }],
    ["write", "terminal-4", "hello", {
      input: {
        project: "delta"
      },
      namespace: "unit:delta"
    }],
    ["resize", "terminal-5", {
      cols: 120,
      rows: 40
    }, {
      input: {
        project: "epsilon"
      },
      namespace: "unit:epsilon"
    }]
  ]);
});

test("owned terminal accessors evaluate access options inside the wrapper", () => {
  const calls = [];
  const accessors = createOwnedTerminalAccessors({
    accessOptions(input) {
      calls.push(["accessOptions", input]);
      return {
        namespace: "unit"
      };
    },
    operations: {
      read(terminalSessionId, options) {
        calls.push(["read", terminalSessionId, options]);
        return {
          ok: true
        };
      }
    },
    wrap(callback) {
      calls.push(["wrap:start"]);
      const result = callback();
      calls.push(["wrap:end"]);
      return {
        result,
        wrapped: true
      };
    }
  });

  assert.deepEqual(accessors.read("terminal-1", {
    user: "owner@example.com"
  }), {
    result: {
      ok: true
    },
    wrapped: true
  });
  assert.deepEqual(calls, [
    ["wrap:start"],
    ["accessOptions", {
      user: "owner@example.com"
    }],
    ["read", "terminal-1", {
      namespace: "unit"
    }],
    ["wrap:end"]
  ]);
});

test("owned terminal accessors preserve promise return values", async () => {
  const expected = Promise.resolve({
    ok: true
  });
  const accessors = createOwnedTerminalAccessors({
    accessOptions() {
      return {
        namespace: "unit"
      };
    },
    operations: {
      read() {
        return expected;
      }
    }
  });

  assert.equal(accessors.read("terminal-1"), expected);
  assert.deepEqual(await accessors.read("terminal-1"), {
    ok: true
  });
});

test("owned terminal accessors validate construction options", () => {
  assert.throws(() => createOwnedTerminalAccessors(), /accessOptions function/);
  assert.throws(() => createOwnedTerminalAccessors({
    accessOptions: null
  }), /accessOptions function/);
  assert.throws(() => createOwnedTerminalAccessors({
    accessOptions() {},
    wrap: "not-a-function"
  }), /wrap option must be a function/);
  assert.throws(() => createOwnedTerminalAccessors({
    accessOptions() {},
    operations: {
      read: null
    }
  }), /operation "read" must be a function/);
  assert.throws(() => createOwnedTerminalAccessors({
    accessOptions() {},
    operations: {
      unknown() {}
    }
  }), /Unknown owned terminal accessor operation "unknown"/);
});
