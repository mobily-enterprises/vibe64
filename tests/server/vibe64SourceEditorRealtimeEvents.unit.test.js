import assert from "node:assert/strict";
import test from "node:test";

import {
  VIBE64_SOURCE_EDITOR_FILE_CHANGED_EVENT,
  VIBE64_SOURCE_EDITOR_FILE_OPENED_EVENT,
  sourceEditorFileOpenRealtimePayload,
  sourceEditorFileRealtimePayload,
  vibe64SourceEditorFileChangedServiceEvent,
  vibe64SourceEditorFileOpenedServiceEvent
} from "@local/vibe64-core/server/sourceEditorRealtimeEvents";

test("Vibe64 source editor service event describes a saved file change", () => {
  const event = vibe64SourceEditorFileChangedServiceEvent();
  const result = {
    fileChange: {
      hash: "hash-2",
      mtimeMs: 123.4,
      originId: "tab-1",
      path: "src/app.js",
      projectSlug: "beepollen",
      sessionId: "session-1",
      size: 42,
      updatedAt: "2026-07-02T08:00:00.000Z"
    },
    ok: true
  };

  assert.equal(event.type, "entity.changed");
  assert.equal(event.source, "vibe64");
  assert.equal(event.entity, "source_editor_file");
  assert.equal(event.operation, "updated");
  assert.equal(event.realtime.event, VIBE64_SOURCE_EDITOR_FILE_CHANGED_EVENT);
  assert.equal(event.realtime.audience, "all_clients");
  assert.equal(event.entityId({ result }), "session-1:src/app.js");
  assert.deepEqual(event.realtime.payload({ result }), {
    hash: "hash-2",
    mtimeMs: 123.4,
    originId: "tab-1",
    path: "src/app.js",
    projectSlug: "beepollen",
    sessionId: "session-1",
    size: 42,
    updatedAt: "2026-07-02T08:00:00.000Z"
  });
});

test("Vibe64 source editor service event ignores incomplete file changes", () => {
  const event = vibe64SourceEditorFileChangedServiceEvent();

  assert.equal(event.entityId({
    result: {
      fileChange: {
        hash: "hash-2",
        path: "src/app.js",
        sessionId: "session-1"
      },
      ok: true
    }
  }), null);
  assert.deepEqual(sourceEditorFileRealtimePayload({
    result: {
      error: "Save failed.",
      ok: false
    }
  }), {});
});

test("Vibe64 source editor service event describes an opened file", () => {
  const event = vibe64SourceEditorFileOpenedServiceEvent();
  const result = {
    fileOpen: {
      originId: "tab-1",
      path: "src/app.js",
      projectSlug: "beepollen",
      sessionId: "session-1",
      updatedAt: "2026-07-02T08:00:00.000Z"
    },
    ok: true
  };

  assert.equal(event.type, "entity.changed");
  assert.equal(event.source, "vibe64");
  assert.equal(event.entity, "source_editor_file");
  assert.equal(event.operation, "updated");
  assert.equal(event.realtime.event, VIBE64_SOURCE_EDITOR_FILE_OPENED_EVENT);
  assert.equal(event.realtime.audience, "all_clients");
  assert.equal(event.entityId({ result }), "session-1:src/app.js");
  assert.deepEqual(event.realtime.payload({ result }), {
    originId: "tab-1",
    path: "src/app.js",
    projectSlug: "beepollen",
    sessionId: "session-1",
    updatedAt: "2026-07-02T08:00:00.000Z"
  });
});

test("Vibe64 source editor open-file event ignores incomplete open results", () => {
  const event = vibe64SourceEditorFileOpenedServiceEvent();

  assert.equal(event.entityId({
    result: {
      fileOpen: {
        path: "src/app.js",
        sessionId: "session-1"
      },
      ok: true
    }
  }), null);
  assert.deepEqual(sourceEditorFileOpenRealtimePayload({
    result: {
      error: "Open failed.",
      ok: false
    }
  }), {});
});
